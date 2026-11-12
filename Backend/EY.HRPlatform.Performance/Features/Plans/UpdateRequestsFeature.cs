using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
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

public sealed record CreateUpdateRequestRequest(Guid? ObjectiveId, string? Note);
public sealed record UpdateRequestDto(Guid Id, Guid CycleId, Guid PlanId, Guid? ObjectiveId, string? ObjectiveTitle,
    string RequestedByName, DateTime RequestedAt, string? Note, UpdateRequestState State, DateTime? SatisfiedAt, DateTime? ClosedAt, uint Version);

public sealed record CreateUpdateRequestCommand(Guid CycleId, Guid PlanId, Guid? ObjectiveId, string? Note, PlanActorContext Actor, string ActorName)
    : ICommand<Result<UpdateRequestDto>>;
public sealed record ListUpdateRequestsQuery(Guid CycleId, Guid PlanId, PlanActorContext Actor) : IQuery<Result<IReadOnlyList<UpdateRequestDto>>>;
public sealed record WithdrawUpdateRequestCommand(Guid RequestId, uint ExpectedVersion, PlanActorContext Actor) : ICommand<Result<UpdateRequestDto>>;

/// <summary>
/// Saves a progress update together with the requests it satisfied. Two updates on different objectives can
/// both satisfy one plan-level request; the first commit wins it and the other's claim is dropped, so the
/// later progress still saves instead of failing as changed. Any other conflict still surfaces.
/// </summary>
public static class UpdateRequestSatisfaction
{
    public static async Task SaveAsync(PerformanceDbContext db, CancellationToken token)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(token);
                return;
            }
            catch (DbUpdateConcurrencyException ex) when (attempt < 2 && ex.Entries.All(entry => entry.Entity is UpdateRequest))
            {
                foreach (var entry in ex.Entries)
                {
                    var requestId = ((UpdateRequest)entry.Entity).Id;
                    foreach (var claim in db.ChangeTracker.Entries<PerformanceAuditEntry>()
                        .Where(item => item.State == EntityState.Added && item.Entity.ResourceId == requestId
                            && item.Entity.Action == PerformanceAuditActions.UpdateRequestSatisfied).ToList())
                        claim.State = EntityState.Detached;
                    // The other update answered it first, and its requester was told then.
                    foreach (var told in db.ChangeTracker.Entries<PerformanceOutboxMessage>()
                        .Where(item => item.State == EntityState.Added && item.Entity.ResourceId == requestId
                            && item.Entity.Kind == PerformanceNotificationKind.UpdateRequestAnswered).ToList())
                        told.State = EntityState.Detached;
                    foreach (var told in db.ChangeTracker.Entries<PerformanceNotification>()
                        .Where(item => item.State == EntityState.Added && item.Entity.ResourceId == requestId
                            && item.Entity.Kind == PerformanceNotificationKind.UpdateRequestAnswered).ToList())
                        told.State = EntityState.Detached;
                    await entry.ReloadAsync(token);
                }
            }
        }
    }
}

public static class UpdateRequests
{
    public static async Task<UpdateRequestDto> ToDtoAsync(PerformanceDbContext db, UpdateRequest request, CancellationToken token)
    {
        var title = request.ObjectiveId is Guid objectiveId
            ? await db.Objectives.AsNoTracking().Where(o => o.Id == objectiveId).Select(o => o.Title).FirstOrDefaultAsync(token)
            : null;
        return ToDto(request, title);
    }

    public static UpdateRequestDto ToDto(UpdateRequest request, string? objectiveTitle)
        => new(request.Id, request.CycleId, request.PlanId, request.ObjectiveId, objectiveTitle, request.RequestedByName,
            request.RequestedAt, request.Note, request.State, request.SatisfiedAt, request.ClosedAt, request.Version);

    /// <summary>
    /// Runs inside the progress transaction: a check-in on an objective satisfies the open request on that
    /// objective and the open request on its plan, when they were made before it, and tells each requester.
    /// </summary>
    public static async Task SatisfyAsync(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications,
        EmployeePlan plan, Objective objective, ProgressUpdate update, CancellationToken token)
    {
        var open = await db.UpdateRequests.Where(r => r.PlanId == plan.Id && r.State == UpdateRequestState.Open
            && (r.ObjectiveId == objective.Id || r.ObjectiveId == null)).ToListAsync(token);
        foreach (var request in open.Where(r => r.SatisfyBy(update.Id, update.RecordedAt)))
        {
            audit.Record(request.TenantId, "UpdateRequest", request.Id, request.CycleId, PerformanceAuditActions.UpdateRequestSatisfied,
                new { before = UpdateRequestState.Open.ToString(), after = request.State.ToString(), progressUpdateId = update.Id });
            notifications.EnqueueUpdateRequestAnswered(request, plan.EmployeeDisplayName,
                request.ObjectiveId is null ? null : objective.Title);
        }
    }

