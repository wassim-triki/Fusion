using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Infrastructure.Core;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.Roles;

public sealed class RoleNotFoundException() : Exception("Role not found.");

public interface IRoleService
{
    Task<RolesOverviewDto> GetOverviewAsync(Guid tenantId, CancellationToken cancellationToken);
    Task<RoleDetailDto> GetRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken);
    Task<RoleDetailDto> CreateRoleAsync(Guid tenantId, CreateRoleRequest request, CancellationToken cancellationToken);
    Task<RoleDetailDto> SaveRoleAsync(Guid tenantId, Guid roleId, uint expectedVersion, SaveRoleRequest request, CancellationToken cancellationToken);
    Task DeleteRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken);
    Task<IReadOnlyList<PersonRoleDto>?> GetPersonRolesAsync(Guid tenantId, Guid employeeId, CancellationToken cancellationToken);
    Task<IReadOnlyList<RoleCandidateDto>> FindCandidatesAsync(Guid tenantId, string? search, CancellationToken cancellationToken);
}

/// <summary>
/// The roles model over access profiles (D-25): every role with its areas and holders, one role's page, and a
/// person's roles with why. The Administrators role is shown, never changed here.
/// </summary>
public sealed class RoleService(
    AppIdentityDbContext dbContext,
    IRoleHolderService holders,
    RoleRecomputeQueue recomputeQueue,
    ICoreRoleFacts coreFacts,
    IAccessProfileService accessProfiles) : IRoleService
{
    private const int MaxConditions = 50;
    private const int MaxChosen = 500;
    private static readonly string[] BuiltInOrder = ["employee", "manager", "hr-admin"];

    public async Task<RolesOverviewDto> GetOverviewAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var areas = await AreasAsync(tenantId, cancellationToken);
        var profiles = await ProfilesAsync(tenantId, cancellationToken);
        var counts = await dbContext.UserAccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId)
            .GroupBy(assignment => assignment.AccessProfileId)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(group => group.Key, group => group.Count, cancellationToken);
        var administrators = await AdministratorsAsync(tenantId, cancellationToken);
        var faces = await FacesAsync(tenantId, profiles.Select(profile => profile.Id).ToList(), cancellationToken);

        var roles = profiles.Select(profile => Summary(profile, areas,
                IsAdministrators(profile) ? administrators.Count : counts.GetValueOrDefault(profile.Id),
                IsAdministrators(profile) ? administrators.Take(3).ToList() : faces.GetValueOrDefault(profile.Id, [])))
            .ToList();

        var last = await dbContext.AccessAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .Where(auditEvent => auditEvent.TenantId == tenantId && auditEvent.ResourceType == "AccessProfile")
            .OrderByDescending(auditEvent => auditEvent.OccurredAt)
            .Select(auditEvent => new { auditEvent.OccurredAt, auditEvent.ActorName, auditEvent.ResourceId })
            .FirstOrDefaultAsync(cancellationToken);
        var lastRole = last is null ? null : profiles.FirstOrDefault(profile => profile.Id.ToString() == last.ResourceId)?.Name;

        return new RolesOverviewDto(
            areas,
            roles,
            last is null || lastRole is null ? null : new RoleChangeDto(last.OccurredAt, last.ActorName, lastRole));
    }

    public async Task<RoleDetailDto> GetRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken)
    {
        var areas = await AreasAsync(tenantId, cancellationToken);
        var profile = (await ProfilesAsync(tenantId, cancellationToken)).FirstOrDefault(profile => profile.Id == roleId)
            ?? throw new RoleNotFoundException();

        List<RoleHolderDto> people;
        if (IsAdministrators(profile))
        {
            people = (await AdministratorsAsync(tenantId, cancellationToken))
                .Select(face => new RoleHolderDto(face.UserId, face.EmployeeId, face.Name, null, IsChosen: true, ByRule: false))
                .ToList();
        }
        else
        {
            people = await (
                    from assignment in dbContext.UserAccessProfiles.IgnoreQueryFilters()
                    join user in dbContext.Users.IgnoreQueryFilters() on assignment.UserId equals user.Id
                    join membership in dbContext.TenantMemberships.IgnoreQueryFilters() on assignment.TenantMembershipId equals membership.Id
                    where assignment.TenantId == tenantId && assignment.AccessProfileId == roleId
                    select new RoleHolderDto(user.Id, membership.EmployeeId, (user.FirstName + " " + user.LastName).Trim(), user.Email,
                        assignment.IsChosen, assignment.ByRule))
                .AsNoTracking()
                .ToListAsync(cancellationToken);
        }

        people = people.OrderBy(person => person.Name, StringComparer.OrdinalIgnoreCase).ToList();
        return new RoleDetailDto(
            Summary(profile, areas, people.Count, people.Take(3).Select(person => new RoleFaceDto(person.UserId, person.EmployeeId, person.Name)).ToList()),
            areas,
            people);
    }

    public async Task<RoleDetailDto> CreateRoleAsync(Guid tenantId, CreateRoleRequest request, CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > 100)
            throw new InvalidOperationException("A role needs a name of up to 100 characters.");
        await EnsureNameFreeAsync(tenantId, name, null, cancellationToken);

        var profile = AccessProfile.Create(tenantId, name, request.Description, AccessProfileTypes.Custom, isSystemProtected: false);
        dbContext.AccessProfiles.Add(profile);
        await dbContext.SaveChangesAsync(cancellationToken);
        return await GetRoleAsync(tenantId, profile.Id, cancellationToken);
    }

    public async Task<RoleDetailDto> SaveRoleAsync(
        Guid tenantId, Guid roleId, uint expectedVersion, SaveRoleRequest request, CancellationToken cancellationToken)
    {
        var profile = await dbContext.AccessProfiles.IgnoreQueryFilters()
            .Include(item => item.Grants)
            .Include(item => item.RuleConditions)
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.Id == roleId, cancellationToken)
            ?? throw new RoleNotFoundException();
        if (IsAdministrators(profile))
            throw new InvalidOperationException("Administrators can do everything; who they are is changed in Administrators.");
        if (profile.IsSystemProtected)
            throw new InvalidOperationException("This role is retiring and can't be changed.");
        if (profile.Version != expectedVersion)
            throw new DbUpdateConcurrencyException("Someone changed this role since you opened it.");

        // What it can do: only areas the company has, and only options an area offers (RoleAreas.Compose refuses
        // the rest, administrators-only areas included).
        var areas = (await AreasAsync(tenantId, cancellationToken)).Select(area => area.Id).ToHashSet(StringComparer.Ordinal);
        var cells = request.Cells ?? [];
        if (cells.Any(cell => !areas.Contains(cell.AreaId) && cell.Level != RoleLevels.None))
            throw new InvalidOperationException("That area isn't part of this company's Fusion.");
        if (cells.GroupBy(cell => cell.AreaId).Any(group => group.Count() > 1))
            throw new InvalidOperationException("Each area is set once.");
        var grants = RoleAreas.Compose(
            cells.Select(cell => new RoleAreaCell(cell.AreaId, cell.Level, cell.Reach)),
            profile.Grants.Select(grant => new EffectivePermissionGrant(grant.PermissionKey, grant.Scope)));

        // Who has it.
        var holderKind = request.HolderKind ?? string.Empty;
        if (!AccessProfileHolderKinds.IsValid(holderKind))
            throw new InvalidOperationException("Choose who has this role.");
        var conditions = await ValidateConditionsAsync(tenantId, holderKind, request.Conditions ?? [], cancellationToken);
        var chosenUserIds = (request.ChosenUserIds ?? []).Where(id => id != Guid.Empty).Distinct().ToList();
        if (holderKind == AccessProfileHolderKinds.Everyone && chosenUserIds.Count > 0)
            throw new InvalidOperationException("Everyone already has this role.");
        if (chosenUserIds.Count > MaxChosen)
            throw new InvalidOperationException($"Choose at most {MaxChosen} people; a rule fits larger groups.");
        var chosen = await dbContext.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(membership => membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && chosenUserIds.Contains(membership.UserId))
            .Select(membership => new { membership.Id, membership.UserId })
            .ToListAsync(cancellationToken);
        if (chosen.Count != chosenUserIds.Count)
            throw new InvalidOperationException("Only people who already sign in to Fusion can be chosen.");

        if (profile.Type != AccessProfileTypes.SystemSeeded)
        {
            var name = request.Name?.Trim() ?? string.Empty;
            if (name.Length is 0 or > 100)
                throw new InvalidOperationException("A role needs a name of up to 100 characters.");
            await EnsureNameFreeAsync(tenantId, name, profile.Id, cancellationToken);
            profile.UpdateDetails(name, request.Description);
        }

        profile.ReplaceGrants(grants.Select(grant => AccessProfileGrant.Create(tenantId, profile.Id, grant.PermissionKey, grant.Scope)));
        profile.SetHolders(holderKind, conditions.Select(condition =>
            AccessProfileRuleCondition.Create(tenantId, profile.Id, condition.Kind, condition.TargetId)));

        var rows = await dbContext.UserAccessProfiles.IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == tenantId && assignment.AccessProfileId == profile.Id)
            .ToListAsync(cancellationToken);
        var chosenUsers = chosen.ToDictionary(member => member.UserId, member => member.Id);
        foreach (var row in rows)
        {
            row.SetChosen(chosenUsers.ContainsKey(row.UserId));
            if (!row.IsHeld)
                dbContext.UserAccessProfiles.Remove(row);
        }
        foreach (var (userId, membershipId) in chosenUsers.Where(member => rows.All(row => row.UserId != member.Key)))
        {
            dbContext.UserAccessProfiles.Add(UserAccessProfile.Create(tenantId, userId, profile.Id, membershipId));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        dbContext.ChangeTracker.Clear();

        await RecomputeOrQueueAsync(tenantId, cancellationToken);
        await SyncHoldersAsync(tenantId, profile.Id, cancellationToken);
        return await GetRoleAsync(tenantId, profile.Id, cancellationToken);
    }

    public async Task DeleteRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken)
    {
        var profile = await dbContext.AccessProfiles.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.Id == roleId, cancellationToken)
            ?? throw new RoleNotFoundException();
        if (profile.Type == AccessProfileTypes.SystemSeeded)
            throw new InvalidOperationException("Fusion's own roles can be changed but not deleted.");

        var rows = await dbContext.UserAccessProfiles.IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == tenantId && assignment.AccessProfileId == roleId)
            .ToListAsync(cancellationToken);
        var affected = rows.Select(row => row.UserId).ToList();
        dbContext.UserAccessProfiles.RemoveRange(rows);
        dbContext.AccessProfiles.Remove(profile);
        await dbContext.SaveChangesAsync(cancellationToken);

        foreach (var user in await dbContext.Users.IgnoreQueryFilters().Where(user => affected.Contains(user.Id)).ToListAsync(cancellationToken))
            await accessProfiles.SyncCompatibilityRolesAsync(user, cancellationToken);
    }

    public async Task<IReadOnlyList<PersonRoleDto>?> GetPersonRolesAsync(Guid tenantId, Guid employeeId, CancellationToken cancellationToken)
    {
        var membership = await dbContext.TenantMemberships.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == tenantId && item.EmployeeId == employeeId && item.Status == TenantMembershipStatus.Active)
            .Select(item => new { item.Id, item.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        if (membership is null)
            return null;

        var held = await dbContext.UserAccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId && assignment.UserId == membership.UserId)
            .ToListAsync(cancellationToken);
        var heldIds = held.Select(row => row.AccessProfileId).ToHashSet();
        var profiles = (await ProfilesAsync(tenantId, cancellationToken))
            .Where(profile => heldIds.Contains(profile.Id) && !IsAdministrators(profile))
            .ToList();

        // The facts only explain a rule or a team; when Core HR can't answer, the reason is still named.
        CoreRoleFact? fact = null;
        if (profiles.Any(profile => profile.HolderKind is AccessProfileHolderKinds.Rule or AccessProfileHolderKinds.Team))
        {
            try
            {
                fact = (await coreFacts.GetFactsAsync(tenantId, cancellationToken)).FirstOrDefault(item => item.EmployeeId == employeeId);
            }
            catch (HttpRequestException)
            {
            }
        }

        var result = new List<PersonRoleDto>();
        if (await dbContext.TenantAdministratorAssignments.IgnoreQueryFilters().AnyAsync(assignment =>
                assignment.TenantId == tenantId && assignment.UserId == membership.UserId && assignment.RevokedAt == null, cancellationToken))
        {
            var definition = await dbContext.AccessProfiles.IgnoreQueryFilters().AsNoTracking()
                .Where(profile => profile.TenantId == tenantId && profile.InternalKey == TenantAdministratorAuthority.InternalKey)
                .Select(profile => profile.Id)
                .FirstOrDefaultAsync(cancellationToken);
            result.Add(new PersonRoleDto(definition, TenantAdministratorAuthority.DisplayName, true,
                [new PersonRoleReasonDto(PersonRoleReasons.Administrator, [], null)]));
        }

        foreach (var profile in profiles)
        {
            var row = held.First(item => item.AccessProfileId == profile.Id);
            var reasons = new List<PersonRoleReasonDto>();
            if (row.ByRule)
            {
                reasons.Add(profile.HolderKind switch
                {
                    AccessProfileHolderKinds.Everyone => new PersonRoleReasonDto(PersonRoleReasons.Everyone, [], null),
                    AccessProfileHolderKinds.Team => new PersonRoleReasonDto(PersonRoleReasons.Team, [], fact?.DirectReports),
                    _ => new PersonRoleReasonDto(PersonRoleReasons.Rule,
                        (fact is null ? profile.RuleConditions : RoleHolderRules.Met(profile.RuleConditions, fact))
                            .Select(condition => new RoleConditionDto(condition.Kind, condition.TargetId)).ToList(),
                        null),
                });
            }
            if (row.IsChosen)
            {
                reasons.Add(new PersonRoleReasonDto(PersonRoleReasons.Chosen, [], null));
            }

            result.Add(new PersonRoleDto(profile.Id, profile.Name, false, reasons));
        }

        return result;
    }

    public async Task<IReadOnlyList<RoleCandidateDto>> FindCandidatesAsync(Guid tenantId, string? search, CancellationToken cancellationToken)
    {
        var term = search?.Trim().ToUpperInvariant() ?? string.Empty;
        var query =
            from membership in dbContext.TenantMemberships.IgnoreQueryFilters()
            join user in dbContext.Users.IgnoreQueryFilters() on membership.UserId equals user.Id
            where membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && membership.EmployeeId != null
                && user.IsActive
            select new { user.Id, EmployeeId = membership.EmployeeId!.Value, user.FirstName, user.LastName, user.Email, user.NormalizedEmail };
        if (term.Length > 0)
        {
            query = query.Where(item => (item.FirstName + " " + item.LastName).ToUpper().Contains(term)
                || (item.NormalizedEmail != null && item.NormalizedEmail.Contains(term)));
        }

        return await query
            .OrderBy(item => item.FirstName).ThenBy(item => item.LastName)
            .Take(20)
            .Select(item => new RoleCandidateDto(item.Id, item.EmployeeId, (item.FirstName + " " + item.LastName).Trim(), item.Email))
            .ToListAsync(cancellationToken);
    }

    private async Task RecomputeOrQueueAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        try
        {
            await holders.RecomputeAsync(tenantId, cancellationToken);
        }
        catch (HttpRequestException)
        {
            // Core HR is down: the role is saved, its rule holders follow when it answers.
            dbContext.ChangeTracker.Clear();
            recomputeQueue.Enqueue(tenantId);
        }
    }

    /// <summary>The old token roles follow effective permissions until they retire (B-178).</summary>
    private async Task SyncHoldersAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken)
    {
        var userIds = dbContext.UserAccessProfiles.IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == tenantId && assignment.AccessProfileId == roleId)
            .Select(assignment => assignment.UserId);
        foreach (var user in await dbContext.Users.IgnoreQueryFilters().Where(user => userIds.Contains(user.Id)).ToListAsync(cancellationToken))
            await accessProfiles.SyncCompatibilityRolesAsync(user, cancellationToken);
    }

    private async Task<IReadOnlyList<RoleConditionDto>> ValidateConditionsAsync(
        Guid tenantId, string holderKind, IReadOnlyList<RoleConditionDto> conditions, CancellationToken cancellationToken)
    {
        var distinct = conditions.Distinct().ToList();
        if (holderKind != AccessProfileHolderKinds.Rule)
        {
            return distinct.Count == 0 ? [] : throw new InvalidOperationException("Only a rule has conditions.");
        }

        if (distinct.Count == 0)
            throw new InvalidOperationException("A rule needs at least one condition.");
        if (distinct.Count > MaxConditions)
            throw new InvalidOperationException($"A rule has at most {MaxConditions} values.");
        if (distinct.Any(condition => !AccessProfileRuleKinds.IsValid(condition.Kind) || condition.TargetId == Guid.Empty))
            throw new InvalidOperationException("A rule looks at a department, job, place or unit.");

        // Core HR confirms each value is this company's; an id from anywhere else is refused, not stored.
        var known = await coreFacts.ResolveTargetsAsync(tenantId, distinct.Select(condition => condition.TargetId).ToList(), cancellationToken);
        bool Known(RoleConditionDto condition) => condition.Kind switch
        {
            AccessProfileRuleKinds.Department => known.Departments.Contains(condition.TargetId),
            AccessProfileRuleKinds.Unit => known.Units.Contains(condition.TargetId),
            AccessProfileRuleKinds.Job => known.Jobs.Contains(condition.TargetId),
            AccessProfileRuleKinds.Place => known.Places.Contains(condition.TargetId),
            _ => false,
        };
        if (!distinct.All(Known))
            throw new InvalidOperationException("Some of the rule's values aren't this company's departments, jobs, places or units.");
        return distinct;
    }

    private async Task EnsureNameFreeAsync(Guid tenantId, string name, Guid? roleId, CancellationToken cancellationToken)
    {
        var normalized = name.ToUpperInvariant();
        if (await dbContext.AccessProfiles.IgnoreQueryFilters().AnyAsync(profile =>
                profile.TenantId == tenantId && profile.NormalizedName == normalized && profile.Id != roleId, cancellationToken))
            throw new InvalidOperationException("Another role already has this name.");
    }

    private async Task<List<AccessProfile>> ProfilesAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var profiles = await dbContext.AccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Include(profile => profile.Grants)
            .Include(profile => profile.RuleConditions)
            .Where(profile => profile.TenantId == tenantId)
            .ToListAsync(cancellationToken);
        return profiles
            .OrderBy(profile => IsAdministrators(profile) ? 2 : profile.Type == AccessProfileTypes.SystemSeeded ? 0 : 1)
            .ThenBy(profile => Array.IndexOf(BuiltInOrder, profile.InternalKey))
            .ThenBy(profile => profile.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private async Task<IReadOnlyList<RoleAreaDto>> AreasAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var modules = await dbContext.TenantModuleEntitlements.IgnoreQueryFilters().AsNoTracking()
            .Where(entitlement => entitlement.TenantId == tenantId)
            .Select(entitlement => entitlement.Module)
            .ToListAsync(cancellationToken);
        var keys = modules.Select(module => module == TenantModule.Performance ? PermissionModuleKeys.Performance : module.ToString().ToLowerInvariant());
        return RoleAreas.For(keys)
            .Select(area => new RoleAreaDto(area.Id, area.Group, area.AdministratorsOnly,
                area.Options.Select(option => new RoleAreaOptionDto(option.Level, option.Reach,
                    option.Defining.Select(grant => new RoleGrantDto(grant.PermissionKey, grant.Scope)).ToList(),
                    option.Companions.Select(grant => new RoleGrantDto(grant.PermissionKey, grant.Scope)).ToList())).ToList()))
            .ToList();
    }

    private async Task<List<RoleFaceDto>> AdministratorsAsync(Guid tenantId, CancellationToken cancellationToken)
        => await (
                from assignment in dbContext.TenantAdministratorAssignments.IgnoreQueryFilters()
                join user in dbContext.Users.IgnoreQueryFilters() on assignment.UserId equals user.Id
                where assignment.TenantId == tenantId && assignment.RevokedAt == null
                orderby user.FirstName, user.LastName
                select new RoleFaceDto(user.Id,
                    dbContext.TenantMemberships.IgnoreQueryFilters()
                        .Where(membership => membership.TenantId == tenantId && membership.UserId == user.Id)
                        .Select(membership => membership.EmployeeId)
                        .FirstOrDefault(),
                    (user.FirstName + " " + user.LastName).Trim()))
            .AsNoTracking()
            .ToListAsync(cancellationToken);

    private async Task<Dictionary<Guid, List<RoleFaceDto>>> FacesAsync(Guid tenantId, IReadOnlyCollection<Guid> roleIds, CancellationToken cancellationToken)
    {
        var faces = new Dictionary<Guid, List<RoleFaceDto>>();
        foreach (var roleId in roleIds)
        {
            faces[roleId] = await (
                    from assignment in dbContext.UserAccessProfiles.IgnoreQueryFilters()
                    join user in dbContext.Users.IgnoreQueryFilters() on assignment.UserId equals user.Id
                    join membership in dbContext.TenantMemberships.IgnoreQueryFilters() on assignment.TenantMembershipId equals membership.Id
                    where assignment.TenantId == tenantId && assignment.AccessProfileId == roleId
                    orderby user.FirstName, user.LastName
                    select new RoleFaceDto(user.Id, membership.EmployeeId, (user.FirstName + " " + user.LastName).Trim()))
                .AsNoTracking()
                .Take(3)
                .ToListAsync(cancellationToken);
        }

        return faces;
    }

    private static bool IsAdministrators(AccessProfile profile) => profile.InternalKey == TenantAdministratorAuthority.InternalKey;

    private static RoleSummaryDto Summary(AccessProfile profile, IReadOnlyList<RoleAreaDto> areas, int holderCount, IReadOnlyList<RoleFaceDto> faces)
    {
        var shown = areas.Select(area => area.Id).ToHashSet(StringComparer.Ordinal);
        var cells = RoleAreas.Read(profile.Grants.Select(grant => new EffectivePermissionGrant(grant.PermissionKey, grant.Scope)))
            .Where(cell => shown.Contains(cell.AreaId))
            .Select(cell => new RoleCellDto(cell.AreaId, cell.Level, cell.Reach))
            .ToList();
        return new RoleSummaryDto(
            profile.Id,
            IsAdministrators(profile) ? "Administrators" : profile.Name,
            profile.Description,
            profile.Type == AccessProfileTypes.SystemSeeded,
            IsAdministrators(profile),
            profile.IsSystemProtected,
            profile.HolderKind,
            profile.RuleConditions.Select(condition => new RoleConditionDto(condition.Kind, condition.TargetId)).ToList(),
            holderCount,
            faces,
            cells,
            profile.Version,
            profile.UpdatedAt);
    }
}
