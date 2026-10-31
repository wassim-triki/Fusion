using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Membership;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Localization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.Accounts;

public interface IAuthSessionFactory
{
    Task<AuthResponse> CreateAsync(ApplicationUser user, CancellationToken cancellationToken = default);

    /// <summary>
    /// A session for seeing Fusion as <paramref name="user"/>: their own authority in a token marked with the view,
    /// ending when it does, and no refresh token, so it can't outlive the view.
    /// </summary>
    Task<AuthResponse> CreateViewAsync(ApplicationUser user, ViewAsToken view, CancellationToken cancellationToken = default);
}

/// <summary>
/// Builds an authenticated session from the account's canonical membership and
/// access.
///
/// Sign-in and administrator activation both end with the same problem — turn an
/// account into a session that reports exactly what its token authorizes — so they
/// share one implementation. A second one would be free to drift, and a session
/// that claims a tenant the token does not carry is a workspace the backend will
/// refuse after the client has already rendered it.
/// </summary>
public sealed class AuthSessionFactory(
    UserManager<ApplicationUser> userManager,
    ITokenService tokenService,
    IAccessProfileService accessProfiles,
    AppIdentityDbContext dbContext,
    IConfiguration configuration,
    ICustomerContextResolver customerContextResolver) : IAuthSessionFactory
{
    public async Task<AuthResponse> CreateAsync(
        ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var accessToken = await tokenService.GenerateAccessTokenAsync(user);
        var refreshTokenString = tokenService.GenerateRefreshToken();

        dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            Token = refreshTokenString,
            ExpiresAt = DateTime.UtcNow.AddDays(
                int.Parse(configuration["Jwt:RefreshTokenExpirationInDays"]!)),
        });

        await dbContext.SaveChangesAsync(cancellationToken);

        return await BuildAsync(user, accessToken, refreshTokenString,
            DateTime.UtcNow.AddMinutes(int.Parse(configuration["Jwt:ExpirationInMinutes"]!)), cancellationToken);
    }

    public async Task<AuthResponse> CreateViewAsync(
        ApplicationUser user, ViewAsToken view, CancellationToken cancellationToken = default)
        => await BuildAsync(user, await tokenService.GenerateAccessTokenAsync(user, view), string.Empty, view.ExpiresAt,
            cancellationToken);

    private async Task<AuthResponse> BuildAsync(
        ApplicationUser user, string accessToken, string refreshTokenString, DateTime expiresAt,
        CancellationToken cancellationToken)
    {
        var roles = await tokenService.RolesForAsync(user);

        // Without a customer context there is no tenant, no entitlement and no
        // tenant permission to report, so the client cannot render a workspace the
        // backend would refuse.
        var customerContext = await customerContextResolver.ResolveAsync(user);
        var context = customerContext.Context;

        var assignedProfiles = context is null
            ? []
            : (await accessProfiles.GetAssignedProfilesAsync(user)).ToList();

        var effectivePermissions = context is null
            ? []
            : (await accessProfiles.GetEffectivePermissionsAsync(user))
                .Select(grant => new EffectivePermissionGrantDto
                {
                    PermissionKey = grant.PermissionKey,
                    Scope = grant.Scope,
                    Label = PermissionCatalog.Get(grant.PermissionKey).Label,
                    Group = PermissionCatalog.Get(grant.PermissionKey).Group,
                    HelperText = PermissionCatalog.Get(grant.PermissionKey).HelperText,
                    AllowedScopes = PermissionCatalog.Get(grant.PermissionKey).AllowedScopes.ToList(),
                })
                .ToList();

        // The company's language is the fallback only for the tenant this session
        // authorizes; a Platform Administrator has none and falls back to English.
        var tenantLocale = context is null
            ? null
            : await dbContext.Tenants
                .IgnoreQueryFilters()
                .Where(tenant => tenant.Id == context.TenantId)
                .Select(tenant => tenant.Locale)
                .FirstOrDefaultAsync(cancellationToken);

        return new AuthResponse
        {
            UserId = user.Id,
            TenantId = context?.TenantId,
            TenantMembershipId = context?.MembershipId,
            ModuleEntitlements = context?.EnabledModules.Select(module => module.ToString()).ToList() ?? [],
            Email = user.Email!,
            FullName = user.FullName,
            Roles = roles.ToList(),
            EmployeeId = context?.EmployeeId,
            AccessProfiles = assignedProfiles,
            EffectivePermissions = effectivePermissions,
            Language = FusionLanguages.Resolve(user.PreferredLanguage, tenantLocale),
            NotificationPopups = user.NotificationPopups,
            NotificationSound = user.NotificationSound,
            AccessToken = accessToken,
            RefreshToken = refreshTokenString,
            AccessTokenExpiration = expiresAt,
        };
    }
}
