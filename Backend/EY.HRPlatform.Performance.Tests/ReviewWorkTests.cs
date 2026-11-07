using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using static EY.HRPlatform.Performance.Tests.TestHelpers.ReviewWorld;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>The Reviews landing per viewer, review work items, and the reminder scan (D6, D11, D13).</summary>
public sealed class ReviewWorkTests
{
    private static uint Version(ReviewWorld world, Guid reviewId)
    {
        using var db = world.Factory.Store.NewContext();
        return db.PerformanceReviews.Single(r => r.Id == reviewId).Version;
    }

    private static async Task<(ReviewWorld World, JsonElement Round, Guid Aicha)> WithPeersAsync()
    {
        var world = await CreateAsync();
        var round = await world.CreateRoundAsync();
        await world.LaunchAsync(round);
        var aicha = world.ReviewOf(round, world.Aicha);
        await Data(await world.As(world.Aicha).PutAsJsonAsync($"/api/performance/reviews/{aicha}/peers",
            new { expectedVersion = Version(world, aicha), employeeIds = new[] { world.Leila.EmployeeId, world.Khaled.EmployeeId } }));
        return (world, round, aicha);
    }

    private static async Task<IReadOnlyList<JsonElement>> WorkAsync(HttpClient client)
        => (await Data(await client.GetAsync("/api/performance/work"))).EnumerateArray().ToList();

