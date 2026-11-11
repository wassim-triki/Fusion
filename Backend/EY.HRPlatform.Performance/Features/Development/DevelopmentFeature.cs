using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Development;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.People;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Development;

// ── Contracts ────────────────────────────────────────────────────────────────

public sealed record DevelopmentGoalDto(
    Guid Id,
    string Title,
    Guid? CompetencyId,
    string? CompetencyName,
    IReadOnlyList<string> Actions,
    DateOnly? TargetDate,
    DevelopmentGoalStatus Status,
    PersonRefDto AddedBy,
    DateTime UpdatedAt,
    // Set once the goal was carried into a later cycle; it is then read-only here.
    string? CarriedToCycleName,
    bool CarriedFromEarlierCycle);

public sealed record DevelopmentCarryOverDto(Guid FromCycleId, string FromCycleName, IReadOnlyList<DevelopmentGoalDto> Goals);

/// <summary>A participant's development plan in one cycle, as the caller may see and act on it (D-34).</summary>
public sealed record DevelopmentPlanDto(
    Guid CycleId,
    Guid EmployeeId,
    bool Exists,
    uint Version,
    IReadOnlyList<DevelopmentGoalDto> Goals,
    int Room,
    bool CanEdit,
    DevelopmentCarryOverDto? CarryOver)
{
    /// <summary>The tenant's active competencies a goal can name; given to those who edit.</summary>
    public IReadOnlyList<DevelopmentCompetencyOptionDto> CompetencyOptions { get; init; } = [];
}

public sealed record DevelopmentCompetencyOptionDto(Guid Id, string Name);

public sealed record DevelopmentGoalInput(string Title, Guid? CompetencyId, IReadOnlyList<string>? Actions, DateOnly? TargetDate,
    DevelopmentGoalStatus Status)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record CarryOverDevelopmentRequest(IReadOnlyList<Guid> GoalIds)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}

public sealed record GetDevelopmentPlanQuery(Guid CycleId, Guid EmployeeId, PersonSummaryViewer Viewer) : IQuery<Result<DevelopmentPlanDto>>;
public sealed record AddDevelopmentGoalCommand(Guid CycleId, Guid EmployeeId, DevelopmentGoalInput Input, PersonSummaryViewer Viewer) : ICommand<Result<DevelopmentPlanDto>>;
public sealed record UpdateDevelopmentGoalCommand(Guid CycleId, Guid EmployeeId, Guid GoalId, DevelopmentGoalInput Input, PersonSummaryViewer Viewer) : ICommand<Result<DevelopmentPlanDto>>;
public sealed record RemoveDevelopmentGoalCommand(Guid CycleId, Guid EmployeeId, Guid GoalId, uint ExpectedVersion, PersonSummaryViewer Viewer) : ICommand<Result<DevelopmentPlanDto>>;
public sealed record CarryOverDevelopmentGoalsCommand(Guid CycleId, Guid EmployeeId, CarryOverDevelopmentRequest Request, PersonSummaryViewer Viewer) : ICommand<Result<DevelopmentPlanDto>>;
public sealed record DismissDevelopmentCarryOverCommand(Guid CycleId, Guid EmployeeId, uint ExpectedVersion, PersonSummaryViewer Viewer) : ICommand<Result<DevelopmentPlanDto>>;

// ── Who may read and edit ────────────────────────────────────────────────────

/// <summary>
/// One rule for development plans, used by the endpoints and the person summary (D-36): the employee and their
/// responsible reviewer for the cycle edit; the person's current Core HR manager and cycle administrators read.
/// The reviewer is the plan's recorded one, or the participant's captured reviewer before any plan exists.
/// </summary>
public static class DevelopmentPolicy
{
    public static Guid? ResponsibleReviewer(Participant participant, EmployeePlan? plan)
        => plan?.ResponsibleManagerId ?? participant.ManagerEmployeeId;

