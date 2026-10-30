using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.OrgChart;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.OrgChart;

/// <summary>B-128 on PostgreSQL: open roles save, read back on the chart and stay inside their tenant.</summary>
public sealed class OpenRoleRelationalTests
{
    [RelationalDatabaseFact]
    public async Task Open_roles_save_and_read_back_within_their_tenant()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_open_roles_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            var tenantA = Guid.NewGuid();
            var tenantB = Guid.NewGuid();
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            await using (var migrate = CreateDb(connectionString, tenantA))
                await migrate.Database.MigrateAsync();

            async Task<(Guid UnitId, string ManagerKey)> SeedAsync(Guid tenant, string code)
            {
                await using var db = CreateDb(connectionString, tenant);
                var organization = new OrganizationService(db, TestTenantContext.WithTenant(tenant));
                var root = await organization.CreateRootAsync(new CreateOrganizationRootRequest(code, code, today.AddDays(-30)), default);
                var unit = await organization.CreateUnitAsync(
                    new CreateOrganizationUnitRequest($"{code}-P", "Product", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, today.AddDays(-30)), default);
                var employee = Employee.Create(tenant, "Fares", "Lachheb", $"fares@{code.ToLowerInvariant()}.test", employeeNumber: $"E-{code}");
                var start = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddYears(-1), DateTimeKind.Utc);
                var employment = Employment.Start(tenant, employee.Id, start, null, WorkforceSourceType.Manual);
                db.Employees.Add(employee);
                db.Employments.Add(employment);
                db.WorkAssignments.Add(WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, db.Job(tenant, "Design Lead"), db.Place(tenant, "Tunis"), true, start, null, WorkforceSourceType.Manual));
                await db.SaveChangesAsync();
                return (unit.Id, employee.StableEmployeeKey);
            }

            var a = await SeedAsync(tenantA, "ALPHA");
            var b = await SeedAsync(tenantB, "BETA");

            OrgChartOpenRoleDto created;
            await using (var db = CreateDb(connectionString, tenantA))
            {
                var result = await new CreateOpenRoleCommandHandler(db, TestTenantContext.WithTenant(tenantA)).Handle(
                    new CreateOpenRoleCommand(new OpenRoleRequest(db.JobId(tenantA, "Senior Product Designer"), a.ManagerKey, a.UnitId, today.AddDays(60)), "hr|Amira"), default);
                Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
                created = result.Value;
                Assert.Equal("Product", created.Unit?.Name);
            }

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var chart = await ChartAsync(db);
                var role = Assert.Single(chart.OpenRoles);
                Assert.Equal((created.Id, a.ManagerKey, today.AddDays(60)), (role.Id, role.ManagerKey, role.TargetStartDate));

                var held = await new UpdateOpenRoleCommandHandler(db, TestTenantContext.WithTenant(tenantA)).Handle(new UpdateOpenRoleCommand(created.Id,
                    new OpenRoleRequest(db.JobId(tenantA, "Senior Product Designer"), a.ManagerKey, a.UnitId, today.AddDays(60), OpenRoleStatus.OnHold), "hr|Amira"), default);
                Assert.True(held.IsSuccess);
            }

            await using (var db = CreateDb(connectionString, tenantB))
            {
                Assert.Empty((await ChartAsync(db)).OpenRoles);
                var foreign = await new UpdateOpenRoleCommandHandler(db, TestTenantContext.WithTenant(tenantB)).Handle(new UpdateOpenRoleCommand(created.Id,
                    new OpenRoleRequest(db.JobId(tenantB, "Taken"), b.ManagerKey, b.UnitId), "hr|Other"), default);
                Assert.Equal(OpenRoleErrors.NotFoundCode, foreign.Error.Code);
                var crossUnit = await new CreateOpenRoleCommandHandler(db, TestTenantContext.WithTenant(tenantB)).Handle(
                    new CreateOpenRoleCommand(new OpenRoleRequest(db.JobId(tenantB, "Probe"), b.ManagerKey, a.UnitId), "hr|Other"), default);
                Assert.Equal("OpenRole.Unit", crossUnit.Error.Code);
            }

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var stored = await db.OpenRoles.AsNoTracking().SingleAsync();
                Assert.Equal((OpenRoleStatus.OnHold, "hr|Amira"), (stored.Status, stored.UpdatedBy));
            }
        }
        finally
        {
            await DropDatabaseAsync(baseConnection, databaseName);
        }
    }

    private static async Task<OrgChartDto> ChartAsync(CoreHRDbContext db)
    {
        var settings = new Mock<ITenantSettingsReadService>();
        settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
        var result = await new OrgChartQueryHandler(db, settings.Object).Handle(
            new OrgChartQuery(DateOnly.FromDateTime(DateTime.UtcNow), OrgChartScopes.Tenant, null, HrAudience: true), default);
        return result.Value;
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
