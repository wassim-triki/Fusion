using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>B-127 on PostgreSQL: emergency contacts are inserted and replaced through the employee, and the migration rolls back.</summary>
public sealed class PersonalDetailsRelationalTests
{
    [RelationalDatabaseFact]
    public async Task Emergency_contacts_are_replaced_through_the_employee_and_the_migration_rolls_back()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_personal_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantId = Guid.NewGuid();

        try
        {
            await ExecuteAdminAsync(baseConnection, $"CREATE DATABASE \"{databaseName}\"");
            await using (var db = CreateDb(connectionString, tenantId))
            {
                await db.Database.MigrateAsync();
                db.Employees.Add(Employee.Create(tenantId, "Nour", "Ben Ali", "nour@example.test", employeeNumber: "E-1"));
                await db.SaveChangesAsync();
            }

            var key = await Key(connectionString, tenantId);
            var self = new PeopleViewer(null, ManagesPeople: true, ViewsTenant: true, ManagesTeam: false, UpdatesSelf: false, PersonalGrant.Change);
            async Task<PeoplePersonalDto> SaveAsync(params PeopleEmergencyContactDto[] contacts)
            {
                await using var db = CreateDb(connectionString, tenantId);
                var current = await new PeoplePersonalQueryHandler(db).Handle(new PeoplePersonalQuery(key, self), default);
                var result = await new UpdatePeoplePersonalCommandHandler(db, TestTenantContext.WithTenant(tenantId)).Handle(
                    new UpdatePeoplePersonalCommand(key, self, current.Value.Version,
                        new UpdatePersonalRequest(null, "+216 98 000 000", null, null, new DateOnly(1990, 1, 2), contacts), "test"),
                    default);
                Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
                Assert.NotEqual(current.Value.Version, result.Value.Version);
                return result.Value;
            }

            await SaveAsync(new PeopleEmergencyContactDto("Leila", "Sister", "+216 22 111 111"), new PeopleEmergencyContactDto("Sami", null, "+216 22 222 222"));
            var replaced = await SaveAsync(new PeopleEmergencyContactDto("Hedi", "Father", "+216 22 333 333"));
            Assert.Equal("Hedi", Assert.Single(replaced.EmergencyContacts!).Name);

            await using (var db = CreateDb(connectionString, tenantId))
                Assert.Equal(1, await db.EmergencyContacts.CountAsync());
            // Another tenant sees none of them.
            await using (var other = CreateDb(connectionString, Guid.NewGuid()))
                Assert.Equal(0, await other.EmergencyContacts.CountAsync());

            await using (var db = CreateDb(connectionString, tenantId))
            {
                var migrator = db.GetService<IMigrator>();
                await migrator.MigrateAsync("20261027225458_AddOpenRoles");
                await migrator.MigrateAsync();
            }
        }
        finally
        {
            await ExecuteAdminAsync(baseConnection,
                $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{databaseName}' AND pid <> pg_backend_pid()");
            await ExecuteAdminAsync(baseConnection, $"DROP DATABASE IF EXISTS \"{databaseName}\"");
        }
    }

    private static async Task<string> Key(string connectionString, Guid tenantId)
    {
        await using var db = CreateDb(connectionString, tenantId);
        return await db.Employees.Select(item => item.StableEmployeeKey).SingleAsync();
    }

    private static CoreHRDbContext CreateDb(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task ExecuteAdminAsync(string baseConnection, string sql)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnection) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
