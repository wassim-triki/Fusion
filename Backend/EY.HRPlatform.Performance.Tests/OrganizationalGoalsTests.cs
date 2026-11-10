using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Chunk B — organizational objective alignment, publication, and contribution baseline.
/// <para>
/// Authority to establish/publish a team objective is resolved against the Cycle-start organization:
/// governed Performance administrators may act for any active team, while a holder of
/// `objective.org.manage @Tenant` may act only for their own team. Accountable owners remain able to
/// maintain Draft definitions and record Published progress. Exercises the handlers over the shared
/// in-memory store the way the API does.
/// </para>
/// </summary>
public sealed class OrganizationalGoalsTests
{
    private static readonly DateOnly CycleStart = new(2026, 1, 1);
    private static readonly DateOnly CycleEnd = new(2026, 12, 31);

    private sealed record Fixture(
        TestStore Store,
        FakeCoreWorkforceClient Workforce,
        Guid CycleId,
        Guid StrategicId,
        Guid CooId,
        Guid TalentPodId,
        Guid OtherUnitId,
        Guid NourId,
        Guid OtherMemberId);

    private static async Task<Fixture> ArrangeAsync(bool draftCycle = true)
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var coo = workforce.Add("Coralie Ops");

        // Talent Pod is an ancestor of Delivery Pod in the Cycle-start hierarchy.
        var talentPod = Guid.NewGuid();
        var otherUnit = Guid.NewGuid();
        var nour = workforce.Add("Nour Lead", orgUnitId: talentPod, orgUnitName: "Talent Pod");
        var otherMember = workforce.Add("Delivery Owner", orgUnitId: otherUnit, orgUnitName: "Delivery Pod");
        workforce.OrgUnits[talentPod] = new WorkforceOrgUnitContext(talentPod, "Talent Pod", null, true, []);
        workforce.OrgUnits[otherUnit] = new WorkforceOrgUnitContext(otherUnit, "Delivery Pod", talentPod, true, [talentPod]);

        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY2026", CycleStart, CycleEnd, CycleStart.AddDays(30));
        var strategic = Objective.CreateStrategic(store.TenantId, cycle.Id, "Grow the company", null, coo.EmployeeId,
            CycleStart, CycleEnd, ObjectiveMeasurement.ManualPercentage(), CycleStart, CycleEnd);
        strategic.Publish();

        await using (var db = store.NewContext())
        {
            db.Cycles.Add(cycle);
            db.Objectives.Add(strategic);
            await db.SaveChangesAsync();
            if (!draftCycle)
            {
                var tracked = await db.Cycles.FirstAsync();
                var snapshot = ActivationSnapshot.Capture(store.TenantId, cycle.Id, "FY2026", CycleStart, CycleEnd, CycleStart.AddDays(30), CycleStart, 1, "{}", "{}", "[]", "[]");
                tracked.Activate(snapshot);
                db.Entry(snapshot).State = EntityState.Added;
                await db.SaveChangesAsync();
            }
        }

