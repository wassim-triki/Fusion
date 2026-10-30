using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Requests;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.AccessProfiles;

public interface IAccessProfileService
{
    Task EnsureSeedDataAsync(CancellationToken cancellationToken = default);

    /// <summary>Seeds the standard access profiles for one tenant. A newly provisioned tenant has none until this runs.</summary>
    Task EnsureTenantAccessProfilesAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AccessProfileSummaryDto>> GetProfilesAsync(Guid tenantId, CancellationToken cancellationToken = default);
    Task<AccessProfileSummaryDto?> GetProfileAsync(Guid tenantId, Guid profileId, CancellationToken cancellationToken = default);
    Task<CurrentUserAccessDto> GetCurrentUserAccessAsync(ApplicationUser user, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AccessProfileAssignmentSummaryDto>> GetAssignedProfilesAsync(ApplicationUser user, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<EffectivePermissionGrant>> GetEffectivePermissionsAsync(ApplicationUser user, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<PermissionHolder>> GetPermissionHoldersAsync(Guid tenantId, string permissionKey, string scope, CancellationToken cancellationToken = default);
    Task SetInviteAccessProfilesAsync(Guid tenantId, Guid inviteId, IReadOnlyCollection<Guid> accessProfileIds, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AccessProfileAssignmentSummaryDto>> GetInviteAccessProfilesAsync(Guid inviteId, CancellationToken cancellationToken = default);
    Task ApplyInviteProfilesAsync(InviteToken invite, ApplicationUser user, CancellationToken cancellationToken = default);
    Task SyncCompatibilityRolesAsync(ApplicationUser user, CancellationToken cancellationToken = default);
    string ResolveCompatibilityRole(IReadOnlyCollection<EffectivePermissionGrant> grants);
}

public sealed class AccessProfileService(
    AppIdentityDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    Roles.RoleRecomputeQueue? recomputeQueue = null) : IAccessProfileService
{
    /// <summary>
    /// Resolves the Active membership that authorizes an access assignment.
    /// Assignments are membership-bound, so an account with no Active membership in
    /// the tenant cannot be granted tenant access at all.
    /// </summary>
    /// <summary>
    /// The single customer tenant this account participates in, or null when it
    /// has none — which is the normal state for a Platform Administrator.
    /// </summary>
    private async Task<Guid?> FindActiveTenantIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        var tenantIds = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .Where(membership => membership.UserId == userId
                && membership.Status == TenantMembershipStatus.Active)
            .Select(membership => membership.TenantId)
            .Take(2)
            .ToListAsync(cancellationToken);

        // Zero or several is not an authoritative context, so report none.
        return tenantIds.Count == 1 ? tenantIds[0] : null;
    }

    private async Task<Guid?> FindActiveMembershipIdAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var membershipId = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .Where(membership => membership.TenantId == tenantId
                && membership.UserId == userId
                && membership.Status == TenantMembershipStatus.Active)
            .Select(membership => membership.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return membershipId == Guid.Empty ? null : membershipId;
    }

    private async Task<Guid> ResolveActiveMembershipIdAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var membershipId = await FindActiveMembershipIdAsync(tenantId, userId, cancellationToken);

        if (membershipId is null)
        {
            throw new InvalidOperationException(
                $"Account {userId} has no Active membership in tenant {tenantId}; "
                + "tenant access cannot be assigned without one.");
        }

        return membershipId.Value;
    }

    private static readonly string[] TenantRoles = [
        PlatformRole.HRAdmin,
        PlatformRole.OrgAdmin,
        PlatformRole.Manager,
        PlatformRole.Employee,
    ];


    public async Task EnsureSeedDataAsync(CancellationToken cancellationToken = default)
    {
        var tenantIds = await dbContext.Tenants
            .IgnoreQueryFilters()
            .Select(tenant => tenant.Id)
            .ToListAsync(cancellationToken);

        foreach (var tenantId in tenantIds)
        {
            await EnsureTenantProfilesAsync(tenantId, cancellationToken);
            await BackfillTenantAssignmentsAsync(tenantId, cancellationToken);
        }
    }

    public async Task<IReadOnlyList<AccessProfileSummaryDto>> GetProfilesAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var profiles = await LoadProfilesAsync(tenantId, cancellationToken);
        return profiles.Select(MapProfile).ToList();
    }

    public async Task<AccessProfileSummaryDto?> GetProfileAsync(Guid tenantId, Guid profileId, CancellationToken cancellationToken = default)
    {
        var profile = await dbContext.AccessProfiles
            .Include(item => item.Grants)
            .Include(item => item.UserAssignments)
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.Id == profileId, cancellationToken);

        return profile is null ? null : MapProfile(profile);
    }

