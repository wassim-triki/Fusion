using EY.HRPlatform.Performance.Domain.Settings;
using System.Net.Http.Json;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Deliberate closure, closure exceptions, unused-Draft deletion, phase and truthful milestones.</summary>
public sealed class CycleClosureTests
{
    private static readonly DateOnly PastStart = new(2025, 1, 1);
    private static readonly DateOnly PastEnd = new(2025, 12, 31);

    private sealed record Arranged(TestStore Store, Guid CycleId, Guid ApprovedEmployee, Guid DraftEmployee, Guid NoPlanEmployee);

    /// <summary>An Active Cycle with three participants: one approved plan, one draft plan, one without a plan.</summary>
    private static async Task<Arranged> ArrangeAsync(DateOnly start, DateOnly end, bool allApproved = false)
    {
        var store = TestStore.ForNewTenant();
        var tenant = store.TenantId;
        var manager = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2025", start, end, start.AddDays(30)).Activated();

        var approvedEmployee = Guid.NewGuid();
        var draftEmployee = Guid.NewGuid();
        var noPlanEmployee = Guid.NewGuid();
        var participants = new[] { (approvedEmployee, "Amina Approved"), (draftEmployee, "Dora Draft"), (noPlanEmployee, "Nabil None") }
            .Select(p => Participant.Create(tenant, cycle.Id, p.Item1, p.Item2, null, null, null, manager, "Mo Manager", false, start))
            .ToList();

        var approved = EmployeePlan.Create(tenant, cycle.Id, participants[0].Id, approvedEmployee, "Amina Approved", null, manager, "Mo Manager");
        approved.Submit(approvedEmployee, new PlanSubmissionFacts(1, true, 100m, true, false, PlanAlignmentPolicy.AtLeastOneConnected));
        approved.Approve(manager);
        var plans = new List<EmployeePlan> { approved };
        if (allApproved)
        {
            participants.RemoveRange(1, 2);
        }
        else
        {
            plans.Add(EmployeePlan.Create(tenant, cycle.Id, participants[1].Id, draftEmployee, "Dora Draft", null, manager, "Mo Manager"));
        }

        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Participants.AddRange(participants);
            db.EmployeePlans.AddRange(plans);
            await db.SaveChangesAsync();
        }

