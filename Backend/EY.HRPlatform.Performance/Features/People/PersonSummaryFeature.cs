using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.People;

/// <summary>The caller's relation to the person, from the most permissive that applies.</summary>
public enum PersonRelation { Self, Manager, Reviewer, Administrator, Other }

public sealed record PersonSummaryObjectiveDto(Guid ObjectiveId, int Number, string Title, string? AlignedTo,
    decimal? Weight, decimal? Progress, string Href)
{
    /// <summary>The owner's latest reported status; null until reported, never assumed On track.</summary>
    public ObjectiveStatus? Status { get; init; }

    /// <summary>An update asked for and not yet given (the person page's Coming up, B-180).</summary>
    public PersonSummaryUpdateRequestDto? OpenRequest { get; init; }
}

public sealed record PersonSummaryUpdateRequestDto(string RequestedByName, DateTime RequestedAt);
public sealed record PersonSummaryCycleDto(Guid CycleId, string CycleName, CycleLifecycleState CycleState, CyclePhase? Phase,
    bool IsParticipant, Guid? PlanId, RosterPlanStatus? PlanStatus, decimal? OverallProgress, string? PlanHref,
    IReadOnlyList<PersonSummaryObjectiveDto> Objectives)
{
    /// <summary>Who decides the plan: its recorded reviewer, else the participant's manager.</summary>
    public string? ReviewerName { get; init; }
    /// <summary>The plan's allocated weight; null for a private Draft.</summary>
    public decimal? WeightTotal { get; init; }
    /// <summary>The latest check-in on an approved objective.</summary>
    public DateTime? LastUpdateAt { get; init; }
}
public sealed record PersonSummaryCurrentReviewDto(Guid ReviewId, string ReviewRoundName, PerformanceReviewState State,
    DateOnly? DueDate, bool SelfAssessmentEnabled, bool CalibrationEnabled, string Href)
{
    /// <summary>Who writes the manager assessment: who holds the review once the self-assessment is in.</summary>
    public string? ReviewerName { get; init; }
}
public sealed record PersonSummaryReviewResultDto(Guid ReviewId, string CycleName, string ReviewRoundName,
    string? FinalRatingLabel, DateTime? FinalizedAt, string Href);
public sealed record PersonSummaryDevelopmentGoalDto(string Title, string? CompetencyName,
    EY.HRPlatform.Performance.Domain.Development.DevelopmentGoalStatus Status, DateOnly? TargetDate);
/// <summary>The person's development goals for the summary's cycle, linking to the plan's Development section.</summary>
public sealed record PersonSummaryDevelopmentDto(IReadOnlyList<PersonSummaryDevelopmentGoalDto> Goals, string Href);
public sealed record PersonSummaryReviewsDto(PersonSummaryCurrentReviewDto? Current, IReadOnlyList<PersonSummaryReviewResultDto> History);

/// <summary>Praise the person received (D-14): public to every Performance entrant, newest first.</summary>
public sealed record PersonSummaryPraiseDto(IReadOnlyList<EY.HRPlatform.Performance.Features.Conversations.PraiseDto> Items, int Total, string Href);

/// <summary>Feedback the person received that the viewer may read: never manager-only feedback addressed to someone else.</summary>
public sealed record PersonSummaryFeedbackDto(IReadOnlyList<EY.HRPlatform.Performance.Features.Conversations.FeedbackDto> Items, int Total, string Href);

/// <summary>The viewer's active 1:1 series with the person; only ever present for the two people.</summary>
public sealed record PersonSummaryOneOnOneDto(Guid SeriesId, DateTime? NextMeetingAt, string Href);

