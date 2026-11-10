using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>performance-work-items (upcoming moments) and fusion-attention (steps): the caller's own dated moments.</summary>
public sealed class UpcomingHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];

    private sealed record World(PerformanceApiFactory Factory, PerformanceCycle Cycle, Guid Nour, Guid Sami, Guid Lina, Guid Outsider);

    /// <summary>
    /// FY2027 runs in planning, plans due in 10 days. Lina reviews Nour and Sami; Lina and Nour meet in two days, and Lina
    /// meets the Outsider (not in the population) tomorrow.
    /// </summary>
    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var nour = Guid.NewGuid(); var sami = Guid.NewGuid(); var lina = Guid.NewGuid(); var outsider = Guid.NewGuid();
        var start = Today.AddMonths(-1);
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(11), Today.AddDays(10)).Activated();
        var now = DateTime.UtcNow;
        var (nourSeries, nourMeeting) = OneOnOneSeries.Start(tenant, lina, nour, OneOnOneCadence.EveryTwoWeeks, lina,
            now.AddDays(2), now, "Lina", "Nour");
        var (outsiderSeries, outsiderMeeting) = OneOnOneSeries.Start(tenant, lina, outsider, OneOnOneCadence.Weekly, lina,
            now.AddDays(1), now, "Lina", "Omar");
        await using var db = factory.Store.NewContext();
        db.Cycles.Add(cycle);
        db.Participants.AddRange(
            Participant.Create(tenant, cycle.Id, nour, "Nour", null, null, "Learning", lina, "Lina", false, start),
            Participant.Create(tenant, cycle.Id, sami, "Sami", null, null, "Learning", lina, "Lina", false, start));
        db.OneOnOneSeries.AddRange(nourSeries, outsiderSeries);
        db.OneOnOneMeetings.AddRange(nourMeeting, outsiderMeeting);
        await db.SaveChangesAsync();
        return new(factory, cycle, nour, sami, lina, outsider);
    }

    /// <summary>A running Mid-year round with calibration: self-assessments due in 5 days, manager reviews in 15.</summary>
    private static async Task<ReviewRound> RoundAsync(World world)
    {
        var tenant = world.Factory.Store.TenantId;
        var round = ReviewRound.CreateDraft(tenant, world.Cycle, "Mid-year", world.Cycle.StartDate, world.Cycle.EndDate, true, false, true);
        round.UpdateDraft(world.Cycle, "Mid-year", world.Cycle.StartDate, world.Cycle.EndDate, true, false, true,
            Today.AddDays(5), Today.AddDays(15), "[]");
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        await using var db = world.Factory.Store.NewContext();
        foreach (var participant in await db.Participants.ToListAsync())
        {
            var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, world.Lina, "Lina");
            db.ReviewRoundSubjects.Add(subject);
            db.PerformanceReviews.Add(PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, DateTime.UtcNow));
        }
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        db.RatingScales.Add(scale); db.RatingScaleVersions.Add(version); db.ReviewRounds.Add(round);
        await db.SaveChangesAsync();
        return round;
    }

    private static async Task<JsonElement[]> UpcomingAsync(HttpClient client, int days = 14)
    {
        var response = await client.GetAsync($"/api/performance/upcoming?days={days}");
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").EnumerateArray().ToArray();
    }

    private static string Kind(JsonElement item) => item.GetProperty("kind").GetString()!;

    [Fact]
    public async Task A_participant_in_planning_has_their_1on1_and_the_planning_deadline()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var moments = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee));

        Assert.Equal(["one-on-one", "plans-due"], moments.Select(Kind));
        var meeting = moments[0];
        Assert.Equal("1:1 with Lina", meeting.GetProperty("title").GetString());
        Assert.NotEqual(JsonValueKind.Null, meeting.GetProperty("at").ValueKind);
        Assert.StartsWith("/performance/one-on-ones/", meeting.GetProperty("href").GetString());
        var deadline = moments[1];
        Assert.Equal("Plans due", deadline.GetProperty("title").GetString());
        Assert.Equal(Today.AddDays(10).ToString("yyyy-MM-dd"), deadline.GetProperty("date").GetString());
        Assert.Equal(["plan-write", "plan-revise"], deadline.GetProperty("covers").EnumerateArray().Select(c => c.GetString()));
    }

    [Fact]
    public async Task Someone_outside_the_population_keeps_their_1on1s_but_gets_no_cycle_dates()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var moments = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Outsider, permissions: Employee));
        var only = Assert.Single(moments);
        Assert.Equal("1:1 with Lina", only.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Nobody_sees_a_1on1_between_two_other_people()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        var moments = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Sami, permissions: Employee));
        Assert.DoesNotContain(moments, m => Kind(m) == "one-on-one");
    }

    [Fact]
    public async Task Review_dates_are_grouped_per_date_and_kind_for_the_person_who_owes_them()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        await RoundAsync(world);

        var nour = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee), 31);
        var self = Assert.Single(nour, m => Kind(m) == "self-assessment-due");
        Assert.Equal(Today.AddDays(5).ToString("yyyy-MM-dd"), self.GetProperty("date").GetString());
        Assert.Contains("self-assessment", self.GetProperty("covers").EnumerateArray().Select(c => c.GetString()));

        var lina = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Lina, permissions: Manager), 31);
        var reviews = Assert.Single(lina, m => Kind(m) == "reviews-due");
        Assert.Equal("Your 2 reviews due", reviews.GetProperty("title").GetString());
        Assert.Equal(Today.AddDays(15).ToString("yyyy-MM-dd"), reviews.GetProperty("date").GetString());
        Assert.DoesNotContain(lina, m => Kind(m) == "self-assessment-due");
    }

    [Fact]
    public async Task A_draft_cycle_start_reaches_administrators_only()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        await using (var db = world.Factory.Store.NewContext())
        {
            db.Cycles.Add(PerformanceCycle.CreateDraft(world.Factory.Store.TenantId, "FY2028", Today.AddDays(7), Today.AddYears(1), Today.AddDays(30)));
            await db.SaveChangesAsync();
        }
        var employee = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee));
        Assert.DoesNotContain(employee, m => m.GetProperty("title").GetString()!.Contains("FY2028"));

        var admin = await UpcomingAsync(world.Factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Admin));
        var start = Assert.Single(admin, m => Kind(m) == "cycle-start");
        Assert.Equal("FY2028 planned start", start.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Another_tenant_sees_nothing_and_the_range_is_capped()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        Assert.Empty(await UpcomingAsync(world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: world.Nour, permissions: Employee)));
        var tooFar = await world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee)
            .GetAsync("/api/performance/upcoming?days=60");
        Assert.Equal(HttpStatusCode.BadRequest, tooFar.StatusCode);
    }

    [Fact]
    public async Task Plan_and_review_items_carry_the_steps_of_their_path()
    {
        var world = await ArrangeAsync();
        await using var _ = world.Factory;
        using var nour = world.Factory.CreateAuthenticatedClient(employeeId: world.Nour, permissions: Employee);
        var planning = (await (await nour.GetAsync("/api/performance/work")).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").EnumerateArray().ToArray();
        var plan = Assert.Single(planning, i => Kind(i) == "plan-write");
        Assert.Equal(["You write it", "Lina approves", "Your year starts"],
            plan.GetProperty("steps").EnumerateArray().Select(s => s.GetProperty("label").GetString()));

        // A launched round moves the year to Review (D-34): planning work is over, the self-assessment is the step.
        await RoundAsync(world);
        var items = (await (await nour.GetAsync("/api/performance/work")).Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").EnumerateArray().ToArray();
        Assert.DoesNotContain(items, i => Kind(i) == "plan-write");
        var self = Assert.Single(items, i => Kind(i) == "self-assessment");
        var steps = self.GetProperty("steps").EnumerateArray().ToArray();
        Assert.Equal(["You", "Lina", "Calibration", "Your result"], steps.Select(s => s.GetProperty("label").GetString()));
        Assert.Equal("current", steps[0].GetProperty("state").GetString());
        Assert.StartsWith("Due ", steps[0].GetProperty("detail").GetString());
    }
}
