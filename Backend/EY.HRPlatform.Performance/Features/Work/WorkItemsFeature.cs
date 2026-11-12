using EY.HRPlatform.Performance.Features.Calibration;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.OneOnOnes;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Work;

/// <summary>What the caller may act on, from the token; responsibility itself is read from Performance state.</summary>
public sealed record WorkActor(Guid EmployeeId, Guid UserId, bool Participates, bool ReviewsReports, bool Administers, bool Calibrates);

public sealed record GetWorkItemsQuery(WorkActor Actor) : IQuery<Result<IReadOnlyList<FusionWorkItemDto>>>;

/// <summary>
/// The caller's Performance work, derived at request time from the active Cycle and the active review rounds
/// (P3: one list, never stored). Each rule mirrors the surface where the work is done: My Plan's planning
/// state, the plan decision authority, open update requests, the review work queue, calibration sessions
/// and round finalization. Items carry absolute app paths and stable ids. Work another person is blocked on (a plan
/// decision, a peer list, peer input, a feedback request, an update request) carries when they started waiting.
/// </summary>
public sealed class GetWorkItemsHandler(PerformanceDbContext db, ICoreWorkforceClient? workforce = null,
    INotificationAudienceClient? audience = null)
    : IQueryHandler<GetWorkItemsQuery, Result<IReadOnlyList<FusionWorkItemDto>>>
{
    private const string Module = "performance";

    public async Task<Result<IReadOnlyList<FusionWorkItemDto>>> Handle(GetWorkItemsQuery query, CancellationToken token)
    {
        var actor = query.Actor;
        var items = new List<FusionWorkItemDto>();
        var today = PerformanceClock.Today;
        var cycle = await db.Cycles.AsNoTracking().Where(c => c.State == CycleLifecycleState.Active)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);

        if (cycle is not null && actor.EmployeeId != Guid.Empty)
        {
            if (actor.Participates) await PlanningAsync(cycle, actor.EmployeeId, today, items, token);
            if (actor.ReviewsReports)
            {
                await PlanDecisionsAsync(cycle, actor.EmployeeId, items, token);
                await OffTrackAsync(cycle, actor.EmployeeId, items, token);
            }
            await UpdateRequestsAsync(cycle, actor.EmployeeId, items, token);
        }
        if (actor.EmployeeId != Guid.Empty)
        {
            await AssessmentsAsync(actor, today, items, token);
            await PeerWorkAsync(actor, today, items, token);
            await FeedbackRequestsAsync(actor.EmployeeId, items, token);
            await OneOnOneActionsAsync(actor.EmployeeId, today, items, token);
            if (actor.ReviewsReports) await OneOnOnesToBookAsync(actor.EmployeeId, items, token);
        }
        if (actor.Calibrates || actor.Administers) await RoundsAsync(actor, items, token);
        return Result.Success<IReadOnlyList<FusionWorkItemDto>>(items
            .Select(item => ActionLabels.TryGetValue(item.Kind, out var label) ? item with { ActionLabel = label } : item).ToList());
    }

    /// <summary>What each kind's button does, said as the outcome (DESIGN §8), never a bare "Open".</summary>
    private static readonly IReadOnlyDictionary<string, string> ActionLabels = new Dictionary<string, string>
    {
        ["plan-write"] = "Continue your plan",
        ["plan-revise"] = "Revise your plan",
        ["plan-decision"] = "Read it",
        ["goals-off-track"] = "Open the plan",
        ["one-on-one-book"] = "Open 1:1s",
        ["update-request"] = "Record progress",
        ["feedback-request"] = "Answer",
        ["one-on-one-action"] = "Open the 1:1",
        ["self-assessment"] = "Write it",
        ["manager-assessment"] = "Write the review",
        ["peer-input"] = "Answer",
        ["acknowledge-result"] = "Read your result",
        ["calibration"] = "Look at them",
        ["round-release"] = "Release results",
    };

    private static string Id(string kind, Guid resourceId) => $"{Module}:{kind}:{resourceId}";

    /// <summary>The sidebar destination each item is counted under: the workspace where that kind of work lives.</summary>
    internal static class Sections
    {
        public const string Plan = "/performance/goals";
        public const string Team = "/performance/team";
        public const string Reviews = "/performance/reviews";
        public const string Feedback = "/performance/feedback";
        public const string OneOnOnes = "/performance/one-on-ones";
    }

    /// <summary>A participant in planning whose plan isn't submitted, or came back returned.</summary>
    private async Task PlanningAsync(PerformanceCycle cycle, Guid employeeId, DateOnly today, List<FusionWorkItemDto> items, CancellationToken token)
    {
        if (await YearPhases.ComputeAsync(db, cycle, token) != CyclePhase.Planning) return;
        var participant = await db.Participants.AsNoTracking()
            .FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, token);
        if (participant is null) return;
        var plan = await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, token);
        if (plan is not null && plan.State != PlanLifecycleState.Draft) return;
        var returned = plan?.Decisions.OrderBy(d => d.DecidedAt).LastOrDefault()?.Kind == PlanDecisionKind.Returned;
        var open = plan?.OpenChangeRequests.Count ?? 0;
        var reviewer = plan?.ResponsibleManagerName ?? participant.ManagerDisplayName;
        items.Add(new(Id(returned ? "plan-revise" : "plan-write", plan?.Id ?? participant.Id), Module,
            returned ? "plan-revise" : "plan-write",
            returned ? "Revise your plan" : "Write your plan",
            !returned ? cycle.Name
                : open == 1 ? "1 change to address"
                : open > 1 ? $"{open} changes to address"
                : "Your reviewer asked for changes",
            cycle.PlanningDeadline, "/performance/goals", Section: Sections.Plan,
            Steps: WorkSteps.Plan(returned, open, reviewer)));
    }

    /// <summary>
    /// Submitted plans waiting for the caller's decision as their responsible reviewer, longest waiting first, with their
    /// goals in place (D-84): each goal and its weight, or, put forward again after a return, only what changed since.
    /// </summary>
    private async Task PlanDecisionsAsync(PerformanceCycle cycle, Guid employeeId, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var plans = await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .Where(p => p.CycleId == cycle.Id && p.ResponsibleManagerId == employeeId && p.State == PlanLifecycleState.Submitted)
            .OrderBy(p => p.SubmittedAt).ToListAsync(token);
        if (plans.Count == 0) return;
        var planIds = plans.Select(p => p.Id).ToList();
        var goals = (await db.Objectives.AsNoTracking().Include(o => o.Measurement)
                .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value) && o.State != ObjectiveLifecycleState.Archived)
                .ToListAsync(token))
            .GroupBy(o => o.EmployeePlanId!.Value).ToDictionary(g => g.Key, g => g.OrderBy(o => o.CreatedAt).ToList());
        foreach (var plan in plans)
        {
            var own = goals.GetValueOrDefault(plan.Id) ?? [];
            var answered = plan.AnsweredReturn;
            var lines = answered is null
                ? own.Select(goal => new FusionWorkLineDto(goal.Title, goal.PlanWeight is decimal weight ? $"{weight:0.##}%" : null)).ToList()
                : PlanChanges.Since(answered.GoalsSnapshot, own.Select(PlansComposer.Snapshot).ToList()).Select(ChangeLine).ToList();
            // Answered in place on Home (D-66): approve, or ask for a change with a note.
            items.Add(new FusionWorkItemDto(Id("plan-decision", plan.Id), Module, "plan-decision",
                $"{plan.EmployeeDisplayName}'s plan",
                (answered is not null ? "Changed as you asked, put forward again" : "Put forward") + (own.Count == 1 ? ", 1 goal" : $", {own.Count} goals"),
                null,
                PerformanceNotificationTemplates.PlanPath(cycle.Id, plan.Id), new FusionWorkSubjectDto(plan.EmployeeDisplayName, plan.EmployeeId), Sections.Team,
                WaitingSince: plan.SubmittedAt,
                Decision: new FusionWorkDecisionDto(
                    $"/cycles/{cycle.Id}/plans/{plan.Id}/decision/approve", $"/cycles/{cycle.Id}/plans/{plan.Id}/decision/return", "Ask for a change"))
            {
                Lines = lines,
            });
        }
    }

    /// <summary>A goal changed since the return, said in a few words.</summary>
    private static FusionWorkLineDto ChangeLine(PlanGoalChange change) => change.Kind switch
    {
        PlanChanges.Added => new(change.Title, "New"),
        PlanChanges.Removed => new(change.Title, "Taken out"),
        _ => new(change.Title, string.Join(", ", change.Fields.Select(field => field.Field switch
        {
            PlanChanges.Weight => $"Weight {field.Before ?? "even"} → {field.After ?? "even"}",
            PlanChanges.Measure => $"Measure now {field.After}",
            _ => "Renamed",
        }))),
    };

    /// <summary>
    /// A person whose goals the caller reviews went at risk or off track and the caller hasn't answered yet (D-05, D-84):
    /// one row per person, with the goals, their latest words, and the two answers in place. The row says when the person
    /// last updated any of them.
    /// </summary>
    private async Task OffTrackAsync(PerformanceCycle cycle, Guid employeeId, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var flagged = await (from objective in db.Objectives.AsNoTracking()
                             join plan in db.EmployeePlans.AsNoTracking() on objective.EmployeePlanId equals plan.Id
                             where plan.CycleId == cycle.Id && plan.ResponsibleManagerId == employeeId
                                && plan.State == PlanLifecycleState.Approved && objective.State != ObjectiveLifecycleState.Archived
                                && (objective.CurrentStatus == ObjectiveStatus.AtRisk || objective.CurrentStatus == ObjectiveStatus.OffTrack)
                                && objective.StatusAcknowledgedAt == null
                             orderby objective.Title
                             select new { objective.Id, objective.Title, objective.CurrentStatus, objective.LastProgressAt, objective.StatusSince,
                                 PlanId = plan.Id, plan.EmployeeId, plan.EmployeeDisplayName })
            .ToListAsync(token);
        if (flagged.Count == 0) return;
        var ids = flagged.Select(o => o.Id).ToList();
        var notes = (await db.ProgressUpdates.AsNoTracking()
                .Where(u => ids.Contains(u.ObjectiveId) && u.ContextNote != null && u.ContextNote != "")
                .Select(u => new { u.ObjectiveId, u.ContextNote, u.RecordedAt }).ToListAsync(token))
            .ToLookup(u => u.ObjectiveId);
        var people = flagged.Select(o => o.EmployeeId).Distinct().ToList();
        var talking = (await db.OneOnOneSeries.AsNoTracking()
            .Where(s => s.ManagerEmployeeId == employeeId && s.EndedAt == null && people.Contains(s.ReportEmployeeId))
            .Select(s => s.ReportEmployeeId).ToListAsync(token)).ToHashSet();

        foreach (var person in flagged.GroupBy(o => o.PlanId).OrderByDescending(g => g.Max(o => o.StatusSince)))
        {
            var first = person.First();
            var off = person.Count(o => o.CurrentStatus == ObjectiveStatus.OffTrack);
            var risk = person.Count() - off;
            var title = off > 0 && risk > 0 ? $"{first.EmployeeDisplayName} has {off} off track and {risk} at risk"
                : off > 0 ? $"{first.EmployeeDisplayName} has {Goals(off)} off track"
                : $"{first.EmployeeDisplayName} has {Goals(risk)} at risk";
            var updated = person.Max(o => o.LastProgressAt);
            var quote = person.SelectMany(o => notes[o.Id]).OrderByDescending(n => n.RecordedAt).FirstOrDefault()?.ContextNote;
            var actions = new List<FusionWorkActionDto>();
            if (talking.Contains(first.EmployeeId))
                actions.Add(new("Talk it over", $"/cycles/{cycle.Id}/plans/{first.PlanId}/attention/talk-it-over"));
            actions.Add(new("Ask for an update", $"/cycles/{cycle.Id}/plans/{first.PlanId}/attention/ask-for-update", Primary: true));
            items.Add(new FusionWorkItemDto(Id("goals-off-track", first.PlanId), Module, "goals-off-track", title,
                updated is DateTime at ? $"Last updated {at.ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture)}" : "No update yet",
                null, PerformanceNotificationTemplates.PlanPath(cycle.Id, first.PlanId),
                new FusionWorkSubjectDto(first.EmployeeDisplayName, first.EmployeeId), Sections.Team)
            {
                Lines = person.Select(o => new FusionWorkLineDto(o.Title, o.CurrentStatus == ObjectiveStatus.OffTrack ? "Off track" : "At risk",
                    o.CurrentStatus == ObjectiveStatus.OffTrack ? "bad" : "warn")).ToList(),
                Quote = quote,
                Actions = actions,
            });
        }
    }

    private static string Goals(int count) => count == 1 ? "1 goal" : $"{count} goals";

    /// <summary>
    /// The caller's direct reports, by Core HR, with no 1:1s together yet (D-39, D-84): booked in place at a time both are
    /// free. Without a time zone from Identity the row still shows and opens 1:1s, with no times offered.
    /// </summary>
    private async Task OneOnOnesToBookAsync(Guid employeeId, List<FusionWorkItemDto> items, CancellationToken token)
    {
        if (workforce is null) return;
        var now = PerformanceClock.UtcNow;
        IReadOnlyList<WorkforceSnapshot> reports;
        WorkforceSnapshot? me;
        try
        {
            reports = (await workforce.GetDirectReportsAsync(now, [employeeId], token)).Where(r => r.IsActive && r.EmployeeId != employeeId).ToList();
            if (reports.Count == 0) return;
            me = (await workforce.ResolveAsync(now, [employeeId], token)).SingleOrDefault(p => p.EmployeeId == employeeId);
        }
        catch (HttpRequestException) { return; }
        if (me is null) return;
        var reportIds = reports.Select(r => r.EmployeeId).ToList();
        var meeting = (await db.OneOnOneSeries.AsNoTracking()
            .Where(s => s.ManagerEmployeeId == employeeId && s.EndedAt == null && reportIds.Contains(s.ReportEmployeeId))
            .Select(s => s.ReportEmployeeId).ToListAsync(token)).ToHashSet();
        var unbooked = reports.Where(r => !meeting.Contains(r.EmployeeId)).OrderBy(r => r.DisplayName).ToList();
        if (unbooked.Count == 0) return;
        string? zoneId = null;
        if (audience is not null)
        {
            try { zoneId = (await audience.ReadAsync([], token)).TimeZone; }
            catch (HttpRequestException) { }
        }
        var zone = OneOnOneFreeTimes.Zone(zoneId);
        foreach (var report in unbooked)
        {
            var slots = zoneId is null ? [] : await OneOnOneFreeTimes.ForAsync(db, zone, me, report, now, token);
            items.Add(new FusionWorkItemDto(Id("one-on-one-book", report.EmployeeId), Module, "one-on-one-book",
                $"No 1:1s with {report.DisplayName} yet", slots.Count > 0 ? "Times you're both free" : null, null,
                PerformanceNotificationTemplates.OneOnOnesPath, new FusionWorkSubjectDto(report.DisplayName, report.EmployeeId), Sections.OneOnOnes)
            {
                Booking = slots.Count > 0 ? new FusionWorkBookingDto(slots, $"/one-on-ones/with/{report.EmployeeId}/book") : null,
            });
        }
    }

    /// <summary>Open update requests addressed to the caller: one objective opens in record mode, the plan opens the plan.</summary>
    private async Task UpdateRequestsAsync(PerformanceCycle cycle, Guid employeeId, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var open = await (from request in db.UpdateRequests.AsNoTracking()
                          where request.CycleId == cycle.Id && request.EmployeeId == employeeId && request.State == UpdateRequestState.Open
                          join objective in db.Objectives.AsNoTracking() on request.ObjectiveId equals objective.Id into targets
                          from objective in targets.DefaultIfEmpty()
                          orderby request.RequestedAt descending
                          select new { request.Id, request.PlanId, request.ObjectiveId, request.RequestedByName, request.RequestedAt, Title = objective == null ? null : objective.Title })
            .ToListAsync(token);
        items.AddRange(open.Select(r => new FusionWorkItemDto(Id("update-request", r.Id), Module, "update-request",
            r.ObjectiveId is null ? "Update progress on your plan" : $"Update progress on {r.Title}",
            $"{r.RequestedByName} asked for an update", null,
            r.ObjectiveId is Guid objectiveId
                ? PerformanceNotificationTemplates.ObjectivePath(cycle.Id, objectiveId, record: true)
                : PerformanceNotificationTemplates.PlanPath(cycle.Id, r.PlanId), Section: Sections.Plan, WaitingSince: r.RequestedAt)));
    }

    /// <summary>Feedback the caller was asked for and hasn't answered or declined, while the request is open. Not cycle-bound.</summary>
    private async Task FeedbackRequestsAsync(Guid employeeId, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var waiting = await db.FeedbackRequests.AsNoTracking()
            .Where(r => r.State == Domain.Conversations.FeedbackRequestState.Open
                && r.Invitees.Any(i => i.EmployeeId == employeeId && i.Status == Domain.Conversations.FeedbackInviteeStatus.Waiting))
            .OrderBy(r => r.DueDate).ToListAsync(token);
        items.AddRange(waiting.Select(r => new FusionWorkItemDto(Id("feedback-request", r.Id), Module, "feedback-request",
            $"Feedback for {r.RequesterName}", r.Question, r.DueDate, PerformanceNotificationTemplates.FeedbackRequestPath(r.Id), Section: Sections.Feedback,
            WaitingSince: r.RequestedAt)));
    }

    /// <summary>The caller's open 1:1 action items in an active series, once due within three days or overdue. Not cycle-bound.</summary>
    private async Task OneOnOneActionsAsync(Guid employeeId, DateOnly today, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var horizon = today.AddDays(3);
        var due = await (from action in db.OneOnOneActionItems.AsNoTracking()
                         join series in db.OneOnOneSeries.AsNoTracking() on action.SeriesId equals series.Id
                         where action.OwnerEmployeeId == employeeId && action.DoneAt == null && action.DueDate != null
                               && action.DueDate <= horizon && series.EndedAt == null
                               && (series.ManagerEmployeeId == employeeId || series.ReportEmployeeId == employeeId)
                         orderby action.DueDate
                         select new { ActionId = action.Id, action.Text, action.DueDate, SeriesId = series.Id, series.ManagerEmployeeId, series.ManagerName, series.ReportName })
            .ToListAsync(token);
        items.AddRange(due.Select(a => new FusionWorkItemDto(Id("one-on-one-action", a.ActionId), Module, "one-on-one-action", a.Text,
            $"1:1 with {(a.ManagerEmployeeId == employeeId ? a.ReportName : a.ManagerName)}", a.DueDate,
            PerformanceNotificationTemplates.OneOnOnePath(a.SeriesId), Section: Sections.OneOnOnes)));
    }

    /// <summary>The round name, and how late the task is once past its current due date.</summary>
    private static string LateContext(string roundName, DateOnly? due, DateOnly today)
    {
        var late = ReviewReminderSchedule.DaysLate(due, today);
        return late switch { 0 => roundName, 1 => $"{roundName} · a day late", _ => $"{roundName} · {late} days late" };
    }

    /// <summary>
    /// Peer input work: each peer answers their open request on Home (D-74), and the person acknowledges a released result.
    /// </summary>
    private async Task PeerWorkAsync(WorkActor actor, DateOnly today, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var me = actor.EmployeeId;
        if (actor.Participates)
        {
            var asked = await (from request in db.PeerRequests.AsNoTracking()
                               join round in db.ReviewRounds.AsNoTracking() on request.ReviewRoundId equals round.Id
                               where round.State == ReviewRoundState.Active && request.PeerEmployeeId == me && request.State == PeerRequestState.Open
                               orderby request.DueDate
                               select new { request.Id, request.SubjectDisplayName, request.DueDate, request.RequestedAt, RoundName = round.Name }).ToListAsync(token);
            items.AddRange(asked.Select(r => new FusionWorkItemDto(Id("peer-input", r.Id), Module, "peer-input",
                $"Your view on {r.SubjectDisplayName}", LateContext(r.RoundName, r.DueDate, today), r.DueDate,
                PerformanceNotificationTemplates.PeerRequestPath(r.Id), new FusionWorkSubjectDto(r.SubjectDisplayName), Sections.Reviews,
                WaitingSince: r.RequestedAt)));

            var unacknowledged = await (from review in db.PerformanceReviews.AsNoTracking()
                                        join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                                        where review.SubjectEmployeeId == me && review.State == PerformanceReviewState.Finalized
                                              && review.AcknowledgedAt == null
                                        orderby review.FinalizedAt descending
                                        select new { review.Id, RoundName = round.Name }).ToListAsync(token);
            items.AddRange(unacknowledged.Select(r => new FusionWorkItemDto(Id("acknowledge-result", r.Id), Module, "acknowledge-result",
                "Read and acknowledge your review", r.RoundName, null, PerformanceNotificationTemplates.ReviewPath(r.Id), Section: Sections.Reviews)));
        }
    }

    /// <summary>The review work queue's own rule: the subject in self-assessment, the reviewer in manager assessment.</summary>
    private async Task AssessmentsAsync(WorkActor actor, DateOnly today, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var me = actor.EmployeeId;
        var reviewActor = new ReviewActor(me, false, CanParticipate: actor.Participates, CanReviewReports: actor.ReviewsReports);
        var due = await (from review in ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(), reviewActor)
                         join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                         where round.State == ReviewRoundState.Active
                            && ((review.State == PerformanceReviewState.SelfAssessment && review.SubjectEmployeeId == me
                                    && review.SelfAssessmentEnabled && review.SelfAssessment.SubmittedAt == null)
                                || (review.State == PerformanceReviewState.ManagerAssessment && review.ReviewerEmployeeId == me
                                    && review.ManagerAssessment.SubmittedAt == null))
                         orderby review.CurrentStageDueDate, review.SubjectDisplayName
                         select new
                         {
                             review.Id, review.State, review.SubjectDisplayName, review.ReviewerDisplayName, review.CurrentStageDueDate,
                             review.SelfAssessmentEnabled, review.CalibrationEnabled, RoundName = round.Name,
                             SelfDue = review.SelfAssessmentDueDate ?? round.SelfAssessmentDueDate,
                             ManagerDue = review.ManagerAssessmentDueDate ?? round.ManagerAssessmentDueDate,
                         })
            .ToListAsync(token);
        foreach (var review in due)
        {
            var self = review.State == PerformanceReviewState.SelfAssessment;
            if (self && !actor.Participates || !self && !actor.ReviewsReports) continue;
            items.Add(new(Id(self ? "self-assessment" : "manager-assessment", review.Id), Module,
                self ? "self-assessment" : "manager-assessment",
                self ? "Complete your self-assessment" : $"Assess {review.SubjectDisplayName}",
                LateContext(review.RoundName, review.CurrentStageDueDate, today), review.CurrentStageDueDate,
                PerformanceNotificationTemplates.ReviewPath(review.Id),
                self ? null : new FusionWorkSubjectDto(review.SubjectDisplayName), Sections.Reviews,
                self
                    ? WorkSteps.SelfAssessment(review.ReviewerDisplayName, review.SelfDue, review.ManagerDue, review.CalibrationEnabled)
                    : WorkSteps.ManagerAssessment(review.SubjectDisplayName, review.SelfAssessmentEnabled, review.ManagerDue, review.CalibrationEnabled)));
        }
    }

    /// <summary>
    /// HR's part of a running round (D-35): a calibrator hears of flagged reviews to look at (never their own); an
    /// administrator of results to release once nothing is still being written or waiting on a look.
    /// </summary>
    private async Task RoundsAsync(WorkActor actor, List<FusionWorkItemDto> items, CancellationToken token)
    {
        var rounds = await db.ReviewRounds.AsNoTracking().Where(round => round.State == ReviewRoundState.Active)
            .OrderBy(round => round.Name).ToListAsync(token);
        foreach (var round in rounds)
        {
            var state = await CalibrationState.LoadAsync(db, round, null, token);
            var toLookAt = state.Reviews.Count(r => state.ToLookAt(r) && r.SubjectEmployeeId != actor.EmployeeId);
            if (actor.Calibrates && toLookAt > 0)
                items.Add(new(Id("calibration", round.Id), Module, "calibration",
                    toLookAt == 1 ? "1 review to look at" : $"{toLookAt} reviews to look at", round.Name, null,
                    PerformanceNotificationTemplates.CalibrationPath(round.Id), Section: Sections.Reviews));
            var ready = state.Reviews.Count(state.Ready);
            var waiting = state.Reviews.Count(r => CalibrationState.Writing(r) || state.ToLookAt(r));
            if (actor.Administers && ready > 0 && waiting == 0)
                items.Add(new(Id("round-release", round.Id), Module, "round-release",
                    ready == 1 ? "1 result to release" : $"{ready} results to release", round.Name, null,
                    PerformanceNotificationTemplates.YearPath, Section: Sections.Reviews, Steps: WorkSteps.RoundRelease(round.CalibrationEnabled)));
        }
    }
}
