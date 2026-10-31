using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

public interface IWorkforceContractService
{
    Task<WorkforceCurrentUserContextDto> GetCurrentUserContextAsync(ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<WorkforceEmployeeSummaryDto?> GetEmployeeAsync(Guid employeeId, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> ResolveEmployeesAsync(IReadOnlyCollection<Guid> employeeIds, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<PagedResponse<WorkforceEmployeeSummaryDto>> SearchEmployeesAsync(string? search, int page, int pageSize, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetEmployeesByScopeAsync(IReadOnlyCollection<Guid> orgUnitIds, bool includeDescendants, bool includeInactive, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<PagedResponse<WorkforceAccessSubjectSummaryDto>> SearchAccessSubjectsAsync(
        string? search,
        string? access,
        Guid? profileId,
        string? employeeStatus,
        string? deliveryState,
        string? employeeKey,
        string? baseline,
        Guid? cohort,
        Guid? orgUnitId,
        bool includeDescendants,
        int page,
        int pageSize,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceAccessSubjectSummaryDto>> GetAccessSubjectSelectionPreviewAsync(
        string? search,
        string? access,
        Guid? profileId,
        string? employeeStatus,
        string? deliveryState,
        string? employeeKey,
        string? baseline,
        Guid? cohort,
        Guid? orgUnitId,
        bool includeDescendants,
        CancellationToken cancellationToken);
    Task<WorkforceAccessRosterSummaryDto> GetAccessRosterSummaryAsync(CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetTeamAsync(Guid employeeId, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetDownlineAsync(Guid employeeId, int maxDepth, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetManagerChainAsync(Guid employeeId, ClaimsPrincipal user, CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkforceOrgUnitSummaryDto>> GetPublishedOrgUnitsAsync(bool includeInactive, CancellationToken cancellationToken);
    Task<WorkforceOrgUnitTreeDto> GetPublishedOrgUnitTreeAsync(Guid? rootId, int maxDepth, bool includeInactive, CancellationToken cancellationToken);
    Task<WorkforceBulkInviteResponseDto> BulkInviteAsync(WorkforceBulkInviteRequest request, ClaimsPrincipal user, CancellationToken cancellationToken);

    /// <summary>
    /// Returns the org-unit detail, scope-filtered. Null when not found or not visible.
    /// </summary>
    Task<WorkforceOrgUnitDetailDto?> GetOrgUnitDetailAsync(Guid orgUnitId, CancellationToken cancellationToken);

    /// <summary>
    /// Returns effective-today members of the org unit via canonical WorkAssignment, optionally including descendants,
    /// scope-filtered as with other workforce reads.
    /// </summary>
    Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetOrgUnitMembersAsync(Guid orgUnitId, bool includeDescendants, ClaimsPrincipal user, CancellationToken cancellationToken);
}

public sealed class WorkforceContractService(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    ITenantSettingsReadService tenantSettingsReadService,
    IWorkforceAccountStatusReader workforceAccountStatusReader,
    IWorkforceBulkProvisioner workforceBulkProvisioner,
    IWorkforceCanonicalResolver canonicalResolver) : IWorkforceContractService
{
    private const int MaxSearchPageSize = 100;
    private const string AccessStateNotInvited = "NotInvited";
    private const string AccessStateInvitePending = "InvitePending";
    private const string AccessStateActiveAccount = "ActiveAccount";
    private const string AccessStateSuspended = "Suspended";
    private const string AccessStateNeedsReview = "NeedsReview";

    public async Task<WorkforceCurrentUserContextDto> GetCurrentUserContextAsync(
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);
        WorkforceEmployeeSummaryDto? employee = null;

        if (access.LinkedEmployeeId.HasValue)
        {
            employee = await GetEmployeeAsync(access.LinkedEmployeeId.Value, user, cancellationToken);
        }

        var managerScope = access.IsManager && access.LinkedEmployeeId.HasValue
            ? new WorkforceManagerScopeDto(
                "DirectReports",
                access.LinkedEmployeeId.Value,
                employee?.DirectReportCount ?? 0,
                false)
            : null;

        // Headcount of the caller's own current org unit — count only, from canonical primary
        // assignments. This is the caller's own unit, so no roster-visibility scope applies.
        int? orgUnitMemberCount = null;
        if (employee?.OrgUnit is { } ownUnit)
        {
            var members = await canonicalResolver.GetEmployeeIdsInOrgUnitAsync(
                ownUnit.OrgUnitId, null, cancellationToken);
            orgUnitMemberCount = members.Count;
        }

        return new WorkforceCurrentUserContextDto(
            user.GetUserId(),
            tenantContext.TenantId,
            access.LinkedEmployeeId,
            employee,
            managerScope,
            employee is not null,
            orgUnitMemberCount);
    }

    public async Task<WorkforceEmployeeSummaryDto?> GetEmployeeAsync(
        Guid employeeId,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);

        var employee = await (await ApplyVisibilityScopeAsync(
                dbContext.Employees
                    .AsNoTracking(),
                access,
                cancellationToken))
            .FirstOrDefaultAsync(current => current.Id == employeeId, cancellationToken);

        if (employee is null)
        {
            return null;
        }

        var items = await BuildSummariesAsync([employee], access.Audience, cancellationToken);
        return items.Single();
    }

    public async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> ResolveEmployeesAsync(
        IReadOnlyCollection<Guid> employeeIds,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        if (employeeIds.Count == 0)
        {
            return [];
        }

        var access = BuildAccessContext(user);
        var employees = await (await ApplyVisibilityScopeAsync(
                dbContext.Employees
                    .AsNoTracking(),
                access,
                cancellationToken))
            .Where(current => employeeIds.Contains(current.Id))
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);

        return await BuildSummariesAsync(employees, access.Audience, cancellationToken);
    }

    public async Task<PagedResponse<WorkforceEmployeeSummaryDto>> SearchEmployeesAsync(
        string? search,
        int page,
        int pageSize,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);
        var currentPage = Math.Max(1, page);
        var currentPageSize = Math.Clamp(pageSize, 1, MaxSearchPageSize);

        var query = await ApplyVisibilityScopeAsync(
                dbContext.Employees
                    .AsNoTracking(),
                access,
                cancellationToken);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchTerm = search.Trim().ToLowerInvariant();
            query = query.Where(current =>
                current.FirstName.ToLower().Contains(searchTerm) ||
                current.LastName.ToLower().Contains(searchTerm) ||
                (current.Email != null && current.Email.ToLower().Contains(searchTerm)) ||
                current.EmployeeNumber.ToLower().Contains(searchTerm) ||
                (current.FirstName + " " + current.LastName).ToLower().Contains(searchTerm));
        }

        var employees = await query
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);

        var items = (await BuildSummariesAsync(employees, access.Audience, cancellationToken))
            .Where(item => item.IsActive)
            .ToList();
        var totalCount = items.Count;
        var pagedItems = items
            .Skip((currentPage - 1) * currentPageSize)
            .Take(currentPageSize)
            .ToList();

        return new PagedResponse<WorkforceEmployeeSummaryDto>
        {
            Items = pagedItems,
            TotalCount = totalCount,
            Page = currentPage,
            PageSize = currentPageSize
        };
    }

    public async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetEmployeesByScopeAsync(
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        bool includeInactive,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        if (orgUnitIds.Count == 0)
        {
            return [];
        }

        var access = BuildAccessContext(user);
        var targetOrgUnitIds = await ResolveOrgUnitScopeAsync(orgUnitIds, includeDescendants, cancellationToken);
        if (targetOrgUnitIds.Count == 0)
        {
            return [];
        }

        var now = DateTime.UtcNow;
        var canonicalMemberIds = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(w => targetOrgUnitIds.Contains(w.OrgUnitId)
                && w.IsPrimary
                && w.EffectiveFrom <= now
                && (w.EffectiveTo == null || now < w.EffectiveTo))
            .Select(w => w.EmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (canonicalMemberIds.Count == 0)
        {
            return [];
        }

        var query = await ApplyVisibilityScopeAsync(
                dbContext.Employees
                    .AsNoTracking(),
                access,
                cancellationToken);
        query = query.Where(current => canonicalMemberIds.Contains(current.Id));

        var employees = await query
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);

        var items = await BuildSummariesAsync(employees, access.Audience, cancellationToken);
        return includeInactive ? items : items.Where(item => item.IsActive).ToList();
    }

    private async Task<HashSet<Guid>> ResolveOrgUnitScopeAsync(
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        var result = new HashSet<Guid>(orgUnitIds);
        if (!includeDescendants)
        {
            return result;
        }

        var units = await dbContext.OrgUnits
            .AsNoTracking()
            .Select(unit => new { unit.Id, unit.ParentId })
            .ToListAsync(cancellationToken);
        var childrenByParentId = units.ToLookup(unit => unit.ParentId, unit => unit.Id);

        var queue = new Queue<Guid>(orgUnitIds);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var childId in childrenByParentId[current])
            {
                if (result.Add(childId))
                {
                    queue.Enqueue(childId);
                }
            }
        }

        return result;
    }

    public async Task<PagedResponse<WorkforceAccessSubjectSummaryDto>> SearchAccessSubjectsAsync(
        string? search,
        string? access,
        Guid? profileId,
        string? employeeStatus,
        string? deliveryState,
        string? employeeKey,
        string? baseline,
        Guid? cohort,
        Guid? orgUnitId,
        bool includeDescendants,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var currentPage = Math.Max(1, page);
        var currentPageSize = Math.Clamp(pageSize, 1, MaxSearchPageSize);
        var normalizedAccess = NormalizeAccessFilter(access);
        var normalizedDeliveryState = NormalizeDeliveryStateFilter(deliveryState);

        var query = ApplyAccessSubjectFilters(
            dbContext.Employees
                .AsNoTracking()
                .AsQueryable(),
            search,
            employeeKey);
        var scope = await ResolveRosterScopeAsync(cohort, orgUnitId, includeDescendants, cancellationToken);
        if (scope is not null)
        {
            query = query.Where(current => scope.Contains(current.Id));
        }
        var candidateEmployees = await query
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);
        var statuses = await LoadWorkforceAccountStatusesAsync(candidateEmployees, cancellationToken);
        var summaries = await BuildAccessSubjectSummariesAsync(candidateEmployees, statuses, cancellationToken);
        var filteredSummaries = summaries
            .Where(summary =>
                MatchesStatusFilter(summary, employeeStatus)
                && MatchesBaselineFilter(summary, baseline)
                && MatchesAccessFilters(
                    statuses.GetValueOrDefault(summary.EmployeeId),
                    normalizedAccess,
                    profileId,
                    normalizedDeliveryState))
            .ToList();

        var totalCount = filteredSummaries.Count;
        var employees = filteredSummaries
            .Skip((currentPage - 1) * currentPageSize)
            .Take(currentPageSize)
            .ToList();

        return new PagedResponse<WorkforceAccessSubjectSummaryDto>
        {
            Items = employees,
            TotalCount = totalCount,
            Page = currentPage,
            PageSize = currentPageSize,
        };
    }

    public async Task<IReadOnlyList<WorkforceAccessSubjectSummaryDto>> GetAccessSubjectSelectionPreviewAsync(
        string? search,
        string? access,
        Guid? profileId,
        string? employeeStatus,
        string? deliveryState,
        string? employeeKey,
        string? baseline,
        Guid? cohort,
        Guid? orgUnitId,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        var (matchingEmployees, statuses) = await LoadMatchingAccessSubjectEmployeesAsync(
            search,
            access,
            profileId,
            employeeStatus,
            deliveryState,
            employeeKey,
            baseline,
            cohort,
            orgUnitId,
            includeDescendants,
            cancellationToken);

        return await BuildAccessSubjectSummariesAsync(
            matchingEmployees,
            statuses,
            cancellationToken);
    }

    public async Task<WorkforceAccessRosterSummaryDto> GetAccessRosterSummaryAsync(
        CancellationToken cancellationToken)
    {
        var employees = await dbContext.Employees
            .AsNoTracking()
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);
        var statuses = await LoadWorkforceAccountStatusesAsync(employees, cancellationToken);
        var accessStates = employees
            .Select(employee => ClassifyAccessState(statuses.GetValueOrDefault(employee.Id)))
            .ToList();

        return new WorkforceAccessRosterSummaryDto(
            employees.Count,
            accessStates.Count(state => state == AccessStateNotInvited),
            accessStates.Count(state => state == AccessStateInvitePending),
            accessStates.Count(state => state == AccessStateActiveAccount),
            accessStates.Count(state => state == AccessStateNeedsReview),
            accessStates.Count(state => state == AccessStateSuspended));
    }