/// <summary>
/// One person's performance as the caller may see it (D-32). Sections are null when hidden. An unknown
/// or foreign employee gets the same answer as an unseen one, without identity.
/// </summary>
public sealed record PersonPerformanceSummaryDto(Guid EmployeeId, string? DisplayName, string? JobTitle, string? OrgUnitName,
    string? StableEmployeeKey, PersonRelation Relation, PersonSummaryCycleDto? CurrentCycle, PersonSummaryReviewsDto? Reviews)
{
    /// <summary>Present under the development plan's own visibility (D-34), empty when no goals.</summary>
    public PersonSummaryDevelopmentDto? Development { get; init; }
    /// <summary>For every Performance entrant, whatever their relation.</summary>
    public PersonSummaryPraiseDto? Praise { get; init; }
    /// <summary>For the person, their current manager and cycle administrators, under feedback visibility.</summary>
    public PersonSummaryFeedbackDto? Feedback { get; init; }
    /// <summary>Only for the two people in an active series.</summary>
    public PersonSummaryOneOnOneDto? OneOnOne { get; init; }
}

public sealed record PersonSummaryViewer(Guid EmployeeId, bool ReviewsReports, bool Administers)
{
    /// <summary>Holds the own-participation grant that every self-authoring action needs.</summary>
    public bool ManagesOwnParticipation { get; init; } = true;
}

public sealed record GetPersonSummaryQuery(Guid EmployeeId, Guid? CycleId, PersonSummaryViewer Viewer)
    : IQuery<Result<PersonPerformanceSummaryDto>>;

