using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Search;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// B-211: the top bar's Performance read finds only what the caller may open: objectives by the one objective
/// policy, their own 1:1s, review rounds they run or have a review in; never another company's.
/// </summary>
public sealed class PerformanceSearchTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid Admin, Guid Nour, Guid Sami, Guid Omar, Guid StrategyId);

    /// <summary>Nour leads Sami; Omar is a colleague elsewhere. A published and a draft company objective, Sami's own
    /// draft plan, a 1:1 between Nour and Sami, and a launched Year-end round reviewing Sami.</summary>
    private static async Task<World> SeedAsync(TestStore? store = null, FakeCoreWorkforceClient? workforce = null)
    {
        store ??= TestStore.ForNewTenant();
        workforce ??= new FakeCoreWorkforceClient();
        var tenant = store.TenantId;
        var admin = workforce.Add("Amira Admin").EmployeeId;
        var nour = workforce.Add("Nour Lead").EmployeeId;
        var sami = workforce.Add("Sami Member").EmployeeId;
        var omar = workforce.Add("Omar Elsewhere").EmployeeId;

        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30)).Activated();
        var strategy = Objective.CreateStrategic(tenant, cycle.Id, "Grow the company", null, admin,
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        strategy.Publish();
        var draft = Objective.CreateStrategic(tenant, cycle.Id, "Grow in secret", null, admin,
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        var plan = EmployeePlan.Create(tenant, cycle.Id, Guid.NewGuid(), sami, "Sami Member", "Pod", nour, "Nour Lead");
        var workshops = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, sami, "Run two workshops", null, strategy.Id,
            Start, End, ObjectiveMeasurement.ManualPercentage(), 100m, Start, End, Start, End);

        var now = DateTime.UtcNow;
        var (series, meeting) = OneOnOneSeries.Start(tenant, nour, sami, OneOnOneCadence.Weekly, nour, now.AddDays(1), now, "Nour Lead", "Sami Member");

        var round = ReviewRound.CreateDraft(tenant, cycle, "Year-end", Start, Start.AddMonths(11), true, false, false);
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var participant = Participant.Create(tenant, cycle.Id, sami, "Sami Member", null, null, null, nour, "Nour Lead", false, Start);
        var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, nour, "Nour Lead");
        var review = PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, now);
        round.Launch("{\"competencies\":[]}", version.Id, now);

        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        db.Objectives.AddRange(strategy, draft, workshops);
        db.EmployeePlans.Add(plan);
        db.OneOnOneSeries.Add(series);
        db.OneOnOneMeetings.Add(meeting);
        db.ReviewRounds.Add(round);
        db.PerformanceReviews.Add(review);
        await db.SaveChangesAsync();
        return new World(store, workforce, admin, nour, sami, omar, strategy.Id);
    }

    private static GoalActorContext Admin(Guid id) => new(id, IsAdmin: true, HasOrgManageGrant: false);
    private static GoalActorContext Manager(Guid id) => new(id, IsAdmin: false, HasOrgManageGrant: false, CanReviewReports: true);
    private static GoalActorContext Employee(Guid id) => new(id, IsAdmin: false, HasOrgManageGrant: false);

    private static async Task<PerformanceSearchDto> SearchAsync(World world, string text, GoalActorContext actor, Guid? tenant = null)
    {
        await using var db = tenant is { } other ? world.Store.NewContext(TestTenantContext.WithTenant(other)) : world.Store.NewContext();
        var result = await new PerformanceSearchHandler(db, world.Workforce).Handle(new PerformanceSearchQuery(text, actor), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    [Fact]
    public async Task Objectives_follow_the_one_objective_policy()
    {
        var w = await SeedAsync();

        Assert.Equal(["Grow the company"], (await SearchAsync(w, "GRÖW", Employee(w.Omar))).Objectives.Select(o => o.Title));
        Assert.Equal(["Grow in secret", "Grow the company"], (await SearchAsync(w, "grow", Admin(w.Admin))).Objectives.Select(o => o.Title));

        // A draft plan stays with its owner (and administration), not yet the manager or a colleague.
        var own = Assert.Single((await SearchAsync(w, "workshops", Employee(w.Sami))).Objectives);
        Assert.True(own.Yours);
        Assert.Empty((await SearchAsync(w, "workshops", Manager(w.Nour))).Objectives);
        Assert.Empty((await SearchAsync(w, "workshops", Employee(w.Omar))).Objectives);
        Assert.Empty((await SearchAsync(w, "orkshops", Employee(w.Sami))).Objectives);
        Assert.Equal(PerformanceSearchDto.Empty, await SearchAsync(w, "  ", Admin(w.Admin)));
    }

    [Fact]
    public async Task One_on_ones_and_review_rounds_reach_only_the_people_in_them()
    {
        var w = await SeedAsync();

        var withNour = Assert.Single((await SearchAsync(w, "nour", Employee(w.Sami))).OneOnOnes);
        Assert.Equal((w.Nour, "Nour Lead"), (withNour.WithEmployeeId, withNour.WithName));
        Assert.Equal("Sami Member", Assert.Single((await SearchAsync(w, "1:1", Manager(w.Nour))).OneOnOnes).WithName);
        Assert.Empty((await SearchAsync(w, "1:1", Employee(w.Omar))).OneOnOnes);
        Assert.Empty((await SearchAsync(w, "nour", Admin(w.Admin))).OneOnOnes);

        // The subject and the reviewer find their round; a colleague doesn't; an administrator opens the round itself.
        Assert.False(Assert.Single((await SearchAsync(w, "year", Employee(w.Sami))).ReviewRounds).Administers);
        Assert.Single((await SearchAsync(w, "year", Manager(w.Nour))).ReviewRounds);
        Assert.Empty((await SearchAsync(w, "year", Employee(w.Omar))).ReviewRounds);
        Assert.Empty((await SearchAsync(w, "year", Employee(w.Nour))).ReviewRounds);
        Assert.True(Assert.Single((await SearchAsync(w, "year", Admin(w.Admin))).ReviewRounds).Administers);
        Assert.Equal("FY2026", Assert.Single((await SearchAsync(w, "fy", Admin(w.Admin))).Cycles).Name);
        Assert.Empty((await SearchAsync(w, "fy", Employee(w.Sami))).Cycles);
    }

    [Fact]
    public async Task Another_company_finds_nothing_of_this_one()
    {
        var w = await SeedAsync();
        var other = Guid.NewGuid();

        var seen = await SearchAsync(w, "grow", Admin(w.Admin), tenant: other);
        Assert.Empty(seen.Objectives);
        Assert.Empty((await SearchAsync(w, "year", Admin(w.Admin), tenant: other)).ReviewRounds);
        Assert.Empty((await SearchAsync(w, "nour", Employee(w.Sami), tenant: other)).OneOnOnes);
    }

    [Fact]
    public async Task The_endpoint_takes_the_caller_from_the_token_and_needs_performance()
    {
        await using var factory = new PerformanceApiFactory();
        var w = await SeedAsync(factory.Store, factory.Core);

        using var sami = factory.CreateAuthenticatedClient(employeeId: w.Sami,
            permissions: [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)]);
        var body = await sami.GetFromJsonAsync<JsonElement>("/api/performance/search?q=grow");
        var titles = body.GetProperty("data").GetProperty("objectives").EnumerateArray().Select(o => o.GetProperty("title").GetString()).ToList();
        Assert.Equal(["Grow the company"], titles);

        using var outsider = factory.CreateAuthenticatedClient(employeeId: w.Omar,
            permissions: [new(PerformancePermissions.StrategyPublish, PermissionScopes.Tenant)]);
        using var refused = await outsider.GetAsync("/api/performance/search?q=grow");
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
    }
}
