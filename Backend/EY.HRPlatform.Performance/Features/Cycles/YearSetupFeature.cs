using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Insights;
using EY.HRPlatform.Performance.Features.Population;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Cycles;

public sealed record GetYearSetupQuery : IQuery<Result<YearSetupDto>>;
public sealed record LaunchYearCommand(Guid CycleId, uint ExpectedVersion, Guid ActorEmployeeId) : ICommand<Result<YearLaunchDto>>;
public sealed record DeleteDraftCycleCommand(Guid CycleId, uint ExpectedVersion) : ICommand<Result<bool>>;

/// <summary>
/// What setting up a year reads (D-91): the year being set up and the one before it. A year is proposed from last year a
/// year on; the first one from today.
/// </summary>
public static class YearSetup
{
    public const string BlockerLastYearRunning = "lastYearRunning";
    public const string BlockerNotPlanned = "notPlanned";

    /// <summary>The year whose steps and goals the next one starts from: the latest that ran.</summary>
    public static Task<PerformanceCycle?> LastYearAsync(PerformanceDbContext db, CancellationToken token)
        => db.Cycles.AsNoTracking().Where(c => c.State != CycleLifecycleState.Draft)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);

    /// <summary>A year's steps as they ran (or are planned): Planning's end, the review's opening, results out.</summary>
    public static async Task<YearPlanDto> AsRunAsync(PerformanceDbContext db, PerformanceCycle cycle, CancellationToken token)
    {
        var phase = await YearPhases.ComputeAsync(db, cycle, token);
        var launched = await db.ReviewRounds.AsNoTracking().Where(r => r.CycleId == cycle.Id && r.LaunchedAt != null)
            .MinAsync(r => r.LaunchedAt, token);
        var released = await db.PerformanceReviews.AsNoTracking()
            .Where(r => r.CycleId == cycle.Id && r.State == Domain.Reviews.PerformanceReviewState.Finalized).MinAsync(r => r.FinalizedAt, token);
        var steps = YearComposer.Steps(cycle, phase, PerformanceClock.Today,
            launched is null ? null : DateOnly.FromDateTime(launched.Value), released is null ? null : DateOnly.FromDateTime(released.Value), [], false);
        return Plan(cycle) with { ReviewOpensOn = steps[2].Start, ResultsOutOn = steps[3].Start };
    }

    public static YearPlanDto Plan(PerformanceCycle cycle)
        => new(cycle.Name, cycle.StartDate, cycle.EndDate, cycle.PlanningDeadline,
            cycle.ReviewOpensOn ?? cycle.EndDate.AddDays(-45), cycle.ResultsOutOn ?? cycle.EndDate.AddDays(-14),
            cycle.MidYearCheckInOn, cycle.SelfReviewsDueOn, cycle.CalibrationOn, cycle.JoinersJoin, cycle.DroppedCompanyGoalIds);

    /// <summary>Next year: last year's name and steps a year on, or a first year starting today.</summary>
    public static YearPlanDto Propose(YearPlanDto? last, DateOnly today)
    {
        if (last is null)
        {
            var end = today.AddYears(1).AddDays(-1);
            var review = end.AddDays(-45);
            return new YearPlanDto($"FY{today.Year + 1}", today, end, today.AddDays(30), review, end.AddDays(-14),
                today.AddMonths(6), review.AddDays(14), end.AddDays(-21), true, []);
        }
        static DateOnly On(DateOnly d) => d.AddYears(1);
        return new YearPlanDto(NextName(last.Name), On(last.StartDate), On(last.EndDate), On(last.PlanningEndsOn), On(last.ReviewOpensOn),
            On(last.ResultsOutOn), last.MidYearCheckInOn is { } m ? On(m) : null, last.SelfReviewsDueOn is { } s ? On(s) : null,
            last.CalibrationOn is { } c ? On(c) : null, last.JoinersJoin, []);
    }

    /// <summary>"FY2027" becomes "FY2028": the last four-digit year in the name moves on one; a name without one gets the year.</summary>
    public static string NextName(string name)
    {
        var years = Regex.Matches(name, @"(?<!\d)(\d{4})(?!\d)");
        if (years.Count == 0) return $"{name} {DateTime.UtcNow.Year + 1}";
        var last = years[^1];
        var next = (int.Parse(last.Value, CultureInfo.InvariantCulture) + 1).ToString(CultureInfo.InvariantCulture);
        return name[..last.Index] + next + name[(last.Index + last.Length)..];
    }

    /// <summary>Goals left unfinished in a year's approved plans: graded below 1 and not archived.</summary>
    public static async Task<List<Objective>> UnfinishedAsync(PerformanceDbContext db, Guid cycleId, CancellationToken token)
    {
        var query = from objective in db.Objectives.AsNoTracking()
                    join plan in db.EmployeePlans.AsNoTracking() on objective.EmployeePlanId equals plan.Id
                    where plan.CycleId == cycleId && plan.State == PlanLifecycleState.Approved
                          && objective.State != ObjectiveLifecycleState.Archived
                    select objective;
        return (await query.ToListAsync(token)).Where(o => GoalGrades.Of(o) < 1m).OrderBy(o => o.CreatedAt).ToList();
    }

    public static Task<List<Objective>> CompanyGoalsAsync(PerformanceDbContext db, Guid cycleId, CancellationToken token)
        => db.Objectives.AsNoTracking()
            .Where(o => o.CycleId == cycleId && o.OwnershipScope == ObjectiveOwnershipScope.Company && o.State == ObjectiveLifecycleState.Published)
            .OrderBy(o => o.Title).ToListAsync(token);

    /// <summary>Whether last year lets the next one launch: its results are out, or its end date passed (D-57).</summary>
    public static async Task<string?> BlockerAsync(PerformanceDbContext db, PerformanceCycle? running, CancellationToken token)
    {
        if (running is not { IsActive: true }) return null;
        var phase = await YearPhases.ComputeAsync(db, running, token);
        return phase == CyclePhase.ResultsOut || PerformanceClock.Today > running.EndDate ? null : BlockerLastYearRunning;
    }
}

