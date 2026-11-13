using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Insights;

/// <summary>Insights › Performance for a year (the latest started one when none is named), scoped to a unit and below.</summary>
public sealed record GetInsightsQuery(Guid? CycleId, Guid? UnitId) : IQuery<Result<InsightsDto>>;

/// <summary>The people behind one Insights figure, paged. Department and Bucket narrow a by-department or by-tenure figure.</summary>
public sealed record GetInsightsPeopleQuery(Guid? CycleId, string Metric, Guid? UnitId, Guid? DepartmentId, Guid? ManagerId, int? Level,
    string? Bucket, int Page, int PageSize) : IQuery<Result<InsightsPeoplePageDto>>;

/// <summary>
/// The facts Insights counts for one year, read inside the tenant filter by a caller the controller has checked
/// administers years: the frozen population, approved plans and their goals, every check-in (so any past day can be
/// replayed), the latest launched round's reviews, and the goals carried into a later year.
/// </summary>
internal static class InsightsData
{
    public const int RecentDays = 30;

    public sealed record Goal(Guid Id, Guid OwnerId, string Title, bool Supporting, ObjectiveStatus? Status,
        DateTime? LastCheckInAt, decimal Grade, decimal Progress, bool Carried);

    public sealed record CheckIn(Guid ObjectiveId, ObjectiveStatus? Status, DateTime RecordedAt);

    public sealed record Review(Guid Id, Guid ReviewerId, string ReviewerName, DateTime? ManagerSubmittedAt, int? FinalRating, bool Released);

    public sealed record Person(Guid EmployeeId, string Name, string? JobTitle, Guid? UnitId, string UnitName, Guid? ManagerId, string? ManagerName,
        Guid? PlanId, DateTime? ApprovedAt, IReadOnlyList<Goal> Goals, Review? Review)
    {
        public bool Approved => ApprovedAt is not null;
    }

    public sealed record Year(PerformanceCycle Cycle, IReadOnlyList<Person> People, ILookup<Guid, CheckIn> CheckIns, ReviewRound? Round,
        IReadOnlyList<RatingScaleLevel> Scale, bool Ended)
    {
        public IEnumerable<Goal> Goals => People.SelectMany(p => p.Goals);
    }

