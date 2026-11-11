using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.OneOnOnes;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// performance-one-on-ones over HTTP: Karim manages Nour and Sami; Amira administers HR and manages Karim. Only the two
/// people in a series ever see it.
/// </summary>
public sealed class OneOnOneHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
         new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];

    private sealed record World(PerformanceApiFactory Factory, Guid Amira, Guid Karim, Guid Nour, Guid Sami, Guid Leila)
    {
        public HttpClient As(Guid employee, EffectivePermissionGrant[]? grants = null)
            => Factory.CreateAuthenticatedClient(employeeId: employee, permissions: grants ?? Employee);
    }

    private static World Arrange()
    {
        var factory = new PerformanceApiFactory();
        var amira = factory.Core.Add("Amira Khelifi").EmployeeId;
        var karim = factory.Core.Add("Karim Haddad", managerId: amira).EmployeeId;
        var nour = factory.Core.Add("Nour Trabelsi", managerId: karim).EmployeeId;
        var sami = factory.Core.Add("Sami Kefi", managerId: karim).EmployeeId;
        var leila = factory.Core.Add("Leila Baccouche", managerId: amira).EmployeeId;
        return new World(factory, amira, karim, nour, sami, leila);
    }

    /// <summary>Moves someone to another manager in Core HR.</summary>
    private static void Reassign(World w, Guid employee, Guid newManager)
    {
        var current = w.Factory.Core.ById[employee];
        var manager = w.Factory.Core.ById[newManager];
        w.Factory.Core.ById[employee] = current with { Manager = new WorkforceManagerSnapshot(manager.EmployeeId, manager.DisplayName, true) };
    }

    private static async Task<JsonElement> DataAsync(HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode}: {body}");
        var json = JsonDocument.Parse(body).RootElement;
        // Successes return their data; failures return the envelope, whose details carry the code and any extra.
        return expected == HttpStatusCode.OK ? json.GetProperty("data") : json;
    }

    private static string? Code(JsonElement failure) => failure.GetProperty("details").GetProperty("code").GetString();

    private static async Task<JsonElement> StartAsync(World w, Guid caller, Guid with, EffectivePermissionGrant[] grants,
        HttpStatusCode expected = HttpStatusCode.OK, string? cadence = null)
        => await DataAsync(await w.As(caller, grants).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = with, cadence, firstMeetingAt = DateTime.UtcNow.AddHours(3) }), expected);

    private static JsonElement Upcoming(JsonElement series) => series.GetProperty("upcoming");
    private static Guid Id(JsonElement element) => element.GetProperty("id").GetGuid();

    /// <summary>The meeting is over: the reconciler completes it, as it does on its own, and the series is read back.</summary>
    private static async Task<JsonElement> CompleteAsync(World w, JsonElement series, HttpClient reader)
    {
        await using (var db = w.Factory.Store.NewContext())
        {
            var meetingId = Id(Upcoming(series));
            var at = (await db.OneOnOneMeetings.SingleAsync(m => m.Id == meetingId)).ScheduledAt;
            await OneOnOneReconciler.CompleteOverAsync(db, at + OneOnOneSchedule.Length + TimeSpan.FromMinutes(1), CancellationToken.None);
        }
        return await DataAsync(await reader.GetAsync($"/api/performance/one-on-ones/{Id(series)}"));
    }

    private static int Starters => OneOnOneStarters.Keys.Count;

    [Fact]
    public async Task The_report_starts_with_their_manager_who_is_notified_and_both_get_the_invite()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Nour, w.Karim, Employee);
        Assert.Equal("Report", series.GetProperty("viewerRole").GetString());
        Assert.Equal("EveryTwoWeeks", series.GetProperty("cadence").GetString());
        Assert.Equal("Upcoming", Upcoming(series).GetProperty("state").GetString());
        Assert.True(series.GetProperty("first").GetBoolean());
        // A first 1:1 opens on the starter agenda.
        var agenda = Upcoming(series).GetProperty("agenda").EnumerateArray().ToList();
        Assert.Equal(OneOnOneStarters.Keys, agenda.Select(i => i.GetProperty("text").GetString()));
        Assert.All(agenda, i => Assert.Equal("Starter", i.GetProperty("sourceKind").GetString()));

        await using var db = w.Factory.Store.NewContext();
        var notification = Assert.Single(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Karim).ToListAsync());
        Assert.Equal($"/performance/one-on-ones/{Id(series)}", notification.Href);
        Assert.Equal(w.Nour, notification.ActorEmployeeId);
        Assert.Empty(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Nour).ToListAsync());
        var invites = await db.OutboxMessages.Where(m => m.Kind == Domain.Notifications.PerformanceNotificationKind.OneOnOneInvite).ToListAsync();
        Assert.Equal(new[] { w.Karim, w.Nour }.OrderBy(x => x), invites.Select(m => m.RecipientEmployeeId).OrderBy(x => x));
    }

    [Fact]
    public async Task The_manager_starts_with_a_report_but_only_with_the_direct_reports_grant()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var refused = await StartAsync(w, w.Karim, w.Nour, Employee, HttpStatusCode.Forbidden);
        Assert.Equal("OneOnOne.Forbidden", Code(refused));
        var series = await StartAsync(w, w.Karim, w.Nour, Manager, cadence: "Weekly");
        Assert.Equal("Manager", series.GetProperty("viewerRole").GetString());
        Assert.Equal("Weekly", series.GetProperty("cadence").GetString());
    }

    [Fact]
    public async Task Someone_outside_the_reporting_line_and_a_second_active_series_are_refused()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        Assert.Equal("OneOnOne.NotReportingLine", Code(await StartAsync(w, w.Nour, w.Sami, Employee, HttpStatusCode.BadRequest)));
        Assert.Equal("OneOnOne.NotReportingLine", Code(await StartAsync(w, w.Karim, w.Leila, Manager, HttpStatusCode.BadRequest)));

        var first = await StartAsync(w, w.Nour, w.Karim, Employee);
        var duplicate = await StartAsync(w, w.Karim, w.Nour, Manager, HttpStatusCode.Conflict);
        Assert.Equal("OneOnOne.AlreadyActive", Code(duplicate));
        Assert.Contains(Id(first).ToString(), duplicate.GetRawText());
    }

    [Fact]
    public async Task A_meeting_completes_once_when_over_carrying_what_was_not_noted_and_inviting_both_to_the_next()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Karim, w.Nour, Manager, cadence: "Weekly");
        var meeting = Upcoming(series);
        var karim = w.As(w.Karim, Manager);
        var noted = Guid.NewGuid();
        await DataAsync(await karim.PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{Id(meeting)}/agenda",
            new { id = noted, text = "Vendor timeline", note = "Agreed to push to March." }));
        var open = Guid.NewGuid();
        await DataAsync(await karim.PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{Id(meeting)}/agenda",
            new { id = open, text = "Training budget" }));

        var completed = await CompleteAsync(w, series, karim);
        var next = Upcoming(completed);
        Assert.NotEqual(Id(meeting), Id(next));
        Assert.Equal(meeting.GetProperty("scheduledAt").GetDateTime().AddDays(7), next.GetProperty("scheduledAt").GetDateTime());
        var past = Assert.Single(completed.GetProperty("past").EnumerateArray());
        Assert.True(past.GetProperty("agenda").EnumerateArray().Single(i => Id(i) == noted).GetProperty("discussed").GetBoolean());
        // Everything without a note carries over (the starters and the budget); the noted item stays behind.
        var carried = next.GetProperty("agenda").EnumerateArray().ToList();
        Assert.Equal(Starters + 1, carried.Count);
        Assert.Contains(carried, i => i.GetProperty("text").GetString() == "Training budget"
            && i.GetProperty("carriedFromAt").GetDateTime() == meeting.GetProperty("scheduledAt").GetDateTime());
        Assert.DoesNotContain(carried, i => i.GetProperty("text").GetString() == "Vendor timeline");
        Assert.False(completed.GetProperty("first").GetBoolean());

        // Noting the budget after the meeting takes its carried copy off the next agenda.
        var noteOpen = await DataAsync(await karim.PutAsJsonAsync($"/api/performance/one-on-ones/meetings/{Id(meeting)}/agenda/{open}/note",
            new { text = "Approved after all.", expectedRevision = 0u }));
        Assert.DoesNotContain(Upcoming(noteOpen).GetProperty("agenda").EnumerateArray(), i => i.GetProperty("text").GetString() == "Training budget");

        // A second pass finds nothing over; the next meeting's invite went to both.
        await using var db = w.Factory.Store.NewContext();
        Assert.Equal(0, await OneOnOneReconciler.CompleteOverAsync(db, DateTime.UtcNow.AddHours(4), CancellationToken.None));
        Assert.Equal(2, await db.OneOnOneMeetings.CountAsync());
        Assert.Equal(2, await db.OutboxMessages.CountAsync(m => m.Kind == Domain.Notifications.PerformanceNotificationKind.OneOnOneInvite
            && m.ResourceId == Id(next)));
    }

    [Fact]
    public async Task Private_notes_never_reach_the_other_person_and_actions_carry_over()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Karim, w.Nour, Manager);
        var meetingId = Id(Upcoming(series));
        var karim = w.As(w.Karim, Manager);
        var nour = w.As(w.Nour);

        await DataAsync(await karim.PutAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/notes/private",
            new { text = "KARIM-PRIVATE-ASK-ABOUT-WORKLOAD", expectedRevision = 0u }));
        await DataAsync(await nour.PutAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/notes/private",
            new { text = "NOUR-PRIVATE-MENTION-LEAVE", expectedRevision = 0u }));
        var itemId = Id(Upcoming(series).GetProperty("agenda").EnumerateArray().First());
        var noted = await DataAsync(await nour.PutAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda/{itemId}/note",
            new { text = "Agreed the vendor timeline.", expectedRevision = 0u }));
        Assert.True(Upcoming(noted).GetProperty("agenda").EnumerateArray().First().GetProperty("discussed").GetBoolean());
        var conflict = await DataAsync(await karim.PutAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda/{itemId}/note",
            new { text = "Other text", expectedRevision = 0u }), HttpStatusCode.Conflict);
        Assert.Contains("Agreed the vendor timeline.", conflict.GetRawText());

        var asNour = (await nour.GetStringAsync($"/api/performance/one-on-ones/{Id(series)}"));
        var asKarim = (await karim.GetStringAsync($"/api/performance/one-on-ones/{Id(series)}"));
        Assert.DoesNotContain("KARIM-PRIVATE", asNour);
        Assert.Contains("NOUR-PRIVATE", asNour);
        Assert.DoesNotContain("NOUR-PRIVATE", asKarim);
        Assert.Contains("KARIM-PRIVATE", asKarim);

        var actionId = Guid.NewGuid();
        await DataAsync(await karim.PostAsJsonAsync($"/api/performance/one-on-ones/{Id(series)}/actions",
            new { id = actionId, text = "Send the vendor draft", ownerEmployeeId = w.Nour, dueDate = Today.AddDays(2) }));
        var outsider = await karim.PostAsJsonAsync($"/api/performance/one-on-ones/{Id(series)}/actions",
            new { id = Guid.NewGuid(), text = "Someone else", ownerEmployeeId = w.Sami });
        Assert.Equal(HttpStatusCode.BadRequest, outsider.StatusCode);

        var completed = await CompleteAsync(w, series, karim);
        var carried = Assert.Single(Upcoming(completed).GetProperty("actions").EnumerateArray());
        Assert.Equal(actionId, carried.GetProperty("id").GetGuid());
        Assert.True(carried.GetProperty("carriedOver").GetBoolean());

        await using var db = w.Factory.Store.NewContext();
        Assert.Single(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Nour && n.Kind == Domain.Notifications.PerformanceNotificationKind.OneOnOneActionAssigned).ToListAsync());
    }

    [Fact]
    public async Task Agendas_and_open_actions_stop_at_their_caps()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Nour, w.Karim, Employee);
        var meetingId = Id(Upcoming(series));
        var actionsPath = $"/api/performance/one-on-ones/{Id(series)}/actions";
        var nour = w.As(w.Nour);

        for (var i = Starters + 1; i <= OneOnOneMeeting.MaxAgendaItems; i++)
            await DataAsync(await nour.PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda", new { id = Guid.NewGuid(), text = $"Item {i}" }));
        var agendaFull = await DataAsync(await nour.PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda",
            new { id = Guid.NewGuid(), text = "One more" }), HttpStatusCode.BadRequest);
        Assert.Equal("OneOnOne.Invalid", Code(agendaFull));

        var firstAction = Guid.NewGuid();
        for (var i = 1; i <= OneOnOneSeries.MaxOpenActions; i++)
            await DataAsync(await nour.PostAsJsonAsync(actionsPath, new { id = i == 1 ? firstAction : Guid.NewGuid(), text = $"Action {i}", ownerEmployeeId = w.Nour }));
        var actionsFull = await DataAsync(await nour.PostAsJsonAsync(actionsPath,
            new { id = Guid.NewGuid(), text = "One more", ownerEmployeeId = w.Nour }), HttpStatusCode.BadRequest);
        Assert.Equal("OneOnOne.Invalid", Code(actionsFull));

        await DataAsync(await nour.PutAsJsonAsync($"{actionsPath}/{firstAction}/done", new { done = true }));
        await DataAsync(await nour.PostAsJsonAsync(actionsPath, new { id = Guid.NewGuid(), text = "One more", ownerEmployeeId = w.Nour }));
        var reopen = await DataAsync(await nour.PutAsJsonAsync($"{actionsPath}/{firstAction}/done", new { done = false }), HttpStatusCode.BadRequest);
        Assert.Equal("OneOnOne.Invalid", Code(reopen));
    }

    [Fact]
    public async Task Nobody_but_the_two_people_sees_a_series_HR_included()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Karim, w.Nour, Manager);
        var path = $"/api/performance/one-on-ones/{Id(series)}";

        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Amira, Admin).GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Sami).GetAsync(path)).StatusCode);
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Karim, permissions: Manager);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.GetAsync(path)).StatusCode);

        // Amira manages Karim (skip level above Nour) and administers HR: her list holds her own line, not theirs.
        var amiraList = await w.As(w.Amira, Admin).GetStringAsync("/api/performance/one-on-ones");
        Assert.DoesNotContain(Id(series).ToString(), amiraList);
        Assert.DoesNotContain(w.Nour.ToString(), amiraList);
    }

    [Fact]
    public async Task The_workspace_orders_reports_by_next_meeting_and_offers_to_start_the_rest()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        await StartAsync(w, w.Karim, w.Nour, Manager);
        var list = await DataAsync(await w.As(w.Karim, Manager).GetAsync("/api/performance/one-on-ones"));
        var row = Assert.Single(list.GetProperty("reports").EnumerateArray());
        Assert.Equal(w.Nour, row.GetProperty("with").GetProperty("employeeId").GetGuid());
        var start = Assert.Single(list.GetProperty("startWithReports").EnumerateArray());
        Assert.Equal(w.Sami, start.GetProperty("with").GetProperty("employeeId").GetGuid());
        // Karim also reports to Amira and has no series with her yet.
        Assert.Equal(w.Amira, list.GetProperty("startWithManager").GetProperty("with").GetProperty("employeeId").GetGuid());

        var nours = await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/one-on-ones"));
        Assert.Equal(w.Karim, nours.GetProperty("withManager").GetProperty("with").GetProperty("employeeId").GetGuid());
        Assert.Empty(nours.GetProperty("startWithReports").EnumerateArray());
    }

    [Fact]
    public async Task A_manager_change_ends_the_series_on_the_next_write_and_a_new_line_starts_fresh()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Karim, w.Nour, Manager);
        var meetingId = Id(Upcoming(series));
        Reassign(w, w.Nour, w.Leila);

        var refused = await w.As(w.Nour).PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda",
            new { id = Guid.NewGuid(), text = "Vendor timeline" });
        Assert.Equal("OneOnOne.SeriesEnded", Code(await DataAsync(refused, HttpStatusCode.Conflict)));

        var ended = await DataAsync(await w.As(w.Nour).GetAsync($"/api/performance/one-on-ones/{Id(series)}"));
        Assert.True(ended.GetProperty("ended").GetBoolean());
        Assert.Equal("ReportingLineEnded", ended.GetProperty("endReason").GetString());
        Assert.Equal(JsonValueKind.Null, ended.GetProperty("upcoming").ValueKind);
        Assert.Equal("NotHeld", ended.GetProperty("past").EnumerateArray().Single().GetProperty("state").GetString());

        await StartAsync(w, w.Nour, w.Leila, Employee);
        Reassign(w, w.Nour, w.Karim);
        var again = await StartAsync(w, w.Karim, w.Nour, Manager);
        Assert.NotEqual(Id(series), Id(again));
    }

    [Fact]
    public async Task Writes_fail_typed_while_Core_HR_is_unreachable()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Karim, w.Nour, Manager);
        w.Factory.Core.Unavailable = true;
        var response = await w.As(w.Karim, Manager).PutAsJsonAsync($"/api/performance/one-on-ones/{Id(series)}/cadence",
            new { cadence = "Monthly", expectedVersion = series.GetProperty("version").GetUInt32() });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await w.As(w.Nour).PostAsJsonAsync("/api/performance/one-on-ones",
            new { withEmployeeId = w.Karim, firstMeetingAt = DateTime.UtcNow.AddHours(1) })).StatusCode);
    }

    [Fact]
    public async Task Suggestions_come_from_the_reports_year_for_the_viewer_and_leave_once_added()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var tenant = w.Factory.Store.TenantId;
        var start = Today.AddMonths(-1);
        Guid riskyId, requestId, sharedId, managerOnlyId, praiseId, oldFeedbackId;
        await using (var db = w.Factory.Store.NewContext())
        {
            var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(11), start.AddDays(14)).Activated();
            var participant = Participant.Create(tenant, cycle.Id, w.Nour, "Nour Trabelsi", null, null, "Platform", w.Karim, "Karim Haddad", false, start);
            var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, w.Nour, "Nour Trabelsi", "Platform", w.Karim, "Karim Haddad");
            var risky = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, w.Nour, "Integrate the vendor API", null, null,
                start, Today.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 50m, null, null, start, Today.AddMonths(11));
            var fine = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, w.Nour, "Ship the gateway", null, null,
                start, Today.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 50m, null, null, start, Today.AddMonths(11));
            plan.Submit(w.Nour, new PlanSubmissionFacts(2, true, 100m, true, false, PlanAlignmentPolicy.Optional));
            plan.Approve(w.Karim);
            risky.ReportStatus(ObjectiveStatus.AtRisk, DateTime.UtcNow);
            fine.ReportStatus(ObjectiveStatus.OnTrack, DateTime.UtcNow);
            var request = UpdateRequest.Create(plan, fine, w.Karim, "Karim Haddad", null, DateTime.UtcNow);
            db.AddRange(cycle, participant, plan, risky, fine, request);
            var value = Competency.Create(tenant, "Collaboration", "Works well with others", null);
            db.Competencies.Add(value);
            var shared = Feedback.Give(Guid.NewGuid(), tenant, w.Sami, "Sami Kefi", w.Nour, "Nour Trabelsi", FeedbackVisibility.Shared, w.Karim,
                "Karim Haddad", new FeedbackSubject(FeedbackSubjectKind.Competency, CompetencyId: value.Id), "SHARED-TEXT", DateTime.UtcNow);
            var managerOnly = Feedback.Give(Guid.NewGuid(), tenant, w.Sami, "Sami Kefi", w.Nour, "Nour Trabelsi", FeedbackVisibility.ManagerOnly,
                w.Karim, "Karim Haddad", FeedbackSubject.None, "MANAGER-ONLY-TEXT", DateTime.UtcNow);
            var old = Feedback.Give(Guid.NewGuid(), tenant, w.Sami, "Sami Kefi", w.Nour, "Nour Trabelsi", FeedbackVisibility.Shared, w.Karim,
                "Karim Haddad", FeedbackSubject.None, "OLD", DateTime.UtcNow.AddDays(-90));
            var praise = Praise.Give(Guid.NewGuid(), tenant, w.Leila, "Leila Baccouche", value.Id, "PRAISE-TEXT", [(w.Nour, "Nour Trabelsi")], DateTime.UtcNow);
            db.AddRange(shared, managerOnly, old, praise);
            await db.SaveChangesAsync();
            (riskyId, requestId, sharedId, managerOnlyId, praiseId, oldFeedbackId) = (risky.Id, request.Id, shared.Id, managerOnly.Id, praise.Id, old.Id);
        }

        var series = await StartAsync(w, w.Karim, w.Nour, Manager);
        var suggestions = Upcoming(series).GetProperty("suggestions").EnumerateArray().ToList();
        var sources = suggestions.Select(s => s.GetProperty("sourceId").GetGuid()).ToHashSet();
        Assert.Contains(riskyId, sources);
        Assert.Contains(requestId, sources);
        Assert.Contains(sharedId, sources);
        Assert.Contains(praiseId, sources);
        Assert.DoesNotContain(managerOnlyId, sources);
        Assert.DoesNotContain(oldFeedbackId, sources);
        // Agenda labels never carry what feedback or praise says; praise, public on the wall, shows beside the meeting.
        var raw = Upcoming(series).GetRawText();
        Assert.DoesNotContain("SHARED-TEXT", raw);
        Assert.DoesNotContain("PRAISE-TEXT", raw);
        Assert.DoesNotContain("MANAGER-ONLY-TEXT", series.GetRawText());
        Assert.Equal("AtRisk", suggestions.Single(s => s.GetProperty("sourceId").GetGuid() == riskyId).GetProperty("status").GetString());

        var meetingId = Id(Upcoming(series));
        var karim = w.As(w.Karim, Manager);
        var added = await DataAsync(await karim.PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda",
            new { id = Guid.NewGuid(), sourceKind = "Objective", sourceId = riskyId }));
        var item = Upcoming(added).GetProperty("agenda").EnumerateArray().Single(i => i.GetProperty("sourceKind").GetString() == "Objective");
        Assert.Equal("Integrate the vendor API · At risk", item.GetProperty("text").GetString());
        Assert.DoesNotContain(Upcoming(added).GetProperty("suggestions").EnumerateArray(), s => s.GetProperty("sourceId").GetGuid() == riskyId);

        // A source the caller isn't offered (manager-only feedback, or something made up) can't be added.
        var refused = await karim.PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{meetingId}/agenda",
            new { id = Guid.NewGuid(), sourceKind = "Feedback", sourceId = managerOnlyId });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

        // After completing, only what arrives later is suggested again.
        var completed = await CompleteAsync(w, series, karim);
        var after = Upcoming(completed).GetProperty("suggestions").EnumerateArray().Select(s => s.GetProperty("sourceId").GetGuid()).ToHashSet();
        Assert.DoesNotContain(sharedId, after);
        Assert.DoesNotContain(praiseId, after);
        Assert.DoesNotContain(riskyId, after);
        Assert.Contains(Upcoming(completed).GetProperty("agenda").EnumerateArray(), i => i.GetProperty("sourceKind").GetString() == "Objective");
    }

    [Fact]
    public async Task Everything_works_without_any_cycle()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Nour, w.Karim, Employee);
        Assert.Empty(Upcoming(series).GetProperty("suggestions").EnumerateArray());
        var added = await DataAsync(await w.As(w.Nour).PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{Id(Upcoming(series))}/agenda",
            new { id = Guid.NewGuid(), text = "Career goals" }));
        var completed = await CompleteAsync(w, series, w.As(w.Karim, Manager));
        Assert.Single(completed.GetProperty("past").EnumerateArray());
    }

    [Fact]
    public async Task Starting_offers_the_pairs_talking_points_and_puts_the_chosen_ones_on_the_first_meeting()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var tenant = w.Factory.Store.TenantId;
        Guid sharedId, managerOnlyId;
        await using (var db = w.Factory.Store.NewContext())
        {
            var shared = Feedback.Give(Guid.NewGuid(), tenant, w.Sami, "Sami Kefi", w.Nour, "Nour Trabelsi", FeedbackVisibility.Shared, w.Karim,
                "Karim Haddad", FeedbackSubject.None, "SHARED-TEXT", DateTime.UtcNow);
            var managerOnly = Feedback.Give(Guid.NewGuid(), tenant, w.Sami, "Sami Kefi", w.Nour, "Nour Trabelsi", FeedbackVisibility.ManagerOnly,
                w.Karim, "Karim Haddad", FeedbackSubject.None, "MANAGER-ONLY-TEXT", DateTime.UtcNow);
            db.AddRange(shared, managerOnly);
            await db.SaveChangesAsync();
            (sharedId, managerOnlyId) = (shared.Id, managerOnly.Id);
        }

        var options = await DataAsync(await w.As(w.Nour).GetAsync($"/api/performance/one-on-ones/start?with={w.Karim}"));
        Assert.Equal(w.Karim, options.GetProperty("with").GetProperty("employeeId").GetGuid());
        Assert.Equal("EveryTwoWeeks", options.GetProperty("defaultCadence").GetString());
        var offered = options.GetProperty("suggestions").EnumerateArray().Select(s => s.GetProperty("sourceId").GetGuid()).ToList();
        Assert.Equal([sharedId], offered);
        Assert.DoesNotContain("SHARED-TEXT", options.GetRawText());

        // Only the reporting line, and only with the grant for a manager.
        Assert.Equal("OneOnOne.NotReportingLine",
            Code(await DataAsync(await w.As(w.Nour).GetAsync($"/api/performance/one-on-ones/start?with={w.Sami}"), HttpStatusCode.BadRequest)));
        Assert.Equal("OneOnOne.Forbidden",
            Code(await DataAsync(await w.As(w.Karim).GetAsync($"/api/performance/one-on-ones/start?with={w.Nour}"), HttpStatusCode.Forbidden)));

        // A source that isn't offered refuses the whole start.
        var refused = await w.As(w.Nour).PostAsJsonAsync("/api/performance/one-on-ones", new
        {
            withEmployeeId = w.Karim, firstMeetingAt = DateTime.UtcNow.AddDays(1),
            agenda = new object[] { new { id = Guid.NewGuid(), sourceKind = "Feedback", sourceId = managerOnlyId } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        await using (var db = w.Factory.Store.NewContext()) Assert.Equal(0, await db.OneOnOneSeries.CountAsync());

        var started = await DataAsync(await w.As(w.Nour).PostAsJsonAsync("/api/performance/one-on-ones", new
        {
            withEmployeeId = w.Karim, firstMeetingAt = DateTime.UtcNow.AddDays(1),
            agenda = new object[]
            {
                new { id = Guid.NewGuid(), sourceKind = "Feedback", sourceId = sharedId },
                new { id = Guid.NewGuid(), text = "Career goals" },
            },
        }));
        var agenda = Upcoming(started).GetProperty("agenda").EnumerateArray().ToList();
        Assert.Equal(["Feedback from Sami Kefi", "Career goals"], agenda.Select(i => i.GetProperty("text").GetString()));
        Assert.Equal(sharedId, agenda[0].GetProperty("sourceId").GetGuid());
        Assert.Empty(Upcoming(started).GetProperty("suggestions").EnumerateArray());

        Assert.Equal("OneOnOne.AlreadyActive",
            Code(await DataAsync(await w.As(w.Karim, Manager).GetAsync($"/api/performance/one-on-ones/start?with={w.Nour}"), HttpStatusCode.Conflict)));
    }

    [Fact]
    public async Task The_workspace_shows_each_rhythm_the_next_meeting_and_the_actions_each_person_owes()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var series = await StartAsync(w, w.Karim, w.Nour, Manager, cadence: "Weekly");
        var karim = w.As(w.Karim, Manager);
        var seriesPath = $"/api/performance/one-on-ones/{Id(series)}";
        await DataAsync(await karim.PostAsJsonAsync($"{seriesPath}/actions",
            new { id = Guid.NewGuid(), text = "Book the vendor review", ownerEmployeeId = w.Karim, dueDate = Today.AddDays(-1) }));
        await DataAsync(await karim.PostAsJsonAsync($"{seriesPath}/actions",
            new { id = Guid.NewGuid(), text = "Send the vendor draft", ownerEmployeeId = w.Nour, dueDate = (DateOnly?)null }));
        var completed = await CompleteAsync(w, series, karim);
        var next = Upcoming(completed);
        await DataAsync(await w.As(w.Nour).PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{Id(next)}/agenda",
            new { id = Guid.NewGuid(), text = "Vendor timeline" }));

        var list = await DataAsync(await karim.GetAsync("/api/performance/one-on-ones"));
        var row = Assert.Single(list.GetProperty("reports").EnumerateArray());
        Assert.Equal(Id(next), row.GetProperty("nextMeetingId").GetGuid());
        Assert.Equal(Starters + 1, row.GetProperty("agendaCount").GetInt32());
        Assert.NotEqual(JsonValueKind.Null, row.GetProperty("lastMetAt").ValueKind);
        Assert.Equal(["Completed", "Upcoming"], row.GetProperty("recent").EnumerateArray().Select(b => b.GetProperty("state").GetString()));
        var owed = Assert.Single(list.GetProperty("myActions").EnumerateArray());
        Assert.Equal("Book the vendor review", owed.GetProperty("text").GetString());
        Assert.Equal(w.Nour, owed.GetProperty("with").GetProperty("employeeId").GetGuid());
        Assert.True(owed.GetProperty("overdue").GetBoolean());

        var nours = await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/one-on-ones"));
        var hers = Assert.Single(nours.GetProperty("myActions").EnumerateArray());
        Assert.Equal("Send the vendor draft", hers.GetProperty("text").GetString());
        Assert.Equal(w.Karim, hers.GetProperty("with").GetProperty("employeeId").GetGuid());

        // An ended series leaves the owed list.
        Reassign(w, w.Nour, w.Leila);
        Assert.Empty((await DataAsync(await w.As(w.Nour).GetAsync("/api/performance/one-on-ones"))).GetProperty("myActions").EnumerateArray());
    }

    [Fact]
    public async Task A_late_action_joins_the_agenda_and_the_report_s_goals_and_praise_sit_beside_it()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        var tenant = w.Factory.Store.TenantId;
        var start = Today.AddMonths(-1);
        await using (var db = w.Factory.Store.NewContext())
        {
            var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(11), start.AddDays(14)).Activated();
            var participant = Participant.Create(tenant, cycle.Id, w.Nour, "Nour Trabelsi", null, null, "Platform", w.Karim, "Karim Haddad", false, start);
            var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, w.Nour, "Nour Trabelsi", "Platform", w.Karim, "Karim Haddad");
            var goal = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, w.Nour, "Ship the gateway", null, null,
                start, Today.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 100m, null, null, start, Today.AddMonths(11));
            plan.Submit(w.Nour, new PlanSubmissionFacts(1, true, 100m, true, false, PlanAlignmentPolicy.Optional));
            plan.Approve(w.Karim);
            var value = Competency.Create(tenant, "Collaboration", "Works well with others", null);
            var praise = Praise.Give(Guid.NewGuid(), tenant, w.Leila, "Leila Baccouche", value.Id, "The drill was the best we ran.",
                [(w.Nour, "Nour Trabelsi")], DateTime.UtcNow);
            db.AddRange(cycle, participant, plan, goal, value, praise);
            await db.SaveChangesAsync();
        }
        var series = await StartAsync(w, w.Karim, w.Nour, Manager);
        var karim = w.As(w.Karim, Manager);
        var late = Guid.NewGuid();
        await DataAsync(await karim.PostAsJsonAsync($"/api/performance/one-on-ones/{Id(series)}/actions",
            new { id = late, text = "Share the revised estimate", ownerEmployeeId = w.Nour, dueDate = Today.AddDays(-9) }));

        var asNour = await DataAsync(await w.As(w.Nour).GetAsync($"/api/performance/one-on-ones/{Id(series)}"));
        var offered = Upcoming(asNour).GetProperty("suggestions").EnumerateArray().Single(s => s.GetProperty("kind").GetString() == "Action");
        Assert.Equal(late, offered.GetProperty("sourceId").GetGuid());
        Assert.Equal(w.Nour, offered.GetProperty("by").GetGuid());

        // A note on a suggestion is how it joins the agenda.
        var noted = await DataAsync(await w.As(w.Nour).PostAsJsonAsync($"/api/performance/one-on-ones/meetings/{Id(Upcoming(series))}/agenda",
            new { id = Guid.NewGuid(), sourceKind = "Action", sourceId = late, note = "Sent it this morning." }));
        var item = Upcoming(noted).GetProperty("agenda").EnumerateArray().Single(i => i.GetProperty("sourceKind").GetString() == "Action");
        Assert.True(item.GetProperty("discussed").GetBoolean());
        Assert.Equal("Sent it this morning.", item.GetProperty("note").GetString());

        var context = asNour.GetProperty("context");
        Assert.Equal("Ship the gateway", context.GetProperty("goals").EnumerateArray().Single().GetProperty("title").GetString());
        Assert.True(context.GetProperty("planApproved").GetBoolean());
        Assert.Equal("Leila Baccouche", context.GetProperty("latestPraise").GetProperty("authorName").GetString());
    }

    [Fact]
    public async Task The_calendar_feed_lists_only_its_owner_s_meetings_and_dies_when_revoked_or_used_elsewhere()
    {
        var w = Arrange();
        await using var _ = w.Factory;
        await StartAsync(w, w.Karim, w.Nour, Manager);
        await StartAsync(w, w.Karim, w.Sami, Manager);
        var nour = w.As(w.Nour);
        var anonymous = w.Factory.CreateClient();

        var off = await DataAsync(await nour.GetAsync("/api/performance/one-on-ones/calendar-feed"));
        Assert.False(off.GetProperty("on").GetBoolean());
        var made = await DataAsync(await nour.PostAsync("/api/performance/one-on-ones/calendar-feed", null));
        var url = made.GetProperty("url").GetString()!;
        var path = new Uri(url).AbsolutePath;
        Assert.StartsWith("/api/performance/calendar/", path);
        // The link shows once: reading the status again never returns it.
        Assert.Equal(JsonValueKind.Null, (await DataAsync(await nour.GetAsync("/api/performance/one-on-ones/calendar-feed"))).GetProperty("url").ValueKind);

        var feed = await anonymous.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, feed.StatusCode);
        Assert.Equal("text/calendar", feed.Content.Headers.ContentType?.MediaType);
        var ics = await feed.Content.ReadAsStringAsync();
        Assert.Contains("BEGIN:VCALENDAR", ics);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(ics, "BEGIN:VEVENT"));
        Assert.Contains("SUMMARY:1:1 with Karim Haddad", ics);
        Assert.DoesNotContain("Sami", ics);

        // A guess, the same secret under another tenant, and a replaced link all read nothing.
        var token = path["/api/performance/calendar/".Length..^".ics".Length];
        var secret = token[(token.IndexOf('.') + 1)..];
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/performance/calendar/{Guid.NewGuid():N}.{secret}.ics")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/performance/calendar/not-a-token.ics")).StatusCode);
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Nour, permissions: Employee);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.GetAsync(path)).StatusCode);
        await DataAsync(await nour.PostAsync("/api/performance/one-on-ones/calendar-feed", null));
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(path)).StatusCode);

        await DataAsync(await nour.DeleteAsync("/api/performance/one-on-ones/calendar-feed"));
        Assert.False((await DataAsync(await nour.GetAsync("/api/performance/one-on-ones/calendar-feed"))).GetProperty("on").GetBoolean());
    }
}
