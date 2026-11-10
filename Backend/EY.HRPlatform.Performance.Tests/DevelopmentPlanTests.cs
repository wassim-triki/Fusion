using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Development;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Development;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.People;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// D-34/S-08: Nour and her reviewer Lina keep Nour's development goals together, without approval; her Core HR
/// manager Karim and administrators read them; open goals carry from FY2025 into FY2026.
/// </summary>
public sealed class DevelopmentPlanTests
{
    private static readonly DateOnly PastStart = new(2025, 1, 1);
    private static readonly DateOnly PastEnd = new(2025, 12, 31);
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid PastCycleId, Guid CycleId,
        Guid Nour, Guid Lina, Guid Karim, Guid CompetencyId, Guid RetiredCompetencyId);

    private static async Task<World> ArrangeAsync(bool pastCycle = false)
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var tenant = store.TenantId;
        var karim = workforce.Add("Karim Haddad").EmployeeId;
        var nour = workforce.Add("Nour Trabelsi", managerId: karim).EmployeeId;
        var lina = workforce.Add("Lina Ben Ali").EmployeeId;
        var past = PerformanceCycle.CreateDraft(tenant, "FY2025", PastStart, PastEnd, PastStart.AddDays(30)).Activated();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30)).Activated();
        var collaboration = Competency.Create(tenant, "Collaboration", "Works across teams", []);
        var retired = Competency.Create(tenant, "Old value", "Retired", []);
        retired.Archive();
        await using var db = store.NewContext();
        db.Cycles.AddRange(past, cycle);
        db.Competencies.AddRange(collaboration, retired);
        if (pastCycle)
            db.Participants.Add(Participant.Create(tenant, past.Id, nour, "Nour Trabelsi", "Engineer", null, "Platform", lina, "Lina Ben Ali", false, PastStart));
        db.Participants.Add(Participant.Create(tenant, cycle.Id, nour, "Nour Trabelsi", "Engineer", null, "Platform", lina, "Lina Ben Ali", false, Start));
        await db.SaveChangesAsync();
        return new World(store, workforce, past.Id, cycle.Id, nour, lina, karim, collaboration.Id, retired.Id);
    }

    private static PersonSummaryViewer As(Guid id, bool reviews = true, bool admin = false) => new(id, reviews, admin);

    private static DevelopmentGoalInput Goal(string title = "Lead a design review", Guid? competency = null, uint version = 0,
        DevelopmentGoalStatus status = DevelopmentGoalStatus.NotStarted, DateOnly? target = null, params string[] actions)
        => new(title, competency, actions, target, status) { ExpectedVersion = version };

    private static async Task<T> Run<T>(World w, Func<PerformanceDbContext, Task<T>> act)
    {
        await using var db = w.Store.NewContext();
        return await act(db);
    }

    private static Task<Result<DevelopmentPlanDto>> GetAsync(World w, PersonSummaryViewer viewer, Guid? cycleId = null)
        => Run(w, db => new GetDevelopmentPlanHandler(db, w.Workforce).Handle(new GetDevelopmentPlanQuery(cycleId ?? w.CycleId, w.Nour, viewer), default));

    private static Task<Result<DevelopmentPlanDto>> AddAsync(World w, PersonSummaryViewer viewer, DevelopmentGoalInput input, Guid? cycleId = null, Guid? employee = null)
        => Run(w, db => new AddDevelopmentGoalHandler(db, w.Workforce, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new AddDevelopmentGoalCommand(cycleId ?? w.CycleId, employee ?? w.Nour, input, viewer), default));

    private static Task<Result<DevelopmentPlanDto>> UpdateAsync(World w, PersonSummaryViewer viewer, Guid goalId, DevelopmentGoalInput input, Guid? cycleId = null)
        => Run(w, db => new UpdateDevelopmentGoalHandler(db, w.Workforce, new TestPerformanceAudit(db))
            .Handle(new UpdateDevelopmentGoalCommand(cycleId ?? w.CycleId, w.Nour, goalId, input, viewer), default));

    private static T Ok<T>(Result<T> result)
    {
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    // ── The aggregate (4.1) ───────────────────────────────────────────────

    [Fact]
    public void A_plan_holds_up_to_five_goals_with_bounded_content()
    {
        var plan = DevelopmentPlan.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var me = Guid.NewGuid();
        for (var i = 0; i < 5; i++) plan.AddGoal(new($"Goal {i}", null, [], null, DevelopmentGoalStatus.NotStarted), me);
        Assert.Throws<ArgumentException>(() => plan.AddGoal(new("Sixth", null, [], null, DevelopmentGoalStatus.NotStarted), me));

        var other = DevelopmentPlan.Create(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        Assert.Throws<ArgumentException>(() => other.AddGoal(new(" ", null, [], null, DevelopmentGoalStatus.NotStarted), me));
        Assert.Throws<ArgumentException>(() => other.AddGoal(new(new string('x', 201), null, [], null, DevelopmentGoalStatus.NotStarted), me));
        Assert.Throws<ArgumentException>(() => other.AddGoal(new("Too busy", null, ["1", "2", "3", "4", "5", "6"], null, DevelopmentGoalStatus.NotStarted), me));
        Assert.Throws<ArgumentException>(() => other.AddGoal(new("Long action", null, [new string('x', 201)], null, DevelopmentGoalStatus.NotStarted), me));
    }

    [Theory]
    [InlineData("self", true, true)]
    [InlineData("reviewer", true, true)]
    [InlineData("manager", true, false)]
    [InlineData("admin", true, false)]
    [InlineData("colleague", false, false)]
    public void The_policy_follows_the_relationship(string who, bool reads, bool edits)
    {
        Guid employee = Guid.NewGuid(), reviewer = Guid.NewGuid(), manager = Guid.NewGuid();
        var viewer = who switch
        {
            "self" => new PersonSummaryViewer(employee, false, false),
            "reviewer" => new PersonSummaryViewer(reviewer, true, false),
            "manager" => new PersonSummaryViewer(manager, true, false),
            "admin" => new PersonSummaryViewer(Guid.NewGuid(), false, true),
            _ => new PersonSummaryViewer(Guid.NewGuid(), true, false),
        };
        Assert.Equal(reads, DevelopmentPolicy.CanRead(viewer, employee, reviewer, manager));
        Assert.Equal(edits, DevelopmentPolicy.CanEdit(viewer, employee, reviewer));
    }

    // ── Endpoints (4.2) ───────────────────────────────────────────────────

    [Fact]
    public async Task The_first_goal_creates_the_plan_without_an_objective_plan()
    {
        var w = await ArrangeAsync();
        var plan = Ok(await AddAsync(w, As(w.Nour, reviews: false), Goal(competency: w.CompetencyId, target: new(2026, 3, 31), actions: ["Pick a service", "Run it"])));
        Assert.True(plan.Exists);
        var goal = Assert.Single(plan.Goals);
        Assert.Equal("Collaboration", goal.CompetencyName);
        Assert.Equal(["Pick a service", "Run it"], goal.Actions);
        Assert.Equal(DevelopmentGoalStatus.NotStarted, goal.Status);
        Assert.Equal(4, plan.Room);
        Assert.Empty(await Run(w, db => db.EmployeePlans.ToListAsync()));
        await Run(w, async db => { await AuditAssertions.RecordedAsync(db, PerformanceAuditActions.DevelopmentGoalAdded, (await db.DevelopmentPlans.SingleAsync()).Id, w.CycleId); return 0; });
    }

    [Fact]
    public async Task Each_person_hears_when_the_other_adds_a_goal()
    {
        var w = await ArrangeAsync();
        var plan = Ok(await AddAsync(w, As(w.Nour, reviews: false), Goal()));
        Ok(await AddAsync(w, As(w.Lina), Goal("Present at the forum", version: plan.Version)));
        var told = await Run(w, db => db.Notifications.AsNoTracking().Where(n => n.Kind == PerformanceNotificationKind.DevelopmentGoalAdded).ToListAsync());
        Assert.Contains(told, n => n.RecipientEmployeeId == w.Lina && n.EnglishTitle() == "Nour Trabelsi added a development goal");
        Assert.Contains(told, n => n.RecipientEmployeeId == w.Nour && n.Href.StartsWith("/performance/goals?cycle=", StringComparison.Ordinal));
        Assert.Equal(2, told.Count);
    }

    [Fact]
    public async Task Someone_outside_the_cycle_cannot_add_a_goal()
    {
        var w = await ArrangeAsync();
        var outsider = w.Workforce.Add("Sami Outsider").EmployeeId;
        var result = await AddAsync(w, As(outsider, reviews: false), Goal(), employee: outsider);
        Assert.Equal(PerformanceErrors.Codes.DevelopmentNotParticipant, result.Error.Code);
    }

    [Fact]
    public async Task A_sixth_goal_and_a_retired_competency_are_rejected()
    {
        var w = await ArrangeAsync();
        Assert.Equal(PerformanceErrors.Codes.DevelopmentInvalid, (await AddAsync(w, As(w.Nour), Goal(competency: w.RetiredCompetencyId))).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.DevelopmentInvalid, (await AddAsync(w, As(w.Nour), Goal(competency: Guid.NewGuid()))).Error.Code);
        uint version = 0;
        for (var i = 0; i < 5; i++) version = Ok(await AddAsync(w, As(w.Nour), Goal($"Goal {i}", version: version))).Version;
        Assert.Equal(PerformanceErrors.Codes.DevelopmentInvalid, (await AddAsync(w, As(w.Nour), Goal("Sixth", version: version))).Error.Code);
    }

    [Fact]
    public async Task Readers_read_and_only_editors_write()
    {
        var w = await ArrangeAsync();
        Ok(await AddAsync(w, As(w.Nour, reviews: false), Goal()));

        var asAdmin = Ok(await GetAsync(w, As(Guid.NewGuid(), reviews: false, admin: true)));
        Assert.False(asAdmin.CanEdit);
        Assert.Single(asAdmin.Goals);
        Assert.False(Ok(await GetAsync(w, As(w.Karim))).CanEdit);
        Assert.True(Ok(await GetAsync(w, As(w.Lina))).CanEdit);

        Assert.Equal(PerformanceErrors.Codes.DevelopmentForbidden,
            (await AddAsync(w, As(Guid.NewGuid(), reviews: false, admin: true), Goal(version: asAdmin.Version))).Error.Code);
        Assert.Equal("DevelopmentPlan.NotFound", (await GetAsync(w, As(Guid.NewGuid()))).Error.Code);
    }

    [Fact]
    public async Task Goals_stay_editable_after_close_but_carried_goals_are_history()
    {
        var w = await ArrangeAsync(pastCycle: true);
        var past = Ok(await AddAsync(w, As(w.Nour), Goal("Mentor two engineers", status: DevelopmentGoalStatus.InProgress), cycleId: w.PastCycleId));
        past = Ok(await AddAsync(w, As(w.Nour), Goal("Learn Rust", version: past.Version), cycleId: w.PastCycleId));
        await Run(w, async db => { (await db.Cycles.SingleAsync(c => c.Id == w.PastCycleId)).Close(); await db.SaveChangesAsync(); return 0; });

        var mentor = past.Goals.Single(g => g.Title == "Mentor two engineers");
        past = Ok(await UpdateAsync(w, As(w.Nour), mentor.Id,
            Goal("Mentor two engineers", status: DevelopmentGoalStatus.InProgress, target: new(2026, 6, 30), version: past.Version), w.PastCycleId));

        var offered = Ok(await GetAsync(w, As(w.Nour)));
        Assert.Equal("FY2025", offered.CarryOver!.FromCycleName);
        Assert.Equal(2, offered.CarryOver.Goals.Count);

        var carried = Ok(await Run(w, db => new CarryOverDevelopmentGoalsHandler(db, w.Workforce, new TestPerformanceAudit(db))
            .Handle(new CarryOverDevelopmentGoalsCommand(w.CycleId, w.Nour, new CarryOverDevelopmentRequest([mentor.Id]) { ExpectedVersion = 0 }, As(w.Nour)), default)));
        var copy = Assert.Single(carried.Goals);
        Assert.Equal(DevelopmentGoalStatus.InProgress, copy.Status);
        Assert.Equal(new DateOnly(2026, 6, 30), copy.TargetDate);
        Assert.True(copy.CarriedFromEarlierCycle);
        Assert.Single(carried.CarryOver!.Goals);

        var history = Ok(await GetAsync(w, As(w.Nour), w.PastCycleId));
        Assert.Equal("FY2026", history.Goals.Single(g => g.Id == mentor.Id).CarriedToCycleName);
        Assert.Equal(PerformanceErrors.Codes.DevelopmentReadOnly,
            (await UpdateAsync(w, As(w.Nour), mentor.Id, Goal("Changed", version: history.Version), w.PastCycleId)).Error.Code);
    }

    [Fact]
    public async Task Carry_over_respects_room_drops_past_dates_and_stops_after_dismiss()
    {
        var w = await ArrangeAsync(pastCycle: true);
        var past = Ok(await AddAsync(w, As(w.Nour), Goal("Old A", target: new(2025, 6, 1)), cycleId: w.PastCycleId));
        past = Ok(await AddAsync(w, As(w.Nour), Goal("Old B", version: past.Version), cycleId: w.PastCycleId));
        past = Ok(await AddAsync(w, As(w.Nour), Goal("Done one", status: DevelopmentGoalStatus.Done, version: past.Version), cycleId: w.PastCycleId));
        uint version = 0;
        for (var i = 0; i < 4; i++) version = Ok(await AddAsync(w, As(w.Nour), Goal($"New {i}", version: version))).Version;

        var offer = Ok(await GetAsync(w, As(w.Nour))).CarryOver!;
        Assert.DoesNotContain(offer.Goals, g => g.Title == "Done one");
        var ids = offer.Goals.Select(g => g.Id).ToList();
        var tooMany = await Run(w, db => new CarryOverDevelopmentGoalsHandler(db, w.Workforce, new TestPerformanceAudit(db))
            .Handle(new CarryOverDevelopmentGoalsCommand(w.CycleId, w.Nour, new CarryOverDevelopmentRequest(ids) { ExpectedVersion = version }, As(w.Nour)), default));
        Assert.Equal(PerformanceErrors.Codes.DevelopmentInvalid, tooMany.Error.Code);

        var oldA = offer.Goals.Single(g => g.Title == "Old A").Id;
        var after = Ok(await Run(w, db => new CarryOverDevelopmentGoalsHandler(db, w.Workforce, new TestPerformanceAudit(db))
            .Handle(new CarryOverDevelopmentGoalsCommand(w.CycleId, w.Nour, new CarryOverDevelopmentRequest([oldA]) { ExpectedVersion = version }, As(w.Nour)), default)));
        Assert.Null(after.Goals.Single(g => g.Title == "Old A").TargetDate);
        Assert.Null(after.CarryOver);

        var fresh = await ArrangeAsync(pastCycle: true);
        Ok(await AddAsync(fresh, As(fresh.Nour), Goal("Open"), cycleId: fresh.PastCycleId));
        Assert.NotNull(Ok(await GetAsync(fresh, As(fresh.Nour))).CarryOver);
        Ok(await Run(fresh, db => new DismissDevelopmentCarryOverHandler(db, fresh.Workforce, new TestPerformanceAudit(db))
            .Handle(new DismissDevelopmentCarryOverCommand(fresh.CycleId, fresh.Nour, 0, As(fresh.Nour)), default)));
        Assert.Null(Ok(await GetAsync(fresh, As(fresh.Nour))).CarryOver);
    }

    [Fact]
    public async Task The_owner_needs_the_own_participation_grant_to_write()
    {
        var w = await ArrangeAsync();
        var withoutGrant = As(w.Nour, reviews: false) with { ManagesOwnParticipation = false };
        Assert.Equal(PerformanceErrors.Codes.DevelopmentForbidden, (await AddAsync(w, withoutGrant, Goal())).Error.Code);
        var read = Ok(await GetAsync(w, withoutGrant));
        Assert.False(read.CanEdit);
    }

    [Fact]
    public async Task Concurrent_edits_conflict()
    {
        var w = await ArrangeAsync();
        var plan = Ok(await AddAsync(w, As(w.Nour), Goal()));
        Ok(await AddAsync(w, As(w.Lina), Goal("From Lina", version: plan.Version)));
        // The test store doesn't advance row versions, so a stale caller is one holding any other version.
        Assert.Equal("Performance.Stale", (await AddAsync(w, As(w.Nour), Goal("From Nour", version: plan.Version + 1))).Error.Code);
    }

    [Fact]
    public async Task Another_tenant_sees_no_plan()
    {
        var w = await ArrangeAsync();
        Ok(await AddAsync(w, As(w.Nour), Goal()));
        var other = await ArrangeAsync();
        var result = await Run(other, db => new GetDevelopmentPlanHandler(db, other.Workforce)
            .Handle(new GetDevelopmentPlanQuery(w.CycleId, w.Nour, As(w.Nour)), default));
        Assert.Equal("DevelopmentPlan.NotFound", result.Error.Code);
    }

    [Fact]
    public async Task The_summary_shows_development_under_the_same_rule()
    {
        var w = await ArrangeAsync();
        Ok(await AddAsync(w, As(w.Nour), Goal(competency: w.CompetencyId, status: DevelopmentGoalStatus.InProgress)));
        async Task<PersonPerformanceSummaryDto> Summary(PersonSummaryViewer viewer)
            => Ok(await Run(w, db => new GetPersonSummaryHandler(db, w.Workforce).Handle(new GetPersonSummaryQuery(w.Nour, w.CycleId, viewer), default)));

        var mine = (await Summary(As(w.Nour, reviews: false))).Development!;
        Assert.Equal("Collaboration", Assert.Single(mine.Goals).CompetencyName);
        Assert.NotNull((await Summary(As(w.Karim))).Development);
        Assert.NotNull((await Summary(As(w.Lina))).Development);
        Assert.Null((await Summary(As(Guid.NewGuid()))).Development);
    }
}