    /// <summary>The year named, else the latest that has started; never a draft.</summary>
    public static async Task<PerformanceCycle?> PickAsync(PerformanceDbContext db, Guid? cycleId, CancellationToken token)
    {
        var started = db.Cycles.AsNoTracking().Where(c => c.State != CycleLifecycleState.Draft);
        if (cycleId is Guid id) return await started.FirstOrDefaultAsync(c => c.Id == id, token);
        var today = PerformanceClock.Today;
        return await started.Where(c => c.StartDate <= today).OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token)
            ?? await started.OrderBy(c => c.StartDate).FirstOrDefaultAsync(token);
    }

    public static async Task<Year> LoadAsync(PerformanceDbContext db, PerformanceCycle cycle, CancellationToken token)
    {
        var cycleId = cycle.Id;
        var participants = await db.Participants.AsNoTracking().Where(p => p.CycleId == cycleId)
            .Select(p => new { p.EmployeeId, p.DisplayName, p.JobTitle, p.OrgUnitId, p.OrgUnitName, p.ManagerEmployeeId, p.ManagerDisplayName })
            .ToListAsync(token);
        var plans = (await db.EmployeePlans.AsNoTracking().Where(p => p.CycleId == cycleId)
                .Select(p => new { p.Id, p.EmployeeId, p.State, p.ApprovedAt }).ToListAsync(token))
            .GroupBy(p => p.EmployeeId).ToDictionary(g => g.Key, g => g.First());

        var objectives = await db.Objectives.AsNoTracking()
            .Where(o => o.CycleId == cycleId && o.State != ObjectiveLifecycleState.Archived).ToListAsync(token);
        var byId = objectives.ToDictionary(o => o.Id);
        bool Supporting(Objective objective)
        {
            var seen = new HashSet<Guid>();
            var current = objective;
            while (current.ParentObjectiveId is Guid parentId && seen.Add(parentId) && byId.TryGetValue(parentId, out var parent))
            {
                if (parent.OwnershipScope == ObjectiveOwnershipScope.Company) return true;
                current = parent;
            }
            return false;
        }
        var ids = objectives.Select(o => o.Id).ToList();
        var carried = (await db.Objectives.AsNoTracking()
                .Where(o => o.CycleId != cycleId && o.CarriedFromObjectiveId != null)
                .Select(o => o.CarriedFromObjectiveId!.Value).ToListAsync(token))
            .Where(ids.Contains).ToHashSet();

        var approvedPlans = plans.Values.Where(p => p.State == PlanLifecycleState.Approved).Select(p => p.Id).ToHashSet();
        var goalsByPlan = objectives.Where(o => o.EmployeePlanId is Guid plan && approvedPlans.Contains(plan))
            .GroupBy(o => o.EmployeePlanId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(o => new Goal(o.Id, o.AccountablePersonId, o.Title, Supporting(o), o.CurrentStatus,
                o.LastCheckInAt, GoalGrades.Of(o), o.HasProgress ? o.DerivedProgress : 0m, carried.Contains(o.Id))).ToList());

        var checkIns = (await db.ProgressUpdates.AsNoTracking().Where(u => u.CycleId == cycleId)
                .Select(u => new CheckIn(u.ObjectiveId, u.Status, u.RecordedAt)).ToListAsync(token))
            .ToLookup(c => c.ObjectiveId);

        var round = await db.ReviewRounds.AsNoTracking().Where(r => r.CycleId == cycleId && r.LaunchedAt != null)
            .OrderByDescending(r => r.LaunchedAt).FirstOrDefaultAsync(token);
        var reviews = new Dictionary<Guid, Review>();
        IReadOnlyList<RatingScaleLevel> scale = [];
        if (round is not null)
        {
            var rows = await db.PerformanceReviews.AsNoTracking()
                .Where(r => r.ReviewRoundId == round.Id && r.State != PerformanceReviewState.Closed)
                .Select(r => new
                {
                    r.Id, r.SubjectEmployeeId, r.ReviewerEmployeeId, r.ReviewerDisplayName, r.State,
                    r.ManagerAssessment.SubmittedAt, r.FinalRating, r.RatingScaleSnapshotJson,
                })
                .ToListAsync(token);
            foreach (var r in rows)
                reviews[r.SubjectEmployeeId] = new Review(r.Id, r.ReviewerEmployeeId, r.ReviewerDisplayName, r.SubmittedAt, r.FinalRating,
                    r.State == PerformanceReviewState.Finalized);
            scale = rows.Select(r => r.RatingScaleSnapshotJson).FirstOrDefault() is string json
                ? JsonSerializer.Deserialize<RatingScaleLevel[]>(json) ?? []
                : [];
        }

        var people = participants.Select(p =>
        {
            var plan = plans.GetValueOrDefault(p.EmployeeId);
            var approved = plan is not null && plan.State == PlanLifecycleState.Approved;
            return new Person(p.EmployeeId, p.DisplayName, p.JobTitle, p.OrgUnitId, p.OrgUnitName ?? "No unit", p.ManagerEmployeeId,
                p.ManagerDisplayName, plan?.Id, approved ? plan!.ApprovedAt ?? DateTime.MinValue : null,
                approved ? goalsByPlan.GetValueOrDefault(plan!.Id) ?? [] : [], reviews.GetValueOrDefault(p.EmployeeId));
        }).ToList();

        var ended = cycle.State == CycleLifecycleState.Closed || reviews.Values.Any(r => r.Released);
        return new Year(cycle, people, checkIns, round, scale, ended);
    }

    /// <summary>The unit structure the filter and the departments read: names, depth, and the department each unit sits in.</summary>
    public sealed class Units(Dictionary<Guid, string> names, Dictionary<Guid, IReadOnlyList<Guid>> ancestors)
    {
        public int Depth(Guid unit) => ancestors.GetValueOrDefault(unit)?.Count ?? 0;
        public string Name(Guid unit) => names.GetValueOrDefault(unit) ?? "Unit";

        /// <summary>Departments sit at the top, or one level below when the company is one unit at the top.</summary>
        private int DepartmentDepth => names.Keys.Count(u => Depth(u) == 0) == 1 ? 1 : 0;

        /// <summary>The department that holds this unit; the unit itself at or above the departments' level.</summary>
        public Guid Department(Guid unit)
        {
            var level = DepartmentDepth;
            if (Depth(unit) <= level) return unit;
            var found = ancestors[unit].FirstOrDefault(a => Depth(a) == level);
            return found != Guid.Empty ? found : unit;
        }

        public bool Within(Guid unit, Guid filter) => unit == filter || (ancestors.GetValueOrDefault(unit)?.Contains(filter) ?? false);

        public IReadOnlyList<InsightsUnitOptionDto> Options => names
            .Select(n => new InsightsUnitOptionDto(n.Key, n.Value, Depth(n.Key))).OrderBy(o => o.Depth).ThenBy(o => o.Name).ToList();
    }

    public static Task<Units> UnitsAsync(ICoreWorkforceClient workforce, IEnumerable<Person> people, CancellationToken token)
        => UnitsAsync(workforce, people.Select(p => (p.UnitId, (string?)p.UnitName)), token);

    /// <summary>The units people sit in, with the ones above them; each unit stands alone when Core HR is down.</summary>
    public static async Task<Units> UnitsAsync(ICoreWorkforceClient workforce, IEnumerable<(Guid? UnitId, string? UnitName)> people, CancellationToken token)
    {
        var list = people.ToList();
        var populationUnits = list.Where(p => p.UnitId is not null).Select(p => p.UnitId!.Value).Distinct().ToList();
        IReadOnlyList<WorkforceOrgUnitContext> contexts = [];
        try
        {
            if (populationUnits.Count > 0)
            {
                contexts = await workforce.ResolveOrgUnitsAsync(PerformanceClock.UtcNow, populationUnits, token);
                var above = contexts.SelectMany(c => c.AncestorOrgUnitIds).Distinct().Except(populationUnits).ToList();
                if (above.Count > 0) contexts = [.. contexts, .. await workforce.ResolveOrgUnitsAsync(PerformanceClock.UtcNow, above, token)];
            }
        }
        catch (HttpRequestException)
        {
            // Core HR down: each unit stands alone, named from the population.
            contexts = [];
        }
        var names = list.Where(p => p.UnitId is not null).GroupBy(p => p.UnitId!.Value).ToDictionary(g => g.Key, g => g.First().UnitName ?? "Unit");
        foreach (var context in contexts) names[context.OrgUnitId] = context.Name;
        var ancestors = contexts.GroupBy(c => c.OrgUnitId).ToDictionary(g => g.Key, g => g.First().AncestorOrgUnitIds);
        return new Units(names, ancestors);
    }

    public static bool InScope(Person person, Units units, Guid? filter)
        => filter is not Guid unit || (person.UnitId is Guid own && units.Within(own, unit));

    /// <summary>A goal's state on a day: its latest check-in by then; today and after, its state now.</summary>
    public static ObjectiveStatus? StatusOn(Year year, Goal goal, DateTime at, DateTime now)
        => at >= now ? goal.Status : year.CheckIns[goal.Id].Where(c => c.RecordedAt <= at).MaxBy(c => c.RecordedAt)?.Status;

    public static DateTime? LastUpdateBy(Year year, Person person, DateTime at, DateTime now)
        => at >= now ? person.Goals.Max(g => g.LastCheckInAt)
            : person.Goals.SelectMany(g => year.CheckIns[g.Id]).Where(c => c.RecordedAt <= at).Max(c => (DateTime?)c.RecordedAt);

    /// <summary>People with an approved plan by the day and no check-in in the 30 days before it.</summary>
    public static bool NotUpdated(Year year, Person person, DateTime at, DateTime now)
        => person.Approved && person.ApprovedAt <= at && !(LastUpdateBy(year, person, at, now) >= at.AddDays(-RecentDays));

    public static bool Strong(Year year, int rating) => year.Scale.Count >= 2
        ? rating >= year.Scale.OrderByDescending(l => l.Value).ElementAt(1).Value
        : year.Scale.Count == 1 && rating >= year.Scale[0].Value;

    public static string Ending(Goal goal) => goal.Carried ? "carried" : goal.Grade >= 1m ? "met" : goal.Grade > 0m ? "partly" : "not-met";

    /// <summary>Time at the company on the year's last day (or today), in the buckets the chart draws.</summary>
    public static string? Bucket(DateOnly? start, DateOnly on)
    {
        if (start is not DateOnly first) return null;
        var years = (on.DayNumber - first.DayNumber) / 365.25;
        return years < 1 ? "under-1" : years < 2 ? "1-2" : years < 4 ? "2-4" : years < 6 ? "4-6" : "over-6";
    }

    public static readonly string[] Buckets = ["under-1", "1-2", "2-4", "4-6", "over-6"];

    public static async Task<IReadOnlyDictionary<Guid, WorkforceSnapshot>> WorkforceAsync(ICoreWorkforceClient workforce,
        IReadOnlyCollection<Guid> employeeIds, CancellationToken token)
    {
        if (employeeIds.Count == 0) return new Dictionary<Guid, WorkforceSnapshot>();
        try
        {
            return (await workforce.ResolveAsync(PerformanceClock.UtcNow, employeeIds, token))
                .GroupBy(s => s.EmployeeId).ToDictionary(g => g.Key, g => g.First());
        }
        catch (HttpRequestException)
        {
            return new Dictionary<Guid, WorkforceSnapshot>();
        }
    }

    /// <summary>The year before: the latest started year that ended before this one began.</summary>
    public static Task<PerformanceCycle?> YearBeforeAsync(PerformanceDbContext db, PerformanceCycle cycle, CancellationToken token)
        => db.Cycles.AsNoTracking().Where(c => c.State != CycleLifecycleState.Draft && c.Id != cycle.Id && c.StartDate < cycle.StartDate)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);
}

