using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Progress;
using EY.HRPlatform.Performance.Features.Work;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// D-05/D-10: one check-in per update carrying the owner's status, the reason for a risky status, and the
/// responsible reviewer's attention item, notification and acknowledgement. Nour owns the plan; Lina reviews it.
/// </summary>
public sealed class ObjectiveStatusTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);
    private static readonly PlanSubmissionFacts Ready = new(2, true, 100m, true, false, PlanAlignmentPolicy.Optional);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId, Guid PlanId,
        Guid ManualId, Guid MilestonesId, Guid[] Milestones, Guid Nour, Guid Lina);

    private static async Task<World> ArrangeAsync()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var tenant = store.TenantId;
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30)).Activated();
        var nour = workforce.Add("Nour Trabelsi").EmployeeId;
        var lina = workforce.Add("Lina Haddad").EmployeeId;
        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        var participant = Participant.Create(tenant, cycle.Id, nour, "Nour Trabelsi", "Engineer", null, "Platform", lina, "Lina Haddad", false, Start);
        db.Participants.Add(participant);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, nour, "Nour Trabelsi", "Platform", lina, "Lina Haddad");
        db.EmployeePlans.Add(plan);
        var manual = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Integrate the vendor API", null, null,
            Start, End, ObjectiveMeasurement.ManualPercentage(), 50m, null, null, Start, End);
        var steps = new[]
        {
            ObjectiveMilestone.Create(tenant, "Sandbox", 40m, null),
            ObjectiveMilestone.Create(tenant, "Refunds", 30m, null),
            ObjectiveMilestone.Create(tenant, "Cut-over", 30m, null),
        };
        var milestones = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Ship the gateway", null, null,
            Start, End, ObjectiveMeasurement.WeightedMilestones(steps), 50m, null, null, Start, End);
        db.Objectives.AddRange(manual, milestones);
        plan.Submit(nour, Ready);
        plan.Approve(lina);
        await db.SaveChangesAsync();
        return new World(store, workforce, cycle.Id, plan.Id, manual.Id, milestones.Id,
            milestones.Measurement!.Milestones.Select(m => m.Id).ToArray(), nour, lina);
    }

    private static SubmitProgressRequest CheckIn(decimal? pct = null, ObjectiveStatus? status = ObjectiveStatus.OnTrack,
        string? note = null, IReadOnlyList<MilestoneChangeInput>? milestones = null)
        => new(pct, null, milestones, status, note, false, null);

    private static async Task<Result<ObjectiveProgressDto>> SubmitAsync(World w, Guid objectiveId, SubmitProgressRequest request, Guid? caller = null)
    {
        await using var db = w.Store.NewContext();
        var version = (await db.Objectives.AsNoTracking().SingleAsync(o => o.Id == objectiveId)).Version;
        return await new SubmitProgressHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db),
                new TestEvidenceStore(Guid.NewGuid()), new PerformanceNotifications(db))
            .Handle(new SubmitProgressCommand(w.CycleId, objectiveId, request with { ExpectedVersion = version },
                new ProgressActorContext(caller ?? w.Nour, IsAdmin: false, CanReviewReports: true)), default);
    }

    private static async Task<Result<GoalDetailDto>> AcknowledgeAsync(World w, Guid caller, bool canReview = true, bool admin = false, Guid? objectiveId = null)
    {
        await using var db = w.Store.NewContext();
        var id = objectiveId ?? w.ManualId;
        var version = (await db.Objectives.AsNoTracking().SingleAsync(o => o.Id == id)).Version;
        return await new AcknowledgeObjectiveStatusHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new AcknowledgeObjectiveStatusCommand(w.CycleId, id, new GoalActorContext(caller, admin, false, canReview, false), version), default);
    }

    private static async Task<IReadOnlyList<FusionWorkItemDto>> WorkAsync(World w, Guid employee)
    {
        await using var db = w.Store.NewContext();
        var result = await new GetWorkItemsHandler(db).Handle(new GetWorkItemsQuery(new WorkActor(employee, Guid.NewGuid(), true, true, false, false)), default);
        return result.Value;
    }

    private static async Task<List<PerformanceNotification>> NotificationsAsync(World w, PerformanceNotificationKind kind)
    {
        await using var db = w.Store.NewContext();
        return await db.Notifications.AsNoTracking().Where(n => n.Kind == kind).ToListAsync();
    }

    // ── Check-ins (2.1) ───────────────────────────────────────────────────

    [Fact]
    public async Task Several_milestones_are_one_check_in()
    {
        var w = await ArrangeAsync();
        var result = await SubmitAsync(w, w.MilestonesId, CheckIn(milestones:
            [new(w.Milestones[0], true), new(w.Milestones[1], true)]));
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(70m, result.Value.DerivedProgress);
        var entry = Assert.Single(result.Value.History);
        Assert.Equal(ProgressEventKind.MilestonesChanged, entry.Kind);
        Assert.Equal(2, entry.MilestoneChanges.Count);
        Assert.Equal(ObjectiveStatus.OnTrack, entry.Status);
    }

    [Fact]
    public async Task A_check_in_with_an_unknown_milestone_applies_nothing()
    {
        var w = await ArrangeAsync();
        var result = await SubmitAsync(w, w.MilestonesId, CheckIn(milestones: [new(w.Milestones[0], true), new(Guid.NewGuid(), true)]));
        Assert.True(result.IsFailure);
        await using var db = w.Store.NewContext();
        Assert.Empty(await db.ProgressUpdates.ToListAsync());
        Assert.All((await db.Objectives.SingleAsync(o => o.Id == w.MilestonesId)).Measurement!.Milestones, m => Assert.False(m.IsCompleted));
    }

    [Fact]
    public async Task A_status_only_check_in_keeps_the_value()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(40m))).IsSuccess);
        var result = await SubmitAsync(w, w.ManualId, CheckIn(status: ObjectiveStatus.AtRisk, note: "Vendor sandbox moved"));
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(40m, result.Value.CurrentPercentage);
        Assert.Equal(ObjectiveStatus.AtRisk, result.Value.CurrentStatus);
        Assert.Equal(ProgressEventKind.StatusOnly, result.Value.History[0].Kind);
    }

    [Fact]
    public async Task A_missing_status_is_rejected()
    {
        var w = await ArrangeAsync();
        var result = await SubmitAsync(w, w.ManualId, CheckIn(40m, status: null));
        Assert.Equal(PerformanceErrors.Codes.ProgressStatusRequired, result.Error.Code);
    }

    [Theory]
    [InlineData(ObjectiveStatus.AtRisk)]
    [InlineData(ObjectiveStatus.OffTrack)]
    public async Task A_risky_status_needs_a_reason(ObjectiveStatus status)
    {
        var w = await ArrangeAsync();
        var result = await SubmitAsync(w, w.ManualId, CheckIn(40m, status, note: "  "));
        Assert.Equal(PerformanceErrors.Codes.ProgressReasonRequired, result.Error.Code);
        await using var db = w.Store.NewContext();
        Assert.Empty(await db.ProgressUpdates.ToListAsync());
    }

    [Fact]
    public async Task On_track_increase_needs_no_note()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(40m))).IsSuccess);
    }

    [Fact]
    public async Task A_measurement_of_the_wrong_kind_is_rejected()
    {
        var w = await ArrangeAsync();
        Assert.Equal(PerformanceErrors.Codes.ProgressMismatch,
            (await SubmitAsync(w, w.ManualId, CheckIn(milestones: [new(w.Milestones[0], true)]))).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.ProgressMismatch, (await SubmitAsync(w, w.MilestonesId, CheckIn(40m))).Error.Code);
    }

    [Fact]
    public async Task The_reviewer_cannot_check_in_for_the_owner()
    {
        var w = await ArrangeAsync();
        Assert.Equal(PerformanceErrors.Codes.ProgressUpdateForbidden, (await SubmitAsync(w, w.ManualId, CheckIn(40m), w.Lina)).Error.Code);
    }

    [Fact]
    public async Task A_status_only_check_in_answers_an_update_request_and_tells_the_requester()
    {
        var w = await ArrangeAsync();
        await using (var db = w.Store.NewContext())
        {
            var asked = await new CreateUpdateRequestHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
                .Handle(new CreateUpdateRequestCommand(w.CycleId, w.PlanId, w.ManualId, null, new PlanActorContext(w.Lina, false, true), "Lina Haddad"), default);
            Assert.True(asked.IsSuccess);
        }
        await Task.Delay(5);
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn())).IsSuccess);

        await using var verify = w.Store.NewContext();
        Assert.Equal(UpdateRequestState.Satisfied, (await verify.UpdateRequests.SingleAsync()).State);
        var told = Assert.Single(await NotificationsAsync(w, PerformanceNotificationKind.UpdateRequestAnswered));
        Assert.Equal(w.Lina, told.RecipientEmployeeId);
        Assert.Equal($"/performance/cycles/{w.CycleId}/objectives/{w.ManualId}", told.Href);
        Assert.Equal("Nour Trabelsi updated their progress", told.EnglishTitle());
    }

    // ── Status and acknowledgement (2.2) ──────────────────────────────────

    [Fact]
    public void The_latest_status_wins_and_repeats_keep_the_period()
    {
        var objective = Objective.CreateStrategic(Guid.NewGuid(), Guid.NewGuid(), "Goal", null, Guid.NewGuid(), Start, End,
            ObjectiveMeasurement.ManualPercentage(), Start, End);
        Assert.Null(objective.CurrentStatus);
        var first = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);
        Assert.True(objective.ReportStatus(ObjectiveStatus.AtRisk, first));
        Assert.False(objective.ReportStatus(ObjectiveStatus.AtRisk, first.AddDays(7)));
        Assert.Equal(first, objective.StatusSince);
        Assert.True(objective.ReportStatus(ObjectiveStatus.OffTrack, first.AddDays(14)));
        Assert.False(objective.ReportStatus(ObjectiveStatus.OnTrack, first.AddDays(21)));
        Assert.Equal(ObjectiveStatus.OnTrack, objective.CurrentStatus);
    }

    [Fact]
    public async Task Going_at_risk_notifies_the_reviewer_once_and_worsening_notifies_again()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Vendor sandbox moved"))).IsSuccess);
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(35m, ObjectiveStatus.AtRisk, "Still waiting"))).IsSuccess);
        var once = Assert.Single(await NotificationsAsync(w, PerformanceNotificationKind.ObjectiveAtRisk));
        Assert.Equal(w.Lina, once.RecipientEmployeeId);
        Assert.Equal("Nour Trabelsi's objective is at risk", once.EnglishTitle());

        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(35m, ObjectiveStatus.OffTrack, "Blocked"))).IsSuccess);
        Assert.Equal(2, (await NotificationsAsync(w, PerformanceNotificationKind.ObjectiveAtRisk)).Count);
    }

    [Fact]
    public async Task The_responsible_reviewer_acknowledges_and_the_owner_sees_it()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Vendor sandbox moved"))).IsSuccess);
        var acknowledged = await AcknowledgeAsync(w, w.Lina);
        Assert.True(acknowledged.IsSuccess, acknowledged.IsFailure ? acknowledged.Error.Message : null);
        Assert.False(acknowledged.Value.CanAcknowledgeStatus);
        Assert.Equal("Lina Haddad", acknowledged.Value.Status!.AcknowledgedBy!.Name);

        await using var db = w.Store.NewContext();
        var owner = await new GetGoalDetailHandler(db, w.Workforce)
            .Handle(new GetGoalDetailQuery(w.CycleId, w.ManualId, new GoalActorContext(w.Nour, false, false, false, false)), default);
        Assert.Equal(ObjectiveStatus.AtRisk, owner.Value.Status!.Value);
        Assert.Equal("Vendor sandbox moved", owner.Value.Status.Reason);
        Assert.NotNull(owner.Value.Status.AcknowledgedAt);
        await AuditAssertions.RecordedAsync(db, PerformanceAuditActions.ObjectiveStatusAcknowledged, w.ManualId, w.CycleId);
    }

    [Fact]
    public async Task Only_the_responsible_reviewer_acknowledges()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.OffTrack, "Blocked"))).IsSuccess);
        Assert.Equal(PerformanceErrors.Codes.ObjectiveStatusAcknowledgeForbidden, (await AcknowledgeAsync(w, Guid.NewGuid())).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.ObjectiveStatusAcknowledgeForbidden, (await AcknowledgeAsync(w, Guid.NewGuid(), canReview: false, admin: true)).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.ObjectiveStatusAcknowledgeForbidden, (await AcknowledgeAsync(w, w.Nour)).Error.Code);
    }

    [Fact]
    public async Task On_track_cannot_be_acknowledged_and_a_retry_is_harmless()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m))).IsSuccess);
        Assert.Equal(PerformanceErrors.Codes.ObjectiveStatusNotAcknowledgeable, (await AcknowledgeAsync(w, w.Lina)).Error.Code);

        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Slipping"))).IsSuccess);
        Assert.True((await AcknowledgeAsync(w, w.Lina)).IsSuccess);
        Assert.True((await AcknowledgeAsync(w, w.Lina)).IsSuccess);
        await using var db = w.Store.NewContext();
        Assert.Single(await db.AuditEntries.Where(e => e.Action == PerformanceAuditActions.ObjectiveStatusAcknowledged).ToListAsync());
    }

    [Fact]
    public async Task A_stale_acknowledgement_conflicts()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Slipping"))).IsSuccess);
        await using var db = w.Store.NewContext();
        var result = await new AcknowledgeObjectiveStatusHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new AcknowledgeObjectiveStatusCommand(w.CycleId, w.ManualId, new GoalActorContext(w.Lina, false, false, true, false), 1), default);
        Assert.Equal("Performance.Stale", result.Error.Code);
    }

    [Fact]
    public async Task A_cross_tenant_acknowledgement_is_not_found()
    {
        var w = await ArrangeAsync();
        var other = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Slipping"))).IsSuccess);
        await using var db = other.Store.NewContext();
        var result = await new AcknowledgeObjectiveStatusHandler(db, other.Workforce, other.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new AcknowledgeObjectiveStatusCommand(w.CycleId, w.ManualId, new GoalActorContext(other.Lina, false, false, true, false), 0), default);
        Assert.True(result.IsFailure);
        Assert.Contains("NotFound", result.Error.Code);
    }

    [Fact]
    public async Task Status_is_hidden_from_a_colleague()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Slipping"))).IsSuccess);
        await using var db = w.Store.NewContext();
        var colleague = await new GetGoalDetailHandler(db, w.Workforce)
            .Handle(new GetGoalDetailQuery(w.CycleId, w.ManualId, new GoalActorContext(Guid.NewGuid(), false, false, false, false)), default);
        Assert.True(colleague.IsFailure || colleague.Value.Status is null);
    }

    [Fact]
    public void A_calculated_objective_takes_no_status()
    {
        var objective = Objective.CreateOrganizational(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Ops", "Excellence", null, Guid.NewGuid(),
            Guid.NewGuid(), Start, End, ObjectiveProgressSource.Calculated, null, Start, End, Start, End);
        Assert.Throws<InvalidOperationException>(() => objective.ReportStatus(ObjectiveStatus.OnTrack, DateTime.UtcNow));
    }

    // ── Attention work item (2.3) ─────────────────────────────────────────

    [Fact]
    public async Task The_reviewer_has_one_row_per_person_until_answered()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.OffTrack, "Blocked on the vendor"))).IsSuccess);
        var item = Assert.Single(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
        Assert.Equal("/performance/team", item.Section);
        Assert.Equal("Nour Trabelsi has 1 goal off track", item.Title);
        Assert.Equal(w.Nour, item.Subject!.EmployeeId);
        Assert.Equal("Blocked on the vendor", item.Quote);
        Assert.Equal("Integrate the vendor API", Assert.Single(item.Lines!).Text);
        // No 1:1s together yet: only asking for an update is offered.
        var ask = Assert.Single(item.Actions!);
        Assert.Equal($"/cycles/{w.CycleId}/plans/{w.PlanId}/attention/ask-for-update", ask.Path);
        Assert.DoesNotContain(await WorkAsync(w, w.Nour), i => i.Kind == "goals-off-track");
        Assert.DoesNotContain(await WorkAsync(w, Guid.NewGuid()), i => i.Kind == "goals-off-track");

        Assert.True((await AcknowledgeAsync(w, w.Lina)).IsSuccess);
        Assert.DoesNotContain(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
    }

    private static async Task<Result<OffTrackAnsweredDto>> AnswerAsync(World w, Guid caller, OffTrackAnswer answer,
        TestStore? store = null)
    {
        await using var db = (store ?? w.Store).NewContext();
        return await new AnswerOffTrackHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new AnswerOffTrackCommand(w.CycleId, w.PlanId, answer, new PlanActorContext(caller, false, true), "Lina Haddad"), default);
    }

    [Fact]
    public async Task Asking_for_an_update_sends_one_request_and_clears_the_row()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.OffTrack, "Blocked"))).IsSuccess);
        Assert.True((await SubmitAsync(w, w.MilestonesId, CheckIn(null, ObjectiveStatus.AtRisk, "Slipping"))).IsSuccess);
        Assert.Equal("Nour Trabelsi has 1 off track and 1 at risk", Assert.Single(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track").Title);

        var answered = await AnswerAsync(w, w.Lina, OffTrackAnswer.AskForUpdate);
        Assert.True(answered.IsSuccess, answered.IsFailure ? answered.Error.Message : null);
        Assert.Equal(2, answered.Value.Seen);
        Assert.True((await AnswerAsync(w, w.Lina, OffTrackAnswer.AskForUpdate)).IsSuccess);
        await using (var db = w.Store.NewContext())
        {
            var request = Assert.Single(await db.UpdateRequests.ToListAsync());
            Assert.Null(request.ObjectiveId);
        }
        Assert.Single(await NotificationsAsync(w, PerformanceNotificationKind.UpdateRequested));
        Assert.DoesNotContain(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
        Assert.Contains(await WorkAsync(w, w.Nour), i => i.Kind == "update-request");
    }

    [Fact]
    public async Task Only_the_reviewer_answers_and_never_across_tenants()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.OffTrack, "Blocked"))).IsSuccess);
        Assert.True((await AnswerAsync(w, w.Nour, OffTrackAnswer.AskForUpdate)).IsFailure);
        Assert.True((await AnswerAsync(w, Guid.NewGuid(), OffTrackAnswer.AskForUpdate)).IsFailure);
        var elsewhere = TestStore.ForNewTenant();
        var foreign = await AnswerAsync(w, w.Lina, OffTrackAnswer.AskForUpdate, elsewhere);
        Assert.True(foreign.IsFailure);
        // Talking it over needs 1:1s together; without them nothing is answered.
        Assert.True((await AnswerAsync(w, w.Lina, OffTrackAnswer.TalkItOver)).IsFailure);
        Assert.Single(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
    }

    [Fact]
    public async Task Attention_ends_on_track_and_returns_when_it_worsens()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.AtRisk, "Slipping"))).IsSuccess);
        Assert.True((await AcknowledgeAsync(w, w.Lina)).IsSuccess);
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.OffTrack, "Blocked"))).IsSuccess);
        Assert.Single(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(50m))).IsSuccess);
        Assert.DoesNotContain(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
    }

    [Fact]
    public async Task Attention_ends_when_the_cycle_closes()
    {
        var w = await ArrangeAsync();
        Assert.True((await SubmitAsync(w, w.ManualId, CheckIn(30m, ObjectiveStatus.OffTrack, "Blocked"))).IsSuccess);
        await using (var db = w.Store.NewContext())
        {
            (await db.Cycles.SingleAsync()).Close();
            await db.SaveChangesAsync();
        }
        Assert.DoesNotContain(await WorkAsync(w, w.Lina), i => i.Kind == "goals-off-track");
    }
}
