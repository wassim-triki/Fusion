using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Tests.Infrastructure;

public class TenantQueryFilterTests
{
    private static readonly Guid TenantA = Guid.NewGuid();
    private static readonly Guid TenantB = Guid.NewGuid();

    /// <summary>
    /// An account participates in a tenant only through an Active membership, so
    /// the membership is what makes it visible to the tenant query filter.
    /// </summary>
    private static ApplicationUser CreateUser(Guid tenantId, string email)
    {
        var user = new ApplicationUser
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

        user.TenantMemberships.Add(TenantMembership.Create(user.Id, tenantId));
        return user;
    }

    private static InviteToken CreateInvite(Guid tenantId, string email) =>
        InviteToken.Create(email, tenantId, PlatformRole.Employee, Guid.NewGuid());

    [Fact]
    public async Task Users_WithTenantContext_ReturnsOnlyMatchingTenant()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.Users.AddRange(
                CreateUser(TenantA, "a@test.com"),
                CreateUser(TenantB, "b@test.com"));
            await seedCtx.SaveChangesAsync();
        }

        // Act
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.Create(tenantCtx, dbName);
        var users = await ctx.Users.ToListAsync();

        // Assert
        Assert.Single(users);
        Assert.Equal("a@test.com", users[0].Email);
    }

    [Fact]
    public async Task Users_WithoutTenantContext_ReturnsAll_FailOpen()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.Users.AddRange(
                CreateUser(TenantA, "a@test.com"),
                CreateUser(TenantB, "b@test.com"));
            await seedCtx.SaveChangesAsync();
        }

        // Act — no tenant context (design-time / startup behavior)
        await using var ctx = TestDbContextFactory.CreateWithoutTenant(dbName);
        var users = await ctx.Users.ToListAsync();

        // Assert — fail-open: returns all users
        Assert.Equal(2, users.Count);
    }

    [Fact]
    public async Task Users_IgnoreQueryFilters_BypassesTenantFilter()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.Users.AddRange(
                CreateUser(TenantA, "a@test.com"),
                CreateUser(TenantB, "b@test.com"));
            await seedCtx.SaveChangesAsync();
        }

        // Act — with TenantA context, but using IgnoreQueryFilters
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.Create(tenantCtx, dbName);
        var users = await ctx.Users.IgnoreQueryFilters().ToListAsync();

        // Assert
        Assert.Equal(2, users.Count);
    }

    [Fact]
    public async Task InviteTokens_WithTenantContext_ReturnsOnlyMatchingTenant()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        var inviteA = CreateInvite(TenantA, "a@invite.com");
        var inviteB = CreateInvite(TenantB, "b@invite.com");

        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            // Seed tenant entities (required FK)
            seedCtx.Tenants.AddRange(
                Tenant.Create(TenantA, "Tenant A"),
                Tenant.Create(TenantB, "Tenant B"));
            await seedCtx.SaveChangesAsync();

            seedCtx.InviteTokens.AddRange(inviteA, inviteB);
            await seedCtx.SaveChangesAsync();
        }

        // Act
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.Create(tenantCtx, dbName);
        var invites = await ctx.InviteTokens.ToListAsync();

        // Assert
        Assert.Single(invites);
        Assert.Equal(TenantA, invites[0].TenantId);
    }

    [Fact]
    public async Task InviteTokens_WithoutTenantContext_ReturnsAll_FailOpen()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.Tenants.AddRange(
                Tenant.Create(TenantA, "Tenant A"),
                Tenant.Create(TenantB, "Tenant B"));
            await seedCtx.SaveChangesAsync();

            seedCtx.InviteTokens.AddRange(
                CreateInvite(TenantA, "a@invite.com"),
                CreateInvite(TenantB, "b@invite.com"));
            await seedCtx.SaveChangesAsync();
        }

        // Act
        await using var ctx = TestDbContextFactory.CreateWithoutTenant(dbName);
        var invites = await ctx.InviteTokens.ToListAsync();

        // Assert
        Assert.Equal(2, invites.Count);
    }

    [Fact]
    public async Task RefreshTokens_NotAffectedByTenantFilter()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.RefreshTokens.AddRange(
                new RefreshToken { UserId = Guid.NewGuid(), TokenHash = RefreshToken.HashOf("token1"), ExpiresAt = DateTime.UtcNow.AddDays(7) },
                new RefreshToken { UserId = Guid.NewGuid(), TokenHash = RefreshToken.HashOf("token2"), ExpiresAt = DateTime.UtcNow.AddDays(7) });
            await seedCtx.SaveChangesAsync();
        }

        // Act — with tenant context
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.Create(tenantCtx, dbName);
        var tokens = await ctx.RefreshTokens.ToListAsync();

        // Assert — refresh tokens have no TenantId, not filtered
        Assert.Equal(2, tokens.Count);
    }

    [Fact]
    public async Task Tenants_NotAffectedByTenantFilter()
    {
        // Arrange
        var dbName = Guid.NewGuid().ToString();
        await using (var seedCtx = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            seedCtx.Tenants.AddRange(
                Tenant.Create(TenantA, "Tenant A"),
                Tenant.Create(TenantB, "Tenant B"));
            await seedCtx.SaveChangesAsync();
        }

        // Act — with tenant context
        var tenantCtx = TestTenantContext.WithTenant(TenantA);
        await using var ctx = TestDbContextFactory.Create(tenantCtx, dbName);
        var tenants = await ctx.Tenants.ToListAsync();

        // Assert — Tenant entity has no query filter
        Assert.Equal(2, tenants.Count);
    }
}
