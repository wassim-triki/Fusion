using System.Text.Json;
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

/// <summary>
/// B-239/B-312 on PostgreSQL: a hire fills an open role under its manager from the first day, answers the company's
/// required fields and says when they're invited; another company's role or another manager's role is refused.
/// </summary>
public sealed class HireOpenRoleRelationalTests
{
    [RelationalDatabaseFact]
    public async Task A_hire_fills_its_managers_open_role_and_nobody_elses()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_hire_role_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            var tenantA = Guid.NewGuid();
            var tenantB = Guid.NewGuid();
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var firstDay = today.AddDays(10);
            await using (var migrate = CreateDb(connectionString, tenantA))
                await migrate.Database.MigrateAsync();

            var a = await SeedAsync(connectionString, tenantA, "ALPHA", today);
            var b = await SeedAsync(connectionString, tenantB, "BETA", today);

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var catalog = EmployeeFieldCatalog.Create(tenantA, "hr");
                db.EmployeeFieldCatalogs.Add(catalog);
                db.EmployeeFieldDefinitions.Add(EmployeeFieldDefinition.Create(tenantA, catalog.Id, "languages", "Languages spoken",
                    EmployeeFieldArea.About, EmployeeFieldType.Tags, EmployeeFieldEditor.Hr, true, true, true, required: true,
                    isBuiltIn: false, sortOrder: 1, sourceKey: null, galleryKey: null, actor: "hr"));
                await db.SaveChangesAsync();
            }
            var languages = new Dictionary<string, JsonElement> { ["languages"] = JsonSerializer.SerializeToElement(new[] { "Arabic", "French" }) };

            async Task<EY.HRPlatform.SharedKernel.Results.Result<EstablishmentResultDto>> HireAsync(
                string first, Guid roleId, Guid managerId, IReadOnlyDictionary<string, JsonElement>? fields, HireInvite invite = HireInvite.Later, bool canInvite = false)
            {
                await using var db = CreateDb(connectionString, tenantA);
                var tenant = TestTenantContext.WithTenant(tenantA);
                var handler = new HireEmployeeCommandHandler(db, tenant, new EmployeeNumberAllocatorService(db, tenant),
                    new WorkforceMutationService(db, tenant, new WorkforceCanonicalResolver(db)), new OrganizationService(db, tenant));
                return await handler.Handle(new HireEmployeeCommand(new HireEmployeeRequest(
                    first, "Khemiri", null, $"{first.ToLowerInvariant()}@alpha.test", null, EmployeeNumberMode.Generated, null,
                    firstDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc), null, a.UnitId, db.JobId(tenantA, "Data Engineer"), null, managerId,
                    roleId, invite, fields), "hr|Amira", canInvite), default);
            }

            // Another company's role reads as missing; another manager's role is refused; nothing is saved either way.
            var foreign = await HireAsync("Sami", b.RoleId, a.WalidId, languages);
            Assert.Equal("OpenRole.Missing", foreign.Error.Code);
            var otherManager = await HireAsync("Sami", a.RoleId, a.FaresId, languages);
            Assert.Equal("OpenRole.OtherManager", otherManager.Error.Code);
            // The company's required field and the right to invite are checked before anything is saved.
            var unanswered = await HireAsync("Sami", a.RoleId, a.WalidId, null);
            Assert.Equal("EmployeeField.Required", unanswered.Error.Code);
            var uninvited = await HireAsync("Sami", a.RoleId, a.WalidId, languages, HireInvite.Now, canInvite: false);
            Assert.Equal("Invite.Forbidden", uninvited.Error.Code);

            var hired = await HireAsync("Ons", a.RoleId, a.WalidId, languages);
            Assert.True(hired.IsSuccess, hired.IsFailure ? hired.Error.Message : null);
            Assert.Equal("Later", hired.Value.Invitation);

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var ons = await db.Employees.AsNoTracking().SingleAsync(item => item.StableEmployeeKey == hired.Value.EmployeeKey);
                Assert.Single(await db.Employees.AsNoTracking().Where(item => item.FirstName == "Sami" || item.FirstName == "Ons").ToListAsync());
                var role = await db.OpenRoles.AsNoTracking().SingleAsync(item => item.Id == a.RoleId);
                Assert.Equal((OpenRoleStatus.Filled, ons.Id, firstDay), (role.Status, role.FilledByEmployeeId, role.FilledOn));
                var value = await db.EmployeeFieldValues.AsNoTracking().SingleAsync(item => item.EmployeeId == ons.Id);
                Assert.Equal(["Arabic", "French"], JsonSerializer.Deserialize<string[]>(value.ValueJson));
                // Later: the company's first-day send leaves Ons for HR to invite.
                Assert.True(await db.InvitationAutoSends.AsNoTracking()
                    .AnyAsync(item => item.EmployeeId == ons.Id && item.Kind == InvitationAutoSendKind.FirstDay));
            }

            // A filled role can't be filled again.
            var again = await HireAsync("Sami", a.RoleId, a.WalidId, languages);
            Assert.Equal("OpenRole.Taken", again.Error.Code);

            await using (var db = CreateDb(connectionString, tenantB))
            {
                var role = await db.OpenRoles.AsNoTracking().SingleAsync();
                Assert.Equal(OpenRoleStatus.Open, role.Status);
            }
        }
        finally
        {
            await DropDatabaseAsync(baseConnection, databaseName);
        }
    }

    private static async Task<(Guid UnitId, Guid WalidId, Guid FaresId, Guid RoleId)> SeedAsync(
        string connectionString, Guid tenant, string code, DateOnly today)
    {
        await using var db = CreateDb(connectionString, tenant);
        var organization = new OrganizationService(db, TestTenantContext.WithTenant(tenant));
        var root = await organization.CreateRootAsync(new CreateOrganizationRootRequest(code, code, today.AddDays(-30)), default);
        var unit = await organization.CreateUnitAsync(
            new CreateOrganizationUnitRequest($"{code}-E", "Engineering", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today.AddDays(-30)), default);
        var start = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddYears(-1), DateTimeKind.Utc);
        Employee Manager(string first, string number)
        {
            var employee = Employee.Create(tenant, first, "Manager", $"{first.ToLowerInvariant()}@{code.ToLowerInvariant()}.test", employeeNumber: number);
            var employment = Employment.Start(tenant, employee.Id, start, null, WorkforceSourceType.Manual);
            db.Employees.Add(employee);
            db.Employments.Add(employment);
            db.WorkAssignments.Add(WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, db.Job(tenant, "Engineering Manager"), null, true, start, null, WorkforceSourceType.Manual));
            return employee;
        }
        var walid = Manager("Walid", $"W-{code}");
        var fares = Manager("Fares", $"F-{code}");
        var role = OpenRole.Create(tenant, db.Job(tenant, "Data Engineer"), null, walid.Id, unit.Id, today.AddDays(10), OpenRoleStatus.Open, "hr");
        db.OpenRoles.Add(role);
        await db.SaveChangesAsync();
        return (unit.Id, walid.Id, fares.Id, role.Id);
    }

    private static CoreHRDbContext CreateDb(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task CreateDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using (var terminate = new NpgsqlCommand(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @name AND pid <> pg_backend_pid();", connection))
        {
            terminate.Parameters.AddWithValue("name", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\"", connection);
        await drop.ExecuteNonQueryAsync();
    }
}
