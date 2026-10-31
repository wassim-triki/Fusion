using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Conversations in the Fusion frame: the colleague directory, work items, navigation destinations, the person summary
/// and the default 1:1 cadence. Karim manages Nour; Amira administers HR and manages Karim; Leila is elsewhere.
/// </summary>
public sealed class ConversationsFrameHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
         new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.SettingsManage, PermissionScopes.Tenant)];

    private sealed record World(PerformanceApiFactory Factory, Guid Amira, Guid Karim, Guid Nour, Guid Leila, Guid Loner, Guid Ownership)
    {
        public HttpClient As(Guid employee, EffectivePermissionGrant[]? grants = null)
            => Factory.CreateAuthenticatedClient(employeeId: employee, permissions: grants ?? Employee);
    }

    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var amira = factory.Core.Add("Amira Khelifi").EmployeeId;
        var karim = factory.Core.Add("Karim Haddad", managerId: amira).EmployeeId;
        var nour = factory.Core.Add("Nour Trabelsi", managerId: karim).EmployeeId;
        var leila = factory.Core.Add("Leila Baccouche", managerId: amira).EmployeeId;
        var loner = factory.Core.Add("Sami Ben Youssef").EmployeeId;
        factory.Core.Add("Rima Gone", isActive: false);
        var ownership = Competency.Create(factory.Store.TenantId, "Ownership", "Owns outcomes", null);
        await using var db = factory.Store.NewContext();
        db.Competencies.Add(ownership);
        await db.SaveChangesAsync();
        return new World(factory, amira, karim, nour, leila, loner, ownership.Id);
    }

    private static async Task<JsonElement> DataAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {body}");
        return JsonDocument.Parse(body).RootElement.GetProperty("data");
    }

    [Fact]
    public async Task The_directory_finds_active_colleagues_with_names_titles_and_teams_only()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var found = (await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/people/directory?search=rim"))).EnumerateArray().ToList();
        var karim = Assert.Single(found);
        Assert.Equal(w.Karim, karim.GetProperty("employeeId").GetGuid());
        Assert.Equal(["displayName", "employeeId", "jobTitle", "orgUnitName"], karim.EnumerateObject().Select(p => p.Name).Order().ToArray());

        var before = w.Factory.Core.SearchCalls;
        Assert.Empty((await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/people/directory?search=r"))).EnumerateArray());
        Assert.Equal(before, w.Factory.Core.SearchCalls);

        var outsider = w.Factory.CreateAuthenticatedClient(employeeId: w.Nour, permissions: []);
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync("/api/performance/people/directory?search=karim")).StatusCode);

        w.Factory.Core.Unavailable = true;
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await w.As(w.Nour).GetAsync("/api/performance/people/directory?search=karim")).StatusCode);
    }

    private static async Task<List<JsonElement>> WorkAsync(World w, Guid who, EffectivePermissionGrant[]? grants = null)
        => (await DataAsync(await w.As(who, grants).GetAsync("/api/performance/work"))).EnumerateArray().ToList();

    [Fact]
    public async Task Feedback_requests_and_due_actions_are_work_until_done_without_any_cycle()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var ask = await DataAsync(await w.As(w.Leila).PostAsJsonAsync("/api/performance/feedback/requests",
            new { id = Guid.NewGuid(), question = "How did the launch go?", inviteeEmployeeIds = new[] { w.Nour, w.Karim }, dueDate = Today.AddDays(5) }));
        var requestId = ask.GetProperty("id").GetGuid();
        var item = Assert.Single(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "feedback-request");
        Assert.Equal("/performance/feedback", item.GetProperty("section").GetString());
        Assert.Equal("Feedback for Leila Baccouche", item.GetProperty("title").GetString());
        Assert.Equal($"/performance/feedback/requests/{requestId}", item.GetProperty("href").GetString());
        Assert.Equal(DateTime.UtcNow, item.GetProperty("waitingSince").GetDateTime().ToUniversalTime(), TimeSpan.FromMinutes(1));

        await DataAsync(await w.As(w.Nour).PostAsJsonAsync($"/api/performance/feedback/requests/{requestId}/answer",
            new { feedbackId = Guid.NewGuid(), message = "Smooth" }));
        Assert.DoesNotContain(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "feedback-request");
        await DataAsync(await w.As(w.Leila).PostAsync($"/api/performance/feedback/requests/{requestId}/close", null));
        Assert.DoesNotContain(await WorkAsync(w, w.Karim, Manager), i => i.GetProperty("kind").GetString() == "feedback-request");

        var series = await DataAsync(await w.As(w.Karim, Manager).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = w.Nour, firstMeetingAt = DateTime.UtcNow.AddHours(2) }));
        var seriesId = series.GetProperty("id").GetGuid();
        var dueSoon = Guid.NewGuid();
        await DataAsync(await w.As(w.Karim, Manager).PostAsJsonAsync($"/api/performance/one-on-ones/{seriesId}/actions",
            new { id = dueSoon, text = "Send the draft", ownerEmployeeId = w.Nour, dueDate = Today.AddDays(1) }));
        await DataAsync(await w.As(w.Karim, Manager).PostAsJsonAsync($"/api/performance/one-on-ones/{seriesId}/actions",
            new { id = Guid.NewGuid(), text = "Later", ownerEmployeeId = w.Nour, dueDate = Today.AddDays(14) }));
        var action = Assert.Single(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "one-on-one-action");
        Assert.Equal("/performance/one-on-ones", action.GetProperty("section").GetString());
        Assert.Equal("Send the draft", action.GetProperty("title").GetString());
        Assert.Equal($"/performance/one-on-ones/{seriesId}", action.GetProperty("href").GetString());

        await DataAsync(await w.As(w.Nour).PutAsJsonAsync($"/api/performance/one-on-ones/{seriesId}/actions/{dueSoon}/done", new { done = true }));
        Assert.DoesNotContain(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "one-on-one-action");

        await DataAsync(await w.As(w.Nour).PutAsJsonAsync($"/api/performance/one-on-ones/{seriesId}/actions/{dueSoon}/done", new { done = false }));
        Assert.Contains(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "one-on-one-action");
        await using (var db = w.Factory.Store.NewContext())
        {
            var tracked = await db.OneOnOneSeries.SingleAsync(s => s.Id == seriesId);
            tracked.End(OneOnOneEndReason.ReportingLineEnded, DateTime.UtcNow);
            await db.SaveChangesAsync();
        }
        Assert.DoesNotContain(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "one-on-one-action");
    }

    [Fact]
    public async Task A_1on1_whose_day_passed_stays_next_and_is_owed_by_both_until_completed()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var series = await DataAsync(await w.As(w.Karim, Manager).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = w.Nour, firstMeetingAt = DateTime.UtcNow.AddHours(2) }));
        var seriesId = series.GetProperty("id").GetGuid();
        var missedAt = DateTime.UtcNow.AddDays(-2);
        await using (var db = w.Factory.Store.NewContext())
        {
            var meeting = await db.OneOnOneMeetings.SingleAsync(m => m.SeriesId == seriesId);
            db.Entry(meeting).Property(m => m.ScheduledAt).CurrentValue = missedAt;
            await db.SaveChangesAsync();
        }

        foreach (var (who, grants) in new[] { (w.Nour, (EffectivePermissionGrant[]?)null), (w.Karim, Manager) })
        {
            var owed = Assert.Single(await WorkAsync(w, who, grants), i => i.GetProperty("kind").GetString() == "one-on-one-meeting");
            Assert.Equal(DateOnly.FromDateTime(missedAt), DateOnly.Parse(owed.GetProperty("dueOn").GetString()!));
            Assert.Equal($"/performance/one-on-ones/{seriesId}", owed.GetProperty("href").GetString());
            Assert.Equal("/performance/one-on-ones", owed.GetProperty("section").GetString());
            Assert.Equal("Open the 1:1", owed.GetProperty("actionLabel").GetString());
        }
        Assert.Equal("1:1 with Karim Haddad", Assert.Single(await WorkAsync(w, w.Nour),
            i => i.GetProperty("kind").GetString() == "one-on-one-meeting").GetProperty("title").GetString());

        // Overview keeps it as the next meeting; the home's upcoming moments don't, since it's owed work now.
        var overview = await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/overview"));
        var conversations = Assert.Single(overview.GetProperty("rows").EnumerateArray(), r => r.GetProperty("kind").GetString() == "conversations");
        Assert.Equal(seriesId, Assert.Single(conversations.GetProperty("meetings").EnumerateArray()).GetProperty("seriesId").GetGuid());
        var upcoming = await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/upcoming?days=14"));
        Assert.DoesNotContain(upcoming.EnumerateArray(), m => m.GetProperty("kind").GetString() == "one-on-one");

        var detail = await DataAsync(await w.As(w.Nour).GetAsync($"/api/performance/one-on-ones/{seriesId}"));
        var missed = detail.GetProperty("upcoming");
        await DataAsync(await w.As(w.Nour).PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{missed.GetProperty("id").GetGuid()}/complete",
            new { expectedVersion = missed.GetProperty("version").GetUInt32() }));
        Assert.DoesNotContain(await WorkAsync(w, w.Nour), i => i.GetProperty("kind").GetString() == "one-on-one-meeting");
        Assert.DoesNotContain(await WorkAsync(w, w.Karim, Manager), i => i.GetProperty("kind").GetString() == "one-on-one-meeting");
    }

    private static async Task<JsonElement> DestinationsAsync(World w, Guid who, EffectivePermissionGrant[]? grants = null)
        => (await DataAsync(await w.As(who, grants).GetAsync("/api/performance/context"))).GetProperty("destinations");

    [Fact]
    public async Task One_on_ones_show_for_a_manager_line_and_feedback_for_everyone()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        Assert.True((await DestinationsAsync(w, w.Nour)).GetProperty("oneOnOnes").GetBoolean());
        Assert.True((await DestinationsAsync(w, w.Karim, Manager)).GetProperty("oneOnOnes").GetBoolean());
        var loner = await DestinationsAsync(w, w.Loner);
        Assert.False(loner.GetProperty("oneOnOnes").GetBoolean());
        Assert.True(loner.GetProperty("feedback").GetBoolean());

        await DataAsync(await w.As(w.Nour).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = w.Karim, firstMeetingAt = DateTime.UtcNow.AddHours(2) }));
        w.Factory.Core.Unavailable = true;
        Assert.True((await DestinationsAsync(w, w.Nour)).GetProperty("oneOnOnes").GetBoolean());
        Assert.False((await DestinationsAsync(w, w.Leila)).GetProperty("oneOnOnes").GetBoolean());
    }

    private static async Task<JsonElement> SummaryAsync(World w, Guid viewer, Guid person, EffectivePermissionGrant[]? grants = null)
        => await DataAsync(await w.As(viewer, grants).GetAsync($"/api/performance/people/{person}/summary"));

    [Fact]
    public async Task The_summary_shows_praise_to_everyone_feedback_by_visibility_and_the_1on1_to_the_two_people()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        await DataAsync(await w.As(w.Leila).PostAsJsonAsync("/api/performance/praise",
            new { id = Guid.NewGuid(), recipientEmployeeIds = new[] { w.Nour }, competencyId = w.Ownership, message = "Great cut-over" }));
        await DataAsync(await w.As(w.Leila).PostAsJsonAsync("/api/performance/feedback",
            new { id = Guid.NewGuid(), receiverEmployeeId = w.Nour, visibility = "Shared", message = "SHARED" }));
        await DataAsync(await w.As(w.Leila).PostAsJsonAsync("/api/performance/feedback",
            new { id = Guid.NewGuid(), receiverEmployeeId = w.Nour, visibility = "ManagerOnly", message = "MANAGER-ONLY" }));
        await DataAsync(await w.As(w.Karim, Manager).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = w.Nour, firstMeetingAt = DateTime.UtcNow.AddHours(2) }));

        var colleague = await SummaryAsync(w, w.Loner, w.Nour);
        Assert.Equal(1, colleague.GetProperty("praise").GetProperty("total").GetInt32());
        Assert.Equal(JsonValueKind.Null, colleague.GetProperty("feedback").ValueKind);
        Assert.Equal(JsonValueKind.Null, colleague.GetProperty("oneOnOne").ValueKind);
        Assert.Equal(JsonValueKind.Null, colleague.GetProperty("currentCycle").ValueKind);

        var self = await SummaryAsync(w, w.Nour, w.Nour);
        Assert.Equal(1, self.GetProperty("feedback").GetProperty("total").GetInt32());
        Assert.DoesNotContain("MANAGER-ONLY", self.GetRawText());

        var manager = await SummaryAsync(w, w.Karim, w.Nour, Manager);
        Assert.Equal(2, manager.GetProperty("feedback").GetProperty("total").GetInt32());
        Assert.NotEqual(JsonValueKind.Null, manager.GetProperty("oneOnOne").ValueKind);

        var hr = await SummaryAsync(w, w.Amira, w.Nour, Admin);
        Assert.Equal(1, hr.GetProperty("feedback").GetProperty("total").GetInt32());
        Assert.DoesNotContain("MANAGER-ONLY", hr.GetRawText());
        Assert.Equal(JsonValueKind.Null, hr.GetProperty("oneOnOne").ValueKind);
    }

    [Fact]
    public async Task The_default_cadence_is_an_audited_admin_setting_new_series_start_with()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var admin = w.As(w.Amira, Admin);
        var settings = await DataAsync(await admin.GetAsync("/api/performance/settings"));
        Assert.Equal("EveryTwoWeeks", settings.GetProperty("defaultOneOnOneCadence").GetString());

        var body = new
        {
            defaultMeasurementMethod = settings.GetProperty("defaultMeasurementMethod").GetString(),
            suggestedObjectiveCountMin = settings.GetProperty("suggestedObjectiveCountMin").GetInt32(),
            suggestedObjectiveCountMax = settings.GetProperty("suggestedObjectiveCountMax").GetInt32(),
            planningDeadlineOffsetDays = settings.GetProperty("planningDeadlineOffsetDays").GetInt32(),
            planAlignmentPolicy = settings.GetProperty("planAlignmentPolicy").GetString(),
            evidenceRetentionMonths = settings.GetProperty("evidenceRetentionMonths").GetInt32(),
            defaultOneOnOneCadence = "Weekly",
            expectedVersion = settings.GetProperty("version").GetUInt32(),
        };
        Assert.Equal(HttpStatusCode.Forbidden, (await w.As(w.Karim, Manager).PutAsJsonAsync("/api/performance/settings", body)).StatusCode);
        Assert.Equal("Weekly", (await DataAsync(await admin.PutAsJsonAsync("/api/performance/settings", body)))
            .GetProperty("defaultOneOnOneCadence").GetString());

        var series = await DataAsync(await w.As(w.Nour).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = w.Karim, firstMeetingAt = DateTime.UtcNow.AddHours(2) }));
        Assert.Equal("Weekly", series.GetProperty("cadence").GetString());
        await using var db = w.Factory.Store.NewContext();
        Assert.Contains(await db.AuditEntries.Where(e => e.Action == "Settings.Changed").ToListAsync(), e => e.Summary.Contains("DefaultOneOnOneCadence"));
    }
}
