using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Lina (responsible reviewer) asks Nour (plan owner) for an update; Nour's own progress resolves it.</summary>
public sealed class UpdateRequestTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.Optional);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId, Guid PlanId,
        Guid ObjectiveId, Guid OtherObjectiveId, Guid Nour, Guid Lina, Guid DraftPlanId);

    private static async Task<World> ArrangeAsync()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var tenant = store.TenantId;
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30)).Activated();
        var nour = Guid.NewGuid();
        var lina = Guid.NewGuid();
        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        var participant = Participant.Create(tenant, cycle.Id, nour, "Nour", "Analyst", null, "Finance", lina, "Lina", false, Start);
        db.Participants.Add(participant);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, nour, "Nour", "Finance", lina, "Lina");
        db.EmployeePlans.Add(plan);
        var objective = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Close the books faster", null, null,
            Start, End, ObjectiveMeasurement.ManualPercentage(), 60m, null, null, Start, End);
        var other = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Automate reconciliations", null, null,
            Start, End, ObjectiveMeasurement.ManualPercentage(), 40m, null, null, Start, End);
        db.Objectives.AddRange(objective, other);
        plan.Submit(nour, Ready);
        plan.Approve(lina);

        var draftOwner = Guid.NewGuid();
        var draftParticipant = Participant.Create(tenant, cycle.Id, draftOwner, "Dina", "Analyst", null, "Finance", lina, "Lina", false, Start);
        db.Participants.Add(draftParticipant);
        var draft = EmployeePlan.Create(tenant, cycle.Id, draftParticipant.Id, draftOwner, "Dina", "Finance", lina, "Lina");
        db.EmployeePlans.Add(draft);
        await db.SaveChangesAsync();
        return new World(store, workforce, cycle.Id, plan.Id, objective.Id, other.Id, nour, lina, draft.Id);
    }

    private static PlanActorContext As(Guid employee) => new(employee, IsAdmin: false, CanReviewReports: true);

    private static Task<SharedKernel.Results.Result<UpdateRequestDto>> Request(World w, PerformanceDbContext db, Guid caller,
        Guid? objectiveId, string? note = null, Guid? planId = null)
        => new CreateUpdateRequestHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new CreateUpdateRequestCommand(w.CycleId, planId ?? w.PlanId, objectiveId, note, As(caller), "Lina"), default);

    private static Task<SharedKernel.Results.Result<ObjectiveProgressDto>> Progress(World w, PerformanceDbContext db, Guid caller, Guid objectiveId, decimal pct)
        => new SubmitProgressHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db), new TestEvidenceStore(Guid.NewGuid()), new PerformanceNotifications(db))
            .Handle(new SubmitProgressCommand(w.CycleId, objectiveId, new SubmitProgressRequest(pct, null, null, EY.HRPlatform.Performance.Domain.Progress.ObjectiveStatus.OnTrack, "Weekly update", false, null),
                new ProgressActorContext(caller, IsAdmin: false, CanReviewReports: true)), default);

    [Fact]
    public async Task Only_the_responsible_reviewer_requests_and_only_on_an_approved_plan()
    {
        var w = await ArrangeAsync();
        await using var db = w.Store.NewContext();

        Assert.Equal(PerformanceErrors.Codes.UpdateRequestForbidden, (await Request(w, db, Guid.NewGuid(), w.ObjectiveId)).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestForbidden, (await Request(w, db, w.Nour, w.ObjectiveId)).Error.Code);
        var noGrant = new PlanActorContext(w.Lina, IsAdmin: false, CanReviewReports: false);
        var deniedWithoutGrant = await new CreateUpdateRequestHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new CreateUpdateRequestCommand(w.CycleId, w.PlanId, w.ObjectiveId, null, noGrant, "Lina"), default);
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestForbidden, deniedWithoutGrant.Error.Code);
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestNotAllowed, (await Request(w, db, w.Lina, null, planId: w.DraftPlanId)).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestInvalid, (await Request(w, db, w.Lina, w.ObjectiveId, new string('x', 501))).Error.Code);

        var created = await Request(w, db, w.Lina, w.ObjectiveId, "Please add this week's numbers.");
        Assert.True(created.IsSuccess);
        Assert.Equal((UpdateRequestState.Open, "Close the books faster", "Lina"), (created.Value.State, created.Value.ObjectiveTitle, created.Value.RequestedByName));
        var notice = Assert.Single(await db.OutboxMessages.Where(m => m.Kind == PerformanceNotificationKind.UpdateRequested).ToListAsync());
        Assert.Equal(w.Nour, notice.RecipientEmployeeId);
        Assert.Equal(1, await db.AuditEntries.CountAsync(e => e.Action == PerformanceAuditActions.UpdateRequested));
    }

    [Fact]
    public async Task Repeating_a_request_returns_the_open_one()
    {
        var w = await ArrangeAsync();
        await using var db = w.Store.NewContext();
        var first = await Request(w, db, w.Lina, w.ObjectiveId);
        var again = await Request(w, db, w.Lina, w.ObjectiveId, "Another note");
        Assert.Equal(first.Value.Id, again.Value.Id);
        Assert.Equal(1, await db.UpdateRequests.CountAsync());
        // A different target is its own request.
        Assert.NotEqual(first.Value.Id, (await Request(w, db, w.Lina, null)).Value.Id);
    }

    [Fact]
    public async Task Later_progress_satisfies_objective_and_plan_requests_but_earlier_progress_does_not()
    {
        var w = await ArrangeAsync();
        await using var db = w.Store.NewContext();
        Assert.True((await Progress(w, db, w.Nour, w.OtherObjectiveId, 10m)).IsSuccess);
        var onObjective = await Request(w, db, w.Lina, w.ObjectiveId);
        var onPlan = await Request(w, db, w.Lina, null);
        var unrelated = await Request(w, db, w.Lina, w.OtherObjectiveId);

        // Progress before the request did not satisfy it; Lina may not record progress herself.
        Assert.All(await db.UpdateRequests.ToListAsync(), r => Assert.Equal(UpdateRequestState.Open, r.State));
        Assert.Equal(PerformanceErrors.Codes.ProgressUpdateForbidden, (await Progress(w, db, w.Lina, w.ObjectiveId, 50m)).Error.Code);

        Assert.True((await Progress(w, db, w.Nour, w.ObjectiveId, 30m)).IsSuccess);
        var states = await db.UpdateRequests.AsNoTracking().ToDictionaryAsync(r => r.Id, r => r);
        Assert.Equal(UpdateRequestState.Satisfied, states[onObjective.Value.Id].State);
        Assert.NotNull(states[onObjective.Value.Id].SatisfiedAt);
        Assert.Equal(UpdateRequestState.Satisfied, states[onPlan.Value.Id].State);
        Assert.Equal(UpdateRequestState.Open, states[unrelated.Value.Id].State);
        Assert.Equal(2, await db.AuditEntries.CountAsync(e => e.Action == PerformanceAuditActions.UpdateRequestSatisfied));
    }

    [Fact]
    public async Task The_reviewer_withdraws_and_cycle_close_records_the_rest_as_unresolved()
    {
        var w = await ArrangeAsync();
        await using var db = w.Store.NewContext();
        var withdrawn = await Request(w, db, w.Lina, w.ObjectiveId);
        var open = await Request(w, db, w.Lina, null);
        var handler = new WithdrawUpdateRequestHandler(db, new TestPerformanceAudit(db));
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestForbidden, (await handler.Handle(new(withdrawn.Value.Id, withdrawn.Value.Version, As(w.Nour)), default)).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestForbidden,
            (await handler.Handle(new(withdrawn.Value.Id, withdrawn.Value.Version, new PlanActorContext(w.Lina, IsAdmin: false, CanReviewReports: false)), default)).Error.Code);
        var stale = await handler.Handle(new(withdrawn.Value.Id, withdrawn.Value.Version + 1, As(w.Lina)), default);
        Assert.Equal("Performance.Stale", stale.Error.Code);
        Assert.Equal(UpdateRequestState.Open, (await db.UpdateRequests.AsNoTracking().SingleAsync(r => r.Id == withdrawn.Value.Id)).State);
        Assert.Equal(UpdateRequestState.Withdrawn, (await handler.Handle(new(withdrawn.Value.Id, withdrawn.Value.Version, As(w.Lina)), default)).Value.State);
        Assert.Equal(UpdateRequestState.Withdrawn, (await handler.Handle(new(withdrawn.Value.Id, 0, As(w.Lina)), default)).Value.State);

        // The year ends when the next one launches; requests still open end unresolved with it.
        var cycle = await db.Cycles.SingleAsync();
        cycle.Close();
        await EY.HRPlatform.Performance.Features.Plans.UpdateRequests.CloseOpenAsync(db, new TestPerformanceAudit(db), w.CycleId, DateTime.UtcNow, default);
        await db.SaveChangesAsync();
        Assert.Equal(UpdateRequestState.Unresolved, (await db.UpdateRequests.AsNoTracking().SingleAsync(r => r.Id == open.Value.Id)).State);
        Assert.Equal(UpdateRequestState.Withdrawn, (await db.UpdateRequests.AsNoTracking().SingleAsync(r => r.Id == withdrawn.Value.Id)).State);
    }

    [Fact]
    public async Task The_owner_and_reviewer_see_requests_others_do_not()
    {
        var w = await ArrangeAsync();
        await using var db = w.Store.NewContext();
        await Request(w, db, w.Lina, w.ObjectiveId);
        var list = new ListUpdateRequestsHandler(db);
        Assert.Single((await list.Handle(new(w.CycleId, w.PlanId, As(w.Nour)), default)).Value);
        Assert.Single((await list.Handle(new(w.CycleId, w.PlanId, As(w.Lina)), default)).Value);
        Assert.Equal(PerformanceErrors.Codes.UpdateRequestForbidden, (await list.Handle(new(w.CycleId, w.PlanId, As(Guid.NewGuid())), default)).Error.Code);
    }
}
