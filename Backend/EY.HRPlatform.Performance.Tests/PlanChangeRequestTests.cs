using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Work;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// D-09: Mo returns Emma's plan with change requests on specific objectives; Emma addresses each in place and
/// resubmits only once all are addressed; Mo sees what came of each one.
/// </summary>
public sealed class PlanChangeRequestTests
{
    // Planning is open today, so the revise work item applies.
    private static readonly DateOnly Start = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-10);
    private static readonly DateOnly End = Start.AddYears(1).AddDays(-1);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId, Guid PlanId,
        Guid FirstId, Guid SecondId, Guid Emma, Guid Mo);

    private static async Task<World> ArrangeAsync()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var tenant = store.TenantId;
        var emma = workforce.Add("Emma Employee").EmployeeId;
        var mo = workforce.Add("Mo Manager").EmployeeId;
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30));
        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            var settings = CycleSettings.CreateDefault(tenant);
            settings.Update(settings.DefaultMeasurementMethod, 3, 6, 30, PlanAlignmentPolicy.Optional);
            db.CycleSettings.Add(settings);
            var participant = Participant.Create(tenant, cycle.Id, emma, "Emma Employee", "Engineer", null, "Platform", mo, "Mo Manager", false, Start);
            db.Participants.Add(participant);
            await db.SaveChangesAsync();
            var snapshot = ActivationSnapshot.Capture(tenant, cycle.Id, "FY2026", Start, End, Start.AddDays(30), Start, 1,
                System.Text.Json.JsonSerializer.Serialize(settings.ToSnapshot()), "{}", "[]", "[]");
            (await db.Cycles.FirstAsync()).Activate(snapshot);
            db.Entry(snapshot).State = EntityState.Added;
            await db.SaveChangesAsync();
        }
        var plan = Ok(await Run(store, db => new CreateMyPlanHandler(db, workforce, store.Tenant).Handle(new CreateMyPlanCommand(cycle.Id, Employee(emma)), default)));
        plan = Ok(await Run(store, db => new AddPlanObjectiveHandler(db, workforce, store.Tenant)
            .Handle(new AddPlanObjectiveCommand(cycle.Id, Manual("Ship the gateway", 60m) with { ExpectedVersion = plan.Version }, Employee(emma)), default)));
        plan = Ok(await Run(store, db => new AddPlanObjectiveHandler(db, workforce, store.Tenant)
            .Handle(new AddPlanObjectiveCommand(cycle.Id, Manual("Document the runbook", 40m) with { ExpectedVersion = plan.Version }, Employee(emma)), default)));
        var world = new World(store, workforce, cycle.Id, plan.Id,
            plan.Objectives.Single(o => o.Title == "Ship the gateway").Id, plan.Objectives.Single(o => o.Title == "Document the runbook").Id, emma, mo);
        Ok(await SubmitAsync(world));
        return world;
    }

    private static T Ok<T>(Result<T> result)
    {
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    private static async Task<T> Run<T>(TestStore store, Func<EY.HRPlatform.Performance.Infrastructure.Persistence.PerformanceDbContext, Task<T>> act)
    {
        await using var db = store.NewContext();
        return await act(db);
    }

    private static PlanActorContext Employee(Guid id) => new(id, IsAdmin: false, CanReviewReports: false);
    private static PlanActorContext Manager(Guid id) => new(id, IsAdmin: false, CanReviewReports: true);

    private static AddPlanObjectiveRequest Manual(string title, decimal? weight)
        => new(title, null, null, null, null, new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null), weight);

    private static async Task<uint> PlanVersionAsync(World w)
        => await Run(w.Store, async db => (await db.EmployeePlans.AsNoTracking().SingleAsync(p => p.Id == w.PlanId)).Version);

    private static async Task<Result<EmployeePlanDto>> SubmitAsync(World w)
    {
        var version = await PlanVersionAsync(w);
        return await Run(w.Store, db => new SubmitMyPlanHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new SubmitMyPlanCommand(w.CycleId, Employee(w.Emma), version), default));
    }

    private static async Task<Result<EmployeePlanDto>> ReturnAsync(World w, string? note, params ChangeRequestInput[] requests)
    {
        var version = await PlanVersionAsync(w);
        return await Run(w.Store, db => new ReturnPlanHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new ReturnPlanCommand(w.CycleId, w.PlanId, new ReturnPlanRequest(note, requests) { ExpectedVersion = version }, Manager(w.Mo)), default));
    }

    private static async Task<Result<EmployeePlanDto>> AddressAsync(World w, Guid requestId, string? reply = null, Guid? caller = null)
    {
        var version = await PlanVersionAsync(w);
        return await Run(w.Store, db => new AddressChangeRequestHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new AddressChangeRequestCommand(w.CycleId, requestId, new AddressChangeRequestRequest(reply) { ExpectedVersion = version },
                caller is Guid other ? Manager(other) : Employee(w.Emma)), default));
    }

    private static IReadOnlyList<PlanChangeRequestDto> Requests(EmployeePlanDto plan) => plan.History.Last(h => h.Kind == PlanDecisionKind.Returned).ChangeRequests;

    [Fact]
    public async Task A_return_carries_requests_on_specific_objectives()
    {
        var w = await ArrangeAsync();
        var returned = Ok(await ReturnAsync(w, null, new(w.FirstId, "Make this measurable"), new(w.SecondId, "Drop this one")));
        Assert.Equal(PlanLifecycleState.Draft, returned.State);
        Assert.Equal(2, Requests(returned).Count);
        Assert.All(Requests(returned), r => Assert.Equal(PlanChangeRequestState.Open, r.State));
        Assert.Equal(2, returned.Readiness.OpenChangeRequests);
        Assert.Contains("Address 2 change requests.", returned.Readiness.Blockers);
        await Run(w.Store, async db => { await AuditAssertions.RecordedAsync(db, PerformanceAuditActions.PlanReturned, w.PlanId, w.CycleId); return 0; });
    }

    [Fact]
    public async Task A_note_alone_still_returns_the_plan()
        => Assert.Empty(Requests(Ok(await ReturnAsync(await ArrangeAsync(), "Sharpen the plan"))));

    [Fact]
    public async Task A_return_without_a_note_or_request_is_rejected()
    {
        var w = await ArrangeAsync();
        Assert.Equal(PerformanceErrors.Codes.PlanFeedback, (await ReturnAsync(w, "  ")).Error.Code);
    }

    [Fact]
    public async Task Invalid_requests_are_rejected_and_the_plan_stays_submitted()
    {
        var w = await ArrangeAsync();
        Assert.Equal(PerformanceErrors.Codes.PlanChangeRequestInvalid, (await ReturnAsync(w, null, new ChangeRequestInput(Guid.NewGuid(), "Not here"))).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.PlanFeedback, (await ReturnAsync(w, null, new(w.FirstId, "One"), new(w.FirstId, "Two"))).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.PlanFeedback, (await ReturnAsync(w, null, new ChangeRequestInput(w.FirstId, new string('x', 501)))).Error.Code);
        Assert.Equal(PerformanceErrors.Codes.PlanFeedback, (await ReturnAsync(w, null, new ChangeRequestInput(w.FirstId, " "))).Error.Code);
        Assert.Equal(PlanLifecycleState.Submitted, await Run(w.Store, async db => (await db.EmployeePlans.SingleAsync()).State));
    }

    [Fact]
    public async Task Resubmission_waits_until_every_request_is_addressed()
    {
        var w = await ArrangeAsync();
        var returned = Ok(await ReturnAsync(w, null, new(w.FirstId, "Make this measurable"), new(w.SecondId, "Shorter title")));
        var first = Requests(returned).Single(r => r.ObjectiveId == w.FirstId);
        var second = Requests(returned).Single(r => r.ObjectiveId == w.SecondId);

        var addressed = Ok(await AddressAsync(w, first.Id, "Target is now 99.9% uptime"));
        Assert.Equal("Target is now 99.9% uptime", Requests(addressed).Single(r => r.Id == first.Id).Reply);
        Assert.False(addressed.CanSubmit);
        Assert.Equal(PerformanceErrors.Codes.PlanNotSubmittable, (await SubmitAsync(w)).Error.Code);

        Ok(await AddressAsync(w, second.Id));
        Ok(await AddressAsync(w, second.Id));
        Assert.Equal(PlanLifecycleState.Submitted, Ok(await SubmitAsync(w)).State);
    }

    [Fact]
    public async Task Only_the_owner_addresses_and_only_while_the_plan_is_back_with_them()
    {
        var w = await ArrangeAsync();
        var request = Requests(Ok(await ReturnAsync(w, null, new ChangeRequestInput(w.FirstId, "Make this measurable"))))[0];
        Assert.Equal(PerformanceErrors.Codes.PlanChangeRequestForbidden, (await AddressAsync(w, request.Id, caller: w.Mo)).Error.Code);
        Ok(await AddressAsync(w, request.Id));
        Ok(await SubmitAsync(w));
        Assert.Equal(PerformanceErrors.Codes.PlanChangeRequestNotOpen, (await AddressAsync(w, request.Id, "Late reply")).Error.Code);
    }

    [Fact]
    public async Task Removing_the_objective_addresses_its_request()
    {
        var w = await ArrangeAsync();
        Ok(await ReturnAsync(w, null, new ChangeRequestInput(w.SecondId, "Drop this one")));
        var version = await PlanVersionAsync(w);
        var removed = Ok(await Run(w.Store, db => new RemovePlanObjectiveHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new RemovePlanObjectiveCommand(w.CycleId, w.SecondId, Employee(w.Emma), version), default)));
        var request = Requests(removed).Single();
        Assert.Equal(PlanChangeRequestState.ObjectiveRemoved, request.State);
        Assert.Null(request.ObjectiveChanged);
        Assert.Equal("Drop this one", request.Text);
        Assert.Equal("Document the runbook", request.ObjectiveTitle);
        Assert.Equal(0, removed.Readiness.OpenChangeRequests);
    }

    [Fact]
    public async Task The_reviewer_sees_whether_each_objective_changed()
    {
        var w = await ArrangeAsync();
        var returned = Ok(await ReturnAsync(w, null, new(w.FirstId, "Make this measurable"), new(w.SecondId, "Fine as is?")));
        await Task.Delay(5);
        var version = await PlanVersionAsync(w);
        Ok(await Run(w.Store, db => new UpdatePlanObjectiveHandler(db, w.Workforce, w.Store.Tenant).Handle(new UpdatePlanObjectiveCommand(w.CycleId, w.FirstId,
            new UpdatePlanObjectiveRequest("Ship the gateway with 99.9% uptime", null, null, null, null,
                new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null), 60m) { ExpectedVersion = version }, Employee(w.Emma)), default)));
        foreach (var request in Requests(returned)) Ok(await AddressAsync(w, request.Id));
        Ok(await SubmitAsync(w));

        var seen = Ok(await Run(w.Store, db => new GetPlanForReviewHandler(db, w.Workforce, w.Store.Tenant)
            .Handle(new GetPlanForReviewQuery(w.CycleId, w.PlanId, Manager(w.Mo)), default)));
        Assert.True(Requests(seen).Single(r => r.ObjectiveId == w.FirstId).ObjectiveChanged);
        Assert.False(Requests(seen).Single(r => r.ObjectiveId == w.SecondId).ObjectiveChanged);
    }

    [Fact]
    public async Task A_second_return_starts_a_new_set_that_alone_gates()
    {
        var w = await ArrangeAsync();
        var first = Requests(Ok(await ReturnAsync(w, null, new ChangeRequestInput(w.FirstId, "Make this measurable"))))[0];
        Ok(await AddressAsync(w, first.Id));
        Ok(await SubmitAsync(w));
        var again = Ok(await ReturnAsync(w, null, new ChangeRequestInput(w.SecondId, "Shorter title")));
        Assert.Equal(2, again.History.Count(h => h.Kind == PlanDecisionKind.Returned));
        Assert.Equal(1, again.Readiness.OpenChangeRequests);
        Assert.Equal(PerformanceErrors.Codes.PlanChangeRequestNotOpen, (await AddressAsync(w, first.Id, "Again")).Error.Code);
    }

    [Fact]
    public async Task The_revise_item_counts_the_changes_left()
    {
        var w = await ArrangeAsync();
        var returned = Ok(await ReturnAsync(w, null, new(w.FirstId, "Make this measurable"), new(w.SecondId, "Shorter title")));
        Ok(await AddressAsync(w, Requests(returned)[0].Id));
        var items = await Run(w.Store, db => new GetWorkItemsHandler(db).Handle(new GetWorkItemsQuery(new WorkActor(w.Emma, Guid.NewGuid(), true, false, false, false)), default));
        Assert.Equal("1 change to address", Assert.Single(items.Value, i => i.Kind == "plan-revise").Context);
    }

    [Fact]
    public async Task The_reviewer_reads_what_changed_since_the_return_and_unchosen_weights_share_the_rest()
    {
        var w = await ArrangeAsync();
        var returned = Ok(await ReturnAsync(w, null, new ChangeRequestInput(w.FirstId, "Make this measurable")));
        var version = await PlanVersionAsync(w);
        // Emma renames the first goal and hands its weight back; drops the second; adds a third without a weight.
        Ok(await Run(w.Store, db => new UpdatePlanObjectiveHandler(db, w.Workforce, w.Store.Tenant).Handle(new UpdatePlanObjectiveCommand(w.CycleId, w.FirstId,
            new UpdatePlanObjectiveRequest("Ship the gateway with 99.9% uptime", null, null, null, null,
                new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null), null) { ExpectedVersion = version }, Employee(w.Emma)), default)));
        version = await PlanVersionAsync(w);
        Ok(await Run(w.Store, db => new RemovePlanObjectiveHandler(db, w.Workforce, w.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new RemovePlanObjectiveCommand(w.CycleId, w.SecondId, Employee(w.Emma), version), default)));
        version = await PlanVersionAsync(w);
        var draft = Ok(await Run(w.Store, db => new AddPlanObjectiveHandler(db, w.Workforce, w.Store.Tenant)
            .Handle(new AddPlanObjectiveCommand(w.CycleId, Manual("Write the migration guide", 0m) with { PlanWeight = null, ExpectedVersion = version }, Employee(w.Emma)), default)));
        // D-40: nobody chose a weight now, so the two goals share 100 evenly and the plan is ready.
        Assert.Equal([50m, 50m], draft.Objectives.Select(o => o.PlanWeight!.Value).OrderBy(x => x));
        Assert.All(draft.Objectives, o => Assert.False(o.PlanWeightIsSet));
        Assert.Equal(100m, draft.Readiness.WeightTotal);
        foreach (var request in Requests(returned).Where(r => r.State == PlanChangeRequestState.Open)) Ok(await AddressAsync(w, request.Id));
        Ok(await SubmitAsync(w));

        var seen = Ok(await Run(w.Store, db => new GetPlanForReviewHandler(db, w.Workforce, w.Store.Tenant)
            .Handle(new GetPlanForReviewQuery(w.CycleId, w.PlanId, Manager(w.Mo)), default)));
        var changes = seen.ChangesSinceReturn!;
        var renamed = Assert.Single(changes, c => c.Kind == PlanChanges.Changed);
        Assert.Equal(w.FirstId, renamed.ObjectiveId);
        Assert.Equal([(PlanChanges.Title, "Ship the gateway", "Ship the gateway with 99.9% uptime"), (PlanChanges.Weight, "60%", "50%")],
            renamed.Fields.Select(f => (f.Field, f.Before, f.After)));
        Assert.Equal("Document the runbook", Assert.Single(changes, c => c.Kind == PlanChanges.Removed).Title);
        Assert.Equal("Write the migration guide", Assert.Single(changes, c => c.Kind == PlanChanges.Added).Title);

        // A plan never returned has nothing to compare.
        var other = await ArrangeAsync();
        var fresh = Ok(await Run(other.Store, db => new GetPlanForReviewHandler(db, other.Workforce, other.Store.Tenant)
            .Handle(new GetPlanForReviewQuery(other.CycleId, other.PlanId, Manager(other.Mo)), default)));
        Assert.Null(fresh.ChangesSinceReturn);
        // Another company's reviewer can't read it.
        var outside = await Run(other.Store, db => new GetPlanForReviewHandler(db, other.Workforce, other.Store.Tenant)
            .Handle(new GetPlanForReviewQuery(w.CycleId, w.PlanId, Manager(w.Mo)), default));
        Assert.True(outside.IsFailure);
    }

    [Fact]
    public async Task A_cross_tenant_request_is_not_found()
    {
        var w = await ArrangeAsync();
        var other = await ArrangeAsync();
        var request = Requests(Ok(await ReturnAsync(w, null, new ChangeRequestInput(w.FirstId, "Make this measurable"))))[0];
        var result = await Run(other.Store, db => new AddressChangeRequestHandler(db, other.Workforce, other.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new AddressChangeRequestCommand(other.CycleId, request.Id, new AddressChangeRequestRequest(null), Employee(w.Emma)), default));
        Assert.Equal("ChangeRequest.NotFound", result.Error.Code);
    }
}