        return new Fixture(store, workforce, cycle.Id, strategic.Id, coo.EmployeeId, talentPod, otherUnit, nour.EmployeeId, otherMember.EmployeeId);
    }

    // Governed Performance administration (`cycle.manage @Tenant`).
    private static GoalActorContext Admin(Guid id) => new(id, IsAdmin: true, HasOrgManageGrant: false);
    // Holds `objective.org.manage @Tenant`; the handler resolves their Cycle-start team.
    private static GoalActorContext Manager(Guid id) => new(id, IsAdmin: false, HasOrgManageGrant: true);
    // No management authority (ordinary employee / view-only holder).
    private static GoalActorContext Person(Guid id) => new(id, IsAdmin: false, HasOrgManageGrant: false);

    private static CreateOrganizationalObjectiveRequest DirectNumeric(Guid orgUnitId, Guid accountable, Guid parentId, string title = "Improve reliability")
        => new(orgUnitId, "Talent Pod", title, null, accountable, parentId, null, null,
            ObjectiveProgressSource.Direct,
            new MeasurementInput(MeasurementMethod.NumericTarget, 80m, 95m, "%", null));

    private static CreateOrganizationalObjectiveHandler Create(Fixture f, PerformanceDbContext db)
        => new(db, f.Workforce, f.Store.Tenant);

    private static async Task<Result<GoalDetailDto>> CreateAsync(Fixture f, CreateOrganizationalObjectiveRequest request, GoalActorContext actor)
    {
        await using var db = f.Store.NewContext();
        return await Create(f, db).Handle(new CreateOrganizationalObjectiveCommand(f.CycleId, request, actor), default);
    }

    private static async Task<Result<GoalDetailDto>> PublishAsync(Fixture f, Guid objectiveId, GoalActorContext actor)
    {
        await using var db = f.Store.NewContext();
        var result = await new PublishObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
            .Handle(new PublishObjectiveCommand(f.CycleId, objectiveId, actor), default);
        if (result.IsSuccess) await AuditAssertions.RecordedAsync(db, "Objective.Published", objectiveId, f.CycleId);
        return result;
    }

    [Fact]
    public async Task Archive_preserves_children_and_progress_but_excludes_new_alignment_and_is_retry_safe()
    {
        var f = await ArrangeAsync(draftCycle: false);
        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Manager(f.NourId));
        var id = created.Value.Node.Id;
        Assert.True((await PublishAsync(f, id, Manager(f.NourId))).IsSuccess);
        Guid childId;
        await using (var db = f.Store.NewContext())
        {
            var parent = await db.Objectives.Include(o => o.Measurement).SingleAsync(o => o.Id == id);
            parent.ApplyNumericActual(90m);
            db.ProgressUpdates.Add(EY.HRPlatform.Performance.Domain.Progress.ProgressUpdate.RecordNumericActual(f.Store.TenantId, f.CycleId, id, f.NourId, 90m, EY.HRPlatform.Performance.Domain.Progress.ObjectiveStatus.OnTrack, "Delivered", false));
            var plan = EY.HRPlatform.Performance.Domain.Plans.EmployeePlan.Create(f.Store.TenantId, f.CycleId, Guid.NewGuid(), f.OtherMemberId, "Employee", "Delivery Pod", f.NourId, "Manager");
            var child = Objective.CreateEmployee(f.Store.TenantId, f.CycleId, plan.Id, f.OtherMemberId, "Deliver", null, id, CycleStart, CycleEnd, ObjectiveMeasurement.ManualPercentage(), 100m, CycleStart, CycleEnd, CycleStart, CycleEnd);
            childId = child.Id;
            db.EmployeePlans.Add(plan); db.Objectives.Add(child); await db.SaveChangesAsync();
        }
        GoalDetailDto first;
        await using (var db = f.Store.NewContext())
        {
            var result = await new ArchiveObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db)).Handle(new(f.CycleId, id, Manager(f.NourId)), default);
            Assert.True(result.IsSuccess); first = result.Value;
            await AuditAssertions.RecordedAsync(db, "Objective.Archived", id, f.CycleId);
            Assert.Equal(ObjectiveLifecycleState.Archived, first.Node.State);
            Assert.NotNull(first.ArchivedAt);
            Assert.True(first.Node.HasProgress);
            Assert.False(first.CanArchive); Assert.False(first.CanUpdateProgress);
        }
        await using (var db = f.Store.NewContext())
        {
            var again = await new ArchiveObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db)).Handle(new(f.CycleId, id, Manager(f.NourId), uint.MaxValue), default);
            Assert.Equal(first.ArchivedAt, again.Value.ArchivedAt);
            Assert.Single(await db.AuditEntries.Where(e => e.Action == "Objective.Archived" && e.ResourceId == id).ToListAsync());
            Assert.Equal(id, (await db.Objectives.SingleAsync(o => o.Id == childId)).ParentObjectiveId);
            Assert.Single(await db.ProgressUpdates.Where(p => p.ObjectiveId == id).ToListAsync());
            var publicRecord = await new GetGoalDetailHandler(db, f.Workforce).Handle(new(f.CycleId, id, Person(f.OtherMemberId)), default);
            Assert.True(publicRecord.IsSuccess);
            Assert.False(publicRecord.Value.CanArchive);
            Assert.False(publicRecord.Value.CanReadProgressHistory);
            var cycle = await db.Cycles.SingleAsync();
            Assert.DoesNotContain(await TeamObjectivePolicy.EligibleParentsAsync(db, cycle, (await TeamObjectivePolicy.ResolveScopeAsync(f.Workforce, cycle, Admin(f.CooId), f.OtherUnitId, default)).Value, default), o => o.Id == id);
            var graph = await GoalsComposer.LoadGraphAsync(db, f.Workforce, cycle, default);
            Assert.DoesNotContain(EY.HRPlatform.Performance.Features.Plans.PlansComposer.AlignmentTargets(graph), o => o.Id == id);
            var childDetail = await new GetGoalDetailHandler(db, f.Workforce).Handle(new(f.CycleId, childId, Admin(f.CooId)), default);
            Assert.Equal(ObjectiveLifecycleState.Archived, childDetail.Value.Parent!.State);
        }
        var newChild = await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, id), Admin(f.CooId));
        Assert.True(newChild.IsFailure);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task Archive_requires_scope_governance_even_for_the_accountable_person(bool otherTeamManager, bool alreadyArchived)
    {
        var f = await ArrangeAsync();
        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Admin(f.CooId));
        await PublishAsync(f, created.Value.Node.Id, Admin(f.CooId));
        await using var db = f.Store.NewContext();
        if (alreadyArchived) Assert.True((await new ArchiveObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db)).Handle(new(f.CycleId, created.Value.Node.Id, Admin(f.CooId)), default)).IsSuccess);
        var result = await new ArchiveObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db)).Handle(new(f.CycleId, created.Value.Node.Id, otherTeamManager ? Manager(f.OtherMemberId) : Person(f.NourId)), default);
        Assert.Equal("Objective.ArchiveForbidden", result.Error.Code);
        Assert.Equal(alreadyArchived ? ObjectiveLifecycleState.Archived : ObjectiveLifecycleState.Published, (await db.Objectives.SingleAsync(o => o.Id == created.Value.Node.Id)).State);
    }

    // ── Creation & alignment invariants ────────────────────────────────────────────────────

    [Fact]
    public async Task Org_objective_creation_requires_a_published_parent()
    {
        var f = await ArrangeAsync();
        var result = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Admin(f.CooId));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(ObjectiveLifecycleState.Draft, result.Value.Node.State);
        Assert.Equal(f.StrategicId, result.Value.Parent!.Id);
        Assert.Equal(ObjectiveOwnershipScope.OrgUnit, result.Value.Node.OwnershipScope);
    }

    [Fact]
    public async Task Aligning_to_a_draft_parent_is_rejected()
    {
        var f = await ArrangeAsync();

        Guid draftStrategicId;
        await using (var db = f.Store.NewContext())
        {
            var draft = Objective.CreateStrategic(f.Store.TenantId, f.CycleId, "Draft direction", null, f.CooId,
                CycleStart, CycleEnd, ObjectiveMeasurement.ManualPercentage(), CycleStart, CycleEnd);
            db.Objectives.Add(draft);
            await db.SaveChangesAsync();
            draftStrategicId = draft.Id;
        }

        var result = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, draftStrategicId), Admin(f.CooId));
        Assert.True(result.IsFailure);
        Assert.Contains("published", result.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Child_dates_outside_parent_dates_are_rejected()
    {
        var f = await ArrangeAsync();
        var request = new CreateOrganizationalObjectiveRequest(f.TalentPodId, "Talent Pod", "Too long", null, f.NourId, f.StrategicId,
            CycleStart.AddDays(-5), CycleEnd, ObjectiveProgressSource.Direct,
            new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null));
        var result = await CreateAsync(f, request, Admin(f.CooId));

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task Manager_can_create_a_standalone_objective_without_a_team_override()
    {
        var f = await ArrangeAsync();
        var request = new CreateOrganizationalObjectiveRequest(
            null, null, "Build leadership bench", null, f.NourId, null, null, null,
            ObjectiveProgressSource.Direct,
            new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null));

        var created = await CreateAsync(f, request, Manager(f.NourId));

        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        Assert.Null(created.Value.Node.ParentObjectiveId);
        Assert.Equal(f.TalentPodId, created.Value.Node.OrgUnitId);
        Assert.Equal(CycleStart, created.Value.Node.StartDate);
        Assert.Equal(CycleEnd, created.Value.Node.EndDate);
    }

    [Fact]
    public async Task Team_workspace_returns_all_team_objectives_but_org_overview_excludes_standalone_branches()
    {
        var f = await ArrangeAsync();
        var manager = Manager(f.NourId);
        var standalone = await CreateAsync(f, new CreateOrganizationalObjectiveRequest(
            null, null, "Standalone delivery", null, f.NourId, null, null, null,
            ObjectiveProgressSource.Direct,
            new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null)), manager);
        var aligned = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId, "Aligned delivery"), manager);
        Assert.True(standalone.IsSuccess && aligned.IsSuccess);

        await using var db = f.Store.NewContext();
        var workspace = await new GetTeamObjectiveWorkspaceHandler(db, f.Workforce)
            .Handle(new GetTeamObjectiveWorkspaceQuery(f.CycleId, null, manager), default);
        var overview = await new GetGoalsOverviewHandler(db, f.Workforce)
            .Handle(new GetGoalsOverviewQuery(f.CycleId, manager), default);

        Assert.True(workspace.IsSuccess, workspace.IsFailure ? workspace.Error.Message : null);
        Assert.Equal(2, workspace.Value.Objectives.Count);
        Assert.Contains(workspace.Value.Objectives, objective => objective.Node.Id == standalone.Value.Node.Id && objective.Parent is null);
        Assert.Contains(workspace.Value.Objectives, objective => objective.Node.Id == aligned.Value.Node.Id && objective.Parent?.Id == f.StrategicId);
        Assert.DoesNotContain(overview.Value.Nodes, objective => objective.Id == standalone.Value.Node.Id);
        Assert.Contains(overview.Value.Nodes, objective => objective.Id == aligned.Value.Node.Id);
    }

    [Fact]
    public async Task Workspace_returns_every_published_company_direction_without_selecting_one()
    {
        var f = await ArrangeAsync();
        Guid secondDirectionId;
        await using (var db = f.Store.NewContext())
        {
            var second = Objective.CreateStrategic(f.Store.TenantId, f.CycleId, "Expand customer trust", null, f.CooId,
                CycleStart, CycleEnd, ObjectiveMeasurement.ManualPercentage(), CycleStart, CycleEnd);
            second.Publish();
            db.Objectives.Add(second);
            await db.SaveChangesAsync();
            secondDirectionId = second.Id;
        }

        await using var readDb = f.Store.NewContext();
        var workspace = await new GetTeamObjectiveWorkspaceHandler(readDb, f.Workforce)
            .Handle(new GetTeamObjectiveWorkspaceQuery(f.CycleId, null, Manager(f.NourId)), default);

        Assert.True(workspace.IsSuccess, workspace.IsFailure ? workspace.Error.Message : null);
        Assert.Equal(2, workspace.Value.AlignmentTargets.Count);
        Assert.Contains(workspace.Value.AlignmentTargets, target => target.Id == f.StrategicId);
        Assert.Contains(workspace.Value.AlignmentTargets, target => target.Id == secondDirectionId);
    }

    [Fact]
    public async Task Owner_must_be_an_active_direct_member_of_the_selected_team()
    {
        var f = await ArrangeAsync();

        var result = await CreateAsync(
            f,
            DirectNumeric(f.TalentPodId, f.OtherMemberId, f.StrategicId),
            Admin(f.CooId));

        Assert.True(result.IsFailure);
        Assert.Equal("Objective.OwnerOutsideTeam", result.Error.Code);
    }

    [Fact]
    public async Task Inactive_owner_and_cross_cycle_parent_ids_fail_closed()
    {
        var f = await ArrangeAsync();
        var inactive = f.Workforce.Add(
            "Inactive Owner", isActive: false, orgUnitId: f.TalentPodId, orgUnitName: "Talent Pod");
        var inactiveOwner = await CreateAsync(
            f,
            DirectNumeric(f.TalentPodId, inactive.EmployeeId, f.StrategicId),
            Admin(f.CooId));

        Guid otherCycleParentId;
        await using (var db = f.Store.NewContext())
        {
            var otherCycle = PerformanceCycle.CreateDraft(
                f.Store.TenantId, "FY2027", new DateOnly(2027, 1, 1), new DateOnly(2027, 12, 31), new DateOnly(2027, 1, 31));
            var otherParent = Objective.CreateStrategic(
                f.Store.TenantId, otherCycle.Id, "Other cycle direction", null, f.CooId,
                otherCycle.StartDate, otherCycle.EndDate, ObjectiveMeasurement.ManualPercentage(), otherCycle.StartDate, otherCycle.EndDate);
            otherParent.Publish();
            db.Cycles.Add(otherCycle);
            db.Objectives.Add(otherParent);
            await db.SaveChangesAsync();
            otherCycleParentId = otherParent.Id;
        }
        var crossCycle = await CreateAsync(
            f,
            DirectNumeric(f.TalentPodId, f.NourId, otherCycleParentId),
            Admin(f.CooId));

        Assert.True(inactiveOwner.IsFailure);
        Assert.Equal("Objective.OwnerOutsideTeam", inactiveOwner.Error.Code);
        Assert.True(crossCycle.IsFailure);
        Assert.Equal("Objective.AlignmentIneligible", crossCycle.Error.Code);
    }

    [Fact]
    public async Task Same_team_and_disconnected_ancestor_objectives_are_not_eligible_parents()
    {
        var f = await ArrangeAsync();
        var admin = Admin(f.CooId);
        var disconnected = await CreateAsync(f, new CreateOrganizationalObjectiveRequest(
            f.TalentPodId, null, "Local standalone", null, f.NourId, null, null, null,
            ObjectiveProgressSource.Direct,
            new MeasurementInput(MeasurementMethod.ManualPercentage, null, null, null, null)), admin);
        Assert.True(disconnected.IsSuccess);
        Assert.True((await PublishAsync(f, disconnected.Value.Node.Id, admin)).IsSuccess);

        var sameTeam = await CreateAsync(
            f,
            DirectNumeric(f.TalentPodId, f.NourId, disconnected.Value.Node.Id, "Same team child"),
            admin);
        var descendant = await CreateAsync(
            f,
            DirectNumeric(f.OtherUnitId, f.OtherMemberId, disconnected.Value.Node.Id, "Disconnected child"),
            admin);

        Assert.True(sameTeam.IsFailure);
        Assert.True(descendant.IsFailure);
        Assert.Equal("Objective.AlignmentIneligible", sameTeam.Error.Code);
        Assert.Equal("Objective.AlignmentIneligible", descendant.Error.Code);
    }

    [Fact]
    public async Task Draft_alignment_can_be_cleared_but_published_alignment_is_locked()
    {
        var f = await ArrangeAsync();
        var actor = Manager(f.NourId);
        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), actor);
        Assert.True(created.IsSuccess);

        await using (var db = f.Store.NewContext())
        {
            var cleared = await new AlignObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
                .Handle(new AlignObjectiveCommand(f.CycleId, created.Value.Node.Id, new AlignObjectiveRequest(null), actor), default);
            Assert.True(cleared.IsSuccess, cleared.IsFailure ? cleared.Error.Message : null);
            Assert.Null(cleared.Value.Node.ParentObjectiveId);
            await AuditAssertions.RecordedAsync(db, "Objective.Realigned", created.Value.Node.Id, f.CycleId);
        }

        Assert.True((await PublishAsync(f, created.Value.Node.Id, actor)).IsSuccess);
        await using (var db = f.Store.NewContext())
        {
            var realign = await new AlignObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
                .Handle(new AlignObjectiveCommand(f.CycleId, created.Value.Node.Id, new AlignObjectiveRequest(f.StrategicId), actor), default);
            Assert.True(realign.IsFailure);
            Assert.Equal("Objective.NotEditable", realign.Error.Code);
        }
    }

    // ── Organizational-objective management authority (coarse tenant MVP) ───────────────────

    [Fact]
    public async Task Manager_with_the_org_manage_grant_can_create_an_objective()
    {
        var f = await ArrangeAsync();

        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Manager(f.NourId));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        Assert.Equal(ObjectiveLifecycleState.Draft, created.Value.Node.State);
    }

    [Fact]
    public async Task Manager_with_the_org_manage_grant_can_publish_an_objective()
    {
        var f = await ArrangeAsync();

        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Manager(f.NourId));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);

        var published = await PublishAsync(f, created.Value.Node.Id, Manager(f.NourId));
        Assert.True(published.IsSuccess, published.IsFailure ? published.Error.Message : null);
        Assert.Equal(ObjectiveLifecycleState.Published, published.Value.Node.State);
        Assert.True(published.Value.Node.IsAlignmentBaseline);
    }

    [Fact]
    public async Task Manager_cannot_forge_another_org_unit()
    {
        var f = await ArrangeAsync();

        var created = await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.NourId, f.StrategicId, "Cross-unit goal"), Manager(f.NourId));
        Assert.True(created.IsFailure);
        Assert.Contains("own team", created.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Team_objective_detail_is_visible_only_to_its_governors_and_accountable_owner()
    {
        var f = await ArrangeAsync();
        var created = await CreateAsync(
            f,
            DirectNumeric(f.OtherUnitId, f.OtherMemberId, f.StrategicId, "Delivery objective"),
            Admin(f.CooId));
        Assert.True(created.IsSuccess);

        await using var db = f.Store.NewContext();
        var handler = new GetGoalDetailHandler(db, f.Workforce);
        var outsideManager = await handler.Handle(
            new GetGoalDetailQuery(f.CycleId, created.Value.Node.Id, Manager(f.NourId)), default);
        var accountableOwner = await handler.Handle(
            new GetGoalDetailQuery(f.CycleId, created.Value.Node.Id, Person(f.OtherMemberId)), default);
        var admin = await handler.Handle(
            new GetGoalDetailQuery(f.CycleId, created.Value.Node.Id, Admin(f.CooId)), default);

        Assert.True(outsideManager.IsFailure);
        Assert.Equal("Objective.ViewForbidden", outsideManager.Error.Code);
        Assert.True(accountableOwner.IsSuccess);
        Assert.True(admin.IsSuccess);
    }

    [Fact]
    public async Task Realignment_through_the_edit_form_is_audited_with_both_parents()
    {
        var f = await ArrangeAsync();
        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Manager(f.NourId));
        await using var db = f.Store.NewContext();
        var result = await new UpdateOrganizationalObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db)).Handle(
            new(f.CycleId, created.Value.Node.Id,
                new("Delivery", null, f.NourId, null, CycleStart, CycleEnd, ObjectiveProgressSource.Direct,
                    new(MeasurementMethod.ManualPercentage, null, null, null, null)), Manager(f.NourId)), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        var entry = Assert.Single(await db.AuditEntries.ToListAsync());
        await AuditAssertions.RecordedAsync(db, "Objective.Realigned", created.Value.Node.Id, f.CycleId);
        using var summary = System.Text.Json.JsonDocument.Parse(entry.Summary);
        Assert.Equal(f.StrategicId.ToString(), summary.RootElement.GetProperty("before").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, summary.RootElement.GetProperty("after").ValueKind);
    }

    [Fact]
    public async Task Reassigning_the_accountable_person_does_not_remove_the_managers_authority()
    {
        var f = await ArrangeAsync();
        var other = f.Workforce.Add("Other Person", orgUnitId: f.TalentPodId, orgUnitName: "Talent Pod");

        // Nour creates with herself accountable (the composer default), then hands accountability off.
        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Manager(f.NourId));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);
        var objectiveId = created.Value.Node.Id;

        await using (var db = f.Store.NewContext())
        {
            var reassign = await new UpdateOrganizationalObjectiveHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db)).Handle(
                new UpdateOrganizationalObjectiveCommand(f.CycleId, objectiveId,
                    new UpdateOrganizationalObjectiveRequest("Improve reliability", null, other.EmployeeId, f.StrategicId, CycleStart, CycleEnd,
                        ObjectiveProgressSource.Direct, new MeasurementInput(MeasurementMethod.NumericTarget, 80m, 95m, "%", null)),
                    Manager(f.NourId)), default);
            Assert.True(reassign.IsSuccess, reassign.IsFailure ? reassign.Error.Message : null);
            Assert.Equal(other.EmployeeId, reassign.Value.Accountable.Id);
        }

        // The new accountable person, holding no management authority, cannot publish it.
        var newAccountableAttempt = await PublishAsync(f, objectiveId, Person(other.EmployeeId));
        Assert.True(newAccountableAttempt.IsFailure);
        Assert.Contains("Forbidden", newAccountableAttempt.Error.Code, StringComparison.OrdinalIgnoreCase);

        // Nour, still the authorized manager, can still edit and publish it.
        var published = await PublishAsync(f, objectiveId, Manager(f.NourId));
        Assert.True(published.IsSuccess, published.IsFailure ? published.Error.Message : null);
        Assert.Equal(ObjectiveLifecycleState.Published, published.Value.Node.State);
    }

    [Fact]
    public async Task Employee_without_the_manage_grant_cannot_create()
    {
        var f = await ArrangeAsync();
        var employee = f.Workforce.Add("Talent Employee", orgUnitId: f.TalentPodId);

        var result = await CreateAsync(f, DirectNumeric(f.TalentPodId, employee.EmployeeId, f.StrategicId), Person(employee.EmployeeId));
        Assert.True(result.IsFailure);
        Assert.Contains("Forbidden", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task View_only_holder_cannot_publish()
    {
        var f = await ArrangeAsync();
        var viewer = f.Workforce.Add("Viewer", orgUnitId: f.TalentPodId);

        var created = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Admin(f.CooId));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);

        var result = await PublishAsync(f, created.Value.Node.Id, Person(viewer.EmployeeId));
        Assert.True(result.IsFailure);
        Assert.Contains("Forbidden", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Governed_admin_remains_authorized_to_create_and_publish()
    {
        var f = await ArrangeAsync();
        var adminId = Guid.NewGuid();

        var created = await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, f.StrategicId, "Admin-established"), Admin(adminId));
        Assert.True(created.IsSuccess, created.IsFailure ? created.Error.Message : null);

        var published = await PublishAsync(f, created.Value.Node.Id, Admin(adminId));
        Assert.True(published.IsSuccess, published.IsFailure ? published.Error.Message : null);
        Assert.Equal(ObjectiveLifecycleState.Published, published.Value.Node.State);
    }

    // ── Baseline & contribution (admin-driven; authority covered above) ─────────────────────

    [Fact]
    public async Task Published_parent_becomes_a_valid_baseline_for_downstream_objectives()
    {
        var f = await ArrangeAsync();

        var ops = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId, "Ops"), Admin(f.CooId));
        Assert.True(ops.IsSuccess, ops.IsFailure ? ops.Error.Message : null);
        var opsId = ops.Value.Node.Id;
        Assert.True((await PublishAsync(f, opsId, Admin(f.CooId))).IsSuccess);

        var child = await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, opsId, "Cut response time"), Admin(f.CooId));
        Assert.True(child.IsSuccess, child.IsFailure ? child.Error.Message : null);
        Assert.Equal(opsId, child.Value.Parent!.Id);
    }

    [Fact]
    public async Task A_draft_child_cannot_be_a_downstream_alignment_baseline()
    {
        var f = await ArrangeAsync();

        var ops = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId, "Ops"), Admin(f.CooId));
        Assert.True(ops.IsSuccess, ops.IsFailure ? ops.Error.Message : null);

        // Ops is never published, so it is not yet an alignment baseline.
        var child = await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, ops.Value.Node.Id, "Cut response time"), Admin(f.CooId));
        Assert.True(child.IsFailure);
        Assert.Contains("published", child.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Calculated_baseline_locks_only_at_100_percent_over_published_children()
    {
        var f = await ArrangeAsync();
        var admin = Admin(f.CooId);

        var opsId = await CreateCalculatedAsync(f, f.NourId, f.StrategicId, admin);
        Assert.True((await PublishAsync(f, opsId, admin)).IsSuccess);

        var childA = (await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, opsId, "Child A"), admin)).Value.Node.Id;
        var childB = (await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, opsId, "Child B"), admin)).Value.Node.Id;
        Assert.True((await PublishAsync(f, childA, admin)).IsSuccess);
        Assert.True((await PublishAsync(f, childB, admin)).IsSuccess);

        // 60/30 = 90% cannot lock.
        await using (var db = f.Store.NewContext())
        {
            var configured = await new ConfigureContributionHandler(db, f.Workforce, f.Store.Tenant).Handle(
                new ConfigureContributionCommand(f.CycleId, opsId,
                    new ConfigureContributionRequest([new ContributionInput(childA, 60m), new ContributionInput(childB, 30m)]), admin), default);
            Assert.True(configured.IsSuccess, configured.IsFailure ? configured.Error.Message : null);
            Assert.Equal(90m, configured.Value.Node.ContributionWeightTotal);
        }
        await using (var db = f.Store.NewContext())
        {
            var lockedTooEarly = await new LockContributionHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
                .Handle(new LockContributionCommand(f.CycleId, opsId, admin), default);
            Assert.True(lockedTooEarly.IsFailure);
        }

        // Correct to 60/40 = 100% and lock.
        await using (var db = f.Store.NewContext())
            await new ConfigureContributionHandler(db, f.Workforce, f.Store.Tenant).Handle(
                new ConfigureContributionCommand(f.CycleId, opsId,
                    new ConfigureContributionRequest([new ContributionInput(childA, 60m), new ContributionInput(childB, 40m)]), admin), default);
        await using (var db = f.Store.NewContext())
        {
            var locked = await new LockContributionHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
                .Handle(new LockContributionCommand(f.CycleId, opsId, admin), default);
            Assert.True(locked.IsSuccess, locked.IsFailure ? locked.Error.Message : null);
            Assert.True(locked.Value.Node.IsContributionBaselineLocked);
            await AuditAssertions.RecordedAsync(db, "Contribution.BaselineLocked", opsId, f.CycleId);
            Assert.True((await new LockContributionHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
                .Handle(new(f.CycleId, opsId, admin), default)).IsSuccess);
            Assert.Single(await db.AuditEntries.Where(e => e.Action == "Contribution.BaselineLocked" && e.ResourceId == opsId).ToListAsync());
        }
    }

    [Fact]
    public async Task Calculated_baseline_cannot_lock_while_a_contributor_is_still_draft()
    {
        var f = await ArrangeAsync();
        var admin = Admin(f.CooId);

        var opsId = await CreateCalculatedAsync(f, f.NourId, f.StrategicId, admin);
        Assert.True((await PublishAsync(f, opsId, admin)).IsSuccess);

        var childA = (await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, opsId, "Child A"), admin)).Value.Node.Id;
        var childB = (await CreateAsync(f, DirectNumeric(f.OtherUnitId, f.OtherMemberId, opsId, "Child B"), admin)).Value.Node.Id;
        Assert.True((await PublishAsync(f, childA, admin)).IsSuccess); // childB stays Draft

        await using (var db = f.Store.NewContext())
            await new ConfigureContributionHandler(db, f.Workforce, f.Store.Tenant).Handle(
                new ConfigureContributionCommand(f.CycleId, opsId,
                    new ConfigureContributionRequest([new ContributionInput(childA, 60m), new ContributionInput(childB, 40m)]), admin), default);
        await using (var db = f.Store.NewContext())
        {
            var locked = await new LockContributionHandler(db, f.Workforce, f.Store.Tenant, new TestPerformanceAudit(db))
                .Handle(new LockContributionCommand(f.CycleId, opsId, admin), default);
            Assert.True(locked.IsFailure);
            Assert.Contains("published", locked.Error.Message, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Only_aligned_children_may_be_configured_as_contributors()
    {
        var f = await ArrangeAsync();
        var admin = Admin(f.CooId);
        var opsId = await CreateCalculatedAsync(f, f.NourId, f.StrategicId, admin);

        await using var db = f.Store.NewContext();
        var result = await new ConfigureContributionHandler(db, f.Workforce, f.Store.Tenant).Handle(
            new ConfigureContributionCommand(f.CycleId, opsId,
                new ConfigureContributionRequest([new ContributionInput(Guid.NewGuid(), 100m)]), admin), default);

        Assert.True(result.IsFailure);
        Assert.Contains("aligned children", result.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Direct_and_calculated_are_mutually_exclusive()
    {
        var f = await ArrangeAsync();
        Assert.Throws<ArgumentException>(() =>
            Objective.CreateOrganizational(f.Store.TenantId, f.CycleId, Guid.NewGuid(), "Ops", "X", null, Guid.NewGuid(), f.StrategicId,
                CycleStart, CycleEnd, ObjectiveProgressSource.Calculated,
                ObjectiveMeasurement.ManualPercentage(), CycleStart, CycleEnd, CycleStart, CycleEnd));
    }

    [Fact]
    public async Task Organizational_planning_is_rejected_on_a_closed_cycle()
    {
        var f = await ArrangeAsync(draftCycle: false);
        await using (var db = f.Store.NewContext())
        {
            var cycle = await db.Cycles.FirstAsync();
            cycle.Close();
            await db.SaveChangesAsync();
        }

        var result = await CreateAsync(f, DirectNumeric(f.TalentPodId, f.NourId, f.StrategicId), Admin(f.CooId));
        Assert.True(result.IsFailure);
        Assert.Contains("Closed", result.Error.Code, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Reassigning_accountability_preserves_ownership_scope()
    {
        var tenant = Guid.NewGuid();
        var objective = Objective.CreateOrganizational(tenant, Guid.NewGuid(), Guid.NewGuid(), "Ops", "Reliability", null,
            Guid.NewGuid(), Guid.NewGuid(), CycleStart, CycleEnd, ObjectiveProgressSource.Direct,
            ObjectiveMeasurement.ManualPercentage(), CycleStart, CycleEnd, CycleStart, CycleEnd);

        objective.ReassignAccountablePerson(Guid.NewGuid());
        Assert.Equal(ObjectiveOwnershipScope.OrgUnit, objective.OwnershipScope);
    }

    private static async Task<Guid> CreateCalculatedAsync(Fixture f, Guid accountable, Guid parentId, GoalActorContext actor)
    {
        var request = new CreateOrganizationalObjectiveRequest(f.TalentPodId, "Talent Pod", "Operational excellence", null,
            accountable, parentId, null, null, ObjectiveProgressSource.Calculated, null);
        var result = await CreateAsync(f, request, actor);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value.Node.Id;
    }
}
