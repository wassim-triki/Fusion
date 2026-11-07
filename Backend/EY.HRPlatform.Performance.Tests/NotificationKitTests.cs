using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Features.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// B-153: notifications stored as keys and values and worded per reader (EN/FR/AR), emails in the recipient's language on
/// the shared layout with one-click unsubscribe, reminders on company working days, and the content-free live nudge.
/// </summary>
public sealed class NotificationKitTests
{
    private static readonly EffectivePermissionGrant[] SelfGrant = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static NotificationCatalog Catalog => PerformanceNotificationRenderer.Catalog;

    // ── Catalogue ────────────────────────────────────────────────────────────

    private static string Base(string key) => key.Split('#')[0];

    [Theory]
    [InlineData("fr")]
    [InlineData("ar")]
    public void Every_entry_is_worded_in_each_language_with_the_same_values(string language)
    {
        var english = Catalog.Entries[FusionLanguages.English];
        var other = Catalog.Entries[language];
        Assert.Empty(english.Keys.Select(Base).Distinct().Except(other.Keys.Select(Base)));
        Assert.Empty(other.Keys.Select(Base).Distinct().Except(english.Keys.Select(Base)));
        foreach (var (key, text) in other)
        {
            // Plural forms may drop the number ("a day late"), so they're checked against every English form of the entry.
            var source = english.Where(entry => Base(entry.Key) == Base(key)).SelectMany(entry => NotificationCatalog.PlaceholdersOf(entry.Value)).ToHashSet();
            var mine = NotificationCatalog.PlaceholdersOf(text);
            Assert.True(key.Contains('#') ? mine.IsSubsetOf(source) : mine.SetEquals(source), $"{language} {key}");
        }
        Assert.Equal(FusionNotificationEmail.Text.Entries[FusionLanguages.English].Keys.Order(), FusionNotificationEmail.Text.Entries[language].Keys.Order());
    }

    [Fact]
    public void Emails_only_name_people_rounds_dates_and_counts()
    {
        string[] allowed = ["actor", "owner", "subject", "reviewer", "peer", "round", "due", "from", "count", "total", "title"];
        foreach (var (language, entries) in Catalog.Entries)
            foreach (var (key, text) in entries.Where(entry => Base(entry.Key).EndsWith(".subject") || Base(entry.Key).EndsWith(".lead")))
                Assert.True(NotificationCatalog.PlaceholdersOf(text).IsSubsetOf(allowed), $"{language} {key}: {text}");
    }

    [Fact]
    public void Every_kind_has_an_email_and_a_group_name()
    {
        foreach (var kind in Enum.GetValues<PerformanceNotificationKind>())
        {
            Assert.NotNull(Catalog.Text("en", $"{kind}.action"));
            Assert.NotNull(Catalog.Text("en", $"group.{NotificationGroups.Of(kind)}"));
        }
    }

    [Fact]
    public void Plural_forms_and_dates_follow_the_language()
    {
        var late = new Dictionary<string, string> { ["count"] = "1" };
        Assert.Equal("Your self-assessment is a day late", Catalog.Text("en", "Reminder.selfAssessment.late", late));
        Assert.Equal("Your self-assessment is 8 days late", Catalog.Text("en", "Reminder.selfAssessment.late", new Dictionary<string, string> { ["count"] = "8" }));
        Assert.Equal("Votre auto-évaluation a un jour de retard", Catalog.Text("fr", "Reminder.selfAssessment.late", late));
        Assert.Equal("تقييمك الذاتي متأخر يومين", Catalog.Text("ar", "Reminder.selfAssessment.late", new Dictionary<string, string> { ["count"] = "2" }));
        Assert.Equal("تقييمك الذاتي متأخر 5 أيام", Catalog.Text("ar", "Reminder.selfAssessment.late", new Dictionary<string, string> { ["count"] = "5" }));
        Assert.Equal("تقييمك الذاتي متأخر 12 يومًا", Catalog.Text("ar", "Reminder.selfAssessment.late", new Dictionary<string, string> { ["count"] = "12" }));

        var due = new Dictionary<string, string> { ["due"] = "2026-10-30" };
        Assert.Equal("Your self-assessment is due Fri 30 Oct", Catalog.Text("en", "Reminder.selfAssessment.due", due));
        Assert.Contains("30 oct.", Catalog.Text("fr", "Reminder.selfAssessment.due", due));
        // Gregorian in Arabic too: the 30th of October, not a Hijri date.
        Assert.Contains("30", Catalog.Text("ar", "Reminder.selfAssessment.due", due));
        Assert.Contains("أكتوبر", Catalog.Text("ar", "Reminder.selfAssessment.due", due));
    }