    public async Task<WorkforceBulkInviteResponseDto> BulkInviteAsync(
        WorkforceBulkInviteRequest request,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);
        if (!access.IsHrAdmin)
        {
            throw new InvalidOperationException("Only HR admins can perform bulk invites.");
        }

        List<Employee> matchingEmployees;
        IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> statuses;

        if (request.SpecificEmployeeIds is { Count: > 0 })
        {
            matchingEmployees = await dbContext.Employees
                .AsNoTracking()
                .Where(e => request.SpecificEmployeeIds.Contains(e.Id))
                .ToListAsync(cancellationToken);
            statuses = await LoadWorkforceAccountStatusesAsync(matchingEmployees, cancellationToken);
        }
        else
        {
            (matchingEmployees, statuses) = await LoadMatchingAccessSubjectEmployeesAsync(
                request.Search,
                request.Access,
                request.ProfileId,
                request.EmployeeStatus,
                request.DeliveryState,
                request.EmployeeKey,
                baseline: null,
                cohort: null,
                orgUnitId: null,
                includeDescendants: true,
                cancellationToken);
        }

        if (matchingEmployees.Count == 0)
        {
            return new WorkforceBulkInviteResponseDto([], 0, 0, 0, 0, 0);
        }

        var accessProfileId = await ResolveProvisioningAccessProfileIdAsync(
            request.AccessProfileId,
            cancellationToken);

        var freshInviteEmployees = new List<Employee>();
        var refreshInviteEmployees = new List<Employee>();
        var alreadyActiveEmployees = new List<Employee>();
        var skippedEmployees = new List<Employee>();

        foreach (var employee in matchingEmployees)
        {
            if (employee.Email is null)
            {
                skippedEmployees.Add(employee);
                continue;
            }

            var status = statuses.GetValueOrDefault(employee.Id);
            var provisioningState = status?.ProvisioningState ?? "Unprovisioned";

            switch (provisioningState)
            {
                case "Unprovisioned":
                case "InviteRevoked":
                    freshInviteEmployees.Add(employee);
                    break;
                case "InvitePending":
                case "InviteExpired":
                case "InviteAccepted":
                    refreshInviteEmployees.Add(employee);
                    break;
                case "Active":
                    alreadyActiveEmployees.Add(employee);
                    break;
                default:
                    skippedEmployees.Add(employee);
                    break;
            }
        }

        var sendToIdentity = freshInviteEmployees.Concat(refreshInviteEmployees).ToList();
        var freshIds = freshInviteEmployees.Select(e => e.Id).ToHashSet();

        var items = new List<WorkforceBulkInviteResultItemDto>();
        int invitedCount = 0;
        int refreshedCount = 0;

