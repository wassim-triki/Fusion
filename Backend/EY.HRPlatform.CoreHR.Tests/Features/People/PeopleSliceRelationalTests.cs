using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

public sealed class PeopleSliceRelationalTests
{
    [RelationalDatabaseFact]
    public async Task Canonical_people_hire_and_establish_are_atomic_bounded_and_tenant_isolated()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_people_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection)
        {
            Database = databaseName,
            Pooling = false,
        }.ConnectionString;

        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            var tenantId = Guid.NewGuid();
            var today = DateTime.UtcNow.Date;
            await using var db = CreateDb(connectionString, tenantId);
            await db.Database.MigrateAsync();

            var tenant = TestTenantContext.WithTenant(tenantId);
            var organization = new OrganizationService(db, tenant);
            var root = await organization.CreateRootAsync(
                new CreateOrganizationRootRequest("FUSION", "Fusion", DateOnly.FromDateTime(today)), default);
            var peopleUnit = await organization.CreateUnitAsync(
                new CreateOrganizationUnitRequest(
                    "PEOPLE",
                    "People Operations",
                    OrganizationalUnitTypeCatalog.DepartmentId,
                    root.Id,
                    DateOnly.FromDateTime(today)),
                default);
            var allocator = new EmployeeNumberAllocatorService(db, tenant);
            var mutation = new WorkforceMutationService(db, tenant, new WorkforceCanonicalResolver(db));

            var hire = await new HireEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                new HireEmployeeCommand(
                    new HireEmployeeRequest(
                        "Maya", "North", null, null, null,
                        EmployeeNumberMode.Generated, null, today, db.EmploymentType(tenant.TenantId, "Full-time").Id,
                        peopleUnit.Id, db.JobId(tenant.TenantId, "People Partner"), db.PlaceId(tenant.TenantId, "Tunis"), null),
                    "test|Workforce Administrator"),
                default);
            Assert.True(hire.IsSuccess);
            Assert.Equal("EMP-00000001", hire.Value.EmployeeNumber);
            Assert.Null(hire.Value.WorkEmail);
            var managerId = await db.Employees
                .Where(employee => employee.StableEmployeeKey == hire.Value.EmployeeKey)
                .Select(employee => employee.Id)
                .SingleAsync();

            var establish = await new AddExistingEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                new AddExistingEmployeeCommand(
                    new AddExistingEmployeeRequest(
                        "Jon", "Vale", null, "jon.vale@fusion.local", null,
                        EmployeeNumberMode.Manual, "wv-2042", new DateTime(2022, 4, 11), today,
                        db.EmploymentType(tenant.TenantId, "Full-time").Id, peopleUnit.Id, db.JobId(tenant.TenantId, "People Analyst"), null, managerId),
                    "test|Workforce Administrator"),
                default);
            Assert.True(establish.IsSuccess);
            Assert.Equal("WV-2042", establish.Value.EmployeeNumber);
            Assert.Equal(new DateTime(2022, 4, 11), establish.Value.EmploymentStart);
            Assert.Equal(today, establish.Value.WorkDetailsEffectiveFrom);
            Assert.Equal("Maya North", establish.Value.PrimaryManagerName);

            var people = await new PeopleQueryHandler(db, tenant).Handle(
                new PeopleQuery(
                    Q: "jon.vale",
                    State: PeopleEmploymentState.Active,
                    OrgUnitId: root.Id,
                    OrganizationScope: PeopleOrganizationScope.Subtree,
                    Sort: PeopleSortField.EmployeeNumber,
                    PageSize: 1),
                default);
            Assert.True(people.IsSuccess);
            Assert.Equal(1, people.Value.TotalCount);
            var row = Assert.Single(people.Value.Items);
            Assert.Equal(establish.Value.EmployeeKey, row.EmployeeKey);
            Assert.Equal("Fusion / People Operations", row.Work!.OrganizationPath);
            Assert.Equal("Maya North", row.PrimaryManager!.DisplayName);

            var profile = await new PeopleProfileQueryHandler(db, organization, new EY.HRPlatform.CoreHR.Features.People.Changes.WorkforceChangeReader(db)).Handle(
                new PeopleProfileQuery(establish.Value.EmployeeKey), default);
            Assert.True(profile.IsSuccess);
            Assert.Equal(PeopleEmploymentState.Active, profile.Value.Employment.State);
            Assert.Equal(new DateTime(2022, 4, 11), profile.Value.Employment.Start);
            Assert.Equal(today, profile.Value.Work!.EffectiveFrom);
            Assert.Equal(hire.Value.EmployeeKey, profile.Value.PrimaryManager!.EmployeeKey);

            var managerProfile = await new PeopleProfileQueryHandler(db, organization, new EY.HRPlatform.CoreHR.Features.People.Changes.WorkforceChangeReader(db)).Handle(
                new PeopleProfileQuery(hire.Value.EmployeeKey), default);
            Assert.Equal(1, managerProfile.Value.DirectReportCount);
            Assert.Equal(establish.Value.EmployeeKey, Assert.Single(managerProfile.Value.DirectReports).EmployeeKey);

            var employeeCount = await db.Employees.CountAsync();
            var duplicate = await new HireEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                new HireEmployeeCommand(
                    new HireEmployeeRequest(
                        "Duplicate", "Number", null, null, null,
                        EmployeeNumberMode.Manual, "wv-2042", today, null,
                        peopleUnit.Id, db.JobId(tenant.TenantId, "Analyst"), null, null),
                    "test|Workforce Administrator"),
                default);
            Assert.True(duplicate.IsFailure);
            Assert.Equal("EmployeeNumber.AlreadyOwned", duplicate.Error.Code);
            Assert.Contains(establish.Value.EmployeeKey, duplicate.Error.Message, StringComparison.Ordinal);
            Assert.Equal(employeeCount, await db.Employees.CountAsync());

            var invalidDates = await new AddExistingEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                new AddExistingEmployeeCommand(
                    new AddExistingEmployeeRequest(
                        "Future", "Existing", null, null, null,
                        EmployeeNumberMode.Generated, null, today.AddDays(1), today,
                        null, peopleUnit.Id, db.JobId(tenant.TenantId, "Analyst"), null, null),
                    "test|Workforce Administrator"),
                default);
            Assert.True(invalidDates.IsFailure);
            Assert.Equal("Establish.StartDateFuture", invalidDates.Error.Code);
            Assert.Equal(employeeCount, await db.Employees.CountAsync());

            var future = await new HireEmployeeCommandHandler(db, tenant, allocator, mutation, organization).Handle(
                new HireEmployeeCommand(
                    new HireEmployeeRequest(
                        "Future", "Hire", null, null, null,
                        EmployeeNumberMode.Generated, null, today.AddDays(30), null,
                        peopleUnit.Id, db.JobId(tenant.TenantId, "Advisor"), null, null),
                    "test|Workforce Administrator"),
                default);
            Assert.True(future.IsSuccess);
            Assert.Equal(PeopleEmploymentState.Scheduled, future.Value.EmploymentState);

            Assert.Equal(2, await db.WorkforceAuditEntries.CountAsync(entry =>
                entry.Action == WorkforceAuditAction.Hire));
            Assert.Single(await db.WorkforceAuditEntries.Where(entry =>
                entry.Action == WorkforceAuditAction.Establish).ToListAsync());
            Assert.Single(await db.WorkEmailOccupancies.ToListAsync());

            var otherTenant = Guid.NewGuid();
            await using var otherDb = CreateDb(connectionString, otherTenant);
            var isolatedPeople = await new PeopleQueryHandler(otherDb, TestTenantContext.WithTenant(otherTenant))
                .Handle(new PeopleQuery(), default);
            Assert.Empty(isolatedPeople.Value.Items);
            var hiddenProfile = await new PeopleProfileQueryHandler(
                    otherDb,
                    new OrganizationService(otherDb, TestTenantContext.WithTenant(otherTenant)),
                    new EY.HRPlatform.CoreHR.Features.People.Changes.WorkforceChangeReader(otherDb))
                .Handle(new PeopleProfileQuery(establish.Value.EmployeeKey), default);
            Assert.True(hiddenProfile.IsFailure);
            Assert.Equal("Employee.NotFound", hiddenProfile.Error.Code);
        }
        finally
        {
            await DropDatabaseAsync(baseConnection, databaseName);
        }
    }

    private static CoreHRDbContext CreateDb(string connectionString, Guid tenantId)
        => new(
            new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options,
            TestTenantContext.WithTenant(tenantId));

    private static async Task CreateDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var adminConnection = new NpgsqlConnectionStringBuilder(baseConnectionString)
        {
            Database = "postgres",
            Pooling = false,
        }.ConnectionString;
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var adminConnection = new NpgsqlConnectionStringBuilder(baseConnectionString)
        {
            Database = "postgres",
            Pooling = false,
        }.ConnectionString;
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using (var terminate = new NpgsqlCommand(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @databaseName AND pid <> pg_backend_pid();",
            connection))
        {
            terminate.Parameters.AddWithValue("databaseName", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\"", connection);
        await drop.ExecuteNonQueryAsync();
    }
}
