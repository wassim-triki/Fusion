using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests.TestHelpers;

/// <summary>
/// The slice 4 cast on one tenant, driven through HTTP: Amira (HR, Mariam's manager), Mariam (manages Aicha, Fares
/// and Tarek), and Leila and Khaled (colleagues outside the team). The cycle runs around today so launch-day rules hold.
/// </summary>
public sealed class ReviewWorld : IAsyncDisposable
{
    public PerformanceApiFactory Factory { get; } = new();
    public PerformanceCycle Cycle { get; private set; } = null!;
    public WorkforceSnapshot Amira { get; private set; } = null!;
    public WorkforceSnapshot Mariam { get; private set; } = null!;
    public WorkforceSnapshot Aicha { get; private set; } = null!;
    public WorkforceSnapshot Fares { get; private set; } = null!;
    public WorkforceSnapshot Tarek { get; private set; } = null!;
    public WorkforceSnapshot Leila { get; private set; } = null!;
    public WorkforceSnapshot Khaled { get; private set; } = null!;
    public static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private readonly Dictionary<Guid, HttpClient> _clients = [];

    public static async Task<ReviewWorld> CreateAsync()
    {
        var world = new ReviewWorld();
        await world.SeedAsync();
        return world;
    }

    private async Task SeedAsync()
    {
        var start = Today.AddDays(-200);
        Cycle = PerformanceCycle.CreateDraft(Factory.Store.TenantId, "FY2027", start, Today.AddDays(120), start.AddDays(30)).Activated();
        Amira = Factory.Core.Add("Amira Khelifi", orgUnitName: "People");
        Mariam = Factory.Core.Add("Mariam Gharbi", managerId: Amira.EmployeeId, orgUnitName: "Product A");
        Aicha = Factory.Core.Add("Aicha Ben Ali", managerId: Mariam.EmployeeId, orgUnitName: "Product A");
        Fares = Factory.Core.Add("Fares Jaziri", managerId: Mariam.EmployeeId, orgUnitName: "Product A");
        Tarek = Factory.Core.Add("Tarek Ayari", managerId: Mariam.EmployeeId, orgUnitName: "Product A");
        Leila = Factory.Core.Add("Leila Ben Salah", orgUnitName: "Product B");
        Khaled = Factory.Core.Add("Khaled Sassi", orgUnitName: "Consulting A");
        await using var db = Factory.Store.NewContext();
        db.Cycles.Add(Cycle);
        db.CycleSettings.Add(CycleSettings.CreateDefault(Factory.Store.TenantId));
        foreach (var (person, manager) in new[] { (Aicha, Mariam), (Fares, Mariam), (Tarek, Mariam), (Mariam, Amira) })
            db.Participants.Add(Participant.Create(Factory.Store.TenantId, Cycle.Id, person.EmployeeId, person.DisplayName, null, null, null,
                manager.EmployeeId, manager.DisplayName, false, start));
        await db.SaveChangesAsync();
    }

    /// <summary>Amira: round administration plus her own participation and team.</summary>
    public HttpClient Admin => ClientFor(Amira, admin: true);

    /// <summary>Anyone in the cast: participates, reviews their reports, administers nothing.</summary>
    public HttpClient As(WorkforceSnapshot person) => person == Amira ? Admin : ClientFor(person, admin: false);

    private HttpClient ClientFor(WorkforceSnapshot person, bool admin)
    {
        if (_clients.TryGetValue(person.EmployeeId, out var existing)) return existing;
        var grants = new List<EffectivePermissionGrant>
        {
            new(PerformancePermissions.CycleView, PermissionScopes.Self),
            new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
            new(PerformancePermissions.CycleView, PermissionScopes.DirectReports),
        };
        if (admin) grants.AddRange([new(PerformancePermissions.CycleManage, PermissionScopes.Tenant), new(PerformancePermissions.CycleView, PermissionScopes.Tenant),
            new(PerformancePermissions.SettingsManage, PermissionScopes.Tenant)]);
        var client = Factory.CreateAuthenticatedClient(employeeId: person.EmployeeId, permissions: grants);
        _clients[person.EmployeeId] = client;
        return client;
    }

