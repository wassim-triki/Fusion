using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Reports;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.SharedKernel.Auth;
using Moq;
using System.Security.Claims;

namespace EY.HRPlatform.CoreHR.Tests.Features.Reports;

public sealed class ReportTests
{
    private static readonly Guid Tenant = Guid.NewGuid(), OtherTenant = Guid.NewGuid(), Owner = Guid.NewGuid(), Role = Guid.NewGuid();
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static ReportDefinition Definition(string measure = "headcount") => new(measure, "division", "range", Today.AddYears(-1), Today, "year", [], ["name", "job"]);
    private static ReportViewer Hr => new(Owner, null, PermissionScopes.Tenant, true, true);
    private static Mock<ITenantSettingsReadService> Settings()
    {
        var mock = new Mock<ITenantSettingsReadService>();
        mock.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
        return mock;
    }

    private static async Task<(string Db, Guid Manager)> Seed()
    {
        var name = Guid.NewGuid().ToString();
        await using var db = TestDbContextFactory.CreateWithoutTenant(name);
        var start = Today.AddYears(-2).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var people = new List<(Guid Id, Guid Assignment)>();
        foreach (var tenant in new[] { Tenant, OtherTenant })
        {
            var unit = OrgUnit.Create(tenant, "ENG", tenant == Tenant ? "Engineering" : "Secret other company", "Department", null);
            db.OrgUnits.Add(unit);
            db.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(tenant, unit.Id, OrganizationalUnitTypeCatalog.DepartmentId, null,
                unit.Name, OrgUnitLifecycleState.Active, Today.AddYears(-2)));
            for (var i = 0; i < 3; i++)
            {
                var person = Employee.Create(tenant, tenant == Tenant ? "Person" + i : "Other" + i, "Test", $"{tenant:N}.{i}@example.test", employeeNumber: "E" + i);
                var employment = Employment.Start(tenant, person.Id, i == 1 ? start.AddYears(1).AddDays(5) : start, null, WorkforceSourceType.Manual);
                var assignment = WorkAssignment.Create(tenant, employment.Id, person.Id, unit.Id, TestCatalog.Job(tenant, "Engineer"), TestCatalog.Place(tenant, "Tunis"), true,
                    employment.EffectiveFrom, null, WorkforceSourceType.Manual);
                db.Employees.Add(person); db.Employments.Add(employment); db.WorkAssignments.Add(assignment);
                if (i == 2) employment.End(Today.AddDays(-20).AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
                if (i == 0) db.OpenRoles.Add(OpenRole.Create(tenant, TestCatalog.Job(tenant, "Analyst"), null, person.Id, unit.Id, null, OpenRoleStatus.Open, "test"));
                if (tenant == Tenant)
                {
                    if (i == 1) db.ManagerRelationships.Add(ManagerRelationship.Create(tenant, person.Id, people[0].Id, assignment.Id, people[0].Assignment,
                        ReportingRelationshipType.PrimaryManager, employment.EffectiveFrom, WorkforceSourceType.Manual));
                    people.Add((person.Id, assignment.Id));
                }
            }
        }
        await db.SaveChangesAsync();
        return (name, people[0].Id);
    }

