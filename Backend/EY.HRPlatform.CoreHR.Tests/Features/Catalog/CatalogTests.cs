using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Catalog;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.Catalog;

/// <summary>B-175: the company's jobs, places and lists, their rules, and who may change them.</summary>
public sealed class CatalogTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();
    private static readonly DateTime Start = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddYears(-1), DateTimeKind.Utc);

    private static readonly ClaimsPrincipal Admin = new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, "u-1"),
        new Claim(CustomClaimTypes.FullName, "Amira Khelifi"),
    ], "test"));

    private sealed record World(string Db, Guid UnitId, Guid EmployeeId);

    private static CoreHRDbContext Db(World world, Guid? tenant = null)
        => TestDbContextFactory.Create(TestTenantContext.WithTenant(tenant ?? TenantA), world.Db);

    private static (JobCatalogService Jobs, CompanyListService Lists) Services(CoreHRDbContext db, Guid? tenant = null)
    {
        var tenantContext = TestTenantContext.WithTenant(tenant ?? TenantA);
        var audit = new SettingsAuditService(db, tenantContext, new HttpContextAccessor());
        var lists = new CompanyListService(db, tenantContext, audit);
        return (new JobCatalogService(db, tenantContext, lists, audit), lists);
    }

    /// <summary>One person in Tenant A, holding "Engineer" in Tunis since a year ago, plus an open role for an "Engineer".</summary>
    private static async Task<World> SeedAsync()
    {
        var name = Guid.NewGuid().ToString();
        await using var seed = TestDbContextFactory.CreateWithoutTenant(name);
        var unit = OrgUnit.Create(TenantA, "ENG", "Engineering", "Department", null);
        var employee = Employee.Create(TenantA, "Nour", "Ben Ali", "nour@example.test", employeeNumber: TestEmployeeNumbers.Next());
        var employment = Employment.Start(TenantA, employee.Id, Start, null, WorkforceSourceType.Manual);
        var job = seed.Job(TenantA, "Engineer");
        seed.AddRange(unit, employee, employment);
        seed.WorkAssignments.Add(WorkAssignment.Create(TenantA, employment.Id, employee.Id, unit.Id, job, seed.Place(TenantA, "Tunis"),
            true, Start, null, WorkforceSourceType.Manual));
        seed.OpenRoles.Add(OpenRole.Create(TenantA, job, null, employee.Id, unit.Id, null, OpenRoleStatus.Open, "test"));
        await seed.SaveChangesAsync();
        return new World(name, unit.Id, employee.Id);
    }

    // --- Jobs ------------------------------------------------------------------------------------

    [Fact]
    public async Task A_job_is_listed_with_who_holds_it_and_a_second_with_the_same_title_is_refused()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var (jobs, _) = Services(db);

        var engineer = Assert.Single(await jobs.GetJobsAsync(default));
        Assert.Equal(("Engineer", 1, 1, true), (engineer.Title, engineer.PeopleCount, engineer.OpenRoleCount, engineer.InUse));

        await Assert.ThrowsAsync<DuplicateEntityException>(() => jobs.CreateJobAsync(new JobRequest("  engineer "), Admin, default));
        var designer = await jobs.CreateJobAsync(new JobRequest("Product   Designer"), Admin, default);
        Assert.Equal(("Product Designer", 0, false), (designer.Title, designer.PeopleCount, designer.InUse));
    }

    [Fact]
    public async Task Renaming_a_job_renames_it_on_everyone_who_holds_it_and_on_its_open_roles()
    {
        var world = await SeedAsync();
        await using (var db = Db(world))
        {
            var (jobs, _) = Services(db);
            var engineer = Assert.Single(await jobs.GetJobsAsync(default));
            await jobs.UpdateJobAsync(engineer.Id, new JobRequest("Software Engineer"), Admin, default);
        }

        await using var read = Db(world);
        Assert.Equal("Software Engineer", (await read.WorkAssignments.SingleAsync()).JobTitle);
        Assert.Equal("Software Engineer", (await read.OpenRoles.SingleAsync()).JobTitle);
        Assert.Contains(await read.SettingsAuditEvents.Select(item => item.Summary).ToListAsync(),
            summary => summary == "Renamed the job Engineer to Software Engineer.");
    }

    [Fact]
    public async Task Merging_moves_everyone_and_every_open_role_to_the_kept_job_and_removes_the_other()
    {
        var world = await SeedAsync();
        Guid keptId;
        await using (var db = Db(world))
        {
            var (jobs, _) = Services(db);
            var engineer = Assert.Single(await jobs.GetJobsAsync(default));
            var kept = await jobs.CreateJobAsync(new JobRequest("Software Engineer"), Admin, default);
            keptId = kept.Id;
            await Assert.ThrowsAsync<CatalogConflictException>(() => jobs.MergeJobAsync(kept.Id, new MergeRequest(kept.Id), Admin, default));
            var merged = await jobs.MergeJobAsync(engineer.Id, new MergeRequest(kept.Id), Admin, default);
            Assert.Equal((1, 1), (merged.PeopleCount, merged.OpenRoleCount));
        }

        await using var read = Db(world);
        Assert.Equal(keptId, Assert.Single(await read.Jobs.ToListAsync()).Id);
        var assignment = await read.WorkAssignments.SingleAsync();
        Assert.Equal((keptId, "Software Engineer"), (assignment.JobId, assignment.JobTitle));
        Assert.Equal(keptId, (await read.OpenRoles.SingleAsync()).JobId);
    }

    [Fact]
    public async Task A_used_job_is_retired_not_deleted_and_a_retired_job_is_kept_by_its_holder_but_not_given_to_anyone_new()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var (jobs, _) = Services(db);
        var engineer = Assert.Single(await jobs.GetJobsAsync(default));

        await Assert.ThrowsAsync<CatalogConflictException>(() => jobs.DeleteJobAsync(engineer.Id, Admin, default));
        Assert.True((await jobs.SetJobRetiredAsync(engineer.Id, true, Admin, default)).IsRetired);

        var references = new CatalogReferences(db, TestTenantContext.WithTenant(TenantA));
        Assert.Equal("Job.Retired", (await references.JobAsync(engineer.Id, null, default)).Error.Code);
        Assert.True((await references.JobAsync(engineer.Id, engineer.Id, default)).IsSuccess);

        var unused = await jobs.CreateJobAsync(new JobRequest("Intern"), Admin, default);
        await jobs.DeleteJobAsync(unused.Id, Admin, default);
        Assert.DoesNotContain(await jobs.GetJobsAsync(default), job => job.Id == unused.Id);
    }

    [Fact]
    public async Task A_job_takes_a_family_and_level_from_the_company_lists_only()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var (jobs, lists) = Services(db);
        var family = await lists.AddAsync(CompanyList.JobFamilies, new ListValueRequest("Engineering"), Admin, default);
        var level = (await lists.GetAllAsync(default)).Single(list => list.Id == "levels").Values.First(value => value.Label == "Senior");
        var leave = (await lists.GetAllAsync(default)).Single(list => list.Id == "leave-types").Values[0];

        var senior = await jobs.CreateJobAsync(new JobRequest("Senior Engineer", family.Id, level.Id), Admin, default);
        Assert.Equal(("Engineering", "Senior"), (senior.Family?.Label, senior.Level?.Label));
        await Assert.ThrowsAsync<ArgumentException>(() => jobs.CreateJobAsync(new JobRequest("Odd", leave.Id), Admin, default));

        var levels = (await lists.GetAllAsync(default)).Single(list => list.Id == "levels").Values;
        Assert.Equal(1, levels.Single(value => value.Id == level.Id).UsageCount);
    }

    [Fact]
    public async Task Another_company_never_sees_or_touches_these_jobs()
    {
        var world = await SeedAsync();
        Guid engineerId;
        await using (var db = Db(world))
            engineerId = Assert.Single(await Services(db).Jobs.GetJobsAsync(default)).Id;

        await using var other = Db(world, TenantB);
        var (jobs, _) = Services(other, TenantB);
        Assert.Empty(await jobs.GetJobsAsync(default));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => jobs.UpdateJobAsync(engineerId, new JobRequest("Mine"), Admin, default));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => jobs.DeleteJobAsync(engineerId, Admin, default));
        var own = await jobs.CreateJobAsync(new JobRequest("Engineer"), Admin, default);
        await Assert.ThrowsAsync<EntityNotFoundException>(() => jobs.MergeJobAsync(own.Id, new MergeRequest(engineerId), Admin, default));
        Assert.Equal("Job.NotFound", (await new CatalogReferences(other, TestTenantContext.WithTenant(TenantB)).JobAsync(engineerId, null, default)).Error.Code);
    }

    [Fact]
    public async Task A_job_change_takes_a_job_from_the_catalogue_and_refuses_another_company_s()
    {
        var world = await SeedAsync();
        Guid foreign;
        await using (var other = Db(world, TenantB))
        {
            foreign = (await Services(other, TenantB).Jobs.CreateJobAsync(new JobRequest("Spy"), Admin, default)).Id;
        }

        await using var db = Db(world);
        var mutation = new WorkforceMutationService(db, TestTenantContext.WithTenant(TenantA), new WorkforceCanonicalResolver(db));
        var lead = db.JobId(TenantA, "Lead Engineer");
        var refused = await mutation.ChangeWorkAssignmentAsync(world.EmployeeId,
            new ChangeWorkAssignmentInput(world.UnitId, foreign, null, DateTime.UtcNow.Date), "test", default);
        Assert.Equal("Job.NotFound", refused.Error.Code);

        var changed = await mutation.ChangeWorkAssignmentAsync(world.EmployeeId,
            new ChangeWorkAssignmentInput(world.UnitId, lead, null, DateTime.UtcNow.Date), "test", default);
        Assert.True(changed.IsSuccess, changed.IsFailure ? changed.Error.Message : null);
        Assert.Equal(("Lead Engineer", (string?)null), (changed.Value.JobTitle, changed.Value.WorkLocation));
    }

    // --- Places ----------------------------------------------------------------------------------

    [Fact]
    public async Task Places_rename_merge_and_refuse_deleting_one_in_use()
    {
        var world = await SeedAsync();
        Guid sfaxId;
        await using (var db = Db(world))
        {
            var (jobs, _) = Services(db);
            var tunis = Assert.Single(await jobs.GetPlacesAsync(default));
            Assert.Equal(("Tunis", 1, true), (tunis.Name, tunis.PeopleCount, tunis.InUse));
            await Assert.ThrowsAsync<CatalogConflictException>(() => jobs.DeletePlaceAsync(tunis.Id, Admin, default));
            await Assert.ThrowsAsync<DuplicateEntityException>(() => jobs.CreatePlaceAsync(new PlaceRequest("TUNIS"), Admin, default));

            var renamed = await jobs.UpdatePlaceAsync(tunis.Id, new PlaceRequest("Tunis HQ", "Tunis", "Tunisia"), Admin, default);
            Assert.Equal(("Tunis HQ", "Tunis", "Tunisia"), (renamed.Name, renamed.City, renamed.Country));
            var sfax = await jobs.CreatePlaceAsync(new PlaceRequest("Sfax"), Admin, default);
            sfaxId = sfax.Id;
            await jobs.MergePlaceAsync(tunis.Id, new MergeRequest(sfax.Id), Admin, default);
        }

        await using var read = Db(world);
        var assignment = await read.WorkAssignments.SingleAsync();
        Assert.Equal((sfaxId, "Sfax"), (assignment.PlaceId, assignment.WorkLocation));
        Assert.Equal(sfaxId, Assert.Single(await read.Places.ToListAsync()).Id);
    }

    // --- Lists -----------------------------------------------------------------------------------

    [Fact]
    public async Task A_company_gets_the_default_lists_once_and_emptying_one_never_brings_them_back()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var (_, lists) = Services(db);

        var all = await lists.GetAllAsync(default);
        Assert.Equal(["employment-types", "levels", "job-families", "change-reasons", "leave-types"], all.Select(list => list.Id));
        var types = all.Single(list => list.Id == "employment-types").Values;
        Assert.Equal(["Full-time", "Part-time", "Fixed-term", "Contractor", "Intern"], types.Select(value => value.Label));
        Assert.Equal("full-time", types[0].Key);
        Assert.Empty(all.Single(list => list.Id == "job-families").Values);

        foreach (var value in types) await lists.DeleteAsync(CompanyList.EmploymentTypes, value.Id, Admin, default);
        Assert.Empty((await lists.GetAllAsync(default)).Single(list => list.Id == "employment-types").Values);
    }

    [Fact]
    public async Task A_used_value_is_retired_never_deleted_and_a_rename_keeps_its_key_and_reaches_the_employment()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var (_, lists) = Services(db);
        var fullTime = (await lists.GetAllAsync(default)).Single(list => list.Id == "employment-types").Values[0];
        var employment = await db.Employments.SingleAsync();
        employment.UpdateEmploymentType(await db.CompanyListValues.SingleAsync(value => value.Id == fullTime.Id));
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<CatalogConflictException>(() => lists.DeleteAsync(CompanyList.EmploymentTypes, fullTime.Id, Admin, default));
        var renamed = await lists.RenameAsync(CompanyList.EmploymentTypes, fullTime.Id, new ListValueRequest("Permanent full-time"), Admin, default);
        Assert.Equal(("full-time", "Permanent full-time", 1, true), (renamed.Key, renamed.Label, renamed.UsageCount, renamed.InUse));
        Assert.Equal("Permanent full-time", (await db.Employments.AsNoTracking().SingleAsync()).EmploymentType);

        Assert.True((await lists.SetRetiredAsync(CompanyList.EmploymentTypes, fullTime.Id, true, Admin, default)).IsRetired);
        var references = new CatalogReferences(db, TestTenantContext.WithTenant(TenantA));
        Assert.Equal("ListValue.Retired", (await references.ListValueAsync(CompanyList.EmploymentTypes, fullTime.Id, null, default)).Error.Code);
        Assert.Equal("ListValue.NotFound", (await references.ListValueAsync(CompanyList.Levels, fullTime.Id, null, default)).Error.Code);

        await Assert.ThrowsAsync<DuplicateEntityException>(() =>
            lists.AddAsync(CompanyList.EmploymentTypes, new ListValueRequest("part-time"), Admin, default));
        var again = await lists.AddAsync(CompanyList.EmploymentTypes, new ListValueRequest("Full time"), Admin, default);
        Assert.Equal("full-time-2", again.Key);
    }

    [Fact]
    public async Task Reordering_takes_every_value_once()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var (_, lists) = Services(db);
        var levels = (await lists.GetAllAsync(default)).Single(list => list.Id == "levels").Values;

        await Assert.ThrowsAsync<ArgumentException>(() => lists.ReorderAsync(CompanyList.Levels, new ListOrderRequest([levels[0].Id]), Admin, default));
        var reversed = levels.Select(value => value.Id).Reverse().ToList();
        var after = await lists.ReorderAsync(CompanyList.Levels, new ListOrderRequest(reversed), Admin, default);
        Assert.Equal(reversed, after.Single(list => list.Id == "levels").Values.Select(value => value.Id));
    }

    [Fact]
    public async Task Another_company_has_its_own_lists()
    {
        var world = await SeedAsync();
        Guid valueId;
        await using (var db = Db(world))
            valueId = (await Services(db).Lists.AddAsync(CompanyList.JobFamilies, new ListValueRequest("Sales"), Admin, default)).Id;

        await using var other = Db(world, TenantB);
        var (_, lists) = Services(other, TenantB);
        Assert.Empty((await lists.GetAllAsync(default)).Single(list => list.Id == "job-families").Values);
        await Assert.ThrowsAsync<EntityNotFoundException>(() => lists.RenameAsync(CompanyList.JobFamilies, valueId, new ListValueRequest("Mine"), Admin, default));
        await Assert.ThrowsAsync<EntityNotFoundException>(() => lists.DeleteAsync(CompanyList.JobFamilies, valueId, Admin, default));
    }

    // --- Who may ---------------------------------------------------------------------------------

    private static ClaimsPrincipal Caller(params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim> { new(CustomClaimTypes.TenantId, TenantA.ToString()), new(ClaimTypes.NameIdentifier, "u-2") };
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
    }

    private static CatalogController Controller(CoreHRDbContext db, ClaimsPrincipal caller)
    {
        var (jobs, lists) = Services(db);
        return new CatalogController(jobs, lists, new CoreAccessPolicyService())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        };
    }

    [Fact]
    public async Task Pickers_read_for_people_work_but_only_structure_owners_change_jobs_and_places()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var employee = Caller((CorePermissions.ProfileSelfView, PermissionScopes.Self), (CorePermissions.EmployeeView, PermissionScopes.Self));
        var hr = Caller((CorePermissions.EmployeeView, PermissionScopes.Tenant), (CorePermissions.EmployeeManage, PermissionScopes.Tenant));
        var owner = Caller((CorePermissions.OrganizationManage, PermissionScopes.Tenant));

        Assert.IsType<ForbidResult>((await Controller(db, employee).GetJobs(default)).Result);
        Assert.IsType<ForbidResult>((await Controller(db, employee).GetPlaces(default)).Result);
        Assert.IsType<ForbidResult>((await Controller(db, employee).GetLists(default)).Result);
        Assert.IsType<OkObjectResult>((await Controller(db, hr).GetJobs(default)).Result);
        Assert.IsType<OkObjectResult>((await Controller(db, hr).GetLists(default)).Result);

        Assert.IsType<ForbidResult>((await Controller(db, hr).CreateJob(new JobRequest("Analyst"), default)).Result);
        Assert.IsType<ForbidResult>((await Controller(db, hr).CreatePlace(new PlaceRequest("Sousse"), default)).Result);
        Assert.IsType<ForbidResult>(await Controller(db, hr).DeleteJob(Guid.NewGuid(), default));
        Assert.IsType<ForbidResult>((await Controller(db, hr).MergeJob(Guid.NewGuid(), new MergeRequest(Guid.NewGuid()), default)).Result);
        Assert.IsType<OkObjectResult>((await Controller(db, owner).CreateJob(new JobRequest("Analyst"), default)).Result);
        Assert.IsType<OkObjectResult>((await Controller(db, owner).CreatePlace(new PlaceRequest("Sousse"), default)).Result);
    }

    [Fact]
    public async Task Only_people_data_settings_managers_change_lists()
    {
        var world = await SeedAsync();
        await using var db = Db(world);
        var viewer = Caller((CorePermissions.SettingsPeopleDataView, PermissionScopes.Tenant));
        var owner = Caller((CorePermissions.OrganizationManage, PermissionScopes.Tenant));
        var manager = Caller((CorePermissions.SettingsPeopleDataManage, PermissionScopes.Tenant));

        Assert.IsType<OkObjectResult>((await Controller(db, viewer).GetLists(default)).Result);
        Assert.IsType<ForbidResult>((await Controller(db, viewer).AddValue("levels", new ListValueRequest("Principal"), default)).Result);
        Assert.IsType<ForbidResult>((await Controller(db, owner).AddValue("levels", new ListValueRequest("Principal"), default)).Result);
        Assert.IsType<ForbidResult>(await Controller(db, owner).DeleteValue("levels", Guid.NewGuid(), default));
        Assert.IsType<NotFoundObjectResult>((await Controller(db, manager).AddValue("colours", new ListValueRequest("Red"), default)).Result);
        Assert.IsType<OkObjectResult>((await Controller(db, manager).AddValue("levels", new ListValueRequest("Principal"), default)).Result);
    }
}
