using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Performance settings behind `performance.settings.view|manage` (B-071 D5), the caller's section list with each
/// section's last change (D1, D6), and the nine-box band editor's server rules.
/// </summary>
public sealed class SettingsSectionsHttpTests
{
    private static readonly EffectivePermissionGrant[] Employee =
        [new(PerformancePermissions.CycleView, PermissionScopes.Self), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Viewer =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.SettingsView, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] CycleAdmin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant)];
    private static readonly EffectivePermissionGrant[] SettingsAdmin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.SettingsView, PermissionScopes.Tenant),
            new(PerformancePermissions.SettingsManage, PermissionScopes.Tenant)];

    private static readonly string[] Reads =
        ["/api/performance/settings", "/api/performance/settings/rating-scale", "/api/performance/settings/competencies",
            "/api/performance/settings/review-questions", "/api/performance/settings/notifications"];

    [Fact]
    public async Task A_viewer_reads_every_section_but_every_write_is_forbidden()
    {
        await using var factory = new PerformanceApiFactory();
        using var viewer = factory.CreateAuthenticatedClient(permissions: Viewer);

        foreach (var path in Reads)
        {
            using var read = await viewer.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        }

        foreach (var response in await WritesAsync(viewer))
        {
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            response.Dispose();
        }
    }

    [Fact]
    public async Task A_cycle_administrator_without_settings_reads_the_defaults_but_cannot_change_them()
    {
        await using var factory = new PerformanceApiFactory();
        using var admin = factory.CreateAuthenticatedClient(permissions: CycleAdmin);

        foreach (var path in Reads)
        {
            using var read = await admin.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        }

        foreach (var response in await WritesAsync(admin))
        {
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            response.Dispose();
        }
    }

    [Fact]
    public async Task An_employee_gets_no_settings_and_no_sections()
    {
        await using var factory = new PerformanceApiFactory();
        using var employee = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(), permissions: Employee);

        foreach (var path in Reads)
        {
            using var read = await employee.GetAsync(path);
            Assert.Equal(HttpStatusCode.Forbidden, read.StatusCode);
            Assert.DoesNotContain("levels", await read.Content.ReadAsStringAsync());
        }

        Assert.Empty((await SectionsAsync(employee)).EnumerateArray());
        Assert.False((await ContextAsync(employee)).GetProperty("destinations").GetProperty("settings").GetBoolean());
    }

    [Fact]
    public async Task Settings_navigation_follows_settings_view()
    {
        await using var factory = new PerformanceApiFactory();
        using var viewer = factory.CreateAuthenticatedClient(permissions: Viewer);
        using var cycleAdmin = factory.CreateAuthenticatedClient(permissions: CycleAdmin);

        var viewerDestinations = (await ContextAsync(viewer)).GetProperty("destinations");
        Assert.True(viewerDestinations.GetProperty("settings").GetBoolean());
        Assert.False(viewerDestinations.GetProperty("cycleAdmin").GetBoolean());
        Assert.True((await ContextAsync(cycleAdmin)).GetProperty("destinations").GetProperty("settings").GetBoolean());
    }

    [Fact]
    public async Task Sections_list_all_eight_with_the_callers_access()
    {
        await using var factory = new PerformanceApiFactory();
        using var viewer = factory.CreateAuthenticatedClient(permissions: Viewer);
        using var manager = factory.CreateAuthenticatedClient(permissions: SettingsAdmin);

        var viewed = (await SectionsAsync(viewer)).EnumerateArray().ToList();
        Assert.Equal(
            ["rating-scale", "competencies", "review-questions", "reviews", "planning", "conversations", "ai-and-data", "notifications"],
            viewed.Select(section => section.GetProperty("id").GetString()));
        Assert.Equal(
            ["Rating scale", "Competencies", "Review questions", "Reviews", "Planning", "Conversations", "AI and data", "Notifications"],
            viewed.Select(section => section.GetProperty("label").GetString()));
        Assert.All(viewed, section =>
        {
            Assert.Equal("view", section.GetProperty("access").GetString());
            Assert.Equal($"/performance/settings/{section.GetProperty("id").GetString()}", section.GetProperty("path").GetString());
        });
        Assert.All((await SectionsAsync(manager)).EnumerateArray(), section => Assert.Equal("manage", section.GetProperty("access").GetString()));
    }

    [Fact]
    public async Task A_reviews_change_names_its_author_on_reviews_only()
    {
        await using var factory = new PerformanceApiFactory();
        var amira = Guid.NewGuid();
        factory.Core.ById[amira] = new WorkforceSnapshot(amira, "E-1", "Amira Khelifi", "Amira Khelifi", null, null, true, null, null);
        using var admin = factory.CreateAuthenticatedClient(employeeId: amira, permissions: SettingsAdmin);

        // Never changed: no last change; the settings record exists once read, so it reports when it was set up.
        var before = await SectionsAsync(admin);
        Assert.All(before.EnumerateArray(), section => Assert.Equal(JsonValueKind.Null, section.GetProperty("lastChange").ValueKind));

        var settings = await DataAsync(admin, "/api/performance/settings");
        var body = UpdateBody(settings);
        body["managerAssessmentDueDays"] = 10;
        using (var saved = await admin.PutAsJsonAsync("/api/performance/settings", body))
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        var sections = (await SectionsAsync(admin)).EnumerateArray().ToDictionary(section => section.GetProperty("id").GetString()!);
        var reviews = sections["reviews"].GetProperty("lastChange");
        Assert.Equal("Amira Khelifi", reviews.GetProperty("actorName").GetString());
        Assert.Equal(JsonValueKind.Null, sections["planning"].GetProperty("lastChange").ValueKind);
        Assert.Equal(JsonValueKind.Null, sections["conversations"].GetProperty("lastChange").ValueKind);
        Assert.Equal(JsonValueKind.Null, sections["rating-scale"].GetProperty("lastChange").ValueKind);
        Assert.NotEqual(JsonValueKind.Null, sections["planning"].GetProperty("setUpAt").ValueKind);
    }

    [Fact]
    public async Task An_author_who_cannot_be_resolved_is_someone_and_an_account_resolves_through_identity()
    {
        await using var factory = new PerformanceApiFactory();
        var lead = Guid.NewGuid();
        factory.Holders.Holders.Add(new PermissionHolder(lead, null, "Nadia Trabelsi", "nadia@example.test"));
        using var account = factory.CreateAuthenticatedClient(permissions: SettingsAdmin, userId: lead);
        using var unknown = factory.CreateAuthenticatedClient(permissions: SettingsAdmin, employeeId: Guid.NewGuid());

        var settings = await DataAsync(account, "/api/performance/settings");
        var body = UpdateBody(settings);
        body["defaultOneOnOneCadence"] = "Weekly";
        using (var saved = await account.PutAsJsonAsync("/api/performance/settings", body))
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        var scale = await DataAsync(unknown, "/api/performance/settings/rating-scale");
        using (var savedScale = await unknown.PutAsJsonAsync("/api/performance/settings/rating-scale", new
               {
                   levels = scale.GetProperty("levels").Deserialize<JsonElement>(),
                   expectedVersion = scale.GetProperty("version").GetUInt32(),
               }))
            Assert.Equal(HttpStatusCode.OK, savedScale.StatusCode);

        var sections = (await SectionsAsync(account)).EnumerateArray().ToDictionary(section => section.GetProperty("id").GetString()!);
        Assert.Equal("Nadia Trabelsi", sections["conversations"].GetProperty("lastChange").GetProperty("actorName").GetString());
        Assert.Equal("Someone", sections["rating-scale"].GetProperty("lastChange").GetProperty("actorName").GetString());
    }

    [Fact]
    public async Task Sections_and_their_last_changes_stay_in_the_callers_tenant()
    {
        await using var factory = new PerformanceApiFactory();
        using var tenantA = factory.CreateAuthenticatedClient(permissions: SettingsAdmin);
        using var tenantB = factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), permissions: SettingsAdmin);

        var settings = await DataAsync(tenantA, "/api/performance/settings");
        var body = UpdateBody(settings);
        body["planningDeadlineOffsetDays"] = 45;
        using (var saved = await tenantA.PutAsJsonAsync("/api/performance/settings", body))
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        Assert.All((await SectionsAsync(tenantB)).EnumerateArray(), section =>
            Assert.Equal(JsonValueKind.Null, section.GetProperty("lastChange").ValueKind));
        Assert.Equal(30, (await DataAsync(tenantB, "/api/performance/settings")).GetProperty("planningDeadlineOffsetDays").GetInt32());
    }

    [Fact]
    public async Task Nine_box_bands_move_over_the_current_scale_and_never_leave_a_band_empty()
    {
        await using var factory = new PerformanceApiFactory();
        using var admin = factory.CreateAuthenticatedClient(permissions: SettingsAdmin);
        using var viewer = factory.CreateAuthenticatedClient(permissions: Viewer);

        var settings = await DataAsync(admin, "/api/performance/settings");
        var bands = settings.GetProperty("nineBoxBands");
        Assert.Equal(2, bands.GetProperty("lowTop").GetInt32());
        Assert.Equal(3, bands.GetProperty("midTop").GetInt32());

        var moved = UpdateBody(settings);
        moved["nineBoxBands"] = new JsonObject { ["lowTop"] = 2, ["midTop"] = 4 };
        using (var forbidden = await viewer.PutAsJsonAsync("/api/performance/settings", moved))
            Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using (var saved = await admin.PutAsJsonAsync("/api/performance/settings", moved))
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        var after = await DataAsync(admin, "/api/performance/settings");
        Assert.Equal(4, after.GetProperty("nineBoxBands").GetProperty("midTop").GetInt32());
        Assert.True(after.GetProperty("nineBoxBands").GetProperty("custom").GetBoolean());

        var empty = UpdateBody(after);
        empty["nineBoxBands"] = new JsonObject { ["lowTop"] = 3, ["midTop"] = 3 };
        using var rejected = await admin.PutAsJsonAsync("/api/performance/settings", empty);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);

        var beyond = UpdateBody(after);
        beyond["nineBoxBands"] = new JsonObject { ["lowTop"] = 2, ["midTop"] = 5 };
        using var noTop = await admin.PutAsJsonAsync("/api/performance/settings", beyond);
        Assert.Equal(HttpStatusCode.BadRequest, noTop.StatusCode);
    }

    [Fact]
    public void Older_settings_entries_count_for_the_sections_their_values_changed()
    {
        Assert.Equal(["reviews"], SettingsSections.Of("""{"before":{"SelfAssessmentDueDays":14,"PlanningDeadlineOffsetDays":30},"after":{"SelfAssessmentDueDays":10,"PlanningDeadlineOffsetDays":30}}"""));
        Assert.Equal(["planning", "ai-and-data"], SettingsSections.Of("""{"before":{"PlanAlignmentPolicy":0,"AiAssistanceEnabled":true},"after":{"PlanAlignmentPolicy":1,"AiAssistanceEnabled":false}}"""));
        Assert.Equal(["conversations"], SettingsSections.Of("""{"sections":["conversations"],"before":{},"after":{}}"""));
        Assert.Equal(SettingsSections.CycleSettingsSections, SettingsSections.Of("""{"before":{"PeerInputDueDays":14},"after":{"PeerInputDueDays":14}}"""));
    }

    private static async Task<List<HttpResponseMessage>> WritesAsync(HttpClient client)
    {
        var id = Guid.NewGuid();
        return
        [
            await client.PutAsJsonAsync("/api/performance/settings", new { defaultMeasurementMethod = "NumericTarget", suggestedObjectiveCountMin = 3,
                suggestedObjectiveCountMax = 6, planningDeadlineOffsetDays = 30, planAlignmentPolicy = "AtLeastOneConnected", expectedVersion = 0 }),
            await client.PutAsJsonAsync("/api/performance/settings/rating-scale", new { levels = Array.Empty<object>(), expectedVersion = 0 }),
            await client.PostAsJsonAsync("/api/performance/settings/competencies", new { name = "Craft", description = "Care" }),
            await client.PutAsJsonAsync($"/api/performance/settings/competencies/{id}", new { expectedVersion = 0, name = "Craft", description = "Care" }),
            await client.PostAsJsonAsync($"/api/performance/settings/competencies/{id}/archive", new { expectedVersion = 0 }),
            await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/performance/settings/competencies/{id}") { Content = JsonContent.Create(new { expectedVersion = 0 }) }),
            await client.PostAsJsonAsync("/api/performance/settings/review-questions", new { text = "Why?", audience = "Person" }),
            await client.PutAsJsonAsync("/api/performance/settings/review-questions/order", new { audience = "Person", questionIds = Array.Empty<Guid>() }),
            await client.PutAsJsonAsync($"/api/performance/settings/review-questions/{id}", new { expectedVersion = 0, text = "Why?" }),
            await client.PostAsJsonAsync($"/api/performance/settings/review-questions/{id}/archive", new { expectedVersion = 0 }),
            await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/performance/settings/review-questions/{id}") { Content = JsonContent.Create(new { expectedVersion = 0 }) }),
            await client.PutAsJsonAsync("/api/performance/settings/notifications", new { expectedVersion = 0, modes = new Dictionary<string, string> { ["one-on-ones"] = "off" } }),
        ];
    }

    private static JsonObject UpdateBody(JsonElement settings)
    {
        var body = JsonNode.Parse(settings.GetRawText())!.AsObject();
        body["expectedVersion"] = settings.GetProperty("version").GetUInt32();
        body.Remove("version");
        body.Remove("nineBoxBands");
        return body;
    }

    private static async Task<JsonElement> SectionsAsync(HttpClient client) => await DataAsync(client, "/api/performance/settings/sections");

    private static async Task<JsonElement> ContextAsync(HttpClient client) => await DataAsync(client, "/api/performance/context");

    private static async Task<JsonElement> DataAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("data").Clone();
    }
}
