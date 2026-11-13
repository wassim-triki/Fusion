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
    string? PhotoUrl = null,
    WorkforceLeaveSnapshot? Leave = null)
{
    /// <summary>The current employment's type from Core HR's list (Full-time, Contractor, …); null when unset.</summary>
    public string? EmploymentType { get; init; }
    /// <summary>The held job's family and level from the company's lists (<see cref="JobCatalogue"/>); null when unset.</summary>
    public Guid? JobFamilyId { get; init; }
    public Guid? LevelId { get; init; }
}

/// <summary>Core HR's job families and levels in their order, and which family-level pairs its live jobs use.</summary>
public sealed record JobCatalogue(IReadOnlyList<JobCatalogueValue> Families, IReadOnlyList<JobCatalogueValue> Levels, IReadOnlyList<JobFamilyLevel> Jobs)
{
    /// <summary>The levels a family's jobs use, lowest first.</summary>
    public IReadOnlyList<JobCatalogueValue> LevelsOf(Guid familyId)
    {
        var used = Jobs.Where(job => job.FamilyId == familyId).Select(job => job.LevelId).ToHashSet();
        return Levels.Where(level => used.Contains(level.Id)).OrderBy(level => level.SortOrder).ToArray();
    }

    /// <summary>The level after <paramref name="levelId"/> among the family's, or null at the top.</summary>
    public JobCatalogueValue? NextLevel(Guid familyId, Guid levelId)
    {
        var levels = LevelsOf(familyId);
        var at = levels.ToList().FindIndex(level => level.Id == levelId);
        return at >= 0 && at + 1 < levels.Count ? levels[at + 1] : null;
    }
}

public sealed record JobCatalogueValue(Guid Id, string Label, int SortOrder);

public sealed record JobFamilyLevel(Guid FamilyId, Guid LevelId, string Title);

/// <summary>Leave the person is on today (<paramref name="Now"/>), or their next; Performance shows it and pauses nothing.</summary>
public sealed record WorkforceLeaveSnapshot(DateOnly From, DateOnly? Until, DateOnly? Back, bool Now);

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
