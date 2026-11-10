using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Plans;

// ── Queries ────────────────────────────────────────────────────────────────────

public sealed record GetMyPlanQuery(Guid CycleId, PlanActorContext Actor) : IQuery<Result<MyPlanStateDto>>;
public sealed record GetAlignmentTargetsQuery(Guid CycleId, PlanActorContext Actor) : IQuery<Result<IReadOnlyList<AlignmentTargetDto>>>;
public sealed record GetCyclePlanSummaryQuery(Guid CycleId) : IQuery<Result<CyclePlanSummaryDto>>;
public sealed record GetPlanForReviewQuery(Guid CycleId, Guid PlanId, PlanActorContext Actor) : IQuery<Result<EmployeePlanDto>>;

// ── Commands ───────────────────────────────────────────────────────────────────

public sealed record CreateMyPlanCommand(Guid CycleId, PlanActorContext Actor, uint ExpectedVersion = 0) : ICommand<Result<EmployeePlanDto>>;
public sealed record AddPlanObjectiveCommand(Guid CycleId, AddPlanObjectiveRequest Request, PlanActorContext Actor) : ICommand<Result<EmployeePlanDto>>;
public sealed record UpdatePlanObjectiveCommand(Guid CycleId, Guid ObjectiveId, UpdatePlanObjectiveRequest Request, PlanActorContext Actor) : ICommand<Result<EmployeePlanDto>>;
public sealed record RemovePlanObjectiveCommand(Guid CycleId, Guid ObjectiveId, PlanActorContext Actor, uint ExpectedVersion = 0) : ICommand<Result<EmployeePlanDto>>;
public sealed record SetPlanWeightsCommand(Guid CycleId, SetPlanWeightsRequest Request, PlanActorContext Actor) : ICommand<Result<EmployeePlanDto>>;
public sealed record SubmitMyPlanCommand(Guid CycleId, PlanActorContext Actor, uint ExpectedVersion = 0) : ICommand<Result<EmployeePlanDto>>;
public sealed record ReturnPlanCommand(Guid CycleId, Guid PlanId, ReturnPlanRequest Request, PlanActorContext Actor) : ICommand<Result<EmployeePlanDto>>;
public sealed record AddressChangeRequestCommand(Guid CycleId, Guid RequestId, AddressChangeRequestRequest Request, PlanActorContext Actor) : ICommand<Result<EmployeePlanDto>>;
public sealed record ApprovePlanCommand(Guid CycleId, Guid PlanId, PlanActorContext Actor, uint ExpectedVersion = 0) : ICommand<Result<EmployeePlanDto>>;
public sealed record ExceptionalApprovePlanCommand(Guid CycleId, Guid PlanId, ExceptionalApprovePlanRequest Request, PlanActorContext Actor) : ICommand<Result<EmployeePlanDto>>;

// ── Shared base ────────────────────────────────────────────────────────────────

