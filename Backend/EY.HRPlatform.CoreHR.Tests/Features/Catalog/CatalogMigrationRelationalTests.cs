using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.Catalog;

/// <summary>
/// B-175 on PostgreSQL: free-text titles, locations and employment types become each tenant's jobs, places and list
/// values (spellings grouped, the most common one naming the job), and rolling the migration back keeps the text.
/// </summary>
public sealed class CatalogMigrationRelationalTests
{
    private const string Before = "20261029165727_AddNotificationDefaults";

    [RelationalDatabaseFact]
    public async Task Titles_become_jobs_per_tenant_and_rolling_back_keeps_the_text()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_catalog_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();

        try
        {
            await ExecuteAsync(baseConnection, "postgres", $"CREATE DATABASE \"{databaseName}\"");
            await using (var db = CreateDb(connectionString, tenantA))
                await db.Database.MigrateAsync();
            await SeedAsync(connectionString, tenantA, ["Engineer", "Engineer", "Engineer", "Designer"]);
            await SeedAsync(connectionString, tenantB, ["Engineer"]);

            await using (var db = CreateDb(connectionString, tenantA))
                await db.GetService<IMigrator>().MigrateAsync(Before);

            // Spellings the free text had: case, spacing and an employment type typed two ways.
            await ExecuteAsync(connectionString, null, $"""
                UPDATE corehr."WorkAssignments" SET "JobTitle" = ' engineer  ', "WorkLocation" = 'tunis'
                WHERE "TenantId" = '{tenantA}' AND "Id" = (SELECT "Id" FROM corehr."WorkAssignments" WHERE "TenantId" = '{tenantA}' AND "JobTitle" = 'Engineer' LIMIT 1);
                UPDATE corehr."Employments" SET "EmploymentType" = 'Full-time' WHERE "TenantId" = '{tenantA}';
                UPDATE corehr."Employments" SET "EmploymentType" = 'FULL-TIME' WHERE "TenantId" = '{tenantA}'
                    AND "Id" = (SELECT "Id" FROM corehr."Employments" WHERE "TenantId" = '{tenantA}' LIMIT 1);
                """);

            await using (var db = CreateDb(connectionString, tenantA))
                await db.Database.MigrateAsync();

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var jobs = await db.Jobs.OrderBy(job => job.Title).ToListAsync();
                Assert.Equal(["Designer", "Engineer"], jobs.Select(job => job.Title));
                var assignments = await db.WorkAssignments.ToListAsync();
                Assert.All(assignments, item => Assert.Equal(jobs.Single(job => job.Id == item.JobId).Title, item.JobTitle));
                Assert.Equal(3, assignments.Count(item => item.JobTitle == "Engineer"));
                var place = Assert.Single(await db.Places.ToListAsync());
                Assert.Equal("Tunis", place.Name);
                Assert.All(assignments, item => Assert.Equal((place.Id, "Tunis"), (item.PlaceId, item.WorkLocation)));
                var type = Assert.Single(await db.CompanyListValues.ToListAsync());
                Assert.Equal((CompanyList.EmploymentTypes, "full-time", "Full-time"), (type.List, type.Key, type.Label));
                Assert.All(await db.Employments.ToListAsync(), item => Assert.Equal((type.Id, "Full-time"), (item.EmploymentTypeId, item.EmploymentType)));
            }

            await using (var db = CreateDb(connectionString, tenantB))
            {
                var job = Assert.Single(await db.Jobs.ToListAsync());
                Assert.Equal(job.Id, (await db.WorkAssignments.SingleAsync()).JobId);
            }

            await using (var db = CreateDb(connectionString, tenantA))
                await db.GetService<IMigrator>().MigrateAsync(Before);
            Assert.Equal(["Designer", "Engineer", "Engineer", "Engineer"], await TextAsync(connectionString, tenantA));
            await using (var db = CreateDb(connectionString, tenantA))
                await db.Database.MigrateAsync();
        }
        finally
        {
            await ExecuteAsync(baseConnection, "postgres",
                $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{databaseName}' AND pid <> pg_backend_pid()");
            await ExecuteAsync(baseConnection, "postgres", $"DROP DATABASE IF EXISTS \"{databaseName}\"");
        }
    }

    private static async Task SeedAsync(string connectionString, Guid tenant, string[] titles)
    {
        await using var db = CreateDb(connectionString, tenant);
        var unit = OrgUnit.Create(tenant, $"U{Guid.NewGuid():N}"[..8], "Unit", "Department", null);
        db.OrgUnits.Add(unit);
        var start = DateTime.SpecifyKind(DateTime.UtcNow.Date.AddYears(-1), DateTimeKind.Utc);
        var n = 0;
        foreach (var title in titles)
        {
            var employee = Employee.Create(tenant, "P", $"Person {++n}", null, employeeNumber: $"E-{Guid.NewGuid():N}"[..12]);
            var employment = Employment.Start(tenant, employee.Id, start, null, WorkforceSourceType.Manual);
            db.AddRange(employee, employment);
            db.WorkAssignments.Add(WorkAssignment.Create(tenant, employment.Id, employee.Id, unit.Id, db.Job(tenant, title),
                db.Place(tenant, "Tunis"), true, start, null, WorkforceSourceType.Manual));
        }
        await db.SaveChangesAsync();
    }

    private static async Task<List<string>> TextAsync(string connectionString, Guid tenant)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            $"SELECT btrim(\"JobTitle\") FROM corehr.\"WorkAssignments\" WHERE \"TenantId\" = '{tenant}' ORDER BY 1", connection);
        var titles = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) titles.Add(reader.GetString(0));
        return titles;
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