    public async Task<CurrentUserAccessDto> GetCurrentUserAccessAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        return new CurrentUserAccessDto
        {
            TenantId = await FindActiveTenantIdAsync(user.Id, cancellationToken) ?? Guid.Empty,
            AccessProfiles = (await GetAssignedProfilesAsync(user, cancellationToken)).ToList(),
            EffectivePermissions = (await GetEffectivePermissionsAsync(user, cancellationToken))
                .Select(MapGrant)
                .ToList(),
        };
    }

    public async Task<IReadOnlyList<AccessProfileAssignmentSummaryDto>> GetAssignedProfilesAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var tenantId = await FindActiveTenantIdAsync(user.Id, cancellationToken);
        if (tenantId is null)
        {
            // No customer membership means no tenant access to report.
            return [];
        }

        var hasEmployeeBinding = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(membership => membership.TenantId == tenantId
                && membership.UserId == user.Id
                && membership.Status == TenantMembershipStatus.Active
                && membership.EmployeeId.HasValue,
                cancellationToken);

        var assignments = await dbContext.UserAccessProfiles
            .AsNoTracking()
            .Where(assignment => assignment.TenantId == tenantId && assignment.UserId == user.Id)
            .Join(
                dbContext.AccessProfiles,
                assignment => assignment.AccessProfileId,
                profile => profile.Id,
                (_, profile) => profile)
            // Bootstrap-created administrative accounts have no Employee link.
            // Legacy role backfills materialized workforce seeded profiles for
            // those accounts; they are compatibility residue, not independent
            // authority. Custom assignments remain visible, and a real
            // employee-linked account keeps its seeded workforce profiles.
            .Where(profile => hasEmployeeBinding
                || profile.Type != AccessProfileTypes.SystemSeeded)
            .Select(profile => new AccessProfileAssignmentSummaryDto
                {
                    Id = profile.Id,
                    Name = profile.Name,
                    Type = profile.Type,
                    IsSystemProtected = profile.IsSystemProtected,
                })
            .OrderBy(profile => profile.Name)
            .ToListAsync(cancellationToken);

        var canonicalAdministrator = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(assignment => assignment.TenantId == tenantId
                && assignment.UserId == user.Id
                && assignment.RevokedAt == null, cancellationToken);

        if (canonicalAdministrator)
        {
            var definition = await dbContext.AccessProfiles
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(profile => profile.TenantId == tenantId
                    && profile.InternalKey == TenantAdministratorAuthority.InternalKey)
                .Select(profile => new AccessProfileAssignmentSummaryDto
                {
                    Id = profile.Id,
                    Name = TenantAdministratorAuthority.DisplayName,
                    Type = profile.Type,
                    IsSystemProtected = true,
                })
                .SingleAsync(cancellationToken);

            assignments.Insert(0, definition);
        }

        return assignments;
    }

    public async Task<IReadOnlyList<EffectivePermissionGrant>> GetEffectivePermissionsAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var permissionTenantId = await FindActiveTenantIdAsync(user.Id, cancellationToken);

        // Tenant Administrator authority is the canonical assignment, not an
        // access-profile row. Its definition supplies the grants; holding it is a
        // separate fact from being assigned any profile.
        var administratorDefinitionId = permissionTenantId is null
            ? (Guid?)null
            : await FindActiveAdministratorDefinitionIdAsync(permissionTenantId.Value, user.Id, cancellationToken);

        var assignments = await EnsureAssignedProfileIdsAsync(user, cancellationToken);

        // No canonical authority and no assigned profile means no tenant
        // permissions. A global role name is derived output of authority and is
        // never read back as a source of it, so there is no role-based fallback to
        // grant permissions this account was not actually assigned.
        if (assignments.Count == 0 && administratorDefinitionId is null)
        {
            return [];
        }

        if (permissionTenantId is null)
        {
            return [];
        }

        // The administrator definition grants only through the canonical assignment above. A row naming it (an
        // invitation or an old assignment) is never a second way to administer the tenant.
        var definitionIds = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == permissionTenantId && profile.InternalKey == TenantAdministratorAuthority.InternalKey)
            .Select(profile => profile.Id)
            .ToListAsync(cancellationToken);
        var held = assignments.Where(profileId => !definitionIds.Contains(profileId));
        var sourceProfileIds = administratorDefinitionId is null
            ? held.ToList()
            : held.Append(administratorDefinitionId.Value).Distinct().ToList();

        var grants = await dbContext.AccessProfileGrants
            .AsNoTracking()
            .Where(grant => grant.TenantId == permissionTenantId && sourceProfileIds.Contains(grant.AccessProfileId))
            .ToListAsync(cancellationToken);

        return AggregateEffectivePermissions(grants.Select(grant =>
            new EffectivePermissionGrant(grant.PermissionKey, grant.Scope)));
    }

    /// <summary>
    /// Active accounts of the tenant whose effective permissions include the key at or
    /// above the scope. Candidates come from the grants that could confer it; each is then
    /// confirmed through <see cref="GetEffectivePermissionsAsync"/> so this answer can
    /// never disagree with what the account's own token carries.
    /// </summary>
    public async Task<IReadOnlyList<PermissionHolder>> GetPermissionHoldersAsync(
        Guid tenantId, string permissionKey, string scope, CancellationToken cancellationToken = default)
    {
        var grantingProfileIds = dbContext.AccessProfileGrants
            .IgnoreQueryFilters()
            .Where(grant => grant.TenantId == tenantId && grant.PermissionKey == permissionKey)
            .Select(grant => grant.AccessProfileId);
        var administratorCanGrant = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .AnyAsync(profile => profile.TenantId == tenantId
                && profile.InternalKey == TenantAdministratorAuthority.InternalKey
                && grantingProfileIds.Contains(profile.Id), cancellationToken);

        var candidates = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .Where(membership => membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && membership.User!.IsActive
                && (dbContext.UserAccessProfiles.IgnoreQueryFilters().Any(assignment => assignment.TenantId == tenantId
                        && assignment.UserId == membership.UserId && grantingProfileIds.Contains(assignment.AccessProfileId))
                    || (administratorCanGrant && dbContext.TenantAdministratorAssignments.IgnoreQueryFilters().Any(assignment =>
                        assignment.TenantId == tenantId && assignment.UserId == membership.UserId && assignment.RevokedAt == null))))
            .Select(membership => membership.User!)
            .ToListAsync(cancellationToken);

        var requiredRank = PermissionScopes.GetRank(scope);
        var holders = new List<PermissionHolder>();
        foreach (var user in candidates)
        {
            // Effective permissions are read for the account's single active tenant.
            if (await FindActiveTenantIdAsync(user.Id, cancellationToken) != tenantId) continue;
            var grants = await GetEffectivePermissionsAsync(user, cancellationToken);
            if (!grants.Any(grant => grant.PermissionKey == permissionKey && PermissionScopes.GetRank(grant.Scope) >= requiredRank))
                continue;
            var employeeId = await dbContext.TenantMemberships.IgnoreQueryFilters()
                .Where(membership => membership.TenantId == tenantId && membership.UserId == user.Id)
                .Select(membership => membership.EmployeeId)
                .FirstOrDefaultAsync(cancellationToken);
            holders.Add(new PermissionHolder(user.Id, employeeId, user.FullName.Trim(), user.Email ?? string.Empty));
        }

        return holders.OrderBy(holder => holder.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>
    /// The Tenant Administrator definition for this tenant, but only when the
    /// account actually holds active canonical authority. Assignment is authority;
    /// the definition only says what that authority means.
    /// </summary>
    private async Task<Guid?> FindActiveAdministratorDefinitionIdAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var holdsAuthority = await dbContext.TenantAdministratorAssignments
            .IgnoreQueryFilters()
            .AnyAsync(assignment => assignment.TenantId == tenantId
                && assignment.UserId == userId
                && assignment.RevokedAt == null, cancellationToken);

        if (!holdsAuthority)
        {
            return null;
        }

        var definitionId = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId
                && profile.InternalKey == TenantAdministratorAuthority.InternalKey)
            .Select(profile => profile.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return definitionId == Guid.Empty ? null : definitionId;
    }

    public async Task SetInviteAccessProfilesAsync(
        Guid tenantId,
        Guid inviteId,
        IReadOnlyCollection<Guid> accessProfileIds,
        CancellationToken cancellationToken = default)
    {
        var normalizedIds = accessProfileIds
            .Where(profileId => profileId != Guid.Empty)
            .Distinct()
            .ToArray();

        var validProfiles = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId && normalizedIds.Contains(profile.Id))
            .Select(profile => new { profile.Id, profile.InternalKey })
            .ToListAsync(cancellationToken);

        if (validProfiles.Count != normalizedIds.Length)
            throw new InvalidOperationException("One or more access profiles do not belong to this tenant.");

        // Administrators are added through their own protected flow, never by an invitation's roles.
        if (validProfiles.Any(profile => profile.InternalKey is TenantAdministratorAuthority.InternalKey or AccessProfileTemplates.RetiredOrgAdminKey))
            throw new InvalidOperationException("An invitation can't make someone an administrator.");

        var existing = await dbContext.InviteAccessProfiles
            .IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == tenantId && assignment.InviteTokenId == inviteId)
            .ToListAsync(cancellationToken);

        dbContext.InviteAccessProfiles.RemoveRange(existing);
        dbContext.InviteAccessProfiles.AddRange(normalizedIds.Select(profileId =>
            InviteAccessProfile.Create(tenantId, inviteId, profileId)));

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AccessProfileAssignmentSummaryDto>> GetInviteAccessProfilesAsync(Guid inviteId, CancellationToken cancellationToken = default)
    {
        return await dbContext.InviteAccessProfiles
            .IgnoreQueryFilters()
            .Where(assignment => assignment.InviteTokenId == inviteId)
            .Join(
                dbContext.AccessProfiles.IgnoreQueryFilters(),
                assignment => assignment.AccessProfileId,
                profile => profile.Id,
                (_, profile) => new AccessProfileAssignmentSummaryDto
                {
                    Id = profile.Id,
                    Name = profile.Name,
                    Type = profile.Type,
                    IsSystemProtected = profile.IsSystemProtected,
                })
            .OrderBy(profile => profile.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task ApplyInviteProfilesAsync(InviteToken invite, ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var inviteProfiles = await dbContext.InviteAccessProfiles
            .IgnoreQueryFilters()
            .Where(assignment => assignment.InviteTokenId == invite.Id)
            .Select(assignment => assignment.AccessProfileId)
            .ToListAsync(cancellationToken);

        if (inviteProfiles.Count == 0)
        {
            await EnsureTenantProfilesAsync(invite.TenantId, cancellationToken);

            var seededProfile = await ResolveSeededProfileIdAsync(invite.TenantId, invite.Role, cancellationToken);
            if (seededProfile.HasValue)
            {
                inviteProfiles.Add(seededProfile.Value);
            }
        }

        if (inviteProfiles.Count == 0)
            throw new InvalidOperationException("Invitation does not have an access profile assignment.");

        var existingAssignments = await dbContext.UserAccessProfiles
            .IgnoreQueryFilters()
            .Where(assignment => assignment.TenantId == invite.TenantId && assignment.UserId == user.Id)
            .ToListAsync(cancellationToken);

        // A role people hold by its holders (everyone, anyone with a team, a rule) is held provisionally here so
        // the first sign-in has it; the next recompute confirms or removes it. Any other role was chosen.
        var heldByRule = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == invite.TenantId
                && inviteProfiles.Contains(profile.Id)
                && profile.HolderKind != AccessProfileHolderKinds.Chosen)
            .Select(profile => profile.Id)
            .ToListAsync(cancellationToken);

        var assignedIds = existingAssignments.Select(assignment => assignment.AccessProfileId).ToHashSet();
        var inviteMembershipId = await ResolveActiveMembershipIdAsync(invite.TenantId, user.Id, cancellationToken);
        foreach (var profileId in inviteProfiles)
        {
            if (assignedIds.Add(profileId))
            {
                dbContext.UserAccessProfiles.Add(heldByRule.Contains(profileId)
                    ? UserAccessProfile.MatchedByRule(invite.TenantId, user.Id, profileId, inviteMembershipId)
                    : UserAccessProfile.Create(invite.TenantId, user.Id, profileId, inviteMembershipId));
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await SyncCompatibilityRolesAsync(user, cancellationToken);

        // The new person may match rules (a department, a team) the invitation didn't name.
        recomputeQueue?.Enqueue(invite.TenantId);
    }

    public async Task SyncCompatibilityRolesAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var currentRoles = await userManager.GetRolesAsync(user);
        if (currentRoles.Contains(PlatformRole.PlatformAdmin, StringComparer.Ordinal))
        {
            var removable = currentRoles.Where(role => TenantRoles.Contains(role, StringComparer.Ordinal)).ToArray();
            if (removable.Length > 0)
            {
                await userManager.RemoveFromRolesAsync(user, removable);
            }
            return;
        }

        var effectivePermissions = await GetEffectivePermissionsAsync(user, cancellationToken);
        var desiredRoles = DetermineCompatibilityRoles(effectivePermissions);
        var currentTenantRoles = currentRoles.Where(role => TenantRoles.Contains(role, StringComparer.Ordinal)).ToArray();
        var rolesToAdd = desiredRoles.Except(currentTenantRoles, StringComparer.Ordinal).ToArray();
        var rolesToRemove = currentTenantRoles.Except(desiredRoles, StringComparer.Ordinal).ToArray();

        if (rolesToRemove.Length > 0)
        {
            var removeResult = await userManager.RemoveFromRolesAsync(user, rolesToRemove);
            if (!removeResult.Succeeded)
                throw new InvalidOperationException(string.Join(", ", removeResult.Errors.Select(error => error.Description)));
        }

        if (rolesToAdd.Length > 0)
        {
            var addResult = await userManager.AddToRolesAsync(user, rolesToAdd);
            if (!addResult.Succeeded)
                throw new InvalidOperationException(string.Join(", ", addResult.Errors.Select(error => error.Description)));
        }
    }

    public string ResolveCompatibilityRole(IReadOnlyCollection<EffectivePermissionGrant> grants)
        => DetermineCompatibilityRoles(grants).FirstOrDefault() ?? PlatformRole.Employee;

    private static string[] DetermineCompatibilityRoles(IReadOnlyCollection<EffectivePermissionGrant> effectivePermissions)
    {
        var roles = new List<string>();

        if (HasOrgAdminCompatibilityCoverage(effectivePermissions))
        {
            roles.Add(PlatformRole.OrgAdmin);
        }

        if (HasHrAdminCompatibilityCoverage(effectivePermissions))
        {
            roles.Add(PlatformRole.HRAdmin);
        }

        if (effectivePermissions.Any(grant =>
                (grant.PermissionKey == CorePermissions.TeamView && grant.Scope == PermissionScopes.DirectReports)
                || (grant.PermissionKey == CorePermissions.EmployeeView && PermissionScopes.GetRank(grant.Scope) >= PermissionScopes.GetRank(PermissionScopes.DirectReports))))
        {
            roles.Add(PlatformRole.Manager);
        }

        if (effectivePermissions.Any(grant =>
                grant.PermissionKey is CorePermissions.ProfileSelfView or CorePermissions.ProfileSelfUpdate or CorePermissions.EmployeeView
                && PermissionScopes.GetRank(grant.Scope) >= PermissionScopes.GetRank(PermissionScopes.Self)))
        {
            roles.Add(PlatformRole.Employee);
        }

        return roles.Distinct(StringComparer.Ordinal).ToArray();
    }

    private static bool HasOrgAdminCompatibilityCoverage(IReadOnlyCollection<EffectivePermissionGrant> effectivePermissions)
        => CompatibilityRoleCoverage.OrgAdmin.All(required =>
            effectivePermissions.Any(grant =>
                string.Equals(grant.PermissionKey, required.PermissionKey, StringComparison.Ordinal)
                && PermissionScopes.GetRank(grant.Scope) >= PermissionScopes.GetRank(required.Scope)));

    private static bool HasHrAdminCompatibilityCoverage(IReadOnlyCollection<EffectivePermissionGrant> effectivePermissions)
        => CompatibilityRoleCoverage.HrAdmin.All(required =>
            effectivePermissions.Any(grant =>
                string.Equals(grant.PermissionKey, required.PermissionKey, StringComparison.Ordinal)
                && PermissionScopes.GetRank(grant.Scope) >= PermissionScopes.GetRank(required.Scope)));

    public Task EnsureTenantAccessProfilesAsync(Guid tenantId, CancellationToken cancellationToken = default)
        => EnsureTenantProfilesAsync(tenantId, cancellationToken);

    private static string ModulePermissionKeyFor(TenantModule module) => module switch
    {
        TenantModule.CoreHR => PermissionModuleKeys.CoreHR,
        TenantModule.Performance => PermissionModuleKeys.Performance,
        _ => module.ToString().ToLowerInvariant(),
    };

    private async Task EnsureTenantProfilesAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var existingProfiles = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Include(profile => profile.Grants)
            .Where(profile => profile.TenantId == tenantId)
            .ToListAsync(cancellationToken);

        var changed = false;

        // Phase 1: Migrate legacy/old system-seeded profiles to new naming
        foreach (var profile in existingProfiles.Where(p => p.Type == AccessProfileTypes.SystemSeeded).ToList())
        {
            if (!string.IsNullOrEmpty(profile.InternalKey))
                continue;

            if (AccessProfileTemplates.LegacyNameMapping.TryGetValue(profile.Name, out var targetInternalKey))
            {
                var targetTemplate = AccessProfileTemplates.GetByInternalKey(targetInternalKey);
                if (targetTemplate is null)
                    continue;

                // Check if a profile with this internal key already exists
                var existingTarget = existingProfiles.FirstOrDefault(p =>
                    string.Equals(p.InternalKey, targetInternalKey, StringComparison.Ordinal)
                    && p.Id != profile.Id);
                if (existingTarget is not null)
                {
                    // Migrate assignments from old profile to target, then remove old
                    var assignments = await dbContext.UserAccessProfiles
                        .IgnoreQueryFilters()
                        .Where(a => a.TenantId == tenantId && a.AccessProfileId == profile.Id)
                        .ToListAsync(cancellationToken);
                    foreach (var assignment in assignments)
                    {
                        var alreadyAssigned = await dbContext.UserAccessProfiles
                            .IgnoreQueryFilters()
                            .AnyAsync(a => a.TenantId == tenantId && a.UserId == assignment.UserId && a.AccessProfileId == existingTarget.Id, cancellationToken);
                        if (!alreadyAssigned)
                        {
                            // Reuse the membership already bound to the assignment
                            // being migrated so the account/tenant pair cannot drift.
                            dbContext.UserAccessProfiles.Add(
                                UserAccessProfile.Create(
                                    tenantId,
                                    assignment.UserId,
                                    existingTarget.Id,
                                    assignment.TenantMembershipId));
                        }
                    }
                    dbContext.UserAccessProfiles.RemoveRange(assignments);

                    var inviteAssignments = await dbContext.InviteAccessProfiles
                        .IgnoreQueryFilters()
                        .Where(a => a.TenantId == tenantId && a.AccessProfileId == profile.Id)
                        .ToListAsync(cancellationToken);
                    foreach (var assignment in inviteAssignments)
                    {
                        var alreadyAssigned = await dbContext.InviteAccessProfiles
                            .IgnoreQueryFilters()
                            .AnyAsync(a => a.TenantId == tenantId && a.InviteTokenId == assignment.InviteTokenId && a.AccessProfileId == existingTarget.Id, cancellationToken);
                        if (!alreadyAssigned)
                        {
                            dbContext.InviteAccessProfiles.Add(
                                InviteAccessProfile.Create(tenantId, assignment.InviteTokenId, existingTarget.Id));
                        }
                    }
                    dbContext.InviteAccessProfiles.RemoveRange(inviteAssignments);

                    dbContext.AccessProfiles.Remove(profile);
                    changed = true;
                    continue;
                }

                // Migrate this profile in-place
                profile.SetInternalKey(targetTemplate.InternalKey);
                profile.UpdateDetails(targetTemplate.Name, targetTemplate.Description, targetTemplate.InternalKey);
                profile.MarkSystemState(AccessProfileTypes.SystemSeeded, targetTemplate.IsSystemProtected);
                profile.ReplaceGrants(targetTemplate.Grants.Select(grant =>
                    AccessProfileGrant.Create(tenantId, profile.Id, grant.PermissionKey, grant.Scope)));
                changed = true;
            }
            else if (AccessProfileTemplates.ObsoleteLegacyNames.Contains(profile.Name))
            {
                // Remove obsolete system-seeded profiles with no assignments
                var assignmentCount = await dbContext.UserAccessProfiles
                    .IgnoreQueryFilters()
                    .CountAsync(a => a.TenantId == tenantId && a.AccessProfileId == profile.Id, cancellationToken);
                if (assignmentCount == 0)
                {
                    dbContext.AccessProfiles.Remove(profile);
                    changed = true;
                }
            }
        }

        // Phase 2: Ensure all current templates exist (by InternalKey)
        var existingByKey = existingProfiles
            .Where(p => !string.IsNullOrEmpty(p.InternalKey))
            .ToDictionary(p => p.InternalKey!, StringComparer.Ordinal);

        // Re-read after potential removals
        existingProfiles = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Include(p => p.Grants)
            .Where(p => p.TenantId == tenantId)
            .ToListAsync(cancellationToken);
        existingByKey = existingProfiles
            .Where(p => !string.IsNullOrEmpty(p.InternalKey))
            .ToDictionary(p => p.InternalKey!, StringComparer.Ordinal);

        // The Tenant Administrator definition is composed from the tenant's module
        // entitlements, so re-seeding a tenant that gains or loses a module keeps
        // the canonical authority's grants truthful.
        var enabledModuleKeys = await dbContext.TenantModuleEntitlements
            .IgnoreQueryFilters()
            .Where(entitlement => entitlement.TenantId == tenantId)
            .Select(entitlement => entitlement.Module)
            .ToListAsync(cancellationToken);

        var modulePermissionKeys = enabledModuleKeys.Select(ModulePermissionKeyFor).ToList();
        var performanceEnabled = modulePermissionKeys.Contains(PermissionModuleKeys.Performance, StringComparer.Ordinal);

        var templates = AccessProfileTemplates.ComposeSeeded(performanceEnabled)
            .Append(AccessProfileTemplates.BuildTenantAdministrator(modulePermissionKeys))
            .ToList();

        var withoutPerformance = AccessProfileTemplates.ComposeSeeded(performanceEnabled: false)
            .ToDictionary(template => template.InternalKey, StringComparer.Ordinal);
        var takenNames = existingProfiles.Select(profile => profile.NormalizedName).ToHashSet(StringComparer.Ordinal);

        foreach (var template in templates)
        {
            if (existingByKey.TryGetValue(template.InternalKey, out var seeded)
                && template.InternalKey != TenantAdministratorAuthority.InternalKey)
            {
                if (seeded.IsSystemProtected)
                {
                    await AdoptSeededRoleAsync(seeded, template, takenNames, cancellationToken);
                    changed = true;
                }
                else if (performanceEnabled
                    && !seeded.Grants.Any(grant => PerformancePermissions.All.Contains(grant.PermissionKey, StringComparer.Ordinal)))
                {
                    // The company gained Performance: the role starts with the template's Performance areas.
                    var added = template.Grants
                        .Where(grant => !withoutPerformance[template.InternalKey].Grants.Contains(grant))
                        .Where(grant => seeded.Grants.All(held => held.PermissionKey != grant.PermissionKey));
                    seeded.Grants.AddRange(added.Select(grant =>
                        AccessProfileGrant.Create(tenantId, seeded.Id, grant.PermissionKey, grant.Scope)));
                    changed = true;
                }

                continue;
            }

            if (existingByKey.TryGetValue(template.InternalKey, out var existing))
            {
                // Update existing system profile if name/description changed
                if (!string.Equals(existing.Name, template.Name, StringComparison.Ordinal)
                    || !string.Equals(existing.Description ?? string.Empty, template.Description ?? string.Empty, StringComparison.Ordinal))
                {
                    existing.UpdateDetails(template.Name, template.Description, template.InternalKey);
                    changed = true;
                }

                // Update grants if they differ
                var currentGrantKeys = existing.Grants
                    .Select(g => $"{g.PermissionKey}:{g.Scope}")
                    .OrderBy(k => k)
                    .ToArray();
                var templateGrantKeys = template.Grants
                    .Select(g => $"{g.PermissionKey}:{g.Scope}")
                    .OrderBy(k => k)
                    .ToArray();
                if (!currentGrantKeys.SequenceEqual(templateGrantKeys, StringComparer.Ordinal))
                {
                    existing.ReplaceGrants(template.Grants.Select(grant =>
                        AccessProfileGrant.Create(tenantId, existing.Id, grant.PermissionKey, grant.Scope)));
                    changed = true;
                }
            }
            else
            {
                // Create new profile from template
                // The seeded roles other than Administrators are the company's to change (areas and holders).
                var isAdministrator = template.InternalKey == TenantAdministratorAuthority.InternalKey;
                var profile = AccessProfile.Create(
                    tenantId,
                    template.Name,
                    template.Description,
                    AccessProfileTypes.SystemSeeded,
                    isAdministrator,
                    template.InternalKey);
                profile.ReplaceGrants(template.Grants.Select(grant =>
                    AccessProfileGrant.Create(tenantId, profile.Id, grant.PermissionKey, grant.Scope)));
                profile.SetHolders(template.HolderKind, []);
                dbContext.AccessProfiles.Add(profile);
                changed = true;
            }
        }

        // Brand, fields, lists and roles are the Administrators' alone (D-25).
        foreach (var profile in existingProfiles.Where(profile => profile.InternalKey is not (TenantAdministratorAuthority.InternalKey or AccessProfileTemplates.RetiredOrgAdminKey)))
        {
            var stripped = profile.Grants.RemoveAll(grant => RoleAreas.AdministratorOnlyKeys.Contains(grant.PermissionKey));
            changed |= stripped > 0;
        }

        // Org Admin is no longer seeded; it goes wherever nobody holds it or is invited to it.
        foreach (var retired in existingProfiles.Where(profile => profile.InternalKey == AccessProfileTemplates.RetiredOrgAdminKey))
        {
            var held = await dbContext.UserAccessProfiles.IgnoreQueryFilters().AnyAsync(assignment => assignment.AccessProfileId == retired.Id, cancellationToken)
                || await dbContext.InviteAccessProfiles.IgnoreQueryFilters().AnyAsync(assignment => assignment.AccessProfileId == retired.Id, cancellationToken);
            if (!held)
            {
                dbContext.AccessProfiles.Remove(retired);
                changed = true;
            }
        }

        if (changed)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    /// <summary>
    /// Moves a seeded role from the fixed profiles to the roles model, once: its areas and name from the template
    /// (keeping grants no area owns), its holders from the template, and the people who held it through the old
    /// baseline marked as held by those holders, so the next recompute confirms them.
    /// </summary>
    private async Task AdoptSeededRoleAsync(
        AccessProfile profile,
        SeededAccessProfileTemplate template,
        HashSet<string> takenNames,
        CancellationToken cancellationToken)
    {
        var normalized = template.Name.ToUpperInvariant();
        var name = profile.NormalizedName == normalized || takenNames.Add(normalized) ? template.Name : profile.Name;
        profile.UpdateDetails(name, template.Description, template.InternalKey);
        var kept = profile.Grants
            .Where(grant => !RoleAreas.OwnedKeys.Contains(grant.PermissionKey))
            .Select(grant => new EffectivePermissionGrant(grant.PermissionKey, grant.Scope));
        profile.ReplaceGrants(template.Grants.Concat(kept).DistinctBy(grant => grant.PermissionKey)
            .Select(grant => AccessProfileGrant.Create(profile.TenantId, profile.Id, grant.PermissionKey, grant.Scope)));
        profile.SetHolders(template.HolderKind, []);
        profile.MarkSystemState(AccessProfileTypes.SystemSeeded, isSystemProtected: false);

        if (template.HolderKind == AccessProfileHolderKinds.Chosen)
        {
            return;
        }

        var rows = await dbContext.UserAccessProfiles.IgnoreQueryFilters()
            .Where(assignment => assignment.AccessProfileId == profile.Id)
            .ToListAsync(cancellationToken);
        foreach (var row in rows)
        {
            row.SetChosen(false);
            row.SetByRule(true);
        }
    }

    private async Task BackfillTenantAssignmentsAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var seededProfiles = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId && profile.Type == AccessProfileTypes.SystemSeeded)
            .ToListAsync(cancellationToken);

        var seededByName = seededProfiles.ToDictionary(profile => profile.Name, StringComparer.Ordinal);
        var seededByKey = seededProfiles
            .Where(p => !string.IsNullOrEmpty(p.InternalKey))
            .ToDictionary(p => p.InternalKey!, StringComparer.Ordinal);

        var users = await dbContext.Users
            .IgnoreQueryFilters()
            .Where(user => user.TenantMemberships.Any(membership =>
                membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active))
            .ToListAsync(cancellationToken);

        foreach (var user in users)
        {
            var hasAssignments = await dbContext.UserAccessProfiles
                .IgnoreQueryFilters()
                .AnyAsync(assignment => assignment.TenantId == tenantId && assignment.UserId == user.Id, cancellationToken);
            if (hasAssignments)
            {
                continue;
            }

            var desiredProfiles = await ResolveRoleMappedSeededProfileIdsAsync(user, seededByName, seededByKey);

            if (desiredProfiles.Count == 0)
            {
                continue;
            }

            var seedMembershipId = await ResolveActiveMembershipIdAsync(tenantId, user.Id, cancellationToken);
            dbContext.UserAccessProfiles.AddRange(desiredProfiles.Select(profileId =>
                UserAccessProfile.Create(tenantId, user.Id, profileId, seedMembershipId)));
            await dbContext.SaveChangesAsync(cancellationToken);
            await SyncCompatibilityRolesAsync(user, cancellationToken);
        }
    }

    private async Task<List<AccessProfile>> LoadProfilesAsync(Guid tenantId, CancellationToken cancellationToken)
        => await dbContext.AccessProfiles
            .Include(profile => profile.Grants)
            .Include(profile => profile.UserAssignments)
            .Where(profile => profile.TenantId == tenantId)
            .OrderBy(profile => profile.Type)
            .ThenBy(profile => profile.Name)
            .ToListAsync(cancellationToken);

    private AccessProfileSummaryDto MapProfile(AccessProfile profile)
        => new()
        {
            Id = profile.Id,
            Name = profile.Name,
            Description = profile.Description,
            Type = profile.Type,
            IsSystemProtected = profile.IsSystemProtected,
            AssignedUserCount = profile.UserAssignments.Count,
            CreatedAt = profile.CreatedAt,
            UpdatedAt = profile.UpdatedAt,
            Version = profile.Version,
            Grants = profile.Grants
                .OrderBy(grant => PermissionCatalog.Get(grant.PermissionKey).Group)
                .ThenBy(grant => PermissionCatalog.Get(grant.PermissionKey).Label)
                .Select(grant => MapGrant(new EffectivePermissionGrant(grant.PermissionKey, grant.Scope)))
                .ToList(),
        };

    private static EffectivePermissionGrantDto MapGrant(EffectivePermissionGrant grant)
    {
        var definition = PermissionCatalog.Get(grant.PermissionKey);
        return new EffectivePermissionGrantDto
        {
            PermissionKey = grant.PermissionKey,
            Scope = grant.Scope,
            Label = definition.Label,
            Group = definition.Group,
            HelperText = definition.HelperText,
            AllowedScopes = definition.AllowedScopes.ToList(),
        };
    }

    private static IReadOnlyList<EffectivePermissionGrant> AggregateEffectivePermissions(IEnumerable<EffectivePermissionGrant> grants)
        => grants
            .GroupBy(grant => grant.PermissionKey, StringComparer.Ordinal)
            .Select(group => group.Aggregate((current, next) =>
                PermissionScopes.GetRank(next.Scope) > PermissionScopes.GetRank(current.Scope)
                    ? next
                    : current))
            .ToList();

    private static string PlatformRoleToInternalKey(string role) => role switch
    {
        PlatformRole.HRAdmin => "hr-admin",
        PlatformRole.OrgAdmin => "org-admin",
        _ => role.ToLowerInvariant()
    };

    private async Task<Guid?> ResolveSeededProfileIdAsync(Guid tenantId, string role, CancellationToken cancellationToken)
    {
        // First try matching by name
        var byName = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId && profile.Name == role)
            .Select(profile => (Guid?)profile.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (byName.HasValue)
            return byName;

        // Then try matching by internal key (with role-to-key mapping)
        var internalKey = PlatformRoleToInternalKey(role);
        return await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId && profile.InternalKey == internalKey)
            .Select(profile => (Guid?)profile.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }


    private async Task<List<Guid>> EnsureAssignedProfileIdsAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        var tenantId = await FindActiveTenantIdAsync(user.Id, cancellationToken);
        if (tenantId is null)
        {
            return [];
        }

        var hasEmployeeBinding = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(membership => membership.TenantId == tenantId
                && membership.UserId == user.Id
                && membership.Status == TenantMembershipStatus.Active
                && membership.EmployeeId.HasValue,
                cancellationToken);

        var assignments = await dbContext.UserAccessProfiles
            .Where(assignment => assignment.TenantId == tenantId && assignment.UserId == user.Id)
            .Join(
                dbContext.AccessProfiles,
                assignment => assignment.AccessProfileId,
                profile => profile.Id,
                (_, profile) => profile)
            .Where(profile => hasEmployeeBinding
                || profile.Type != AccessProfileTypes.SystemSeeded)
            .Select(profile => profile.Id)
            .ToListAsync(cancellationToken);

        if (assignments.Count > 0)
        {
            return assignments;
        }

        // Global roles are compatibility output only. Reconstructing access
        // profiles from them would let a stale OrgAdmin role recreate authority
        // after the canonical Tenant Administrator assignment was revoked.
        return assignments;
    }

    private async Task<List<Guid>> ResolveRoleMappedSeededProfileIdsAsync(
        ApplicationUser user,
        IReadOnlyDictionary<string, AccessProfile> seededByName,
        IReadOnlyDictionary<string, AccessProfile> seededByKey)
    {
        var roles = await userManager.GetRolesAsync(user);
        var ids = new List<Guid>();
        foreach (var role in roles)
        {
            if (role is PlatformRole.PlatformAdmin or PlatformRole.OrgAdmin)
                continue;

            // Match by name first
            if (seededByName.TryGetValue(role, out var byName))
            {
                ids.Add(byName.Id);
                continue;
            }

            // Match by internal key (with role-to-key mapping)
            var internalKey = PlatformRoleToInternalKey(role);
            if (seededByKey.TryGetValue(internalKey, out var byKey))
            {
                ids.Add(byKey.Id);
            }
        }
        return ids.Distinct().ToList();
    }


}