public abstract class PlanHandlerBase(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
{
    protected PerformanceDbContext Db => db;
    protected ICoreWorkforceClient Workforce => workforce;
    protected ITenantContext Tenant => tenant;

    protected async Task<Result<PerformanceCycle>> LoadOpenCycleAsync(Guid cycleId, CancellationToken cancellationToken, bool allowClosed = false)
    {
        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == cycleId, cancellationToken);
        if (cycle is null)
            return Result.Failure<PerformanceCycle>(PerformanceErrors.NotFound("Cycle", cycleId));
        // Employee planning opens at activation: a Draft Cycle's roster is still being shaped.
        if (cycle.IsDraft)
            return Result.Failure<PerformanceCycle>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotActive, "Planning opens when the Cycle is launched."));
        if (cycle.IsClosed && !allowClosed)
            return Result.Failure<PerformanceCycle>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleClosed, "A Closed Cycle is read-only; plan authoring is not available."));
        return Result.Success(cycle);
    }

    protected async Task<PlanAlignmentPolicy> AlignmentPolicyAsync(PerformanceCycle cycle, CancellationToken cancellationToken)
    {
        var snapshot = await db.Set<ActivationSnapshot>().AsNoTracking().FirstOrDefaultAsync(s => s.CycleId == cycle.Id, cancellationToken);
        return snapshot is null ? PlanAlignmentPolicy.AtLeastOneConnected : PlanAlignmentSnapshots.Read(snapshot.SettingsJson);
    }

    protected Task<EmployeePlan?> LoadPlanTrackedAsync(Guid cycleId, Guid planId, CancellationToken cancellationToken)
        => db.EmployeePlans.Include(p => p.Decisions).FirstOrDefaultAsync(p => p.Id == planId && p.CycleId == cycleId, cancellationToken);

    protected Task<EmployeePlan?> LoadMyPlanTrackedAsync(Guid cycleId, Guid employeeId, CancellationToken cancellationToken)
        => db.EmployeePlans.Include(p => p.Decisions).FirstOrDefaultAsync(p => p.CycleId == cycleId && p.EmployeeId == employeeId, cancellationToken);

    protected async Task<Result<EmployeePlanDto>> ProjectAsync(PerformanceCycle cycle, Guid planId, PlanActorContext actor, CancellationToken cancellationToken)
    {
        var plan = await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions).FirstOrDefaultAsync(p => p.Id == planId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", planId));
        var alignmentPolicy = await AlignmentPolicyAsync(cycle, cancellationToken);
        var dto = await PlansComposer.BuildPlanAsync(db, workforce, cycle, plan, alignmentPolicy, actor, cancellationToken);
        return Result.Success(dto);
    }

    /// <summary>
    /// A new plan-decision row (and the change requests a return carries) reached through an already-tracked plan
    /// is detected Modified; correct it to Added.
    /// </summary>
    /// <summary>
    /// Shares the weights nobody chose evenly across the plan's goals as they stand in this unit of work (D-40): saved
    /// goals, goals just added, without goals just removed.
    /// </summary>
    protected async Task RebalanceWeightsAsync(Guid planId, CancellationToken cancellationToken)
    {
        var stored = await Db.Objectives.Where(o => o.EmployeePlanId == planId).ToListAsync(cancellationToken);
        var goals = stored.Concat(Db.Objectives.Local.Where(o => o.EmployeePlanId == planId))
            .Distinct()
            .Where(o => Db.Entry(o).State != EntityState.Deleted);
        PlanWeights.Rebalance(goals);
    }

    protected void FixNewPlanRows()
    {
        var added = new HashSet<Guid>();
        foreach (var entry in Db.ChangeTracker.Entries<PlanDecision>().Where(e => e.State == EntityState.Modified).ToList())
        {
            entry.State = EntityState.Added;
            added.Add(entry.Entity.Id);
        }
        foreach (var entry in Db.ChangeTracker.Entries<PlanChangeRequest>()
            .Where(e => e.State == EntityState.Modified && added.Contains(e.Entity.DecisionId)).ToList())
            entry.State = EntityState.Added;
    }
}

// ── Query handlers ───────────────────────────────────────────────────────────────

public sealed class GetMyPlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), IQueryHandler<GetMyPlanQuery, Result<MyPlanStateDto>>
{
    public async Task<Result<MyPlanStateDto>> Handle(GetMyPlanQuery request, CancellationToken cancellationToken)
    {
        var cycle = await Db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<MyPlanStateDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var employeeId = request.Actor.CallerEmployeeId;
        var participant = await Db.Participants.AsNoTracking()
            .FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, cancellationToken);
        if (participant is null)
            return Result.Success(new MyPlanStateDto(false, false, null));

        var plan = await Db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, cancellationToken);
        if (plan is null)
        {
            var reviewer = participant.ManagerEmployeeId is null
                ? null
                : new PersonRefDto(participant.ManagerEmployeeId.Value, participant.ManagerDisplayName ?? string.Empty);
            var preview = new PlanPreviewDto(reviewer, participant.OrgUnitName, (await AlignmentPolicyAsync(cycle, cancellationToken)) != PlanAlignmentPolicy.EveryObjectiveConnected)
            {
                ReviewerBasis = reviewer is null ? null : participant.ReviewerBasis,
                ReviewerAsOf = reviewer is null ? null : participant.ReviewerAsOf,
            };
            return Result.Success(new MyPlanStateDto(true, false, null, preview));
        }

        var alignmentPolicy = await AlignmentPolicyAsync(cycle, cancellationToken);
        var dto = await PlansComposer.BuildPlanAsync(Db, Workforce, cycle, plan, alignmentPolicy, request.Actor, cancellationToken);
        return Result.Success(new MyPlanStateDto(true, true, dto));
    }
}