        return new Arranged(store, cycle.Id, approvedEmployee, draftEmployee, noPlanEmployee);
    }

    private static async Task<uint> VersionAsync(TestStore store, Guid cycleId)
    {
        await using var db = store.NewContext();
        return (await db.Cycles.AsNoTracking().FirstAsync(c => c.Id == cycleId)).Version;
    }

    private static async Task<EY.HRPlatform.SharedKernel.Results.Result<CycleDetailDto>> CloseAsync(
        TestStore store, Guid cycleId, string? earlyReason = null, string? exceptionReason = null, uint? version = null)
    {
        var expected = version ?? await VersionAsync(store, cycleId);
        await using var db = store.NewContext();
        var result = await new CloseCycleHandler(db, new TestPerformanceAudit(db)).Handle(
            new CloseCycleCommand(cycleId, new CloseCycleRequest(expected, earlyReason, exceptionReason)), default);
        if (result.IsSuccess)
        {
            await AuditAssertions.RecordedAsync(db, "Cycle.Closed", cycleId, cycleId);
            foreach (var participant in await db.Participants.Where(p => p.CycleId == cycleId && p.ClosureExceptionReason != null).ToListAsync())
                await AuditAssertions.RecordedAsync(db, "Participant.ClosureExceptionRecorded", participant.Id, cycleId);
        }
        return result;
    }

    [Fact]
    public async Task Closing_with_unresolved_participants_requires_an_exception_reason()
    {
        var f = await ArrangeAsync(PastStart, PastEnd);

        var blocked = await CloseAsync(f.Store, f.CycleId);
        Assert.True(blocked.IsFailure);
        Assert.Equal("Cycle.ClosureUnresolved", blocked.Error.Code);

        await using (var db = f.Store.NewContext())
            Assert.Equal(CycleLifecycleState.Active, (await db.Cycles.FirstAsync(c => c.Id == f.CycleId)).State);

        var closed = await CloseAsync(f.Store, f.CycleId, exceptionReason: "Left the company mid-cycle");
        Assert.True(closed.IsSuccess, closed.IsFailure ? closed.Error.Message : null);
        Assert.Equal(CycleLifecycleState.Closed, closed.Value.Cycle.State);

        await using var reread = f.Store.NewContext();
        var reasons = await reread.Participants.AsNoTracking()
            .ToDictionaryAsync(p => p.EmployeeId, p => p.ClosureExceptionReason);
        Assert.Null(reasons[f.ApprovedEmployee]);
        Assert.Equal("Left the company mid-cycle", reasons[f.DraftEmployee]);
        Assert.Equal("Left the company mid-cycle", reasons[f.NoPlanEmployee]);
    }

    [Fact]
    public async Task Closing_before_the_end_date_requires_a_reason()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var f = await ArrangeAsync(today.AddMonths(-2), today.AddMonths(6), allApproved: true);

        var blocked = await CloseAsync(f.Store, f.CycleId);
        Assert.Equal("Cycle.EarlyCloseReason", blocked.Error.Code);

        var closed = await CloseAsync(f.Store, f.CycleId, earlyReason: "Restructuring ends this cycle early");
        Assert.True(closed.IsSuccess);
        await using var db = f.Store.NewContext();
        Assert.Equal("Restructuring ends this cycle early", (await db.Cycles.FirstAsync(c => c.Id == f.CycleId)).EarlyCloseReason);
    }

    [Fact]
    public async Task Closing_is_idempotent_and_version_checked()
    {
        var f = await ArrangeAsync(PastStart, PastEnd, allApproved: true);

        var stale = await CloseAsync(f.Store, f.CycleId, version: 7);
        Assert.Equal("Performance.Stale", stale.Error.Code);

        var first = await CloseAsync(f.Store, f.CycleId);
        Assert.True(first.IsSuccess);
        var closedAt = first.Value.Cycle;

        // A retry after success — even with the old version — returns the closed Cycle unchanged.
        var retry = await CloseAsync(f.Store, f.CycleId, version: 7);
        Assert.True(retry.IsSuccess);
        Assert.Equal(CycleLifecycleState.Closed, retry.Value.Cycle.State);
        Assert.Equal(closedAt.Version, retry.Value.Cycle.Version);
    }

    [Fact]
    public async Task A_draft_cycle_cannot_be_closed()
    {
        var store = TestStore.ForNewTenant();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2025", PastStart, PastEnd, PastStart.AddDays(30));
        await using (var db = store.NewContext()) { db.Cycles.Add(cycle); await db.SaveChangesAsync(); }

        var result = await CloseAsync(store, cycle.Id);
        Assert.Equal("Cycle.NotActive", result.Error.Code);
    }

    [Fact]
    public async Task Closure_view_lists_who_lacks_an_approved_plan()
    {
        var f = await ArrangeAsync(PastStart, PastEnd);
        await using var db = f.Store.NewContext();
        var closure = await new GetCycleClosureHandler(db).Handle(new GetCycleClosureQuery(f.CycleId), default);

        Assert.True(closure.Value.EndReached);
        Assert.Equal(3, closure.Value.ParticipantCount);
        Assert.Equal(1, closure.Value.ApprovedCount);
        Assert.Equal(
            [(f.NoPlanEmployee, RosterPlanStatus.NotStarted), (f.DraftEmployee, RosterPlanStatus.Draft)],
            closure.Value.Unresolved.Select(u => (u.EmployeeId, u.Standing)).ToList());
    }

    [Fact]
    public async Task Milestones_and_phase_are_truthful()
    {
        var partial = await ArrangeAsync(PastStart, PastEnd);
        var complete = await ArrangeAsync(PastStart, PastEnd, allApproved: true);

        async Task<CycleDetailDto> DetailAsync(Arranged f)
        {
            await using var db = f.Store.NewContext();
            return (await new GetCycleDetailHandler(db).Handle(new GetCycleDetailQuery(f.CycleId,
                new EY.HRPlatform.Performance.Features.Security.Policies.CycleVisibilityActor(Guid.Empty, true, null)), default)).Value;
        }

        bool Reached(CycleDetailDto d, OperationalMilestone m) => d.Milestones.Single(x => x.Milestone == m).Reached;

        var partialDetail = await DetailAsync(partial);
        Assert.False(Reached(partialDetail, OperationalMilestone.PlanningCompleted));
        Assert.False(Reached(partialDetail, OperationalMilestone.ClosureReady));
        Assert.True(Reached(partialDetail, OperationalMilestone.PerformanceEndReached));
        Assert.Equal(CyclePhase.Execution, partialDetail.Phase);

        var completeDetail = await DetailAsync(complete);
        Assert.True(Reached(completeDetail, OperationalMilestone.PlanningCompleted));
        Assert.True(Reached(completeDetail, OperationalMilestone.ClosureReady));

        // Once closed — even with recorded exceptions — closure is no longer pending.
        Assert.True((await CloseAsync(partial.Store, partial.CycleId, exceptionReason: "Left mid-cycle")).IsSuccess);
        var closedDetail = await DetailAsync(partial);
        Assert.True(Reached(closedDetail, OperationalMilestone.ClosureReady));
        Assert.Null(closedDetail.Phase);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var planning = PerformanceCycle.CreateDraft(Guid.NewGuid(), "FY", today.AddDays(-1), today.AddMonths(11), today.AddDays(20)).Activated();
        Assert.Equal(CyclePhase.Planning, YearPhase.Of(planning, today, YearEvidence.None));
        Assert.Null(YearPhase.Of(PerformanceCycle.CreateDraft(Guid.NewGuid(), "FY", PastStart, PastEnd, PastStart.AddDays(1)), today, YearEvidence.None));
    }

    [Fact]
    public async Task Only_an_unused_draft_can_be_deleted()
    {
        var store = TestStore.ForNewTenant();
        var draft = PerformanceCycle.CreateDraft(store.TenantId, "Unused", PastStart, PastEnd, PastStart.AddDays(30));
        var used = PerformanceCycle.CreateDraft(store.TenantId, "Has a plan", PastStart, PastEnd, PastStart.AddDays(30));
        var strategy = Objective.CreateStrategic(store.TenantId, draft.Id, "Grow", null, Guid.NewGuid(),
            PastStart, PastEnd, ObjectiveMeasurement.ManualPercentage(), PastStart, PastEnd);
        var participant = Participant.Create(store.TenantId, draft.Id, Guid.NewGuid(), "Amina", null, null, null, Guid.NewGuid(), "Mo", false, PastStart);
        await using (var db = store.NewContext())
        {
            db.Cycles.AddRange(draft, used);
            db.Objectives.Add(strategy);
            db.Participants.Add(participant);
            db.EmployeePlans.Add(EmployeePlan.Create(store.TenantId, used.Id, Guid.NewGuid(), Guid.NewGuid(), "Legacy", null, null, null));
            await db.SaveChangesAsync();
        }

        await using (var db = store.NewContext())
        {
            var blocked = await new DeleteDraftCycleHandler(db, new TestPerformanceAudit(db)).Handle(new DeleteDraftCycleCommand(used.Id, await VersionAsync(store, used.Id)), default);
            Assert.Equal("Cycle.NotDeletable", blocked.Error.Code);
        }

        await using (var db = store.NewContext())
        {
            var deleted = await new DeleteDraftCycleHandler(db, new TestPerformanceAudit(db)).Handle(new DeleteDraftCycleCommand(draft.Id, await VersionAsync(store, draft.Id)), default);
            await AuditAssertions.RecordedAsync(db, "Cycle.DraftDeleted", draft.Id, draft.Id);
            Assert.True(deleted.IsSuccess);
        }

        await using (var db = store.NewContext())
        {
            Assert.False(await db.Cycles.AnyAsync(c => c.Id == draft.Id));
            Assert.False(await db.Objectives.AnyAsync(o => o.CycleId == draft.Id));
            Assert.False(await db.Participants.AnyAsync(p => p.CycleId == draft.Id));
            Assert.True(await db.Cycles.AnyAsync(c => c.Id == used.Id));
        }

        var active = await ArrangeAsync(PastStart, PastEnd);
        await using (var db = active.Store.NewContext())
        {
            var result = await new DeleteDraftCycleHandler(db, new TestPerformanceAudit(db)).Handle(new DeleteDraftCycleCommand(active.CycleId, await VersionAsync(active.Store, active.CycleId)), default);
            Assert.Equal("Cycle.NotDraft", result.Error.Code);
        }
    }

    [Fact]
    public async Task Closure_endpoints_require_cycle_administration()
    {
        await using var factory = new PerformanceApiFactory();
        var cycleId = Guid.NewGuid();
        using var client = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(),
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Tenant)]);

        using var closure = await client.GetAsync($"/api/performance/cycles/{cycleId}/closure");
        using var close = await client.PostAsJsonAsync($"/api/performance/cycles/{cycleId}/close", new { expectedVersion = 0 });
        using var delete = await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/performance/cycles/{cycleId}")
        {
            Content = JsonContent.Create(new { expectedVersion = 0 }),
        });

        Assert.Equal(403, (int)closure.StatusCode);
        Assert.Equal(403, (int)close.StatusCode);
        Assert.Equal(403, (int)delete.StatusCode);
    }
}