public sealed class GetYearSetupHandler(PerformanceDbContext db, ITenantContext tenant, PopulationResolutionService resolver,
    ICoreWorkforceClient workforce)
    : IQueryHandler<GetYearSetupQuery, Result<YearSetupDto>>
{
    public async Task<Result<YearSetupDto>> Handle(GetYearSetupQuery request, CancellationToken token)
    {
        var draft = await db.Cycles.AsNoTracking().Where(c => c.State == CycleLifecycleState.Draft)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(token);
        var last = await YearSetup.LastYearAsync(db, token);
        var lastPlan = last is null ? null : await YearSetup.AsRunAsync(db, last, token);
        var year = draft is not null ? YearSetup.Plan(draft) : YearSetup.Propose(lastPlan, PerformanceClock.Today);

        // Who's in, from Core HR on the year's first day: everyone active with a place and a manager, less the Leave out
        // rules and with the exceptions by name (D-104).
        var probe = draft ?? PerformanceCycle.CreateDraft(tenant.TenantId, year.Name, year.StartDate, year.EndDate, year.PlanningEndsOn);
        var definition = await db.PopulationDefinitions.AsNoTracking().Include(d => d.Inclusions).Include(d => d.Exclusions)
            .Include(d => d.OrgUnitSelections).FirstOrDefaultAsync(d => d.CycleId == probe.Id, token)
            ?? PopulationDefinition.Create(tenant.TenantId, probe.Id, year.StartDate);
        var resolution = await resolver.ResolveAsync(probe, definition, token);
        var inYear = resolution.Candidates.Where(c => c.CountsToRoster).ToList();
        var canBeIn = resolution.Candidates.Where(c => c.IsEligible).ToList();
        static YearSetupPersonDto Face(PopulationCandidate c) => new(c.EmployeeId, c.DisplayName, c.OrgUnitName);

        // The faces are grouped by division, the department level Insights reads, largest first.
        var units = await InsightsData.UnitsAsync(workforce, canBeIn.Select(c => (c.OrgUnitId, c.OrgUnitName)), token);
        Guid? DivisionOf(PopulationCandidate c) => c.OrgUnitId is { } unit ? units.Department(unit) : null;
        var everyone = canBeIn.Select(c => new YearSetupCandidateDto(c.EmployeeId, c.DisplayName, c.PhotoUrl, DivisionOf(c), c.OrgUnitName,
            c.EmploymentType, c.StartedOn, c.OnLeaveOnDayOne, c.LeaveUntil)).ToList();
        var divisions = everyone.Where(p => p.DivisionId is not null).GroupBy(p => p.DivisionId!.Value)
            .OrderByDescending(g => g.Count()).ThenBy(g => units.Name(g.Key), StringComparer.OrdinalIgnoreCase)
            .Select(g => new YearSetupDivisionDto(g.Key, units.Name(g.Key))).ToList();
        var exceptions = definition.Exclusions.Select(e => new WhoIsInExceptionDto(e.EmployeeId, false, e.Reason))
            .Concat(definition.Inclusions.Select(i => new WhoIsInExceptionDto(i.EmployeeId, true, i.Reason ?? string.Empty))).ToList();

        var goals = last is null ? [] : await YearSetup.CompanyGoalsAsync(db, last.Id, token);
        var unfinished = last is null ? [] : await YearSetup.UnfinishedAsync(db, last.Id, token);
        var lastId = last?.Id ?? Guid.Empty;
        var owners = await db.Participants.AsNoTracking().Where(p => p.CycleId == lastId)
            .Select(p => new { p.EmployeeId, p.DisplayName, p.OrgUnitName }).ToDictionaryAsync(p => p.EmployeeId, token);
        var ownerFaces = unfinished.GroupBy(o => o.AccountablePersonId).OrderByDescending(g => g.Count())
            .Select(g => owners.TryGetValue(g.Key, out var o) ? new YearSetupPersonDto(o.EmployeeId, o.DisplayName, o.OrgUnitName) : null)
            .OfType<YearSetupPersonDto>().Take(YearStandings.CompanyFaces).ToList();
        string? Name(Guid id) => owners.TryGetValue(id, out var o) ? o.DisplayName : inYear.FirstOrDefault(c => c.EmployeeId == id)?.DisplayName;

        var blocker = await YearSetup.BlockerAsync(db, last, token);
        return new YearSetupDto(draft?.Id, draft?.Version ?? 0, year, last?.Name, lastPlan, last is null ? null : await YearPhases.ComputeAsync(db, last, token),
            blocker, inYear.Count, everyone, divisions, definition.LeaveOut, exceptions,
            resolution.Candidates.Where(c => !c.IsEligible).Select(Face).ToList(),
            goals.Select(g => new YearSetupGoalDto(g.Id, g.Title, g.AccountablePersonId, Name(g.AccountablePersonId))).ToList(),
            unfinished.Count, ownerFaces);
    }
}

