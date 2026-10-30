using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Membership;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace EY.HRPlatform.Identity.Tests.Features.TenantProvisioning;

/// <summary>
/// B-152: a platform administrator turns Performance off and on after provisioning. Off pauses it: roles and their
/// assignments stay, the built-in roles lose the Performance grants until it returns, and a token issued after the
/// change carries the new entitlement. Core HR stays, and nothing reaches another tenant.
/// </summary>
public sealed class TenantProductTests : IAsyncLifetime
{
    private readonly RelationalTestDatabase _databases = new();
    private bool Available => _databases.Available;

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync() => _databases.DisposeAsync().AsTask();

    // ── Who may call it ──────────────────────────────────

    private const string TestSecret = "integration-test-secret-please-change";

    /// <summary>A token signed the way the Identity host validates it, carrying only the given roles.</summary>
    private static string Token(params string[] roles)
    {
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) };
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));
        var token = new JwtSecurityToken("EY.HRPlatform.Identity", "EY.HRPlatform", claims,
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecret)), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    [Fact]
    public async Task Only_a_platform_administrator_may_change_a_tenants_products()
    {
        await using var factory = new IdentityApiFactory();
        var path = $"/api/identity/platform-admin/tenants/{Guid.NewGuid()}/products/performance";

        var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync(path, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.DeleteAsync(path)).StatusCode);

        var tenantAdministrator = factory.CreateClient();
        tenantAdministrator.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", Token(PlatformRole.OrgAdmin, PlatformRole.HRAdmin));
        Assert.Equal(HttpStatusCode.Forbidden, (await tenantAdministrator.PostAsync(path, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenantAdministrator.DeleteAsync(path)).StatusCode);

        // The platform administrator gets through to the rule: an unknown tenant, and Core HR, which always stays.
        var platform = factory.CreateClient();
        platform.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(PlatformRole.PlatformAdmin));
        Assert.Equal(HttpStatusCode.NotFound, (await platform.DeleteAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await platform.DeleteAsync($"/api/identity/platform-admin/tenants/{Guid.NewGuid()}/products/corehr")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await platform.PostAsync($"/api/identity/platform-admin/tenants/{Guid.NewGuid()}/products/payroll", null)).StatusCode);
    }

    // ── What it does ─────────────────────────────────────

    private sealed record World(AppIdentityDbContext Db, UserManager<ApplicationUser> Users, Guid TenantId, Guid OtherTenantId,
        ApplicationUser Manager, Guid ManagerProfileId);

    private static readonly Guid Actor = Guid.NewGuid();

    /// <summary>Two tenants with Performance; the first has a member holding the built-in Manager role.</summary>
    private async Task<World> ArrangeAsync()
    {
        var db = await _databases.CreateAsync("fusion_products");
        var users = RelationalTestDatabase.CreateUserManager(db);
        var accessProfiles = new AccessProfileService(db, users);
        var provisioning = new TenantProvisioningService(db, new SilentBootstrapDelivery());

        async Task<Guid> TenantAsync(string name)
        {
            var provisioned = await provisioning.ProvisionAsync(new ProvisionTenantRequest
            {
                Name = name,
                TimeZone = "Europe/Paris",
                AdministratorEmail = $"admin@{name.ToLowerInvariant()}.example",
                IdempotencyKey = $"products-{Guid.NewGuid():N}",
                Modules = [TenantModule.Performance],
            }, Actor);
            Assert.True(provisioned.IsSuccess);
            await accessProfiles.EnsureTenantAccessProfilesAsync(provisioned.Value.TenantId);
            return provisioned.Value.TenantId;
        }

        var tenantId = await TenantAsync("Atlas");
        var otherTenantId = await TenantAsync("Borealis");
        db.ChangeTracker.Clear();

        var manager = new ApplicationUser
        {
            Id = Guid.NewGuid(), UserName = "manager@atlas.example", Email = "manager@atlas.example",
            FirstName = "Mariam", LastName = "Manager", IsActive = true, EmailConfirmed = true,
        };
        Assert.True((await users.CreateAsync(manager, "Manager@123456")).Succeeded);
        var membership = TenantMembership.Create(manager.Id, tenantId);
        db.TenantMemberships.Add(membership);
        await db.SaveChangesAsync();
        var profileId = await db.AccessProfiles.IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId && profile.InternalKey == "manager")
            .Select(profile => profile.Id).SingleAsync();
        db.UserAccessProfiles.Add(UserAccessProfile.Create(tenantId, manager.Id, profileId, membership.Id));
        await db.SaveChangesAsync();
        return new World(db, users, tenantId, otherTenantId, manager, profileId);
    }

    private static TenantProductService Service(World world) => new(world.Db, new AccessProfileService(world.Db, world.Users));

    private static async Task<bool> HasPerformanceAsync(World world, Guid tenantId)
        => await world.Db.TenantModuleEntitlements.IgnoreQueryFilters()
            .AnyAsync(item => item.TenantId == tenantId && item.Module == TenantModule.Performance);

    private static async Task<IReadOnlyList<string>> ProfileGrantKeysAsync(World world, Guid profileId)
        => await world.Db.AccessProfileGrants.IgnoreQueryFilters()
            .Where(grant => grant.AccessProfileId == profileId)
            .Select(grant => grant.PermissionKey).ToListAsync();

    /// <summary>The modules a token issued now for the person carries.</summary>
    private static async Task<IReadOnlyList<string>> TokenModulesAsync(World world, ApplicationUser user)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Secret"] = "a-test-secret-that-is-long-enough-for-hmac-sha256-signing",
            ["Jwt:Issuer"] = "fusion-tests",
            ["Jwt:Audience"] = "fusion-tests",
            ["Jwt:ExpirationInMinutes"] = "30",
        }).Build();
        var accessProfiles = new AccessProfileService(world.Db, world.Users);
        var token = await new TokenService(configuration, world.Users, accessProfiles, new CustomerContextResolver(world.Db, world.Users))
            .GenerateAccessTokenAsync(user);
        return new JwtSecurityTokenHandler().ReadJwtToken(token).Claims
            .Where(claim => claim.Type == CustomClaimTypes.ModuleEntitlement).Select(claim => claim.Value).ToList();
    }

    [SkippableFact]
    public async Task Off_pauses_Performance_and_on_restores_it_with_roles_and_assignments_kept()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        Assert.Contains(PerformancePermissions.CycleView, await ProfileGrantKeysAsync(world, world.ManagerProfileId));
        Assert.Contains("Performance", await TokenModulesAsync(world, world.Manager));

        Assert.True((await Service(world).SetEnabledAsync(world.TenantId, "performance", false, Actor)).IsSuccess);
        world.Db.ChangeTracker.Clear();

        Assert.False(await HasPerformanceAsync(world, world.TenantId));
        // The role keeps its Performance areas (the company's to change since B-177); the paused module is out of the token.
        Assert.Contains(PerformancePermissions.CycleView, await ProfileGrantKeysAsync(world, world.ManagerProfileId));
        Assert.True(await world.Db.UserAccessProfiles.IgnoreQueryFilters()
            .AnyAsync(item => item.UserId == world.Manager.Id && item.AccessProfileId == world.ManagerProfileId));
        Assert.Equal(["CoreHR"], await TokenModulesAsync(world, world.Manager));

        // The other tenant is untouched.
        Assert.True(await HasPerformanceAsync(world, world.OtherTenantId));
        var otherManagerProfile = await world.Db.AccessProfiles.IgnoreQueryFilters()
            .Where(profile => profile.TenantId == world.OtherTenantId && profile.InternalKey == "manager")
            .Select(profile => profile.Id).SingleAsync();
        Assert.Contains(PerformancePermissions.CycleView, await ProfileGrantKeysAsync(world, otherManagerProfile));

        Assert.True((await Service(world).SetEnabledAsync(world.TenantId, "Performance", true, Actor)).IsSuccess);
        world.Db.ChangeTracker.Clear();

        Assert.True(await HasPerformanceAsync(world, world.TenantId));
        Assert.Contains(PerformancePermissions.CycleView, await ProfileGrantKeysAsync(world, world.ManagerProfileId));
        Assert.True(await world.Db.UserAccessProfiles.IgnoreQueryFilters()
            .AnyAsync(item => item.UserId == world.Manager.Id && item.AccessProfileId == world.ManagerProfileId));
        Assert.Contains("Performance", await TokenModulesAsync(world, world.Manager));
    }

    [SkippableFact]
    public async Task Each_change_is_recorded_once_with_who_made_it()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();
        var service = Service(world);

        Assert.True((await service.SetEnabledAsync(world.TenantId, "performance", false, Actor)).IsSuccess);
        Assert.True((await service.SetEnabledAsync(world.TenantId, "performance", false, Actor)).IsSuccess);
        Assert.True((await service.SetEnabledAsync(world.TenantId, "performance", true, Actor)).IsSuccess);

        var events = await world.Db.TenantBootstrapAuditEvents.IgnoreQueryFilters()
            .Where(item => item.TenantId == world.TenantId
                && (item.EventType == TenantBootstrapAuditEventType.ProductDisabled || item.EventType == TenantBootstrapAuditEventType.ProductEnabled))
            .OrderBy(item => item.OccurredAt).ToListAsync();
        Assert.Equal([TenantBootstrapAuditEventType.ProductDisabled, TenantBootstrapAuditEventType.ProductEnabled],
            events.Select(item => item.EventType));
        Assert.All(events, item => Assert.Equal((Actor, "Performance"), (item.ActorAccountId!.Value, item.Reason!)));
        Assert.Empty(await world.Db.TenantBootstrapAuditEvents.IgnoreQueryFilters()
            .Where(item => item.TenantId == world.OtherTenantId && item.EventType == TenantBootstrapAuditEventType.ProductDisabled)
            .ToListAsync());
    }

    [SkippableFact]
    public async Task Core_HR_stays_and_an_archived_tenant_keeps_its_products()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        var world = await ArrangeAsync();

        var coreHr = await Service(world).SetEnabledAsync(world.TenantId, "CoreHR", false, Actor);
        Assert.Equal("products.mandatory", coreHr.Error.Code);
        Assert.True(await world.Db.TenantModuleEntitlements.IgnoreQueryFilters()
            .AnyAsync(item => item.TenantId == world.TenantId && item.Module == TenantModule.CoreHR));

        Assert.True((await new TenantLifecycleService(world.Db).ArchiveAsync(world.TenantId, Actor)).IsSuccess);
        var archived = await Service(world).SetEnabledAsync(world.TenantId, "performance", false, Actor);
        Assert.Equal("tenant.invalid_lifecycle_state", archived.Error.Code);
        Assert.True(await HasPerformanceAsync(world, world.TenantId));
    }

    private sealed class SilentBootstrapDelivery : IBootstrapInvitationDelivery
    {
        public Task DeliverAsync(Guid invitationId, string email, BootstrapCredential credential,
            Guid initiatedByAccountId, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