    public static bool CanEdit(PersonSummaryViewer viewer, Guid employeeId, Guid? reviewerId)
    {
        var me = viewer.EmployeeId;
        if (me == Guid.Empty) return false;
        return (me == employeeId && viewer.ManagesOwnParticipation) || (viewer.ReviewsReports && reviewerId == me);
    }

    public static bool CanRead(PersonSummaryViewer viewer, Guid employeeId, Guid? reviewerId, Guid? coreManagerId)
        => (viewer.EmployeeId != Guid.Empty && viewer.EmployeeId == employeeId)
           || CanEdit(viewer, employeeId, reviewerId)
           || (viewer.ReviewsReports && viewer.EmployeeId != Guid.Empty && coreManagerId == viewer.EmployeeId)
           || viewer.Administers;
}

// ── Shared load and projection ───────────────────────────────────────────────

public abstract class DevelopmentHandlerBase(PerformanceDbContext db, ICoreWorkforceClient workforce)
{
    protected PerformanceDbContext Db => db;

    protected sealed record Context(PerformanceCycle Cycle, Participant Participant, EmployeePlan? ObjectivePlan,
        DevelopmentPlan? Plan, Guid? ReviewerId, bool CanRead, bool CanEdit);

    /// <summary>The cycle, the participant and their plans, and the caller's access — not-found shaped when unseen.</summary>
    protected async Task<Result<Context>> LoadAsync(Guid cycleId, Guid employeeId, PersonSummaryViewer viewer, CancellationToken token, bool tracked = false)
    {
        var notFound = Result.Failure<Context>(PerformanceErrors.NotFound("DevelopmentPlan", employeeId));
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == cycleId && c.State != CycleLifecycleState.Draft, token);
        if (cycle is null) return notFound;
        var participant = await db.Participants.AsNoTracking().FirstOrDefaultAsync(p => p.CycleId == cycleId && p.EmployeeId == employeeId, token);
        var objectivePlan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(p => p.CycleId == cycleId && p.EmployeeId == employeeId, token);
        var reviewer = participant is null ? null : DevelopmentPolicy.ResponsibleReviewer(participant, objectivePlan);

