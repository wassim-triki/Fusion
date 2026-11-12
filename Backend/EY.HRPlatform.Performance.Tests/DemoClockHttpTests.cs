using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// The Development-only demo clock through the real HTTP pipeline (performance-demo-clock): refused
/// elsewhere, only past instants, boundaries unchanged, and a whole past year built through the API.
/// </summary>
public sealed class DemoClockHttpTests
{
    private const string Header = "X-Demo-Clock";
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);
    private static string At(DateOnly day) => day.ToDateTime(new TimeOnly(9, 0), DateTimeKind.Utc).ToString("O");
    private static DateTime Instant(DateOnly day) => day.ToDateTime(new TimeOnly(9, 0), DateTimeKind.Utc);

    [Fact]
    public async Task Outside_Development_the_header_is_refused_and_nothing_is_written()
    {
        await using var world = await Cast.CreateAsync("Testing");
        var cycleCount = await world.CountCyclesAsync();

        using var refused = await world.Send(world.Amira, HttpMethod.Post, "/api/performance/cycles",
            new { name = "Past", startDate = Today.AddDays(-400), endDate = Today.AddDays(-36), planningDeadline = Today.AddDays(-370) },
            At(Today.AddDays(-400)));

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("demo_clock_unavailable", await CodeOf(refused));
        Assert.Equal(cycleCount, await world.CountCyclesAsync());
    }

    [Theory]
    [InlineData("future")]
    [InlineData("last-year")]
    [InlineData("2025-01-01T09:00:00")]
    public async Task In_Development_only_a_past_instant_with_an_offset_is_accepted(string value)
    {
        await using var world = await Cast.CreateAsync("Development");
        var cycleCount = await world.CountCyclesAsync();
        var header = value == "future" ? DateTime.UtcNow.AddDays(1).ToString("O") : value;

        using var refused = await world.Send(world.Amira, HttpMethod.Post, "/api/performance/cycles",
            new { name = "Past", startDate = Today.AddDays(-400), endDate = Today.AddDays(-36), planningDeadline = Today.AddDays(-370) },
            header);

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("demo_clock_invalid", await CodeOf(refused));
        Assert.Equal(cycleCount, await world.CountCyclesAsync());
    }

    [Fact]
    public async Task Without_the_header_Development_uses_real_time()
    {
        await using var world = await Cast.CreateAsync("Development");
        var before = DateTime.UtcNow.AddSeconds(-5);

        var cycle = await Data(await world.Send(world.Amira, HttpMethod.Post, "/api/performance/cycles",
            new { name = "Now", startDate = Today, endDate = Today.AddDays(364), planningDeadline = Today.AddDays(30) }));

        await using var db = world.Factory.Store.NewContext();
        var stored = await db.Cycles.SingleAsync(c => c.Id == cycle.GetProperty("id").GetGuid());
        Assert.True(stored.CreatedAt >= before);
    }

    [Fact]
    public async Task Under_the_clock_authorization_and_tenant_isolation_are_unchanged()
    {
        await using var world = await Cast.CreateAsync("Development");
        var start = Today.AddDays(-400);
        var (cycleId, planId) = await world.PlanSubmittedAsync(start, Instant(start.AddDays(5)));
        var past = At(start.AddDays(6));

        // Aicha doesn't review her own plan, with or without the clock.
        using var withClock = await world.Send(world.Aicha, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/plans/{planId}/approve",
            new { expectedVersion = await world.PlanVersionAsync(planId) }, past);
        using var withoutClock = await world.Send(world.Aicha, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/plans/{planId}/approve",
            new { expectedVersion = await world.PlanVersionAsync(planId) });
        Assert.Equal(withoutClock.StatusCode, withClock.StatusCode);
        Assert.False(withClock.IsSuccessStatusCode);

        // Another tenant's administrator doesn't find the cycle.
        using var other = world.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: Guid.NewGuid(), permissions: Cast.AdminGrants);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/performance/cycles/{cycleId}");
        request.Headers.Add(Header, past);
        using var crossTenant = await other.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotFound, crossTenant.StatusCode);
    }

    [Fact]
    public async Task A_past_year_built_through_the_API_carries_its_own_days_and_keeps_the_rules()
    {
        await using var world = await Cast.CreateAsync("Development");
        var start = Today.AddDays(-400);
        var end = start.AddDays(364);

        var (cycleId, planId) = await world.PlanSubmittedAsync(start, Instant(start.AddDays(10)));
        Assert.DoesNotContain(world.Factory.Core.AsOfs, asOf => asOf > Instant(start.AddDays(10)));

        // Mariam approves on day 15; the decision, the audit entry and Aicha's notification carry that day.
        var approveDay = start.AddDays(15);
        await Data(await world.Send(world.Mariam, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/plans/{planId}/approve",
            new { expectedVersion = await world.PlanVersionAsync(planId) }, At(approveDay)));

        // Mariam gives Aicha feedback on day 20: Core HR is asked about them as of that moment, not the real one.
        world.Factory.Core.AsOfs.Clear();
        var feedbackDay = start.AddDays(20);
        await Data(await world.Send(world.Mariam, HttpMethod.Post, "/api/performance/feedback", new
        {
            id = Guid.NewGuid(), receiverEmployeeId = world.Aicha.EmployeeId, visibility = "Shared", message = "Great launch prep",
            competencyId = (Guid?)null, cycleId = (Guid?)null, objectiveId = (Guid?)null,
        }, At(feedbackDay)));
        Assert.Contains(Instant(feedbackDay), world.Factory.Core.AsOfs);

        // Aicha checks in on day 90.
        var objectiveId = await world.FirstObjectiveAsync(planId);
        await Data(await world.Send(world.Aicha, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/objectives/{objectiveId}/progress",
            new { expectedVersion = await world.ObjectiveVersionAsync(objectiveId), numericActual = 40, status = "OnTrack", isCorrection = false },
            At(start.AddDays(90))));

        // The round: launched day 330, self-assessment day 335, Mariam's review and release day 345, acknowledged day 350.
        var round = await Data(await world.Send(world.Amira, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/review-rounds",
            new { name = "Year-end review", periodStart = start, periodEnd = start.AddDays(330) }, At(start.AddDays(328))));
        var roundId = round.GetProperty("id").GetGuid();
        round = await Data(await world.Send(world.Amira, HttpMethod.Put, $"/api/performance/review-rounds/{roundId}", new
        {
            expectedVersion = round.GetProperty("version").GetUInt32(), name = "Year-end review",
            periodStart = start, periodEnd = start.AddDays(330), selfAssessmentEnabled = true, objectiveRatingsEnabled = true,
            calibrationEnabled = false, selfAssessmentDueDate = start.AddDays(340), managerAssessmentDueDate = start.AddDays(350),
            competencyIds = Array.Empty<Guid>(), peerInputEnabled = false, questionsEnabled = false, potentialEnabled = false,
            questionIds = Array.Empty<Guid>(),
        }, At(start.AddDays(328))));
        await Data(await world.Send(world.Amira, HttpMethod.Post, $"/api/performance/review-rounds/{roundId}/launch",
            new { expectedVersion = round.GetProperty("version").GetUInt32() }, At(start.AddDays(330))));

        var reviewId = await world.ReviewOfAsync(roundId, world.Aicha);
        var mine = await Data(await world.Send(world.Aicha, HttpMethod.Get, $"/api/performance/reviews/{reviewId}", null, At(start.AddDays(335))));
        await Data(await world.Send(world.Aicha, HttpMethod.Post, $"/api/performance/reviews/{reviewId}/self-assessment",
            new { expectedVersion = mine.GetProperty("version").GetUInt32(), summary = "A good year", overallRating = 4, answers = Array.Empty<object>(),
                items = new[] { new { kind = "Objective", itemId = objectiveId, rating = (int?)4, reflection = "Shipped it" } } },
            At(start.AddDays(335))));
        var reviewing = await Data(await world.Send(world.Mariam, HttpMethod.Get, $"/api/performance/reviews/{reviewId}", null, At(start.AddDays(345))));
        var assessed = await Data(await world.Send(world.Mariam, HttpMethod.Post, $"/api/performance/reviews/{reviewId}/manager-assessment",
            new { expectedVersion = reviewing.GetProperty("version").GetUInt32(), summary = "Strong year", overallRating = 4, answers = Array.Empty<object>(),
                items = new[] { new { kind = "Objective", itemId = objectiveId, rating = (int?)4, comment = "Delivered" } } },
            At(start.AddDays(345))));
        await Data(await world.Send(world.Amira, HttpMethod.Post, $"/api/performance/reviews/{reviewId}/finalize",
            new { expectedVersion = assessed.GetProperty("version").GetUInt32() }, At(start.AddDays(345))));
        await Data(await world.Send(world.Aicha, HttpMethod.Post, $"/api/performance/reviews/{reviewId}/acknowledge",
            new { comment = (string?)null }, At(start.AddDays(350))));
        var mariamsReview = await world.ReviewOfAsync(roundId, world.Mariam);
        await Data(await world.Send(world.Amira, HttpMethod.Post, $"/api/performance/reviews/{mariamsReview}/close",
            new { expectedVersion = await world.ReviewVersionAsync(mariamsReview), reason = "Reviewed separately this year" }, At(start.AddDays(351))));
        // Mariam's was the last open review: the round closed itself with it (D-34).

        // Nobody closes the year (D-57): it ends the day the next one launches, on that day's clock.
        var nextStart = end.AddDays(1);
        var next = await Data(await world.Send(world.Amira, HttpMethod.Post, "/api/performance/cycles", new
        {
            name = "This year", startDate = nextStart, endDate = nextStart.AddDays(364), planningDeadline = nextStart.AddDays(30),
            plan = new { reviewOpensOn = nextStart.AddDays(320), resultsOutOn = nextStart.AddDays(350), joinersJoin = true },
        }, At(end.AddDays(-3))));
        var nextId = next.GetProperty("id").GetGuid();
        await Data(await world.Send(world.Amira, HttpMethod.Post, $"/api/performance/cycles/{nextId}/launch",
            new { expectedVersion = await world.CycleVersionAsync(nextId) }, At(nextStart)));

        await using var db = world.Factory.Store.NewContext();
        var cycle = await db.Cycles.SingleAsync(c => c.Id == cycleId);
        Assert.Equal(CycleLifecycleState.Closed, cycle.State);
        Assert.Equal(Instant(start), cycle.ActivatedAt);
        Assert.Equal(Instant(nextStart), cycle.ClosedAt);
        var plan = await db.EmployeePlans.SingleAsync(p => p.Id == planId);
        Assert.Equal(Instant(start.AddDays(10)), plan.SubmittedAt);
        Assert.Equal(Instant(approveDay), plan.ApprovedAt);
        Assert.Contains(await db.PlanDecisions.Where(d => d.PlanId == planId).ToListAsync(),
            d => d.DecidedAt == Instant(approveDay) && d.CreatedAt == Instant(approveDay));
        Assert.Contains(await db.Notifications.Where(n => n.RecipientEmployeeId == world.Aicha.EmployeeId).ToListAsync(),
            n => n.CreatedAt == Instant(approveDay));
        var audit = await db.AuditEntries.ToListAsync();
        Assert.Contains(audit, a => a.OccurredAt == Instant(approveDay));
        Assert.All(audit, a => Assert.True(a.OccurredAt < DateTime.UtcNow.Date.AddDays(-30), $"{a.Action} at {a.OccurredAt:O}"));
        var review = await db.PerformanceReviews.SingleAsync(r => r.Id == reviewId);
        Assert.Equal(Instant(start.AddDays(345)), review.FinalizedAt);
    }

    private static async Task<string?> CodeOf(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object
            ? details.GetProperty("code").GetString()
            : null;
    }

    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode} {response.RequestMessage?.Method} {response.RequestMessage?.RequestUri}: {body}");
            return JsonDocument.Parse(body).RootElement.GetProperty("data").Clone();
        }
    }

    /// <summary>Amira (administrator, Mariam's manager), Mariam (Aicha's manager) and Aicha, on one tenant.</summary>
    private sealed class Cast : IAsyncDisposable
    {
        public static readonly EffectivePermissionGrant[] AdminGrants =
        [
            new(PerformancePermissions.CycleView, PermissionScopes.Self),
            new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
            new(PerformancePermissions.CycleView, PermissionScopes.DirectReports),
            new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
            new(PerformancePermissions.CycleView, PermissionScopes.Tenant),
            new(PerformancePermissions.StrategyPublish, PermissionScopes.Tenant),
        ];

        private static readonly EffectivePermissionGrant[] PersonGrants =
        [
            new(PerformancePermissions.CycleView, PermissionScopes.Self),
            new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
            new(PerformancePermissions.CycleView, PermissionScopes.DirectReports),
        ];

        private readonly Dictionary<Guid, HttpClient> _clients = [];

        private Cast(string environment) => Factory = new PerformanceApiFactory(environment);

        public PerformanceApiFactory Factory { get; }
        public WorkforceSnapshot Amira { get; private set; } = null!;
        public WorkforceSnapshot Mariam { get; private set; } = null!;
        public WorkforceSnapshot Aicha { get; private set; } = null!;

        public static async Task<Cast> CreateAsync(string environment)
        {
            var cast = new Cast(environment);
            var people = Guid.NewGuid();
            var product = Guid.NewGuid();
            cast.Amira = cast.Factory.Core.Add("Amira Khelifi", orgUnitId: people, orgUnitName: "People");
            cast.Mariam = cast.Factory.Core.Add("Mariam Gharbi", orgUnitId: product, orgUnitName: "Product A", managerId: cast.Amira.EmployeeId);
            cast.Aicha = cast.Factory.Core.Add("Aicha Bouazizi", orgUnitId: product, orgUnitName: "Product A", managerId: cast.Mariam.EmployeeId);
            await using var db = cast.Factory.Store.NewContext();
            db.CycleSettings.Add(CycleSettings.CreateDefault(cast.Factory.Store.TenantId));
            await db.SaveChangesAsync();
            return cast;
        }

        public async Task<HttpResponseMessage> Send(WorkforceSnapshot person, HttpMethod method, string url, object? body = null, string? clock = null)
        {
            if (!_clients.TryGetValue(person.EmployeeId, out var client))
                _clients[person.EmployeeId] = client = Factory.CreateAuthenticatedClient(employeeId: person.EmployeeId,
                    permissions: person == Amira ? AdminGrants : PersonGrants);
            using var request = new HttpRequestMessage(method, url);
            if (body is not null) request.Content = JsonContent.Create(body);
            if (clock is not null) request.Headers.Add(Header, clock);
            return await client.SendAsync(request);
        }

        /// <summary>
        /// Through the API, five days before <paramref name="start"/>: the cycle, a published company objective and the
        /// the year's steps; on <paramref name="start"/> its launch (Amira left out, no reviewer); then Aicha's plan, submitted at
        /// <paramref name="submittedAt"/>.
        /// </summary>
        public async Task<(Guid CycleId, Guid PlanId)> PlanSubmittedAsync(DateOnly start, DateTime submittedAt)
        {
            var setup = At(start.AddDays(-5));
            var cycle = await Data(await Send(Amira, HttpMethod.Post, "/api/performance/cycles",
                new
                {
                    name = "Last year", startDate = start, endDate = start.AddDays(364), planningDeadline = start.AddDays(30),
                    plan = new { reviewOpensOn = start.AddDays(320), resultsOutOn = start.AddDays(350), joinersJoin = true },
                }, setup));
            var cycleId = cycle.GetProperty("id").GetGuid();
            var direction = await Data(await Send(Amira, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/strategy", new
            {
                title = "Grow the platform", description = (string?)null, accountablePersonId = Amira.EmployeeId,
                startDate = start, endDate = start.AddDays(364), publish = true, expectedVersion = await CycleVersionAsync(cycleId),
                measurement = new { method = "NumericTarget", baseline = 0, target = 100, unit = "%", direction = "Increase", milestones = Array.Empty<object>() },
            }, setup));
            // Amira has no manager in Core HR, so she isn't in the year.
            await Data(await Send(Amira, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/launch",
                new { expectedVersion = await CycleVersionAsync(cycleId) }, At(start)));

            var planning = submittedAt.ToString("O");
            var plan = await Data(await Send(Aicha, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/plan",
                new { expectedVersion = await CycleVersionAsync(cycleId) }, planning));
            plan = await Data(await Send(Aicha, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/plan/objectives", new
            {
                title = "Ship the platform release", description = (string?)null, parentObjectiveId = direction.GetProperty("id").GetGuid(),
                startDate = start, endDate = start.AddDays(364), planWeight = 100, expectedVersion = plan.GetProperty("version").GetUInt32(),
                measurement = new { method = "NumericTarget", baseline = 0, target = 100, unit = "%", direction = "Increase", milestones = Array.Empty<object>() },
            }, planning));
            plan = await Data(await Send(Aicha, HttpMethod.Post, $"/api/performance/cycles/{cycleId}/plan/submit",
                new { expectedVersion = plan.GetProperty("version").GetUInt32() }, planning));
            return (cycleId, plan.GetProperty("id").GetGuid());
        }

        public async Task<uint> CycleVersionAsync(Guid cycleId)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.Cycles.SingleAsync(c => c.Id == cycleId)).Version;
        }

        public async Task<uint> PlanVersionAsync(Guid planId)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.EmployeePlans.SingleAsync(p => p.Id == planId)).Version;
        }

        public async Task<Guid> FirstObjectiveAsync(Guid planId)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.Objectives.FirstAsync(o => o.EmployeePlanId == planId)).Id;
        }

        public async Task<uint> ObjectiveVersionAsync(Guid objectiveId)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.Objectives.SingleAsync(o => o.Id == objectiveId)).Version;
        }

        public async Task<uint> ReviewVersionAsync(Guid reviewId)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.PerformanceReviews.SingleAsync(r => r.Id == reviewId)).Version;
        }

        public async Task<uint> RoundVersionAsync(Guid roundId)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.ReviewRounds.SingleAsync(r => r.Id == roundId)).Version;
        }

        public async Task<Guid> ReviewOfAsync(Guid roundId, WorkforceSnapshot subject)
        {
            await using var db = Factory.Store.NewContext();
            return (await db.PerformanceReviews.SingleAsync(r => r.ReviewRoundId == roundId && r.SubjectEmployeeId == subject.EmployeeId)).Id;
        }

        public async Task<int> CountCyclesAsync()
        {
            await using var db = Factory.Store.NewContext();
            return await db.Cycles.CountAsync();
        }

        public async ValueTask DisposeAsync()
        {
            foreach (var client in _clients.Values) client.Dispose();
            await Factory.DisposeAsync();
        }
    }
}