    /// <summary>A Draft with every component on: two questions per audience from the seeded library.</summary>
    public async Task<JsonElement> CreateRoundAsync(string name = "Year-end review", bool peers = true, bool questions = true,
        bool potential = true, bool calibration = false, Guid[]? competencyIds = null)
    {
        var round = await Data(await Admin.PostAsJsonAsync($"/api/performance/cycles/{Cycle.Id}/review-rounds",
            new { name, periodStart = Cycle.StartDate, periodEnd = Today }));
        var library = await Data(await Admin.GetAsync("/api/performance/settings/review-questions"));
        var picks = library.EnumerateArray().GroupBy(q => q.GetProperty("audience").GetString())
            .SelectMany(g => g.Take(2)).Select(q => q.GetProperty("id").GetGuid()).ToArray();
        return await UpdateRoundAsync(round, peers: peers, questions: questions, potential: potential, calibration: calibration, questionIds: picks,
            competencyIds: competencyIds);
    }

    public async Task<JsonElement> UpdateRoundAsync(JsonElement round, bool? peers = null, bool? questions = null, bool? potential = null,
        bool calibration = false, Guid[]? questionIds = null, bool self = true, DateOnly? selfDue = null, DateOnly? managerDue = null,
        HttpStatusCode expect = HttpStatusCode.OK, Guid[]? competencyIds = null)
    {
        using var response = await Admin.PutAsJsonAsync($"/api/performance/review-rounds/{round.GetProperty("id").GetGuid()}", new
        {
            expectedVersion = round.GetProperty("version").GetUInt32(),
            name = round.GetProperty("name").GetString(),
            periodStart = round.GetProperty("periodStart").GetString(),
            periodEnd = round.GetProperty("periodEnd").GetString(),
            selfAssessmentEnabled = self,
            objectiveRatingsEnabled = true,
            calibrationEnabled = calibration,
            selfAssessmentDueDate = selfDue,
            managerAssessmentDueDate = managerDue,
            competencyIds = competencyIds ?? [],
            peerInputEnabled = peers,
            questionsEnabled = questions,
            potentialEnabled = potential,
            questionIds,
        });
        if (expect != HttpStatusCode.OK)
        {
            Assert.Equal(expect, response.StatusCode);
            return default;
        }
        return await Data(response);
    }

    public async Task<JsonElement> LaunchAsync(JsonElement round)
    {
        var id = round.GetProperty("id").GetGuid();
        var current = await Data(await Admin.GetAsync($"/api/performance/review-rounds/{id}"));
        return await Data(await Admin.PostAsJsonAsync($"/api/performance/review-rounds/{id}/launch",
            new { expectedVersion = current.GetProperty("version").GetUInt32() }));
    }

    /// <summary>The manager sets exactly who is asked about <paramref name="subject"/> (replacing Fusion's picks at launch).</summary>
    public async Task AskAsync(JsonElement round, WorkforceSnapshot subject, params WorkforceSnapshot[] peers)
    {
        var reviewId = ReviewOf(round, subject);
        uint version;
        Guid reviewer;
        await using (var db = Factory.Store.NewContext())
        {
            var review = db.PerformanceReviews.Single(r => r.Id == reviewId);
            (version, reviewer) = (review.Version, review.ReviewerEmployeeId);
        }
        var manager = new[] { Amira, Mariam }.Single(m => m.EmployeeId == reviewer);
        await Data(await As(manager).PutAsJsonAsync($"/api/performance/reviews/{reviewId}/peers",
            new { expectedVersion = version, employeeIds = peers.Select(p => p.EmployeeId).ToArray() }));
    }

    /// <summary>The review of <paramref name="subject"/> in the round, by id from the store.</summary>
    public Guid ReviewOf(JsonElement round, WorkforceSnapshot subject)
    {
        using var db = Factory.Store.NewContext();
        var roundId = round.GetProperty("id").GetGuid();
        return db.PerformanceReviews.Single(r => r.ReviewRoundId == roundId && r.SubjectEmployeeId == subject.EmployeeId).Id;
    }

    public static async Task<JsonElement> Data(HttpResponseMessage response)
    {
        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode} {response.RequestMessage?.RequestUri}: {body}");
            using var json = JsonDocument.Parse(body);
            return json.RootElement.GetProperty("data").Clone();
        }
    }

    /// <summary>A failed call's status and its typed failure code.</summary>
    public static async Task<(HttpStatusCode Status, string? Code, JsonElement Body)> Failure(HttpResponseMessage response)
    {
        using (response)
        {
            var body = await response.Content.ReadAsStringAsync();
            using var json = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
            var root = json.RootElement.Clone();
            string? code = null;
            if (root.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object && details.TryGetProperty("code", out var c))
                code = c.GetString();
            return (response.StatusCode, code ?? body, root);
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var client in _clients.Values) client.Dispose();
        await Factory.DisposeAsync();
    }
}