    [Theory]
    [InlineData("headcount")][InlineData("joiners-leavers")][InlineData("turnover")][InlineData("tenure")]
    [InlineData("places")][InlineData("jobs")][InlineData("open-roles")]
    public async Task Standard_reports_run_on_a_date_and_in_periods_without_other_tenants(string measure)
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var engine = new ReportEngine(db, Settings().Object);
        foreach (var mode in new[] { "date", "range" })
        {
            var run = await engine.RunAsync(Definition(measure) with { Mode = mode }, Hr, default);
            Assert.Equal(mode == "date" ? 1 : 2, run.Periods.Count);
            Assert.DoesNotContain(run.Series, s => s.Label.Contains("Secret"));
            Assert.DoesNotContain(run.People, p => p.Values.Values.Any(v => v?.Contains("Other") == true));
            if (measure is "headcount" or "places" or "jobs") Assert.Equal(2m, run.Totals[^1]);
            if (measure == "open-roles") Assert.Equal(1m, run.Totals[^1]);
            if (measure == "tenure") Assert.InRange(run.Totals[^1], 1.4m, 1.6m);
            if (measure == "joiners-leavers" && mode == "range") Assert.Equal(2m, run.Totals.Sum());
            if (measure == "turnover" && mode == "range") Assert.Contains(run.Totals, value => value > 0);
        }
    }

    [Fact]
    public async Task Shared_report_runs_as_viewer_and_exports_only_their_branch()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var engine = new ReportEngine(db, Settings().Object);
        var identity = new Mock<IWorkforceAccessIdentityClient>();
        identity.Setup(i => i.ReportRolesAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync([new ReportRoleDto(Role, "Managers", true)]);
        var service = new ReportService(db, TestTenantContext.WithTenant(Tenant), engine, identity.Object);
        var saved = await service.SaveAsync(null, new("Engineering", Definition()), Hr, default);
        Assert.True(await service.ShareAsync(saved!.Id, [Role], Hr, default));
        var viewer = new ReportViewer(Guid.NewGuid(), world.Manager, PermissionScopes.DirectReports, false, false);
        var shared = await service.GetAsync(saved.Id, viewer, default);
        Assert.NotNull(shared); Assert.False(shared.CanEdit);
        var run = await engine.RunAsync(shared.Definition, viewer, default);
        Assert.Equal(1m, run.Totals[^1]); Assert.Single(run.People);
        var csv = System.Text.Encoding.UTF8.GetString(ReportService.Export(run, false).Bytes);
        Assert.Contains("Person1", csv); Assert.DoesNotContain("Person2", csv); Assert.DoesNotContain("Other", csv);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.SaveAsync(null, new("No", Definition()), viewer, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ShareAsync(saved.Id, [], viewer, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.DeleteAsync(saved.Id, viewer, default));
        Assert.True(await service.ShareAsync(saved.Id, [], Hr, default));
        Assert.Null(await service.GetAsync(saved.Id, viewer, default));
    }

    [Fact]
    public async Task Hidden_fields_cannot_be_selected_grouped_filtered_or_exported()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var field = EmployeeFieldDefinition.Create(Tenant, Guid.NewGuid(), "private", "Private", EmployeeFieldArea.Personal,
            EmployeeFieldType.Text, EmployeeFieldEditor.Hr, true, false, false, false, false, 1, null, null, "test");
        db.EmployeeFieldDefinitions.Add(field); await db.SaveChangesAsync();
        var engine = new ReportEngine(db, Settings().Object);
        var viewer = new ReportViewer(Guid.NewGuid(), world.Manager, PermissionScopes.DirectReports, false, false);
        Assert.DoesNotContain(await engine.FieldsAsync(viewer, default), f => f.Key == "field:private");
        var jobsAdmin = ReportViewer.From(new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, Owner.ToString()),
            new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(CorePermissions.OverviewView, PermissionScopes.Tenant)),
            new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(CorePermissions.EmployeeManage, PermissionScopes.Tenant)),
        ], "test")));
        Assert.True(jobsAdmin.JobHr); Assert.False(jobsAdmin.Hr);
        Assert.DoesNotContain(await engine.FieldsAsync(jobsAdmin, default), f => f.Key == "field:private");
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.RunAsync(Definition() with { Fields = ["field:private"] }, jobsAdmin, default));
        foreach (var d in new[] { Definition() with { Fields = ["field:private"] }, Definition() with { GroupBy = "field:private" },
                     Definition() with { Filters = [new("field:private", ["secret"])] } })
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.RunAsync(d, viewer, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.RunAsync(Definition(), viewer with { Scope = null }, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.RunAsync(Definition(), viewer with { EmployeeId = null }, default));
        var identity = new Mock<IWorkforceAccessIdentityClient>();
        identity.Setup(i => i.ReportRolesAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync([new ReportRoleDto(Role, "Managers", true)]);
        var service = new ReportService(db, TestTenantContext.WithTenant(Tenant), engine, identity.Object);
        var saved = (await service.SaveAsync(null, new("Private", Definition() with { Filters = [new("field:private", ["secret"])] }), Hr, default))!;
        Assert.True(await service.ShareAsync(saved.Id, [Role], Hr, default));
        Assert.Single(await service.ListAsync(viewer, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetAsync(saved.Id, viewer, default));
    }

    [Fact]
    public async Task Saved_report_ids_roles_and_writes_cannot_cross_tenants_or_owners()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var identity = new Mock<IWorkforceAccessIdentityClient>();
        identity.Setup(i => i.ReportRolesAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync([new ReportRoleDto(Role, "Managers", false)]);
        var service = new ReportService(db, TestTenantContext.WithTenant(Tenant), new(db, Settings().Object), identity.Object);
        var saved = (await service.SaveAsync(null, new("Own", Definition()), Hr, default))!;
        await Assert.ThrowsAsync<ArgumentException>(() => service.ShareAsync(saved.Id, [Guid.NewGuid()], Hr, default));
        var otherOwner = Hr with { UserId = Guid.NewGuid() };
        Assert.Null(await service.GetAsync(saved.Id, otherOwner, default));
        Assert.Null(await service.SaveAsync(saved.Id, new("Overwrite", Definition()), otherOwner, default));
        Assert.False(await service.ShareAsync(saved.Id, [Role], otherOwner, default));
        Assert.False(await service.DeleteAsync(saved.Id, otherOwner, default));
        await using var other = TestDbContextFactory.Create(TestTenantContext.WithTenant(OtherTenant), world.Db);
        var foreignService = new ReportService(other, TestTenantContext.WithTenant(OtherTenant), new(other, Settings().Object), identity.Object);
        Assert.Null(await foreignService.GetAsync(saved.Id, Hr, default));
        Assert.False(await foreignService.DeleteAsync(saved.Id, Hr, default));
        Assert.False(await foreignService.ShareAsync(saved.Id, [Role], Hr, default));
        Assert.Null(await foreignService.SaveAsync(saved.Id, new("Overwrite", Definition()), Hr, default));
    }
}