        if (sendToIdentity.Count > 0)
        {
            var subjects = sendToIdentity
                .Select(e => new WorkforceBulkProvisionSubject(e.Id, e.Email!, e.FirstName, e.LastName))
                .ToList();

            var provisionResult = await workforceBulkProvisioner.BulkProvisionAsync(
                subjects,
                accessProfileId,
                cancellationToken);

            var employeeLookup = matchingEmployees.ToDictionary(e => e.Id);

            foreach (var result in provisionResult.Items)
            {
                var employee = employeeLookup.GetValueOrDefault(result.EmployeeId);
                items.Add(new WorkforceBulkInviteResultItemDto(
                    result.EmployeeId,
                    employee?.DisplayName ?? "Unknown",
                    employee?.Email ?? "",
                    result.Outcome,
                    result.Message));

                if (result.Outcome is "Created")
                {
                    if (freshIds.Contains(result.EmployeeId))
                        invitedCount++;
                    else
                        refreshedCount++;
                }
            }
        }

        foreach (var employee in alreadyActiveEmployees)
        {
            items.Add(new WorkforceBulkInviteResultItemDto(
                employee.Id,
                employee.DisplayName,
                employee.Email,
                "Active",
                "Account is already active."));
        }

        foreach (var employee in skippedEmployees)
        {
            items.Add(new WorkforceBulkInviteResultItemDto(
                employee.Id,
                employee.DisplayName,
                employee.Email,
                "Skipped",
                "Account is not eligible for invitation."));
        }

