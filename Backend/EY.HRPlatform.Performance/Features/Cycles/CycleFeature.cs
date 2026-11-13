using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Population;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Cycles;

public sealed record GetCycleDetailQuery(Guid CycleId, CycleVisibilityActor Actor) : IQuery<Result<CycleDetailDto>>;
public sealed record CreateCycleCommand(CreateCycleRequest Request) : ICommand<Result<CycleSummaryDto>>;
public sealed record UpdateCycleCommand(Guid CycleId, UpdateCycleRequest Request) : ICommand<Result<CycleSummaryDto>>;

public sealed class GetCycleDetailHandler(PerformanceDbContext db)
    : IQueryHandler<GetCycleDetailQuery, Result<CycleDetailDto>>
{
    public async Task<Result<CycleDetailDto>> Handle(GetCycleDetailQuery request, CancellationToken cancellationToken)
    {
        var cycle = await CyclePolicy.Visible(db.Cycles.AsNoTracking(), db.Participants.AsNoTracking(),
                db.PerformanceReviews.AsNoTracking(), request.Actor)
            .FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null)
            return Result.Failure<CycleDetailDto>(PerformanceErrors.NotFound("Cycle", request.CycleId));

        var detail = await CycleDetailComposer.ComposeAsync(db, cycle, cancellationToken);
        return detail;
    }
}

public sealed class CreateCycleHandler(PerformanceDbContext db, ITenantContext tenant)
    : ICommandHandler<CreateCycleCommand, Result<CycleSummaryDto>>
{
    public async Task<Result<CycleSummaryDto>> Handle(CreateCycleCommand command, CancellationToken cancellationToken)
    {
        var request = command.Request;

        // The planning-deadline default is tenant policy, not a magic constant: honour an explicit
        // client value, otherwise offset the start date by the tenant's configured offset.
        var settings = await db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(cancellationToken)
            ?? CycleSettings.CreateDefault(tenant.TenantId);
        var planningDeadline = request.PlanningDeadline
            ?? DerivePlanningDeadline(request.StartDate, request.EndDate, settings.PlanningDeadlineOffsetDays);

        PerformanceCycle cycle;
        try
        {
            cycle = PerformanceCycle.CreateDraft(tenant.TenantId, request.Name, request.StartDate, request.EndDate, planningDeadline, request.Description);
            if (request.Plan is { } plan) Apply(cycle, plan);
            db.Cycles.Add(cycle);
            if (request.Plan?.WhoIsIn is { } who) await ApplyWhoIsInAsync(db, tenant, cycle, who, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<CycleSummaryDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.CycleInvalid, ex.Message));
        }

        await db.SaveChangesAsync(cancellationToken);
        return PerformanceMappers.ToSummary(cycle);
    }

    private static DateOnly DerivePlanningDeadline(DateOnly start, DateOnly end, int offsetDays)
    {
        var candidate = start.AddDays(offsetDays);
        return candidate <= end ? candidate : start.AddDays(1) <= end ? start.AddDays(1) : end;
    }

    internal static void Apply(PerformanceCycle cycle, YearPlanInput plan)
        => cycle.PlanYear(plan.ReviewOpensOn, plan.ResultsOutOn, plan.MidYearCheckInOn, plan.SelfReviewsDueOn, plan.CalibrationOn,
            plan.JoinersJoin, plan.DroppedCompanyGoalIds ?? []);

    /// <summary>Who's in as set up (D-104): the Leave out rules and the exceptions by name, kept on the year's population.</summary>
    internal static async Task ApplyWhoIsInAsync(PerformanceDbContext db, ITenantContext tenant, PerformanceCycle cycle, WhoIsInInput who,
        CancellationToken cancellationToken)
    {
        var leaveOut = who.LeaveOut ?? [];
        var exceptions = who.Exceptions ?? [];
        if (leaveOut.Count > 20) throw new ArgumentException("A year takes at most 20 rules for who's left out.", nameof(who));
        if (exceptions.Count > 5000) throw new ArgumentException("Too many exceptions by name.", nameof(who));
        var rules = leaveOut.Select(LeaveOutRule.Parse).ToList();
        var definition = await YearPopulation.LoadOrCreateDefinitionAsync(db, tenant, cycle, cancellationToken);
        definition.SetWhoIsIn(rules, exceptions.Select(e => (e.EmployeeId, e.In, e.Reason)));
    }
}

public sealed class UpdateCycleHandler(PerformanceDbContext db, ITenantContext tenant)
    : ICommandHandler<UpdateCycleCommand, Result<CycleSummaryDto>>
{
    public async Task<Result<CycleSummaryDto>> Handle(UpdateCycleCommand command, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == command.CycleId, cancellationToken);
        if (cycle is null)
            return Result.Failure<CycleSummaryDto>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        if (!cycle.IsDraft)
            return Result.Failure<CycleSummaryDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotDraft, "Only a Draft Cycle can be edited."));

        if (VersionGuard.Check(cycle, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<CycleSummaryDto>(stale);

        var request = command.Request;
        var previousStart = cycle.StartDate;
        try
        {
            cycle.UpdateDraftDetails(request.Name, request.StartDate, request.EndDate, request.PlanningDeadline, request.Description);
            if (request.Plan is { } plan) CreateCycleHandler.Apply(cycle, plan);
            if (request.Plan?.WhoIsIn is { } who) await CreateCycleHandler.ApplyWhoIsInAsync(db, tenant, cycle, who, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<CycleSummaryDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.CycleInvalid, ex.Message));
        }

        // Population is resolved as-of the Cycle start date. Moving the start date invalidates any
        // confirmed roster, so realign the eligibility date, drop the confirmation, and clear the
        // frozen participant rows — the population must then be re-resolved and re-confirmed.
        // Name/description/end/deadline edits leave a confirmed population untouched.
        if (request.StartDate != previousStart)
        {
            var definition = await db.PopulationDefinitions.FirstOrDefaultAsync(d => d.CycleId == cycle.Id, cancellationToken);
            if (definition is not null)
            {
                definition.RealignEligibility(request.StartDate);
                var participants = await db.Participants.Where(p => p.CycleId == cycle.Id).ToListAsync(cancellationToken);
                if (participants.Count > 0)
                    db.Participants.RemoveRange(participants);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return PerformanceMappers.ToSummary(cycle);
    }
}