/// <summary>
/// Insights › Performance (D-88–D-90): during the year, four figures against last year on the same days, on track by
/// department and the people to nudge by manager; once results are out, how the year ended (D-89). Counts and shares
/// only, never averages.
/// </summary>
public sealed class GetInsightsHandler(PerformanceDbContext db, ICoreWorkforceClient workforceClient)
    : IQueryHandler<GetInsightsQuery, Result<InsightsDto>>
{
    public async Task<Result<InsightsDto>> Handle(GetInsightsQuery request, CancellationToken cancellationToken)
    {
        var cycle = await InsightsData.PickAsync(db, request.CycleId, cancellationToken);
        if (cycle is null)
            return request.CycleId is Guid id
                ? Result.Failure<InsightsDto>(PerformanceErrors.NotFound("Cycle", id))
                : Result.Failure<InsightsDto>(PerformanceErrors.NotFound("Cycle", Guid.Empty));

        var year = await InsightsData.LoadAsync(db, cycle, cancellationToken);
        var lastCycle = await InsightsData.YearBeforeAsync(db, cycle, cancellationToken);
        var last = lastCycle is null ? null : await InsightsData.LoadAsync(db, lastCycle, cancellationToken);
        var units = await InsightsData.UnitsAsync(workforceClient, year.People.Concat(last?.People ?? []), cancellationToken);
        var people = year.People.Where(p => InsightsData.InScope(p, units, request.UnitId)).ToList();
        var lastPeople = last?.People.Where(p => InsightsData.InScope(p, units, request.UnitId)).ToList() ?? [];

        var now = PerformanceClock.UtcNow;
        var today = PerformanceClock.Today;
        var asOf = today < cycle.EndDate ? today : cycle.EndDate;
        var shift = lastCycle is null ? 0 : cycle.StartDate.DayNumber - lastCycle.StartDate.DayNumber;

        // Days to replay: each month's end from the start, and the last day shown.
        var days = new List<DateOnly>();
        for (var d = new DateOnly(cycle.StartDate.Year, cycle.StartDate.Month, 1).AddMonths(1).AddDays(-1); d < asOf; d = d.AddDays(1).AddMonths(1).AddDays(-1))
            if (d >= cycle.StartDate) days.Add(d);
        days.Add(asOf);

        var trends = new List<InsightsTrendDto>();
        if (cycle.StartDate <= today)
        {
            InsightsTrendDto Trend(string key, Func<InsightsData.Year, IReadOnlyList<InsightsData.Person>, DateTime, decimal> figure, Func<int>? of = null,
                int? atRisk = null, int? offTrack = null)
            {
                var points = days.Select(d => new InsightsPointDto(d, figure(year, people, End(d)))).ToList();
                List<InsightsPointDto>? lastPoints = null;
                if (last is not null)
                    lastPoints = days.Select(d => (d, at: d.AddDays(-shift))).Where(x => x.at <= last.Cycle.EndDate)
                        .Select(x => new InsightsPointDto(x.d, figure(last, lastPeople, End(x.at)))).ToList();
                return new InsightsTrendDto(key, points[^1].Value, of?.Invoke(), atRisk, offTrack, lastPoints is { Count: > 0 } ? lastPoints[^1].Value : null,
                    points, lastPoints);
            }
            DateTime End(DateOnly d) => d >= today ? now : d.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc);
            // A plan's goals count from the day it was approved (the clock stamps approvals; it doesn't stamp creation).
            IEnumerable<(InsightsData.Person Person, InsightsData.Goal Goal)> GoalsBy(IReadOnlyList<InsightsData.Person> group, DateTime at)
                => group.Where(p => p.Approved && p.ApprovedAt <= at).SelectMany(p => p.Goals.Select(g => (p, g)));
            decimal Share(int count, int total) => total == 0 ? 0m : decimal.Round(count * 100m / total, 0);

            var currentGoals = GoalsBy(people, now).ToList();
            trends.Add(Trend("on-track", (y, g, at) =>
            {
                var goals = GoalsBy(g, at).ToList();
                return Share(goals.Count(x => InsightsData.StatusOn(y, x.Goal, at, now) == ObjectiveStatus.OnTrack), goals.Count);
            }, () => currentGoals.Count));
            trends.Add(Trend("at-risk", (y, g, at) => GoalsBy(g, at)
                    .Count(x => InsightsData.StatusOn(y, x.Goal, at, now) is ObjectiveStatus.AtRisk or ObjectiveStatus.OffTrack),
                atRisk: currentGoals.Count(x => x.Goal.Status == ObjectiveStatus.AtRisk),
                offTrack: currentGoals.Count(x => x.Goal.Status == ObjectiveStatus.OffTrack)));
            trends.Add(Trend("not-updated", (y, g, at) => g.Count(p => InsightsData.NotUpdated(y, p, at, now)),
                () => people.Count(p => p.Approved)));
            trends.Add(Trend("supporting", (y, g, at) =>
            {
                var goals = GoalsBy(g, at).ToList();
                return Share(goals.Count(x => x.Goal.Supporting), goals.Count);
            }, () => currentGoals.Count));
        }

        // Departments: this year's share against last year's on the same day (on track) or at its end (met).
        IReadOnlyList<InsightsUnitFigureDto> ByDepartment(Func<InsightsData.Year, InsightsData.Goal, DateTime, bool> counts, DateTime at, DateTime lastAt)
        {
            Guid? Dept(InsightsData.Person p) => p.UnitId is Guid unit ? units.Department(unit) : null;
            var lastByDept = lastPeople.Where(p => p.Approved).GroupBy(Dept).ToDictionary(g => g.Key ?? Guid.Empty, g => g.SelectMany(p => p.Goals).ToList());
            return people.GroupBy(Dept).Select(g =>
            {
                var goals = g.Where(p => p.Approved).SelectMany(p => p.Goals).ToList();
                var lastGoals = lastByDept.GetValueOrDefault(g.Key ?? Guid.Empty);
                return new InsightsUnitFigureDto(g.Key, g.Key is Guid id ? units.Name(id) : "No unit", g.Count(), goals.Count,
                    goals.Count == 0 ? 0m : decimal.Round(goals.Count(x => counts(year, x, at)) * 100m / goals.Count, 0),
                    last is null || lastGoals is not { Count: > 0 } ? null
                        : decimal.Round(lastGoals.Count(x => counts(last, x, lastAt)) * 100m / lastGoals.Count, 0));
            }).Where(d => d.Goals > 0).OrderByDescending(d => d.People).ThenBy(d => d.Name).ToList();
        }

        var lastSameDay = last is null ? now : asOf.AddDays(-shift).ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc);
        var onTrack = cycle.StartDate <= today
            ? ByDepartment((y, g, at) => InsightsData.StatusOn(y, g, at, now) == ObjectiveStatus.OnTrack, now, lastSameDay)
            : [];

        var byManager = people.Where(p => InsightsData.NotUpdated(year, p, now, now))
            .GroupBy(p => (p.ManagerId ?? Guid.Empty, p.ManagerName ?? "No manager"))
            .Select(g => new InsightsManagerNudgeDto(g.Key.Item1, g.Key.Item2, people.Count(p => (p.ManagerId ?? Guid.Empty) == g.Key.Item1),
                g.OrderBy(p => p.Name).Select(p => new InsightsPersonRefDto(p.EmployeeId, p.Name)).ToList()))
            .OrderByDescending(m => m.NotUpdated.Count).ThenBy(m => m.Name).ToList();

        var end = year.Ended ? await EndAsync(year, last, people, lastPeople, ByDepartment, cancellationToken) : null;

        var years = await db.Cycles.AsNoTracking().Where(c => c.State != CycleLifecycleState.Draft).OrderByDescending(c => c.StartDate)
            .Select(c => new InsightsYearDto(c.Id, c.Name, c.StartDate, c.EndDate)).ToListAsync(cancellationToken);
        var next = await db.Cycles.AsNoTracking().Where(c => c.Id != cycle.Id && c.StartDate > cycle.StartDate)
            .OrderBy(c => c.StartDate).FirstOrDefaultAsync(cancellationToken);
        return Result.Success(new InsightsDto(
            cycle.Id, cycle.Name, cycle.StartDate, cycle.EndDate, asOf, year.Ended, people.Count,
            lastCycle is null ? null : new InsightsYearDto(lastCycle.Id, lastCycle.Name, lastCycle.StartDate, lastCycle.EndDate),
            next is null ? null : new InsightsYearDto(next.Id, next.Name, next.StartDate, next.EndDate), next is { State: not CycleLifecycleState.Draft },
            years, request.UnitId is Guid unitId ? unitId : null, request.UnitId is Guid scoped ? units.Name(scoped) : "Everyone", units.Options,
            trends, onTrack, byManager, end));
    }

    private async Task<InsightsEndDto> EndAsync(InsightsData.Year year, InsightsData.Year? last,
        IReadOnlyList<InsightsData.Person> people, IReadOnlyList<InsightsData.Person> lastPeople,
        Func<Func<InsightsData.Year, InsightsData.Goal, DateTime, bool>, DateTime, DateTime, IReadOnlyList<InsightsUnitFigureDto>> byDepartment,
        CancellationToken token)
    {
        var scale = year.Scale.Count > 0 ? year.Scale : last?.Scale ?? [];
        int Rated(IReadOnlyList<InsightsData.Person> group, int value) => group.Count(p => p.Review is { Released: true } r && r.FinalRating == value);
        var ratings = scale.OrderBy(l => l.Value)
            .Select(l => new InsightsRatingDto(l.Value, l.Label, Rated(people, l.Value), last is null ? null : Rated(lastPeople, l.Value))).ToList();

        static InsightsGoalsEndDto Ends(IEnumerable<InsightsData.Goal> goals)
        {
            var list = goals.Select(InsightsData.Ending).ToList();
            return new InsightsGoalsEndDto(list.Count(e => e == "met"), list.Count(e => e == "partly"), list.Count(e => e == "not-met"), list.Count(e => e == "carried"));
        }
        var goals = people.SelectMany(p => p.Goals).ToList();

        var met = byDepartment((_, g, _) => InsightsData.Ending(g) == "met", DateTime.MaxValue, DateTime.MaxValue);

        // Time at the company from Core HR, ratings from Performance.
        var workforce = await InsightsData.WorkforceAsync(workforceClient,
            people.Select(p => p.EmployeeId).Concat(lastPeople.Select(p => p.EmployeeId)).Distinct().ToList(), token);
        decimal? StrongShare(InsightsData.Year y, IEnumerable<InsightsData.Person> group)
        {
            var rated = group.Where(p => p.Review is { Released: true, FinalRating: not null }).ToList();
            return rated.Count == 0 ? null : decimal.Round(rated.Count(p => InsightsData.Strong(y, p.Review!.FinalRating!.Value)) * 100m / rated.Count, 0);
        }
        string? BucketOf(InsightsData.Year y, InsightsData.Person p)
            => InsightsData.Bucket(workforce.GetValueOrDefault(p.EmployeeId)?.EmploymentStart, y.Cycle.EndDate);
        var tenure = InsightsData.Buckets.Select(b =>
        {
            var inBucket = people.Where(p => BucketOf(year, p) == b).ToList();
            return new InsightsTenureDto(b, inBucket.Count, inBucket.Count(p => p.Review is { Released: true, FinalRating: not null }),
                StrongShare(year, inBucket), last is null ? null : StrongShare(last, lastPeople.Where(p => BucketOf(last, p) == b)));
        }).Where(t => t.People > 0).ToList();

        // Manager reviews done, day by day from the round's opening to results out.
        InsightsReviewsDto? reviews = null;
        if (year.Round is { } round)
        {
            var opened = round.OpensOn ?? DateOnly.FromDateTime(round.LaunchedAt!.Value);
            IReadOnlyList<InsightsDayPointDto> Line(InsightsData.Year y, IEnumerable<InsightsData.Person> group, DateOnly from)
            {
                var due = group.Where(p => p.Review is not null).Select(p => p.Review!).ToList();
                if (due.Count == 0) return [];
                var done = due.Where(r => r.ManagerSubmittedAt is not null).Select(r => DateOnly.FromDateTime(r.ManagerSubmittedAt!.Value).DayNumber - from.DayNumber)
                    .OrderBy(d => d).ToList();
                var lastDay = Math.Max(done.LastOrDefault(), 0);
                var line = new List<InsightsDayPointDto>();
                for (var day = 0; day <= lastDay + 7; day += 7)
                    line.Add(new InsightsDayPointDto(day, decimal.Round(done.Count(d => d <= day) * 100m / due.Count, 0)));
                return line;
            }
            IReadOnlyList<InsightsDayPointDto>? lastLine = null;
            if (last?.Round is { } lastRound)
                lastLine = Line(last, lastPeople, lastRound.OpensOn ?? DateOnly.FromDateTime(lastRound.LaunchedAt!.Value));
            reviews = new InsightsReviewsDto(opened, year.Cycle.ResultsOutOn, people.Count(p => p.Review is not null), Line(year, people, opened), lastLine);
        }

        // Goal updates each month of the year, against the same months of the one before.
        var shift = last is null ? 0 : year.Cycle.StartDate.DayNumber - last.Cycle.StartDate.DayNumber;
        var goalIds = goals.Select(g => g.Id).ToHashSet();
        var lastGoalIds = lastPeople.SelectMany(p => p.Goals).Select(g => g.Id).ToHashSet();
        var updates = new List<InsightsMonthDto>();
        for (var month = new DateOnly(year.Cycle.StartDate.Year, year.Cycle.StartDate.Month, 1); month <= year.Cycle.EndDate; month = month.AddMonths(1))
        {
            var from = month.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var to = month.AddMonths(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            int Count(InsightsData.Year y, HashSet<Guid> ids, DateTime a, DateTime b)
                => ids.Sum(id => y.CheckIns[id].Count(c => c.RecordedAt >= a && c.RecordedAt < b));
            updates.Add(new InsightsMonthDto(month.Year, month.Month, Count(year, goalIds, from, to),
                last is null ? null : Count(last, lastGoalIds, from.AddDays(-shift), to.AddDays(-shift))));
        }

        var carried = people.SelectMany(p => p.Goals.Where(g => g.Carried).Select(g => (p, g))).OrderBy(x => x.p.Name).ThenBy(x => x.g.Title).ToList();
        return new InsightsEndDto(scale.Count >= 2 ? scale.OrderByDescending(l => l.Value).ElementAt(1).Label : null,
            ratings, Ends(goals), last is null ? null : Ends(lastPeople.SelectMany(p => p.Goals)), met, tenure, reviews, updates,
            carried.Take(8).Select(x => new InsightsCarriedGoalDto(x.g.Id, year.Cycle.Id, x.g.Title, x.p.EmployeeId, x.p.Name, x.g.Progress)).ToList(),
            carried.Count);
    }
}

