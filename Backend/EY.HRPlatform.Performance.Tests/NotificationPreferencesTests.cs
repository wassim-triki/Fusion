using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Features.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Email choices per notification group (B-071 D8): the map, the caller-only endpoints, and dispatch.</summary>
public sealed class NotificationPreferencesTests
{
    private static readonly EffectivePermissionGrant[] Employee =
        [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.CycleView, PermissionScopes.DirectReports), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
            new(PerformancePermissions.ReviewCalibrate, PermissionScopes.Tenant)];

    private const string Path = "/api/performance/notification-preferences";

    [Fact]
    public void Every_kind_belongs_to_exactly_one_group_and_the_catalogue_lists_it_there()
    {
        var listed = NotificationPreferenceCatalog.Listed().Where(item => item.Group != NotificationGroups.ReviewsAndCalibration
            || item.Kind != PerformanceNotificationKind.ReviewReminder).ToList();
        foreach (var kind in Enum.GetValues<PerformanceNotificationKind>())
        {
            var group = NotificationGroups.Of(kind);
            Assert.Equal(group, Assert.Single(listed, item => item.Kind == kind).Group);
        }
        Assert.Equal(NotificationGroups.DeadlineReminders, NotificationGroups.Of(PerformanceNotificationKind.ReviewReminder));
        Assert.Equal(NotificationEmailMode.Required, NotificationGroups.FusionDefault(NotificationGroups.DeadlineReminders));
        Assert.All(NotificationGroups.All.Where(group => group != NotificationGroups.DeadlineReminders),
            group => Assert.Equal(NotificationEmailMode.On, NotificationGroups.FusionDefault(group)));
    }

    [Fact]
    public async Task Every_group_is_emailed_until_the_person_turns_it_off()
    {
        await using var factory = new PerformanceApiFactory();
        var aicha = factory.Core.Add("Aicha Bouazizi");
        factory.Core.ById[aicha.EmployeeId] = aicha with { WorkEmail = "aicha.bouazizi@carthage.test" };
        using var client = factory.CreateAuthenticatedClient(employeeId: aicha.EmployeeId, permissions: Employee);

        var initial = await DataAsync(await client.GetAsync(Path));
        Assert.Equal("aicha.bouazizi@carthage.test", initial.GetProperty("emailAddress").GetString());
        Assert.Equal(0u, initial.GetProperty("version").GetUInt32());
        var groups = initial.GetProperty("groups").EnumerateArray().ToList();
        Assert.Equal(["plans-and-goals", "reviews-and-calibration", "one-on-ones", "feedback-and-praise", "deadline-reminders"],
            groups.Select(group => group.GetProperty("key").GetString()));
        Assert.All(groups, group => Assert.True(group.GetProperty("email").GetBoolean()));
        Assert.True(groups[4].GetProperty("locked").GetBoolean());
        Assert.All(groups.SelectMany(group => group.GetProperty("items").EnumerateArray()), item => Assert.False(item.GetProperty("team").GetBoolean()));

        var saved = await DataAsync(await client.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "one-on-ones" } }));
        var oneOnOnes = saved.GetProperty("groups").EnumerateArray().Single(group => group.GetProperty("key").GetString() == "one-on-ones");
        Assert.False(oneOnOnes.GetProperty("email").GetBoolean());

        var reread = await DataAsync(await client.GetAsync(Path));
        Assert.False(reread.GetProperty("groups")[2].GetProperty("email").GetBoolean());
        Assert.True(reread.GetProperty("groups")[0].GetProperty("email").GetBoolean());
    }

    [Fact]
    public async Task Deadline_reminders_and_unknown_groups_cannot_be_turned_off_and_a_stale_save_is_refused()
    {
        await using var factory = new PerformanceApiFactory();
        using var client = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee);

        using (var locked = await client.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "deadline-reminders" } }))
            Assert.Equal(HttpStatusCode.BadRequest, locked.StatusCode);
        using (var unknown = await client.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "everything" } }))
            Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        using (var stale = await client.PutAsJsonAsync(Path, new { expectedVersion = 7, emailOff = Array.Empty<string>() }))
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task A_manager_sees_their_teams_work_in_the_same_groups()
    {
        await using var factory = new PerformanceApiFactory();
        using var mariam = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Manager);

        var reviews = (await DataAsync(await mariam.GetAsync(Path))).GetProperty("groups")[1];
        Assert.Equal(13, reviews.GetProperty("count").GetInt32());
        var items = reviews.GetProperty("items").EnumerateArray().ToList();
        Assert.True(items.Single(item => item.GetProperty("label").GetString() == "A review to write opens").GetProperty("team").GetBoolean());
        Assert.True(items.Single(item => item.GetProperty("label").GetString() == "A review of yours is due tomorrow or late").GetProperty("always").GetBoolean());
    }

    [Fact]
    public async Task Choices_belong_to_the_caller_in_their_tenant_only()
    {
        await using var factory = new PerformanceApiFactory();
        var aicha = Guid.NewGuid();
        using var own = factory.CreateAuthenticatedClient(employeeId: aicha, permissions: Employee);
        using var colleague = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee);
        using var otherTenant = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: aicha, permissions: Employee);
        using (var saved = await own.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "feedback-and-praise" } }))
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        Assert.True((await DataAsync(await colleague.GetAsync(Path))).GetProperty("groups")[3].GetProperty("email").GetBoolean());
        Assert.True((await DataAsync(await otherTenant.GetAsync(Path))).GetProperty("groups")[3].GetProperty("email").GetBoolean());
        await using var db = factory.Store.NewContext();
        var row = Assert.Single(await db.NotificationPreferences.ToListAsync());
        Assert.Equal(aicha, row.RecipientEmployeeId);
        Assert.Null(row.RecipientUserId);
    }

    [Fact]
    public async Task Someone_without_an_employee_record_keeps_their_choice_on_their_account()
    {
        await using var factory = new PerformanceApiFactory();
        var account = Guid.NewGuid();
        using var facilitator = factory.CreateAuthenticatedClient(userId: account, permissions:
            [new(PerformancePermissions.ReviewCalibrate, PermissionScopes.Tenant)]);
        using (var saved = await facilitator.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "reviews-and-calibration" } }))
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.False((await DataAsync(await facilitator.GetAsync(Path))).GetProperty("groups")[1].GetProperty("email").GetBoolean());

        await using var db = factory.Store.NewContext();
        var row = Assert.Single(await db.NotificationPreferences.ToListAsync());
        Assert.Equal(account, row.RecipientUserId);
        Assert.Null(row.RecipientEmployeeId);
    }

    [Fact]
    public async Task An_opted_out_group_is_skipped_by_email_and_kept_in_the_app()
    {
        var store = TestStore.ForNewTenant();
        var core = new FakeCoreWorkforceClient();
        var mariam = core.Add("Mariam Gharbi");
        core.ById[mariam.EmployeeId] = mariam with { WorkEmail = "mariam@carthage.test" };
        var sender = new CapturingNotificationSender();
        await using (var db = store.NewContext())
        {
            var preference = NotificationPreference.For(store.TenantId, mariam.EmployeeId, null);
            preference.SetEmailOff(NotificationGroups.All.Where(group => group != NotificationGroups.DeadlineReminders).ToArray(), null);
            db.NotificationPreferences.Add(preference);
            new PerformanceNotifications(db).EnqueueConversation(store.TenantId, PerformanceNotificationKind.PraiseReceived,
                mariam.EmployeeId, Guid.NewGuid(), "Praise", Guid.NewGuid(), Guid.NewGuid(),
                PerformanceNotificationTemplates.ForPraiseReceived("Karim", "Ownership", Guid.NewGuid()));
            var reminder = ReminderFor(store.TenantId, mariam.EmployeeId);
            db.OutboxMessages.Add(reminder);
            db.Notifications.Add(PerformanceNotification.For(reminder, null, PerformanceNotificationTemplates.ForReminder("selfAssessment", null,
                new DateOnly(2026, 11, 2), 0, "Year-end", "/performance/reviews"), DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = store.NewContext())
        {
            var dispatcher = new PerformanceNotificationDispatcher(db, store.Tenant, core, new FakeNotificationAudienceClient(), sender,
                Options.Create(new PerformanceNotificationOptions { Enabled = true, ShellBaseUrl = "http://localhost:3000" }));
            foreach (var message in await db.OutboxMessages.ToListAsync())
                await dispatcher.DispatchAsync(message, DateTime.UtcNow, default);
        }

        await using var verify = store.NewContext();
        var praise = await verify.OutboxMessages.SingleAsync(message => message.Kind == PerformanceNotificationKind.PraiseReceived);
        Assert.Equal("RecipientOptedOut", praise.SkippedReason);
        Assert.Null(praise.DispatchedAt);
        Assert.NotNull((await verify.OutboxMessages.SingleAsync(message => message.Kind == PerformanceNotificationKind.ReviewReminder)).DispatchedAt);
        Assert.Equal("mariam@carthage.test", Assert.Single(sender.Delivered).Email);
        Assert.Single(await verify.Notifications.Where(n => n.Kind == PerformanceNotificationKind.PraiseReceived
            && n.RecipientEmployeeId == mariam.EmployeeId).ToListAsync());
    }

    [RelationalDatabaseFact]
    public async Task Preferences_store_their_groups_once_per_recipient()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        var employee = Guid.NewGuid();
        try
        {
            await RelationalTests.CreateDatabaseAsync(baseConnection, databaseName);
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                await db.Database.MigrateAsync();
                var company = NotificationDefaults.For(tenant);
                company.Set(new Dictionary<string, NotificationEmailMode> { [NotificationGroups.PlansAndGoals] = NotificationEmailMode.Off });
                db.NotificationDefaults.Add(company);
                var preference = NotificationPreference.For(tenant, employee, null);
                preference.SetEmailOff([NotificationGroups.FeedbackAndPraise, NotificationGroups.OneOnOnes], company);
                db.NotificationPreferences.Add(preference);
                await db.SaveChangesAsync();
            }

            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                var stored = await db.NotificationPreferences.SingleAsync();
                Assert.Equal([NotificationGroups.OneOnOnes, NotificationGroups.FeedbackAndPraise], stored.EmailOff);
                Assert.Equal([NotificationGroups.PlansAndGoals], stored.EmailOn);
                Assert.NotEqual(0u, stored.Version);
                var company = await db.NotificationDefaults.SingleAsync();
                Assert.Equal([NotificationGroups.DeadlineReminders], company.Required);
                Assert.Equal([NotificationGroups.PlansAndGoals], company.Off);
                Assert.NotEqual(0u, company.Version);
                db.NotificationPreferences.Add(NotificationPreference.For(tenant, employee, null));
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            }

            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                db.NotificationDefaults.Add(NotificationDefaults.For(tenant));
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            }

            await using (var other = RelationalTests.CreateDb(connection, Guid.NewGuid()))
            {
                Assert.Empty(await other.NotificationPreferences.ToListAsync());
                Assert.Empty(await other.NotificationDefaults.ToListAsync());
            }
        }
        finally { await RelationalTests.DropDatabaseAsync(baseConnection, databaseName); }
    }

    [Fact]
    public void A_person_follows_the_company_unless_they_chose_otherwise()
    {
        var company = NotificationDefaults.For(Guid.NewGuid());
        company.Set(new Dictionary<string, NotificationEmailMode>
        {
            [NotificationGroups.PlansAndGoals] = NotificationEmailMode.Required,
            [NotificationGroups.FeedbackAndPraise] = NotificationEmailMode.Off,
            [NotificationGroups.DeadlineReminders] = NotificationEmailMode.On,
        });
        Assert.True(NotificationPreference.EmailsGroup(null, company, NotificationGroups.PlansAndGoals));
        Assert.False(NotificationPreference.EmailsGroup(null, company, NotificationGroups.FeedbackAndPraise));
        Assert.True(NotificationPreference.EmailsGroup(null, company, NotificationGroups.OneOnOnes));

        var person = NotificationPreference.For(company.TenantId, Guid.NewGuid(), null);
        person.SetEmailOff([NotificationGroups.OneOnOnes, NotificationGroups.DeadlineReminders], company);
        Assert.Equal([NotificationGroups.OneOnOnes, NotificationGroups.DeadlineReminders], person.EmailOff);
        Assert.Equal([NotificationGroups.FeedbackAndPraise], person.EmailOn);
        Assert.True(NotificationPreference.EmailsGroup(person, company, NotificationGroups.FeedbackAndPraise));
        Assert.False(NotificationPreference.EmailsGroup(person, company, NotificationGroups.DeadlineReminders));
        Assert.Throws<ArgumentException>(() => person.SetEmailOff([NotificationGroups.PlansAndGoals], company));

        // Required later overrides a choice made before; the choice comes back if the company relaxes it again.
        company.Set(new Dictionary<string, NotificationEmailMode> { [NotificationGroups.OneOnOnes] = NotificationEmailMode.Required });
        Assert.True(NotificationPreference.EmailsGroup(person, company, NotificationGroups.OneOnOnes));
        company.Set(new Dictionary<string, NotificationEmailMode> { [NotificationGroups.OneOnOnes] = NotificationEmailMode.On });
        Assert.False(NotificationPreference.EmailsGroup(person, company, NotificationGroups.OneOnOnes));

        // An unsubscribe link turns its group off and leaves the rest; a required group stays on.
        person.TurnOff(NotificationGroups.FeedbackAndPraise, company);
        Assert.Empty(person.EmailOn);
        person.TurnOff(NotificationGroups.PlansAndGoals, company);
        Assert.True(NotificationPreference.EmailsGroup(person, company, NotificationGroups.PlansAndGoals));
        Assert.False(NotificationPreference.EmailsGroup(person, company, NotificationGroups.OneOnOnes));
    }

    private static readonly EffectivePermissionGrant[] SettingsAdmin =
        [new(PerformancePermissions.SettingsView, PermissionScopes.Tenant), new(PerformancePermissions.SettingsManage, PermissionScopes.Tenant)];

    private const string DefaultsPath = "/api/performance/settings/notifications";

    [Fact]
    public async Task The_company_sets_each_group_and_people_see_what_it_requires()
    {
        await using var factory = new PerformanceApiFactory();
        using var admin = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: SettingsAdmin);
        using var person = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee);

        var initial = await DataAsync(await admin.GetAsync(DefaultsPath));
        Assert.Equal(0u, initial.GetProperty("version").GetUInt32());
        Assert.Equal(["on", "on", "on", "on", "required"], initial.GetProperty("groups").EnumerateArray().Select(group => group.GetProperty("mode").GetString()));
        Assert.Equal(["on", "on", "on", "on", "required"], initial.GetProperty("groups").EnumerateArray().Select(group => group.GetProperty("fusionDefault").GetString()));

        var saved = await DataAsync(await admin.PutAsJsonAsync(DefaultsPath, new
        {
            expectedVersion = 0,
            modes = new Dictionary<string, string> { ["plans-and-goals"] = "required", ["feedback-and-praise"] = "off", ["deadline-reminders"] = "on" },
        }));
        Assert.Equal(["required", "on", "on", "off", "on"], saved.GetProperty("groups").EnumerateArray().Select(group => group.GetProperty("mode").GetString()));

        var mine = (await DataAsync(await person.GetAsync(Path))).GetProperty("groups").EnumerateArray().ToList();
        Assert.Equal([true, false, false, false, false], mine.Select(group => group.GetProperty("locked").GetBoolean()));
        Assert.Equal([true, true, true, false, true], mine.Select(group => group.GetProperty("email").GetBoolean()));

        using (var refused = await person.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "plans-and-goals" } }))
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        var chosen = (await DataAsync(await person.PutAsJsonAsync(Path, new { expectedVersion = 0, emailOff = new[] { "deadline-reminders" } })))
            .GetProperty("groups").EnumerateArray().ToList();
        Assert.Equal([true, true, true, true, false], chosen.Select(group => group.GetProperty("email").GetBoolean()));

        var sections = (await DataAsync(await admin.GetAsync("/api/performance/settings/sections"))).EnumerateArray()
            .Single(section => section.GetProperty("id").GetString() == "notifications");
        Assert.Equal("manage", sections.GetProperty("access").GetString());
        Assert.NotEqual(JsonValueKind.Null, sections.GetProperty("lastChange").ValueKind);
    }

    [Fact]
    public async Task Company_modes_refuse_unknown_groups_and_modes_stale_saves_and_other_tenants()
    {
        await using var factory = new PerformanceApiFactory();
        using var admin = factory.CreateAuthenticatedClient(permissions: SettingsAdmin);
        using var otherTenant = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), permissions: SettingsAdmin);
        using var person = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee);

        using (var unknownGroup = await admin.PutAsJsonAsync(DefaultsPath, new { expectedVersion = 0, modes = new Dictionary<string, string> { ["everything"] = "off" } }))
            Assert.Equal(HttpStatusCode.BadRequest, unknownGroup.StatusCode);
        using (var unknownMode = await admin.PutAsJsonAsync(DefaultsPath, new { expectedVersion = 0, modes = new Dictionary<string, string> { ["one-on-ones"] = "sometimes" } }))
            Assert.Equal(HttpStatusCode.BadRequest, unknownMode.StatusCode);
        using (var stale = await admin.PutAsJsonAsync(DefaultsPath, new { expectedVersion = 5, modes = new Dictionary<string, string>() }))
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using (var forbiddenRead = await person.GetAsync(DefaultsPath))
            Assert.Equal(HttpStatusCode.Forbidden, forbiddenRead.StatusCode);
        using (var forbiddenWrite = await person.PutAsJsonAsync(DefaultsPath, new { expectedVersion = 0, modes = new Dictionary<string, string> { ["one-on-ones"] = "off" } }))
            Assert.Equal(HttpStatusCode.Forbidden, forbiddenWrite.StatusCode);

        var saved = await DataAsync(await admin.PutAsJsonAsync(DefaultsPath, new { expectedVersion = 0, modes = new Dictionary<string, string> { ["one-on-ones"] = "off" } }));
        Assert.Equal("off", saved.GetProperty("groups")[2].GetProperty("mode").GetString());
        Assert.Equal("on", (await DataAsync(await otherTenant.GetAsync(DefaultsPath))).GetProperty("groups")[2].GetProperty("mode").GetString());
    }

    [Fact]
    public async Task Dispatch_follows_the_company_mode_and_the_persons_choice_against_it()
    {
        var store = TestStore.ForNewTenant();
        var core = new FakeCoreWorkforceClient();
        var mariam = core.Add("Mariam Gharbi");
        var karim = core.Add("Karim Ben Ali");
        core.ById[mariam.EmployeeId] = mariam with { WorkEmail = "mariam@carthage.test" };
        core.ById[karim.EmployeeId] = karim with { WorkEmail = "karim@carthage.test" };
        var sender = new CapturingNotificationSender();
        await using (var db = store.NewContext())
        {
            var company = NotificationDefaults.For(store.TenantId);
            company.Set(new Dictionary<string, NotificationEmailMode>
            {
                [NotificationGroups.FeedbackAndPraise] = NotificationEmailMode.Off,
                [NotificationGroups.DeadlineReminders] = NotificationEmailMode.On,
            });
            db.NotificationDefaults.Add(company);
            // Mariam turned praise back on and deadline reminders off; Karim follows the company.
            var preference = NotificationPreference.For(store.TenantId, mariam.EmployeeId, null);
            preference.SetEmailOff([NotificationGroups.DeadlineReminders], company);
            db.NotificationPreferences.Add(preference);
            foreach (var recipient in new[] { mariam.EmployeeId, karim.EmployeeId })
            {
                new PerformanceNotifications(db).EnqueueConversation(store.TenantId, PerformanceNotificationKind.PraiseReceived,
                    recipient, Guid.NewGuid(), "Praise", Guid.NewGuid(), Guid.NewGuid(),
                    PerformanceNotificationTemplates.ForPraiseReceived("Hana", "Ownership", Guid.NewGuid()));
                var reminder = ReminderFor(store.TenantId, recipient);
                db.OutboxMessages.Add(reminder);
                db.Notifications.Add(PerformanceNotification.For(reminder, null, PerformanceNotificationTemplates.ForReminder("selfAssessment", null,
                    new DateOnly(2026, 11, 2), 0, "Year-end", "/performance/reviews"), DateTime.UtcNow));
            }
            await db.SaveChangesAsync();
        }

        await using (var db = store.NewContext())
        {
            var dispatcher = new PerformanceNotificationDispatcher(db, store.Tenant, core, new FakeNotificationAudienceClient(), sender,
                Options.Create(new PerformanceNotificationOptions
                    { Enabled = true, ShellBaseUrl = "http://localhost:3000", UnsubscribeKey = PerformanceApiFactory.UnsubscribeKey }));
            foreach (var message in await db.OutboxMessages.ToListAsync())
                await dispatcher.DispatchAsync(message, DateTime.UtcNow, default);
        }

        Assert.Equal(["karim@carthage.test", "mariam@carthage.test"], sender.Delivered.Select(email => email.Email).Order());
        Assert.Contains(sender.Delivered, email => email.Email == "mariam@carthage.test" && email.Mail.Content.Subject.Length > 0);
        // A deadline reminder the company relaxed to On now carries the one-click unsubscribe too.
        Assert.All(sender.Delivered, email => Assert.NotNull(email.Mail.UnsubscribeUrl));
    }

    private static PerformanceOutboxMessage ReminderFor(Guid tenant, Guid recipient)
    {
        var review = Guid.NewGuid();
        return PerformanceOutboxMessage.ForReviewWork(tenant, PerformanceNotificationKind.ReviewReminder, recipient, "PerformanceReview", review,
            $"Reminder:self:{review:N}:2026-10-24",
            new ReviewWorkNotificationPayload(Guid.NewGuid(), Guid.NewGuid(), review, "FY2027 reviews", $"/performance/reviews/{review}"));
    }

    private static async Task<JsonElement> DataAsync(HttpResponseMessage response)
    {
        using (response)
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return json.RootElement.GetProperty("data").Clone();
        }
    }
}
