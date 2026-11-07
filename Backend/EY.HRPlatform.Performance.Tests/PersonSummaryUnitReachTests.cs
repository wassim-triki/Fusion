using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.People;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Roles › Plans and check-ins "for their unit" (B-212): Mariam leads Product. She reads the plan of Kais, who works in
/// Product A under it, on his summary, without links or reviews; not Omar's in Engineering beside it, nor a Draft
/// that was never put forward.
/// </summary>
public sealed class PersonSummaryUnitReachTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly PlanSubmissionFacts Ready = new(1, true, 100m, true, false, PlanAlignmentPolicy.AtLeastOneConnected);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId, Guid Mariam, Guid Kais, Guid Omar, Guid Draft);

    private static async Task<World> ArrangeAsync()
    {
        var store = TestStore.ForNewTenant();
        var tenant = store.TenantId;
        var workforce = new FakeCoreWorkforceClient();
        Guid company = Guid.NewGuid(), product = Guid.NewGuid(), productA = Guid.NewGuid(), engineering = Guid.NewGuid();
        workforce.OrgUnits[product] = new(product, "Product", company, true, [company]);
        workforce.OrgUnits[productA] = new(productA, "Product A", product, true, [product, company]);
        workforce.OrgUnits[engineering] = new(engineering, "Engineering", company, true, [company]);
        var lead = workforce.Add("Lead");
        var mariam = workforce.Add("Mariam", orgUnitId: product, orgUnitName: "Product").EmployeeId;
        var kais = workforce.Add("Kais", orgUnitId: productA, orgUnitName: "Product A", managerId: lead.EmployeeId).EmployeeId;
        var omar = workforce.Add("Omar", orgUnitId: engineering, managerId: lead.EmployeeId).EmployeeId;
        var draft = workforce.Add("Sami", orgUnitId: productA, orgUnitName: "Product A", managerId: lead.EmployeeId).EmployeeId;

        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, new(2026, 12, 31), Start.AddDays(30)).Activated();
        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        foreach (var (id, name, unit) in new[] { (kais, "Kais", "Product A"), (omar, "Omar", "Engineering"), (draft, "Sami", "Product A") })
        {
            var participant = Participant.Create(tenant, cycle.Id, id, name, "Engineer", null, unit, lead.EmployeeId, "Lead", false, Start);
            db.Participants.Add(participant);
            var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, id, name, unit, lead.EmployeeId, "Lead");
            if (id != draft) plan.Submit(id, Ready);
            db.EmployeePlans.Add(plan);
        }

        await db.SaveChangesAsync();
        return new(store, workforce, cycle.Id, mariam, kais, omar, draft);
    }

    private static async Task<PersonPerformanceSummaryDto> SummaryAsync(World w, Guid of, string? reach)
    {
        await using var db = w.Store.NewContext();
        var viewer = new PersonSummaryViewer(w.Mariam, ReviewsReports: true, Administers: false) { PlansReach = reach };
        var result = await new GetPersonSummaryHandler(db, w.Workforce).Handle(new GetPersonSummaryQuery(of, w.CycleId, viewer), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    [Fact]
    public async Task Their_unit_reads_a_put_forward_plan_under_their_unit_and_nothing_beside_it()
    {
        var w = await ArrangeAsync();

        var kais = await SummaryAsync(w, w.Kais, PermissionScopes.OrgUnit);
        Assert.Equal(PersonRelation.Observer, kais.Relation);
        Assert.NotNull(kais.CurrentCycle?.PlanId);
        Assert.Null(kais.CurrentCycle!.PlanHref);
        Assert.Null(kais.Reviews);

        var omar = await SummaryAsync(w, w.Omar, PermissionScopes.OrgUnit);
        Assert.Equal(PersonRelation.Other, omar.Relation);
        Assert.Null(omar.CurrentCycle);

        var draft = await SummaryAsync(w, w.Draft, PermissionScopes.OrgUnit);
        Assert.Equal(PersonRelation.Observer, draft.Relation);
        Assert.Null(draft.CurrentCycle?.PlanId);

        // A team reach doesn't reach Kais, who doesn't report to Mariam.
        Assert.Equal(PersonRelation.Other, (await SummaryAsync(w, w.Kais, PermissionScopes.DirectReports)).Relation);
    }

    [Fact]
    public async Task Another_company_shows_nothing()
    {
        var w = await ArrangeAsync();
        var other = await ArrangeAsync();
        await using var db = other.Store.NewContext();
        var viewer = new PersonSummaryViewer(w.Mariam, true, false) { PlansReach = PermissionScopes.OrgUnit };
        var result = await new GetPersonSummaryHandler(db, other.Workforce).Handle(new GetPersonSummaryQuery(w.Kais, w.CycleId, viewer), default);
        Assert.True(result.IsSuccess);
        Assert.Equal(PersonRelation.Other, result.Value.Relation);
        Assert.Null(result.Value.CurrentCycle);
    }
}
