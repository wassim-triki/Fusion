using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.OneOnOnes;
using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Work;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>Performance across Fusion (B-434): the Team page's year, 1:1s booked at times both are free, results exported.</summary>
public sealed class AcrossFusionTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    private sealed record World(TestStore Store, FakeCoreWorkforceClient Workforce, Guid CycleId, Guid Lina, Guid Nour, Guid Sami);

    /// <summary>Lina manages Nour (an approved plan) and Sami (no plan) in Core HR; neither has 1:1s with her.</summary>
    private static async Task<World> ArrangeAsync()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var tenant = store.TenantId;
        var lina = workforce.Add("Lina Haddad").EmployeeId;
        var nour = workforce.Add("Nour Trabelsi", managerId: lina).EmployeeId;
        var sami = workforce.Add("Sami Ben Ali", managerId: lina).EmployeeId;
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30)).Activated();
        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        var participant = Participant.Create(tenant, cycle.Id, nour, "Nour Trabelsi", "Engineer", null, "Platform", lina, "Lina Haddad", false, Start);
        db.Participants.Add(participant);
        var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, nour, "Nour Trabelsi", "Platform", lina, "Lina Haddad");
        db.EmployeePlans.Add(plan);
        // Lina is accountable for her unit's goal; Nour's first goal supports it.
        var unit = Objective.CreateOrganizational(tenant, cycle.Id, Guid.NewGuid(), "Platform", "Cut incidents by 40%", null, lina, null,
            Start, End, ObjectiveProgressSource.Direct, ObjectiveMeasurement.ManualPercentage(), null, null, Start, End);
        unit.Publish();
        db.Objectives.Add(unit);
        db.Objectives.AddRange(
            Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Integrate the vendor API", null, unit.Id,
                Start, End, ObjectiveMeasurement.ManualPercentage(), 60m, Start, End, Start, End),
            Objective.CreateEmployee(tenant, cycle.Id, plan.Id, nour, "Document the runbooks", null, null,
                Start, End, ObjectiveMeasurement.ManualPercentage(), 40m, null, null, Start, End));
        plan.Submit(nour, new PlanSubmissionFacts(2, true, 100m, true, false, PlanAlignmentPolicy.Optional));
        plan.Approve(lina);
        await db.SaveChangesAsync();
        return new World(store, workforce, cycle.Id, lina, nour, sami);
    }

    private static WorkActor Manager(Guid id) => new(id, Guid.NewGuid(), true, true, false, false);

    private static async Task<SharedKernel.Results.Result<TeamYearDto>> TeamAsync(World w, Guid caller, TestStore? store = null,
        Guid? cycleId = null)
    {
        await using var db = (store ?? w.Store).NewContext();
        return await new GetTeamYearHandler(db, w.Workforce, new FakeNotificationAudienceClient())
            .Handle(new GetTeamYearQuery(cycleId ?? w.CycleId, Manager(caller)), default);
    }

    [Fact]
    public async Task The_team_is_core_hrs_reports_each_with_their_year_and_what_is_due()
    {
        var w = await ArrangeAsync();
        var team = await TeamAsync(w, w.Lina);
        Assert.True(team.IsSuccess, team.IsFailure ? team.Error.Message : null);
        Assert.Equal(new[] { w.Nour, w.Sami }.Order(), team.Value.People.Select(p => p.EmployeeId).Order());
        // The team's goals hang under the unit goal Lina is accountable for.
        var branch = Assert.Single(team.Value.Branches);
        Assert.Equal("Cut incidents by 40%", branch.Goal.Title);
        Assert.Equal("Integrate the vendor API", Assert.Single(branch.Team).Title);
        Assert.Empty(team.Value.Elsewhere);

        var nour = team.Value.People.Single(p => p.EmployeeId == w.Nour);
        Assert.Equal(RosterPlanStatus.Approved, nour.PlanStatus);
        Assert.Equal([60m, 40m], nour.Goals.Select(g => g.Weight).Order().Reverse());
        var sami = team.Value.People.Single(p => p.EmployeeId == w.Sami);
        Assert.Equal(RosterPlanStatus.NotStarted, sami.PlanStatus);
        Assert.Empty(sami.Goals);
        // Neither has 1:1s with Lina yet: booking one is what's due, at times both are free.
        Assert.Equal("one-on-one-book", sami.Due!.Kind);
        Assert.Equal(OneOnOneFreeTimes.Offered, sami.Due.Booking!.Slots.Count);
        Assert.Equal($"/one-on-ones/with/{w.Sami}/book", sami.Due.Booking.Path);
    }

    [Fact]
    public async Task Nobody_else_sees_the_team_and_another_tenant_cannot_read_the_year()
    {
        var w = await ArrangeAsync();
        // Nour manages nobody: an empty team, never Lina's.
        var nour = await TeamAsync(w, w.Nour);
        Assert.True(nour.IsSuccess);
        Assert.Empty(nour.Value.People);
        // The same cycle id read from another tenant is not found.
        var foreign = await TeamAsync(w, w.Lina, TestStore.ForNewTenant());
        Assert.True(foreign.IsFailure);
    }

    [Fact]
    public async Task A_private_draft_stays_its_owners()
    {
        var w = await ArrangeAsync();
        await using (var db = w.Store.NewContext())
        {
            var participant = Participant.Create(w.Store.TenantId, w.CycleId, w.Sami, "Sami Ben Ali", "Engineer", null, "Platform", w.Lina,
                "Lina Haddad", false, Start);
            db.Participants.Add(participant);
            var plan = EmployeePlan.Create(w.Store.TenantId, w.CycleId, participant.Id, w.Sami, "Sami Ben Ali", "Platform", w.Lina, "Lina Haddad");
            db.EmployeePlans.Add(plan);
            db.Objectives.Add(Objective.CreateEmployee(w.Store.TenantId, w.CycleId, plan.Id, w.Sami, "A private idea", null, null,
                Start, End, ObjectiveMeasurement.ManualPercentage(), 100m, null, null, Start, End));
            await db.SaveChangesAsync();
        }
        var sami = (await TeamAsync(w, w.Lina)).Value.People.Single(p => p.EmployeeId == w.Sami);
        Assert.Equal(RosterPlanStatus.NotStarted, sami.PlanStatus);
        Assert.Empty(sami.Goals);
    }

    [Fact]
    public void Free_times_are_weekdays_off_leave_and_clear_of_other_1_1s()
    {
        // Thursday 12 November 2026, evening.
        var now = new DateTime(2026, 11, 12, 18, 0, 0, DateTimeKind.Utc);
        var busy = new[] { new DateTime(2026, 11, 13, 10, 0, 0, DateTimeKind.Utc) };
        // On leave Monday 16th only.
        var leave = new WorkforceLeaveSnapshot(new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 17), false);
        var slots = OneOnOneFreeTimes.Find(now, TimeZoneInfo.Utc, busy, [leave, null]);
        Assert.Equal(
        [
            new DateTime(2026, 11, 13, 9, 0, 0, DateTimeKind.Utc),   // Friday: 10:00 taken, the next morning time
            new DateTime(2026, 11, 13, 15, 30, 0, DateTimeKind.Utc),
            new DateTime(2026, 11, 17, 10, 0, 0, DateTimeKind.Utc),  // the weekend and the day of leave skipped
        ], slots);
    }

    [Fact]
    public void Exported_cells_keep_commas_quotes_and_never_start_a_formula()
    {
        Assert.Equal("Engineering", ExportRoundResultsHandler.Cell("Engineering"));
        Assert.Equal("\"Ops, North\"", ExportRoundResultsHandler.Cell("Ops, North"));
        Assert.Equal("\"Said \"\"hi\"\"\"", ExportRoundResultsHandler.Cell("Said \"hi\""));
        Assert.Equal("'=SUM(A1)", ExportRoundResultsHandler.Cell("=SUM(A1)"));
        Assert.Equal("", ExportRoundResultsHandler.Cell(null));
    }
}
