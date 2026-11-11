using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>performance-praise over HTTP: Karim manages Nour and Sami; Amira administers HR; Leila is elsewhere.</summary>
public sealed class PraiseHttpTests
{
    private static readonly EffectivePermissionGrant[] Employee = [new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
    private static readonly EffectivePermissionGrant[] Admin =
        [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
         new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];

    private sealed record World(PerformanceApiFactory Factory, Guid Amira, Guid Karim, Guid Nour, Guid Sami, Guid Leila, Guid Ownership, Guid Retired)
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
        var sami = factory.Core.Add("Sami Kefi", managerId: karim).EmployeeId;
        var leila = factory.Core.Add("Leila Baccouche", managerId: amira).EmployeeId;
        var ownership = CompanyValue.Create(factory.Store.TenantId, "Ownership", 0);
        var retired = CompanyValue.Create(factory.Store.TenantId, "Retired value", 1);
        retired.Remove(DateTime.UtcNow);
        await using var db = factory.Store.NewContext();
        db.CompanyValues.AddRange(ownership, retired);
        await db.SaveChangesAsync();
        return new World(factory, amira, karim, nour, sami, leila, ownership.Id, retired.Id);
    }

    private static async Task<JsonElement> GiveAsync(World w, Guid author, Guid[] recipients, Guid? value = null, Guid? id = null,
        HttpStatusCode expected = HttpStatusCode.OK, string message = "You ran the cut-over with zero downtime")
    {
        var response = await w.As(author).PostAsJsonAsync("/api/performance/praise",
            new { id = id ?? Guid.NewGuid(), recipientEmployeeIds = recipients, valueId = value ?? w.Ownership, message });
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"{(int)response.StatusCode}: {text}");
        var json = JsonDocument.Parse(text).RootElement;
        return expected == HttpStatusCode.OK ? json.GetProperty("data") : json;
    }

    private static async Task<List<Guid>> FeedAsync(World w, Guid viewer, string query = "")
    {
        var page = (await w.As(viewer).GetFromJsonAsync<JsonElement>($"/api/performance/praise{query}")).GetProperty("data");
        return page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToList();
    }

    [Fact]
    public async Task Praise_is_public_and_recipients_and_their_managers_hear_once()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var praise = await GiveAsync(w, w.Leila, [w.Nour, w.Sami]);
        var id = praise.GetProperty("id").GetGuid();
        Assert.Equal("Ownership", praise.GetProperty("value").GetProperty("name").GetString());
        Assert.Contains(id, await FeedAsync(w, w.Amira));
        Assert.Contains(id, await FeedAsync(w, w.Karim, $"?employeeId={w.Nour}"));
        Assert.Contains(id, await FeedAsync(w, w.Nour, "?scope=forMe"));
        Assert.Contains(id, await FeedAsync(w, w.Leila, "?scope=byMe"));
        Assert.DoesNotContain(id, await FeedAsync(w, w.Karim, "?scope=byMe"));

        await using var db = w.Factory.Store.NewContext();
        var notifications = await db.Notifications.ToListAsync();
        Assert.Single(notifications, n => n.RecipientEmployeeId == w.Nour && n.Kind == PerformanceNotificationKind.PraiseReceived);
        Assert.Single(notifications, n => n.RecipientEmployeeId == w.Sami && n.Kind == PerformanceNotificationKind.PraiseReceived);
        var karims = Assert.Single(notifications, n => n.RecipientEmployeeId == w.Karim);
        Assert.Equal("Leila Baccouche praised Nour Trabelsi and Sami Kefi for Ownership", karims.EnglishTitle());
        Assert.Equal($"/performance/feedback?tab=praise#praise-{id}", karims.Href);
        Assert.DoesNotContain(notifications, n => n.RecipientEmployeeId == w.Leila);
        // Removing the value later keeps its name on praise already given.
        var value = await db.CompanyValues.SingleAsync(c => c.Id == w.Ownership);
        value.Remove(DateTime.UtcNow);
        await db.SaveChangesAsync();
        var after = (await w.As(w.Sami).GetFromJsonAsync<JsonElement>($"/api/performance/praise/{id}")).GetProperty("data").GetProperty("praise");
        Assert.Equal("Ownership", after.GetProperty("value").GetProperty("name").GetString());
    }

    [Fact]
    public async Task A_manager_who_is_also_praised_hears_once_and_an_author_manager_hears_nothing_extra()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        await GiveAsync(w, w.Leila, [w.Nour, w.Karim]);
        await GiveAsync(w, w.Karim, [w.Sami]);
        await using var db = w.Factory.Store.NewContext();
        var karims = await db.Notifications.Where(n => n.RecipientEmployeeId == w.Karim).ToListAsync();
        Assert.Single(karims);
        Assert.Equal(PerformanceNotificationKind.PraiseReceived, karims[0].Kind);
    }

    [Fact]
    public async Task Invalid_praise_is_refused()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        await GiveAsync(w, w.Nour, [w.Nour], expected: HttpStatusCode.BadRequest);
        await GiveAsync(w, w.Nour, [], expected: HttpStatusCode.BadRequest);
        await GiveAsync(w, w.Nour, Enumerable.Range(0, 11).Select(_ => Guid.NewGuid()).ToArray(), expected: HttpStatusCode.BadRequest);
        await GiveAsync(w, w.Nour, [w.Sami], w.Retired, expected: HttpStatusCode.BadRequest);
        await GiveAsync(w, w.Nour, [w.Sami], message: new string('x', 501), expected: HttpStatusCode.BadRequest);
        var id = Guid.NewGuid();
        await GiveAsync(w, w.Nour, [w.Sami], id: id);
        await GiveAsync(w, w.Nour, [w.Sami], id: id);
        await using var db = w.Factory.Store.NewContext();
        Assert.Equal(1, await db.Praise.CountAsync());
    }

    [Fact]
    public async Task Reactions_toggle_once_per_person_and_kind()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await GiveAsync(w, w.Leila, [w.Nour])).GetProperty("id").GetGuid();
        var nour = w.As(w.Nour);
        await nour.PutAsync($"/api/performance/praise/{id}/reactions/Celebrate", null);
        var twice = (await (await nour.PutAsync($"/api/performance/praise/{id}/reactions/Celebrate", null)).Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data");
        var celebrate = twice.GetProperty("reactions").EnumerateArray().Single(r => r.GetProperty("kind").GetString() == "Celebrate");
        Assert.Equal(1, celebrate.GetProperty("count").GetInt32());
        Assert.True(celebrate.GetProperty("mine").GetBoolean());
        Assert.Equal(4, twice.GetProperty("reactions").GetArrayLength());

        var asSami = (await w.As(w.Sami).GetFromJsonAsync<JsonElement>($"/api/performance/praise/{id}")).GetProperty("data").GetProperty("praise");
        Assert.False(asSami.GetProperty("reactions").EnumerateArray().Single(r => r.GetProperty("kind").GetString() == "Celebrate")
            .GetProperty("mine").GetBoolean());

        var removed = (await (await nour.DeleteAsync($"/api/performance/praise/{id}/reactions/Celebrate")).Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data");
        Assert.Equal(0, removed.GetProperty("reactions").EnumerateArray().Single(r => r.GetProperty("kind").GetString() == "Celebrate")
            .GetProperty("count").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await nour.PutAsync($"/api/performance/praise/{id}/reactions/Heart", null)).StatusCode);
    }

    [Fact]
    public async Task The_author_or_HR_deletes_and_deleted_praise_leaves_every_feed()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var mine = (await GiveAsync(w, w.Leila, [w.Nour])).GetProperty("id").GetGuid();
        var other = (await GiveAsync(w, w.Leila, [w.Sami])).GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.Forbidden, (await w.As(w.Nour).DeleteAsync($"/api/performance/praise/{mine}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Leila).DeleteAsync($"/api/performance/praise/{mine}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Amira, Admin).DeleteAsync($"/api/performance/praise/{other}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Amira, Admin).DeleteAsync($"/api/performance/praise/{other}")).StatusCode);

        Assert.Empty(await FeedAsync(w, w.Karim));
        Assert.Empty(await FeedAsync(w, w.Karim, $"?employeeId={w.Nour}"));
        var detail = (await w.As(w.Nour).GetFromJsonAsync<JsonElement>($"/api/performance/praise/{mine}")).GetProperty("data");
        Assert.True(detail.GetProperty("removed").GetBoolean());
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("praise").ValueKind);

        await using var db = w.Factory.Store.NewContext();
        var deletions = await db.AuditEntries.Where(e => e.Action == PerformanceAuditActions.PraiseDeleted).ToListAsync();
        Assert.Equal(2, deletions.Count);
    }

    [Fact]
    public async Task Every_entrant_reads_the_active_values_by_name()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var values = (await w.As(w.Nour).GetFromJsonAsync<JsonElement>("/api/performance/values")).GetProperty("data").EnumerateArray().ToList();
        var value = Assert.Single(values);
        Assert.Equal("Ownership", value.GetProperty("name").GetString());
        Assert.Equal(["id", "name"], value.EnumerateObject().Select(p => p.Name).Order().ToArray());
        var outsider = w.Factory.CreateAuthenticatedClient(employeeId: w.Nour, permissions: []);
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync("/api/performance/values")).StatusCode);
    }

    private static async Task<List<string>> ValueNamesAsync(HttpClient client)
        => (await client.GetFromJsonAsync<JsonElement>("/api/performance/values")).GetProperty("data").EnumerateArray()
            .Select(v => v.GetProperty("name").GetString()!).ToList();

    [Fact]
    public async Task A_new_company_starts_with_the_starter_values_and_praise_works_at_once()
    {
        await using var factory = new PerformanceApiFactory();
        var aicha = factory.Core.Add("Aicha Bouazizi").EmployeeId;
        var salah = factory.Core.Add("Salah Mansour").EmployeeId;
        var client = factory.CreateAuthenticatedClient(employeeId: aicha, permissions: Employee);
        var values = (await client.GetFromJsonAsync<JsonElement>("/api/performance/values")).GetProperty("data").EnumerateArray().ToList();
        Assert.Equal(CompanyValue.Starters, values.Select(v => v.GetProperty("name").GetString()).ToList());
        Assert.Equal(CompanyValue.Starters, await ValueNamesAsync(client));

        var response = await client.PostAsJsonAsync("/api/performance/praise",
            new { id = Guid.NewGuid(), recipientEmployeeIds = new[] { salah }, valueId = values[3].GetProperty("id").GetGuid(), message = "Covered my release" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var summary = (await client.GetFromJsonAsync<JsonElement>("/api/performance/praise/summary")).GetProperty("data");
        Assert.Equal(1, summary.GetProperty("thisWeek").GetInt32());
        Assert.Equal([0, 0, 0, 1], summary.GetProperty("values").EnumerateArray().Select(v => v.GetProperty("count").GetInt32()).ToArray());
    }

    [Fact]
    public async Task Only_settings_managers_change_the_values_and_a_company_that_removed_them_all_gets_none_back()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        EffectivePermissionGrant[] settings = [new(PerformancePermissions.SettingsView, PermissionScopes.Tenant),
            new(PerformancePermissions.SettingsManage, PermissionScopes.Tenant), new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self)];
        var hr = w.As(w.Amira, settings);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.As(w.Nour).PostAsJsonAsync("/api/performance/settings/values", new { name = "Craft" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await w.As(w.Nour).DeleteAsync($"/api/performance/settings/values/{w.Ownership}")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await hr.PostAsJsonAsync("/api/performance/settings/values", new { name = "Craft" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await hr.PostAsJsonAsync("/api/performance/settings/values", new { name = " craft " })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await hr.PutAsJsonAsync($"/api/performance/settings/values/{w.Ownership}", new { name = "Own the outcome" })).StatusCode);
        Assert.Equal(["Own the outcome", "Craft"], await ValueNamesAsync(w.As(w.Nour)));

        // Another company's settings manager can't reach these values.
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Amira, permissions: settings);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.PutAsJsonAsync($"/api/performance/settings/values/{w.Ownership}", new { name = "Taken" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.DeleteAsync($"/api/performance/settings/values/{w.Ownership}")).StatusCode);

        // A removed value's name comes back as the same value when added again.
        Assert.Equal(HttpStatusCode.OK, (await hr.PostAsJsonAsync("/api/performance/settings/values", new { name = "Retired value" })).StatusCode);
        Assert.Contains(w.Retired, (await w.As(w.Nour).GetFromJsonAsync<JsonElement>("/api/performance/values")).GetProperty("data")
            .EnumerateArray().Select(v => v.GetProperty("id").GetGuid()));

        var ids = (await hr.GetFromJsonAsync<JsonElement>("/api/performance/values")).GetProperty("data").EnumerateArray()
            .Select(v => v.GetProperty("id").GetGuid()).ToList();
        foreach (var id in ids)
            Assert.Equal(HttpStatusCode.OK, (await hr.DeleteAsync($"/api/performance/settings/values/{id}")).StatusCode);
        Assert.Empty(await ValueNamesAsync(w.As(w.Nour)));
    }

    [Fact]
    public async Task Praise_never_crosses_tenants()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var id = (await GiveAsync(w, w.Leila, [w.Nour])).GetProperty("id").GetGuid();
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Nour, permissions: Admin);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.GetAsync($"/api/performance/praise/{id}")).StatusCode);
        Assert.Empty((await foreign.GetFromJsonAsync<JsonElement>("/api/performance/praise")).GetProperty("data").GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task The_summary_counts_this_week_each_value_this_month_and_the_callers_own_praise()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        var first = await GiveAsync(w, w.Leila, [w.Nour]);
        await GiveAsync(w, w.Nour, [w.Sami]);
        await GiveAsync(w, w.Karim, [w.Sami]);

        var summary = (await w.As(w.Nour).GetFromJsonAsync<JsonElement>("/api/performance/praise/summary")).GetProperty("data");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        Assert.Equal(monday, DateOnly.Parse(summary.GetProperty("weekStart").GetString()!));
        Assert.Equal(3, summary.GetProperty("thisWeek").GetInt32());
        var value = Assert.Single(summary.GetProperty("values").EnumerateArray());
        Assert.Equal("Ownership", value.GetProperty("name").GetString());
        Assert.Equal(3, value.GetProperty("count").GetInt32());
        Assert.Equal(1, summary.GetProperty("received").GetInt32());
        Assert.Equal(1, summary.GetProperty("given").GetInt32());

        // Deleted praise leaves every count; another tenant counts nothing of this one's.
        Assert.Equal(HttpStatusCode.OK, (await w.As(w.Leila).DeleteAsync($"/api/performance/praise/{first.GetProperty("id").GetGuid()}")).StatusCode);
        var after = (await w.As(w.Nour).GetFromJsonAsync<JsonElement>("/api/performance/praise/summary")).GetProperty("data");
        Assert.Equal(2, after.GetProperty("values").EnumerateArray().Single().GetProperty("count").GetInt32());
        Assert.Equal(2, after.GetProperty("thisWeek").GetInt32());
        Assert.Equal(0, after.GetProperty("received").GetInt32());
        var foreign = w.Factory.CreateAuthenticatedClient(tenantId: Guid.NewGuid(), employeeId: w.Nour, permissions: Employee);
        var other = (await foreign.GetFromJsonAsync<JsonElement>("/api/performance/praise/summary")).GetProperty("data");
        Assert.Equal(0, other.GetProperty("thisWeek").GetInt32());
        Assert.All(other.GetProperty("values").EnumerateArray(), v => Assert.Equal(0, v.GetProperty("count").GetInt32()));
        Assert.DoesNotContain(other.GetProperty("values").EnumerateArray(), v => v.GetProperty("id").GetGuid() == w.Ownership);
    }

    [Fact]
    public async Task Quick_picks_are_teammates_then_reports_then_the_manager()
    {
        var w = await ArrangeAsync();
        await using var _ = w.Factory;
        async Task<List<Guid>> Near(Guid who) => (await w.As(who).GetFromJsonAsync<JsonElement>("/api/performance/people/directory/near"))
            .GetProperty("data").EnumerateArray().Select(p => p.GetProperty("employeeId").GetGuid()).ToList();
        Assert.Equal([w.Sami, w.Karim], await Near(w.Nour));
        var karims = await Near(w.Karim);
        Assert.Equal(4, karims.Count);
        Assert.Equal(w.Leila, karims[0]);
        Assert.Equal(new[] { w.Nour, w.Sami }.Order(), karims[1..3].Order());
        Assert.Equal(w.Amira, karims[3]);
        var outsider = w.Factory.CreateAuthenticatedClient(employeeId: w.Nour, permissions: []);
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync("/api/performance/people/directory/near")).StatusCode);
    }
}
