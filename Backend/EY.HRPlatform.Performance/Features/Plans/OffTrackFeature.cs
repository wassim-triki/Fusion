using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Plans;

/// <summary>How the reviewer answers a person's goals at risk or off track from Home or Team (B-434, D-84).</summary>
public enum OffTrackAnswer { AskForUpdate, TalkItOver }

public sealed record OffTrackAnsweredDto(int Seen);

public sealed record AnswerOffTrackCommand(Guid CycleId, Guid PlanId, OffTrackAnswer Answer, PlanActorContext Actor, string ActorName)
    : ICommand<Result<OffTrackAnsweredDto>>;

/// <summary>
/// One answer to everything flagged on a plan: ask the person for an update on their plan (one request, one notification,
/// D-37), or put each flagged goal on the next 1:1's agenda. Either way the reviewer has seen the states, so they leave
/// Needs you. Only the plan's responsible reviewer, on an approved plan in an active year.
/// </summary>
public sealed class AnswerOffTrackHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<AnswerOffTrackCommand, Result<OffTrackAnsweredDto>>
{
    public async Task<Result<OffTrackAnsweredDto>> Handle(AnswerOffTrackCommand command, CancellationToken token)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == command.CycleId, token);
        if (cycle is null) return Fail(PerformanceErrors.NotFound("Cycle", command.CycleId));
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == command.PlanId && p.CycleId == cycle.Id, token);
        if (plan is null) return Fail(PerformanceErrors.NotFound("EmployeePlan", command.PlanId));
        var actor = command.Actor.ToGoalActor();
        if (!PlanPolicy.IsResponsibleReviewer(actor, plan)) return Fail(UpdateRequests.NotReviewer());
        if (!PlanPolicy.CanRequestUpdate(actor, plan, cycle))
            return Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.UpdateRequestNotAllowed,
                "This plan isn't running in an active year."));

        var caller = command.Actor.CallerEmployeeId;
        var now = PerformanceClock.UtcNow;
        var flagged = await db.Objectives
            .Where(o => o.EmployeePlanId == plan.Id && o.State != ObjectiveLifecycleState.Archived && o.StatusAcknowledgedAt == null
                && (o.CurrentStatus == ObjectiveStatus.AtRisk || o.CurrentStatus == ObjectiveStatus.OffTrack))
            .OrderBy(o => o.Title).ToListAsync(token);

        if (command.Answer == OffTrackAnswer.AskForUpdate)
        {
            var open = await db.UpdateRequests.AnyAsync(r => r.TargetKey == plan.Id && r.State == UpdateRequestState.Open, token);
            if (!open)
            {
                UpdateRequest request;
                try { request = UpdateRequest.Create(plan, null, caller, command.ActorName, null, now); }
                catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or UnauthorizedAccessException)
                {
                    return Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.UpdateRequestNotAllowed, ex.Message));
                }
                db.UpdateRequests.Add(request);
                audit.Record(request.TenantId, "UpdateRequest", request.Id, request.CycleId, PerformanceAuditActions.UpdateRequested,
                    new { after = request.State.ToString(), request.PlanId, request.ObjectiveId, hasNote = false });
                notifications.EnqueueUpdateRequested(request, null);
            }
        }
        else
        {
            var next = await (from item in db.OneOnOneMeetings.AsNoTracking()
                              join series in db.OneOnOneSeries.AsNoTracking() on item.SeriesId equals series.Id
                              where series.ManagerEmployeeId == caller && series.ReportEmployeeId == plan.EmployeeId && series.EndedAt == null
                                    && item.State == OneOnOneMeetingState.Upcoming
                              orderby item.ScheduledAt
                              select (Guid?)item.Id).FirstOrDefaultAsync(token);
            // Loaded on its own so the meeting is tracked.
            var meeting = next is Guid id ? await db.OneOnOneMeetings.Include(m => m.Agenda).FirstAsync(m => m.Id == id, token) : null;
            if (meeting is null)
                return Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneWrongState,
                    $"You don't have 1:1s with {plan.EmployeeDisplayName} yet."));
            try
            {
                foreach (var goal in flagged.Where(g => !meeting.Agenda.Any(i => i.SourceKind == AgendaSourceKind.Objective && i.SourceId == g.Id)))
                    meeting.AddAgendaItem(Guid.NewGuid(), goal.Title.Length <= 120 ? goal.Title : goal.Title[..120], caller,
                        new AgendaSource(AgendaSourceKind.Objective, goal.Id, cycle.Id), out _);
            }
            catch (InvalidOperationException ex) { return Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneWrongState, ex.Message)); }
            catch (ArgumentException ex) { return Fail(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneInvalid, ex.Message)); }
        }

        foreach (var goal in flagged.Where(goal => goal.AcknowledgeStatus(caller, now)))
            audit.Record(goal.TenantId, "Objective", goal.Id, cycle.Id, PerformanceAuditActions.ObjectiveStatusAcknowledged,
                new { before = new { acknowledged = false }, after = new { acknowledged = true }, status = goal.CurrentStatus?.ToString(),
                    since = goal.StatusSince, answer = command.Answer.ToString() });
        await db.SaveChangesAsync(token);
        return Result.Success(new OffTrackAnsweredDto(flagged.Count));
    }

    private static Result<OffTrackAnsweredDto> Fail(Error error) => Result.Failure<OffTrackAnsweredDto>(error);
}
