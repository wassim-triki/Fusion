using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Workspace destinations come from capabilities plus recorded responsibility, never persona.</summary>
public sealed class WorkspaceContextHttpTests
{
    private static readonly DateOnly Start = new(2026, 9, 1);

    private sealed record Arranged(PerformanceApiFactory Factory, Guid Active, Guid ClosedWithNour, Guid ClosedOther, Guid Draft, Guid Nour, Guid Lina, Guid Stranger);

    private static async Task<Arranged> ArrangeAsync()
    {
        var factory = new PerformanceApiFactory();
        var tenant = factory.Store.TenantId;
        var nour = Guid.NewGuid();
        var lina = Guid.NewGuid();
        var stranger = Guid.NewGuid();

        var active = PerformanceCycle.CreateDraft(tenant, "FY2027", Start, Start.AddYears(1), Start.AddDays(30)).Activated();
        var closedWithNour = PerformanceCycle.CreateDraft(tenant, "FY2026", Start.AddYears(-1), Start.AddDays(-1), Start.AddYears(-1).AddDays(30)).Activated();
        closedWithNour.Close();
        var closedOther = PerformanceCycle.CreateDraft(tenant, "FY2025", Start.AddYears(-2), Start.AddYears(-1).AddDays(-1), Start.AddYears(-2).AddDays(30)).Activated();
        closedOther.Close();
        var draft = PerformanceCycle.CreateDraft(tenant, "FY2028", Start.AddYears(1), Start.AddYears(2), Start.AddYears(1).AddDays(30));

        await using var db = factory.Store.NewContext();
        db.Cycles.AddRange(active, closedWithNour, closedOther, draft);
        db.Participants.AddRange(
            Participant.Create(tenant, active.Id, nour, "Nour", null, null, null, lina, "Lina", false, Start),
            Participant.Create(tenant, closedWithNour.Id, nour, "Nour", null, null, null, lina, "Lina", false, Start.AddYears(-1)));
        await db.SaveChangesAsync();
        return new Arranged(factory, active.Id, closedWithNour.Id, closedOther.Id, draft.Id, nour, lina, stranger);
    }

    private static readonly EffectivePermissionGrant[] Employee =
    [
        new(PerformancePermissions.CycleView, PermissionScopes.Self),
        new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
    ];
    private static readonly EffectivePermissionGrant[] Manager =
    [
        new(PerformancePermissions.CycleView, PermissionScopes.DirectReports),
        new(PerformancePermissions.ObjectiveSelfManage, PermissionScopes.Self),
    ];
    private static readonly EffectivePermissionGrant[] Admin =
    [
        new(PerformancePermissions.CycleView, PermissionScopes.Tenant),
        new(PerformancePermissions.CycleManage, PermissionScopes.Tenant),
    ];

    private static async Task<JsonElement> ContextAsync(Arranged f, Guid? employee, IEnumerable<EffectivePermissionGrant> grants, Guid? cycleId = null)
    {
        using var client = f.Factory.CreateAuthenticatedClient(employeeId: employee, permissions: grants);
        using var response = await client.GetAsync("/api/performance/context" + (cycleId is null ? "" : $"?cycleId={cycleId}"));
        Assert.Equal(200, (int)response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    private static bool Dest(JsonElement context, string name) => context.GetProperty("destinations").GetProperty(name).GetBoolean();
    private static IEnumerable<string> CycleNames(JsonElement context)
        => context.GetProperty("cycles").EnumerateArray().Select(c => c.GetProperty("name").GetString()!);

    [Fact]
    public async Task A_participant_gets_my_plan_but_no_team_or_administration()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, f.Nour, Employee);

        Assert.Equal("FY2027", context.GetProperty("selected").GetProperty("name").GetString());
        Assert.True(Dest(context, "myPlan"));
        Assert.False(Dest(context, "team"));
        Assert.False(context.GetProperty("capabilities").GetProperty("canViewOrgDirection").GetBoolean());
        Assert.False(context.GetProperty("capabilities").GetProperty("canChooseOrganizationScope").GetBoolean());
        // Active plus the Closed cycle she took part in; never Drafts or unrelated history.
        Assert.Equal(["FY2027", "FY2026"], CycleNames(context));
    }

