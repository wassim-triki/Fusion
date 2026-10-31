using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.EmployeeFields;

/// <summary>
/// B-181 on PostgreSQL: the eight fixed field settings move from the settings JSON into each company's field
/// catalogue, other settings stay where they were, and rolling back puts the policy back unchanged.
/// </summary>
public sealed class EmployeeFieldMigrationRelationalTests
{
    private const string Before = "20261031145219_AddEmployeeAbout";

    [RelationalDatabaseFact]
    public async Task Legacy_field_settings_move_into_the_catalogue_and_rolling_back_restores_them()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_fields_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        try
        {
            await ExecuteAsync(baseConnection, "postgres", $"CREATE DATABASE \"{databaseName}\"");
            await using (var db = CreateDb(connectionString, tenantA))
                await db.GetService<IMigrator>().MigrateAsync(Before);
            await ExecuteAsync(connectionString, null, $$$"""
                INSERT INTO corehr."TenantSettings" ("Id", "TenantId", "SettingsOverrides", "CreatedAt")
                VALUES (gen_random_uuid(), '{{{tenantA}}}',
                    '{"employeeFieldConfig":{"phone":{"visible":false,"required":true},"jobTitle":{"visibleToManager":false}},"orgChart":{"audience":"ManagersAndHr"}}',
                    now()),
                       (gen_random_uuid(), '{{{tenantB}}}', '{"orgChart":{"audience":"Everyone"}}', now());
                """);

            await using (var db = CreateDb(connectionString, tenantA))
                await db.Database.MigrateAsync();

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var fields = await db.EmployeeFieldDefinitions.ToDictionaryAsync(item => item.SourceKey!);
                Assert.Equal(14, fields.Count);
                Assert.False(fields["phone"].Visible);
                Assert.True(fields["phone"].Required);
                Assert.False(fields["jobTitle"].VisibleToManager);
                Assert.True(fields["jobTitle"].Visible);
                Assert.True(fields["firstName"].Required);
                Assert.False(fields["dateOfBirth"].VisibleToManager);
            }
            await using (var db = CreateDb(connectionString, tenantB))
                Assert.Equal(14, await db.EmployeeFieldDefinitions.CountAsync());
            Assert.Equal("""{"orgChart": {"audience": "ManagersAndHr"}}""", await OverridesAsync(connectionString, tenantA));

            await using (var db = CreateDb(connectionString, tenantA))
                await db.GetService<IMigrator>().MigrateAsync(Before);

            var restored = await OverridesAsync(connectionString, tenantA);
            Assert.Contains("\"orgChart\": {\"audience\": \"ManagersAndHr\"}", restored);
            Assert.Contains("\"phone\": {\"visible\": false, \"required\": true, \"visibleToManager\": true, \"visibleToEmployee\": true}", restored);
            Assert.Contains("\"jobTitle\": {\"visible\": true, \"required\": false, \"visibleToManager\": false, \"visibleToEmployee\": true}", restored);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await ExecuteAsync(baseConnection, "postgres", $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)");
        }
    }

    private static async Task<string?> OverridesAsync(string connectionString, Guid tenant)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            $"SELECT \"SettingsOverrides\"::text FROM corehr.\"TenantSettings\" WHERE \"TenantId\" = '{tenant}'", connection);
        return (string?)await command.ExecuteScalarAsync();
    }

    private static CoreHRDbContext CreateDb(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task ExecuteAsync(string connectionString, string? database, string sql)
    {
        var target = database is null ? connectionString
            : new NpgsqlConnectionStringBuilder(connectionString) { Database = database, Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(target);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}