/// <summary>
/// Launches a drafted year onto the Year (D-84, D-91): everyone active in Core HR on its first day is in, last year's kept
/// company goals come along as drafts, the year before ends (D-57) with its unfinished goals in their owners' drafts,
/// and everyone is told.
/// </summary>
public sealed class LaunchYearHandler(PerformanceDbContext db, ITenantContext tenant, PopulationResolutionService resolver,
    IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<LaunchYearCommand, Result<YearLaunchDto>>
{
    public async Task<Result<YearLaunchDto>> Handle(LaunchYearCommand command, CancellationToken token)
    {
        var cycle = await db.Cycles.Include(c => c.ActivationSnapshot).FirstOrDefaultAsync(c => c.Id == command.CycleId, token);
        if (cycle is null) return Result.Failure<YearLaunchDto>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        if (!cycle.IsDraft)
            return Result.Failure<YearLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotDraft, "Only a year being set up can launch."));
        if (VersionGuard.Check(cycle, command.ExpectedVersion) is { } stale) return Result.Failure<YearLaunchDto>(stale);
        if (!cycle.IsPlanned || !cycle.HasValidDates)
            return Result.Failure<YearLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotActivatable, "Set the year's steps before launching it."));

        var last = await db.Cycles.Where(c => c.State != CycleLifecycleState.Draft && c.Id != cycle.Id)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);
        if (await YearSetup.BlockerAsync(db, last, token) is not null)
            return Result.Failure<YearLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotActivatable,
                $"{last!.Name} is still running; launch {cycle.Name} once its results are out."));

        // Ending last year and opening this one land together, or not at all.
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(token) : null;

        // Who's in: everyone active in Core HR on the year's first day with a place and a manager.
        var definition = await YearPopulation.LoadOrCreateDefinitionAsync(db, tenant, cycle, token);
        definition.RealignEligibility(cycle.StartDate);
        var roster = (await resolver.ResolveAsync(cycle, definition, token)).Candidates.Where(c => c.CountsToRoster).ToList();
        if (roster.Count == 0)
            return Result.Failure<YearLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.PopulationEmpty, "Nobody is in Core HR on the year's first day."));
        db.Participants.RemoveRange(await db.Participants.Where(p => p.CycleId == cycle.Id).ToListAsync(token));
        var participants = roster.Select(c => Participant.Create(tenant.TenantId, cycle.Id, c.EmployeeId, c.DisplayName, c.JobTitle, c.OrgUnitId,
            c.OrgUnitName, c.ManagerEmployeeId, c.ManagerDisplayName, c.ByExplicitInclusion, definition.EligibilityDate)).ToList();
        db.Participants.AddRange(participants);
        definition.MarkConfirmed();

        // What comes along: last year's company goals the setup kept, as drafts; its unfinished goals into their owners' drafts.
        var companyGoals = new List<Objective>();
        var carried = new List<Objective>();
        var plans = new List<EmployeePlan>();
        if (last is not null)
        {
            foreach (var goal in (await YearSetup.CompanyGoalsAsync(db, last.Id, token)).Where(g => !cycle.DroppedCompanyGoalIds.Contains(g.Id)))
                companyGoals.Add(goal.CarryInto(cycle.Id, null, cycle.StartDate, cycle.EndDate));
            var byEmployee = participants.ToDictionary(p => p.EmployeeId);
            foreach (var owner in (await YearSetup.UnfinishedAsync(db, last.Id, token)).GroupBy(o => o.AccountablePersonId))
            {
                // A goal whose owner isn't in the new year (they left) stays where it was.
                if (!byEmployee.TryGetValue(owner.Key, out var participant)) continue;
                var plan = EmployeePlan.Create(tenant.TenantId, cycle.Id, participant.Id, participant.EmployeeId, participant.DisplayName,
                    participant.OrgUnitName, participant.ManagerEmployeeId, participant.ManagerDisplayName);
                plans.Add(plan);
                var goals = owner.Select(goal => goal.CarryInto(cycle.Id, plan.Id, cycle.StartDate, cycle.EndDate)).ToList();
                PlanWeights.Rebalance(goals);
                carried.AddRange(goals);
            }
            db.Objectives.AddRange(companyGoals);
            db.EmployeePlans.AddRange(plans);
            db.Objectives.AddRange(carried);

            if (last.IsActive)
            {
                last.Close();
                audit.Record(last.TenantId, "Cycle", last.Id, last.Id, PerformanceAuditActions.CycleClosed,
                    new { before = "Active", after = "Closed", nextYear = cycle.Id, carried = carried.Count });
                await Plans.UpdateRequests.CloseOpenAsync(db, audit, last.Id, PerformanceClock.UtcNow, token);
                // The ended year's slot frees before the new one takes it (one Active per tenant).
                await db.SaveChangesAsync(token);
            }
        }

        var settings = await db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(token) ?? CycleSettings.CreateDefault(cycle.TenantId);
        var snapshot = ActivationSnapshot.Capture(cycle.TenantId, cycle.Id, cycle.Name, cycle.StartDate, cycle.EndDate, cycle.PlanningDeadline,
            definition.EligibilityDate, participants.Count, JsonSerializer.Serialize(settings.ToSnapshot()),
            JsonSerializer.Serialize(new { definition.Mode, definition.LeaveOut, InclusionCount = definition.Inclusions.Count, ExclusionCount = definition.Exclusions.Count }),
            JsonSerializer.Serialize(participants.Select(p => new { p.EmployeeId, p.DisplayName, p.OrgUnitId, p.OrgUnitName, ReviewerEmployeeId = p.ManagerEmployeeId,
                p.ManagerDisplayName, ReviewerBasis = p.ReviewerBasis.ToString(), p.ReviewerAsOf })),
            JsonSerializer.Serialize(companyGoals.Select(o => new { o.Id, o.Title, o.AccountablePersonId })));
        cycle.Activate(snapshot);
        db.Entry(snapshot).State = EntityState.Added;
        audit.Record(cycle.TenantId, "Cycle", cycle.Id, cycle.Id, PerformanceAuditActions.CycleActivated,
            new { before = "Draft", after = "Active", snapshotId = snapshot.Id, participantCount = participants.Count,
                companyGoals = companyGoals.Count, carried = carried.Count, endedCycleId = last?.IsClosed == true ? last.Id : (Guid?)null });

        var actorName = participants.FirstOrDefault(p => p.EmployeeId == command.ActorEmployeeId)?.DisplayName ?? "HR";
        var carriedBy = carried.GroupBy(o => o.AccountablePersonId).ToDictionary(g => g.Key, g => g.Count());
        foreach (var participant in participants)
            notifications.EnqueueYearLaunched(cycle.TenantId, cycle.Id, participant.EmployeeId, command.ActorEmployeeId, actorName, cycle.Name,
                cycle.PlanningDeadline, carriedBy.GetValueOrDefault(participant.EmployeeId));
        await db.SaveChangesAsync(token);
        if (transaction is not null) await transaction.CommitAsync(token);
        return new YearLaunchDto(cycle.Id, participants.Count, companyGoals.Count, carried.Count, last?.IsClosed == true ? last.Id : null);
    }
}