    /// <summary>At Cycle close, whatever is still open is recorded as unresolved.</summary>
    public static async Task CloseOpenAsync(PerformanceDbContext db, IPerformanceAudit audit, Guid cycleId, DateTime at, CancellationToken token)
    {
        var open = await db.UpdateRequests.Where(r => r.CycleId == cycleId && r.State == UpdateRequestState.Open).ToListAsync(token);
        foreach (var request in open.Where(r => r.CloseUnresolved(at)))
            audit.Record(request.TenantId, "UpdateRequest", request.Id, request.CycleId, PerformanceAuditActions.UpdateRequestUnresolved,
                new { before = UpdateRequestState.Open.ToString(), after = request.State.ToString() });
    }

    public static Error NotReviewer() => PerformanceErrors.Forbidden(PerformanceErrors.Codes.UpdateRequestForbidden,
        "Only the plan's responsible reviewer can request or withdraw an update.");
}

public sealed class CreateUpdateRequestHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<CreateUpdateRequestCommand, Result<UpdateRequestDto>>
{
    public async Task<Result<UpdateRequestDto>> Handle(CreateUpdateRequestCommand command, CancellationToken token)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == command.CycleId, token);
        if (cycle is null) return Result.Failure<UpdateRequestDto>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == command.PlanId && p.CycleId == cycle.Id, token);
        if (plan is null) return Result.Failure<UpdateRequestDto>(PerformanceErrors.NotFound("EmployeePlan", command.PlanId));
        var caller = command.Actor.CallerEmployeeId;
        if (!PlanPolicy.CanRequestUpdate(command.Actor.ToGoalActor(), plan, cycle))
        {
            if (!PlanPolicy.IsResponsibleReviewer(command.Actor.ToGoalActor(), plan))
                return Result.Failure<UpdateRequestDto>(UpdateRequests.NotReviewer());
            return Result.Failure<UpdateRequestDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.UpdateRequestNotAllowed,
                "Updates can be requested only for an approved plan in an Active Cycle."));
        }

        var objective = command.ObjectiveId is Guid objectiveId
            ? await db.Objectives.AsNoTracking().FirstOrDefaultAsync(o => o.Id == objectiveId && o.CycleId == cycle.Id, token)
            : null;
        if (command.ObjectiveId is Guid missing && objective is null)
            return Result.Failure<UpdateRequestDto>(PerformanceErrors.NotFound("Objective", missing));

        // Asking again for the same target returns the request that is already open.
        var target = objective?.Id ?? plan.Id;
        var existing = await db.UpdateRequests.AsNoTracking().FirstOrDefaultAsync(r => r.TargetKey == target && r.State == UpdateRequestState.Open, token);
        if (existing is not null) return Result.Success(UpdateRequests.ToDto(existing, objective?.Title));

        UpdateRequest request;
        try { request = UpdateRequest.Create(plan, objective, caller, command.ActorName, command.Note, PerformanceClock.UtcNow); }
        catch (InvalidOperationException ex) { return Result.Failure<UpdateRequestDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.UpdateRequestNotAllowed, ex.Message)); }
        catch (ArgumentException ex) { return Result.Failure<UpdateRequestDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.UpdateRequestInvalid, ex.Message)); }
        catch (UnauthorizedAccessException) { return Result.Failure<UpdateRequestDto>(UpdateRequests.NotReviewer()); }

        db.UpdateRequests.Add(request);
        audit.Record(request.TenantId, "UpdateRequest", request.Id, request.CycleId, PerformanceAuditActions.UpdateRequested,
            new { after = request.State.ToString(), request.PlanId, request.ObjectiveId, hasNote = request.Note is not null });
        notifications.EnqueueUpdateRequested(request, objective?.Title);
        try { await db.SaveChangesAsync(token); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent identical request won the open slot: return it, as a repeat would.
            db.ChangeTracker.Clear();
            var winner = await db.UpdateRequests.AsNoTracking().FirstAsync(r => r.TargetKey == target && r.State == UpdateRequestState.Open, token);
            return Result.Success(UpdateRequests.ToDto(winner, objective?.Title));
        }
        return Result.Success(UpdateRequests.ToDto(request, objective?.Title));
    }
}

