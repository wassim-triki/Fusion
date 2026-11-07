using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.Invitations;
using EY.HRPlatform.Identity.Features.Notifications;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.Accounts;

/// <summary>Where a reset link stands, as the reset page shows it.</summary>
public static class PasswordResetStates
{
    public const string Ready = "ready";
    public const string Expired = "expired";
    public const string Used = "used";
    public const string Invalid = "invalid";

    /// <summary>The company now signs this person in through its own provider, so a password would not get them in.</summary>
    public const string ProviderRequired = "provider_required";
}

public sealed record PasswordResetLink(string State, string? Email);

public sealed record PasswordResetOutcome(string State, string? Email = null, string? PasswordError = null)
{
    public bool Succeeded => State == PasswordResetStates.Ready && PasswordError is null;
}

/// <summary>
/// Password reset by an emailed one-time link (B-295). A reset restores the password of an account that has one; it
/// is not a way to add a password to an account that signs in only through a provider (that goes through the
/// provider, B-191). Where the company requires its own provider, only its administrators keep a password, so only
/// they get a link. Asking says nothing about whether the address has an account.
/// </summary>
public sealed class PasswordReset(
    AppIdentityDbContext db,
    UserManager<ApplicationUser> userManager,
    SsoPolicy ssoPolicy,
    IAccountMailSender mail,
    IConfiguration configuration,
    ILogger<PasswordReset> logger)
{
    /// <summary>At most one link a minute per account, so the form can't be used to flood someone's inbox.</summary>
    public static readonly TimeSpan ResendInterval = TimeSpan.FromMinutes(1);

    public const string PasswordResetAction = "password.reset";
    private const string ResourceType = "Account";

    private static readonly NotificationCatalog Text = AdministratorRoleMail.Text;

    /// <summary>Sends a link when the address belongs to an account that may reset its password; otherwise nothing.</summary>
    public async Task RequestAsync(string email, CancellationToken cancellationToken)
    {
        var normalized = email.Trim().ToUpperInvariant();
        var user = await db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.NormalizedEmail == normalized, cancellationToken);
        if (user is null || !user.IsActive || string.IsNullOrEmpty(user.PasswordHash) || string.IsNullOrWhiteSpace(user.Email))
            return;
        if (await ssoPolicy.PasswordRefusedAsync(user, cancellationToken))
            return;

        var now = DateTime.UtcNow;
        var open = await db.PasswordResetTokens
            .Where(item => item.UserId == user.Id && item.UsedAt == null && item.VoidedAt == null && item.ExpiresAt > now)
            .ToListAsync(cancellationToken);
        if (open.Any(item => now - item.CreatedAt < ResendInterval))
            return;

        // Only the newest link works.
        foreach (var older in open)
            older.VoidedAt = now;
        var (row, token) = PasswordResetToken.Issue(user.Id, now);
        db.PasswordResetTokens.Add(row);
        await db.SaveChangesAsync(cancellationToken);

        await SendAsync(user, "PasswordReset", token, cancellationToken);
    }

    public async Task<PasswordResetLink> InspectAsync(string? token, CancellationToken cancellationToken)
    {
        var (state, _, user) = await ReadAsync(token, cancellationToken);
        return new PasswordResetLink(state, state == PasswordResetStates.Ready ? user!.Email : null);
    }

    /// <summary>
    /// Sets the new password and uses up the link. Every session of the account ends, and its other links stop
    /// working. A password the rules refuse leaves the link usable.
    /// </summary>
    public async Task<PasswordResetOutcome> CompleteAsync(string? token, string? newPassword, CancellationToken cancellationToken)
    {
        var (state, row, user) = await ReadAsync(token, cancellationToken);
        if (state != PasswordResetStates.Ready)
            return new PasswordResetOutcome(state);

        foreach (var validator in userManager.PasswordValidators)
        {
            var check = await validator.ValidateAsync(userManager, user!, newPassword);
            if (!check.Succeeded)
                return new PasswordResetOutcome(state, user!.Email,
                    check.Errors.Select(error => error.Description).FirstOrDefault() ?? "That password can't be used.");
        }

        var now = DateTime.UtcNow;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Claimed in the database, so of two requests racing with one link only one sets a password.
        var claimed = await db.PasswordResetTokens
            .Where(item => item.Id == row!.Id && item.UsedAt == null && item.VoidedAt == null && item.ExpiresAt > now)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.UsedAt, now), cancellationToken);
        if (claimed == 0)
            return new PasswordResetOutcome(PasswordResetStates.Used);

        user!.PasswordHash = userManager.PasswordHasher.HashPassword(user, newPassword!);
        user.SecurityStamp = Guid.NewGuid().ToString();

        await db.PasswordResetTokens
            .Where(item => item.UserId == user.Id && item.Id != row!.Id && item.UsedAt == null && item.VoidedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.VoidedAt, now), cancellationToken);
        await db.RefreshTokens
            .Where(item => item.UserId == user.Id && item.RevokedAt == null)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.RevokedAt, now), cancellationToken);

        // Access tokens already handed out stop at their next request.
        var memberships = await db.TenantMemberships.IgnoreQueryFilters()
            .Where(item => item.UserId == user.Id && item.Status == TenantMembershipStatus.Active)
            .ToListAsync(cancellationToken);
        foreach (var membership in memberships)
        {
            membership.BumpAccessRevision();
            db.AccessAuditEvents.Add(AccessAuditEvent.Create(
                membership.TenantId, user.Id, string.Empty, string.Empty, PasswordResetAction, ResourceType,
                membership.Id.ToString(), $"{user.FullName} reset their password from an emailed link.", null, null, null));
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await SendAsync(user, "PasswordChanged", null, cancellationToken);
        return new PasswordResetOutcome(PasswordResetStates.Ready, user.Email);
    }

    private async Task<(string State, PasswordResetToken? Row, ApplicationUser? User)> ReadAsync(
        string? token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 128)
            return (PasswordResetStates.Invalid, null, null);

        var hash = RefreshToken.HashOf(token);
        var row = await db.PasswordResetTokens.AsNoTracking()
            .FirstOrDefaultAsync(item => item.TokenHash == hash, cancellationToken);
        if (row is null)
            return (PasswordResetStates.Invalid, null, null);

        var user = await db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == row.UserId, cancellationToken);
        if (user is null || !user.IsActive || string.IsNullOrEmpty(user.PasswordHash))
            return (PasswordResetStates.Invalid, null, null);
        if (row.UsedAt is not null)
            return (PasswordResetStates.Used, row, user);
        if (!row.IsOpen(DateTime.UtcNow))
            return (PasswordResetStates.Expired, row, user);
        if (await ssoPolicy.PasswordRefusedAsync(user, cancellationToken))
            return (PasswordResetStates.ProviderRequired, row, user);

        return (PasswordResetStates.Ready, row, user);
    }

    /// <summary>
    /// The link mail or the "password changed" notice, in the person's language and their company's brand. Never
    /// throws: a mail problem must not undo a reset or tell the asker anything.
    /// </summary>
    private async Task SendAsync(ApplicationUser user, string kind, string? token, CancellationToken cancellationToken)
    {
        try
        {
            var membership = await ssoPolicy.ActiveMembershipAsync(user.Id, cancellationToken);
            var tenant = membership?.Tenant;
            var language = FusionLanguages.Resolve(user.PreferredLanguage, tenant?.Locale);
            var brand = tenant is null ? null : (await CompanyBrandReader.ForInvitationAsync(db, tenant.Id, cancellationToken)).Brand;

            var shell = (configuration["Application:PublicBaseUrl"] is { Length: > 0 } url ? url : "http://localhost:3000").TrimEnd('/');
            var company = tenant is null ? "" : $"company={Uri.EscapeDataString(tenant.Slug)}";
            var actionUrl = token is null
                ? $"{shell}/auth/signin{(company.Length > 0 ? "?" + company : "")}"
                : $"{shell}/auth/reset-password?token={Uri.EscapeDataString(token)}{(company.Length > 0 ? "&" + company : "")}";

            var values = new Dictionary<string, string> { ["email"] = user.Email!, ["company"] = tenant?.Name ?? "Fusion" };
            string Say(string key) => Text.Text(language, key, values)!;
            var rendered = FusionEmailLayout.Render(new FusionEmailContent(
                language,
                Say($"{kind}.subject"),
                Say($"{kind}.subject"),
                [Say($"{kind}.lead")],
                Say($"{kind}.action"),
                actionUrl,
                [Say($"{kind}.ignore")],
                FallbackLinkNote: FusionNotificationEmail.Text.Text(language, "footer.fallback"),
                Brand: tenant is null || brand is null
                    ? null
                    : new FusionEmailBrand(tenant.Name, brand.Color, Say("sentBy"),
                        brand.LogoPng is { } logo ? new FusionEmailImage(CanonicalInvitationRenderer.LogoContentId, logo) : null)));

            await mail.SendAsync(new FusionOutgoingEmail(user.Email!, rendered, $"<{Guid.NewGuid():N}@fusion-identity>"), cancellationToken);
            logger.LogInformation("Audit Event: {Kind}MailSent | UserId={UserId}", kind, user.Id);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning("{Kind} mail failed ({ErrorType}) | UserId={UserId}", kind, ex.GetType().Name, user.Id);
        }
    }
}
