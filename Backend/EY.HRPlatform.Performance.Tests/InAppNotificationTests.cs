using System.Net;
using System.Net.Http.Json;
using EY.HRPlatform.Performance.Infrastructure.Core;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Notifications;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>D-30: every emailed transition also notifies in the app, once, with its transition, and only its recipient sees it.</summary>
public sealed class InAppNotificationTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.Optional);

    private static EmployeePlan SubmittedPlan(Guid tenant, Guid employee, Guid manager)
    {
        var plan = EmployeePlan.Create(tenant, Guid.NewGuid(), Guid.NewGuid(), employee, "Nour", null, manager, "Lina");
        plan.Submit(employee, Ready);
        return plan;
    }

    [Theory]
    [InlineData(PerformanceNotificationKind.PlanSubmitted, "Nour submitted their plan", true)]
    [InlineData(PerformanceNotificationKind.PlanReturned, "Your plan was returned", false)]
    [InlineData(PerformanceNotificationKind.PlanApproved, "Your plan was approved", false)]
    public async Task A_plan_transition_creates_one_notification_for_the_email_recipient(
        PerformanceNotificationKind kind, string title, bool toManager)
    {
        var store = TestStore.ForNewTenant();
        var employee = Guid.NewGuid(); var manager = Guid.NewGuid();
        var plan = SubmittedPlan(store.TenantId, employee, manager);
        if (kind == PerformanceNotificationKind.PlanReturned) plan.Return(manager, "Add a measure");
        if (kind == PerformanceNotificationKind.PlanApproved) plan.Approve(manager);
        await using (var db = store.NewContext())
        {
            var notifications = new PerformanceNotifications(db);
            notifications.EnqueuePlan(plan, kind, kind == PerformanceNotificationKind.PlanSubmitted ? "Nour" : "Lina");
            notifications.EnqueuePlan(plan, kind, "Nour");
            await db.SaveChangesAsync();
        }
        await using var verify = store.NewContext();
        var outbox = Assert.Single(await verify.OutboxMessages.ToListAsync());
        var notification = Assert.Single(await verify.Notifications.ToListAsync());
        Assert.Equal(toManager ? manager : employee, notification.RecipientEmployeeId);
        Assert.Equal(outbox.RecipientEmployeeId, notification.RecipientEmployeeId);
        Assert.Equal(outbox.DedupeKey, notification.DedupeKey);
        Assert.Equal(title, notification.EnglishTitle());
        Assert.Equal($"/performance/cycles/{plan.CycleId}/plans/{plan.Id}", notification.Href);
        // The face in the bell is whoever acted: the employee who submitted, the manager who decided.
        Assert.Equal(toManager ? employee : manager, notification.ActorEmployeeId);
        Assert.Null(notification.ReadAt);
    }

    [Theory]
    [InlineData(PerformanceNotificationKind.SelfAssessmentOpened, true, "Your self-assessment is open")]
    [InlineData(PerformanceNotificationKind.ManagerAssessmentOpened, false, "Nour's review is ready for your assessment")]
    [InlineData(PerformanceNotificationKind.SelfAssessmentSubmitted, false, "Nour submitted their self-assessment")]
    [InlineData(PerformanceNotificationKind.ReviewFinalized, true, "Your review is available")]
    public async Task A_review_transition_creates_one_notification_for_the_email_recipient(
        PerformanceNotificationKind kind, bool toSubject, string title)
    {
        var store = TestStore.ForNewTenant();
        var (_, review) = OpenReview(store.TenantId);
        await using (var db = store.NewContext())
        {
            new PerformanceNotifications(db).EnqueueReview(review, kind, "Year-end");
            await db.SaveChangesAsync();
        }
        await using var verify = store.NewContext();
        var notification = Assert.Single(await verify.Notifications.ToListAsync());
        Assert.Equal(toSubject ? review.SubjectEmployeeId : review.ReviewerEmployeeId, notification.RecipientEmployeeId);
        Assert.Equal(title, notification.EnglishTitle());
        Assert.Equal("Year-end", notification.EnglishContext());
        Assert.Equal($"/performance/reviews/{review.Id}", notification.Href);
    }

    [Fact]
    public async Task An_objective_update_request_opens_the_objective_ready_to_record_progress()
    {
        var store = TestStore.ForNewTenant();
        var employee = Guid.NewGuid(); var manager = Guid.NewGuid();
        var plan = SubmittedPlan(store.TenantId, employee, manager);
        plan.Approve(manager);
        var request = UpdateRequest.Create(plan, null, manager, "Lina", null, DateTime.UtcNow);
        await using (var db = store.NewContext())
        {
            new PerformanceNotifications(db).EnqueueUpdateRequested(request, null);
            await db.SaveChangesAsync();
        }
        await using var verify = store.NewContext();
        var notification = Assert.Single(await verify.Notifications.ToListAsync());
        Assert.Equal(employee, notification.RecipientEmployeeId);
        Assert.Equal("Lina asked for a progress update", notification.EnglishTitle());
        Assert.Equal($"/performance/cycles/{plan.CycleId}/plans/{plan.Id}", notification.Href);
        var cycleId = Guid.NewGuid(); var objectiveId = Guid.NewGuid();
        Assert.Equal($"/performance/cycles/{cycleId}/objectives/{objectiveId}?mode=record",
            PerformanceNotificationTemplates.ObjectivePath(cycleId, objectiveId, record: true));
    }

    [Fact]
    public async Task A_transition_that_never_commits_leaves_no_notification()
    {
        var store = TestStore.ForNewTenant();
        var plan = SubmittedPlan(store.TenantId, Guid.NewGuid(), Guid.NewGuid());
        await using (var db = store.NewContext())
            new PerformanceNotifications(db).EnqueuePlan(plan, PerformanceNotificationKind.PlanSubmitted, "Nour");
        await using var verify = store.NewContext();
        Assert.Empty(await verify.Notifications.ToListAsync());
    }

    [Fact]
    public void Text_is_frozen_at_creation()
    {
        var (_, review) = OpenReview(Guid.NewGuid());
        var message = PerformanceOutboxMessage.ForReview(review.TenantId, PerformanceNotificationKind.ReviewFinalized,
            review.SubjectEmployeeId, review.Id, review.ReviewRoundId,
            new ReviewNotificationPayload(review.CycleId, review.ReviewRoundId, review.Id, "Year-end"));
        var notification = PerformanceNotification.For(message, null,
            PerformanceNotificationTemplates.ForReview(review, PerformanceNotificationKind.ReviewFinalized, "Year-end"), DateTime.UtcNow);
        // The round can be renamed later; the stored text and path don't depend on it.
        Assert.Equal("Year-end", notification.EnglishContext());
        Assert.Equal($"/performance/reviews/{review.Id}", notification.Href);
        Assert.Throws<ArgumentException>(() => PerformanceNotification.For(message, null,
            new PerformanceNotificationMessage("ReviewFinalized", null, new Dictionary<string, string>(), null, "https://elsewhere.test"),
            DateTime.UtcNow));
    }

    // ── HTTP: feed and read ──────────────────────────────────────────────────

    private static readonly EffectivePermissionGrant[] SelfGrant = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];

    private static async Task<PerformanceNotification> SeedAsync(PerformanceApiFactory factory, Guid recipient, DateTime occurredAt,
        Guid? tenant = null, Guid? userId = null, Guid? actor = null)
    {
        var tenantId = tenant ?? factory.Store.TenantId;
        var plan = SubmittedPlan(tenantId, Guid.NewGuid(), recipient);
        var message = PerformanceOutboxMessage.ForPlan(tenantId, PerformanceNotificationKind.PlanSubmitted, recipient, plan.Id,
            plan.Decisions.Last().Id, new PlanNotificationPayload(plan.CycleId, plan.Id, "Nour"));
        var notification = PerformanceNotification.For(message, userId,
            PerformanceNotificationTemplates.ForPlan(plan, PerformanceNotificationKind.PlanSubmitted, "Nour") with { ActorEmployeeId = actor },
            occurredAt);
        await using var db = factory.Store.NewContext(TestTenantContext.WithTenant(tenantId));
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();
        return notification;
    }

    private static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    [Fact]
    public async Task The_feed_lists_only_the_callers_own_newest_first_with_the_unread_count()
    {
        await using var factory = new PerformanceApiFactory();
        var lina = Guid.NewGuid(); var other = Guid.NewGuid();
        var nour = Guid.NewGuid(); var karim = Guid.NewGuid();
        var older = await SeedAsync(factory, lina, DateTime.UtcNow.AddHours(-2), actor: karim);
        var newer = await SeedAsync(factory, lina, DateTime.UtcNow.AddMinutes(-5), actor: nour);
        await SeedAsync(factory, other, DateTime.UtcNow);
        await SeedAsync(factory, lina, DateTime.UtcNow, tenant: Guid.NewGuid());
        // Nour has a photo in Core, Karim doesn't.
        const string photoUrl = "/corehr/employees/people/E-NOUR/photo?v=abc";
        factory.Core.ById[nour] = new WorkforceSnapshot(nour, "E-NOUR", "Nour", "Nour", null, null, true, null, null, PhotoUrl: photoUrl);
        factory.Core.ById[karim] = new WorkforceSnapshot(karim, "E-KARIM", "Karim", "Karim", null, null, true, null, null);

        var page = await Data(await factory.CreateAuthenticatedClient(employeeId: lina, permissions: SelfGrant)
            .GetAsync("/api/performance/notifications"));
        var ids = page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray();
        Assert.Equal(new[] { newer.Id.ToString(), older.Id.ToString() }, ids);
        Assert.Equal(2, page.GetProperty("unreadCount").GetInt32());
        var first = page.GetProperty("items")[0];
        Assert.Equal("performance", first.GetProperty("module").GetString());
        Assert.Equal("PlanSubmitted", first.GetProperty("kind").GetString());
        Assert.Equal("Nour submitted their plan", first.GetProperty("title").GetString());
        Assert.Equal("plan", first.GetProperty("badge").GetString());
        Assert.Equal(photoUrl, first.GetProperty("actorPhotoUrl").GetString());
        Assert.Equal(JsonValueKind.Null, page.GetProperty("items")[1].GetProperty("actorPhotoUrl").ValueKind);
    }

    [Fact]
    public async Task A_notification_without_a_name_carries_no_actor_either()
    {
        var store = TestStore.ForNewTenant();
        var employee = Guid.NewGuid(); var manager = Guid.NewGuid();
        var plan = SubmittedPlan(store.TenantId, employee, manager);
        plan.Approve(manager);
        await using (var db = store.NewContext())
        {
            new PerformanceNotifications(db).EnqueuePlan(plan, PerformanceNotificationKind.PlanApproved, null);
            await db.SaveChangesAsync();
        }
        await using var verify = store.NewContext();
        var notification = Assert.Single(await verify.Notifications.ToListAsync());
        Assert.Null(notification.ActorName);
        Assert.Null(notification.ActorEmployeeId);
    }

    [Fact]
    public void Every_kind_has_a_badge_the_bell_knows()
    {
        string[] known = ["praise", "feedback", "meeting", "action", "plan", "review", "reminder"];
        foreach (var kind in Enum.GetValues<PerformanceNotificationKind>())
            Assert.Contains(NotificationFeed.Badge(kind), known);
        Assert.Equal("praise", NotificationFeed.Badge(PerformanceNotificationKind.PraiseReceived));
        Assert.Equal("action", NotificationFeed.Badge(PerformanceNotificationKind.OneOnOneActionAssigned));
        Assert.Equal("reminder", NotificationFeed.Badge(PerformanceNotificationKind.ReviewReminder));
    }

    [Fact]
    public async Task The_feed_pages_with_a_cursor_and_caps_the_page_at_twenty()
    {
        await using var factory = new PerformanceApiFactory();
        var lina = Guid.NewGuid();
        for (var i = 0; i < 22; i++) await SeedAsync(factory, lina, DateTime.UtcNow.AddMinutes(-i));
        var client = factory.CreateAuthenticatedClient(employeeId: lina, permissions: SelfGrant);

        var first = await Data(await client.GetAsync("/api/performance/notifications?limit=50"));
        Assert.Equal(20, first.GetProperty("items").GetArrayLength());
        var cursor = first.GetProperty("nextCursor").GetString();
        Assert.False(string.IsNullOrEmpty(cursor));
        var second = await Data(await client.GetAsync($"/api/performance/notifications?cursor={cursor}"));
        Assert.Equal(2, second.GetProperty("items").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, second.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task Marking_read_changes_only_the_callers_own_and_is_idempotent()
    {
        await using var factory = new PerformanceApiFactory();
        var lina = Guid.NewGuid(); var other = Guid.NewGuid();
        var mine = await SeedAsync(factory, lina, DateTime.UtcNow.AddMinutes(-1));
        await SeedAsync(factory, lina, DateTime.UtcNow);
        var theirs = await SeedAsync(factory, other, DateTime.UtcNow);
        var client = factory.CreateAuthenticatedClient(employeeId: lina, permissions: SelfGrant);

        var one = await Data(await client.PostAsJsonAsync("/api/performance/notifications/read", new { ids = new[] { mine.Id } }));
        Assert.Equal(1, one.GetProperty("unreadCount").GetInt32());

        // Someone else's id answers exactly like an unknown one and stays unread.
        var foreign = await Data(await client.PostAsJsonAsync("/api/performance/notifications/read", new { ids = new[] { theirs.Id } }));
        var unknown = await Data(await client.PostAsJsonAsync("/api/performance/notifications/read", new { ids = new[] { Guid.NewGuid() } }));
        Assert.Equal(unknown.GetRawText(), foreign.GetRawText());
        await using (var db = factory.Store.NewContext())
            Assert.Null((await db.Notifications.SingleAsync(n => n.Id == theirs.Id)).ReadAt);

        var all = await Data(await client.PostAsJsonAsync("/api/performance/notifications/read", new { all = true }));
        Assert.Equal(0, all.GetProperty("unreadCount").GetInt32());
        var again = await Data(await client.PostAsJsonAsync("/api/performance/notifications/read", new { all = true }));
        Assert.Equal(0, again.GetProperty("unreadCount").GetInt32());
        await using (var db = factory.Store.NewContext())
            Assert.Null((await db.Notifications.SingleAsync(n => n.Id == theirs.Id)).ReadAt);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/performance/notifications/read", new { })).StatusCode);
    }

    [Fact]
    public async Task A_facilitator_without_an_employee_record_reads_by_account()
    {
        await using var factory = new PerformanceApiFactory();
        var user = Guid.NewGuid();
        await SeedAsync(factory, Guid.NewGuid(), DateTime.UtcNow, userId: user);
        var page = await Data(await factory.CreateAuthenticatedClient(userId: user, permissions: SelfGrant)
            .GetAsync("/api/performance/notifications"));
        Assert.Equal(1, page.GetProperty("unreadCount").GetInt32());
    }

    [Fact]
    public async Task Notifications_past_retention_leave_the_feed_and_the_count()
    {
        await using var factory = new PerformanceApiFactory();
        var lina = Guid.NewGuid();
        await SeedAsync(factory, lina, DateTime.UtcNow.AddDays(-181));
        var kept = await SeedAsync(factory, lina, DateTime.UtcNow.AddDays(-179));
        var page = await Data(await factory.CreateAuthenticatedClient(employeeId: lina, permissions: SelfGrant)
            .GetAsync("/api/performance/notifications"));
        Assert.Equal(kept.Id.ToString(), Assert.Single(page.GetProperty("items").EnumerateArray()).GetProperty("id").GetString());
        Assert.Equal(1, page.GetProperty("unreadCount").GetInt32());
    }

    [Fact]
    public async Task A_tenant_without_Performance_is_refused()
    {
        await using var factory = new PerformanceApiFactory();
        var client = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: SelfGrant,
            modules: [ModuleEntitlements.CoreHR]);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/performance/notifications")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/performance/notifications/read", new { all = true })).StatusCode);
    }

    // ── Relational: same transaction, retention purge, migration ──────────────

    [RelationalDatabaseFact]
    public async Task Notifications_commit_and_roll_back_with_their_transition_and_retention_purges_old_rows()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        try
        {
            await RelationalTests.CreateDatabaseAsync(baseConnection, name);
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                await db.Database.MigrateAsync();
                await using var transaction = await db.Database.BeginTransactionAsync();
                new PerformanceNotifications(db).EnqueuePlan(SubmittedPlan(tenant, Guid.NewGuid(), Guid.NewGuid()),
                    PerformanceNotificationKind.PlanSubmitted, "Nour");
                await db.SaveChangesAsync();
                await transaction.RollbackAsync();
            }
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                Assert.Empty(await db.Notifications.ToListAsync());
                Assert.Empty(await db.OutboxMessages.ToListAsync());

                var plan = SubmittedPlan(tenant, Guid.NewGuid(), Guid.NewGuid());
                new PerformanceNotifications(db).EnqueuePlan(plan, PerformanceNotificationKind.PlanSubmitted, "Nour");
                await db.SaveChangesAsync();
                var duplicate = PerformanceNotification.For(await db.OutboxMessages.SingleAsync(), null,
                    PerformanceNotificationTemplates.ForPlan(plan, PerformanceNotificationKind.PlanSubmitted, "Nour"), DateTime.UtcNow);
                db.Notifications.Add(duplicate);
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            }

            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                var oldPlan = SubmittedPlan(tenant, Guid.NewGuid(), Guid.NewGuid());
                var oldMessage = PerformanceOutboxMessage.ForPlan(tenant, PerformanceNotificationKind.PlanSubmitted,
                    oldPlan.ResponsibleManagerId!.Value, oldPlan.Id, oldPlan.Decisions.Last().Id,
                    new PlanNotificationPayload(oldPlan.CycleId, oldPlan.Id, "Nour"));
                db.Notifications.Add(PerformanceNotification.For(oldMessage, null,
                    PerformanceNotificationTemplates.ForPlan(oldPlan, PerformanceNotificationKind.PlanSubmitted, "Nour"),
                    DateTime.UtcNow.AddDays(-181)));
                await db.SaveChangesAsync();
            }

            var services = new ServiceCollection();
            services.AddScoped<EY.HRPlatform.SharedKernel.Multitenancy.TenantContext>();
            services.AddScoped<EY.HRPlatform.SharedKernel.Multitenancy.ITenantContext>(sp =>
                sp.GetRequiredService<EY.HRPlatform.SharedKernel.Multitenancy.TenantContext>());
            services.AddDbContext<EY.HRPlatform.Performance.Infrastructure.Persistence.PerformanceDbContext>(options => options.UseNpgsql(connection));
            await using var provider = services.BuildServiceProvider();
            var removed = await new PerformanceNotificationRetention(provider.GetRequiredService<IServiceScopeFactory>())
                .PurgeAsync(DateTime.UtcNow, default);
            Assert.Equal(1, removed);
            await using (var db = RelationalTests.CreateDb(connection, tenant))
                Assert.Single(await db.Notifications.ToListAsync());
        }
        finally { await RelationalTests.DropDatabaseAsync(baseConnection, name); }
    }

    private static (ReviewRound Round, PerformanceReview Review) OpenReview(Guid tenant)
    {
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", Start, Start.AddYears(1).AddDays(-1), Start.AddDays(30)).Activated();
        var round = ReviewRound.CreateDraft(tenant, cycle, "Year-end", Start, Start.AddMonths(11), true, false, true);
        var scale = RatingScale.CreateDefault(tenant);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var participant = Participant.Create(tenant, cycle.Id, Guid.NewGuid(), "Nour", null, null, null,
            Guid.NewGuid(), "Lina", false, Start);
        var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, participant.ManagerEmployeeId, "Lina");
        var review = PerformanceReview.Open(tenant, round, subject, version.Id, version.LevelsJson, DateTime.UtcNow);
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        return (round, review);
    }
}