public sealed class GetAlignmentTargetsHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), IQueryHandler<GetAlignmentTargetsQuery, Result<IReadOnlyList<AlignmentTargetDto>>>
{
    public async Task<Result<IReadOnlyList<AlignmentTargetDto>>> Handle(GetAlignmentTargetsQuery request, CancellationToken cancellationToken)
    {
        var cycle = await Db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<IReadOnlyList<AlignmentTargetDto>>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var graph = await GoalsComposer.LoadGraphAsync(Db, Workforce, cycle, cancellationToken, new CycleViewer(request.Actor.ToGoalActor(), null));
        return Result.Success(PlansComposer.AlignmentTargets(graph));
    }
}

/// <summary>
/// Administration's cycle-wide view of planning and execution: every participant's plan classified the
/// same way the manager roster classifies it, reduced to counts. Authorization is the controller's.
/// </summary>
public sealed class GetCyclePlanSummaryHandler(PerformanceDbContext db)
    : IQueryHandler<GetCyclePlanSummaryQuery, Result<CyclePlanSummaryDto>>
{
    public async Task<Result<CyclePlanSummaryDto>> Handle(GetCyclePlanSummaryQuery request, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<CyclePlanSummaryDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var participants = await db.Participants.AsNoTracking()
            .Where(p => p.CycleId == cycle.Id)
            .Select(p => p.EmployeeId)
            .ToListAsync(cancellationToken);
        var plans = await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .Where(p => p.CycleId == cycle.Id)
            .ToListAsync(cancellationToken);
        var planByEmployee = plans.GroupBy(p => p.EmployeeId).ToDictionary(g => g.Key, g => g.First());
        var objectivesByPlan = (await db.Objectives.AsNoTracking()
                .Include(o => o.Measurement)
                .Where(o => o.CycleId == cycle.Id && o.EmployeePlanId != null)
                .ToListAsync(cancellationToken))
            .ToLookup(o => o.EmployeePlanId!.Value);
        var today = PerformanceClock.Today;

        var standings = participants
            .Select(employeeId => planByEmployee.GetValueOrDefault(employeeId))
            .Select(plan => PlansComposer.Classify(
                plan, plan is null ? [] : objectivesByPlan[plan.Id].ToList(), today))
            .ToList();
        int Count(RosterPlanStatus status) => standings.Count(s => s.Status == status);
        var approved = standings.Where(s => s.Status == RosterPlanStatus.Approved).ToList();

        return Result.Success(new CyclePlanSummaryDto(
            cycle.Id,
            standings.Count,
            Count(RosterPlanStatus.NotStarted),
            Count(RosterPlanStatus.Draft),
            Count(RosterPlanStatus.ReturnedForChanges),
            Count(RosterPlanStatus.Submitted),
            approved.Count,
            approved.Count(s => s.HasProgress),
            approved.Count(s => !s.HasProgress),
            approved.Count(s => s.OverdueObjectiveCount > 0)));
    }
}

public sealed class GetPlanForReviewHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), IQueryHandler<GetPlanForReviewQuery, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(GetPlanForReviewQuery request, CancellationToken cancellationToken)
    {
        var cycle = await Db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var plan = await Db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .FirstOrDefaultAsync(p => p.Id == request.PlanId && p.CycleId == cycle.Id, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", request.PlanId));

        // The plan's own employee and administration always; the responsible manager once it is put forward.
        if (!PlanPolicy.CanRead(request.Actor.ToGoalActor(), plan))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanViewForbidden, "You are not authorized to view this plan."));

        var alignmentPolicy = await AlignmentPolicyAsync(cycle, cancellationToken);
        var dto = await PlansComposer.BuildPlanAsync(Db, Workforce, cycle, plan, alignmentPolicy, request.Actor, cancellationToken);
        return Result.Success(dto);
    }
}

// ── Command handlers ─────────────────────────────────────────────────────────────

