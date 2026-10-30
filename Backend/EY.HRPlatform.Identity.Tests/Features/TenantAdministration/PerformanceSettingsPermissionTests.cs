using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace EY.HRPlatform.Identity.Tests.Features.TenantAdministration;

/// <summary>
/// The Performance settings pair (B-071 D5): in the catalogue, on the administration templates,
/// composed into Tenant Administrator, and backfilled once onto custom profiles that administer cycles.
/// </summary>
public sealed class PerformanceSettingsPermissionTests : IAsyncLifetime
{
    private const string BeforeBackfill = "20260922091118_AddTenantIndustry";

    private static readonly string[] SettingsKeys = [PerformancePermissions.SettingsView, PerformancePermissions.SettingsManage];

    private readonly RelationalTestDatabase _databases = new();
    private readonly List<string> _rawDatabases = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        await _databases.DisposeAsync();
        if (!_databases.Available)
        {
            return;
        }

        foreach (var database in _rawDatabases)
        {
            try
            {
                await using var connection = new NpgsqlConnection(_databases.AdminConnectionString);
                await connection.OpenAsync();
                await using var terminate = connection.CreateCommand();
                terminate.CommandText = $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{database}';";
                await terminate.ExecuteNonQueryAsync();
                await using var drop = connection.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{database}\";";
                await drop.ExecuteNonQueryAsync();
            }
            catch (NpgsqlException)
            {
                // A leaked test database is noise, not a failure signal.
            }
        }
    }

    [Fact]
    public void The_performance_catalogue_has_exactly_eight_permissions()
    {
        Assert.Equal(
            [
                PerformancePermissions.CycleView,
                PerformancePermissions.CycleManage,
                PerformancePermissions.StrategyPublish,
                PerformancePermissions.ObjectiveSelfManage,
                PerformancePermissions.ObjectiveOrgManage,
                PerformancePermissions.ReviewCalibrate,
                PerformancePermissions.SettingsView,
                PerformancePermissions.SettingsManage,
            ],
            PerformancePermissionCatalog.Definitions.Select(definition => definition.Key));
        Assert.Equal(8, PerformancePermissions.All.Count);

        foreach (var key in SettingsKeys)
        {
            var definition = Assert.Single(PerformancePermissionCatalog.Definitions, item => item.Key == key);
            Assert.Equal([PermissionScopes.Tenant], definition.AllowedScopes);
            Assert.False(string.IsNullOrWhiteSpace(definition.HelperText));
            Assert.NotNull(PermissionCatalog.NormalizeGrant(key, PermissionScopes.Tenant));
        }
    }

    [Fact]
    public void Settings_are_seeded_to_HR_only_among_the_standard_roles()
    {
        var profiles = AccessProfileTemplates.ComposeSeeded(performanceEnabled: true)
            .ToDictionary(profile => profile.InternalKey);

        Assert.All(SettingsKeys, key =>
        {
            Assert.Contains(profiles["hr-admin"].Grants, grant => grant.PermissionKey == key && grant.Scope == PermissionScopes.Tenant);
            Assert.DoesNotContain(profiles["employee"].Grants, grant => grant.PermissionKey == key);
            Assert.DoesNotContain(profiles["manager"].Grants, grant => grant.PermissionKey == key);
        });
    }

    [Fact]
    public void Tenant_administrator_composes_settings_only_when_performance_is_enabled()
    {
        var disabled = AccessProfileTemplates.BuildTenantAdministrator([]).Grants;
        var enabled = AccessProfileTemplates.BuildTenantAdministrator([PermissionModuleKeys.Performance]).Grants;

        Assert.All(SettingsKeys, key =>
        {
            Assert.DoesNotContain(disabled, grant => grant.PermissionKey == key);
            Assert.Contains(enabled, grant => grant.PermissionKey == key && grant.Scope == PermissionScopes.Tenant);
        });
    }

    [SkippableFact]
    public async Task The_backfill_adds_the_pair_once_to_custom_cycle_administrators_in_their_own_tenant()
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, world) = await UpgradeAsync();
        await using var _db = db;

        Assert.Equal(SettingsKeys.Order(), await SettingsGrantsAsync(db, world.CycleAdminProfile));
        Assert.All(await AllGrantsAsync(db, world.CycleAdminProfile), grant =>
            Assert.Equal(world.TenantA, grant.TenantId));

        // A profile that already held one of the pair keeps one row per key.
        Assert.Equal(SettingsKeys.Order(), await SettingsGrantsAsync(db, world.PartialProfile));

        // Profiles without cycle administration, and other tenants' profiles, are untouched.
        Assert.Empty(await SettingsGrantsAsync(db, world.ViewerProfile));
        Assert.Empty(await SettingsGrantsAsync(db, world.OtherTenantProfile));

        // Up/Down: the backfill is not reversed, and re-applying it adds nothing.
        await db.GetService<IMigrator>().MigrateAsync(BeforeBackfill);
        await db.Database.MigrateAsync();
        Assert.Equal(2, (await AllGrantsAsync(db, world.CycleAdminProfile))
            .Count(grant => SettingsKeys.Contains(grant.PermissionKey)));
    }

    [SkippableFact]
    public async Task A_removal_after_the_backfill_survives_the_startup_profile_sync()
    {
        Skip.IfNot(_databases.Available, "No PostgreSQL connection configured.");
        var (db, world) = await UpgradeAsync();
        await using var _db = db;

        var profile = await db.AccessProfiles.Include(item => item.Grants)
            .SingleAsync(item => item.Id == world.CycleAdminProfile);
        profile.ReplaceGrants(profile.Grants
            .Where(grant => grant.PermissionKey != PerformancePermissions.SettingsManage)
            .Select(grant => AccessProfileGrant.Create(grant.TenantId, grant.AccessProfileId, grant.PermissionKey, grant.Scope))
            .ToList());
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        await new AccessProfileService(db, RelationalTestDatabase.CreateUserManager(db)).EnsureSeedDataAsync();
        db.ChangeTracker.Clear();

        Assert.Equal([PerformancePermissions.SettingsView], await SettingsGrantsAsync(db, world.CycleAdminProfile));
    }

    private sealed record World(Guid TenantA, Guid CycleAdminProfile, Guid PartialProfile, Guid ViewerProfile, Guid OtherTenantProfile);

    /// <summary>Migrates to just before the backfill, seeds profiles, then applies the rest.</summary>
    private async Task<(AppIdentityDbContext Db, World World)> UpgradeAsync()
    {
        var name = $"fusion_settings_backfill_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(_databases.AdminConnectionString))
        {
            await connection.OpenAsync();
            await using var create = connection.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{name}\";";
            await create.ExecuteNonQueryAsync();
        }

        _rawDatabases.Add(name);
        var db = new AppIdentityDbContext(new DbContextOptionsBuilder<AppIdentityDbContext>()
            .UseNpgsql(new NpgsqlConnectionStringBuilder(_databases.AdminConnectionString) { Database = name }.ConnectionString)
            .Options);
        await db.GetService<IMigrator>().MigrateAsync(BeforeBackfill);

        var tenantA = await SeedTenantAsync(db, "Atlas Group");
        var tenantB = await SeedTenantAsync(db, "Borealis");

        var cycleAdmin = Custom(tenantA, "Performance lead",
            (PerformancePermissions.CycleManage, PermissionScopes.Tenant),
            (PerformancePermissions.CycleView, PermissionScopes.Tenant));
        var partial = Custom(tenantA, "Cycle runner",
            (PerformancePermissions.CycleManage, PermissionScopes.Tenant),
            (PerformancePermissions.SettingsView, PermissionScopes.Tenant));
        var viewer = Custom(tenantA, "Performance viewer",
            (PerformancePermissions.CycleView, PermissionScopes.Tenant));
        var other = Custom(tenantB, "Borealis viewer",
            (PerformancePermissions.CycleView, PermissionScopes.Tenant));

        foreach (var profile in new[] { cycleAdmin, partial, viewer, other })
            await InsertAsync(db, profile);

        await db.Database.MigrateAsync();
        db.ChangeTracker.Clear();
        return (db, new World(tenantA, cycleAdmin.Id, partial.Id, viewer.Id, other.Id));
    }

    private static async Task InsertAsync(AppIdentityDbContext db, AccessProfile profile)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            INSERT INTO identity."AccessProfiles" ("Id","TenantId","Name","NormalizedName","Type","IsSystemProtected","CreatedAt")
            VALUES ({0},{1},{2},{3},{4},false,now())
            """,
            profile.Id, profile.TenantId, profile.Name, profile.NormalizedName, profile.Type);
        foreach (var grant in profile.Grants)
        {
            await db.Database.ExecuteSqlRawAsync(
                """INSERT INTO identity."AccessProfileGrants" ("TenantId","AccessProfileId","PermissionKey","Scope") VALUES ({0},{1},{2},{3})""",
                grant.TenantId, grant.AccessProfileId, grant.PermissionKey, grant.Scope);
        }
    }

    private static AccessProfile Custom(Guid tenantId, string name, params (string Key, string Scope)[] grants)
    {
        var profile = AccessProfile.Create(tenantId, name, null, AccessProfileTypes.Custom, isSystemProtected: false);
        profile.ReplaceGrants(grants.Select(grant => AccessProfileGrant.Create(tenantId, profile.Id, grant.Key, grant.Scope)).ToList());
        return profile;
    }

    private static async Task<Guid> SeedTenantAsync(AppIdentityDbContext db, string name)
    {
        var id = Guid.NewGuid();
        await db.Database.ExecuteSqlRawAsync($"""
            INSERT INTO identity."Tenants"
                ("Id","Name","Slug","IsActive","IsArchived","CreatedAt","AdministratorActivationStatus","Locale","TimeZone")
            VALUES ('{id}','{name}','tenant-{id:N}',true,false,now(),'Active','en-US','Africa/Tunis');
            """);
        return id;
    }

    private static Task<List<AccessProfileGrant>> AllGrantsAsync(AppIdentityDbContext db, Guid profileId)
        => db.Set<AccessProfileGrant>().IgnoreQueryFilters().AsNoTracking()
            .Where(grant => grant.AccessProfileId == profileId)
            .ToListAsync();

    private static async Task<IEnumerable<string>> SettingsGrantsAsync(AppIdentityDbContext db, Guid profileId)
        => (await AllGrantsAsync(db, profileId))
            .Where(grant => SettingsKeys.Contains(grant.PermissionKey))
            .Select(grant =>
            {
                Assert.Equal(PermissionScopes.Tenant, grant.Scope);
                return grant.PermissionKey;
            })
            .Order()
            .ToList();
}