        var canEdit = DevelopmentPolicy.CanEdit(viewer, employeeId, reviewer);
        var canRead = canEdit || viewer.Administers || (viewer.EmployeeId != Guid.Empty && viewer.EmployeeId == employeeId);
        if (!canRead && viewer.ReviewsReports)
        {
            // The current Core HR manager reads; Core owns the reporting line.
            try
            {
                var person = (await workforce.ResolveAsync(PerformanceClock.UtcNow, [employeeId], token)).SingleOrDefault(p => p.EmployeeId == employeeId);
                canRead = DevelopmentPolicy.CanRead(viewer, employeeId, reviewer, person?.Manager?.EmployeeId);
            }
            catch (HttpRequestException) { return Result.Failure<Context>(PerformanceErrors.CoreUnavailable()); }
        }
        if (!canRead) return notFound;
        if (participant is null)
            return canEdit && viewer.EmployeeId == employeeId
                ? Result.Failure<Context>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.DevelopmentNotParticipant, "You're not part of this cycle."))
                : notFound;

        var plans = tracked ? db.DevelopmentPlans : db.DevelopmentPlans.AsNoTracking();
        var plan = await plans.FirstOrDefaultAsync(p => p.CycleId == cycleId && p.ParticipantId == participant.Id, token);
        return Result.Success(new Context(cycle, participant, objectivePlan, plan, reviewer, canRead, canEdit));
    }

    protected static Result<DevelopmentPlanDto>? Guard(Context context, uint expectedVersion)
    {
        if (!context.CanEdit)
            return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.DevelopmentForbidden,
                "Only the employee and their reviewer edit this development plan."));
        if (context.Plan is null ? expectedVersion != 0 : VersionGuard.Check(context.Plan, expectedVersion) is not null)
            return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.Changed());
        return null;
    }

    /// <summary>Validates a goal's competency against the tenant's active catalogue.</summary>
    protected async Task<Result<DevelopmentGoalContent>> ContentAsync(DevelopmentGoalInput input, CancellationToken token)
    {
        if (input.CompetencyId is Guid competencyId
            && !await db.Competencies.AnyAsync(c => c.Id == competencyId && c.State == CompetencyState.Active, token))
            return Result.Failure<DevelopmentGoalContent>(PerformanceErrors.Validation(PerformanceErrors.Codes.DevelopmentInvalid, "Choose an active competency."));
        return Result.Success(new DevelopmentGoalContent(input.Title, input.CompetencyId, input.Actions ?? [], input.TargetDate, input.Status));
    }

    protected static string ActorName(Context context, Guid actorId)
        => actorId == context.Participant.EmployeeId
            ? context.Participant.DisplayName
            : context.ObjectivePlan?.ResponsibleManagerName ?? context.Participant.ManagerDisplayName ?? "Your reviewer";

    /// <summary>
    /// Tells the other person when one of them adds a goal, once the plan has been put forward: drafting notifies
    /// nobody (D-37), the manager sees the goal with the plan when it arrives.
    /// </summary>
    protected static void NotifyAdded(IPerformanceNotifications notifications, Context context, DevelopmentPlan plan, DevelopmentGoal goal, Guid actorId)
    {
        if (context.ObjectivePlan is not { State: not PlanLifecycleState.Draft }) return;
        var owner = context.Participant.EmployeeId;
        var recipient = actorId == owner ? context.ReviewerId : owner;
        if (recipient is not Guid to || to == Guid.Empty || to == actorId) return;
        var path = PerformanceNotificationTemplates.DevelopmentPath(context.Cycle.Id, context.ObjectivePlan?.Id, owner, forOwner: to == owner);
        notifications.EnqueueDevelopmentGoalAdded(plan.TenantId, context.Cycle.Id, plan.Id, goal.Id, to, actorId, ActorName(context, actorId), goal.Title, path);
    }

    protected async Task<DevelopmentPlanDto> ProjectAsync(Guid cycleId, Guid employeeId, PersonSummaryViewer viewer, CancellationToken token)
    {
        var context = (await LoadAsync(cycleId, employeeId, viewer, token)).Value;
        return await BuildAsync(context, token);
    }

    protected async Task<DevelopmentPlanDto> BuildAsync(Context context, CancellationToken token)
    {
        var plan = context.Plan;
        var goals = plan?.Goals.OrderBy(g => g.CreatedAt).ToList() ?? [];
        var offer = context.CanEdit && (plan?.CarryOverDismissedAt is null) && (plan?.Room ?? DevelopmentPlan.MaxGoals) > 0
            ? await CarryOverSourceAsync(context, token)
            : null;
        var cycleNames = await CycleNamesAsync(goals.Select(g => g.CarriedToCycleId).Concat([offer?.CycleId]), token);
        var competencies = await CompetencyNamesAsync(goals.Concat(offer?.Goals ?? []), token);
        var names = new Dictionary<Guid, string>
        {
            [context.Participant.EmployeeId] = context.Participant.DisplayName,
        };
        if (context.ReviewerId is Guid reviewer) names[reviewer] = ActorName(context, reviewer);

        DevelopmentGoalDto ToDto(DevelopmentGoal goal) => new(goal.Id, goal.Title, goal.CompetencyId,
            goal.CompetencyId is Guid c ? competencies.GetValueOrDefault(c) : null, goal.Actions, goal.TargetDate, goal.Status,
            new PersonRefDto(goal.CreatedByEmployeeId, names.GetValueOrDefault(goal.CreatedByEmployeeId)), goal.UpdatedAt ?? goal.CreatedAt,
            goal.CarriedToCycleId is Guid to ? cycleNames.GetValueOrDefault(to) : null, goal.CarriedFromGoalId is not null);

        var options = context.CanEdit
            ? await db.Competencies.AsNoTracking().Where(c => c.State == CompetencyState.Active).OrderBy(c => c.Name)
                .Select(c => new DevelopmentCompetencyOptionDto(c.Id, c.Name)).ToListAsync(token)
            : [];
        return new DevelopmentPlanDto(context.Cycle.Id, context.Participant.EmployeeId, plan is not null, plan?.Version ?? 0,
            goals.Select(ToDto).ToList(), plan?.Room ?? DevelopmentPlan.MaxGoals, context.CanEdit,
            offer is null ? null : new DevelopmentCarryOverDto(offer.CycleId, cycleNames.GetValueOrDefault(offer.CycleId) ?? "Earlier cycle",
                offer.Goals.Where(g => g.IsOpenForCarryOver).OrderBy(g => g.CreatedAt).Select(ToDto).ToList()))
        {
            CompetencyOptions = options,
        };
    }

    /// <summary>The person's most recent earlier development plan, when it still has open goals to bring over.</summary>
    protected async Task<DevelopmentPlan?> CarryOverSourceAsync(Context context, CancellationToken token)
    {
        var earlier = await (from plan in db.DevelopmentPlans.AsNoTracking()
                             join cycle in db.Cycles.AsNoTracking() on plan.CycleId equals cycle.Id
                             where plan.EmployeeId == context.Participant.EmployeeId && cycle.StartDate < context.Cycle.StartDate
                             orderby cycle.StartDate descending
                             select plan).FirstOrDefaultAsync(token);
        return earlier is not null && earlier.Goals.Any(g => g.IsOpenForCarryOver)
            ? earlier
            : null;
    }

    private async Task<Dictionary<Guid, string>> CycleNamesAsync(IEnumerable<Guid?> ids, CancellationToken token)
    {
        var wanted = ids.OfType<Guid>().Distinct().ToList();
        return wanted.Count == 0 ? [] : await db.Cycles.AsNoTracking().Where(c => wanted.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, token);
    }

    private async Task<Dictionary<Guid, string>> CompetencyNamesAsync(IEnumerable<DevelopmentGoal> goals, CancellationToken token)
    {
        var wanted = goals.Select(g => g.CompetencyId).OfType<Guid>().Distinct().ToList();
        return wanted.Count == 0 ? [] : await db.Competencies.AsNoTracking().Where(c => wanted.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, token);
    }

    protected async Task<Result<DevelopmentPlanDto>> SaveAsync(PersonSummaryViewer viewer, Guid cycleId, Guid employeeId, CancellationToken token)
    {
        try
        {
            await db.SaveChangesAsync(token);
        }
        catch (DbUpdateConcurrencyException) { return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.Changed()); }
        catch (DbUpdateException) { return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.UniqueConflict()); }
        return Result.Success(await ProjectAsync(cycleId, employeeId, viewer, token));
    }

    protected DevelopmentPlan EnsurePlan(Context context)
    {
        if (context.Plan is not null) return context.Plan;
        var plan = DevelopmentPlan.Create(context.Participant.TenantId, context.Cycle.Id, context.Participant.Id, context.Participant.EmployeeId);
        db.DevelopmentPlans.Add(plan);
        return plan;
    }

    protected static Result<DevelopmentPlanDto> Invalid(Exception ex) => ex switch
    {
        KeyNotFoundException => Result.Failure<DevelopmentPlanDto>(PerformanceErrors.NotFound("DevelopmentGoal", Guid.Empty)),
        InvalidOperationException => Result.Failure<DevelopmentPlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.DevelopmentReadOnly, ex.Message)),
        _ => Result.Failure<DevelopmentPlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.DevelopmentInvalid, ex.Message)),
    };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