    [Fact]
    public void A_missing_language_entry_falls_back_to_English_and_rows_from_before_keep_their_text()
    {
        var catalog = new NotificationCatalog(new Dictionary<string, IReadOnlyDictionary<string, string>>
        {
            ["en"] = new Dictionary<string, string> { ["Hello"] = "Hello {name}" },
            ["fr"] = new Dictionary<string, string>(),
        });
        Assert.Equal("Hello Rim", catalog.Text("fr", "Hello", new Dictionary<string, string> { ["name"] = "Rim" }));
        Assert.Null(catalog.Text("fr", "Missing"));

        var legacy = Notification(PlanSubmitted());
        typeof(PerformanceNotification).GetProperty(nameof(PerformanceNotification.TitleKey))!.SetValue(legacy, null);
        typeof(PerformanceNotification).GetProperty(nameof(PerformanceNotification.Title))!.SetValue(legacy, "Nour submitted their plan");
        typeof(PerformanceNotification).GetProperty(nameof(PerformanceNotification.Context))!.SetValue(legacy, "Ready for your review");
        Assert.Equal(("Nour submitted their plan", "Ready for your review"), PerformanceNotificationRenderer.InApp(legacy, "fr"));
    }

    // ── Request language ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("fr-FR,en;q=0.8", "fr")]
    [InlineData("ar", "ar")]
    [InlineData("de, ar;q=0.5", "ar")]
    [InlineData("de", "en")]
    [InlineData("", "en")]
    public void The_request_reads_in_the_first_language_Fusion_speaks(string header, string expected)
    {
        var context = new DefaultHttpContext();
        if (header.Length > 0) context.Request.Headers.AcceptLanguage = header;
        Assert.Equal(expected, FusionRequestLanguage.Of(context.Request));
    }

    // ── Email ────────────────────────────────────────────────────────────────

    [Fact]
    public void The_email_says_why_it_was_sent_and_reads_right_to_left_in_Arabic()
    {
        var notification = Notification(PlanSubmitted("Nour <b>Trabelsi</b>"));
        var english = notification.EnglishEmail();
        Assert.Equal("Plan ready for your review", english.Subject);
        Assert.Contains("Nour <b>Trabelsi</b> submitted a plan for your review.", english.Text);
        Assert.Contains("Nour &lt;b&gt;Trabelsi&lt;/b&gt;", english.Html);
        Assert.Contains("You get these emails for Plans and goals.", english.Text);
        Assert.Contains("http://localhost:3000/settings/notifications", english.Text);
        Assert.Contains("Sent by Carthage Industries with Fusion", english.Text);
        Assert.DoesNotContain("cid:", english.Html);
        Assert.Contains(FusionEmailLayout.FusionAccent, english.Html);

        var arabic = PerformanceNotificationRenderer.Email(notification, "ar", "http://localhost:3000",
            new NotificationCompany("Carthage", "#2f5fd0", [0x89, 0x50]));
        Assert.Contains("#2f5fd0", arabic.Html);
        Assert.Contains("cid:" + FusionNotificationEmail.LogoContentId, arabic.Html);
        Assert.Contains("dir=\"rtl\"", arabic.Html);
        Assert.Equal("خطة بانتظار مراجعتك", arabic.Subject);
        Assert.Contains("الخطط والأهداف", arabic.Text);
    }

