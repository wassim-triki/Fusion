namespace EY.HRPlatform.Performance.Infrastructure.Core;

/// <summary>
/// The subset of the Core internal workforce-snapshot contract Performance consumes. These
/// shapes mirror Core's <c>internal/corehr/workforce/snapshots</c> responses; Performance
/// reads workforce/organization truth only through this signed internal contract and never
/// touches Core's database or rebuilds its hierarchy.
/// </summary>
public sealed record WorkforceSnapshot(
    Guid EmployeeId,
    string StableEmployeeKey,
    string FullName,
    string DisplayName,
    string? WorkEmail,
    string? JobTitle,
    bool IsActive,
    WorkforceOrgSnapshot? OrgUnit,
    WorkforceManagerSnapshot? Manager,
    DateOnly? EmploymentStart = null,
    string? PhotoUrl = null);

public sealed record WorkforceOrgSnapshot(Guid OrgUnitId, string Name);

public sealed record WorkforceManagerSnapshot(Guid EmployeeId, string DisplayName, bool IsActive);

public sealed record WorkforceOrgUnitContext(
    Guid OrgUnitId,
    string Name,
    Guid? ParentOrgUnitId,
    bool IsActive,
    IReadOnlyList<Guid> AncestorOrgUnitIds);

// Request bodies sent to Core's internal snapshot endpoints.
public sealed record WorkforceResolveRequest(DateTime AsOf, IReadOnlyList<Guid> EmployeeIds);

public sealed record WorkforceByScopeRequest(
    DateTime AsOf,
    IReadOnlyList<Guid> OrgUnitIds,
    bool IncludeDescendants = true,
    bool IncludeInactive = false);

public sealed record WorkforceAllActiveRequest(DateTime AsOf, bool IncludeInactive = false);

public sealed record WorkforceOrgUnitResolveRequest(DateTime AsOf, IReadOnlyList<Guid> OrgUnitIds);

public sealed record WorkforceDirectReportsRequest(DateTime AsOf, IReadOnlyList<Guid> ManagerEmployeeIds);

public sealed record WorkforceSearchRequest(DateTime AsOf, string Term, int Limit);
