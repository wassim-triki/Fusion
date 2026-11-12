namespace EY.HRPlatform.Performance.Models;

/// <summary>A unit the Insights filter offers: the population's units and their parents, with their depth.</summary>
public sealed record InsightsUnitOptionDto(Guid UnitId, string Name, int Depth);

/// <summary>A year Insights can show: every year that has started, newest first.</summary>
public sealed record InsightsYearDto(Guid CycleId, string Name, DateOnly StartDate, DateOnly EndDate);

/// <summary>One point of a line: a day of the year shown and its figure.</summary>
public sealed record InsightsPointDto(DateOnly Date, decimal Value);

/// <summary>
/// One figure this year against last on the same days (D-80, D-90). Key: <c>on-track</c> (share of goals, %),
/// <c>at-risk</c> (goals at risk or off track; AtRisk and OffTrack split it), <c>not-updated</c> (people with an approved
/// plan and no update in 30 days), <c>supporting</c> (share of goals under a company goal, %). Of: what a share is out of.
/// Last-year points carry this year's dates (last year's day plus the gap between the two starts).
/// </summary>
public sealed record InsightsTrendDto(string Key, decimal Now, int? Of, int? AtRisk, int? OffTrack, decimal? LastNow,
    IReadOnlyList<InsightsPointDto> This, IReadOnlyList<InsightsPointDto>? Last);

/// <summary>A department's share (goals on track during the year, goals met at its end) against last year's.</summary>
public sealed record InsightsUnitFigureDto(Guid? UnitId, string Name, int People, int Goals, decimal Share, decimal? LastShare);

public sealed record InsightsPersonRefDto(Guid EmployeeId, string Name);

/// <summary>A manager's people with an approved plan and no update in 30 days, to nudge.</summary>
public sealed record InsightsManagerNudgeDto(Guid ManagerId, string Name, int People, IReadOnlyList<InsightsPersonRefDto> NotUpdated);

public sealed record InsightsRatingDto(int Value, string Label, int Count, int? LastCount);

/// <summary>How a year's goals ended: met (graded in full), partly, not met, and carried into the next year's drafts.</summary>
public sealed record InsightsGoalsEndDto(int Met, int Partly, int NotMet, int Carried);

/// <summary>People rated at the strong level or above by time at the company (Core HR's start date): share of the rated.</summary>
public sealed record InsightsTenureDto(string Key, int People, int Rated, decimal? Share, decimal? LastShare);

public sealed record InsightsCarriedGoalDto(Guid ObjectiveId, Guid CycleId, string Title, Guid OwnerId, string OwnerName, decimal Progress);

public sealed record InsightsMonthDto(int Year, int Month, int Count, int? LastCount);

/// <summary>A point of the reviews' line: days since the round opened and the share of manager reviews done.</summary>
public sealed record InsightsDayPointDto(int Day, decimal Share);

public sealed record InsightsReviewsDto(DateOnly OpenedOn, DateOnly? ResultsOn, int Reviews, IReadOnlyList<InsightsDayPointDto> This,
    IReadOnlyList<InsightsDayPointDto>? Last);

/// <summary>How the year ended (D-89): read once its results are out.</summary>
public sealed record InsightsEndDto(string? StrongLabel, IReadOnlyList<InsightsRatingDto> Ratings, InsightsGoalsEndDto Goals, InsightsGoalsEndDto? LastGoals,
    IReadOnlyList<InsightsUnitFigureDto> MetByDepartment, IReadOnlyList<InsightsTenureDto> ByTenure, InsightsReviewsDto? Reviews,
    IReadOnlyList<InsightsMonthDto> Updates, IReadOnlyList<InsightsCarriedGoalDto> Carried, int CarriedCount);

/// <summary>
/// Insights › Performance for year administrators (D-88–D-90): a year against the one before, during the year and at its
/// end, scoped to a unit and everything below it. Counts and shares only, no averages. NextYear: the year after, when one
/// exists (Launched once it is live), so an ended year offers setting it up.
/// </summary>
public sealed record InsightsDto(
    Guid CycleId, string Name, DateOnly StartDate, DateOnly EndDate, DateOnly AsOf, bool Ended, int Participants,
    InsightsYearDto? LastYear, InsightsYearDto? NextYear, bool NextYearLaunched, IReadOnlyList<InsightsYearDto> Years,
    Guid? UnitId, string ScopeName, IReadOnlyList<InsightsUnitOptionDto> Units,
    IReadOnlyList<InsightsTrendDto> Trends, IReadOnlyList<InsightsUnitFigureDto> OnTrackByDepartment,
    IReadOnlyList<InsightsManagerNudgeDto> NotUpdatedByManager, InsightsEndDto? End);

/// <summary>One person behind a figure, with where the administrator opens them.</summary>
public sealed record InsightsPersonDto(Guid EmployeeId, string Name, string? JobTitle, string? UnitName, string? ManagerName, string? Href);

public sealed record InsightsPeoplePageDto(string Metric, int Total, int Page, int PageSize, IReadOnlyList<InsightsPersonDto> Items);