public sealed class ListUpdateRequestsHandler(PerformanceDbContext db)
    : IQueryHandler<ListUpdateRequestsQuery, Result<IReadOnlyList<UpdateRequestDto>>>
{
    public async Task<Result<IReadOnlyList<UpdateRequestDto>>> Handle(ListUpdateRequestsQuery query, CancellationToken token)
    {
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == query.PlanId && p.CycleId == query.CycleId, token);
        if (plan is null) return Result.Failure<IReadOnlyList<UpdateRequestDto>>(PerformanceErrors.NotFound("EmployeePlan", query.PlanId));
        var caller = query.Actor.CallerEmployeeId;
        var isOwner = caller != Guid.Empty && plan.EmployeeId == caller;
        var isAuthorizedReviewer = caller != Guid.Empty && query.Actor.CanReviewReports && plan.ResponsibleManagerId == caller;
        var related = isOwner || isAuthorizedReviewer;
        if (!related && !query.Actor.IsAdmin)
            return Result.Failure<IReadOnlyList<UpdateRequestDto>>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.UpdateRequestForbidden,
                "You do not have a relationship to this plan."));
        var requests = await db.UpdateRequests.AsNoTracking().Where(r => r.PlanId == plan.Id)
            .OrderByDescending(r => r.RequestedAt).ToListAsync(token);
        var objectiveIds = requests.Where(r => r.ObjectiveId != null).Select(r => r.ObjectiveId!.Value).Distinct().ToArray();
        var titles = await db.Objectives.AsNoTracking().Where(o => objectiveIds.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, o => o.Title, token);
        return Result.Success<IReadOnlyList<UpdateRequestDto>>(requests
            .Select(r => UpdateRequests.ToDto(r, r.ObjectiveId is Guid id ? titles.GetValueOrDefault(id) : null)).ToArray());
    }
}

public sealed class WithdrawUpdateRequestHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<WithdrawUpdateRequestCommand, Result<UpdateRequestDto>>
{
    public async Task<Result<UpdateRequestDto>> Handle(WithdrawUpdateRequestCommand command, CancellationToken token)
    {
        var request = await db.UpdateRequests.FirstOrDefaultAsync(r => r.Id == command.RequestId, token);
        if (request is null) return Result.Failure<UpdateRequestDto>(PerformanceErrors.NotFound("UpdateRequest", command.RequestId));
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == request.PlanId, token);
        if (plan is null) return Result.Failure<UpdateRequestDto>(PerformanceErrors.NotFound("EmployeePlan", request.PlanId));
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, token);
        if (cycle is null) return Result.Failure<UpdateRequestDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));
        if (!PlanPolicy.IsResponsibleReviewer(command.Actor.ToGoalActor(), plan))
            return Result.Failure<UpdateRequestDto>(UpdateRequests.NotReviewer());
        if (request.State == UpdateRequestState.Withdrawn)
            return Result.Success(await UpdateRequests.ToDtoAsync(db, request, token));
        if (!PlanPolicy.CanRequestUpdate(command.Actor.ToGoalActor(), plan, cycle))
        {
            if (!PlanPolicy.IsResponsibleReviewer(command.Actor.ToGoalActor(), plan))
                return Result.Failure<UpdateRequestDto>(UpdateRequests.NotReviewer());
            return Result.Failure<UpdateRequestDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.UpdateRequestNotAllowed,
                "Updates can be withdrawn only while the plan is approved in an Active Cycle."));
        }
        if (VersionGuard.Check(request, command.ExpectedVersion) is { } stale)
            return Result.Failure<UpdateRequestDto>(stale);
        try
        {
            if (request.Withdraw(PerformanceClock.UtcNow))
            {
                audit.Record(request.TenantId, "UpdateRequest", request.Id, request.CycleId, PerformanceAuditActions.UpdateRequestWithdrawn,
                    new { before = UpdateRequestState.Open.ToString(), after = request.State.ToString() });
                await db.SaveChangesAsync(token);
            }
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<UpdateRequestDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.UpdateRequestNotAllowed, ex.Message));
        }
        return Result.Success(await UpdateRequests.ToDtoAsync(db, request, token));
    }
}
