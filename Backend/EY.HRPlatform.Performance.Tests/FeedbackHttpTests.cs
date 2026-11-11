using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// performance-feedback over HTTP. Karim manages Rim and Khaled; Amira administers HR and manages Karim; Leila is a
/// colleague in another team.
/// </summary>
public sealed class FeedbackHttpTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Manager =
        [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self), new(PerformancePermissions.CycleView, PermissionScopes.DirectReports)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
         new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];

    private sealed record World(PerformanceApiFactory Factory, Guid Amira, Guid Karim, Guid Rim, Guid Khaled, Guid Leila, Guid Orphan,
        Guid Gone, Guid Collaboration, Guid Archived)
    {
        public HttpClient As(Guid employee, EffectivePermissionGrant[]? grants = null)
            => Factory.CreateAuthenticatedClient(employeeId: employee, permissions: grants ?? Employee);
    }

    private static async Task<World> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var amira = factory.Core.Add("Amira Khelifi").EmployeeId;
        var karim = factory.Core.Add("Karim Haddad", managerId: amira).EmployeeId;
        var rim = factory.Core.Add("Rim Mahjoub", managerId: karim).EmployeeId;
        var khaled = factory.Core.Add("Khaled Sassi", managerId: karim).EmployeeId;
        var leila = factory.Core.Add("Leila Baccouche", managerId: amira).EmployeeId;
        var orphan = factory.Core.Add("Sami Ben Youssef").EmployeeId;
        var gone = factory.Core.Add("Former Colleague", isActive: false).EmployeeId;
        var collaboration = Competency.Create(factory.Store.TenantId, "Collaboration", "Works well with others", null);
        var archived = Competency.Create(factory.Store.TenantId, "Old value", "Retired", null);
        archived.Archive();
        await using var db = factory.Store.NewContext();
        db.Competencies.AddRange(collaboration, archived);
        await db.SaveChangesAsync();
        return new World(factory, amira, karim, rim, khaled, leila, orphan, gone, collaboration.Id, archived.Id);
    }

    private static async Task<JsonElement> SendAsync(HttpClient client, HttpMethod method, string path, object? body = null,
        HttpStatusCode expected = HttpStatusCode.OK)
    {
        using var request = new HttpRequestMessage(method, path) { Content = body is null ? null : JsonContent.Create(body) };
        var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode}: {text}");
        var json = JsonDocument.Parse(text).RootElement;
        return expected == HttpStatusCode.OK ? json.GetProperty("data") : json;
    }

    private static string Code(JsonElement failure) => failure.GetProperty("details").GetProperty("code").GetString()!;

    private static Task<JsonElement> GiveAsync(World w, Guid from, Guid to, string visibility = "Shared", string message = "Thanks for the review",
        Guid? competencyId = null, Guid? id = null, EffectivePermissionGrant[]? grants = null, HttpStatusCode expected = HttpStatusCode.OK,
        Guid? cycleId = null, Guid? objectiveId = null)
        => SendAsync(w.As(from, grants), HttpMethod.Post, "/api/performance/feedback",
            new { id = id ?? Guid.NewGuid(), receiverEmployeeId = to, visibility, message, competencyId, cycleId, objectiveId }, expected);

    private static async Task<HashSet<Guid>> ListAsync(World w, Guid who, EffectivePermissionGrant[] grants, string view = "received")
    {
        var page = await SendAsync(w.As(who, grants), HttpMethod.Get, $"/api/performance/feedback?view={view}");
        return page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToHashSet();
    }

    [Fact]
    public async Task Shared_feedback_reaches_receiver_author_managers_and_HR_with_a_contentless_notification()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var given = await GiveAsync(w, w.Leila, w.Rim, message: "SECRET-MESSAGE-TEXT", competencyId: w.Collaboration);
        var id = given.GetProperty("id").GetGuid();
        Assert.Equal("Collaboration", given.GetProperty("subject").GetProperty("label").GetString());

        Assert.Contains(id, await ListAsync(w, w.Rim, Employee));
        Assert.Contains(id, await ListAsync(w, w.Leila, Employee, "given"));
        Assert.Contains(id, await ListAsync(w, w.Karim, Manager, "team"));
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Amira, Admin).GetAsync($"/api/performance/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Khaled).GetAsync($"/api/performance/feedback/{id}")).StatusCode);

        // Rim moves to Leila's team: the manager it was addressed to and the new manager both read it.
        var rim = w.Factory.Core.ById[w.Rim];
        w.Factory.Core.ById[w.Rim] = rim with { Manager = new WorkforceManagerSnapshot(w.Leila, "Leila Baccouche", true) };
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Karim, Manager).GetAsync($"/api/performance/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Leila, Manager).GetAsync($"/api/performance/feedback/{id}")).StatusCode);

        await using var db = w.Factory.Store.NewContext();
        var notification = Assert.Single(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Rim).ToListAsync());
        Assert.Equal($"/performance/feedback?tab=yours#feedback-{id}", notification.Href);
        var outbox = await db.OutboxMessages.SingleAsync(m => m.RecipientEmployeeId == w.Rim);
        var email = notification.EnglishEmail();
        Assert.DoesNotContain("SECRET-MESSAGE-TEXT", email.Text + email.Html + email.Subject + outbox.Payload + notification.ValuesJson);
        var audit = await db.AuditEntries.SingleAsync(e => e.Action == PerformanceAuditActions.FeedbackGiven);
        Assert.DoesNotContain("SECRET-MESSAGE-TEXT", JsonSerializer.Serialize(audit));
    }

    [Fact]
    public async Task Manager_only_feedback_reaches_only_its_addressee_and_author()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var given = await GiveAsync(w, w.Leila, w.Rim, "ManagerOnly", "Rim struggled with the release");
        var id = given.GetProperty("id").GetGuid();
        Assert.Equal(w.Karim, given.GetProperty("addressedManager").GetProperty("id").GetGuid());

        Assert.DoesNotContain(id, await ListAsync(w, w.Rim, Employee));
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Rim).GetAsync($"/api/performance/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Amira, Admin).GetAsync($"/api/performance/feedback/{id}")).StatusCode);
        Assert.DoesNotContain(id, await ListAsync(w, w.Amira, Admin, "team"));
        Assert.Contains(id, await ListAsync(w, w.Karim, Manager, "team"));
        Assert.Contains(id, await ListAsync(w, w.Leila, Employee, "given"));

        await using var db = w.Factory.Store.NewContext();
        Assert.Empty(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Rim).ToListAsync());
        Assert.Single(await db.Notifications.Where(n => n.RecipientEmployeeId == w.Karim && n.Kind == PerformanceNotificationKind.FeedbackForReport).ToListAsync());
    }

    [Fact]
    public async Task An_administrator_who_is_the_addressed_manager_reads_it_as_the_addressee()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        // Leila reports to Amira, who also administers HR.
        var given = await GiveAsync(w, w.Rim, w.Leila, "ManagerOnly", "Leila's handover was rushed");
        var id = given.GetProperty("id").GetGuid();
        var adminAndManager = Admin.Concat(Manager).ToArray();
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Amira, adminAndManager).GetAsync($"/api/performance/feedback/{id}")).StatusCode);
    }

    [Fact]
    public async Task Invalid_feedback_is_refused_with_typed_failures()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        Assert.Equal("Feedback.NoManager", Code(await GiveAsync(w, w.Rim, w.Orphan, "ManagerOnly", expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Karim, w.Rim, "ManagerOnly", grants: Manager, expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Rim, w.Rim, expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.ReceiverUnavailable", Code(await GiveAsync(w, w.Rim, w.Gone, expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.ReceiverUnavailable", Code(await GiveAsync(w, w.Rim, Guid.NewGuid(), expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Rim, w.Leila, competencyId: w.Archived, expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Rim, w.Leila, message: new string('x', 2_001), expected: HttpStatusCode.BadRequest)));
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Rim, w.Leila, message: "  ", expected: HttpStatusCode.BadRequest)));
    }

    [Fact]
    public async Task Feedback_about_an_objective_must_be_the_receivers_own_or_published_direction()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var tenant = w.Factory.Store.TenantId;
        var start = Today.AddMonths(-1);
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(11), start.AddDays(14)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, w.Khaled, "Khaled Sassi", null, null, "Platform", w.Karim, "Karim Haddad", false, start);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, w.Khaled, "Khaled Sassi", "Platform", w.Karim, "Karim Haddad");
        var khaleds = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, w.Khaled, "Cut build time", null, null,
            start, Today.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 100m, null, null, start, Today.AddMonths(11));
        plan.Submit(w.Khaled, new PlanSubmissionFacts(1, true, 100m, true, false, PlanAlignmentPolicy.Optional));
        plan.Approve(w.Karim);
        await using (var db = w.Factory.Store.NewContext())
        {
            db.AddRange(cycle, participant, plan, khaleds);
            await db.SaveChangesAsync();
        }

        var about = await GiveAsync(w, w.Karim, w.Khaled, grants: Manager, cycleId: cycle.Id, objectiveId: khaleds.Id);
        Assert.Equal("Cut build time", about.GetProperty("subject").GetProperty("label").GetString());

        // Karim can read Khaled's objective, but naming it on feedback to Rim would show its title to Rim.
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Karim, w.Rim, grants: Manager, cycleId: cycle.Id, objectiveId: khaleds.Id,
            expected: HttpStatusCode.BadRequest)));
        // Leila can't read it at all; the answer is the same.
        Assert.Equal("Feedback.Invalid", Code(await GiveAsync(w, w.Leila, w.Khaled, cycleId: cycle.Id, objectiveId: khaleds.Id,
            expected: HttpStatusCode.BadRequest)));

        var forObjective = await SendAsync(w.As(w.Khaled), HttpMethod.Get, $"/api/performance/feedback?cycleId={cycle.Id}&objectiveId={khaleds.Id}");
        Assert.Single(forObjective.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task A_retried_send_returns_the_original_and_feedback_cannot_change()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = Guid.NewGuid();
        await GiveAsync(w, w.Leila, w.Rim, id: id);
        await GiveAsync(w, w.Leila, w.Rim, id: id);
        Assert.Equal("Feedback.IdConflict", Code(await GiveAsync(w, w.Khaled, w.Rim, id: id, expected: HttpStatusCode.Conflict)));
        await using (var db = w.Factory.Store.NewContext())
            Assert.Equal(1, await db.Feedback.CountAsync());

        var put = await w.As(w.Leila).PutAsJsonAsync($"/api/performance/feedback/{id}", new { message = "changed" });
        var delete = await w.As(w.Leila).DeleteAsync($"/api/performance/feedback/{id}");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, put.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, delete.StatusCode);
    }

    [Fact]
    public async Task Feedback_never_crosses_tenants()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await GiveAsync(w, w.Leila, w.Rim)).GetProperty("id").GetGuid();
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Rim, permissions: Admin);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.GetAsync($"/api/performance/feedback/{id}")).StatusCode);
    }

    // ── Requests ─────────────────────────────────────────────────────────────

    private static Task<JsonElement> AskAsync(World w, Guid requester, Guid[] invitees, DateOnly? due = null, HttpStatusCode expected = HttpStatusCode.OK)
        => SendAsync(w.As(requester), HttpMethod.Post, "/api/performance/feedback/requests",
            new { id = Guid.NewGuid(), question = "How did the mobile onboarding redesign land?", inviteeEmployeeIds = invitees,
                dueDate = due ?? Today.AddDays(10), competencyId = (Guid?)null }, expected);

    [Fact]
    public async Task Asking_invites_each_colleague_and_bad_requests_are_refused()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var request = await AskAsync(w, w.Rim, [w.Leila, w.Khaled, w.Karim]);
        Assert.Equal("Open", request.GetProperty("state").GetString());
        Assert.Equal(3, request.GetProperty("invitees").GetArrayLength());

        await using (var db = w.Factory.Store.NewContext())
            Assert.Equal(3, await db.Notifications.CountAsync(n => n.Kind == PerformanceNotificationKind.FeedbackRequested));

        await AskAsync(w, w.Rim, [], expected: HttpStatusCode.BadRequest);
        await AskAsync(w, w.Rim, [w.Leila, w.Khaled, w.Karim, w.Amira, w.Orphan, Guid.NewGuid()], expected: HttpStatusCode.BadRequest);
        await AskAsync(w, w.Rim, [w.Rim], expected: HttpStatusCode.BadRequest);
        await AskAsync(w, w.Rim, [w.Leila], Today.AddDays(-1), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Invitees_see_only_their_part_while_the_requester_and_their_manager_see_everything()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await AskAsync(w, w.Rim, [w.Leila, w.Khaled, w.Orphan])).GetProperty("id").GetGuid();
        var path = $"/api/performance/feedback/requests/{id}";
        await SendAsync(w.As(w.Leila), HttpMethod.Post, $"{path}/answer", new { feedbackId = Guid.NewGuid(), message = "LEILA-ANSWER" });

        var asKhaled = await w.As(w.Khaled).GetStringAsync(path);
        Assert.DoesNotContain("LEILA-ANSWER", asKhaled);
        Assert.DoesNotContain("Leila Baccouche", asKhaled);
        Assert.DoesNotContain(w.Orphan.ToString(), asKhaled);
        Assert.Contains("\"viewerRole\":\"Invitee\"", asKhaled);

        Assert.Contains("LEILA-ANSWER", await w.As(w.Rim).GetStringAsync(path));
        Assert.Contains("LEILA-ANSWER", await w.As(w.Karim, Manager).GetStringAsync(path));
        Assert.Contains("LEILA-ANSWER", await w.As(w.Amira, Admin).GetStringAsync(path));
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Amira).GetAsync(path)).StatusCode);

        var rows = await SendAsync(w.As(w.Khaled), HttpMethod.Get, "/api/performance/feedback/requests");
        var row = Assert.Single(rows.GetProperty("toAnswer").EnumerateArray());
        Assert.Equal(0, row.GetProperty("invited").GetInt32());
        Assert.Equal("Waiting", row.GetProperty("myStatus").GetString());
    }

    [Fact]
    public async Task Answers_become_shared_feedback_once_and_the_last_response_closes_the_request()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await AskAsync(w, w.Rim, [w.Leila, w.Khaled])).GetProperty("id").GetGuid();
        var path = $"/api/performance/feedback/requests/{id}";

        var answer = Guid.NewGuid();
        await SendAsync(w.As(w.Leila), HttpMethod.Post, $"{path}/answer", new { feedbackId = answer, message = "Clear and well paced." });
        await SendAsync(w.As(w.Leila), HttpMethod.Post, $"{path}/answer", new { feedbackId = Guid.NewGuid(), message = "Second answer" });
        await SendAsync(w.As(w.Leila), HttpMethod.Post, $"{path}/decline", new { reason = "Changed my mind" });
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Karim, Manager).PostAsJsonAsync($"{path}/answer",
            new { feedbackId = Guid.NewGuid(), message = "Not asked" })).StatusCode);

        Assert.Contains(answer, await ListAsync(w, w.Rim, Employee));
        Assert.Contains(answer, await ListAsync(w, w.Karim, Manager, "team"));

        var closed = await SendAsync(w.As(w.Khaled), HttpMethod.Post, $"{path}/decline", new { reason = "Not close enough to it" });
        Assert.Equal("Closed", closed.GetProperty("state").GetString());
        Assert.Equal("AllResponded", closed.GetProperty("closeReason").GetString());

        await using var db = w.Factory.Store.NewContext();
        Assert.Equal(1, await db.Feedback.CountAsync());
        Assert.Equal(2, await db.Notifications.CountAsync(n => n.RecipientEmployeeId == w.Rim && n.Kind == PerformanceNotificationKind.FeedbackRequestResponded));
    }

    [Fact]
    public async Task The_requester_closes_early_and_late_answers_count_only_while_open()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await AskAsync(w, w.Rim, [w.Leila, w.Khaled], Today)).GetProperty("id").GetGuid();
        var path = $"/api/performance/feedback/requests/{id}";
        Assert.Equal(HttpStatusCode.Forbidden, (await w.As(w.Karim, Manager).PostAsync($"{path}/close", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.As(w.Amira).PostAsync($"{path}/close", null)).StatusCode);

        await SendAsync(w.As(w.Leila), HttpMethod.Post, $"{path}/answer", new { feedbackId = Guid.NewGuid(), message = "On the due date" });
        var closed = await SendAsync(w.As(w.Rim), HttpMethod.Post, $"{path}/close");
        Assert.Equal("ClosedByRequester", closed.GetProperty("closeReason").GetString());

        var late = await SendAsync(w.As(w.Khaled), HttpMethod.Post, $"{path}/answer",
            new { feedbackId = Guid.NewGuid(), message = "Too late" }, expected: HttpStatusCode.Conflict);
        Assert.Equal("FeedbackRequest.Closed", Code(late));
        var khaledsView = await SendAsync(w.As(w.Khaled), HttpMethod.Get, path);
        Assert.False(khaledsView.GetProperty("can").GetProperty("answer").GetBoolean());
    }

    [Fact]
    public async Task The_summary_counts_what_the_caller_may_read_and_suggests_the_least_discussed_objectives()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var tenant = w.Factory.Store.TenantId;
        var start = Today.AddMonths(-1);
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, Today.AddMonths(11), start.AddDays(14)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, w.Khaled, "Khaled Sassi", null, null, "Platform", w.Karim, "Karim Haddad", false, start);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, w.Khaled, "Khaled Sassi", "Platform", w.Karim, "Karim Haddad");
        var build = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, w.Khaled, "Cut build time", null, null,
            start, Today.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 50m, null, null, start, Today.AddMonths(11));
        var gateway = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, w.Khaled, "Ship the gateway", null, null,
            start, Today.AddMonths(11), ObjectiveMeasurement.ManualPercentage(), 50m, null, null, start, Today.AddMonths(11));
        plan.Submit(w.Khaled, new PlanSubmissionFacts(2, true, 100m, true, false, PlanAlignmentPolicy.Optional));
        plan.Approve(w.Karim);
        await using (var db = w.Factory.Store.NewContext())
        {
            db.AddRange(cycle, participant, plan, build, gateway);
            await db.SaveChangesAsync();
        }

        await GiveAsync(w, w.Karim, w.Khaled, grants: Manager, cycleId: cycle.Id, objectiveId: build.Id);
        await GiveAsync(w, w.Leila, w.Khaled, competencyId: w.Collaboration);
        await GiveAsync(w, w.Rim, w.Khaled, visibility: "ManagerOnly");
        await GiveAsync(w, w.Khaled, w.Rim);
        await AskAsync(w, w.Rim, [w.Khaled]);

        var summary = await SendAsync(w.As(w.Khaled), HttpMethod.Get, "/api/performance/feedback/summary");
        Assert.Equal(2, summary.GetProperty("received").GetInt32());
        Assert.Equal(2, summary.GetProperty("fromCount").GetInt32());
        Assert.Equal(new HashSet<Guid> { w.Karim, w.Leila },
            summary.GetProperty("from").EnumerateArray().Select(p => p.GetProperty("id").GetGuid()).ToHashSet());
        Assert.Equal(new HashSet<string?> { "Cut build time", "Collaboration" },
            summary.GetProperty("subjects").EnumerateArray().Select(s => s.GetProperty("label").GetString()).ToHashSet());
        Assert.Equal(1, summary.GetProperty("given").GetInt32());
        Assert.Equal(1, summary.GetProperty("toAnswer").GetInt32());
        var ask = summary.GetProperty("askAbout").EnumerateArray().ToList();
        Assert.Equal(["Ship the gateway", "Cut build time"], ask.Select(a => a.GetProperty("title").GetString()));
        Assert.Equal([0, 1], ask.Select(a => a.GetProperty("feedback").GetInt32()));

        // Manager-only feedback stays out of the receiver's numbers, and another tenant sees nothing.
        Assert.DoesNotContain(w.Rim.ToString(), summary.GetRawText());
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Khaled, permissions: Employee);
        var empty = await SendAsync(foreign, HttpMethod.Get, "/api/performance/feedback/summary");
        Assert.Equal(0, empty.GetProperty("received").GetInt32());
        Assert.Empty(empty.GetProperty("askAbout").EnumerateArray());
    }

    [Fact]
    public async Task Request_rows_show_the_requester_who_answered_and_the_latest_answer_but_never_to_an_invitee()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await SendAsync(w.As(w.Rim), HttpMethod.Post, "/api/performance/feedback/requests", new
        {
            id = Guid.NewGuid(), question = "How was the demo?", inviteeEmployeeIds = new[] { w.Leila, w.Khaled }, dueDate = Today.AddDays(5),
            competencyId = w.Collaboration,
        })).GetProperty("id").GetGuid();
        await SendAsync(w.As(w.Leila), HttpMethod.Post, $"/api/performance/feedback/requests/{id}/answer",
            new { feedbackId = Guid.NewGuid(), message = "LEILA-ANSWER" });

        var mine = Assert.Single((await SendAsync(w.As(w.Rim), HttpMethod.Get, "/api/performance/feedback/requests")).GetProperty("mine").EnumerateArray());
        Assert.Equal("Collaboration", mine.GetProperty("subject").GetProperty("label").GetString());
        Assert.Equal(["Waiting", "Answered"], mine.GetProperty("invitees").EnumerateArray()
            .OrderBy(i => i.GetProperty("person").GetProperty("name").GetString()).Select(i => i.GetProperty("status").GetString()));
        Assert.Equal("LEILA-ANSWER", mine.GetProperty("latestAnswer").GetProperty("message").GetString());

        var theirs = await w.As(w.Khaled).GetStringAsync("/api/performance/feedback/requests");
        Assert.DoesNotContain("LEILA-ANSWER", theirs);
        Assert.DoesNotContain(w.Leila.ToString(), theirs);
        Assert.Contains("Collaboration", theirs);
    }
}