public sealed class CreateMyPlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<CreateMyPlanCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(CreateMyPlanCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;
        var employeeId = command.Actor.CallerEmployeeId;

        var existing = await LoadMyPlanTrackedAsync(cycle.Id, employeeId, cancellationToken);
        if (existing is not null)
            return await ProjectAsync(cycle, existing.Id, command.Actor, cancellationToken);

        if (VersionGuard.Check(cycle, command.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        var participant = await Db.Participants.AsNoTracking()
            .FirstOrDefaultAsync(p => p.CycleId == cycle.Id && p.EmployeeId == employeeId, cancellationToken);
        if (participant is null)
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanNotParticipant, "You are not a participant in this Cycle."));

        try
        {
            var plan = EmployeePlan.Create(
                Tenant.TenantId,
                cycle.Id,
                participant.Id,
                participant.EmployeeId,
                participant.DisplayName,
                participant.OrgUnitName,
                participant.ManagerEmployeeId,
                participant.ManagerDisplayName);

            Db.EmployeePlans.Add(plan);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent create raced us; return the winning plan (one-plan-per-participant invariant).
            var winner = await LoadMyPlanTrackedAsync(cycle.Id, employeeId, cancellationToken);
            if (winner is not null) return await ProjectAsync(cycle, winner.Id, command.Actor, cancellationToken);
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanConflict, "A plan already exists for this participant."));
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanInvalid, ex.Message));
        }
    }
}

public sealed class AddPlanObjectiveHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<AddPlanObjectiveCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(AddPlanObjectiveCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadMyPlanTrackedAsync(cycle.Id, command.Actor.CallerEmployeeId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.Actor.CallerEmployeeId));
        if (!PlansComposer.CanAuthor(plan, command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanAuthorForbidden, "Only you can author your own plan while it is Draft."));

        var request = command.Request;
        var parentResult = await ResolveAlignmentAsync(cycle, request.ParentObjectiveId, cancellationToken);
        if (parentResult.IsFailure) return Result.Failure<EmployeePlanDto>(parentResult.Error);
        var parent = parentResult.Value;

        if (VersionGuard.Check(plan, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        try
        {
            var measurement = PerformanceMappers.ToMeasurement(request.Measurement, Tenant.TenantId);
            var objective = Objective.CreateEmployee(
                Tenant.TenantId,
                cycle.Id,
                plan.Id,
                command.Actor.CallerEmployeeId,
                request.Title,
                request.Description,
                request.ParentObjectiveId,
                request.StartDate ?? parent?.StartDate ?? cycle.StartDate,
                request.EndDate ?? parent?.EndDate ?? cycle.EndDate,
                measurement,
                request.PlanWeight,
                parent?.StartDate,
                parent?.EndDate,
                cycle.StartDate,
                cycle.EndDate);

            Db.Objectives.Add(objective);
            plan.RecordEdit();
            await RebalanceWeightsAsync(plan.Id, cancellationToken);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanObjectiveInvalid, ex.Message));
        }
    }

    private async Task<Result<Objective?>> ResolveAlignmentAsync(PerformanceCycle cycle, Guid? parentObjectiveId, CancellationToken cancellationToken)
    {
        if (parentObjectiveId is null) return Result.Success<Objective?>(null);
        var parent = await Db.Objectives.AsNoTracking().FirstOrDefaultAsync(o => o.Id == parentObjectiveId.Value, cancellationToken);
        if (parent is null) return Result.Failure<Objective?>(PerformanceErrors.NotFound("ParentObjective", parentObjectiveId.Value));
        if (parent.CycleId != cycle.Id)
            return Result.Failure<Objective?>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanAlignment, "The aligned objective belongs to a different Cycle."));
        if (!parent.IsAlignmentBaseline)
            return Result.Failure<Objective?>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanParentNotBaseline, "You can only align to a published objective."));
        if (parent.OwnershipScope == ObjectiveOwnershipScope.Employee)
            return Result.Failure<Objective?>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanAlignment, "An employee objective aligns to strategic or organizational direction, not another plan objective."));
        return Result.Success<Objective?>(parent);
    }
}

public sealed class UpdatePlanObjectiveHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<UpdatePlanObjectiveCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(UpdatePlanObjectiveCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadMyPlanTrackedAsync(cycle.Id, command.Actor.CallerEmployeeId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.Actor.CallerEmployeeId));
        if (!PlansComposer.CanAuthor(plan, command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanAuthorForbidden, "Only you can author your own plan while it is Draft."));

        var objective = await Db.Objectives.Include(o => o.Measurement)
            .FirstOrDefaultAsync(o => o.Id == command.ObjectiveId && o.EmployeePlanId == plan.Id, cancellationToken);
        if (objective is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Objective", command.ObjectiveId));

        var request = command.Request;
        var parentResult = await ResolveAlignmentAsync(cycle, request.ParentObjectiveId, cancellationToken);
        if (parentResult.IsFailure) return Result.Failure<EmployeePlanDto>(parentResult.Error);
        var parent = parentResult.Value;

        if (VersionGuard.Check(plan, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        try
        {
            var measurement = PerformanceMappers.ToMeasurement(request.Measurement, Tenant.TenantId);
            objective.UpdateEmployeeDetails(
                request.Title,
                request.Description,
                request.ParentObjectiveId,
                request.StartDate ?? parent?.StartDate ?? cycle.StartDate,
                request.EndDate ?? parent?.EndDate ?? cycle.EndDate,
                measurement,
                request.PlanWeight,
                parent?.StartDate,
                parent?.EndDate,
                cycle.StartDate,
                cycle.EndDate);

            plan.RecordEdit();
            await RebalanceWeightsAsync(plan.Id, cancellationToken);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanObjectiveInvalid, ex.Message));
        }
    }

    private async Task<Result<Objective?>> ResolveAlignmentAsync(PerformanceCycle cycle, Guid? parentObjectiveId, CancellationToken cancellationToken)
    {
        if (parentObjectiveId is null) return Result.Success<Objective?>(null);
        var parent = await Db.Objectives.AsNoTracking().FirstOrDefaultAsync(o => o.Id == parentObjectiveId.Value, cancellationToken);
        if (parent is null) return Result.Failure<Objective?>(PerformanceErrors.NotFound("ParentObjective", parentObjectiveId.Value));
        if (parent.CycleId != cycle.Id)
            return Result.Failure<Objective?>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanAlignment, "The aligned objective belongs to a different Cycle."));
        if (!parent.IsAlignmentBaseline)
            return Result.Failure<Objective?>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanParentNotBaseline, "You can only align to a published objective."));
        if (parent.OwnershipScope == ObjectiveOwnershipScope.Employee)
            return Result.Failure<Objective?>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanAlignment, "An employee objective aligns to strategic or organizational direction, not another plan objective."));
        return Result.Success<Objective?>(parent);
    }
}

public sealed class RemovePlanObjectiveHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<RemovePlanObjectiveCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(RemovePlanObjectiveCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadMyPlanTrackedAsync(cycle.Id, command.Actor.CallerEmployeeId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.Actor.CallerEmployeeId));
        if (!PlansComposer.CanAuthor(plan, command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanAuthorForbidden, "Only you can author your own plan while it is Draft."));

        var objective = await Db.Objectives.FirstOrDefaultAsync(o => o.Id == command.ObjectiveId && o.EmployeePlanId == plan.Id, cancellationToken);
        if (objective is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Objective", command.ObjectiveId));

        if (VersionGuard.Check(plan, command.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        Db.Objectives.Remove(objective);
        plan.RecordEdit();
        await RebalanceWeightsAsync(plan.Id, cancellationToken);
        // Removing the objective in question settles the change requested on it (D-09).
        if (plan.ObjectiveRemoved(objective.Id) is { } settled)
            audit.Record(plan.TenantId, "EmployeePlan", plan.Id, cycle.Id, PerformanceAuditActions.PlanChangeRequestAddressed,
                new { before = PlanChangeRequestState.Open.ToString(), after = settled.State.ToString(), changeRequestId = settled.Id, objectiveId = objective.Id });
        await Db.SaveChangesAsync(cancellationToken);
        return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
    }
}

public sealed class SetPlanWeightsHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<SetPlanWeightsCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(SetPlanWeightsCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadMyPlanTrackedAsync(cycle.Id, command.Actor.CallerEmployeeId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.Actor.CallerEmployeeId));
        if (!PlansComposer.CanAuthor(plan, command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanAuthorForbidden, "Only you can author your own plan while it is Draft."));

        var objectives = await Db.Objectives.Where(o => o.EmployeePlanId == plan.Id).ToListAsync(cancellationToken);
        var byId = objectives.ToDictionary(o => o.Id);

        if (VersionGuard.Check(plan, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        try
        {
            foreach (var weight in command.Request.Weights)
            {
                if (!byId.TryGetValue(weight.ObjectiveId, out var objective))
                    return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanWeight, "A weight was given for an objective not in your plan."));
                objective.SetPlanWeight(weight.Weight);
            }

            PlanWeights.Rebalance(objectives);
            plan.RecordEdit();
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanWeight, ex.Message));
        }
    }
}