    [Fact]
    public void Optional_groups_carry_a_one_click_unsubscribe_and_deadline_reminders_never_do()
    {
        var options = new FusionSmtpOptions { From = "performance@fusion.local" };
        var plan = PlanSubmitted();
        var url = PerformanceNotificationRenderer.UnsubscribeUrl(plan.Message, "http://localhost:3000", PerformanceApiFactory.UnsubscribeKey);
        Assert.StartsWith("http://localhost:3000/api/performance/notifications/unsubscribe?token=", url);
        using var mail = FusionMailer.Compose(options, new FusionOutgoingEmail("a@b.test", Notification(plan).EnglishEmail(), "<1@x>", url));
        Assert.Equal($"<{url}>", mail.Headers["List-Unsubscribe"]);
        Assert.Equal("List-Unsubscribe=One-Click", mail.Headers["List-Unsubscribe-Post"]);
        Assert.Single(mail.AlternateViews);

        var reminder = PerformanceOutboxMessage.ForReviewWork(Guid.NewGuid(), PerformanceNotificationKind.ReviewReminder, Guid.NewGuid(),
            "PerformanceReview", Guid.NewGuid(), "Reminder:x", new ReviewWorkNotificationPayload(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
                "Year-end", "/performance/reviews/x"));
        Assert.Null(PerformanceNotificationRenderer.UnsubscribeUrl(reminder, "http://localhost:3000", PerformanceApiFactory.UnsubscribeKey));
        Assert.Null(PerformanceNotificationRenderer.UnsubscribeUrl(plan.Message, "http://localhost:3000", null));
    }

    [Fact]
    public void An_unsubscribe_token_only_reads_back_with_its_own_key_and_unchanged()
    {
        var claim = new UnsubscribeClaim(Guid.NewGuid(), Guid.NewGuid(), NotificationGroups.OneOnOnes);
        var token = UnsubscribeToken.Issue(claim, PerformanceApiFactory.UnsubscribeKey);
        Assert.Equal(claim, UnsubscribeToken.Read(token, PerformanceApiFactory.UnsubscribeKey));
        Assert.Null(UnsubscribeToken.Read(token, "another-key-another-key-another-key-0"));
        var forged = UnsubscribeToken.Issue(claim with { Group = NotificationGroups.FeedbackAndPraise }, PerformanceApiFactory.UnsubscribeKey);
        Assert.Null(UnsubscribeToken.Read($"{forged.Split('.')[0]}.{token.Split('.')[1]}", PerformanceApiFactory.UnsubscribeKey));
        Assert.Null(UnsubscribeToken.Read("not-a-token", PerformanceApiFactory.UnsubscribeKey));
        Assert.Null(UnsubscribeToken.Read(null, PerformanceApiFactory.UnsubscribeKey));
    }

    [Fact]
    public async Task The_email_goes_out_in_the_recipients_account_language()
    {
        var store = TestStore.ForNewTenant();
        var core = new FakeCoreWorkforceClient();
        var lina = core.Add("Lina Haddad");
        core.ById[lina.EmployeeId] = lina with { WorkEmail = "lina@carthage.test" };
        var audience = new FakeNotificationAudienceClient();
        audience.Languages[lina.EmployeeId] = "fr";
        var sender = new CapturingNotificationSender();
        var staged = PlanSubmitted(recipient: lina.EmployeeId, tenant: store.TenantId);
        await using var db = store.NewContext();
        db.OutboxMessages.Add(staged.Message);
        db.Notifications.Add(Notification(staged));
        await db.SaveChangesAsync();

        await new PerformanceNotificationDispatcher(db, store.Tenant, core, audience, sender, Options.Create(new PerformanceNotificationOptions
        {
            Enabled = true, ShellBaseUrl = "http://localhost:3000", UnsubscribeKey = PerformanceApiFactory.UnsubscribeKey,
        })).DispatchAsync(staged.Message, DateTime.UtcNow, default);

        var (email, mail) = Assert.Single(sender.Delivered);
        Assert.Equal("lina@carthage.test", email);
        Assert.Equal("Un plan attend votre revue", mail.Content.Subject);
        Assert.Contains("lang=\"fr\"", mail.Content.Html);
        Assert.NotNull(mail.UnsubscribeUrl);
        Assert.Equal($"<{staged.Message.Id:N}@fusion-performance>", mail.MessageId);
    }

