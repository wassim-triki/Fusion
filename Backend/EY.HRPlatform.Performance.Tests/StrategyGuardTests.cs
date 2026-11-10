using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Features.StrategicDirection;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;

namespace EY.HRPlatform.Performance.Tests;

public sealed class StrategyGuardTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);
    private static readonly MeasurementInput Measurement = new(MeasurementMethod.ManualPercentage, null, null, null, null);

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("publish")]
    [InlineData("delete")]
    public async Task Every_strategy_write_rejects_closed_cycle(string operation)
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        cycle.Activate(ActivationSnapshot.Capture(store.TenantId, cycle.Id, "FY2026", Start, End, Start.AddDays(30), Start, 1, "{}", "{}", "[]", "[]"));
        cycle.Close();
        var objective = Objective.CreateStrategic(store.TenantId, cycle.Id, "Direction", null, Guid.NewGuid(), Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        db.Cycles.Add(cycle);
        db.Objectives.Add(objective);
        await db.SaveChangesAsync();
        var error = operation switch
        {
            "create" => (await new CreateStrategicObjectiveHandler(db, store.Tenant, new TestPerformanceAudit(db)).Handle(new(cycle.Id, new("New", null, objective.AccountablePersonId, Start, End, Measurement)), default)).Error,
            "update" => (await new UpdateStrategicObjectiveHandler(db, store.Tenant, new TestPerformanceAudit(db)).Handle(new(cycle.Id, objective.Id, new("Changed", null, objective.AccountablePersonId, Start, End, Measurement)), default)).Error,
            "publish" => (await new PublishStrategicObjectiveHandler(db, new TestPerformanceAudit(db)).Handle(new(cycle.Id, objective.Id), default)).Error,
            _ => (await new DeleteStrategicObjectiveHandler(db).Handle(new(cycle.Id, objective.Id), default)).Error,
        };
        Assert.Equal("Cycle.Closed", error.Code);
    }

    [Fact]
    public async Task Strategy_delete_rejects_aligned_children()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        var owner = Guid.NewGuid();
        var parent = Objective.CreateStrategic(store.TenantId, cycle.Id, "Direction", null, owner, Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
        var child = Objective.CreateOrganizational(store.TenantId, cycle.Id, Guid.NewGuid(), "Team", "Private draft", null, owner, parent.Id, Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), Start, End, Start, End);
        db.Cycles.Add(cycle);
        db.Objectives.AddRange(parent, child);
        await db.SaveChangesAsync();
        var result = await new DeleteStrategicObjectiveHandler(db).Handle(new(cycle.Id, parent.Id), default);
        Assert.Equal("StrategicObjective.HasChildren", result.Error.Code);
    }

    [Theory]
    [InlineData("update")]
    [InlineData("publish")]
    [InlineData("delete")]
    public async Task Strategy_routes_cannot_mutate_a_team_objective(string operation)
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        var objective = Objective.CreateOrganizational(store.TenantId, cycle.Id, Guid.NewGuid(), "Team", "Private draft", null, Guid.NewGuid(), null, Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), null, null, Start, End);
        db.Cycles.Add(cycle);
        db.Objectives.Add(objective);
        await db.SaveChangesAsync();
        var error = operation switch
        {
            "update" => (await new UpdateStrategicObjectiveHandler(db, store.Tenant, new TestPerformanceAudit(db)).Handle(new(cycle.Id, objective.Id, new("Changed", null, objective.AccountablePersonId, Start, End, Measurement)), default)).Error,
            "publish" => (await new PublishStrategicObjectiveHandler(db, new TestPerformanceAudit(db)).Handle(new(cycle.Id, objective.Id), default)).Error,
            _ => (await new DeleteStrategicObjectiveHandler(db).Handle(new(cycle.Id, objective.Id), default)).Error,
        };
        Assert.Equal("StrategicObjective.NotFound", error.Code);
        Assert.Equal(ObjectiveLifecycleState.Draft, objective.State);
        Assert.Equal("Private draft", objective.Title);
    }

    [Fact]
    public async Task Create_and_publish_returns_invalid_state_for_incomplete_milestone_weights()
    {
        var store = TestStore.ForNewTenant();
        await using var db = store.NewContext();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", Start, End, Start.AddDays(30));
        db.Cycles.Add(cycle);
        await db.SaveChangesAsync();
        var measurement = new MeasurementInput(MeasurementMethod.WeightedMilestones, null, null, null,
            [new MilestoneInput("Deliver", 40m, null)]);
        var result = await new CreateStrategicObjectiveHandler(db, store.Tenant, new TestPerformanceAudit(db)).Handle(
            new(cycle.Id, new("Direction", null, Guid.NewGuid(), Start, End, measurement, Publish: true)), default);
        Assert.Equal("StrategicObjective.NotPublishable", result.Error.Code);
        Assert.Empty(db.Objectives);
    }
}