public sealed class GetPersonSummaryHandler(PerformanceDbContext db, ICoreWorkforceClient workforce)
    : IQueryHandler<GetPersonSummaryQuery, Result<PersonPerformanceSummaryDto>>
{
    public async Task<Result<PersonPerformanceSummaryDto>> Handle(GetPersonSummaryQuery query, CancellationToken token)
    {
        var empty = new PersonPerformanceSummaryDto(query.EmployeeId, null, null, null, null, PersonRelation.Other, null, null);
        if (query.EmployeeId == Guid.Empty) return Result.Success(empty);

        // People belong to Core HR: the tenant-scoped snapshot is the only source of identity and reporting line.
        WorkforceSnapshot? person;
        try
        {
            person = (await workforce.ResolveAsync(PerformanceClock.UtcNow, [query.EmployeeId], token))
                .SingleOrDefault(p => p.EmployeeId == query.EmployeeId);
        }
        catch (HttpRequestException) { return Result.Failure<PersonPerformanceSummaryDto>(PerformanceErrors.CoreUnavailable()); }
        if (person is null) return Result.Success(empty);

        var cycle = await SelectCycleAsync(query.EmployeeId, query.CycleId, token);
        if (query.CycleId is not null && cycle is null) return Result.Success(empty);
        var plan = cycle is null ? null : await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == query.EmployeeId, token);

        var relation = Relate(query.Viewer, person, plan);
        var identity = empty with
        {
            DisplayName = person.DisplayName, JobTitle = person.JobTitle, OrgUnitName = person.OrgUnit?.Name,
            StableEmployeeKey = person.StableEmployeeKey, Relation = relation,
        };
        var development = cycle is null ? null : await DevelopmentAsync(cycle, query.EmployeeId, plan, query.Viewer, person, token);
        // Conversations belong to people, not cycles: these sections don't follow the selected cycle.
        identity = identity with
        {
            Praise = await PraiseAsync(query.EmployeeId, query.Viewer, token),
            Feedback = await FeedbackAsync(query.EmployeeId, query.Viewer, person, token),
            OneOnOne = await OneOnOneAsync(query.EmployeeId, query.Viewer.EmployeeId, token),
        };
        if (relation == PersonRelation.Other) return Result.Success(identity with { Development = development });

        return Result.Success(identity with
        {
            CurrentCycle = cycle is null ? null : await CycleSectionAsync(cycle, query.EmployeeId, plan, relation, token),
            Reviews = await ReviewsAsync(query.EmployeeId, token),
            Development = development,
        });
    }

    private const int SummaryItems = 5;

    private async Task<PersonSummaryPraiseDto> PraiseAsync(Guid employeeId, PersonSummaryViewer viewer, CancellationToken token)
    {
        var received = PraisePolicy.Readable(db.Praise.AsNoTracking()).Where(p => p.Recipients.Any(r => r.EmployeeId == employeeId));
        var latest = await received.OrderByDescending(p => p.GivenAt).Take(SummaryItems).ToListAsync(token);
        var actor = new EY.HRPlatform.Performance.Features.Conversations.PraiseActor(viewer.EmployeeId, viewer.Administers);
        return new PersonSummaryPraiseDto(await new EY.HRPlatform.Performance.Features.Conversations.PraiseReader(db).ProjectAsync(latest, actor, token),
            await received.CountAsync(token), $"/performance/feedback?tab=praise&employee={employeeId}");
    }

    /// <summary>The person, their current Core HR manager (with the direct-reports grant) and administrators; nobody else.</summary>
    private async Task<PersonSummaryFeedbackDto?> FeedbackAsync(Guid employeeId, PersonSummaryViewer viewer, WorkforceSnapshot person,
        CancellationToken token)
    {
        var me = viewer.EmployeeId;
        var self = me != Guid.Empty && me == employeeId;
        var manager = viewer.ReviewsReports && me != Guid.Empty && person.Manager?.EmployeeId == me;
        if (!self && !manager && !viewer.Administers) return null;
        var reader = FeedbackViewer.For(me, viewer.Administers, viewer.ReviewsReports,
            manager ? new HashSet<Guid> { employeeId } : new HashSet<Guid>());
        var received = FeedbackPolicy.Readable(db.Feedback.AsNoTracking(), reader).Where(f => f.ReceiverEmployeeId == employeeId);
        var latest = await received.OrderByDescending(f => f.SentAt).Take(SummaryItems).ToListAsync(token);
        var items = await new EY.HRPlatform.Performance.Features.Conversations.FeedbackReader(db, new Security.PerformanceViewer(db, workforce))
            .ProjectAsync(latest, reader, token);
        return new PersonSummaryFeedbackDto(items, await received.CountAsync(token),
            self ? "/performance/feedback" : "/performance/feedback?tab=team");
    }

    private async Task<PersonSummaryOneOnOneDto?> OneOnOneAsync(Guid employeeId, Guid me, CancellationToken token)
    {
        if (me == Guid.Empty || me == employeeId) return null;
        var series = await db.OneOnOneSeries.AsNoTracking().FirstOrDefaultAsync(s => s.EndedAt == null
            && ((s.ManagerEmployeeId == me && s.ReportEmployeeId == employeeId) || (s.ReportEmployeeId == me && s.ManagerEmployeeId == employeeId)), token);
        if (series is null) return null;
        var next = await db.OneOnOneMeetings.AsNoTracking()
            .Where(m => m.SeriesId == series.Id && m.State == EY.HRPlatform.Performance.Domain.Conversations.OneOnOneMeetingState.Upcoming)
            .Select(m => (DateTime?)m.ScheduledAt).FirstOrDefaultAsync(token);
        return new PersonSummaryOneOnOneDto(series.Id, next, PerformanceNotificationTemplates.OneOnOnePath(series.Id));
    }

    /// <summary>The cycle's development goals, under the development plan's own read rule.</summary>
    private async Task<PersonSummaryDevelopmentDto?> DevelopmentAsync(PerformanceCycle cycle, Guid employeeId, EmployeePlan? plan,
        PersonSummaryViewer viewer, WorkforceSnapshot person, CancellationToken token)
    {
        var participant = await db.Participants.AsNoTracking().FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, token);
        if (participant is null) return null;
        var reviewer = EY.HRPlatform.Performance.Features.Development.DevelopmentPolicy.ResponsibleReviewer(participant, plan);
        if (!EY.HRPlatform.Performance.Features.Development.DevelopmentPolicy.CanRead(viewer, employeeId, reviewer, person.Manager?.EmployeeId))
            return null;
        var goals = await db.DevelopmentPlans.AsNoTracking().Where(p => p.CycleId == cycle.Id && p.ParticipantId == participant.Id)
            .SelectMany(p => p.Goals).OrderBy(g => g.CreatedAt).ToListAsync(token);
        var competencyIds = goals.Select(g => g.CompetencyId).OfType<Guid>().Distinct().ToList();
        var competencies = await db.Competencies.AsNoTracking().Where(c => competencyIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, token);
        var href = PerformanceNotificationTemplates.DevelopmentPath(cycle.Id, plan?.Id, employeeId, forOwner: viewer.EmployeeId == employeeId);
        return new PersonSummaryDevelopmentDto(goals.Select(g => new PersonSummaryDevelopmentGoalDto(g.Title,
            g.CompetencyId is Guid c ? competencies.GetValueOrDefault(c) : null, g.Status, g.TargetDate)).ToList(), href);
    }

    /// <summary>
    /// Self; the current Core HR manager; the plan's recorded reviewer for this cycle; a cycle administrator.
    /// Managing and reviewing both need the direct-reports view grant, as everywhere else in Performance.
    /// </summary>
    private static PersonRelation Relate(PersonSummaryViewer viewer, WorkforceSnapshot person, EmployeePlan? plan)
    {
        var me = viewer.EmployeeId;
        if (me != Guid.Empty && me == person.EmployeeId) return PersonRelation.Self;
        if (viewer.ReviewsReports && me != Guid.Empty && person.Manager?.EmployeeId == me) return PersonRelation.Manager;
        if (viewer.ReviewsReports && me != Guid.Empty && plan?.ResponsibleManagerId == me) return PersonRelation.Reviewer;
        return viewer.Administers ? PersonRelation.Administrator : PersonRelation.Other;
    }

    /// <summary>The requested cycle; otherwise the active cycle that includes the person; otherwise their most recent.</summary>
    private async Task<PerformanceCycle?> SelectCycleAsync(Guid employeeId, Guid? cycleId, CancellationToken token)
    {
        if (cycleId is Guid requested)
            return await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == requested && c.State != CycleLifecycleState.Draft, token);
        var taken = db.Participants.AsNoTracking().Where(p => p.EmployeeId == employeeId).Select(p => p.CycleId);
        return await db.Cycles.AsNoTracking()
                   .Where(c => c.State == CycleLifecycleState.Active && taken.Contains(c.Id))
                   .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token)
               ?? await db.Cycles.AsNoTracking()
                   .Where(c => c.State != CycleLifecycleState.Draft && taken.Contains(c.Id))
                   .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token)
               ?? await db.Cycles.AsNoTracking()
                   .Where(c => c.State == CycleLifecycleState.Active)
                   .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);
    }

    private async Task<PersonSummaryCycleDto> CycleSectionAsync(PerformanceCycle cycle, Guid employeeId, EmployeePlan? plan,
        PersonRelation relation, CancellationToken token)
    {
        var today = PerformanceClock.Today;
        var phase = await CycleDetailComposer.PhaseAsync(db, cycle, today, token);
        var participant = await db.Participants.AsNoTracking().FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, token);
        var participates = participant is not null;
        if (!participates)
            return new(cycle.Id, cycle.Name, cycle.State, phase, false, null, null, null, null, []);

        // A never-submitted Draft stays the owner's private workspace for everyone but the owner and administrators.
        var privateDraft = plan is not null && relation is PersonRelation.Manager or PersonRelation.Reviewer
            && !PlanPolicy.HasBeenPutForward(plan);
        var objectives = plan is null || privateDraft ? [] : await db.Objectives.AsNoTracking().Include(o => o.Measurement)
            .Where(o => o.EmployeePlanId == plan.Id && o.State != ObjectiveLifecycleState.Archived)
            .ToListAsync(token);
        var standing = PlansComposer.Classify(plan, objectives, today);
        var parentIds = objectives.Where(o => o.ParentObjectiveId is not null).Select(o => o.ParentObjectiveId!.Value).Distinct().ToList();
        var parents = await db.Objectives.AsNoTracking().Where(o => parentIds.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, o => o.Title, token);

        var ordered = objectives.OrderBy(o => o.IsAligned ? 0 : 1).ThenBy(o => o.Title).ToList();
        var approved = standing.Status == RosterPlanStatus.Approved;
        var objectiveIds = objectives.Select(o => o.Id).ToList();
        var openRequests = approved && plan is not null
            ? (await db.UpdateRequests.AsNoTracking()
                .Where(u => u.PlanId == plan.Id && u.State == UpdateRequestState.Open && u.ObjectiveId != null && objectiveIds.Contains(u.ObjectiveId.Value))
                .ToListAsync(token))
                .GroupBy(u => u.ObjectiveId!.Value)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(u => u.RequestedAt).First())
            : [];
        return new(cycle.Id, cycle.Name, cycle.State, phase, true, privateDraft ? null : plan?.Id, standing.Status,
            // Missing is not 0%: no figure until some objective has recorded progress.
            approved && objectives.Any(o => o.HasProgress) ? ProgressCalc.PlanProgress(objectives) : null,
            plan is null || privateDraft ? null : PerformanceNotificationTemplates.PlanPath(cycle.Id, plan.Id),
            ordered.Select((o, index) => new PersonSummaryObjectiveDto(o.Id, index + 1, o.Title,
                o.ParentObjectiveId is Guid parent && parents.TryGetValue(parent, out var title) ? title : null,
                o.PlanWeight,
                approved && o.HasProgress ? Math.Min(o.DerivedProgress, 100m) : null,
                PerformanceNotificationTemplates.ObjectivePath(cycle.Id, o.Id))
                {
                    Status = approved ? o.CurrentStatus : null,
                    OpenRequest = openRequests.TryGetValue(o.Id, out var asked) ? new(asked.RequestedByName, asked.RequestedAt) : null,
                }).ToList())
        {
            ReviewerName = plan?.ResponsibleManagerName ?? participant!.ManagerDisplayName,
            WeightTotal = plan is null || privateDraft ? null : objectives.Sum(o => o.PlanWeight ?? 0m),
            LastUpdateAt = approved ? objectives.Select(o => o.LastCheckInAt).Where(d => d is not null).Max() : null,
        };
    }

    /// <summary>
    /// The open review's step, and released results across cycles. The step never carries a rating, so a
    /// subject in calibration sees only that calibration is under way (B-049); results exist once finalized.
    /// </summary>
    private async Task<PersonSummaryReviewsDto> ReviewsAsync(Guid employeeId, CancellationToken token)
    {
        var current = await (from review in db.PerformanceReviews.AsNoTracking()
                             join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                             where review.SubjectEmployeeId == employeeId && round.State == ReviewRoundState.Active
                                && review.State != PerformanceReviewState.Finalized && review.State != PerformanceReviewState.Closed
                             orderby review.OpenedAt descending
                             select new { review.Id, RoundName = round.Name, review.State, review.CurrentStageDueDate,
                                 review.SelfAssessmentEnabled, review.CalibrationEnabled, review.ReviewerDisplayName })
            .FirstOrDefaultAsync(token);
        var history = await (from review in db.PerformanceReviews.AsNoTracking()
                             join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                             join cycle in db.Cycles.AsNoTracking() on review.CycleId equals cycle.Id
                             where review.SubjectEmployeeId == employeeId && review.State == PerformanceReviewState.Finalized
                             orderby review.FinalizedAt descending
                             select new { review.Id, CycleName = cycle.Name, RoundName = round.Name, review.FinalRating,
                                 review.FinalizedSnapshotJson, review.FinalizedAt })
            .ToListAsync(token);
        return new(
            current is null ? null : new(current.Id, current.RoundName, current.State, current.CurrentStageDueDate,
                current.SelfAssessmentEnabled, current.CalibrationEnabled, PerformanceNotificationTemplates.ReviewPath(current.Id))
                { ReviewerName = current.ReviewerDisplayName },
            history.Select(r => new PersonSummaryReviewResultDto(r.Id, r.CycleName, r.RoundName,
                ReviewHistoryRating.Label(r.FinalizedSnapshotJson, r.FinalRating), r.FinalizedAt,
                PerformanceNotificationTemplates.ReviewPath(r.Id))).ToList());
    }
}