public sealed class GetDevelopmentPlanHandler(PerformanceDbContext db, ICoreWorkforceClient workforce)
    : DevelopmentHandlerBase(db, workforce), IQueryHandler<GetDevelopmentPlanQuery, Result<DevelopmentPlanDto>>
{
    public async Task<Result<DevelopmentPlanDto>> Handle(GetDevelopmentPlanQuery query, CancellationToken token)
    {
        var context = await LoadAsync(query.CycleId, query.EmployeeId, query.Viewer, token);
        return context.IsFailure ? Result.Failure<DevelopmentPlanDto>(context.Error) : Result.Success(await BuildAsync(context.Value, token));
    }
}

public sealed class AddDevelopmentGoalHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : DevelopmentHandlerBase(db, workforce), ICommandHandler<AddDevelopmentGoalCommand, Result<DevelopmentPlanDto>>
{
    public async Task<Result<DevelopmentPlanDto>> Handle(AddDevelopmentGoalCommand command, CancellationToken token)
    {
        var loaded = await LoadAsync(command.CycleId, command.EmployeeId, command.Viewer, token, tracked: true);
        if (loaded.IsFailure) return Result.Failure<DevelopmentPlanDto>(loaded.Error);
        var context = loaded.Value;
        if (Guard(context, command.Input.ExpectedVersion) is { } refused) return refused;
        var content = await ContentAsync(command.Input, token);
        if (content.IsFailure) return Result.Failure<DevelopmentPlanDto>(content.Error);

        try
        {
            var plan = EnsurePlan(context);
            var actor = command.Viewer.EmployeeId;
            var goal = plan.AddGoal(content.Value, actor);
            Db.Entry(goal).State = EntityState.Added;
            audit.Record(plan.TenantId, "DevelopmentPlan", plan.Id, context.Cycle.Id, PerformanceAuditActions.DevelopmentGoalAdded,
                new { before = (object?)null, after = new { goal.Id, goal.Title, status = goal.Status.ToString() }, employeeId = plan.EmployeeId });
            NotifyAdded(notifications, context, plan, goal, actor);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        return await SaveAsync(command.Viewer, command.CycleId, command.EmployeeId, token);
    }
}

public sealed class UpdateDevelopmentGoalHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, IPerformanceAudit audit)
    : DevelopmentHandlerBase(db, workforce), ICommandHandler<UpdateDevelopmentGoalCommand, Result<DevelopmentPlanDto>>
{
    public async Task<Result<DevelopmentPlanDto>> Handle(UpdateDevelopmentGoalCommand command, CancellationToken token)
    {
        var loaded = await LoadAsync(command.CycleId, command.EmployeeId, command.Viewer, token, tracked: true);
        if (loaded.IsFailure) return Result.Failure<DevelopmentPlanDto>(loaded.Error);
        var context = loaded.Value;
        if (context.Plan is null) return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.NotFound("DevelopmentGoal", command.GoalId));
        if (Guard(context, command.Input.ExpectedVersion) is { } refused) return refused;
        var content = await ContentAsync(command.Input, token);
        if (content.IsFailure) return Result.Failure<DevelopmentPlanDto>(content.Error);

        try
        {
            var before = context.Plan.Goals.FirstOrDefault(g => g.Id == command.GoalId)?.Content;
            var goal = context.Plan.UpdateGoal(command.GoalId, content.Value, command.Viewer.EmployeeId);
            audit.Record(context.Plan.TenantId, "DevelopmentPlan", context.Plan.Id, context.Cycle.Id, PerformanceAuditActions.DevelopmentGoalChanged,
                new { before, after = goal.Content, goalId = goal.Id, employeeId = context.Plan.EmployeeId });
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or KeyNotFoundException) { return Invalid(ex); }
        return await SaveAsync(command.Viewer, command.CycleId, command.EmployeeId, token);
    }
}

public sealed class RemoveDevelopmentGoalHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, IPerformanceAudit audit)
    : DevelopmentHandlerBase(db, workforce), ICommandHandler<RemoveDevelopmentGoalCommand, Result<DevelopmentPlanDto>>
{
    public async Task<Result<DevelopmentPlanDto>> Handle(RemoveDevelopmentGoalCommand command, CancellationToken token)
    {
        var loaded = await LoadAsync(command.CycleId, command.EmployeeId, command.Viewer, token, tracked: true);
        if (loaded.IsFailure) return Result.Failure<DevelopmentPlanDto>(loaded.Error);
        var context = loaded.Value;
        if (context.Plan is null) return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.NotFound("DevelopmentGoal", command.GoalId));
        if (Guard(context, command.ExpectedVersion) is { } refused) return refused;

        try
        {
            var goal = context.Plan.RemoveGoal(command.GoalId);
            audit.Record(context.Plan.TenantId, "DevelopmentPlan", context.Plan.Id, context.Cycle.Id, PerformanceAuditActions.DevelopmentGoalRemoved,
                new { before = goal.Content, after = (object?)null, goalId = goal.Id, employeeId = context.Plan.EmployeeId });
        }
        catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException) { return Invalid(ex); }
        return await SaveAsync(command.Viewer, command.CycleId, command.EmployeeId, token);
    }
}

public sealed class CarryOverDevelopmentGoalsHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, IPerformanceAudit audit)
    : DevelopmentHandlerBase(db, workforce), ICommandHandler<CarryOverDevelopmentGoalsCommand, Result<DevelopmentPlanDto>>
{
    public async Task<Result<DevelopmentPlanDto>> Handle(CarryOverDevelopmentGoalsCommand command, CancellationToken token)
    {
        var loaded = await LoadAsync(command.CycleId, command.EmployeeId, command.Viewer, token, tracked: true);
        if (loaded.IsFailure) return Result.Failure<DevelopmentPlanDto>(loaded.Error);
        var context = loaded.Value;
        if (Guard(context, command.Request.ExpectedVersion) is { } refused) return refused;
        if (context.Plan?.CarryOverDismissedAt is not null)
            return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.DevelopmentReadOnly, "Carry-over was dismissed for this cycle."));
        var sourceId = (await CarryOverSourceAsync(context, token))?.Id;
        var source = sourceId is null ? null : await Db.DevelopmentPlans.FirstAsync(p => p.Id == sourceId, token);
        if (source is null)
            return Result.Failure<DevelopmentPlanDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.DevelopmentInvalid, "There are no open goals to bring over."));

        try
        {
            var plan = EnsurePlan(context);
            var copies = plan.CarryOver(source, command.Request.GoalIds, context.Cycle.StartDate, command.Viewer.EmployeeId);
            foreach (var copy in copies) Db.Entry(copy).State = EntityState.Added;
            audit.Record(plan.TenantId, "DevelopmentPlan", plan.Id, context.Cycle.Id, PerformanceAuditActions.DevelopmentGoalsCarriedOver,
                new { before = (object?)null, after = copies.Select(c => c.Id).ToList(), fromCycleId = source.CycleId,
                    fromGoalIds = copies.Select(c => c.CarriedFromGoalId).ToList(), employeeId = plan.EmployeeId });
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or KeyNotFoundException) { return Invalid(ex); }
        return await SaveAsync(command.Viewer, command.CycleId, command.EmployeeId, token);
    }
}

public sealed class DismissDevelopmentCarryOverHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, IPerformanceAudit audit)
    : DevelopmentHandlerBase(db, workforce), ICommandHandler<DismissDevelopmentCarryOverCommand, Result<DevelopmentPlanDto>>
{
    public async Task<Result<DevelopmentPlanDto>> Handle(DismissDevelopmentCarryOverCommand command, CancellationToken token)
    {
        var loaded = await LoadAsync(command.CycleId, command.EmployeeId, command.Viewer, token, tracked: true);
        if (loaded.IsFailure) return Result.Failure<DevelopmentPlanDto>(loaded.Error);
        var context = loaded.Value;
        if (context.Plan?.CarryOverDismissedAt is not null) return Result.Success(await BuildAsync(context, token));
        if (Guard(context, command.ExpectedVersion) is { } refused) return refused;

        var plan = EnsurePlan(context);
        if (plan.DismissCarryOver(PerformanceClock.UtcNow))
            audit.Record(plan.TenantId, "DevelopmentPlan", plan.Id, context.Cycle.Id, PerformanceAuditActions.DevelopmentCarryOverDismissed,
                new { before = new { dismissed = false }, after = new { dismissed = true }, employeeId = plan.EmployeeId });
        return await SaveAsync(command.Viewer, command.CycleId, command.EmployeeId, token);
    }
}