public sealed class SubmitMyPlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<SubmitMyPlanCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(SubmitMyPlanCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken, allowClosed: true);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadMyPlanTrackedAsync(cycle.Id, command.Actor.CallerEmployeeId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.Actor.CallerEmployeeId));

        if (plan.IsTransitionRetry(PlanDecisionKind.Submitted, command.Actor.CallerEmployeeId, null))
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        if (cycle.IsClosed)
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleClosed, "A Closed Cycle is read-only."));

        var alignmentPolicy = await AlignmentPolicyAsync(cycle, cancellationToken);
        var graph = await GoalsComposer.LoadGraphAsync(Db, Workforce, cycle, cancellationToken);
        var facts = PlansComposer.FactsFor(plan, graph, alignmentPolicy);

        if (VersionGuard.Check(plan, command.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        var before = plan.State.ToString();
        try
        {
            plan.Submit(command.Actor.CallerEmployeeId, facts);
            FixNewPlanRows();
            audit.Record(plan.TenantId, "EmployeePlan", plan.Id, cycle.Id, PerformanceAuditActions.PlanSubmitted,
                new { before, after = plan.State.ToString(), reason = (string?)null });
            notifications.EnqueuePlan(plan, PerformanceNotificationKind.PlanSubmitted, plan.EmployeeDisplayName);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanNotSubmittable, ex.Message));
        }
    }
}

public sealed class ReturnPlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<ReturnPlanCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(ReturnPlanCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken, allowClosed: true);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadPlanTrackedAsync(cycle.Id, command.PlanId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.PlanId));
        if (!PlansComposer.CanDecide(plan, command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanDecideForbidden, "Only the responsible manager can return this plan."));

        // Each request must name an objective of this plan; titles are kept with the request.
        var goals = await Db.Objectives.AsNoTracking().Where(o => o.EmployeePlanId == plan.Id).ToListAsync(cancellationToken);
        var titles = goals.ToDictionary(o => o.Id, o => o.Title);
        var inputs = command.Request.ChangeRequests ?? [];
        if (inputs.Any(input => !titles.ContainsKey(input.ObjectiveId)))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanChangeRequestInvalid,
                "Change requests can only target objectives in this plan."));
        var drafts = inputs.Select(input => new PlanChangeRequestDraft(input.ObjectiveId, titles[input.ObjectiveId], input.Text ?? string.Empty)).ToList();

        if (plan.IsTransitionRetry(PlanDecisionKind.Returned, command.Actor.CallerEmployeeId, command.Request.Feedback, drafts))
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        if (cycle.IsClosed)
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleClosed, "A Closed Cycle is read-only."));

        if (VersionGuard.Check(plan, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        var before = plan.State.ToString();
        try
        {
            plan.Return(command.Actor.CallerEmployeeId, command.Request.Feedback, drafts, goals.Select(PlansComposer.Snapshot).ToList());
            FixNewPlanRows();
            audit.Record(plan.TenantId, "EmployeePlan", plan.Id, cycle.Id, PerformanceAuditActions.PlanReturned,
                new { before, after = plan.State.ToString(), reason = (string?)command.Request.Feedback,
                    changeRequests = drafts.Select(draft => draft.ObjectiveId).ToList() });
            notifications.EnqueuePlan(plan, PerformanceNotificationKind.PlanReturned, plan.ResponsibleManagerName);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanFeedback, ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanNotReturnable, ex.Message));
        }
    }
}

