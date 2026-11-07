using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence.Interceptors;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Tests.Infrastructure;

/// <summary>
/// The interceptor guards records that own a tenant. Since customer tenancy moved
/// off the account and onto <see cref="TenantMembership"/>, these tests exercise
/// the guard through genuinely tenant-owned records — membership, entitlement and
/// invitation — rather than through the now-global account.
/// </summary>
public class TenantSaveChangesInterceptorTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    private static ApplicationUser CreateAccount(string email) => new()
    {
        Id = Guid.NewGuid(),
        UserName = email,
        Email = email,
        NormalizedEmail = email.ToUpperInvariant(),
        NormalizedUserName = email.ToUpperInvariant(),
        FirstName = "Test",
        LastName = "User",
        SecurityStamp = Guid.NewGuid().ToString()
    };

    private static TenantMembership CreateMembership(Guid tenantId) =>
        TenantMembership.Create(Guid.NewGuid(), tenantId);

    private static InviteToken CreateInvite(Guid tenantId, string email) =>
        InviteToken.Create(email, tenantId, PlatformRole.Employee, Guid.NewGuid());

    // ── Add ──────────────────────────────────────────────

    [Fact]
    public async Task Add_WithMatchingTenant_Succeeds()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        ctx.TenantMemberships.Add(CreateMembership(TenantA));

        var saved = await ctx.SaveChangesAsync();
        Assert.Equal(1, saved);
    }

    [Fact]
    public async Task Add_WithMismatchedTenant_Throws()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        ctx.TenantMemberships.Add(CreateMembership(TenantB));

        await Assert.ThrowsAsync<TenantAccessDeniedException>(() => ctx.SaveChangesAsync());
    }

    [Fact]
    public async Task Add_WithEmptyTenantId_Throws()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        // Entitlements reach persistence through the same guard, and an unset
        // tenant is never an acceptable owner.
        var entitlement = TenantModuleEntitlement.Create(TenantA, TenantModule.CoreHR);
        ctx.TenantModuleEntitlements.Add(entitlement);
        ctx.Entry(entitlement).Property(nameof(TenantModuleEntitlement.TenantId)).CurrentValue = Guid.Empty;

        await Assert.ThrowsAsync<TenantAccessDeniedException>(() => ctx.SaveChangesAsync());
    }

    [Fact]
    public async Task Add_WithUnresolvedTenant_Throws()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.Unresolved();
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        ctx.TenantMemberships.Add(CreateMembership(TenantA));

        await Assert.ThrowsAsync<TenantAccessDeniedException>(() => ctx.SaveChangesAsync());
    }

    // ── Modify ───────────────────────────────────────────

    [Fact]
    public async Task Modify_WithMatchingTenant_Succeeds()
    {
        var dbName = Guid.NewGuid().ToString();
        Guid membershipId;

        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var membership = CreateMembership(TenantA);
            seedCtx.TenantMemberships.Add(membership);
            await seedCtx.SaveChangesAsync();
            membershipId = membership.Id;
        }

        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);
        var stored = await ctx.TenantMemberships.FirstAsync(item => item.Id == membershipId);
        stored.Suspend(actorUserId: null);

        var saved = await ctx.SaveChangesAsync();
        Assert.Equal(1, saved);
    }

    [Fact]
    public async Task Modify_ChangeTenantId_Throws()
    {
        var dbName = Guid.NewGuid().ToString();
        Guid entitlementId;

        // Entitlement tenancy is an ordinary column, so it can be reassigned in
        // memory and must be stopped by the interceptor. Membership and invitation
        // tenancy additionally sit inside alternate keys, which makes the same
        // move impossible at the model level.
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var entitlement = TenantModuleEntitlement.Create(TenantA, TenantModule.Performance);
            seedCtx.TenantModuleEntitlements.Add(entitlement);
            await seedCtx.SaveChangesAsync();
            entitlementId = entitlement.Id;
        }

        // Moving a record to another tenant is the escalation this guard exists for.
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);
        var stored = await ctx.TenantModuleEntitlements.FirstAsync(item => item.Id == entitlementId);
        ctx.Entry(stored).Property(nameof(TenantModuleEntitlement.TenantId)).CurrentValue = TenantB;

        await Assert.ThrowsAsync<TenantAccessDeniedException>(() => ctx.SaveChangesAsync());
    }

    // ── Delete ───────────────────────────────────────────

    [Fact]
    public async Task Delete_WithMatchingTenant_Succeeds()
    {
        var dbName = Guid.NewGuid().ToString();
        Guid membershipId;

        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            var membership = CreateMembership(TenantA);
            seedCtx.TenantMemberships.Add(membership);
            await seedCtx.SaveChangesAsync();
            membershipId = membership.Id;
        }

        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);
        var stored = await ctx.TenantMemberships.FirstAsync(item => item.Id == membershipId);
        ctx.TenantMemberships.Remove(stored);

        var saved = await ctx.SaveChangesAsync();
        Assert.Equal(1, saved);
    }

    [Fact]
    public async Task Delete_WithMismatchedTenant_Throws()
    {
        var dbName = Guid.NewGuid().ToString();

        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.TenantMemberships.Add(CreateMembership(TenantA));
            await seedCtx.SaveChangesAsync();
        }

        // Load the other tenant's record deliberately, then attempt to delete it.
        var tenantCtx = TestTenantContext.WithTenant(TenantB);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);
        var stored = await ctx.TenantMemberships.IgnoreQueryFilters().FirstAsync();
        ctx.TenantMemberships.Remove(stored);

        await Assert.ThrowsAsync<TenantAccessDeniedException>(() => ctx.SaveChangesAsync());
    }

    // ── InviteToken ──────────────────────────────────────

    [Fact]
    public async Task AddInviteToken_WithMatchingTenant_Succeeds()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        ctx.Tenants.Add(Tenant.Create(TenantA, "Tenant A"));
        await ctx.SaveChangesAsync();

        ctx.ChangeTracker.Clear();

        ctx.InviteTokens.Add(CreateInvite(TenantA, "invite@test.com"));

        var saved = await ctx.SaveChangesAsync();
        Assert.Equal(1, saved);
    }

    [Fact]
    public async Task AddInviteToken_WithMismatchedTenant_Throws()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        ctx.Tenants.Add(Tenant.Create(TenantB, "Tenant B"));
        await ctx.SaveChangesAsync();

        ctx.ChangeTracker.Clear();

        ctx.InviteTokens.Add(CreateInvite(TenantB, "invite@test.com"));

        await Assert.ThrowsAsync<TenantAccessDeniedException>(() => ctx.SaveChangesAsync());
    }

    // ── Non-tenant entities pass through ─────────────────

    [Fact]
    public async Task AddRefreshToken_NoTenantCheck()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        ctx.RefreshTokens.Add(new RefreshToken
        {
            UserId = Guid.NewGuid(),
            TokenHash = RefreshToken.HashOf("test-token"),
            ExpiresAt = DateTime.UtcNow.AddDays(7)
        });

        var saved = await ctx.SaveChangesAsync();
        Assert.Equal(1, saved);
    }

    // ── Accounts are global ──────────────────────────────

    [Fact]
    public void Account_IsNotATenantEntity()
    {
        // Regression guard for the cutover: reintroducing ITenantEntity on the
        // account would make the interceptor treat a global identity as
        // tenant-owned and quietly restore account-owned tenancy.
        Assert.False(typeof(ITenantEntity).IsAssignableFrom(typeof(ApplicationUser)));
        Assert.Null(typeof(ApplicationUser).GetProperty("TenantId"));
    }

    [Fact]
    public async Task AddAccount_UnderAnyTenantContext_IsNotTenantChecked()
    {
        var dbName = Guid.NewGuid().ToString();
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.CreateWithInterceptor(tenantCtx, dbName);

        // A global account saves regardless of the ambient tenant, because it
        // belongs to no tenant. Its participation is a separate membership record.
        ctx.Users.Add(CreateAccount("global@test.com"));

        var saved = await ctx.SaveChangesAsync();
        Assert.Equal(1, saved);
    }
}
