using System.Globalization;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.SingleSignOn;

/// <summary>Typed refusals the sign-in and invitation pages translate.</summary>
public static class SsoRefusals
{
    public const string NoAccount = "no_account";
    public const string EmailNotVerified = "email_not_verified";
    public const string LinkedToSomeoneElse = "linked_to_someone_else";
    public const string CompanyRequires = "company_requires";
    public const string ProviderOff = "provider_off";
    public const string InvitationMismatch = "invitation_mismatch";
    public const string InvitationClosed = "invitation_closed";
    public const string ExistingAccount = "existing_account";
    public const string Operator = "operator";
    public const string AccessPaused = "access_paused";
    public const string ProviderFailed = "provider_failed";
    public const string Expired = "expired";
    public const string SsoRequired = "sso_required";
}

/// <summary>Access-activity actions for single sign-on (B-191).</summary>
public static class SsoAuditActions
{
    public const string ResourceType = "SingleSignOn";
    public const string ProvidersChanged = "sso.providers.changed";
    public const string ConnectionSaved = "sso.connection.saved";
    public const string SecretReplaced = "sso.connection.secret_replaced";
    public const string ConnectionRemoved = "sso.connection.removed";
    public const string ConnectionTested = "sso.connection.tested";
    public const string DomainAdded = "sso.domain.added";
    public const string DomainRemoved = "sso.domain.removed";
    public const string DomainProved = "sso.domain.proved";
    public const string RequirementOn = "sso.requirement.on";
    public const string RequirementOff = "sso.requirement.off";
    public const string SignIn = "sso.signin";
    public const string SignInRefused = "sso.signin.refused";
    public const string LinkCreated = "sso.link.created";
    public const string LinkRemoved = "sso.link.removed";
    public const string InvitationAccepted = "sso.invitation.accepted";
    public const string PasswordUsedWhileRequired = "password.used_while_required";
    public const string PasswordSet = "password.set";
}

public sealed record SsoWayIn(string Key, string Label);

/// <summary>The ways in Fusion offers for an address; decided by its domain, never by whether an account exists.</summary>
public sealed record SsoWaysIn(bool Password, bool PasswordForAdministratorsOnly, IReadOnlyList<SsoWayIn> Providers)
{
    public static readonly SsoWaysIn PasswordOnly = new(true, false, []);
}

/// <summary>A company's proved claim on a domain, with its connection.</summary>
public sealed record SsoDomainClaim(Guid TenantId, SsoConnection Connection);

/// <summary>
/// The rules for who may use which way in (B-191 D8–D10), read from one place by sign-in, refresh, invitations and
/// the discovery answer.
/// </summary>
public sealed class SsoPolicy(AppIdentityDbContext dbContext, SsoProviderCatalog catalog)
{
    public static readonly HashSet<string> PublicMailDomains = new(StringComparer.OrdinalIgnoreCase)
    {
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "live.com",
        "msn.com", "aol.com", "proton.me", "protonmail.com",
    };

    public static bool IsPublicMailDomain(string domain)
        => PublicMailDomains.Contains(domain)
           || domain.StartsWith("gmx.", StringComparison.OrdinalIgnoreCase)
           || domain.StartsWith("yandex.", StringComparison.OrdinalIgnoreCase)
           || domain.StartsWith("hotmail.", StringComparison.OrdinalIgnoreCase)
           || domain.StartsWith("yahoo.", StringComparison.OrdinalIgnoreCase)
           || domain.StartsWith("outlook.", StringComparison.OrdinalIgnoreCase);

    /// <summary>Lower case, punycode for international names; null when it isn't a domain.</summary>
    public static string? NormalizeDomain(string? input)
    {
        var trimmed = input?.Trim().TrimStart('@').TrimEnd('.').ToLowerInvariant();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > SsoDomain.DomainMaxLength) return null;
        string ascii;
        try
        {
            ascii = new IdnMapping().GetAscii(trimmed);
        }
        catch (ArgumentException)
        {
            return null;
        }

        var labels = ascii.Split('.');
        if (labels.Length < 2) return null;
        foreach (var label in labels)
        {
            if (label.Length is 0 or > 63 || label.StartsWith('-') || label.EndsWith('-')
                || !label.All(c => c is >= 'a' and <= 'z' or >= '0' and <= '9' or '-'))
                return null;
        }

