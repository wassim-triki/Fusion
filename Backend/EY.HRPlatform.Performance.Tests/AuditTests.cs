using EY.HRPlatform.Performance.Infrastructure.Notifications;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Features.StrategicDirection;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

public sealed class AuditTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);
    private static readonly MeasurementInput Manual = new(MeasurementMethod.ManualPercentage, null, null, null, null);

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task Audit_entries_cannot_be_modified_or_deleted_with_either_save_path(bool delete, bool synchronous)
    {
        var store = TestStore.ForNewTenant();
        var resource = Guid.NewGuid();
        await using (var db = store.NewContext())
        {
            new TestPerformanceAudit(db).Record(store.TenantId, "Objective", resource, null,
                PerformanceAuditActions.ObjectivePublished, new { before = "Draft", after = "Published" });
            await db.SaveChangesAsync();
        }
        await using (var db = store.NewContext())
        {
            var entry = await db.AuditEntries.SingleAsync();
            if (delete) db.AuditEntries.Remove(entry);
            else db.Entry(entry).Property(e => e.Action).CurrentValue = "Altered";
            if (synchronous) Assert.Throws<InvalidOperationException>(() => db.SaveChanges());
            else await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        }
        await using var verify = store.NewContext();
        Assert.Equal(PerformanceAuditActions.ObjectivePublished, (await verify.AuditEntries.SingleAsync()).Action);
    }

    [Fact]
    public async Task Audit_query_and_write_boundaries_are_tenant_scoped_and_fail_closed()
    {
        var store = TestStore.ForNewTenant();
        await using (var db = store.NewContext())
        {
            new TestPerformanceAudit(db).Record(store.TenantId, "Cycle", Guid.NewGuid(), null,
                PerformanceAuditActions.CycleDraftDeleted, new { before = "Draft", after = (string?)null });
            await db.SaveChangesAsync();
        }
        await using (var other = store.NewContext(TestTenantContext.WithTenant(Guid.NewGuid())))
            Assert.Empty(await other.AuditEntries.ToListAsync());
        await using (var unresolved = store.NewContext(TestTenantContext.Unresolved()))
            Assert.Empty(await unresolved.AuditEntries.ToListAsync());
        await using var writer = store.NewContext();
        new TestPerformanceAudit(writer).Record(Guid.NewGuid(), "Cycle", Guid.NewGuid(), null,
            PerformanceAuditActions.CycleDraftDeleted, new { before = "Draft", after = (string?)null });
        await Assert.ThrowsAsync<EY.HRPlatform.Performance.Infrastructure.Persistence.Interceptors.TenantAccessDeniedException>(() => writer.SaveChangesAsync());
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("publish")]
    public async Task Every_company_publication_path_records_one_entry(string path)
    {
        var store = TestStore.ForNewTenant();
        var owner = Guid.NewGuid();
        await using var db = store.NewContext();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "Audit", Start, End, Start.AddDays(30));
        var objective = Objective.CreateStrategic(store.TenantId, cycle.Id, "Direction", null, owner,
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        db.Cycles.Add(cycle);
        if (path != "create") db.Objectives.Add(objective);
        await db.SaveChangesAsync();
        var audit = new TestPerformanceAudit(db);
        if (path == "create")
        {
            var result = await new CreateStrategicObjectiveHandler(db, store.Tenant, audit)
                .Handle(new(cycle.Id, new("Direction", null, owner, Start, End, Manual, Publish: true)), default);
            Assert.True(result.IsSuccess);
        }
        else if (path == "update")
            Assert.True((await new UpdateStrategicObjectiveHandler(db, store.Tenant, audit)
                .Handle(new(cycle.Id, objective.Id, new("Updated", null, owner, Start, End, Manual, Publish: true)), default)).IsSuccess);
        else
        {
            var handler = new PublishStrategicObjectiveHandler(db, audit);
            Assert.True((await handler.Handle(new(cycle.Id, objective.Id), default)).IsSuccess);
            Assert.True((await handler.Handle(new(cycle.Id, objective.Id), default)).IsSuccess);
        }
        var entry = Assert.Single(await db.AuditEntries.AsNoTracking().ToListAsync());
        await AuditAssertions.RecordedAsync(db, PerformanceAuditActions.ObjectivePublished, entry.ResourceId, cycle.Id);
    }

    [Fact]
    public async Task Settings_audit_preserves_before_and_after_and_skips_an_unchanged_save()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var settings = CycleSettings.CreateDefault(store.TenantId);
        db.CycleSettings.Add(settings);
        await db.SaveChangesAsync();
        var request = new UpdateCycleSettingsRequest(settings.DefaultMeasurementMethod, 2, 5, 45, PlanAlignmentPolicy.Optional)
        {
            EvidenceRetentionMonths = 18,
            ExpectedVersion = settings.Version,
        };
        var handler = new UpdateCycleSettingsHandler(db, store.Tenant, new TestPerformanceAudit(db));
        var first = await handler.Handle(new(request), default);
        Assert.True(first.IsSuccess);
        Assert.True((await handler.Handle(new(request with { ExpectedVersion = first.Value.Version }), default)).IsSuccess);
        var entry = Assert.Single(await db.AuditEntries.AsNoTracking().ToListAsync());
        await AuditAssertions.RecordedAsync(db, PerformanceAuditActions.SettingsChanged, settings.Id, null);
        using var summary = JsonDocument.Parse(entry.Summary);
        Assert.Equal(30, summary.RootElement.GetProperty("before").GetProperty("PlanningDeadlineOffsetDays").GetInt32());
        Assert.Equal(45, summary.RootElement.GetProperty("after").GetProperty("PlanningDeadlineOffsetDays").GetInt32());
        Assert.Equal(36, summary.RootElement.GetProperty("before").GetProperty("EvidenceRetentionMonths").GetInt32());
        Assert.Equal(18, summary.RootElement.GetProperty("after").GetProperty("EvidenceRetentionMonths").GetInt32());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Correction_and_milestone_reopen_record_the_changed_fact(bool milestone)
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var owner = workforce.Add("Owner").EmployeeId;
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "Progress", Start, End, Start.AddDays(30)).Activated();
        var step = ObjectiveMilestone.Create(store.TenantId, "Deliver", 100m, null);
        var measurement = milestone ? ObjectiveMeasurement.WeightedMilestones([step]) : ObjectiveMeasurement.ManualPercentage();
        var objective = Objective.CreateStrategic(store.TenantId, cycle.Id, "Direction", null, owner, Start, End, measurement, Start, End);
        objective.Publish();
        if (milestone) objective.ApplyMilestones([(step.Id, true)]);
        else objective.ApplyManualPercentage(60m);
        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle); db.Objectives.Add(objective); await db.SaveChangesAsync();
        }
        await using (var db = store.NewContext())
        {
            var request = new SubmitProgressRequest(milestone ? null : 40m, null, milestone ? [new MilestoneChangeInput(step.Id, false)] : null,
                EY.HRPlatform.Performance.Domain.Progress.ObjectiveStatus.OnTrack, "Corrected the recorded result", !milestone, null);
            var result = await new SubmitProgressHandler(db, workforce, store.Tenant, new TestPerformanceAudit(db), new TestEvidenceStore(Guid.NewGuid()), new PerformanceNotifications(db))
                .Handle(new(cycle.Id, objective.Id, request, new(owner, false, false)), default);
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        }
        await using var verify = store.NewContext();
        var entry = Assert.Single(await verify.AuditEntries.ToListAsync());
        await AuditAssertions.RecordedAsync(verify, milestone ? PerformanceAuditActions.MilestoneReopened : PerformanceAuditActions.ProgressCorrected, objective.Id, cycle.Id);
        using var summary = JsonDocument.Parse(entry.Summary);
        if (milestone)
        {
            Assert.True(summary.RootElement.GetProperty("before").GetProperty("milestoneCompleted").GetBoolean());
            Assert.False(summary.RootElement.GetProperty("after").GetProperty("milestoneCompleted").GetBoolean());
        }
        else
        {
            Assert.Equal(60m, summary.RootElement.GetProperty("before").GetProperty("CurrentPercentage").GetDecimal());
            Assert.Equal(40m, summary.RootElement.GetProperty("after").GetProperty("CurrentPercentage").GetDecimal());
        }
        Assert.Equal((await verify.ProgressUpdates.SingleAsync()).Id.ToString(), summary.RootElement.GetProperty("updateId").GetString());
    }

    [Fact]
    public async Task Http_archive_records_authenticated_actor_and_request_correlation()
    {
        await using var factory = new PerformanceApiFactory();
        var subject = Guid.NewGuid(); var employee = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(factory.Store.TenantId, "Audit", Start, End, Start.AddDays(30));
        var objective = Objective.CreateStrategic(factory.Store.TenantId, cycle.Id, "Direction", null, employee,
            Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        objective.Publish();
        await using (var db = factory.Store.NewContext()) { db.Cycles.Add(cycle); db.Objectives.Add(objective); await db.SaveChangesAsync(); }
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", PerformanceTestJwt.Issue(factory.Store.TenantId,
            employee, [new(PerformancePermissions.CycleView, PermissionScopes.Tenant), new(PerformancePermissions.StrategyPublish, PermissionScopes.Tenant)],
            [ModuleEntitlements.Performance], subject));
        client.DefaultRequestHeaders.Add("X-Correlation-Id", "audit-http-request");
        using var response = await client.PostAsJsonAsync($"/api/performance/cycles/{cycle.Id}/strategy/{objective.Id}/archive", new { expectedVersion = objective.Version });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var verify = factory.Store.NewContext();
        var entry = Assert.Single(await verify.AuditEntries.ToListAsync());
        Assert.Equal(subject.ToString(), entry.ActorSubject);
        Assert.Equal(employee, entry.ActorEmployeeId);
        Assert.Equal("audit-http-request", entry.CorrelationId);
        Assert.Equal(objective.Id, entry.ResourceId);
        Assert.Equal(cycle.Id, entry.CycleId);
        Assert.Equal(PerformanceAuditActions.ObjectiveArchived, entry.Action);
    }

    [Fact]
    public async Task Missing_actor_cannot_stage_an_audit_and_missing_correlation_uses_the_request_trace()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var context = new DefaultHttpContext { TraceIdentifier = "trace-fallback" };
        var audit = new PerformanceAudit(db, new HttpContextAccessor { HttpContext = context });
        Assert.Throws<InvalidOperationException>(() => audit.Record(store.TenantId, "Cycle", Guid.NewGuid(), null,
            PerformanceAuditActions.CycleActivated, new { before = "Draft", after = "Active" }));
        Assert.Empty(db.AuditEntries.Local);
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "authenticated-subject")], "test"));
        audit.Record(store.TenantId, "Cycle", Guid.NewGuid(), null, PerformanceAuditActions.CycleActivated,
            new { before = "Draft", after = "Active" });
        Assert.Equal("trace-fallback", Assert.Single(db.AuditEntries.Local).CorrelationId);
    }
}
