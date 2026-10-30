using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using DomainTenantSettings = EY.HRPlatform.CoreHR.Domain.Entities.TenantSettings;

namespace EY.HRPlatform.CoreHR.Tests.Features.Workforce;

public class WorkforceContractServiceTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private const string SettingsJson = """{"employeeFieldConfig":{"jobTitle":{"visible":true,"required":false,"visibleToEmployee":true,"visibleToManager":true}},"orgUnitTypes":["Department","Team"]}""";

    [Fact]
    public async Task InternalOrgUnitSnapshot_uses_the_requested_date_and_returns_ordered_ancestors()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var root = OrgUnit.CreateCanonical(TenantId, "ROOT", isRoot: true);
        var oldDivision = OrgUnit.CreateCanonical(TenantId, "OLD", isRoot: false);
        var newDivision = OrgUnit.CreateCanonical(TenantId, "NEW", isRoot: false);
        var team = OrgUnit.CreateCanonical(TenantId, "TEAM", isRoot: false);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.OrganizationalUnitTypes.Add(
                OrganizationalUnitType.CreateBuiltIn(OrganizationalUnitTypeCatalog.UnitId, "Unit"));
            seedContext.OrgUnits.AddRange(root, oldDivision, newDivision, team);
            seedContext.OrgUnitEffectiveStates.AddRange(
                OrgUnitEffectiveState.Create(TenantId, root.Id, OrganizationalUnitTypeCatalog.UnitId, null, "Fusion", OrgUnitLifecycleState.Active, new DateOnly(2025, 1, 1)),
                OrgUnitEffectiveState.Create(TenantId, oldDivision.Id, OrganizationalUnitTypeCatalog.UnitId, root.Id, "Operations", OrgUnitLifecycleState.Active, new DateOnly(2025, 1, 1)),
                OrgUnitEffectiveState.Create(TenantId, newDivision.Id, OrganizationalUnitTypeCatalog.UnitId, root.Id, "People", OrgUnitLifecycleState.Active, new DateOnly(2025, 1, 1)),
                OrgUnitEffectiveState.Create(TenantId, team.Id, OrganizationalUnitTypeCatalog.UnitId, oldDivision.Id, "Talent", OrgUnitLifecycleState.Active, new DateOnly(2025, 1, 1), new DateOnly(2026, 7, 1)),
                OrgUnitEffectiveState.Create(TenantId, team.Id, OrganizationalUnitTypeCatalog.UnitId, newDivision.Id, "Talent", OrgUnitLifecycleState.Active, new DateOnly(2026, 7, 1)));
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = new InternalWorkforceSnapshotService(context);

        var atCycleStart = Assert.Single(await service.ResolveOrgUnitsAsync(
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), [team.Id], default));
        var afterReorganization = Assert.Single(await service.ResolveOrgUnitsAsync(
            new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc), [team.Id], default));

        Assert.Equal([root.Id, oldDivision.Id], atCycleStart.AncestorOrgUnitIds);
        Assert.Equal([root.Id, newDivision.Id], afterReorganization.AncestorOrgUnitIds);
    }

    [Fact]
    public async Task GetEmployeeAsync_ManagerCanReadDirectReportButNotPeer()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid managerId;
        Guid directReportId;
        Guid peerId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            await seedContext.SaveChangesAsync();

            var manager = Employee.Create(TenantId, "Alex", "Manager", "alex.manager@example.com", now, jobTitle: "Manager", employeeNumber: "E-100");
            var otherManager = Employee.Create(TenantId, "Jamie", "Leader", "jamie.leader@example.com", now, jobTitle: "Manager", employeeNumber: "E-101");
            var directReport = Employee.Create(TenantId, "Casey", "Report", "casey.report@example.com", now, jobTitle: "Analyst", employeeNumber: "E-102");
            var peer = Employee.Create(TenantId, "Morgan", "Peer", "morgan.peer@example.com", now, jobTitle: "Analyst", employeeNumber: "E-103");

            seedContext.Employees.AddRange(manager, otherManager, directReport, peer);
            await seedContext.SaveChangesAsync();

            var (_, managerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, manager.Id, orgUnit.Id, "Manager", now);
            var (_, otherManagerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, otherManager.Id, orgUnit.Id, "Manager", now);
            var (_, directReportAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, directReport.Id, orgUnit.Id, "Analyst", now);
            var (_, peerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, peer.Id, orgUnit.Id, "Analyst", now);
            await AddPrimaryManagerRelationshipAsync(seedContext, directReport.Id, manager.Id, directReportAssignment.Id, managerAssignment.Id, now);
            await AddPrimaryManagerRelationshipAsync(seedContext, peer.Id, otherManager.Id, peerAssignment.Id, otherManagerAssignment.Id, now);

            managerId = manager.Id;
            directReportId = directReport.Id;
            peerId = peer.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var managerPrincipal = CreatePrincipal(Guid.NewGuid(), PlatformRole.Manager, managerId);

        var visibleDirectReport = await service.GetEmployeeAsync(directReportId, managerPrincipal, CancellationToken.None);
        var hiddenPeer = await service.GetEmployeeAsync(peerId, managerPrincipal, CancellationToken.None);

        Assert.NotNull(visibleDirectReport);
        Assert.Equal("E-102", visibleDirectReport!.EmployeeNumber);
        Assert.Null(hiddenPeer);
    }

    [Fact]
    public async Task GetPublishedOrgUnitsAsync_ReturnsStableKeysAndPaths()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            var root = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(root);
            await seedContext.SaveChangesAsync();

            var child = OrgUnit.Create(TenantId, "ENG-PLT", "Platform Team", "Team", root.Id);
            seedContext.OrgUnits.Add(child);
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var orgUnits = await service.GetPublishedOrgUnitsAsync(false, CancellationToken.None);

        Assert.Equal(2, orgUnits.Count);
        var platformTeam = orgUnits.Single(unit => unit.StableKey == "ENG-PLT");
        Assert.Equal("ENG", platformTeam.ParentStableKey);
        Assert.Equal("Engineering / Platform Team", platformTeam.Path);
    }

    [Fact]
    public async Task GetAccessRosterSummaryAsync_ReturnsTenantHeadcountBreakdown()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seedContext.OrgUnits.Add(orgUnit);
            await seedContext.SaveChangesAsync();

            var activeEmployee = Employee.Create(
                TenantId,
                "Alex",
                "Active",
                "alex.active@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-200");
            var inactiveEmployee = Employee.Create(
                TenantId,
                "Iris",
                "Inactive",
                "iris.inactive@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-201");

            seedContext.Employees.AddRange(activeEmployee, inactiveEmployee);
            await seedContext.SaveChangesAsync();

            await AddActiveEmploymentWithAssignmentAsync(seedContext, activeEmployee.Id, orgUnit.Id, "Analyst", DateTime.UtcNow.AddMonths(-1));
            var (inactiveEmployment, inactiveAssignment) = await AddActiveEmploymentWithAssignmentAsync(seedContext, inactiveEmployee.Id, orgUnit.Id, "Analyst", DateTime.UtcNow.AddMonths(-1));
            inactiveAssignment.End(DateTime.UtcNow.AddDays(-1));
            inactiveEmployment.End(DateTime.UtcNow.AddDays(-1));
            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var summary = await service.GetAccessRosterSummaryAsync(CancellationToken.None);

        Assert.Equal(2, summary.TotalCount);
        Assert.Equal(2, summary.NotInvitedCount);
        Assert.Equal(0, summary.InvitePendingCount);
        Assert.Equal(0, summary.ActiveAccountCount);
        Assert.Equal(0, summary.NeedsReviewCount);
    }

    [Fact]
    public async Task SearchAccessSubjectsAsync_UsesOperationalStateLabelsAndInviteCopy()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        Guid notInvitedId;
        Guid pendingId;
        Guid activeId;
        var inviteCreatedAt = new DateTime(2026, 6, 6, 10, 0, 0, DateTimeKind.Utc);
        var lastLoginAt = new DateTime(2026, 6, 7, 8, 30, 0, DateTimeKind.Utc);

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            var notInvited = Employee.Create(
                TenantId,
                "Alex",
                "Ready",
                "alex.ready@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-300");
            var pending = Employee.Create(
                TenantId,
                "Blair",
                "Pending",
                "blair.pending@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-301");
            var active = Employee.Create(
                TenantId,
                "Casey",
                "Active",
                "casey.active@example.com",
                DateTime.UtcNow,
                jobTitle: "Manager",
                employeeNumber: "E-302");

            seedContext.Employees.AddRange(notInvited, pending, active);
            await seedContext.SaveChangesAsync();

            notInvitedId = notInvited.Id;
            pendingId = pending.Id;
            activeId = active.Id;
        }

        var statuses = new Dictionary<Guid, WorkforceAccountStatusDto>
        {
            [pendingId] = new(
                pendingId,
                "blair.pending@example.com",
                "Blair Pending",
                "Employee",
                [new WorkforceAccountAccessProfileDto(Guid.NewGuid(), "Employee", "SystemSeeded", true)],
                "InvitePending",
                null,
                false,
                null,
                Guid.NewGuid(),
                inviteCreatedAt,
                inviteCreatedAt.AddDays(7),
                "https://example.com/invite/blair",
                "Suppressed",
                null,
                inviteCreatedAt,
                null),
            [activeId] = new(
                activeId,
                "casey.active@example.com",
                "Casey Active",
                "Manager",
                [new WorkforceAccountAccessProfileDto(Guid.NewGuid(), "Manager", "SystemSeeded", true)],
                "Active",
                Guid.NewGuid(),
                true,
                lastLoginAt,
                null,
                null,
                null,
                null,
                null,
                null,
                lastLoginAt,
                null),
        };

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(
            context,
            tenantContext,
            new StaticWorkforceAccountStatusReader(statuses));

        var result = await service.SearchAccessSubjectsAsync(
            search: null,
            access: null,
            profileId: null,
            employeeStatus: null,
            deliveryState: null,
            employeeKey: null,
            baseline: null,
            cohort: null,
            orgUnitId: null,
            includeDescendants: true,
            page: 1,
            pageSize: 20,
            cancellationToken: CancellationToken.None);

        Assert.Equal(3, result.TotalCount);

        var notInvitedItem = Assert.Single(result.Items.Where(item => item.EmployeeId == notInvitedId));
        Assert.Equal("NotInvited", notInvitedItem.AccessState);
        Assert.Equal("Not invited", notInvitedItem.AccessStateLabel);
        Assert.Equal("Not sent", notInvitedItem.InvitationLabel);
        Assert.Equal("No activity", notInvitedItem.LastActivityLabel);

        var pendingItem = Assert.Single(result.Items.Where(item => item.EmployeeId == pendingId));
        Assert.Equal("InvitePending", pendingItem.AccessState);
        Assert.Equal("Invite pending", pendingItem.AccessStateLabel);
        Assert.Equal("Pending", pendingItem.InvitationLabel);
        Assert.Equal("No activity", pendingItem.LastActivityLabel);

        var activeItem = Assert.Single(result.Items.Where(item => item.EmployeeId == activeId));
        Assert.Equal("ActiveAccount", activeItem.AccessState);
        Assert.Equal("Active account", activeItem.AccessStateLabel);
        Assert.Equal("Accepted", activeItem.InvitationLabel);
        Assert.Equal("Activated Jun 7", activeItem.LastActivityLabel);
    }

    [Fact]
    public async Task SearchAccessSubjectsAsync_ClassifiesInactiveAsSuspendedAndConflictAsNeedsReview()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        Guid inactiveId;
        Guid conflictId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            var inactive = Employee.Create(
                TenantId,
                "Iris",
                "Inactive",
                "iris.inactive@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-303");
            var conflict = Employee.Create(
                TenantId,
                "Morgan",
                "Conflict",
                "morgan.conflict@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-304");

            seedContext.Employees.AddRange(inactive, conflict);
            await seedContext.SaveChangesAsync();

            inactiveId = inactive.Id;
            conflictId = conflict.Id;
        }

        var statuses = new Dictionary<Guid, WorkforceAccountStatusDto>
        {
            [inactiveId] = new(
                inactiveId,
                "iris.inactive@example.com",
                "Iris Inactive",
                "Employee",
                [new WorkforceAccountAccessProfileDto(Guid.NewGuid(), "Employee", "SystemSeeded", true)],
                "Inactive",
                Guid.NewGuid(),
                false,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null),
            [conflictId] = new(
                conflictId,
                "morgan.conflict@example.com",
                "Morgan Conflict",
                "Employee",
                [],
                "Conflict",
                null,
                false,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                new WorkforceAccountConflictDto(
                    "EmailAlreadyRegistered",
                    "This email is already linked to another account.",
                    true,
                    "Check the existing account before sending a new invitation."))
        };

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(
            context,
            tenantContext,
            new StaticWorkforceAccountStatusReader(statuses));

        var result = await service.SearchAccessSubjectsAsync(
            search: null,
            access: null,
            profileId: null,
            employeeStatus: null,
            deliveryState: null,
            employeeKey: null,
            baseline: null,
            cohort: null,
            orgUnitId: null,
            includeDescendants: true,
            page: 1,
            pageSize: 20,
            cancellationToken: CancellationToken.None);

        // A deactivated but provisioned account is now its own Suspended bucket
        // (restorable), no longer collapsed into NeedsReview.
        var inactiveItem = Assert.Single(result.Items.Where(item => item.EmployeeId == inactiveId));
        Assert.Equal("Suspended", inactiveItem.AccessState);
        Assert.Equal("Suspended", inactiveItem.AccessStateLabel);
        Assert.Equal("Account inactive", inactiveItem.InvitationLabel);
        Assert.Equal("This account is inactive.", inactiveItem.ReviewReason);

        var conflictItem = Assert.Single(result.Items.Where(item => item.EmployeeId == conflictId));
        Assert.Equal("NeedsReview", conflictItem.AccessState);
        Assert.Equal("Needs review", conflictItem.AccessStateLabel);
        Assert.Equal("This email is already linked to another account.", conflictItem.InvitationLabel);
        Assert.Equal("This email is already linked to another account.", conflictItem.AccessStateDetail);
        Assert.Equal("This email is already linked to another account.", conflictItem.ReviewReason);
    }

    [Fact]
    public async Task GetAccessSubjectSelectionPreviewAsync_ReturnsAllMatchingSubjects()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var lastEmployeeId = Guid.Empty;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            for (var index = 1; index <= 12; index++)
            {
                var employee = Employee.Create(
                    TenantId,
                    $"Person{index}",
                    "Preview",
                    $"person{index}@example.com",
                    DateTime.UtcNow,
                    jobTitle: "Analyst",
                    employeeNumber: $"E-{index:000}");

                seedContext.Employees.Add(employee);
                if (index == 12)
                {
                    lastEmployeeId = employee.Id;
                }
            }

            await seedContext.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var preview = await service.GetAccessSubjectSelectionPreviewAsync(
            search: null,
            access: null,
            profileId: null,
            employeeStatus: null,
            deliveryState: null,
            employeeKey: null,
            baseline: null,
            cohort: null,
            orgUnitId: null,
            includeDescendants: true,
            CancellationToken.None);

        Assert.Equal(12, preview.Count);
        Assert.Contains(preview, item => item.EmployeeId == lastEmployeeId);
    }

    [Fact]
    public async Task BulkInviteAsync_UsesProvisioningDefaultProfile_WhenRequestOmitsProfile()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var defaultProfileId = Guid.NewGuid();
        Guid employeeId;

        await using (var seedContext = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedContext.TenantSettings.Add(DomainTenantSettings.Create(
                TenantId,
                $$"""
                {
                    "employeeFieldConfig": {
                        "jobTitle": {
                            "visible": true,
                            "required": false,
                            "visibleToEmployee": true,
                            "visibleToManager": true
                        }
                    },
                    "provisioning": {
                        "defaultAccessProfileId": "{{defaultProfileId}}"
                    }
                }
                """));

            var employee = Employee.Create(
                TenantId,
                "Priya",
                "Invitee",
                "priya.invitee@example.com",
                DateTime.UtcNow,
                jobTitle: "Analyst",
                employeeNumber: "E-900");
            seedContext.Employees.Add(employee);
            await seedContext.SaveChangesAsync();
            employeeId = employee.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var provisioner = new StaticWorkforceBulkProvisioner();
        var service = CreateService(
            context,
            tenantContext,
            workforceBulkProvisioner: provisioner);
        var hrAdmin = CreatePrincipal(Guid.NewGuid(), PlatformRole.HRAdmin);

        var result = await service.BulkInviteAsync(
            new WorkforceBulkInviteRequest(
                Search: null,
                Access: null,
                ProfileId: null,
                EmployeeStatus: null,
                DeliveryState: null,
                EmployeeKey: null,
                SpecificEmployeeIds: [employeeId],
                AccessProfileId: Guid.Empty),
            hrAdmin,
            CancellationToken.None);

        Assert.Equal(defaultProfileId, provisioner.LastAccessProfileId);
        Assert.Equal(1, result.InvitedCount);
    }

    [Fact]
    public async Task GetDownlineAsync_HrAdmin_ReturnsFullMultiLevelSubtree()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid topId, midId, leafId, outsiderId;

        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seed.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seed.OrgUnits.Add(orgUnit);
            await seed.SaveChangesAsync();

            var top = Employee.Create(TenantId, "Top", "Boss", "top@example.com", now, employeeNumber: "D-1");
            var mid = Employee.Create(TenantId, "Mid", "Lead", "mid@example.com", now, employeeNumber: "D-2");
            var leaf = Employee.Create(TenantId, "Leaf", "Analyst", "leaf@example.com", now, employeeNumber: "D-3");
            var outsider = Employee.Create(TenantId, "Out", "Sider", "out@example.com", now, employeeNumber: "D-4");
            seed.Employees.AddRange(top, mid, leaf, outsider);
            await seed.SaveChangesAsync();

            var (_, topAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, top.Id, orgUnit.Id, "Boss", now);
            var (_, midAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, mid.Id, orgUnit.Id, "Lead", now);
            var (_, leafAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, leaf.Id, orgUnit.Id, "Analyst", now);
            await AddActiveEmploymentWithAssignmentAsync(seed, outsider.Id, orgUnit.Id, "Analyst", now);
            await AddPrimaryManagerRelationshipAsync(seed, mid.Id, top.Id, midAssignment.Id, topAssignment.Id, now);
            await AddPrimaryManagerRelationshipAsync(seed, leaf.Id, mid.Id, leafAssignment.Id, midAssignment.Id, now);

            topId = top.Id; midId = mid.Id; leafId = leaf.Id; outsiderId = outsider.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var hrAdmin = CreatePrincipal(Guid.NewGuid(), PlatformRole.HRAdmin);

        var downline = await service.GetDownlineAsync(topId, 10, hrAdmin, CancellationToken.None);

        var ids = downline.Select(e => e.EmployeeId).ToHashSet();
        Assert.Equal(2, downline.Count);
        Assert.Contains(midId, ids);
        Assert.Contains(leafId, ids);
        Assert.DoesNotContain(topId, ids);
        Assert.DoesNotContain(outsiderId, ids);
    }

    [Fact]
    public async Task GetDownlineAsync_RespectsMaxDepth()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid topId, midId, leafId;

        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seed.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seed.OrgUnits.Add(orgUnit);
            await seed.SaveChangesAsync();

            var top = Employee.Create(TenantId, "Top", "Boss", "top@example.com", now, employeeNumber: "D-1");
            var mid = Employee.Create(TenantId, "Mid", "Lead", "mid@example.com", now, employeeNumber: "D-2");
            var leaf = Employee.Create(TenantId, "Leaf", "Analyst", "leaf@example.com", now, employeeNumber: "D-3");
            seed.Employees.AddRange(top, mid, leaf);
            await seed.SaveChangesAsync();

            var (_, topAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, top.Id, orgUnit.Id, "Boss", now);
            var (_, midAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, mid.Id, orgUnit.Id, "Lead", now);
            var (_, leafAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, leaf.Id, orgUnit.Id, "Analyst", now);
            await AddPrimaryManagerRelationshipAsync(seed, mid.Id, top.Id, midAssignment.Id, topAssignment.Id, now);
            await AddPrimaryManagerRelationshipAsync(seed, leaf.Id, mid.Id, leafAssignment.Id, midAssignment.Id, now);

            topId = top.Id; midId = mid.Id; leafId = leaf.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var hrAdmin = CreatePrincipal(Guid.NewGuid(), PlatformRole.HRAdmin);

        var downline = await service.GetDownlineAsync(topId, 1, hrAdmin, CancellationToken.None);

        Assert.Single(downline);
        Assert.Equal(midId, downline[0].EmployeeId);
        Assert.DoesNotContain(leafId, downline.Select(e => e.EmployeeId));
    }

    [Fact]
    public async Task GetDownlineAsync_ExcludesInactiveReports()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid topId, activeId, inactiveId;

        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seed.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seed.OrgUnits.Add(orgUnit);
            await seed.SaveChangesAsync();

            var top = Employee.Create(TenantId, "Top", "Boss", "top@example.com", now, employeeNumber: "D-1");
            var active = Employee.Create(TenantId, "Act", "Report", "act@example.com", now, employeeNumber: "D-2");
            var inactive = Employee.Create(TenantId, "Gone", "Report", "gone@example.com", now, employeeNumber: "D-3");
            seed.Employees.AddRange(top, active, inactive);
            await seed.SaveChangesAsync();

            var (_, topAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, top.Id, orgUnit.Id, "Boss", now);
            var (_, activeAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, active.Id, orgUnit.Id, "Analyst", now);
            var inactiveStart = now.AddDays(-2);
            var (inactiveEmployment, inactiveAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, inactive.Id, orgUnit.Id, "Analyst", inactiveStart);
            inactiveAssignment.End(now.AddDays(-1));
            inactiveEmployment.End(now.AddDays(-1));
            await AddPrimaryManagerRelationshipAsync(seed, active.Id, top.Id, activeAssignment.Id, topAssignment.Id, now);
            await seed.SaveChangesAsync();

            topId = top.Id; activeId = active.Id; inactiveId = inactive.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var hrAdmin = CreatePrincipal(Guid.NewGuid(), PlatformRole.HRAdmin);

        var downline = await service.GetDownlineAsync(topId, 10, hrAdmin, CancellationToken.None);

        Assert.Single(downline);
        Assert.Equal(activeId, downline[0].EmployeeId);
        Assert.DoesNotContain(inactiveId, downline.Select(e => e.EmployeeId));
    }

    [Fact]
    public async Task GetDownlineAsync_ManagerCannotResolveOutsideOwnSubtree()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);
        Guid managerId, reportId, otherManagerId;

        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seed.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));
            var orgUnit = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seed.OrgUnits.Add(orgUnit);
            await seed.SaveChangesAsync();

            var manager = Employee.Create(TenantId, "Alex", "Manager", "alex@example.com", now, employeeNumber: "D-1");
            var report = Employee.Create(TenantId, "Casey", "Report", "casey@example.com", now, employeeNumber: "D-2");
            var otherManager = Employee.Create(TenantId, "Jamie", "Other", "jamie@example.com", now, employeeNumber: "D-3");
            seed.Employees.AddRange(manager, report, otherManager);
            await seed.SaveChangesAsync();

            var (_, managerAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, manager.Id, orgUnit.Id, "Manager", now);
            var (_, reportAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, report.Id, orgUnit.Id, "Analyst", now);
            await AddActiveEmploymentWithAssignmentAsync(seed, otherManager.Id, orgUnit.Id, "Manager", now);
            await AddPrimaryManagerRelationshipAsync(seed, report.Id, manager.Id, reportAssignment.Id, managerAssignment.Id, now);

            managerId = manager.Id; reportId = report.Id; otherManagerId = otherManager.Id;
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);
        var managerPrincipal = CreatePrincipal(Guid.NewGuid(), PlatformRole.Manager, managerId);

        var own = await service.GetDownlineAsync(managerId, 10, managerPrincipal, CancellationToken.None);
        var foreign = await service.GetDownlineAsync(otherManagerId, 10, managerPrincipal, CancellationToken.None);

        Assert.Single(own);
        Assert.Equal(reportId, own[0].EmployeeId);
        Assert.Empty(foreign);
    }

    [Fact]
    public async Task GetPublishedOrgUnitTreeAsync_IncludesDirectAndRolledUpMemberCounts()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantContext = TestTenantContext.WithTenant(TenantId);
        var now = new DateTime(2026, 6, 27, 0, 0, 0, DateTimeKind.Utc);

        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seed.TenantSettings.Add(DomainTenantSettings.Create(TenantId, SettingsJson));

            var root = OrgUnit.Create(TenantId, "ENG", "Engineering", "Department", null);
            seed.OrgUnits.Add(root);
            await seed.SaveChangesAsync();
            var child = OrgUnit.Create(TenantId, "ENG-PLT", "Platform Team", "Team", root.Id);
            seed.OrgUnits.Add(child);
            await seed.SaveChangesAsync();

            var rootMember = Employee.Create(TenantId, "Root", "Member", "rootm@example.com", now, employeeNumber: "M-1");
            var childA = Employee.Create(TenantId, "Child", "Alpha", "ca@example.com", now, employeeNumber: "M-2");
            var childB = Employee.Create(TenantId, "Child", "Beta", "cb@example.com", now, employeeNumber: "M-3");
            var childInactive = Employee.Create(TenantId, "Child", "Gone", "cg@example.com", now, employeeNumber: "M-4");
            seed.Employees.AddRange(rootMember, childA, childB, childInactive);
            await seed.SaveChangesAsync();

            await AddActiveEmploymentWithAssignmentAsync(seed, rootMember.Id, root.Id, "Member", now);
            await AddActiveEmploymentWithAssignmentAsync(seed, childA.Id, child.Id, "Engineer", now);
            await AddActiveEmploymentWithAssignmentAsync(seed, childB.Id, child.Id, "Engineer", now);
            var inactiveStart = now.AddDays(-2);
            var (inactiveEmployment, inactiveAssignment) = await AddActiveEmploymentWithAssignmentAsync(seed, childInactive.Id, child.Id, "Engineer", inactiveStart);
            inactiveAssignment.End(now.AddDays(-1));
            inactiveEmployment.End(now.AddDays(-1));
            await seed.SaveChangesAsync();
        }

        await using var context = TestDbContextFactory.Create(tenantContext, dbName);
        var service = CreateService(context, tenantContext);

        var tree = await service.GetPublishedOrgUnitTreeAsync(null, 10, false, CancellationToken.None);

        var rootNode = Assert.Single(tree.Roots);
        Assert.Equal("ENG", rootNode.StableKey);
        Assert.Equal(1, rootNode.MemberCount);
        Assert.Equal(3, rootNode.TotalMemberCount);
        var childNode = Assert.Single(rootNode.Children);
        Assert.Equal("ENG-PLT", childNode.StableKey);
        Assert.Equal(2, childNode.MemberCount);
        Assert.Equal(2, childNode.TotalMemberCount);
    }

    private static WorkforceContractService CreateService(
        CoreHRDbContext context,
        TestTenantContext tenantContext,
        IWorkforceAccountStatusReader? workforceAccountStatusReader = null,
        IWorkforceBulkProvisioner? workforceBulkProvisioner = null)
        => new(
            context,
            tenantContext,
            new TenantSettingsReadService(context),
            workforceAccountStatusReader ?? new StaticWorkforceAccountStatusReader(new Dictionary<Guid, WorkforceAccountStatusDto>()),
            workforceBulkProvisioner ?? new StaticWorkforceBulkProvisioner(),
            new WorkforceCanonicalResolver(context));

    private static async Task<(Employment Employment, WorkAssignment Assignment)> AddActiveEmploymentWithAssignmentAsync(
        CoreHRDbContext context,
        Guid employeeId,
        Guid orgUnitId,
        string jobTitle,
        DateTime effectiveFrom)
    {
        var employment = Employment.Start(TenantId, employeeId, effectiveFrom, null, WorkforceSourceType.Manual);
        context.Employments.Add(employment);
        await context.SaveChangesAsync();

        var assignment = WorkAssignment.Create(
            TenantId,
            employment.Id,
            employeeId,
            orgUnitId,
            TestCatalog.Job(TenantId, jobTitle),
            TestCatalog.Place(TenantId, null),
            true,
            effectiveFrom,
            null,
            WorkforceSourceType.Manual);
        context.WorkAssignments.Add(assignment);
        await context.SaveChangesAsync();

        return (employment, assignment);
    }

    private static async Task AddPrimaryManagerRelationshipAsync(
        CoreHRDbContext context,
        Guid subjectEmployeeId,
        Guid managerEmployeeId,
        Guid subjectWorkAssignmentId,
        Guid managerWorkAssignmentId,
        DateTime effectiveFrom)
    {
        var relationship = ManagerRelationship.Create(
            TenantId,
            subjectEmployeeId,
            managerEmployeeId,
            subjectWorkAssignmentId,
            managerWorkAssignmentId,
            ReportingRelationshipType.PrimaryManager,
            effectiveFrom,
            WorkforceSourceType.Manual);
        context.ManagerRelationships.Add(relationship);
        await context.SaveChangesAsync();
    }

    private static ClaimsPrincipal CreatePrincipal(Guid userId, string role, Guid? employeeId = null)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId.ToString()),
            new(ClaimTypes.Role, role),
            new(CustomClaimTypes.FullName, "Test User")
        };

        if (employeeId.HasValue)
        {
            claims.Add(new Claim(CustomClaimTypes.EmployeeId, employeeId.Value.ToString()));
        }

        foreach (var grant in BuildRoleGrants(role))
        {
            claims.Add(new Claim(
                CustomClaimTypes.CorePermission,
                CorePermissionClaimValue.Encode(grant.PermissionKey, grant.Scope)));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth", ClaimTypes.Name, ClaimTypes.Role));
    }

    private static IEnumerable<EffectivePermissionGrant> BuildRoleGrants(string role)
        => role switch
        {
            PlatformRole.HRAdmin =>
            [
                new EffectivePermissionGrant(CorePermissions.EmployeeView, PermissionScopes.Tenant),
                new EffectivePermissionGrant(CorePermissions.EmployeeManage, PermissionScopes.Tenant),
                new EffectivePermissionGrant(CorePermissions.StructureView, PermissionScopes.Tenant),
                new EffectivePermissionGrant(CorePermissions.StructureManage, PermissionScopes.Tenant),
                new EffectivePermissionGrant(CorePermissions.SetupView, PermissionScopes.Tenant),
                new EffectivePermissionGrant(CorePermissions.SetupManage, PermissionScopes.Tenant),
                new EffectivePermissionGrant(CorePermissions.ProfileSelfView, PermissionScopes.Self),
                new EffectivePermissionGrant(CorePermissions.ProfileSelfUpdate, PermissionScopes.Self),
                new EffectivePermissionGrant(CorePermissions.TeamView, PermissionScopes.DirectReports),
            ],
            PlatformRole.Manager =>
            [
                new EffectivePermissionGrant(CorePermissions.ProfileSelfView, PermissionScopes.Self),
                new EffectivePermissionGrant(CorePermissions.ProfileSelfUpdate, PermissionScopes.Self),
                new EffectivePermissionGrant(CorePermissions.TeamView, PermissionScopes.DirectReports),
                new EffectivePermissionGrant(CorePermissions.EmployeeView, PermissionScopes.DirectReports),
            ],
            PlatformRole.Employee =>
            [
                new EffectivePermissionGrant(CorePermissions.ProfileSelfView, PermissionScopes.Self),
                new EffectivePermissionGrant(CorePermissions.ProfileSelfUpdate, PermissionScopes.Self),
            ],
            _ => [],
        };

    private sealed class StaticWorkforceAccountStatusReader(
        IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> statuses) : IWorkforceAccountStatusReader
    {
        public Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
            IReadOnlyCollection<WorkforceAccountSubjectDto> subjects,
            CancellationToken cancellationToken)
        {
            var result = statuses
                .Where(entry => subjects.Any(subject => subject.EmployeeId == entry.Key))
                .ToDictionary(entry => entry.Key, entry => entry.Value);

            return Task.FromResult<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>>(result);
        }
    }

    private sealed class StaticWorkforceBulkProvisioner : IWorkforceBulkProvisioner
    {
        private readonly WorkforceAccountStatusDto? _status;

        public Guid? LastAccessProfileId { get; private set; }

        public StaticWorkforceBulkProvisioner(WorkforceAccountStatusDto? status = null)
        {
            _status = status;
        }

        public Task<WorkforceBulkProvisionResponse> BulkProvisionAsync(
            List<WorkforceBulkProvisionSubject> subjects,
            Guid accessProfileId,
            CancellationToken cancellationToken,
            string? baseline = null)
        {
            LastAccessProfileId = accessProfileId;
            var provisionState = _status?.ProvisioningState ?? "Unprovisioned";
            var outcome = provisionState is "InvitePending" or "InviteExpired" or "InviteAccepted"
                ? "Created"
                : "Created";

            var items = subjects
                .Select(s => new WorkforceBulkProvisionResultItem(s.EmployeeId, outcome, "Invitation created."))
                .ToList();

            return Task.FromResult(new WorkforceBulkProvisionResponse(items));
        }
    }
}