/// <summary>The people behind one Insights figure, paged on the server; each opens their page in Core HR.</summary>
public sealed class GetInsightsPeopleHandler(PerformanceDbContext db, ICoreWorkforceClient workforce)
    : IQueryHandler<GetInsightsPeopleQuery, Result<InsightsPeoplePageDto>>
{
    public const int MaxPageSize = 50;

    public static readonly IReadOnlySet<string> Metrics = new HashSet<string>
    {
        "people", "on-track", "at-risk", "not-updated", "supporting", "level", "strong", "met", "partly", "not-met", "carried",
        "reviews-done", "reviews-not-done",
    };

    public async Task<Result<InsightsPeoplePageDto>> Handle(GetInsightsPeopleQuery request, CancellationToken cancellationToken)
    {
        if (!Metrics.Contains(request.Metric) || (request.Metric == "level" && request.Level is null)
            || (request.Bucket is not null && !InsightsData.Buckets.Contains(request.Bucket)))
            return Result.Failure<InsightsPeoplePageDto>(PerformanceErrors.Validation("Insights.Invalid", "Choose a figure to open."));
        var cycle = await InsightsData.PickAsync(db, request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<InsightsPeoplePageDto>(PerformanceErrors.NotFound("Cycle", request.CycleId ?? Guid.Empty));
        var year = await InsightsData.LoadAsync(db, cycle, cancellationToken);
        var units = await InsightsData.UnitsAsync(workforce, year.People, cancellationToken);
        var now = PerformanceClock.UtcNow;

        var scoped = year.People.Where(p => InsightsData.InScope(p, units, request.UnitId)
            && (request.DepartmentId is not Guid dept || (p.UnitId is Guid unit && units.Department(unit) == dept))
            && (request.ManagerId is not Guid manager || p.ManagerId == manager)).ToList();
        IReadOnlyDictionary<Guid, WorkforceSnapshot> snapshots = request.Bucket is null
            ? new Dictionary<Guid, WorkforceSnapshot>()
            : await InsightsData.WorkforceAsync(workforce, scoped.Select(p => p.EmployeeId).ToList(), cancellationToken);
        bool Matches(InsightsData.Person p) => request.Metric switch
        {
            "people" => true,
            "on-track" => p.Goals.Any(g => g.Status == ObjectiveStatus.OnTrack),
            "at-risk" => p.Goals.Any(g => g.Status is ObjectiveStatus.AtRisk or ObjectiveStatus.OffTrack),
            "not-updated" => InsightsData.NotUpdated(year, p, now, now),
            "supporting" => p.Goals.Any(g => g.Supporting),
            "level" => p.Review is { Released: true } review && review.FinalRating == request.Level,
            "strong" => p.Review is { Released: true, FinalRating: int rating } && InsightsData.Strong(year, rating),
            "met" or "partly" or "not-met" or "carried" => p.Goals.Any(g => InsightsData.Ending(g) == request.Metric),
            "reviews-done" => p.Review?.ManagerSubmittedAt is not null,
            "reviews-not-done" => p.Review is { ManagerSubmittedAt: null },
            _ => false,
        };
        var matching = scoped
            .Where(p => Matches(p) && (request.Bucket is null
                || InsightsData.Bucket(snapshots.GetValueOrDefault(p.EmployeeId)?.EmploymentStart, cycle.EndDate) == request.Bucket))
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);
        var page = Math.Max(1, request.Page);
        var items = matching.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        var keys = request.Bucket is null
            ? await InsightsData.WorkforceAsync(workforce, items.Select(p => p.EmployeeId).ToList(), cancellationToken)
            : snapshots;
        return Result.Success(new InsightsPeoplePageDto(request.Metric, matching.Count, page, pageSize, items.Select(p => new InsightsPersonDto(
            p.EmployeeId, p.Name, p.JobTitle, p.UnitName, p.ManagerName,
            keys.GetValueOrDefault(p.EmployeeId) is { } snapshot ? $"/core/people/{Uri.EscapeDataString(snapshot.StableEmployeeKey)}?tab=performance" : null))
            .ToList()));
    }
}
