using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// The year's domain (B-405 slice 2, D-34, D-55, D-58): one phase rule that never goes backwards, HR moving the year on
/// with a dry run, the steps with who is in each, and nudges that reach only the nudger's own people.
/// </summary>
public sealed class YearTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly Start = Today.AddDays(-10);
    private static readonly DateOnly End = Today.AddMonths(11);

    [Fact]
    public void The_phase_reads_from_what_happened_and_the_dates_and_never_goes_backwards()
    {
        var cycle = PerformanceCycle.CreateDraft(Guid.NewGuid(), "2026", Start, End, Today.AddDays(20));
        Assert.Null(YearPhase.Of(cycle, Today, YearEvidence.None));
        cycle.Activated();
        Assert.Equal(CyclePhase.Planning, YearPhase.Of(cycle, Today, YearEvidence.None));
        Assert.Equal(CyclePhase.Execution, YearPhase.Of(cycle, Today.AddDays(21), YearEvidence.None));
        // A round launched reads Review whatever the date, and still Review once the round is over without a release.
        Assert.Equal(CyclePhase.Review, YearPhase.Of(cycle, Today, new YearEvidence(true, false)));
        // Results released reads Results out from then on, round open or closed (B-392: never "Review" or "Planning" again).
        Assert.Equal(CyclePhase.ResultsOut, YearPhase.Of(cycle, Today, new YearEvidence(true, true)));
        Assert.Equal(CyclePhase.ResultsOut, YearPhase.Of(cycle, End.AddDays(1), new YearEvidence(true, true)));

        // HR moving the year on closes planning today: Execution from this moment, the deadline redrawn to today.
        cycle.ClosePlanning(Today);
        Assert.Equal(Today, cycle.PlanningDeadline);
        Assert.Equal(Today, cycle.PlanningClosedOn);
        Assert.Equal(CyclePhase.Execution, YearPhase.Of(cycle, Today, YearEvidence.None));
        Assert.Throws<InvalidOperationException>(() => cycle.ClosePlanning(Today));
        cycle.Close();
        Assert.Null(YearPhase.Of(cycle, Today, YearEvidence.None));
    }

    [Fact]
    public async Task The_year_places_each_person_in_their_furthest_step_at_the_viewers_reach()
    {
        var w = await World.ArrangeAsync();
        await using var db = w.Store.NewContext();
        var hr = new CycleVisibilityActor(Guid.NewGuid(), true, "Tenant");
        var year = (await new GetYearHandler(db).Handle(new(w.Cycle.Id, hr), default)).Value;

        Assert.Equal(CyclePhase.Planning, year.Phase);
        Assert.Equal(YearComposer.ScopeCompany, year.Scope);
        Assert.Equal(4, year.Steps.Count);
        Assert.Equal([CyclePhase.Planning, CyclePhase.Execution, CyclePhase.Review, CyclePhase.ResultsOut], year.Steps.Select(s => s.Phase));
        Assert.Equal([YearStepState.Current, YearStepState.Ahead, YearStepState.Ahead, YearStepState.Ahead], year.Steps.Select(s => s.State));
        var planning = year.Steps[0];
        Assert.Equal(["Nour", "Sami"], Names(planning));
        Assert.Equal(YearStandings.NotStarted, Standing(planning, "Nour"));
        Assert.Equal(YearStandings.Submitted, Standing(planning, "Sami"));
        Assert.Equal(["Yasmine"], Names(year.Steps[1]));
        Assert.Equal(YearStandings.Quiet, Standing(year.Steps[1], "Yasmine"));
        Assert.True(year.Steps[1].Estimated);
        Assert.Equal(cycle(w).PlanningDeadline.AddDays(1), year.Steps[1].Start);

        // HR's next move: close planning today, for the two people without an approved plan.
        var move = Assert.IsType<YearMoveDto>(year.NextMove);
        Assert.Equal(YearComposer.MoveClosePlanning, move.Kind);
        Assert.Equal(CyclePhase.Execution, move.To);
        Assert.True(move.CanMove);
        Assert.Equal(Today, move.PlanningDeadline);
        Assert.Equal(["Nour", "Sami"], move.People.Select(p => p.Name));

        // A manager sees their own people by name; an employee sees only themselves; neither sees a move.
        var lina = (await new GetYearHandler(db).Handle(new(w.Cycle.Id, new CycleVisibilityActor(w.Lina, false, null)), default)).Value;
        Assert.Equal(YearComposer.ScopeTeam, lina.Scope);
        Assert.Equal(["Nour", "Sami"], Names(lina.Steps[0]));
        Assert.Empty(Names(lina.Steps[1]));
        Assert.Null(lina.Me);
        Assert.Null(lina.NextMove);
        var nour = (await new GetYearHandler(db).Handle(new(w.Cycle.Id, new CycleVisibilityActor(w.Nour, false, null)), default)).Value;
        Assert.Equal(YearComposer.ScopeYou, nour.Scope);
        Assert.Equal(1, nour.Total);
        Assert.Equal(["Nour"], Names(nour.Steps[0]));
        var sami = (await new GetYearHandler(db).Handle(new(w.Cycle.Id, new CycleVisibilityActor(w.Sami, false, null)), default)).Value;
        Assert.Equal((w.Sami, CyclePhase.Planning, YearStandings.Submitted, w.Lina, "Lina"),
            (sami.Me!.EmployeeId, sami.Me.Step, sami.Me.Standing, sami.Me.ManagerEmployeeId, sami.Me.ManagerName));

        static PerformanceCycle cycle(World w) => w.Cycle;
    }

    [Fact]
    public async Task HR_moves_the_year_on_as_previewed_and_a_stale_or_wrong_step_is_refused()
    {
        var w = await World.ArrangeAsync();
        await using var db = w.Store.NewContext();
        var hr = new CycleVisibilityActor(Guid.NewGuid(), true, "Tenant");
        var audit = new TestPerformanceAudit(db);
        var handler = new MoveYearOnHandler(db, audit, new NoSender());

        var wrongStep = await handler.Handle(new(w.Cycle.Id, CyclePhase.Review, w.Cycle.Version, hr), default);
        Assert.Equal("Cycle.NotMovable", wrongStep.Error.Code);
        var stale = await handler.Handle(new(w.Cycle.Id, CyclePhase.Execution, w.Cycle.Version + 1, hr), default);
        Assert.Equal("Performance.Stale", stale.Error.Code);

        var moved = await handler.Handle(new(w.Cycle.Id, CyclePhase.Execution, w.Cycle.Version, hr), default);
        Assert.True(moved.IsSuccess);
        Assert.Equal(CyclePhase.Execution, moved.Value.Phase);
        Assert.Equal(Today, moved.Value.PlanningClosedOn);
        Assert.Equal(YearStepState.Done, moved.Value.Steps[0].State);
        Assert.Equal(Today, moved.Value.Steps[0].End);
        // The people still in Planning stay there to finish; the year's next move is now the round's launch.
        Assert.Equal(2, moved.Value.Steps[0].Count);
        Assert.Equal(YearComposer.MoveLaunchRound, moved.Value.NextMove!.Kind);
        Assert.False(moved.Value.NextMove.CanMove);
        Assert.Equal(YearComposer.BlockerNoDraftRound, moved.Value.NextMove.Blocker);
        Assert.Equal(1, await db.AuditEntries.CountAsync(e => e.Action == PerformanceAuditActions.CyclePlanningClosed && e.ResourceId == w.Cycle.Id));

        var again = await handler.Handle(new(w.Cycle.Id, CyclePhase.Execution, moved.Value.Version, hr), default);
        Assert.Equal("Cycle.NotMovable", again.Error.Code);
    }

    [Fact]
    public async Task A_nudge_reaches_the_nudgers_own_people_and_tells_whoever_holds_the_step()
    {
        var w = await World.ArrangeAsync();
        await using var db = w.Store.NewContext();
        var handler = new NudgeHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db));

        // Lina manages Nour (not started: Nour is told) and Sami (submitted: the plan waits on Lina herself, so nobody else is told).
        var byLina = await handler.Handle(new(w.Cycle.Id, [w.Nour, w.Sami, w.Yasmine, w.Lina], [], new CycleVisibilityActor(w.Lina, false, null)), default);
        Assert.True(byLina.IsSuccess);
        Assert.Equal(1, byLina.Value.Nudged);
        Assert.Equal(new HashSet<Guid> { w.Sami, w.Yasmine, w.Lina }, byLina.Value.Skipped.ToHashSet());
        var toNour = Assert.Single(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Nour).ToListAsync());
        Assert.Equal(PerformanceNotificationKind.YearNudge, toNour.Kind);
        Assert.Equal("YearNudge.plan", toNour.TitleKey);
        Assert.Equal("Lina", toNour.ActorName);

        // HR reaches everyone: Sami's submitted plan nudges Lina, Yasmine's quiet goals nudge Yasmine.
        var byHr = await handler.Handle(new(w.Cycle.Id, [w.Sami, w.Yasmine], [], new CycleVisibilityActor(Guid.NewGuid(), true, "Tenant")), default);
        Assert.Equal(2, byHr.Value.Nudged);
        Assert.Equal("YearNudge.approve", (await db.Notifications.SingleAsync(n => n.RecipientEmployeeId == w.Lina)).TitleKey);
        Assert.Equal("YearNudge.progress", (await db.Notifications.SingleAsync(n => n.RecipientEmployeeId == w.Yasmine)).TitleKey);
        Assert.Equal(3, await db.AuditEntries.CountAsync(e => e.Action == PerformanceAuditActions.YearNudged));

        // Anyone may nudge whoever holds their own step (D-49): Sami's plan waits on Lina; Nour's own plan is Nour's to write.
        var bySami = await handler.Handle(new(w.Cycle.Id, [w.Sami], [], new CycleVisibilityActor(w.Sami, false, null)), default);
        Assert.Equal(1, bySami.Value.Nudged);
        Assert.Equal(2, await db.Notifications.CountAsync(n => n.RecipientEmployeeId == w.Lina));
        var byNour = await handler.Handle(new(w.Cycle.Id, [w.Nour, w.Yasmine], [], new CycleVisibilityActor(w.Nour, false, null)), default);
        Assert.Equal(0, byNour.Value.Nudged);
        Assert.Equal(new HashSet<Guid> { w.Nour, w.Yasmine }, byNour.Value.Skipped.ToHashSet());

        // By standing, a nudge reaches everyone in it at the caller's reach, not only the faces on screen.
        var notStarted = await handler.Handle(new(w.Cycle.Id, [], [YearStandings.NotStarted, YearStandings.Quiet], new CycleVisibilityActor(w.Lina, false, null)), default);
        Assert.Equal(1, notStarted.Value.Nudged);
        Assert.Equal(2, await db.Notifications.CountAsync(n => n.RecipientEmployeeId == w.Nour));
        Assert.Equal(1, await db.Notifications.CountAsync(n => n.RecipientEmployeeId == w.Yasmine));
        var empty = await handler.Handle(new(w.Cycle.Id, [], [], new CycleVisibilityActor(w.Lina, false, null)), default);
        Assert.True(empty.IsFailure);
    }

    private static string[] Names(YearStepDto step) => step.Groups.SelectMany(g => g.People).Select(p => p.Name).OrderBy(n => n).ToArray();

    private static string Standing(YearStepDto step, string name) => step.Groups.Single(g => g.People.Any(p => p.Name == name)).Standing;

    private sealed class NoSender : ISender
    {
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest => throw new NotSupportedException();
        public Task<object?> Send(object request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    /// <summary>Lina manages Nour (no plan) and Sami (plan submitted); Yasmine, under Karim, has an approved plan nobody updated.</summary>
    public sealed record World(TestStore Store, PerformanceCycle Cycle, Guid Lina, Guid Nour, Guid Sami, Guid Karim, Guid Yasmine)
    {
        public static async Task<World> ArrangeAsync(TestStore? store = null)
        {
            store ??= TestStore.ForNewTenant();
            var tenant = store.TenantId;
            var cycle = PerformanceCycle.CreateDraft(tenant, "2026", Start, End, Today.AddDays(20)).Activated();
            Guid lina = Guid.NewGuid(), nour = Guid.NewGuid(), sami = Guid.NewGuid(), karim = Guid.NewGuid(), yasmine = Guid.NewGuid();
            var pNour = Participant.Create(tenant, cycle.Id, nour, "Nour", null, null, "Product", lina, "Lina", false, Start);
            var pSami = Participant.Create(tenant, cycle.Id, sami, "Sami", null, null, "Product", lina, "Lina", false, Start);
            var pYasmine = Participant.Create(tenant, cycle.Id, yasmine, "Yasmine", null, null, "Engineering", karim, "Karim", false, Start);
            var samiPlan = EmployeePlan.Create(tenant, cycle.Id, pSami.Id, sami, "Sami", "Product", lina, "Lina");
            samiPlan.Submit(sami, new PlanSubmissionFacts(1, true, 100m, false, true, PlanAlignmentPolicy.Optional));
            var yasminePlan = EmployeePlan.Create(tenant, cycle.Id, pYasmine.Id, yasmine, "Yasmine", "Engineering", karim, "Karim");
            yasminePlan.Submit(yasmine, new PlanSubmissionFacts(1, true, 100m, false, true, PlanAlignmentPolicy.Optional));
            yasminePlan.Approve(karim);
            await using var db = store.NewContext();
            db.Cycles.Add(cycle);
            db.Participants.AddRange(pNour, pSami, pYasmine);
            db.EmployeePlans.AddRange(samiPlan, yasminePlan);
            await db.SaveChangesAsync();
            return new(store, cycle, lina, nour, sami, karim, yasmine);
        }
    }
}