        return ascii;
    }

    public static string? DomainOfEmail(string? email)
    {
        var at = email?.LastIndexOf('@') ?? -1;
        return at < 0 ? null : NormalizeDomain(email![(at + 1)..]);
    }

    public async Task<SsoDomainClaim?> ProvedClaimAsync(string? domain, CancellationToken cancellationToken = default)
    {
        if (domain is null) return null;
        var row = await dbContext.SsoDomains.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.Domain == domain && item.ProvedAt != null)
            .Select(item => new { item.TenantId, item.ConnectionId })
            .FirstOrDefaultAsync(cancellationToken);
        if (row is null) return null;
        var connection = await dbContext.SsoConnections.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == row.ConnectionId && item.TenantId == row.TenantId, cancellationToken);
        return connection is null ? null : new SsoDomainClaim(row.TenantId, connection);
    }

    /// <summary>Whether <paramref name="tenantId"/> requires its own provider for this address.</summary>
    public async Task<bool> RequiresCompanyProviderAsync(Guid tenantId, string? email, CancellationToken cancellationToken = default)
    {
        var claim = await ProvedClaimAsync(DomainOfEmail(email), cancellationToken);
        return claim is not null && claim.TenantId == tenantId && claim.Connection.IsRequired;
    }

    public async Task<bool> IsUsableAdministratorAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken = default)
        => await UsableTenantAdministrator.ForTenant(dbContext, tenantId)
            .AnyAsync(assignment => assignment.UserId == userId, cancellationToken);

    public async Task<bool> IsOperatorAsync(Guid userId, CancellationToken cancellationToken = default)
        => await (from userRole in dbContext.UserRoles
                  join role in dbContext.Roles on userRole.RoleId equals role.Id
                  where userRole.UserId == userId && role.Name == PlatformRole.PlatformAdmin
                  select userRole.UserId).AnyAsync(cancellationToken);

    /// <summary>The account's one Active membership with its tenant, or null.</summary>
    public async Task<TenantMembership?> ActiveMembershipAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var memberships = await dbContext.TenantMemberships.IgnoreQueryFilters()
            .Include(membership => membership.Tenant)
            .Where(membership => membership.UserId == userId && membership.Status == TenantMembershipStatus.Active)
            .Take(2)
            .ToListAsync(cancellationToken);
        return memberships.Count == 1 && memberships[0].Tenant is { IsActive: true, IsArchived: false } ? memberships[0] : null;
    }

    /// <summary>Whether this account must now use its company's provider instead of its password.</summary>
    public async Task<bool> PasswordRefusedAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var membership = await ActiveMembershipAsync(user.Id, cancellationToken);
        return membership is not null
               && await RequiresCompanyProviderAsync(membership.TenantId, user.Email, cancellationToken)
               && !await IsUsableAdministratorAsync(membership.TenantId, user.Id, cancellationToken);
    }

    /// <summary>Sign-in step 2: the ways in for this address, by its domain and the company's switches.</summary>
    public async Task<SsoWaysIn> DiscoverAsync(string? email, string? companySlug, CancellationToken cancellationToken = default)
    {
        var claim = await ProvedClaimAsync(DomainOfEmail(email), cancellationToken);
        Tenant? tenant = null;
        if (claim is not null)
        {
            tenant = await dbContext.Tenants.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(item => item.Id == claim.TenantId, cancellationToken);
        }
        else if (!string.IsNullOrWhiteSpace(companySlug))
        {
            var slug = companySlug.Trim().ToLowerInvariant();
            tenant = await dbContext.Tenants.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(item => item.Slug == slug && item.IsActive && !item.IsArchived, cancellationToken);
        }

        var company = claim is not null && claim.Connection.Status == SsoConnectionStatus.Tested && catalog.Company(claim.Connection) is not null
            ? new SsoWayIn(SsoProviderKeys.Company, claim.Connection.DisplayName)
            : null;

        if (company is not null && claim!.Connection.IsRequired)
            return new SsoWaysIn(false, true, [company]);

        var providers = new List<SsoWayIn>();
        if (company is not null) providers.Add(company);
        providers.AddRange(FusionWide(tenant));
        return new SsoWaysIn(true, false, providers);
    }

    /// <summary>
    /// The ways in an invitation offers for its address. Workforce invitations follow the company's requirement;
    /// administrative ones (first activation, administrator, recovery) keep every way, since administrators keep a
    /// password as the way back in.
    /// </summary>
    public async Task<SsoWaysIn> WaysInForInvitationAsync(
        Guid tenantId, string email, bool administrative, CancellationToken cancellationToken = default)
    {
        var tenant = await dbContext.Tenants.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == tenantId, cancellationToken);
        if (tenant is null) return SsoWaysIn.PasswordOnly;

        var claim = await ProvedClaimAsync(DomainOfEmail(email), cancellationToken);
        var own = claim is not null && claim.TenantId == tenantId && claim.Connection.Status == SsoConnectionStatus.Tested
            ? new SsoWayIn(SsoProviderKeys.Company, claim.Connection.DisplayName)
            : null;

        if (!administrative && own is not null && claim!.Connection.IsRequired)
            return new SsoWaysIn(false, false, [own]);

        var providers = new List<SsoWayIn>();
        if (own is not null) providers.Add(own);
        providers.AddRange(FusionWide(tenant));
        return new SsoWaysIn(true, false, providers);
    }

    /// <summary>The ways in for an administrative invitation's credential (first activation, administrator, recovery).</summary>
    public async Task<SsoWaysIn?> WaysInForAdministrativeCredentialAsync(
        string? credential, string? email, CancellationToken cancellationToken = default)
    {
        if (email is null || !TenantProvisioning.BootstrapCredential.TryParse(credential, out var selector, out _)) return null;
        var tenantId = await dbContext.InviteTokens.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.CredentialSelector == selector)
            .Select(item => (Guid?)item.TenantId)
            .FirstOrDefaultAsync(cancellationToken);
        return tenantId is null ? null : await WaysInForInvitationAsync(tenantId.Value, email, administrative: true, cancellationToken);
    }

    private IEnumerable<SsoWayIn> FusionWide(Tenant? tenant)
    {
        if (catalog.IsAvailable(SsoProviderKeys.Microsoft) && tenant?.AllowMicrosoftSignIn != false)
            yield return new SsoWayIn(SsoProviderKeys.Microsoft, "Microsoft");
        if (catalog.IsAvailable(SsoProviderKeys.Google) && tenant?.AllowGoogleSignIn != false)
            yield return new SsoWayIn(SsoProviderKeys.Google, "Google");
    }

    /// <summary>
    /// Ends the password sessions of members the requirement now covers (B-191 D11): their password refresh tokens
    /// are revoked and their membership revision bumped, so the access token stops at the next request. Provider
    /// sessions refresh as usual; usable administrators are untouched. Returns how many sessions ended.
    /// </summary>
    public async Task<int> EndPasswordSessionsAsync(Guid tenantId, CancellationToken cancellationToken = default)
    {
        var domains = await dbContext.SsoDomains.IgnoreQueryFilters()
            .Where(item => item.TenantId == tenantId && item.ProvedAt != null)
            .Select(item => item.Domain)
            .ToListAsync(cancellationToken);
        if (domains.Count == 0) return 0;

        var administrators = await UsableTenantAdministrator.ForTenant(dbContext, tenantId)
            .Select(assignment => assignment.UserId)
            .ToListAsync(cancellationToken);

        var members = await dbContext.TenantMemberships.IgnoreQueryFilters()
            .Include(membership => membership.User)
            .Where(membership => membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && !administrators.Contains(membership.UserId))
            .ToListAsync(cancellationToken);
        var affected = members
            .Where(membership => DomainOfEmail(membership.User?.Email) is { } domain && domains.Contains(domain))
            .ToList();
        if (affected.Count == 0) return 0;

        var userIds = affected.Select(membership => membership.UserId).ToList();
        var now = DateTime.UtcNow;
        var tokens = await dbContext.RefreshTokens
            .Where(token => userIds.Contains(token.UserId) && token.RevokedAt == null && token.ExpiresAt > now
                && token.Method == SessionMethods.Password)
            .ToListAsync(cancellationToken);
        foreach (var token in tokens)
            token.RevokedAt = now;
        foreach (var membership in affected)
            membership.BumpAccessRevision();

        return tokens.Count;
    }
}