        return new WorkforceBulkInviteResponseDto(
            items,
            matchingEmployees.Count,
            invitedCount,
            refreshedCount,
            alreadyActiveEmployees.Count,
            skippedEmployees.Count);
    }

    public async Task<WorkforceOrgUnitDetailDto?> GetOrgUnitDetailAsync(
        Guid orgUnitId,
        CancellationToken cancellationToken)
    {
        var orgUnit = await dbContext.OrgUnits
            .AsNoTracking()
            .FirstOrDefaultAsync(unit => unit.Id == orgUnitId, cancellationToken);

        if (orgUnit is null || !orgUnit.IsActive)
        {
            return null;
        }

        return new WorkforceOrgUnitDetailDto(
            orgUnit.Id,
            orgUnit.Code,
            orgUnit.Code,
            orgUnit.Name,
            orgUnit.Type,
            orgUnit.ParentId,
            orgUnit.IsActive);
    }

    public async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetOrgUnitMembersAsync(
        Guid orgUnitId,
        bool includeDescendants,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var targetOrgUnitIds = await ResolveOrgUnitScopeAsync([orgUnitId], includeDescendants, cancellationToken);
        if (targetOrgUnitIds.Count == 0)
        {
            return [];
        }

        // Resolve effective-today member employee ids from canonical primary work assignments.
        var memberEmployeeIds = new List<Guid>();
        foreach (var unitId in targetOrgUnitIds)
        {
            var ids = await canonicalResolver.GetEmployeeIdsInOrgUnitAsync(unitId, null, cancellationToken);
            memberEmployeeIds.AddRange(ids);
        }

        var distinctMemberIds = memberEmployeeIds.Distinct().ToList();
        if (distinctMemberIds.Count == 0)
        {
            return [];
        }

        var access = BuildAccessContext(user);
        var employees = await (await ApplyVisibilityScopeAsync(
                dbContext.Employees
                    .AsNoTracking(),
                access,
                cancellationToken))
            .Where(employee => distinctMemberIds.Contains(employee.Id))
            .OrderBy(employee => employee.LastName)
            .ThenBy(employee => employee.FirstName)
            .ToListAsync(cancellationToken);

        return await BuildSummariesAsync(employees, access.Audience, cancellationToken);
    }

    private async Task<Guid> ResolveProvisioningAccessProfileIdAsync(
        Guid requestedAccessProfileId,
        CancellationToken cancellationToken)
    {
        if (requestedAccessProfileId != Guid.Empty)
        {
            return requestedAccessProfileId;
        }

        var settings = await tenantSettingsReadService.GetCurrentAsync(cancellationToken);
        if (settings.Provisioning.DefaultAccessProfileId.HasValue
            && settings.Provisioning.DefaultAccessProfileId.Value != Guid.Empty)
        {
            return settings.Provisioning.DefaultAccessProfileId.Value;
        }

        throw new InvalidOperationException(
            "Access profile is required. Configure a provisioning default or choose a profile before inviting employees.");
    }

    public async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetTeamAsync(
        Guid employeeId,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);
        if (!access.IsHrAdmin && access.LinkedEmployeeId != employeeId)
        {
            return [];
        }

        var now = DateTime.UtcNow;
        var reportIds = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(m => m.ManagerEmployeeId == employeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= now
                && (m.EffectiveTo == null || now < m.EffectiveTo))
            .Select(m => m.SubjectEmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (reportIds.Count == 0)
        {
            return [];
        }

        var employees = await dbContext.Employees
            .AsNoTracking()
            .Where(current => reportIds.Contains(current.Id))
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);

        return await BuildSummariesAsync(employees, access.Audience, cancellationToken);
    }

    public async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetDownlineAsync(
        Guid employeeId,
        int maxDepth,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);
        // A non-admin may only resolve their own subtree; HR/tenant readers may resolve any.
        if (!access.IsHrAdmin && access.LinkedEmployeeId != employeeId)
        {
            return [];
        }

        var normalizedMaxDepth = Math.Clamp(maxDepth, 1, 25);

        // Load all active primary manager relationships once, then walk the subtree in memory (bounded + cycle-guarded).
        var now = DateTime.UtcNow;
        var managerEdges = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(m => m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= now
                && (m.EffectiveTo == null || now < m.EffectiveTo))
            .Select(m => new { SubjectId = m.SubjectEmployeeId, ManagerId = m.ManagerEmployeeId })
            .ToListAsync(cancellationToken);
        var reportsByManager = managerEdges.ToLookup(edge => edge.ManagerId, edge => edge.SubjectId);

        var subtreeIds = new List<Guid>();
        var visited = new HashSet<Guid> { employeeId };
        var frontier = new Queue<(Guid Id, int Depth)>();
        frontier.Enqueue((employeeId, 0));

        while (frontier.Count > 0)
        {
            var (currentId, depth) = frontier.Dequeue();
            if (depth >= normalizedMaxDepth)
            {
                continue;
            }

            foreach (var subjectId in reportsByManager[currentId])
            {
                if (!visited.Add(subjectId))
                {
                    continue;
                }

                subtreeIds.Add(subjectId);
                frontier.Enqueue((subjectId, depth + 1));
            }
        }

        if (subtreeIds.Count == 0)
        {
            return [];
        }

        var employees = await dbContext.Employees
            .AsNoTracking()
            .Where(current => subtreeIds.Contains(current.Id))
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);

        return await BuildSummariesAsync(employees, access.Audience, cancellationToken);
    }

    public async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetManagerChainAsync(
        Guid employeeId,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var access = BuildAccessContext(user);
        var subjectVisible = await (await ApplyVisibilityScopeAsync(
                dbContext.Employees.AsNoTracking(),
                access,
                cancellationToken))
            .AnyAsync(e => e.Id == employeeId, cancellationToken);

        if (!subjectVisible)
        {
            return [];
        }

        // Resolve manager chain (nearest-first) via canonical ManagerRelationship.
        var chainIds = await canonicalResolver.GetManagerChainAsync(employeeId, null, 25, cancellationToken);
        if (chainIds.Count == 0)
        {
            return [];
        }

        var managerLookup = await dbContext.Employees
            .AsNoTracking()
            .Where(e => chainIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, cancellationToken);

        // Build root-first list preserving canonical order, then reverse.
        var chain = chainIds
            .Select(id => managerLookup.GetValueOrDefault(id))
            .Where(e => e is not null)
            .Cast<Employee>()
            .ToList();
        chain.Reverse();
        return await BuildSummariesAsync(chain, access.Audience, cancellationToken);
    }

    public async Task<IReadOnlyList<WorkforceOrgUnitSummaryDto>> GetPublishedOrgUnitsAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var orgUnits = await dbContext.OrgUnits
            .AsNoTracking()
            .Where(unit => includeInactive || unit.IsActive)
            .OrderBy(unit => unit.Name)
            .ToListAsync(cancellationToken);
        var orgLookup = orgUnits.ToDictionary(unit => unit.Id);

        return orgUnits
            .Select(unit => BuildOrgUnitSummary(unit, orgLookup))
            .ToList();
    }

    public async Task<WorkforceOrgUnitTreeDto> GetPublishedOrgUnitTreeAsync(
        Guid? rootId,
        int maxDepth,
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var units = await dbContext.OrgUnits
            .AsNoTracking()
            .Where(unit => includeInactive || unit.IsActive)
            .OrderBy(unit => unit.Name)
            .ToListAsync(cancellationToken);

        var orgLookup = units.ToDictionary(unit => unit.Id);
        var childrenByParentId = units
            .ToLookup(unit => unit.ParentId, unit => unit);

        // Direct active-member count per unit, plus a full-subtree rollup computed over the entire
        // hierarchy (independent of the render maxDepth so truncated branches still count).
        // Resolved from canonical primary work assignments as of today.
        var nowForTree = DateTime.UtcNow;
        var directMemberCounts = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(w => w.IsPrimary
                && w.EffectiveFrom <= nowForTree
                && (w.EffectiveTo == null || nowForTree < w.EffectiveTo))
            .GroupBy(w => w.OrgUnitId)
            .Select(g => new { OrgUnitId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.OrgUnitId, g => g.Count, cancellationToken);

        var totalMemberCounts = new Dictionary<Guid, int>();
        int ComputeTotal(OrgUnit unit)
        {
            var total = directMemberCounts.GetValueOrDefault(unit.Id, 0)
                + childrenByParentId[unit.Id].Sum(ComputeTotal);
            totalMemberCounts[unit.Id] = total;
            return total;
        }
        foreach (var topLevel in childrenByParentId[null])
        {
            ComputeTotal(topLevel);
        }

        IReadOnlyList<OrgUnit> roots;
        if (rootId.HasValue)
        {
            if (!orgLookup.TryGetValue(rootId.Value, out var root))
            {
                return new WorkforceOrgUnitTreeDto([]);
            }

            roots = [root];
        }
        else
        {
            roots = childrenByParentId[null]
                .OrderBy(unit => unit.Name)
                .ToList();
        }

        var normalizedMaxDepth = Math.Clamp(maxDepth, 1, 25);
        var nodes = roots
            .Select(root => BuildOrgUnitTreeNode(root, childrenByParentId, orgLookup, directMemberCounts, totalMemberCounts, 0, normalizedMaxDepth))
            .ToList();

        return new WorkforceOrgUnitTreeDto(nodes);
    }

    private async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> BuildSummariesAsync(
        IReadOnlyCollection<Employee> employees,
        EmployeeReadAudience audience,
        CancellationToken cancellationToken)
    {
        if (employees.Count == 0) return [];

        var settings = await tenantSettingsReadService.GetCurrentAsync(cancellationToken);
        var employeeIds = employees.Select(e => e.Id).ToArray();
        var now = DateTime.UtcNow;

        // Active Employment facts (for isActive status, hire date, employment type)
        var employmentFacts = await dbContext.Employments
            .AsNoTracking()
            .Where(e => employeeIds.Contains(e.EmployeeId)
                && e.EffectiveFrom <= now && (e.EffectiveTo == null || now < e.EffectiveTo))
            .Select(e => new { e.EmployeeId, e.EffectiveFrom, e.EmploymentType })
            .ToListAsync(cancellationToken);
        var employmentByEmployee = employmentFacts
            .GroupBy(e => e.EmployeeId)
            .ToDictionary(g => g.Key, g => g.First());
        var activeEmployeeIds = employmentByEmployee.Keys.ToHashSet();

        // Primary WorkAssignment facts (org unit, job title, work location)
        var primaryAssignments = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(wa => employeeIds.Contains(wa.EmployeeId)
                && wa.IsPrimary
                && wa.EffectiveFrom <= now && (wa.EffectiveTo == null || now < wa.EffectiveTo))
            .Select(wa => new { wa.EmployeeId, wa.OrgUnitId, wa.JobTitle, wa.WorkLocation })
            .ToListAsync(cancellationToken);
        var assignmentByEmployee = primaryAssignments
            .GroupBy(wa => wa.EmployeeId)
            .ToDictionary(g => g.Key, g => g.First());

        // Direct report counts via primary ManagerRelationship
        var directReportCounts = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(m => employeeIds.Contains(m.ManagerEmployeeId)
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= now && (m.EffectiveTo == null || now < m.EffectiveTo))
            .GroupBy(m => m.ManagerEmployeeId)
            .Select(g => new { ManagerId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.ManagerId, g => g.Count, cancellationToken);

        // Manager links via primary ManagerRelationship
        var managerLinks = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(m => employeeIds.Contains(m.SubjectEmployeeId)
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= now && (m.EffectiveTo == null || now < m.EffectiveTo))
            .Select(m => new { m.SubjectEmployeeId, m.ManagerEmployeeId })
            .ToListAsync(cancellationToken);
        var managerIdByEmployee = managerLinks
            .GroupBy(m => m.SubjectEmployeeId)
            .ToDictionary(g => g.Key, g => g.First().ManagerEmployeeId);

        // Manager identity and active status
        var uniqueManagerIds = managerIdByEmployee.Values.Distinct().ToList();
        Dictionary<Guid, Employee> managerLookup = [];
        HashSet<Guid> activeManagerIds = [];
        if (uniqueManagerIds.Count > 0)
        {
            managerLookup = await dbContext.Employees
                .AsNoTracking()
                .Where(e => uniqueManagerIds.Contains(e.Id))
                .ToDictionaryAsync(e => e.Id, cancellationToken);

            activeManagerIds = (await dbContext.Employments
                .AsNoTracking()
                .Where(e => uniqueManagerIds.Contains(e.EmployeeId)
                    && e.EffectiveFrom <= now && (e.EffectiveTo == null || now < e.EffectiveTo))
                .Select(e => e.EmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken))
                .ToHashSet();
        }

        var orgUnits = await dbContext.OrgUnits.AsNoTracking().ToListAsync(cancellationToken);
        var orgLookup = orgUnits.ToDictionary(u => u.Id);

        return employees.Select(employee =>
        {
            var directReportCount = directReportCounts.GetValueOrDefault(employee.Id);
            var assignment = assignmentByEmployee.GetValueOrDefault(employee.Id);
            var isActive = activeEmployeeIds.Contains(employee.Id);
            var hireDate = employmentByEmployee.TryGetValue(employee.Id, out var emp) ? emp.EffectiveFrom : default;
            var employmentType = emp?.EmploymentType;
            var jobTitle = CanViewSummaryField(settings, "jobTitle", audience) ? assignment?.JobTitle : null;

            // Manager summary
            WorkforceManagerSummaryDto? managerSummary = null;
            if (managerIdByEmployee.TryGetValue(employee.Id, out var canonicalManagerId)
                && managerLookup.TryGetValue(canonicalManagerId, out var canonicalManager))
            {
                managerSummary = new WorkforceManagerSummaryDto(
                    canonicalManager.Id,
                    !string.IsNullOrWhiteSpace(canonicalManager.PreferredName)
                        ? $"{canonicalManager.PreferredName} {canonicalManager.LastName}"
                        : canonicalManager.FullName,
                    canonicalManager.Email,
                    activeManagerIds.Contains(canonicalManager.Id));
            }

            // Canonical hierarchy status
            var hierarchyStatus = ResolveCanonicalHierarchyStatus(
                employee.Id, managerIdByEmployee, managerLookup, activeManagerIds, directReportCount);

            // Canonical readiness
            var readiness = BuildCanonicalReadiness(
                employee, settings, assignment?.OrgUnitId, assignment?.JobTitle, assignment?.WorkLocation,
                employmentType, isActive, hierarchyStatus, directReportCount);

            return new WorkforceEmployeeSummaryDto(
                employee.Id,
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                employee.FirstName,
                employee.LastName,
                employee.PreferredName,
                employee.DisplayName,
                employee.FullName,
                employee.Email,
                jobTitle,
                hireDate,
                isActive ? EmployeeStatus.Active.ToString() : EmployeeStatus.Inactive.ToString(),
                isActive,
                BuildOrgAssignment(assignment?.OrgUnitId, orgLookup),
                managerSummary,
                directReportCount,
                BuildDataQuality(readiness),
                employee.Version);
        }).ToList();
    }

    private static string ResolveCanonicalHierarchyStatus(
        Guid employeeId,
        IReadOnlyDictionary<Guid, Guid> managerIdByEmployee,
        IReadOnlyDictionary<Guid, Employee> managerLookup,
        IReadOnlySet<Guid> activeManagerIds,
        int directReportCount)
    {
        if (!managerIdByEmployee.TryGetValue(employeeId, out var managerId))
        {
            return directReportCount > 0
                ? EmployeeHierarchyStatuses.Root
                : EmployeeHierarchyStatuses.NoManagerAssigned;
        }

        if (!managerLookup.ContainsKey(managerId)) return EmployeeHierarchyStatuses.ManagerMissing;
        return activeManagerIds.Contains(managerId)
            ? EmployeeHierarchyStatuses.Healthy
            : EmployeeHierarchyStatuses.ManagerInactive;
    }

    private static EmployeeReadinessSummaryDto BuildCanonicalReadiness(
        Employee employee,
        TenantSettingsDto settings,
        Guid? orgUnitId,
        string? jobTitle,
        string? workLocation,
        string? employmentType,
        bool isActive,
        string hierarchyStatus,
        int directReportCount)
    {
        var stateIssues = new List<EmployeeReadinessIssueDto>();

        // Required field checks on identity fields (still on Employee entity)
        AddFieldIssueIfMissing(stateIssues, employee, settings, "firstName", !string.IsNullOrWhiteSpace(employee.FirstName),
            EmployeeReadinessFixTargetKinds.ProfileIdentity, "First name is required");
        AddFieldIssueIfMissing(stateIssues, employee, settings, "lastName", !string.IsNullOrWhiteSpace(employee.LastName),
            EmployeeReadinessFixTargetKinds.ProfileIdentity, "Last name is required");
        AddFieldIssueIfMissing(stateIssues, employee, settings, "email", !string.IsNullOrWhiteSpace(employee.Email),
            EmployeeReadinessFixTargetKinds.ProfileIdentity, "Work email is required");
        AddFieldIssueIfMissing(stateIssues, employee, settings, "phone", !string.IsNullOrWhiteSpace(employee.Phone),
            EmployeeReadinessFixTargetKinds.ProfileIdentity, "Phone is required");

        // Hire date: satisfied by having an active Employment record
        AddFieldIssueIfMissing(stateIssues, employee, settings, "hireDate", isActive,
            EmployeeReadinessFixTargetKinds.ProfileEmployment, "Hire date is required");

        // Workforce fields from canonical WorkAssignment / Employment
        AddFieldIssueIfMissing(stateIssues, employee, settings, "jobTitle", !string.IsNullOrWhiteSpace(jobTitle),
            EmployeeReadinessFixTargetKinds.ProfileEmployment, "Job title is required");
        AddFieldIssueIfMissing(stateIssues, employee, settings, "workLocation", !string.IsNullOrWhiteSpace(workLocation),
            EmployeeReadinessFixTargetKinds.ProfileEmployment, "Work location is required");
        AddFieldIssueIfMissing(stateIssues, employee, settings, "employmentType", !string.IsNullOrWhiteSpace(employmentType),
            EmployeeReadinessFixTargetKinds.ProfileEmployment, "Employment type is required");

        // Org unit
        if (!orgUnitId.HasValue)
        {
            stateIssues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.MissingOrgUnit, "Org unit is missing",
                EmployeeReadinessIssueSeverities.Attention, "orgUnitId",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileOrganization, employee.Id, employee.StableEmployeeKey, FieldKey: "orgUnitId")));
        }

        // Manager hierarchy
        if (hierarchyStatus is EmployeeHierarchyStatuses.NoManagerAssigned
            or EmployeeHierarchyStatuses.ManagerInactive
            or EmployeeHierarchyStatuses.ManagerMissing)
        {
            var (code, label) = hierarchyStatus switch
            {
                EmployeeHierarchyStatuses.ManagerInactive => (EmployeeReadinessIssueCodes.ManagerInactive, "Assigned manager is inactive"),
                EmployeeHierarchyStatuses.ManagerMissing => (EmployeeReadinessIssueCodes.ManagerMissing, "Manager record is missing"),
                _ => (EmployeeReadinessIssueCodes.NoManagerAssigned, "Manager is missing"),
            };
            stateIssues.Add(new EmployeeReadinessIssueDto(
                code, label, EmployeeReadinessIssueSeverities.Attention, "managerId",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ReportingRelationships, employee.Id, employee.StableEmployeeKey, FieldKey: "managerId")));
        }

        // Blocking issues: termination blocked by active direct reports
        List<EmployeeReadinessIssueDto> blockingIssues = [];
        if (isActive && directReportCount > 0)
        {
            blockingIssues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.DeactivationBlocked,
                directReportCount == 1
                    ? "Employee cannot be terminated while 1 active direct report remains"
                    : $"Employee cannot be terminated while {directReportCount} active direct reports remain",
                EmployeeReadinessIssueSeverities.Blocker, null,
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileStatus, employee.Id, employee.StableEmployeeKey)));
        }

        return new EmployeeReadinessSummaryDto(stateIssues.Count, blockingIssues.Count, stateIssues, blockingIssues);
    }

    private static void AddFieldIssueIfMissing(
        List<EmployeeReadinessIssueDto> issues,
        Employee employee,
        TenantSettingsDto settings,
        string fieldKey,
        bool hasValue,
        string fixTargetKind,
        string label)
    {
        if (hasValue) return;
        if (!settings.EmployeeFieldConfig.TryGetValue(fieldKey, out var config) || !config.Required) return;

        issues.Add(new EmployeeReadinessIssueDto(
            EmployeeReadinessIssueCodes.MissingRequiredField, label,
            EmployeeReadinessIssueSeverities.Attention, fieldKey,
            new EmployeeReadinessFixTargetDto(fixTargetKind, employee.Id, employee.StableEmployeeKey, FieldKey: fieldKey)));
    }

    private static bool CanViewSummaryField(
        TenantSettingsDto settings,
        string fieldName,
        EmployeeReadAudience audience)
    {
        if (!settings.EmployeeFieldConfig.TryGetValue(fieldName, out var config)) return true;
        return audience switch
        {
            EmployeeReadAudience.HrAdmin => config.Visible,
            EmployeeReadAudience.Manager => config.Visible && config.VisibleToManager,
            EmployeeReadAudience.Employee => config.Visible && config.VisibleToEmployee,
            _ => false,
        };
    }

    private async Task<IQueryable<Employee>> ApplyVisibilityScopeAsync(
        IQueryable<Employee> query,
        WorkforceAccessContext access,
        CancellationToken cancellationToken)
    {
        if (access.IsHrAdmin)
        {
            return query;
        }

        if (!access.LinkedEmployeeId.HasValue)
        {
            return query.Where(_ => false);
        }

        if (access.IsManager)
        {
            var linkedEmployeeId = access.LinkedEmployeeId.Value;
            var now = DateTime.UtcNow;
            var reportIds = await dbContext.ManagerRelationships
                .AsNoTracking()
                .Where(m => m.ManagerEmployeeId == linkedEmployeeId
                    && m.Type == ReportingRelationshipType.PrimaryManager
                    && m.EffectiveFrom <= now
                    && (m.EffectiveTo == null || now < m.EffectiveTo))
                .Select(m => m.SubjectEmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken);

            var visibleIds = new HashSet<Guid>(reportIds) { linkedEmployeeId };
            return query.Where(employee => visibleIds.Contains(employee.Id));
        }

        return query.Where(employee => employee.Id == access.LinkedEmployeeId.Value);
    }

    private static WorkforceDataQualityDto BuildDataQuality(EmployeeReadinessSummaryDto readiness)
    {
        var issueCodes = readiness.EmployeeStateIssues
            .Concat(readiness.BlockingIssues)
            .Select(issue => issue.Code)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var state = readiness.HasBlockingIssues
            ? "Blocked"
            : readiness.HasEmployeeStateIssues
                ? "NeedsAttention"
                : "Ready";

        return new WorkforceDataQualityDto(
            state,
            readiness.HasEmployeeStateIssues,
            readiness.HasBlockingIssues,
            issueCodes);
    }

    private WorkforceOrgAssignmentDto? BuildOrgAssignment(
        Guid? orgUnitId,
        IReadOnlyDictionary<Guid, OrgUnit> orgLookup)
    {
        if (!orgUnitId.HasValue || !orgLookup.TryGetValue(orgUnitId.Value, out var orgUnit))
        {
            return null;
        }

        return new WorkforceOrgAssignmentDto(
            orgUnit.Id,
            orgUnit.Code,
            orgUnit.Name,
            orgUnit.Type,
            orgUnit.ParentId.HasValue && orgLookup.TryGetValue(orgUnit.ParentId.Value, out var parent)
                ? parent.Code
                : null,
            BuildOrgPath(orgUnit, orgLookup),
            GetOrgLevel(orgUnit, orgLookup),
            orgUnit.IsActive);
    }

    private WorkforceOrgUnitSummaryDto BuildOrgUnitSummary(
        OrgUnit orgUnit,
        IReadOnlyDictionary<Guid, OrgUnit> orgLookup)
        => new(
            orgUnit.Id,
            orgUnit.Code,
            orgUnit.Name,
            orgUnit.Type,
            orgUnit.ParentId.HasValue && orgLookup.TryGetValue(orgUnit.ParentId.Value, out var parent)
                ? parent.Code
                : null,
            BuildOrgPath(orgUnit, orgLookup),
            GetOrgLevel(orgUnit, orgLookup),
            orgUnit.IsActive);

    private WorkforceOrgUnitTreeNodeDto BuildOrgUnitTreeNode(
        OrgUnit orgUnit,
        ILookup<Guid?, OrgUnit> childrenByParentId,
        IReadOnlyDictionary<Guid, OrgUnit> orgLookup,
        IReadOnlyDictionary<Guid, int> directMemberCounts,
        IReadOnlyDictionary<Guid, int> totalMemberCounts,
        int depth,
        int maxDepth)
    {
        var childUnits = childrenByParentId[orgUnit.Id]
            .OrderBy(child => child.Name)
            .ToList();
        var children = depth + 1 >= maxDepth || childUnits.Count == 0
            ? []
            : childUnits
                .Select(child => BuildOrgUnitTreeNode(child, childrenByParentId, orgLookup, directMemberCounts, totalMemberCounts, depth + 1, maxDepth))
                .ToList();

        return new WorkforceOrgUnitTreeNodeDto(
            orgUnit.Id,
            orgUnit.Code,
            orgUnit.Name,
            orgUnit.Type,
            orgUnit.ParentId.HasValue && orgLookup.TryGetValue(orgUnit.ParentId.Value, out var parent)
                ? parent.Code
                : null,
            BuildOrgPath(orgUnit, orgLookup),
            GetOrgLevel(orgUnit, orgLookup),
            orgUnit.IsActive,
            directMemberCounts.GetValueOrDefault(orgUnit.Id, 0),
            totalMemberCounts.GetValueOrDefault(orgUnit.Id, 0),
            children);
    }

    private async Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> LoadWorkforceAccountStatusesAsync(
        IReadOnlyCollection<Employee> employees,
        CancellationToken cancellationToken)
    {
        if (employees.Count == 0)
        {
            return new Dictionary<Guid, WorkforceAccountStatusDto>();
        }

        return await workforceAccountStatusReader.GetStatusesAsync(
            employees.Where(employee => employee.Email is not null).Select(employee => new WorkforceAccountSubjectDto(
                employee.Id,
                employee.Email!,
                employee.FirstName,
                employee.LastName)).ToList(),
            cancellationToken);
    }

    private async Task<(List<Employee> Employees, IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> Statuses)>
        LoadMatchingAccessSubjectEmployeesAsync(
            string? search,
            string? access,
            Guid? profileId,
            string? employeeStatus,
            string? deliveryState,
            string? employeeKey,
            string? baseline,
            Guid? cohort,
            Guid? orgUnitId,
            bool includeDescendants,
            CancellationToken cancellationToken)
    {
        var query = ApplyAccessSubjectFilters(
            dbContext.Employees
                .AsNoTracking()
                .AsQueryable(),
            search,
            employeeKey);
        var scope = await ResolveRosterScopeAsync(cohort, orgUnitId, includeDescendants, cancellationToken);
        if (scope is not null)
        {
            query = query.Where(current => scope.Contains(current.Id));
        }
        var normalizedAccess = NormalizeAccessFilter(access);
        var normalizedDeliveryState = NormalizeDeliveryStateFilter(deliveryState);
        var requiresAccountFiltering =
            normalizedAccess is not null
            || profileId.HasValue
            || normalizedDeliveryState is not null;

        var candidateEmployees = await query
            .OrderBy(current => current.LastName)
            .ThenBy(current => current.FirstName)
            .ToListAsync(cancellationToken);

        var statuses = await LoadWorkforceAccountStatusesAsync(candidateEmployees, cancellationToken);
        var summaries = await BuildAccessSubjectSummariesAsync(candidateEmployees, statuses, cancellationToken);
        var allowedEmployeeIds = summaries
            .Where(summary =>
                MatchesStatusFilter(summary, employeeStatus)
                && MatchesBaselineFilter(summary, baseline)
                && (!requiresAccountFiltering || MatchesAccessFilters(
                    statuses.GetValueOrDefault(summary.EmployeeId),
                    normalizedAccess,
                    profileId,
                    normalizedDeliveryState)))
            .Select(summary => summary.EmployeeId)
            .ToHashSet();

        return (candidateEmployees.Where(employee => allowedEmployeeIds.Contains(employee.Id)).ToList(), statuses);
    }

    private async Task<IReadOnlyList<WorkforceAccessSubjectSummaryDto>> BuildAccessSubjectSummariesAsync(
        IReadOnlyCollection<Employee> employees,
        IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> statuses,
        CancellationToken cancellationToken)
    {
        if (employees.Count == 0)
        {
            return [];
        }

        var directReportCounts = await LoadDirectReportCountsAsync(
            employees.Select(employee => employee.Id).ToList(),
            cancellationToken);
        var employeeIds = employees.Select(employee => employee.Id).ToList();
        var activeEmployeeIdSet = (await dbContext.Employments
                .AsNoTracking()
                .Where(employment => employeeIds.Contains(employment.EmployeeId)
                    && employment.Status == EmploymentStatus.Active
                    && employment.EffectiveTo == null)
                .Select(employment => employment.EmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var now = DateTime.UtcNow;
        var assignmentRows = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(assignment => employeeIds.Contains(assignment.EmployeeId)
                && assignment.IsPrimary
                && assignment.EffectiveFrom <= now
                && (assignment.EffectiveTo == null || now < assignment.EffectiveTo))
            .Select(assignment => new
            {
                assignment.EmployeeId,
                assignment.OrgUnitId,
                assignment.JobTitle,
                assignment.WorkLocation,
            })
            .ToListAsync(cancellationToken);
        var orgUnitIds = assignmentRows.Select(assignment => assignment.OrgUnitId).Distinct().ToList();
        var orgUnitNames = await dbContext.OrgUnits
            .AsNoTracking()
            .Where(unit => orgUnitIds.Contains(unit.Id))
            .ToDictionaryAsync(unit => unit.Id, unit => unit.Name, cancellationToken);
        var assignments = assignmentRows.ToDictionary(
            assignment => assignment.EmployeeId,
            assignment => new
            {
                assignment.JobTitle,
                assignment.WorkLocation,
                OrgUnitName = orgUnitNames.GetValueOrDefault(assignment.OrgUnitId),
            });

        return employees
            .Select(employee => BuildAccessSubjectSummary(
                employee,
                statuses.GetValueOrDefault(employee.Id),
                directReportCounts.GetValueOrDefault(employee.Id),
                activeEmployeeIdSet.Contains(employee.Id),
                assignments.GetValueOrDefault(employee.Id)?.JobTitle,
                assignments.GetValueOrDefault(employee.Id)?.OrgUnitName,
                assignments.GetValueOrDefault(employee.Id)?.WorkLocation))
            .ToList();
    }

    private static IQueryable<Employee> ApplyAccessSubjectFilters(
        IQueryable<Employee> query,
        string? search,
        string? employeeKey)
    {
        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchTerm = search.Trim().ToLowerInvariant();
            query = query.Where(current =>
                current.FirstName.ToLower().Contains(searchTerm) ||
                current.LastName.ToLower().Contains(searchTerm) ||
                (current.Email != null && current.Email.ToLower().Contains(searchTerm)) ||
                current.EmployeeNumber.ToLower().Contains(searchTerm) ||
                (current.FirstName + " " + current.LastName).ToLower().Contains(searchTerm));
        }

        if (!string.IsNullOrWhiteSpace(employeeKey))
        {
            var normalizedEmployeeKey = employeeKey.Trim();
            query = query.Where(current => current.StableEmployeeKey == normalizedEmployeeKey);
        }

        return query;
    }

    /// <summary>
    /// Resolves the set of Employee ids the roster is restricted to when an import cohort
    /// and/or an Organization scope is applied. Returns <c>null</c> when no scope restricts
    /// the roster (the whole workforce). Each scope is tenant-isolated by the ambient query
    /// filter, and the two scopes intersect when both are present. A cohort that resolves to
    /// no members yields an empty set, so the roster shows exactly that cohort — never the
    /// full workforce as a silent fallback.
    /// </summary>
    private async Task<HashSet<Guid>?> ResolveRosterScopeAsync(
        Guid? cohort,
        Guid? orgUnitId,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        HashSet<Guid>? scope = null;

        if (cohort is { } batchId)
        {
            var keys = await ResolveImportCohortKeysAsync(batchId, cancellationToken);
            scope = keys.Length == 0
                ? []
                : (await dbContext.Employees
                    .AsNoTracking()
                    .Where(employee => keys.Contains(employee.StableEmployeeKey))
                    .Select(employee => employee.Id)
                    .ToListAsync(cancellationToken)).ToHashSet();
        }

        if (orgUnitId is { } unitId)
        {
            var targetOrgUnitIds = await ResolveOrgUnitScopeAsync(new[] { unitId }, includeDescendants, cancellationToken);
            var now = DateTime.UtcNow;
            var memberIds = targetOrgUnitIds.Count == 0
                ? []
                : (await dbContext.WorkAssignments
                    .AsNoTracking()
                    .Where(assignment => targetOrgUnitIds.Contains(assignment.OrgUnitId)
                        && assignment.IsPrimary
                        && assignment.EffectiveFrom <= now
                        && (assignment.EffectiveTo == null || now < assignment.EffectiveTo))
                    .Select(assignment => assignment.EmployeeId)
                    .Distinct()
                    .ToListAsync(cancellationToken)).ToHashSet();
            scope = scope is null ? memberIds : scope.Intersect(memberIds).ToHashSet();
        }

        return scope;
    }

    private Task<string[]> ResolveImportCohortKeysAsync(Guid importBatchId, CancellationToken cancellationToken)
        => dbContext.Employments.AsNoTracking()
            .Where(employment => employment.ImportBatchId == importBatchId)
            .Join(dbContext.Employees.AsNoTracking(), employment => employment.EmployeeId, employee => employee.Id, (_, employee) => employee.StableEmployeeKey)
            .Distinct()
            .ToArrayAsync(cancellationToken);

    /// <summary>
    /// The Employee/Manager baseline is the reviewed recommendation: a person with direct
    /// reports is recommended Manager, everyone else Employee. The filter mirrors that so the
    /// roster and the selection preview agree on what "all Managers" or "all Employees" means.
    /// </summary>
    private static bool MatchesBaselineFilter(WorkforceAccessSubjectSummaryDto summary, string? baseline)
    {
        if (string.IsNullOrWhiteSpace(baseline))
        {
            return true;
        }

        return baseline.Trim().ToLowerInvariant() switch
        {
            "manager" => summary.DirectReportCount > 0,
            "employee" => summary.DirectReportCount == 0,
            _ => true,
        };
    }

    private async Task<Dictionary<Guid, int>> LoadDirectReportCountsAsync(
        IReadOnlyCollection<Guid> employeeIds,
        CancellationToken cancellationToken)
    {
        if (employeeIds.Count == 0)
        {
            return [];
        }

        var now = DateTime.UtcNow;
        return await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(relationship => employeeIds.Contains(relationship.ManagerEmployeeId)
                && relationship.Type == ReportingRelationshipType.PrimaryManager
                && relationship.EffectiveFrom <= now
                && (relationship.EffectiveTo == null || now < relationship.EffectiveTo))
            .GroupBy(relationship => relationship.ManagerEmployeeId)
            .Select(group => new { ManagerId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(group => group.ManagerId, group => group.Count, cancellationToken);
    }

    private WorkforceAccessSubjectSummaryDto BuildAccessSubjectSummary(
        Employee employee,
        WorkforceAccountStatusDto? account,
        int directReportCount,
        bool isActive,
        string? jobTitle,
        string? orgUnitName,
        string? workLocation)
    {
        var accessState = ClassifyAccessState(account);

        return new WorkforceAccessSubjectSummaryDto(
            employee.Id,
            employee.StableEmployeeKey,
            employee.EmployeeNumber,
            employee.FirstName,
            employee.LastName,
            employee.PreferredName,
            employee.DisplayName,
            employee.Email,
            jobTitle,
            orgUnitName,
            workLocation,
            isActive ? EmployeeStatus.Active.ToString() : EmployeeStatus.Inactive.ToString(),
            isActive,
            directReportCount,
            accessState,
            GetAccessStateLabel(accessState),
            GetAccessStateDetail(account),
            account?.AccessProfiles
                .Select(profile => new WorkforceAccessProfileSummaryDto(profile.Id, profile.Name))
                .ToList()
                ?? [],
            GetInvitationLabel(account),
            GetLastActivityLabel(account),
            GetLastActivityAt(account),
            account?.DeliveryStatus,
            GetReviewReason(account),
            account?.ProvisioningState ?? "Unprovisioned",
            account?.UserId);
    }

    private static string ClassifyAccessState(WorkforceAccountStatusDto? account)
    {
        if (account is null || string.Equals(account.ProvisioningState, "Unprovisioned", StringComparison.OrdinalIgnoreCase))
        {
            return AccessStateNotInvited;
        }

        if (string.Equals(account.ProvisioningState, "Active", StringComparison.OrdinalIgnoreCase))
        {
            return AccessStateActiveAccount;
        }

        if (string.Equals(account.ProvisioningState, "InvitePending", StringComparison.OrdinalIgnoreCase)
            && account.AccessProfiles.Count > 0)
        {
            return AccessStateInvitePending;
        }

        // A provisioned account that has been deactivated is a suspended workforce account:
        // the account, membership, binding, and profiles are preserved and it can be restored.
        if (string.Equals(account.ProvisioningState, "Inactive", StringComparison.OrdinalIgnoreCase))
        {
            return AccessStateSuspended;
        }

        return AccessStateNeedsReview;
    }

    private static string GetAccessStateLabel(string accessState)
    {
        return accessState switch
        {
            AccessStateNotInvited => "Not invited",
            AccessStateInvitePending => "Invite pending",
            AccessStateActiveAccount => "Active account",
            AccessStateSuspended => "Suspended",
            _ => "Needs review",
        };
    }

    private static string? GetAccessStateDetail(WorkforceAccountStatusDto? account)
    {
        if (account is null)
        {
            return null;
        }

        if (!string.Equals(
                ClassifyAccessState(account),
                AccessStateNeedsReview,
                StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return GetReviewReason(account);
    }

    private static string GetInvitationLabel(WorkforceAccountStatusDto? account)
    {
        if (account is null || string.Equals(account.ProvisioningState, "Unprovisioned", StringComparison.OrdinalIgnoreCase))
        {
            return "Not sent";
        }

        if (string.Equals(account.ProvisioningState, "InvitePending", StringComparison.OrdinalIgnoreCase))
        {
            return "Pending";
        }

        return account.ProvisioningState switch
        {
            "InviteExpired" => "Expired",
            "InviteRevoked" => "Revoked",
            "InviteAccepted" => "Accepted",
            "Active" => "Accepted",
            _ => GetIssueSummary(account),
        };
    }

    private static string GetLastActivityLabel(WorkforceAccountStatusDto? account)
    {
        if (account?.LastLoginAt is not null)
            return FormatDateLabel(account.LastLoginAt, "Activated");

        return "No activity";
    }

    private static DateTime? GetLastActivityAt(WorkforceAccountStatusDto? account)
        => account?.LastLoginAt;

    private static string? GetReviewReason(WorkforceAccountStatusDto? account)
    {
        if (account is null)
        {
            return null;
        }

        if (account.Conflict is not null && !string.IsNullOrWhiteSpace(account.Conflict.Message))
        {
            return account.Conflict.Message;
        }

        if (string.Equals(account.ProvisioningState, "InvitePending", StringComparison.OrdinalIgnoreCase)
            && account.AccessProfiles.Count == 0)
        {
            return "Choose an access profile before continuing.";
        }

        return account.ProvisioningState switch
        {
            "Inactive" => "This account is inactive.",
            "InviteExpired" => "Invite expired",
            "InviteRevoked" => "Invitation revoked",
            "InviteAccepted" => "The invitation was accepted, but activation is not complete.",
            _ => null,
        };
    }

    private static string GetIssueSummary(WorkforceAccountStatusDto account)
    {
        if (account.Conflict is not null && !string.IsNullOrWhiteSpace(account.Conflict.Message))
        {
            return account.Conflict.Message;
        }

        return account.ProvisioningState switch
        {
            "Inactive" => "Account inactive",
            "InviteExpired" => "Invitation expired",
            "InviteRevoked" => "Invitation revoked",
            "InviteAccepted" => "Activation incomplete",
            _ => "Needs review",
        };
    }

    private static bool MatchesAccessFilters(
        WorkforceAccountStatusDto? account,
        string? access,
        Guid? profileId,
        string? deliveryState)
    {
        if (access is not null && !string.Equals(ClassifyAccessState(account), access, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (profileId.HasValue)
        {
            var hasProfile = account?.AccessProfiles.Any(profile => profile.Id == profileId.Value) == true;
            if (!hasProfile)
            {
                return false;
            }
        }

        if (deliveryState is not null
            && !string.Equals(account?.DeliveryStatus, deliveryState, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    private static string? NormalizeAccessFilter(string? access)
    {
        if (string.IsNullOrWhiteSpace(access))
        {
            return null;
        }

        var normalized = access.Trim();
        return normalized switch
        {
            "NotInvited" => AccessStateNotInvited,
            "InvitePending" => AccessStateInvitePending,
            "ActiveAccount" => AccessStateActiveAccount,
            "NeedsReview" => AccessStateNeedsReview,
            _ => null,
        };
    }

    private static string? NormalizeDeliveryStateFilter(string? deliveryState)
    {
        if (string.IsNullOrWhiteSpace(deliveryState))
        {
            return null;
        }

        var normalized = deliveryState.Trim();
        return normalized is "Sent" or "Suppressed" or "Failed"
            ? normalized
            : null;
    }

    private static bool MatchesStatusFilter(WorkforceAccessSubjectSummaryDto summary, string? employeeStatus)
    {
        if (!TryParseEmployeeStatusFilter(employeeStatus, out var status))
        {
            return true;
        }

        return status switch
        {
            EmployeeStatus.Active => summary.IsActive,
            EmployeeStatus.Inactive => !summary.IsActive,
            _ => true,
        };
    }

    private static bool TryParseEmployeeStatusFilter(string? employeeStatus, out EmployeeStatus status)
    {
        status = default;

        if (string.IsNullOrWhiteSpace(employeeStatus))
        {
            return false;
        }

        if (!Enum.TryParse<EmployeeStatus>(employeeStatus.Trim(), true, out var parsedStatus))
        {
            return false;
        }

        status = parsedStatus;
        return true;
    }

    private static string FormatDateLabel(DateTime? value, string prefix)
    {
        if (!value.HasValue)
        {
            return prefix;
        }

        return $"{prefix} {value.Value:MMM d}";
    }

    private static string BuildOrgPath(OrgUnit orgUnit, IReadOnlyDictionary<Guid, OrgUnit> orgLookup)
    {
        var segments = new List<string>();
        OrgUnit? current = orgUnit;
        var guard = new HashSet<Guid>();

        while (current is not null && guard.Add(current.Id))
        {
            segments.Add(current.Name);
            current = current.ParentId.HasValue && orgLookup.TryGetValue(current.ParentId.Value, out var parent)
                ? parent
                : null;
        }

        segments.Reverse();
        return string.Join(" / ", segments);
    }

    private static int GetOrgLevel(OrgUnit orgUnit, IReadOnlyDictionary<Guid, OrgUnit> orgLookup)
    {
        var level = 0;
        var currentParentId = orgUnit.ParentId;
        var guard = new HashSet<Guid>();

        while (currentParentId.HasValue && guard.Add(currentParentId.Value) && orgLookup.TryGetValue(currentParentId.Value, out var parent))
        {
            level += 1;
            currentParentId = parent.ParentId;
        }

        return level;
    }

    private static WorkforceAccessContext BuildAccessContext(ClaimsPrincipal user)
    {
        var isTenantReader =
            user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.Tenant);
        var isDirectReportReader = !isTenantReader
            && (user.HasCorePermission(CorePermissions.TeamView, PermissionScopes.DirectReports)
                || user.HasCorePermission(CorePermissions.EmployeeView, PermissionScopes.DirectReports));

        return new WorkforceAccessContext(
            isTenantReader,
            isDirectReportReader,
            user.GetEmployeeId(),
            isTenantReader
                ? EmployeeReadAudience.HrAdmin
                : isDirectReportReader
                    ? EmployeeReadAudience.Manager
                    : EmployeeReadAudience.Employee);
    }

    private sealed record WorkforceAccessContext(
        bool IsHrAdmin,
        bool IsManager,
        Guid? LinkedEmployeeId,
        EmployeeReadAudience Audience);
}