    [Fact]
    public async Task The_landing_is_composed_per_viewer()
    {
        var (world, round, aicha) = await WithPeersAsync();
        await using var _ = world;

        var employee = await Data(await world.As(world.Aicha).GetAsync("/api/performance/reviews/workspace"));
        Assert.Equal(aicha, employee.GetProperty("own").GetProperty("reviewId").GetGuid());
        Assert.Equal(2, employee.GetProperty("own").GetProperty("peers").GetProperty("asked").GetArrayLength());
        Assert.Equal(2, employee.GetProperty("own").GetProperty("sections").GetProperty("questions").GetInt32());
        Assert.Empty(employee.GetProperty("toWrite").EnumerateArray());
        Assert.Empty(employee.GetProperty("rounds").EnumerateArray());
        Assert.NotEqual(JsonValueKind.Null, employee.GetProperty("year").ValueKind);

        var manager = await Data(await world.As(world.Mariam).GetAsync("/api/performance/reviews/workspace"));
        var rows = manager.GetProperty("toWrite").EnumerateArray().ToList();
        Assert.Equal(3, rows.Count);
        Assert.Equal("ApprovePeers", rows[0].GetProperty("nextAction").GetString());
        Assert.Equal("Aicha Ben Ali", rows[0].GetProperty("subjectDisplayName").GetString());
        Assert.Equal("ToNominate", rows.Single(r => r.GetProperty("subjectDisplayName").GetString() == "Fares Jaziri").GetProperty("peerStep").GetString());
        Assert.Equal(aicha, Assert.Single(manager.GetProperty("peerLists").EnumerateArray()).GetProperty("reviewId").GetGuid());
        Assert.Equal("Amira Khelifi", manager.GetProperty("own").GetProperty("reviewerName").GetString());

        var hr = await Data(await world.Admin.GetAsync("/api/performance/reviews/workspace"));
        var running = Assert.Single(hr.GetProperty("rounds").EnumerateArray());
        Assert.Equal("Active", running.GetProperty("state").GetString());
        Assert.Equal(1, running.GetProperty("listsToApprove").GetInt32());
        Assert.Equal(4, hr.GetProperty("cycleFacts").GetProperty("participants").GetInt32());
        Assert.Single(hr.GetProperty("toWrite").EnumerateArray());

        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{aicha}/peers/approve",
            new { expectedVersion = Version(world, aicha), employeeIds = new[] { world.Leila.EmployeeId, world.Khaled.EmployeeId } }));
        var peer = await Data(await world.As(world.Leila).GetAsync($"/api/performance/reviews/workspace?cycle={world.Cycle.Id}"));
        var asked = Assert.Single(peer.GetProperty("askedOfYou").EnumerateArray());
        Assert.Equal("Aicha Ben Ali", asked.GetProperty("subjectDisplayName").GetString());
        Assert.Equal(Today.AddDays(14).ToString("yyyy-MM-dd"), asked.GetProperty("dueDate").GetString());
        Assert.Equal(JsonValueKind.Null, peer.GetProperty("own").ValueKind);
        var context = await Data(await world.As(world.Leila).GetAsync($"/api/performance/context?cycleId={world.Cycle.Id}"));
        Assert.True(context.GetProperty("destinations").GetProperty("reviews").GetBoolean());

        // Reviews stays in the navigation on a cycle with no round yet: review work in any cycle keeps it (B-069 S-02).
        var later = EY.HRPlatform.Performance.Domain.Cycles.PerformanceCycle.CreateDraft(world.Factory.Store.TenantId, "FY2028",
            world.Cycle.EndDate.AddDays(1), world.Cycle.EndDate.AddYears(1), world.Cycle.EndDate.AddDays(31)).Activated();
        await using (var db = world.Factory.Store.NewContext())
        {
            db.Cycles.Add(later);
            await db.SaveChangesAsync();
        }
        foreach (var who in new[] { world.Leila, world.Mariam })
        {
            var elsewhere = await Data(await world.As(who).GetAsync($"/api/performance/context?cycleId={later.Id}"));
            Assert.True(elsewhere.GetProperty("destinations").GetProperty("reviews").GetBoolean());
            Assert.False(elsewhere.GetProperty("capabilities").GetProperty("hasReviewWork").GetBoolean());
        }
    }

    [Fact]
    public async Task Work_items_follow_peer_input_due_date_moves_and_release()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync();
        await world.LaunchAsync(round);
        var aicha = world.ReviewOf(round, world.Aicha);

        Assert.Contains(await WorkAsync(world.As(world.Aicha)), i => i.GetProperty("kind").GetString() == "nominate-peers"
            && i.GetProperty("section").GetString() == "/performance/reviews");
        await Data(await world.As(world.Aicha).PutAsJsonAsync($"/api/performance/reviews/{aicha}/peers",
            new { expectedVersion = Version(world, aicha), employeeIds = new[] { world.Leila.EmployeeId } }));
        Assert.DoesNotContain(await WorkAsync(world.As(world.Aicha)), i => i.GetProperty("kind").GetString() == "nominate-peers");
        var approve = Assert.Single(await WorkAsync(world.As(world.Mariam)), i => i.GetProperty("kind").GetString() == "approve-peer-list");
        Assert.Equal("/performance/reviews", approve.GetProperty("section").GetString());
        Assert.Equal("Review Aicha Ben Ali's peer list", approve.GetProperty("title").GetString());
        Assert.Equal(DateTime.UtcNow, approve.GetProperty("waitingSince").GetDateTime().ToUniversalTime(), TimeSpan.FromMinutes(1));

        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{aicha}/peers/approve",
            new { expectedVersion = Version(world, aicha), employeeIds = new[] { world.Leila.EmployeeId } }));
        var input = Assert.Single(await WorkAsync(world.As(world.Leila)), i => i.GetProperty("kind").GetString() == "peer-input");
        Assert.Equal("/performance/reviews", input.GetProperty("section").GetString());
        Assert.Equal("Peer input for Aicha Ben Ali", input.GetProperty("title").GetString());
        Assert.Equal(Today.AddDays(14).ToString("yyyy-MM-dd"), input.GetProperty("dueOn").GetString());
        Assert.StartsWith("/performance/reviews/peer-requests/", input.GetProperty("href").GetString());
        Assert.Equal(DateTime.UtcNow, input.GetProperty("waitingSince").GetDateTime().ToUniversalTime(), TimeSpan.FromMinutes(1));

        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{aicha}/due-date",
            new { expectedVersion = Version(world, aicha), dueDate = Today.AddDays(18), reason = "Back from leave" }));
        var self = Assert.Single(await WorkAsync(world.As(world.Aicha)), i => i.GetProperty("kind").GetString() == "self-assessment");
        Assert.Equal(Today.AddDays(18).ToString("yyyy-MM-dd"), self.GetProperty("dueOn").GetString());

        // Two days late: still open, and it says so.
        await using (var db = world.Factory.Store.NewContext())
        {
            var review = db.PerformanceReviews.Single(r => r.Id == aicha);
            db.Entry(review).Property(r => r.CurrentStageDueDate).CurrentValue = Today.AddDays(-2);
            await db.SaveChangesAsync();
        }
        self = Assert.Single(await WorkAsync(world.As(world.Aicha)), i => i.GetProperty("kind").GetString() == "self-assessment");
        Assert.EndsWith("2 days late", self.GetProperty("context").GetString());
    }

    [Fact]
    public async Task Acknowledging_is_a_work_item_until_done()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false, questions: false, potential: false);
        await world.UpdateRoundAsync(round, self: false);
        await world.LaunchAsync(await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{round.GetProperty("id").GetGuid()}")));
        var aicha = world.ReviewOf(round, world.Aicha);
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{aicha}/manager-assessment",
            new { expectedVersion = Version(world, aicha), summary = "A strong year.", overallRating = 4 }));
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{aicha}/finalize", new { expectedVersion = Version(world, aicha) }));
        Assert.Contains(await WorkAsync(world.As(world.Aicha)), i => i.GetProperty("kind").GetString() == "acknowledge-result"
            && i.GetProperty("section").GetString() == "/performance/reviews");
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{aicha}/acknowledge", new { comment = (string?)null }));
        Assert.DoesNotContain(await WorkAsync(world.As(world.Aicha)), i => i.GetProperty("kind").GetString() == "acknowledge-result");
    }

    private static async Task<int> ScanAsync(ReviewWorld world, DateOnly day)
    {
        await using var db = world.Factory.Store.NewContext();
        return await ReviewReminderScanner.ScanTenantAsync(db, new PerformanceNotifications(db), day, default);
    }

    [Fact]
    public async Task Reminders_follow_the_schedule_once_a_day_and_stop_when_the_work_is_done_or_closed()
    {
        var (world, round, aicha) = await WithPeersAsync();
        await using var _ = world;
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{aicha}/peers/approve",
            new { expectedVersion = Version(world, aicha), employeeIds = new[] { world.Leila.EmployeeId, world.Khaled.EmployeeId } }));
        var due = Today.AddDays(14);
        // Close Fares's review: no reminders for it.
        var fares = world.ReviewOf(round, world.Fares);
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{fares}/close", new { expectedVersion = Version(world, fares), reason = "Left" }));

        // Three days before: self-assessments of Aicha, Tarek and Mariam, and the two peer requests.
        Assert.Equal(5, await ScanAsync(world, due.AddDays(-3)));
        Assert.Equal(0, await ScanAsync(world, due.AddDays(-3)));
        Assert.Equal(0, await ScanAsync(world, due.AddDays(-2)));

        // Aicha submits; the day after the due date the rest are reminded as late.
        var review = await Data(await world.As(world.Aicha).GetAsync($"/api/performance/reviews/{aicha}"));
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{aicha}/self-assessment", new
        {
            expectedVersion = review.GetProperty("version").GetUInt32(), summary = "Done", overallRating = 4,
            answers = review.GetProperty("questions").EnumerateArray().Where(q => q.GetProperty("audience").GetString() == "Person")
                .Select(q => new { questionId = q.GetProperty("questionId").GetGuid(), text = "An answer" }).ToArray(),
        }));
        Assert.Equal(4, await ScanAsync(world, due.AddDays(1)));
        // A week later: still the two late self-assessments and two peers, plus Mariam's assessment of Aicha, a day late.
        Assert.Equal(5, await ScanAsync(world, due.AddDays(8)));
        Assert.Equal(0, await ScanAsync(world, due.AddDays(9)));

        await using var db = world.Factory.Store.NewContext();
        var reminders = db.Notifications.Where(n => n.Kind == PerformanceNotificationKind.ReviewReminder).ToList();
        Assert.Equal(14, reminders.Count);
        Assert.DoesNotContain(reminders, n => n.ResourceId == fares);
        Assert.Equal(2, reminders.Count(n => n.ResourceId == aicha));
        Assert.Single(reminders, n => n.RecipientEmployeeId == world.Mariam.EmployeeId && n.EnglishTitle() == "Your review of Aicha Ben Ali is a day late");
        Assert.Single(reminders, n => n.RecipientEmployeeId == world.Tarek.EmployeeId && n.EnglishTitle() == "Your self-assessment is a day late");
        Assert.Single(reminders, n => n.RecipientEmployeeId == world.Tarek.EmployeeId && n.EnglishTitle() == "Your self-assessment is 8 days late");
        Assert.Contains(db.OutboxMessages.ToList(), m => m.DedupeKey == $"Reminder:SelfAssessment:{aicha:N}:{due.AddDays(-3):yyyy-MM-dd}");
    }

    [Fact]
    public async Task An_unacknowledged_result_is_reminded_on_its_day_then_weekly()
    {
        var world = await CreateAsync();
        await using var _ = world;
        var round = await world.CreateRoundAsync(peers: false, questions: false, potential: false);
        await world.UpdateRoundAsync(round, self: false);
        await world.LaunchAsync(await Data(await world.Admin.GetAsync($"/api/performance/review-rounds/{round.GetProperty("id").GetGuid()}")));
        var aicha = world.ReviewOf(round, world.Aicha);
        await Data(await world.As(world.Mariam).PostAsJsonAsync($"/api/performance/reviews/{aicha}/manager-assessment",
            new { expectedVersion = Version(world, aicha), summary = "A strong year.", overallRating = 4 }));
        await Data(await world.Admin.PostAsJsonAsync($"/api/performance/reviews/{aicha}/finalize", new { expectedVersion = Version(world, aicha) }));
        var reminded = async (int days) =>
        {
            await ScanAsync(world, Today.AddDays(days));
            await using var db = world.Factory.Store.NewContext();
            return db.Notifications.Count(n => n.Kind == PerformanceNotificationKind.ReviewReminder && n.ResourceId == aicha);
        };
        // A reminder goes out on its day, or on the Friday before when its day falls at a weekend (the Friday send covers
        // the weekend), so the days are counted from the release rather than assumed to be weekdays.
        static int SentOn(int day) => Today.AddDays(day).DayOfWeek switch
        {
            DayOfWeek.Saturday => day - 1,
            DayOfWeek.Sunday => day - 2,
            _ => day,
        };
        Assert.Equal(0, await reminded(SentOn(7) - 1));
        Assert.Equal(1, await reminded(SentOn(7)));
        Assert.Equal(1, await reminded(10));
        Assert.Equal(2, await reminded(SentOn(14)));
        await Data(await world.As(world.Aicha).PostAsJsonAsync($"/api/performance/reviews/{aicha}/acknowledge", new { comment = (string?)null }));
        Assert.Equal(2, await reminded(SentOn(21)));
    }

    [MailpitFact]
    public async Task A_reminder_email_is_delivered_with_the_task_and_a_link_only()
    {
        var mailpitUrl = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_MAILPIT_TEST_URL")!;
        using var mailpit = new HttpClient { BaseAddress = new Uri(mailpitUrl), Timeout = TimeSpan.FromSeconds(10) };
        var world = await CreateAsync();
        await using var _ = world;
        var marker = Guid.NewGuid().ToString("N");
        var email = $"reminder-qa-{marker}@performance.test";
        world.Factory.Core.ById[world.Aicha.EmployeeId] = world.Aicha with { WorkEmail = email };
        var round = await world.CreateRoundAsync();
        await world.LaunchAsync(round);
        var aicha = world.ReviewOf(round, world.Aicha);
        Assert.True(await ScanAsync(world, Today.AddDays(15)) > 0);
        List<string> ids = [];
        try
        {
            var options = Options.Create(new PerformanceNotificationOptions
            {
                Enabled = true, ShellBaseUrl = "http://localhost:3000",
                Smtp = new() { Host = "localhost", Port = 1025, From = "performance@fusion.local", UseSsl = false },
            });
            await using (var db = world.Factory.Store.NewContext())
            {
                var message = await db.OutboxMessages.SingleAsync(m => m.Kind == PerformanceNotificationKind.ReviewReminder && m.RecipientEmployeeId == world.Aicha.EmployeeId);
                await new PerformanceNotificationDispatcher(db, world.Factory.Store.Tenant, world.Factory.Core, world.Factory.Audience,
                    new SmtpPerformanceNotificationSender(options), options).DispatchAsync(message, DateTime.UtcNow, default);
                Assert.NotNull(message.DispatchedAt);
            }
            for (var attempt = 0; attempt < 10 && ids.Count == 0; attempt++)
            {
                var found = await mailpit.GetFromJsonAsync<JsonElement>($"/api/v1/search?query={Uri.EscapeDataString(email)}");
                ids = found.GetProperty("messages").EnumerateArray().Select(m => m.GetProperty("ID").GetString()!).ToList();
                if (ids.Count == 0) await Task.Delay(200);
            }
            var delivered = await mailpit.GetFromJsonAsync<JsonElement>($"/api/v1/message/{Assert.Single(ids)}");
            Assert.Equal("Your self-assessment is a day late", delivered.GetProperty("Subject").GetString());
            Assert.Contains($"http://localhost:3000/performance/reviews/{aicha}", delivered.GetProperty("Text").GetString());
        }
        finally
        {
            if (ids.Count > 0)
            {
                using var request = new HttpRequestMessage(HttpMethod.Delete, "/api/v1/messages") { Content = JsonContent.Create(new { IDs = ids }) };
                (await mailpit.SendAsync(request)).EnsureSuccessStatusCode();
            }
        }
    }
}
