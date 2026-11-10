using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Work;

public sealed record GetUpcomingQuery(WorkActor Actor, int Days) : IQuery<Result<IReadOnlyList<FusionUpcomingDto>>>;

/// <summary>
/// The caller's upcoming moments (fusion-attention): dated things that aren't work, from today through <c>Days</c>
/// ahead. Their 1:1 meetings; the planning deadline and end of a cycle they take part in; their own review due dates,
/// grouped per date and kind; and, for cycle administrators, a Draft cycle's planned start and a running cycle's end.
/// Everything is the caller's own and read inside the tenant filter. A due-date moment names the work-item kinds it
/// summarizes, so the home lists them once.
/// </summary>
public sealed class GetUpcomingHandler(PerformanceDbContext db)
    : IQueryHandler<GetUpcomingQuery, Result<IReadOnlyList<FusionUpcomingDto>>>
{
    public const int MaxDays = 31;
    private const string Module = "performance";

    public async Task<Result<IReadOnlyList<FusionUpcomingDto>>> Handle(GetUpcomingQuery query, CancellationToken token)
    {
        if (query.Days is < 1 or > MaxDays)
            return Result.Failure<IReadOnlyList<FusionUpcomingDto>>(
                PerformanceErrors.Validation("Upcoming.Invalid", $"Choose between 1 and {MaxDays} days."));
        var actor = query.Actor;
        var now = PerformanceClock.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var horizon = today.AddDays(query.Days);
        var items = new List<FusionUpcomingDto>();

        if (actor.EmployeeId != Guid.Empty)
        {
            await OneOnOnesAsync(actor.EmployeeId, now, horizon, items, token);
            await ReviewDatesAsync(actor, today, horizon, items, token);
        }
        await CyclesAsync(actor, today, horizon, items, token);

        return Result.Success<IReadOnlyList<FusionUpcomingDto>>(items
            .OrderBy(item => item.Date).ThenBy(item => item.At ?? DateTime.MaxValue).ThenBy(item => item.Title)
            .ToList());
    }

    private static string Id(string kind, object key) => $"{Module}:{kind}:{key}";

    /// <summary>
    /// The caller's meetings in active series from the start of today, with what's waiting on the agenda. A meeting whose
    /// day has passed without being completed is owed work instead (work items), not an upcoming moment.
    /// </summary>
    private async Task OneOnOnesAsync(Guid me, DateTime now, DateOnly horizon, List<FusionUpcomingDto> items, CancellationToken token)
    {
        var dayStart = DateOnly.FromDateTime(now).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var until = horizon.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var meetings = await (from meeting in db.OneOnOneMeetings.AsNoTracking()
                              join series in db.OneOnOneSeries.AsNoTracking() on meeting.SeriesId equals series.Id
                              where (series.ManagerEmployeeId == me || series.ReportEmployeeId == me) && series.EndedAt == null
                                    && meeting.State == OneOnOneMeetingState.Upcoming
                                    && meeting.ScheduledAt >= dayStart && meeting.ScheduledAt < until
                              select new
                              {
                                  meeting.Id, meeting.ScheduledAt, SeriesId = series.Id,
                                  Other = series.ManagerEmployeeId == me ? series.ReportName : series.ManagerName,
                                  Agenda = db.OneOnOneAgendaItems.Count(item => item.MeetingId == meeting.Id && item.DiscussedAt == null),
                              })
            .ToListAsync(token);
        items.AddRange(meetings.Select(m => new FusionUpcomingDto(
            Id("one-on-one", m.Id), Module, "one-on-one", $"1:1 with {m.Other}",
            m.Agenda == 0 ? null : $"{m.Agenda} on the agenda",
            DateOnly.FromDateTime(m.ScheduledAt), DateTime.SpecifyKind(m.ScheduledAt, DateTimeKind.Utc),
            PerformanceNotificationTemplates.OneOnOnePath(m.SeriesId))));
    }

    /// <summary>
    /// Planning deadline and end of the running cycles the caller takes part in; for administrators also a running
    /// cycle's end and a Draft cycle's planned start. A cycle the caller isn't part of gives them nothing otherwise.
    /// </summary>
    private async Task CyclesAsync(WorkActor actor, DateOnly today, DateOnly horizon, List<FusionUpcomingDto> items, CancellationToken token)
    {
        var running = await db.Cycles.AsNoTracking().Where(c => c.State == CycleLifecycleState.Active).ToListAsync(token);
        foreach (var cycle in running)
        {
            var participates = actor.Participates && actor.EmployeeId != Guid.Empty
                && await db.Participants.AsNoTracking().AnyAsync(p => p.CycleId == cycle.Id && p.EmployeeId == actor.EmployeeId, token);
            if (participates && InRange(cycle.PlanningDeadline, today, horizon))
                items.Add(new(Id("plans-due", cycle.Id), Module, "plans-due", "Plans due", $"{cycle.Name} planning closes",
                    cycle.PlanningDeadline, null, "/performance/goals", ["plan-write", "plan-revise"]));
            if ((participates || actor.Administers) && InRange(cycle.EndDate, today, horizon))
            {
                var context = participates
                    ? "Progress recorded after this date doesn't count"
                    : $"{await db.Participants.AsNoTracking().CountAsync(p => p.CycleId == cycle.Id, token)} participants";
                items.Add(new(Id("cycle-end", cycle.Id), Module, "cycle-end", $"{cycle.Name} ends", context,
                    cycle.EndDate, null, "/performance"));
            }
        }

        if (!actor.Administers) return;
        var drafts = await db.Cycles.AsNoTracking()
            .Where(c => c.State == CycleLifecycleState.Draft && c.StartDate >= today && c.StartDate <= horizon)
            .ToListAsync(token);
        items.AddRange(drafts.Select(cycle => new FusionUpcomingDto(
            Id("cycle-start", cycle.Id), Module, "cycle-start", $"{cycle.Name} planned start", "Draft",
            cycle.StartDate, null, $"/performance/cycle/setup?cycle={cycle.Id}")));
    }

    /// <summary>The caller's own due dates in running rounds: their self-assessment, peer input they owe, reviews they write.</summary>
    private async Task ReviewDatesAsync(WorkActor actor, DateOnly today, DateOnly horizon, List<FusionUpcomingDto> items, CancellationToken token)
    {
        var me = actor.EmployeeId;
        if (actor.Participates)
        {
            var self = await (from review in db.PerformanceReviews.AsNoTracking()
                              join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                              where round.State == ReviewRoundState.Active && review.SubjectEmployeeId == me
                                    && review.State == PerformanceReviewState.SelfAssessment && review.SelfAssessmentEnabled
                                    && review.SelfAssessment.SubmittedAt == null
                              select new { review.Id, Due = review.SelfAssessmentDueDate ?? round.SelfAssessmentDueDate, RoundName = round.Name })
                .ToListAsync(token);
            items.AddRange(self.Where(r => InRange(r.Due, today, horizon)).Select(r => new FusionUpcomingDto(
                Id("self-assessment-due", r.Id), Module, "self-assessment-due", "Your self-assessment due", r.RoundName,
                r.Due!.Value, null, PerformanceNotificationTemplates.ReviewPath(r.Id), ["self-assessment", "nominate-peers"])));

            var peers = await (from request in db.PeerRequests.AsNoTracking()
                               join round in db.ReviewRounds.AsNoTracking() on request.ReviewRoundId equals round.Id
                               where round.State == ReviewRoundState.Active && request.PeerEmployeeId == me && request.State == PeerRequestState.Open
                               select new { request.Id, request.DueDate, request.SubjectDisplayName, RoundName = round.Name })
                .ToListAsync(token);
            foreach (var day in peers.Where(r => InRange(r.DueDate, today, horizon)).GroupBy(r => r.DueDate!.Value))
            {
                var list = day.ToList();
                items.Add(new(Id("peer-input-due", day.Key.ToString("yyyy-MM-dd")), Module, "peer-input-due",
                    list.Count == 1 ? $"Peer input for {list[0].SubjectDisplayName} due" : $"Your {list.Count} peer inputs due",
                    list[0].RoundName, day.Key, null,
                    list.Count == 1 ? PerformanceNotificationTemplates.PeerRequestPath(list[0].Id) : "/performance/reviews",
                    ["peer-input"]));
            }
        }

        if (actor.ReviewsReports)
        {
            var writing = await (from review in db.PerformanceReviews.AsNoTracking()
                                 join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                                 where round.State == ReviewRoundState.Active && review.ReviewerEmployeeId == me
                                       && review.ManagerAssessment.SubmittedAt == null
                                       && (review.State == PerformanceReviewState.SelfAssessment || review.State == PerformanceReviewState.ManagerAssessment)
                                 select new
                                 {
                                     review.Id, review.State, review.SubjectDisplayName, RoundName = round.Name,
                                     Due = review.ManagerAssessmentDueDate ?? round.ManagerAssessmentDueDate,
                                 })
                .ToListAsync(token);
            foreach (var day in writing.Where(r => InRange(r.Due, today, horizon)).GroupBy(r => r.Due!.Value))
            {
                var list = day.ToList();
                var ready = list.Count(r => r.State == PerformanceReviewState.ManagerAssessment);
                items.Add(new(Id("reviews-due", day.Key.ToString("yyyy-MM-dd")), Module, "reviews-due",
                    list.Count == 1 ? $"Your review of {list[0].SubjectDisplayName} due" : $"Your {list.Count} reviews due",
                    ready == 0 ? list[0].RoundName : $"{list[0].RoundName} · {ready} ready to write",
                    day.Key, null,
                    list.Count == 1 ? PerformanceNotificationTemplates.ReviewPath(list[0].Id) : "/performance/reviews",
                    ["manager-assessment"]));
            }
        }
    }

    private static bool InRange(DateOnly? date, DateOnly from, DateOnly to) => date is DateOnly d && d >= from && d <= to;
}