    [Fact]
    public async Task The_recorded_reviewer_gets_team_performance()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, f.Lina, Manager);

        Assert.True(Dest(context, "team"));
        Assert.False(Dest(context, "myPlan"));
        Assert.True(context.GetProperty("capabilities").GetProperty("canViewOrgDirection").GetBoolean());
        Assert.False(context.GetProperty("capabilities").GetProperty("canChooseOrganizationScope").GetBoolean());
    }

    [Fact]
    public async Task A_direct_reports_grant_without_recorded_responsibility_gets_no_team()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, f.Stranger, Manager);

        Assert.False(Dest(context, "team"));
        Assert.False(Dest(context, "myPlan"));
        Assert.Equal(["FY2027"], CycleNames(context));
    }

    [Fact]
    public async Task An_administrator_sees_every_cycle_and_administration()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, null, Admin);

        Assert.True(Dest(context, "settings"));
        Assert.True(context.GetProperty("capabilities").GetProperty("canChooseOrganizationScope").GetBoolean());
        Assert.False(Dest(context, "myPlan"));
        Assert.Equal(["FY2027", "FY2028", "FY2026", "FY2025"], CycleNames(context));
    }

    [Fact]
    public async Task Calibration_capability_is_exposed_independently_of_round_administration()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var calibrationOnly = await ContextAsync(f, null,
        [
            new(PerformancePermissions.CycleView, PermissionScopes.Tenant),
            new(PerformancePermissions.ReviewCalibrate, PermissionScopes.Tenant),
        ]);

        var capabilities = calibrationOnly.GetProperty("capabilities");
        Assert.True(capabilities.GetProperty("canCalibrate").GetBoolean());
        Assert.False(capabilities.GetProperty("administers").GetBoolean());
    }

    [Fact]
    public async Task Tenant_cycle_reader_can_choose_organization_scope_without_administering()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, null,
        [
            new(PerformancePermissions.CycleView, PermissionScopes.Tenant),
        ]);

        Assert.True(context.GetProperty("capabilities").GetProperty("canChooseOrganizationScope").GetBoolean());
        Assert.False(context.GetProperty("capabilities").GetProperty("administers").GetBoolean());
    }

    [Fact]
    public async Task Mixed_responsibilities_compose_in_one_context()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, f.Lina, [.. Manager, .. Admin]);

        Assert.True(Dest(context, "team"));
    }

    [Fact]
    public async Task Selecting_a_closed_cycle_composes_that_cycle()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var context = await ContextAsync(f, f.Nour, Employee, f.ClosedWithNour);

        Assert.Equal("Closed", context.GetProperty("selected").GetProperty("state").GetString());
        Assert.True(Dest(context, "myPlan"));
        Assert.Equal(JsonValueKind.Null, context.GetProperty("phase").ValueKind);
    }

    [Fact]
    public async Task A_cycle_the_caller_may_not_see_is_not_found()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        using var client = f.Factory.CreateAuthenticatedClient(employeeId: f.Nour, permissions: Employee);

        using var unrelated = await client.GetAsync($"/api/performance/context?cycleId={f.ClosedOther}");
        using var draft = await client.GetAsync($"/api/performance/context?cycleId={f.Draft}");
        using var foreign = await client.GetAsync($"/api/performance/context?cycleId={Guid.NewGuid()}");

        Assert.Equal(404, (int)unrelated.StatusCode);
        Assert.Equal(404, (int)draft.StatusCode);
        Assert.Equal(404, (int)foreign.StatusCode);
    }

    [Fact]
    public async Task Reviews_destination_uses_recorded_review_relationship_and_cycle_administration()
    {
        var f = await ArrangeAsync();
        await using var _ = f.Factory;
        var reviewerId = Guid.NewGuid();
        var subjectId = Guid.NewGuid();
        var participant = Participant.Create(f.Factory.Store.TenantId, f.Active, subjectId, "Review subject", null, null, null,
            reviewerId, "Review reviewer", false, Start);
        PerformanceCycle cycle;
        await using (var lookup = f.Factory.Store.NewContext()) cycle = await lookup.Cycles.SingleAsync(c => c.Id == f.Active);
        var round = ReviewRound.CreateDraft(f.Factory.Store.TenantId, cycle, "Mid-year", Start, Start.AddYears(1), true, true, false);
        var roundSubject = ReviewRoundSubject.Create(f.Factory.Store.TenantId, round.Id, participant, reviewerId, "Review reviewer");
        var scale = RatingScale.CreateDefault(f.Factory.Store.TenantId);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var review = PerformanceReview.Open(f.Factory.Store.TenantId, round, roundSubject, version.Id,
            System.Text.Json.JsonSerializer.Serialize(RatingScaleDefaults.Levels), DateTime.UtcNow);
        round.Launch("{}", version.Id, DateTime.UtcNow);
        await using (var db = f.Factory.Store.NewContext())
        {
            db.Participants.Add(participant);
            db.RatingScales.Add(scale);
            db.RatingScaleVersions.Add(version);
            db.ReviewRounds.Add(round);
            db.ReviewRoundSubjects.Add(roundSubject);
            db.PerformanceReviews.Add(review);
            await db.SaveChangesAsync();
        }

        var subjectContext = await ContextAsync(f, subjectId, Employee, f.Active);
        var reviewerContext = await ContextAsync(f, reviewerId, Manager, f.Active);
        var strangerContext = await ContextAsync(f, f.Stranger, Manager, f.Active);
        var adminContext = await ContextAsync(f, null, Admin, f.Active);
        Assert.True(Dest(subjectContext, "reviews"));
        Assert.True(Dest(reviewerContext, "reviews"));
        Assert.False(Dest(strangerContext, "reviews"));
        Assert.True(Dest(adminContext, "reviews"));
    }
}