    [Fact]
    public async Task An_email_whose_in_app_record_is_gone_is_skipped_not_retried()
    {
        var store = TestStore.ForNewTenant();
        var core = new FakeCoreWorkforceClient();
        var lina = core.Add("Lina Haddad");
        core.ById[lina.EmployeeId] = lina with { WorkEmail = "lina@carthage.test" };
        var sender = new CapturingNotificationSender();
        var staged = PlanSubmitted(recipient: lina.EmployeeId, tenant: store.TenantId);
        await using var db = store.NewContext();
        db.OutboxMessages.Add(staged.Message);
        await db.SaveChangesAsync();

        await new PerformanceNotificationDispatcher(db, store.Tenant, core, new FakeNotificationAudienceClient(), sender,
            Options.Create(new PerformanceNotificationOptions { Enabled = true, ShellBaseUrl = "http://localhost:3000" }))
            .DispatchAsync(staged.Message, DateTime.UtcNow, default);

        Assert.Equal(PerformanceNotificationDispatcher.NoNotification, staged.Message.SkippedReason);
        Assert.Empty(sender.Delivered);
    }

    // ── Feed language and unsubscribe over HTTP ───────────────────────────────

    [Fact]
    public async Task The_same_notification_reads_in_whichever_language_the_caller_uses_now()
    {
        await using var factory = new PerformanceApiFactory();
        var lina = Guid.NewGuid();
        await SeedAsync(factory, PlanSubmitted(recipient: lina, tenant: factory.Store.TenantId));
        var client = factory.CreateAuthenticatedClient(employeeId: lina, permissions: SelfGrant);

        async Task<JsonElement> First(string language)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/performance/notifications");
            request.Headers.AcceptLanguage.ParseAdd(language);
            var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("items")[0];
        }

