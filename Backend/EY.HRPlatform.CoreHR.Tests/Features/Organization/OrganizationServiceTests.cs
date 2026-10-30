using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Organization;

public sealed class OrganizationServiceTests
{
    [Fact]
    public async Task Future_root_keeps_current_hierarchy_empty_and_not_ready()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);

        await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", tomorrow), default);

        var current = await service.GetHierarchyAsync(tomorrow.AddDays(-1), default);
        var readiness = await service.GetReadinessAsync(default);

        Assert.Empty(current.Roots);
        Assert.False(readiness.IsReady);
    }

    [Fact]
    public async Task Unit_detail_path_contains_each_ancestor_and_the_unit_once()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var division = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("OPS", "Operations", OrganizationalUnitTypeCatalog.DivisionId, root.Id, today), default);
        var team = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("ENG", "Engineering", OrganizationalUnitTypeCatalog.TeamId, division.Id, today), default);

        var detail = await service.GetUnitAsync(team.Id, today, default);

        Assert.Equal("Fusion / Operations / Engineering", detail.Path);
    }

    [Fact]
    public async Task Scheduled_operations_on_the_same_date_remain_individually_cancellable()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var future = today.AddDays(7);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var unit = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);

        await service.ChangeAsync(unit.Id, unit.Version, new ChangeOrganizationUnitRequest("Engineering", null, future), default);
        var changed = await service.GetUnitAsync(unit.Id, today, default);
        await service.MoveAsync(unit.Id, changed.Version, new MoveOrganizationUnitRequest(root.Id, future), default);
        var upcoming = await service.GetUpcomingChangesAsync(default);

        Assert.Equal(2, upcoming.Count(change => change.OrgUnitId == unit.Id));
        var rename = upcoming.Single(change => change.OrgUnitId == unit.Id && change.Kind == OrganizationChangeKind.Change);
        var latest = await service.GetUnitAsync(unit.Id, today, default);
        await service.CancelChangeAsync(rename.Id, latest.Version, default);

        var remaining = await service.GetUpcomingChangesAsync(default);
        Assert.DoesNotContain(remaining, change => change.Id == rename.Id);
        Assert.Contains(remaining, change => change.OrgUnitId == unit.Id && change.Kind == OrganizationChangeKind.Move);
    }

    [Fact]
    public async Task Custom_type_cannot_reuse_a_built_in_display_name()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));

        await service.GetTypesAsync(default);

        await Assert.ThrowsAsync<DuplicateEntityException>(() => service.CreateTypeAsync(new CreateOrganizationalUnitTypeRequest("Department"), default));
    }

    [Fact]
    public async Task Inactivation_is_terminal()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var unit = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);
        await service.InactivateAsync(unit.Id, unit.Version, new InactivateOrganizationUnitRequest(today, "Retired"), default);
        var current = await service.GetUnitAsync(unit.Id, today, default);

        await Assert.ThrowsAsync<ArgumentException>(() => service.CorrectAsync(
            unit.Id,
            current.Version,
            new CorrectOrganizationUnitRequest(null, null, null, OrgUnitLifecycleState.Active, today, "Undo retirement"),
            default));
    }

    [Fact]
    public async Task Structural_changes_preserve_existing_work_assignment_org_unit_identity()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var unit = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);
        var assignment = WorkAssignment.Create(tenantId, Guid.NewGuid(), Guid.NewGuid(), unit.Id, TestCatalog.Job(tenantId, "Engineer"), TestCatalog.Place(tenantId, null), true,
            DateTime.UtcNow, null, EY.HRPlatform.CoreHR.Domain.Enums.WorkforceSourceType.Manual);
        db.WorkAssignments.Add(assignment);
        await db.SaveChangesAsync();

        await service.ChangeAsync(unit.Id, unit.Version,
            new ChangeOrganizationUnitRequest("Engineering", null, today, "Rename"), default);

        Assert.Equal(unit.Id, (await db.WorkAssignments.SingleAsync()).OrgUnitId);
    }

    [Fact]
    public async Task Names_are_repeatable_but_business_codes_are_not()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);

        var first = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("OPS-A", "Operations", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);
        var second = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("OPS-B", "Operations", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);

        Assert.NotEqual(first.Id, second.Id);
        await Assert.ThrowsAsync<DuplicateEntityException>(() => service.CreateUnitAsync(
            new CreateOrganizationUnitRequest("OPS-A", "Other", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default));
    }

    [Fact]
    public async Task Correction_cannot_be_scheduled_for_the_future()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);

        await Assert.ThrowsAsync<ArgumentException>(() => service.CorrectAsync(root.Id, root.Version,
            new CorrectOrganizationUnitRequest("Corrected", null, null, null, today.AddDays(1), "Correction"), default));
    }

    [Fact]
    public async Task Code_correction_reserves_both_the_previous_and_corrected_code_to_the_same_identity()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var unit = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);

        await service.CorrectCodeAsync(unit.Id, unit.Version, new CorrectOrganizationCodeRequest("ENGINEERING", "Code correction"), default);

        await Assert.ThrowsAsync<DuplicateEntityException>(() => service.CreateUnitAsync(
            new CreateOrganizationUnitRequest("TECH", "Another", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default));
        await Assert.ThrowsAsync<DuplicateEntityException>(() => service.CreateUnitAsync(
            new CreateOrganizationUnitRequest("ENGINEERING", "Another", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default));
    }

    [Fact]
    public async Task History_exposes_structured_created_rename_and_type_change_context()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var unit = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);
        var renamed = await service.ChangeAsync(unit.Id, unit.Version,
            new ChangeOrganizationUnitRequest("Engineering", null, today.AddDays(1)), default);
        await service.ChangeAsync(unit.Id, renamed.Version,
            new ChangeOrganizationUnitRequest(null, OrganizationalUnitTypeCatalog.TeamId, today.AddDays(2)), default);

        var history = await service.GetHistoryAsync(unit.Id, default);
        var created = history.Single(change => change.Kind == OrganizationChangeKind.Create);
        var renamedEvent = history.Single(change => change.BusinessEventKinds.Contains(OrganizationBusinessEventKind.Renamed));
        var typeChanged = history.Single(change => change.BusinessEventKinds.Contains(OrganizationBusinessEventKind.TypeChanged));

        Assert.Equal("Technology", created.UnitName);
        Assert.Equal("TECH", created.UnitCode);
        Assert.Contains(OrganizationBusinessEventKind.Created, created.BusinessEventKinds);
        Assert.Equal(root.Id, created.After!.Parent!.Id);
        Assert.Equal("Technology", renamedEvent.Before!.Name);
        Assert.Equal("Engineering", renamedEvent.After!.Name);
        Assert.Equal("Department", typeChanged.Before!.Type.Name);
        Assert.Equal("Team", typeChanged.After!.Type.Name);
    }

    [Fact]
    public async Task Upcoming_changes_expose_move_and_inactivation_context_without_conflating_name_and_code()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var future = today.AddDays(7);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today), default);
        var consulting = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("CONS", "Consulting", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);
        var commercial = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("COMM", "Commercial", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today), default);
        var technology = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.TeamId, consulting.Id, today), default);
        var moved = await service.MoveAsync(technology.Id, technology.Version, new MoveOrganizationUnitRequest(commercial.Id, future), default);
        await service.InactivateAsync(technology.Id, moved.Version, new InactivateOrganizationUnitRequest(future.AddDays(1), "Retired"), default);

        var upcoming = await service.GetUpcomingChangesAsync(default);
        var move = upcoming.Single(change => change.BusinessEventKinds.Contains(OrganizationBusinessEventKind.Moved));
        var inactivation = upcoming.Single(change => change.BusinessEventKinds.Contains(OrganizationBusinessEventKind.Inactivated));

        Assert.Equal("Technology", move.UnitName);
        Assert.Equal("TECH", move.UnitCode);
        Assert.Equal(consulting.Id, move.Before!.Parent!.Id);
        Assert.Equal(commercial.Id, move.After!.Parent!.Id);
        Assert.Equal(OrgUnitLifecycleState.Active, inactivation.Before!.LifecycleState);
        Assert.Equal(OrgUnitLifecycleState.Inactive, inactivation.After!.LifecycleState);
    }

    [Fact]
    public async Task Historical_correction_repairs_as_of_truth_without_creating_a_business_history_event()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var past = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-2);
        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", past), default);
        var unit = await service.CreateUnitAsync(new CreateOrganizationUnitRequest("TECH", "Technology", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, past), default);

        await service.CorrectAsync(unit.Id, unit.Version,
            new CorrectOrganizationUnitRequest("Corrected Technology", null, null, null, past, "Fix recorded truth"), default);

        var resolved = await service.GetUnitAsync(unit.Id, past, default);
        var history = await service.GetHistoryAsync(unit.Id, default);
        Assert.Equal("Corrected Technology", resolved.Name);
        Assert.DoesNotContain(history, change => change.Kind == OrganizationChangeKind.Correction);
        Assert.All(history, change => Assert.NotEmpty(change.BusinessEventKinds));
    }

    [Fact]
    public async Task Readiness_distinguishes_no_root_future_root_and_effective_root()
    {
        var tenantId = Guid.NewGuid();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId));
        var service = new OrganizationService(db, TestTenantContext.WithTenant(tenantId));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var noRoot = await service.GetReadinessAsync(default);
        Assert.False(noRoot.HasPermanentRoot);
        Assert.False(noRoot.IsReady);

        var root = await service.CreateRootAsync(new CreateOrganizationRootRequest("ORG", "Fusion", today.AddDays(1)), default);
        var futureRoot = await service.GetReadinessAsync(default);
        Assert.True(futureRoot.HasPermanentRoot);
        Assert.Equal(root.Id, futureRoot.PermanentRootId);
        Assert.Equal(today.AddDays(1), futureRoot.PermanentRootFirstEffectiveDate);
        Assert.False(futureRoot.IsPermanentRootEffective);
        Assert.False(futureRoot.IsReady);

        var effectiveTenantId = Guid.NewGuid();
        await using var effectiveDb = TestDbContextFactory.Create(TestTenantContext.WithTenant(effectiveTenantId));
        var effectiveService = new OrganizationService(effectiveDb, TestTenantContext.WithTenant(effectiveTenantId));
        var effectiveRoot = await effectiveService.CreateRootAsync(new CreateOrganizationRootRequest("EFFECTIVE", "Effective Fusion", today), default);
        var effectiveRootReadiness = await effectiveService.GetReadinessAsync(default);
        Assert.Equal(effectiveRoot.Id, effectiveRootReadiness.PermanentRootId);
        Assert.True(effectiveRootReadiness.IsPermanentRootEffective);
        Assert.True(effectiveRootReadiness.IsReady);
    }
}