/// <summary>The plan's owner marks a change request from the latest return addressed, optionally replying (D-09).</summary>
public sealed class AddressChangeRequestHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<AddressChangeRequestCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(AddressChangeRequestCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var decisionId = await Db.PlanChangeRequests.AsNoTracking().Where(r => r.Id == command.RequestId)
            .Select(r => (Guid?)r.DecisionId).FirstOrDefaultAsync(cancellationToken);
        var planId = decisionId is null ? null
            : await Db.PlanDecisions.AsNoTracking().Where(d => d.Id == decisionId).Select(d => (Guid?)d.PlanId).FirstOrDefaultAsync(cancellationToken);
        var plan = planId is Guid id ? await LoadPlanTrackedAsync(cycle.Id, id, cancellationToken) : null;
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("ChangeRequest", command.RequestId));
        if (plan.EmployeeId != command.Actor.CallerEmployeeId)
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanChangeRequestForbidden,
                "Only the plan's own employee marks its change requests addressed."));

        var request = plan.Decisions.SelectMany(d => d.ChangeRequests).First(r => r.Id == command.RequestId);
        // A retry after success finds it addressed and returns the plan unchanged.
        if (request.State == PlanChangeRequestState.Addressed && request.Reply == Normalize(command.Request.Reply)
            && plan.ActiveReturn?.ChangeRequests.Contains(request) == true)
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        if (VersionGuard.Check(plan, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        try
        {
            if (plan.AddressChangeRequest(command.Actor.CallerEmployeeId, request.Id, command.Request.Reply))
                audit.Record(plan.TenantId, "EmployeePlan", plan.Id, cycle.Id, PerformanceAuditActions.PlanChangeRequestAddressed,
                    new { before = PlanChangeRequestState.Open.ToString(), after = request.State.ToString(), changeRequestId = request.Id,
                        objectiveId = request.ObjectiveId, reply = request.Reply });
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanChangeRequestInvalid, ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanChangeRequestNotOpen, ex.Message));
        }
    }

    private static string? Normalize(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public sealed class ApprovePlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<ApprovePlanCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(ApprovePlanCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken, allowClosed: true);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        var plan = await LoadPlanTrackedAsync(cycle.Id, command.PlanId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.PlanId));
        if (!PlansComposer.CanDecide(plan, command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanDecideForbidden, "Only the responsible manager can approve this plan."));

        if (plan.IsTransitionRetry(PlanDecisionKind.Approved, command.Actor.CallerEmployeeId, null))
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        if (cycle.IsClosed)
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleClosed, "A Closed Cycle is read-only."));

        if (VersionGuard.Check(plan, command.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        var before = plan.State.ToString();
        try
        {
            plan.Approve(command.Actor.CallerEmployeeId);
            FixNewPlanRows();
            audit.Record(plan.TenantId, "EmployeePlan", plan.Id, cycle.Id, PerformanceAuditActions.PlanApproved,
                new { before, after = plan.State.ToString(), reason = (string?)null });
            notifications.EnqueuePlan(plan, PerformanceNotificationKind.PlanApproved, plan.ResponsibleManagerName);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanNotApprovable, ex.Message));
        }
    }
}

public sealed class ExceptionalApprovePlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, ITenantContext tenant, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : PlanHandlerBase(db, workforce, tenant), ICommandHandler<ExceptionalApprovePlanCommand, Result<EmployeePlanDto>>
{
    public async Task<Result<EmployeePlanDto>> Handle(ExceptionalApprovePlanCommand command, CancellationToken cancellationToken)
    {
        var cycleResult = await LoadOpenCycleAsync(command.CycleId, cancellationToken, allowClosed: true);
        if (cycleResult.IsFailure) return Result.Failure<EmployeePlanDto>(cycleResult.Error);
        var cycle = cycleResult.Value;

        // The governed escape hatch is tenant administration only, and never the normal manager path.
        if (!PlanPolicy.CanApproveExceptionally(command.Actor))
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.PlanExceptionalForbidden, "Exceptional approval requires tenant performance administration."));

        var plan = await LoadPlanTrackedAsync(cycle.Id, command.PlanId, cancellationToken);
        if (plan is null) return Result.Failure<EmployeePlanDto>(PerformanceErrors.NotFound("Plan", command.PlanId));

        if (plan.IsTransitionRetry(PlanDecisionKind.ApprovedExceptionally, command.Actor.CallerEmployeeId, command.Request.Reason))
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        if (cycle.IsClosed)
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleClosed, "A Closed Cycle is read-only."));

        if (VersionGuard.Check(plan, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<EmployeePlanDto>(stale);

        var before = plan.State.ToString();
        try
        {
            plan.ApproveExceptionally(command.Actor.CallerEmployeeId, command.Request.Reason);
            FixNewPlanRows();
            audit.Record(plan.TenantId, "EmployeePlan", plan.Id, cycle.Id, PerformanceAuditActions.PlanExceptionallyApproved,
                new { before, after = plan.State.ToString(), reason = (string?)command.Request.Reason });
            notifications.EnqueuePlan(plan, PerformanceNotificationKind.PlanApproved, null);
            await Db.SaveChangesAsync(cancellationToken);
            return await ProjectAsync(cycle, plan.Id, command.Actor, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.PlanReason, ex.Message));
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<EmployeePlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PlanNotApprovable, ex.Message));
        }
    }
}
