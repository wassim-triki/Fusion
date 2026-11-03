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

    [Fact]
    public async Task Front_page_reuses_report_history_and_never_mixes_tenants_or_viewer_branches()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var unit = db.OrgUnits.Single();
        var division = OrgUnit.Create(Tenant, "ENG-DIV", "Engineering", "Division", null);
        db.OrgUnits.Add(division);
        db.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(Tenant, division.Id, OrganizationalUnitTypeCatalog.DivisionId, null,
            division.Name, OrgUnitLifecycleState.Active, Today.AddYears(-2)));
        db.OrgUnitEffectiveStates.Single().CloseAt(Today.AddDays(-10));
        db.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(Tenant, unit.Id, OrganizationalUnitTypeCatalog.DepartmentId, division.Id,
            "Engineering A", OrgUnitLifecycleState.Active, Today.AddDays(-10)));
        await db.SaveChangesAsync();
        var engine = new ReportEngine(db, Settings().Object);
        var fields = new EY.HRPlatform.CoreHR.Features.EmployeeFields.EmployeeFieldService(db, TestTenantContext.WithTenant(Tenant));
        var front = await engine.FrontPageAsync(Hr, fields, default);
        Assert.Equal(Today.AddYears(-2), front.FirstDate);
        Assert.Equal(2, front.Snapshots.Single(s => s.Date == Today).People.Count);
        Assert.All(front.Snapshots.Single(s => s.Date == Today).People, p => { Assert.Equal(division.Id, p.DepartmentId); Assert.Equal("Engineering", p.Department); });
        Assert.Equal(3, front.Snapshots.Last(s => s.Date < Today.AddDays(-19)).People.Count);
        Assert.All(front.Snapshots.SelectMany(s => s.People), p => Assert.DoesNotContain("Other", p.Name));
        Assert.Single(front.OpenRoles);
        var viewer = new ReportViewer(Guid.NewGuid(), world.Manager, PermissionScopes.DirectReports, false, false);
        var team = await engine.FrontPageAsync(viewer, fields, default);
        Assert.True(team.TeamOnly);
        Assert.All(team.Snapshots.SelectMany(s => s.People), p => Assert.Contains("Person1", p.Name));
        Assert.Equal(Today.AddYears(-1).AddDays(5), team.FirstDate);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.FrontPageAsync(viewer with { Scope = null }, fields, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.FrontPageAsync(viewer with { EmployeeId = null }, fields, default));
    }

    [Fact]
    public async Task Front_page_keeps_the_whole_monthly_history_and_future_boundaries()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var unit = db.OrgUnits.Single();
        var person = Employee.Create(Tenant, "Future", "Joiner", "future@example.test", employeeNumber: "FUTURE");
        var first = Today.AddDays(7).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var employment = Employment.Start(Tenant, person.Id, first, null, WorkforceSourceType.Manual);
        db.Employees.Add(person); db.Employments.Add(employment);
        db.WorkAssignments.Add(WorkAssignment.Create(Tenant, employment.Id, person.Id, unit.Id, TestCatalog.Job(Tenant, "Engineer"),
            TestCatalog.Place(Tenant, "Tunis"), true, first, null, WorkforceSourceType.Manual));
        var company = OrgUnit.Create(Tenant, "COMPANY", "Company", "Organization", null);
        db.OrgUnits.Add(company);
        db.OrgUnitEffectiveStates.Add(OrgUnitEffectiveState.Create(Tenant, company.Id, OrganizationalUnitTypeCatalog.OrganizationId, null,
            company.Name, OrgUnitLifecycleState.Active, Today.AddYears(-15)));
        var old = Employee.Create(Tenant, "First", "Person", "first@example.test", employeeNumber: "FIRST");
        db.Employees.Add(old);
        var oldEmployment = Employment.Start(Tenant, old.Id, Today.AddYears(-15).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), null, WorkforceSourceType.Manual);
        db.Employments.Add(oldEmployment);
        db.WorkAssignments.Add(WorkAssignment.Create(Tenant, oldEmployment.Id, old.Id, company.Id, TestCatalog.Job(Tenant, "CEO"), null,
            true, oldEmployment.EffectiveFrom, null, WorkforceSourceType.Manual));
        await db.SaveChangesAsync();
        var engine = new ReportEngine(db, Settings().Object);
        var fields = new EY.HRPlatform.CoreHR.Features.EmployeeFields.EmployeeFieldService(db, TestTenantContext.WithTenant(Tenant));
        var front = await engine.FrontPageAsync(Hr, fields, default);
        Assert.Equal(Today.AddYears(-15), front.FirstDate);
        Assert.True(front.Snapshots.Count > 180);
        Assert.Null(front.Snapshots.Single(s => s.Date == Today).People.Single(p => p.Name == "First Person").Department);
        Assert.DoesNotContain(front.Snapshots.Single(s => s.Date == Today).People, p => p.Name == "Future Joiner");
        Assert.Contains(front.Snapshots.Single(s => s.Date == Today.AddDays(7)).People, p => p.Name == "Future Joiner");
        var report = await engine.RunAsync(Definition() with { Mode = "date" }, Hr, default);
        Assert.Equal(report.Totals[0], front.Snapshots.Single(s => s.Date == Today).People.Count);
    }

    [Fact]
    public async Task Front_page_omits_hidden_job_fields_and_missing_details_before_serializing()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var config = TenantSettingsDto.DefaultEmployeeFieldConfig;
        foreach (var key in new[] { "jobTitle", "workLocation", "hireDate" })
            config[key] = new FieldConfig(Visible: true, Required: false, VisibleToEmployee: false, VisibleToManager: false);
        var policy = Settings();
        policy.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto { EmployeeFieldConfig = config });
        db.EmployeeFieldDefinitions.Add(EmployeeFieldDefinition.Create(Tenant, Guid.NewGuid(), "private-detail", "Private detail", EmployeeFieldArea.Personal,
            EmployeeFieldType.Text, EmployeeFieldEditor.Hr, true, false, false, true, false, 1, null, null, "test"));
        db.EmployeeFieldDefinitions.Add(EmployeeFieldDefinition.Create(Tenant, Guid.NewGuid(), "shared-detail", "Shared detail", EmployeeFieldArea.Personal,
            EmployeeFieldType.Text, EmployeeFieldEditor.Employee, true, true, true, true, false, 2, null, null, "test"));
        db.EmployeeFieldDefinitions.Add(EmployeeFieldDefinition.Create(Tenant, Guid.NewGuid(), "home-address", "Home address", EmployeeFieldArea.Personal,
            EmployeeFieldType.Address, EmployeeFieldEditor.EmployeeWithApproval, true, true, false, true, true, 3, "homeAddress", null, "test"));
        await db.SaveChangesAsync();
        var engine = new ReportEngine(db, policy.Object);
        var fields = new EY.HRPlatform.CoreHR.Features.EmployeeFields.EmployeeFieldService(db, TestTenantContext.WithTenant(Tenant));
        var front = await engine.FrontPageAsync(new(Guid.NewGuid(), world.Manager, PermissionScopes.DirectReports, false, false), fields, default);
        Assert.DoesNotContain("job", front.Fields); Assert.DoesNotContain("place", front.Fields); Assert.DoesNotContain("first-day", front.Fields);
        Assert.All(front.Snapshots.SelectMany(s => s.People), p => { Assert.Null(p.Job); Assert.Null(p.Place); Assert.Null(p.FirstDay); });
        var missing = Assert.Single(front.RecordsToComplete);
        Assert.Contains("Person1", missing.DisplayName);
        Assert.Equal(new[] { "Shared detail" }, missing.Missing);
        Assert.Null(missing.JobTitle);
        var hr = await engine.FrontPageAsync(Hr, fields, default);
        Assert.Equal(2, hr.RecordsToComplete.Count);
        Assert.All(hr.RecordsToComplete, p => Assert.Contains("Private detail", p.Missing));
        Assert.All(hr.RecordsToComplete, p => Assert.Contains("Home address", p.Missing));
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
            Assert.Equal(measure == "open-roles" || mode == "date" ? 1 : 2, run.Periods.Count);
            Assert.DoesNotContain(run.Series, s => s.Label.Contains("Secret"));
            Assert.DoesNotContain(run.FilterOptions.Values.SelectMany(values => values), value => value.Contains("Other") || value.Contains("Secret"));
            if (measure == "open-roles") Assert.Contains("Analyst", run.FilterOptions["job"]);
            Assert.DoesNotContain(run.People, p => p.Values.Values.Any(v => v?.Contains("Other") == true));
            if (measure is "headcount" or "places" or "jobs") Assert.Equal(2m, run.Totals[^1]);
            if (measure == "open-roles") Assert.Equal(1m, run.Totals[^1]);
            if (measure == "tenure") Assert.InRange(run.Totals[^1]!.Value, 1.4m, 1.6m);
            if (measure == "joiners-leavers" && mode == "range") Assert.Equal(2m, run.Totals.Sum());
            if (measure == "turnover" && mode == "range") Assert.Contains(run.Totals, value => value > 0);
        }
    }

    [Fact]
    public async Task Turnover_without_population_is_unavailable_and_open_roles_are_current()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var engine = new ReportEngine(db, Settings().Object);
        var empty = await engine.RunAsync(Definition("turnover") with { Filters = [new("name", ["no match"])] }, Hr, default);
        Assert.All(empty.Totals, Assert.Null);
        var roles = await engine.RunAsync(Definition("open-roles") with { To = Today.AddYears(2) }, Hr, default);
        Assert.Single(roles.Periods);
        Assert.Equal(Today, roles.Periods[0].To);
        Assert.Equal(1m, roles.Totals[0]);
    }

    [Fact]
    public async Task Filter_choices_include_earlier_periods_and_survive_an_empty_filtered_result()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var engine = new ReportEngine(db, Settings().Object);
        var run = await engine.RunAsync(Definition() with { Filters = [new("name", ["no match"])] }, Hr, default);
        Assert.All(run.Totals, total => Assert.Equal(0m, total));
        Assert.Contains(run.FilterOptions["name"], name => name.Contains("Person2"));
        Assert.Contains(run.FilterOptions["name"], name => name.Contains("Person1"));
    }

    [Fact]
    public async Task Tag_filters_match_individual_tags()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var field = EmployeeFieldDefinition.Create(Tenant, Guid.NewGuid(), "skills", "Skills", EmployeeFieldArea.About,
            EmployeeFieldType.Tags, EmployeeFieldEditor.Employee, true, true, true, false, false, 1, null, null, "test");
        var employee = db.Employees.ToList().Single(person => person.DisplayName.Contains("Person1"));
        db.EmployeeFieldDefinitions.Add(field);
        db.EmployeeFieldValues.Add(EmployeeFieldValue.Create(Tenant, employee.Id, field.Id, "[\"React\",\"SQL\"]", "test"));
        await db.SaveChangesAsync();
        var engine = new ReportEngine(db, Settings().Object);
        var run = await engine.RunAsync(Definition() with { Filters = [new("field:skills", ["SQL"])] }, Hr, default);
        Assert.Equal(1m, run.Totals[^1]);
        Assert.Contains("SQL", run.FilterOptions["field:skills"]);
        Assert.Contains("React", run.FilterOptions["field:skills"]);
    }

    [Fact]
    public async Task Person_filters_select_one_identity_when_names_match()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        foreach (var employee in db.Employees.ToList().Where(p => p.DisplayName.Contains("Person0") || p.DisplayName.Contains("Person1")))
            employee.UpdatePreferredName("Same name");
        await db.SaveChangesAsync();
        var engine = new ReportEngine(db, Settings().Object);
        var all = await engine.RunAsync(Definition() with { Mode = "date" }, Hr, default);
        Assert.Equal(2, all.PersonOptions.Count(option => option.Name == "Same name Test"));
        var person = all.People.First();
        var selected = await engine.RunAsync(Definition() with { Mode = "date", Filters = [new("name", [person.EmployeeKey])] }, Hr, default);
        Assert.Single(selected.People);
        Assert.Equal(person.EmployeeKey, selected.People[0].EmployeeKey);
        var viewer = new ReportViewer(Guid.NewGuid(), world.Manager, PermissionScopes.DirectReports, false, false);
        var visible = await engine.RunAsync(Definition() with { Mode = "date" }, viewer, default);
        Assert.All(visible.PersonOptions, option => Assert.Contains(visible.People, p => p.EmployeeKey == option.Key));
        Assert.DoesNotContain(all.PersonOptions, option => option.Name.Contains("Other"));
        var past = await engine.RunAsync(Definition(), Hr, default);
        var departed = past.PersonOptions.First(option => option.Name.Contains("Person2"));
        var absent = await engine.RunAsync(Definition() with { Mode = "date", Filters = [new("name", [departed.Key])] }, Hr, default);
        Assert.Empty(absent.People);
        Assert.Contains(absent.PersonOptions, option => option.Key == departed.Key && option.Name == departed.Name);
        var config = TenantSettingsDto.DefaultEmployeeFieldConfig;
        config["jobTitle"] = new FieldConfig(Visible: true, Required: false, VisibleToEmployee: false, VisibleToManager: false);
        var settings = Settings();
        settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto { EmployeeFieldConfig = config });
        var restricted = await new ReportEngine(db, settings.Object).RunAsync(Definition() with { Mode = "date", Fields = ["name"] }, viewer, default);
        Assert.All(restricted.PersonOptions, option => Assert.Null(option.Detail));
    }

    [Fact]
    public async Task Date_and_tenure_ranges_are_inclusive_and_obey_viewer_reach()
    {
        var world = await Seed();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(Tenant), world.Db);
        var engine = new ReportEngine(db, Settings().Object);
        var first = Today.AddYears(-1).AddDays(5).ToString("yyyy-MM-dd");
        var definition = Definition() with { Mode = "date", Filters = [new("first-day", [], first, first)] };
        var hr = await engine.RunAsync(definition, Hr, default);
        Assert.Equal(1m, hr.Totals[0]);
        Assert.Contains(hr.People, p => p.Values["name"]!.Contains("Person1"));
        var team = new ReportViewer(Guid.NewGuid(), world.Manager, PermissionScopes.DirectReports, false, false);
        Assert.Equal(1m, (await engine.RunAsync(definition, team, default)).Totals[0]);
        var old = definition with { Filters = [new("first-day", [], null, Today.AddYears(-2).ToString("yyyy-MM-dd"))] };
        Assert.Equal(0m, (await engine.RunAsync(old, team, default)).Totals[0]);
        var tenure = definition with { Filters = [new("tenure", [], "1.5", "3")] };
        Assert.Equal(1m, (await engine.RunAsync(tenure, Hr, default)).Totals[0]);
        Assert.Equal(0m, (await engine.RunAsync(tenure, team, default)).Totals[0]);
        await Assert.ThrowsAsync<ArgumentException>(() => engine.RunAsync(definition with { Filters = [new("first-day", [], "not-a-date", null)] }, Hr, default));
        await Assert.ThrowsAsync<ArgumentException>(() => engine.RunAsync(definition with { Filters = [new("name", [], "A", "Z")] }, Hr, default));
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
        Assert.All(run.FilterOptions["name"], name => Assert.Contains("Person1", name));
        var csv = System.Text.Encoding.UTF8.GetString(ReportService.Export(run, false).Bytes);
        Assert.Contains("Person1", csv); Assert.DoesNotContain("Person2", csv); Assert.DoesNotContain("Other", csv);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.SaveAsync(null, new("No", Definition()), viewer, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ShareAsync(saved.Id, [], viewer, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.DeleteAsync(saved.Id, viewer, default));
        var adminRun = await engine.RunAsync(Definition() with { Mode = "date" }, Hr, default);
        var outside = adminRun.PersonOptions.First(p => !run.PersonOptions.Any(member => member.Key == p.Key));
        var restricted = await service.SaveAsync(null, new("Outside", Definition() with { Filters = [new("name", [outside.Key])] }), Hr, default);
        Assert.True(await service.ShareAsync(restricted!.Id, [Role], Hr, default));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.GetAsync(restricted.Id, viewer, default));
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
        Assert.DoesNotContain("field:private", (await engine.RunAsync(Definition(), viewer, default)).FilterOptions.Keys);
        var jobsAdmin = ReportViewer.From(new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, Owner.ToString()),
            new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(CorePermissions.OverviewView, PermissionScopes.Tenant)),
            new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(CorePermissions.EmployeeManage, PermissionScopes.Tenant)),
        ], "test")));
        Assert.True(jobsAdmin.JobHr); Assert.False(jobsAdmin.Hr);
        Assert.DoesNotContain(await engine.FieldsAsync(jobsAdmin, default), f => f.Key == "field:private");
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => engine.RunAsync(Definition() with { Fields = ["field:private"] }, jobsAdmin, default));
        foreach (var d in new[] { Definition() with { Fields = ["field:private"] }, Definition() with { GroupBy = "field:private" },
                     Definition() with { Filters = [new("field:private", ["secret"])] },
                     Definition() with { Filters = [new("field:private", [], "2020-01-01", null)] } })
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