        Assert.Equal("Nour Trabelsi submitted their plan", (await First("en")).GetProperty("title").GetString());
        var french = await First("fr-FR");
        Assert.Equal("Nour Trabelsi a soumis son plan", french.GetProperty("title").GetString());
        Assert.Equal("Prêt pour votre revue", french.GetProperty("context").GetString());
        Assert.Equal("قدّم Nour Trabelsi خطته", (await First("ar")).GetProperty("title").GetString());
    }

    [Fact]
    public async Task One_click_unsubscribe_turns_off_only_its_group_for_its_person_without_signing_in()
    {
        await using var factory = new PerformanceApiFactory();
        var nour = Guid.NewGuid();
        var token = UnsubscribeToken.Issue(new UnsubscribeClaim(factory.Store.TenantId, nour, NotificationGroups.FeedbackAndPraise),
            PerformanceApiFactory.UnsubscribeKey);
        using var anonymous = factory.CreateClient();
        var url = $"/api/performance/notifications/unsubscribe?token={Uri.EscapeDataString(token)}";

        Assert.False((await anonymous.GetAsync(url)).IsSuccessStatusCode);
        await using (var db = factory.Store.NewContext()) Assert.Empty(await db.NotificationPreferences.ToListAsync());
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsync(url,
            new FormUrlEncodedContent([new("List-Unsubscribe", "One-Click")]))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsync(url, null)).StatusCode);

        await using (var db = factory.Store.NewContext())
        {
            var preference = await db.NotificationPreferences.SingleAsync();
            Assert.Equal(nour, preference.RecipientEmployeeId);
            Assert.Equal([NotificationGroups.FeedbackAndPraise], preference.EmailOff);
        }
    }

    [Fact]
    public async Task An_unsubscribe_link_that_is_forged_locked_or_for_another_tenant_changes_nothing()
    {
        await using var factory = new PerformanceApiFactory();
        var nour = Guid.NewGuid();
        using var anonymous = factory.CreateClient();
        async Task<HttpStatusCode> Post(string token, Guid? tenantHeader = null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"/api/performance/notifications/unsubscribe?token={Uri.EscapeDataString(token)}");
            if (tenantHeader is Guid header) request.Headers.Add("X-Tenant-Id", header.ToString());
            return (await anonymous.SendAsync(request)).StatusCode;
        }

        var locked = UnsubscribeToken.Issue(new UnsubscribeClaim(factory.Store.TenantId, nour, NotificationGroups.DeadlineReminders),
            PerformanceApiFactory.UnsubscribeKey);
        var wrongKey = UnsubscribeToken.Issue(new UnsubscribeClaim(factory.Store.TenantId, nour, NotificationGroups.OneOnOnes),
            "someone-elses-key-someone-elses-key-00");
        var otherTenant = UnsubscribeToken.Issue(new UnsubscribeClaim(Guid.NewGuid(), nour, NotificationGroups.OneOnOnes),
            PerformanceApiFactory.UnsubscribeKey);
        Assert.Equal(HttpStatusCode.BadRequest, await Post(locked));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(wrongKey));
        Assert.Equal(HttpStatusCode.BadRequest, await Post("garbage"));
        Assert.Equal(HttpStatusCode.BadRequest, await Post(otherTenant, tenantHeader: factory.Store.TenantId));

        await using var db = factory.Store.NewContext();
        Assert.Empty(await db.NotificationPreferences.ToListAsync());
    }

    // ── Reminders ────────────────────────────────────────────────────────────

    [Fact]
    public void Reminders_go_out_from_nine_company_time_on_workdays_and_Friday_covers_the_weekend()
    {
        // Monday 2 Nov 2026; Tunis is UTC+1.
        Assert.Null(ReminderClock.SendDay(new DateTime(2026, 11, 2, 7, 59, 0, DateTimeKind.Utc), "Africa/Tunis"));
        Assert.Equal(new DateOnly(2026, 11, 2), ReminderClock.SendDay(new DateTime(2026, 11, 2, 8, 0, 0, DateTimeKind.Utc), "Africa/Tunis"));
        Assert.Null(ReminderClock.SendDay(new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc), "Africa/Tunis"));
        Assert.Equal(new DateOnly(2026, 11, 2), ReminderClock.SendDay(new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc), "Not/AZone"));
        Assert.Equal([new DateOnly(2026, 10, 30), new DateOnly(2026, 10, 31), new DateOnly(2026, 11, 1)],
            ReminderClock.CoveredDays(new DateOnly(2026, 10, 30)));
        Assert.Equal([new DateOnly(2026, 11, 2)], ReminderClock.CoveredDays(new DateOnly(2026, 11, 2)));
    }

    // ── Live nudge ───────────────────────────────────────────────────────────

    [Fact]
    public void A_nudge_reaches_only_the_same_person_in_the_same_tenant()
    {
        var hub = new FeedNudgeHub();
        var tenant = Guid.NewGuid(); var nour = Guid.NewGuid();
        using var mine = hub.Subscribe(new FeedRecipient(tenant, nour, Guid.NewGuid()))!;
        hub.Publish(new FeedRecipient(Guid.NewGuid(), nour, null));
        hub.Publish(new FeedRecipient(tenant, Guid.NewGuid(), null));
        Assert.False(mine.Changes.TryRead(out _));
        hub.Publish(new FeedRecipient(tenant, nour, null));
        Assert.True(mine.Changes.TryRead(out _));
        Assert.Equal(new FeedRecipient(tenant, nour, null), FeedRecipient.FromPayload(new FeedRecipient(tenant, nour, null).ToPayload()));
        Assert.Null(FeedRecipient.FromPayload("junk"));
    }

    [Fact]
    public void A_person_holds_a_bounded_number_of_streams()
    {
        var hub = new FeedNudgeHub();
        var recipient = new FeedRecipient(Guid.NewGuid(), Guid.NewGuid(), null);
        var open = Enumerable.Range(0, FeedNudgeHub.MaxStreamsPerRecipient).Select(_ => hub.Subscribe(recipient)).ToList();
        Assert.All(open, Assert.NotNull);
        Assert.Null(hub.Subscribe(recipient));
        open[0]!.Dispose();
        Assert.NotNull(hub.Subscribe(recipient));
    }

    [Fact]
    public async Task The_stream_says_ready_then_changed_for_the_caller_only()
    {
        await using var factory = new PerformanceApiFactory();
        var lina = Guid.NewGuid();
        var client = factory.CreateAuthenticatedClient(employeeId: lina, permissions: SelfGrant);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var response = await client.GetAsync("/api/performance/notifications/stream", HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(timeout.Token));
        async Task<string> NextEvent()
        {
            while (await reader.ReadLineAsync(timeout.Token) is { } line)
                if (line.StartsWith("event: ", StringComparison.Ordinal)) return line["event: ".Length..];
            return "";
        }

        Assert.Equal("ready", await NextEvent());
        var hub = factory.Services.GetRequiredService<FeedNudgeHub>();
        hub.Publish(new FeedRecipient(factory.Store.TenantId, Guid.NewGuid(), null));
        hub.Publish(new FeedRecipient(factory.Store.TenantId, lina, null));
        Assert.Equal("changed", await NextEvent());
    }

    [Fact]
    public async Task The_stream_needs_a_signed_in_caller()
    {
        await using var factory = new PerformanceApiFactory();
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/performance/notifications/stream")).StatusCode);
    }

    /// <summary>The signal leaves PostgreSQL on commit only: a rolled-back notification never nudges anyone.</summary>
    [RelationalDatabaseFact]
    public async Task A_saved_notification_nudges_on_commit_and_a_rolled_back_one_never_does()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        try
        {
            await RelationalTests.CreateDatabaseAsync(baseConnection, name);
            await using (var migrate = RelationalTests.CreateDb(connection, tenant)) await migrate.Database.MigrateAsync();
            var received = new List<string>();
            await using var listener = new NpgsqlConnection(connection);
            await listener.OpenAsync();
            listener.Notification += (_, e) => { lock (received) received.Add(e.Payload); };
            await using (var listen = new NpgsqlCommand($"LISTEN {PerformanceFeed.Channel}", listener)) await listen.ExecuteNonQueryAsync();
            var interceptor = new FeedNudgeInterceptor(new FeedNudgeOptions(PerformanceFeed.Channel, connection));

            var rolledBack = PlanSubmitted(tenant: tenant);
            await using (var db = RelationalTests.CreateDb(connection, tenant, interceptor))
            {
                await using var transaction = await db.Database.BeginTransactionAsync();
                db.Notifications.Add(Notification(rolledBack));
                await db.SaveChangesAsync();
                await transaction.RollbackAsync();
            }
            var committed = PlanSubmitted(tenant: tenant);
            await using (var db = RelationalTests.CreateDb(connection, tenant, interceptor))
            {
                await using var transaction = await db.Database.BeginTransactionAsync();
                db.Notifications.Add(Notification(committed));
                await db.SaveChangesAsync();
                await Task.Delay(300);
                await listener.WaitAsync(TimeSpan.FromMilliseconds(200));
                lock (received) Assert.Empty(received);
                await transaction.CommitAsync();
            }
            await listener.WaitAsync(TimeSpan.FromSeconds(5));
            lock (received)
                Assert.Equal([new FeedRecipient(tenant, committed.Message.RecipientEmployeeId, null).ToPayload()], received);
        }
        finally { await RelationalTests.DropDatabaseAsync(baseConnection, name); }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private sealed record Staged(PerformanceOutboxMessage Message, PerformanceNotificationMessage Text);

    private static Staged PlanSubmitted(string actor = "Nour Trabelsi", Guid? recipient = null, Guid? tenant = null)
    {
        var tenantId = tenant ?? Guid.NewGuid();
        var manager = recipient ?? Guid.NewGuid();
        var plan = EmployeePlan.Create(tenantId, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), actor, null, manager, "Lina Haddad");
        var message = PerformanceOutboxMessage.ForPlan(tenantId, PerformanceNotificationKind.PlanSubmitted, manager, plan.Id, Guid.NewGuid(),
            new PlanNotificationPayload(plan.CycleId, plan.Id, actor));
        return new Staged(message, PerformanceNotificationTemplates.ForPlan(plan, PerformanceNotificationKind.PlanSubmitted, actor));
    }

    private static PerformanceNotification Notification(Staged staged)
        => PerformanceNotification.For(staged.Message, null, staged.Text, DateTime.UtcNow);

    private static async Task SeedAsync(PerformanceApiFactory factory, Staged staged)
    {
        await using var db = factory.Store.NewContext();
        db.Notifications.Add(Notification(staged));
        await db.SaveChangesAsync();
    }
}