/// <summary>
/// Deletes a year being set up with its setup data (who's in, draft goals). A year holding any plan is not unused; a year
/// that launched is never deleted.
/// </summary>
public sealed class DeleteDraftCycleHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<DeleteDraftCycleCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(DeleteDraftCycleCommand command, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == command.CycleId, cancellationToken);
        if (cycle is null)
            return Result.Failure<bool>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        if (!cycle.IsDraft)
            return Result.Failure<bool>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotDraft, "Only a year being set up can be deleted."));
        if (VersionGuard.Check(cycle, command.ExpectedVersion) is { } stale)
            return Result.Failure<bool>(stale);
        if (await db.EmployeePlans.AnyAsync(p => p.CycleId == cycle.Id, cancellationToken))
            return Result.Failure<bool>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.CycleNotDeletable, "This year already holds plans and cannot be deleted."));

        db.Objectives.RemoveRange(await db.Objectives.Where(o => o.CycleId == cycle.Id).ToListAsync(cancellationToken));
        db.Participants.RemoveRange(await db.Participants.Where(p => p.CycleId == cycle.Id).ToListAsync(cancellationToken));
        db.PopulationDefinitions.RemoveRange(await db.PopulationDefinitions.Where(d => d.CycleId == cycle.Id).ToListAsync(cancellationToken));
        db.Cycles.Remove(cycle);
        audit.Record(cycle.TenantId, "Cycle", cycle.Id, cycle.Id, PerformanceAuditActions.CycleDraftDeleted,
            new { before = new { state = "Draft", cycle.Name }, after = (string?)null });
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
