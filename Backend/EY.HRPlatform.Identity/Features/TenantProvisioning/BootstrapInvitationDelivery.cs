using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Features.TenantProvisioning;

public interface IBootstrapInvitationDelivery
{
    /// <summary>
    /// Requests delivery of a bootstrap link and records exactly one attempt.
    /// Never throws: a delivery problem must not unwind committed provisioning.
    /// </summary>
    Task DeliverAsync(
        Guid invitationId,
        string email,
        BootstrapCredential credential,
        Guid initiatedByAccountId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Post-commit delivery. Each completed request writes one Sent or Failed
/// attempt — there is no Started or Unknown state, so no lease, inference window
/// or reconciliation job is needed to interpret the record.
/// </summary>
public sealed class BootstrapInvitationDelivery(
    AppIdentityDbContext dbContext,
    IBootstrapInvitationEmailSender emailSender,
    IConfiguration configuration,
    ILogger<BootstrapInvitationDelivery> logger) : IBootstrapInvitationDelivery
{
    public async Task DeliverAsync(
        Guid invitationId,
        string email,
        BootstrapCredential credential,
        Guid initiatedByAccountId,
        CancellationToken cancellationToken = default)
    {
        InvitationDeliveryAttempt attempt;
        try
        {
            // Assembled here, once, so provisioning, resend, replace and reissue
            // all produce the same message from the same source of truth.
            //
            // Loaded inside the guarded block because failing to read it is
            // itself a delivery failure. Outside it, a database error here threw
            // past the handler and the invitation was left committed with no
            // attempt recorded at all — neither sent nor visibly failed.
            var context = await dbContext.InviteTokens
                .IgnoreQueryFilters()
                .Where(item => item.Id == invitationId)
                .Select(item => new
                {
                    item.ExpiresAt,
                    TenantName = dbContext.Tenants.IgnoreQueryFilters()
                        .Where(tenant => tenant.Id == item.TenantId)
                        .Select(tenant => tenant.Name)
                        .FirstOrDefault(),
                    TenantSlug = dbContext.Tenants.IgnoreQueryFilters()
                        .Where(tenant => tenant.Id == item.TenantId)
                        .Select(tenant => tenant.Slug)
                        .FirstOrDefault(),
                })
                .FirstOrDefaultAsync(cancellationToken);
            var link = BootstrapActivationLinkBuilder.Build(configuration, credential.RawValue, context?.TenantSlug);

            var message = new BootstrapInvitationMessage(
                TenantName: context?.TenantName ?? string.Empty,
                Email: email,
                ActivationLink: link,
                ExpiresAtUtc: context?.ExpiresAt ?? DateTime.UtcNow);

            var outcome = await emailSender.SendAsync(message, cancellationToken);

            attempt = outcome.Succeeded
                ? InvitationDeliveryAttempt.Sent(invitationId, initiatedByAccountId)
                : InvitationDeliveryAttempt.Failed(
                    invitationId, Sanitize(outcome.FailureCode), initiatedByAccountId);
        }
        catch (Exception exception)
        {
            // The raw provider error may carry recipient data or internal detail,
            // so only a bounded code is persisted. The detail goes to logs.
            logger.LogWarning(exception, "Bootstrap invitation delivery failed for {InvitationId}", invitationId);
            attempt = InvitationDeliveryAttempt.Failed(
                invitationId, "delivery_error", initiatedByAccountId);
        }

        dbContext.InvitationDeliveryAttempts.Add(attempt);

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == invitationId, cancellationToken);

        if (invitation is not null)
        {
            dbContext.TenantBootstrapAuditEvents.Add(TenantBootstrapAuditEvent.Create(
                TenantBootstrapAuditEventType.InvitationDeliveryAttempted,
                invitation.TenantId,
                correlationId: Guid.NewGuid(),
                outcome: attempt.Outcome.ToString(),
                invitationId: invitationId,
                actorAccountId: initiatedByAccountId,
                reason: attempt.SanitizedFailureCode));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Keeps the stored code bounded and free of provider text.</summary>
    private static string Sanitize(string? failureCode)
    {
        if (string.IsNullOrWhiteSpace(failureCode))
            return "delivery_failed";

        var trimmed = failureCode.Trim();
        return trimmed.Length <= 64 ? trimmed : trimmed[..64];
    }
}

public sealed record BootstrapDeliveryOutcome(bool Succeeded, string? FailureCode)
{
    public static BootstrapDeliveryOutcome Sent() => new(true, null);
    public static BootstrapDeliveryOutcome Failed(string failureCode) => new(false, failureCode);
}

public interface IBootstrapInvitationEmailSender
{
    Task<BootstrapDeliveryOutcome> SendAsync(
        BootstrapInvitationMessage message, CancellationToken cancellationToken);
}

/// <summary>
/// Reserved development address suffix that always fails delivery.
///
/// Recovery from a bounced invitation is specified behaviour and is otherwise
/// unreachable locally, because local delivery always succeeds. Making the
/// failure reproducible produces a genuine Failed attempt against a real
/// invitation rather than a record staged by hand. `.test` is reserved by
/// RFC 2606, so it can never shadow a real domain.
/// </summary>
public static class BootstrapDeliveryProbe
{
    public const string UndeliverableDomain = "@bounce.test";

    public static bool IsUndeliverable(string email)
        => email.EndsWith(UndeliverableDomain, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Stands in for a real provider outside Development until one is configured.
///
/// It records a truthful Failed attempt rather than claiming delivery, so the
/// invitation stays Pending and visibly recoverable instead of appearing sent.
/// The credential is never written to logs.
/// </summary>
public sealed class UnconfiguredBootstrapInvitationEmailSender(
    ILogger<UnconfiguredBootstrapInvitationEmailSender> logger) : IBootstrapInvitationEmailSender
{
    public Task<BootstrapDeliveryOutcome> SendAsync(
        BootstrapInvitationMessage message,
        CancellationToken cancellationToken)
    {
        logger.LogError(
            "Bootstrap invitation delivery is not configured; no email was sent. "
            + "Configure a provider before provisioning tenants outside development.");
        return Task.FromResult(BootstrapDeliveryOutcome.Failed("delivery_not_configured"));
    }
}

/// <summary>
/// Builds the shell-owned activation link. Bootstrap activation is a distinct
/// destination from the workforce invite route, which keeps its own behavior.
/// </summary>
public static class BootstrapActivationLinkBuilder
{
    private const string DefaultPublicBaseUrl = "http://localhost:3000";
    private const string ActivationPath = "/activate-invitation";

    public static string Build(IConfiguration configuration, string credential, string? company = null)
        => Build(configuration["Application:PublicBaseUrl"], credential, company);

    public static string Build(string? publicBaseUrl, string credential, string? company = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(credential);

        var baseUrl = string.IsNullOrWhiteSpace(publicBaseUrl)
            ? DefaultPublicBaseUrl
            : publicBaseUrl.TrimEnd('/');

        return $"{baseUrl}{ActivationPath}?credential={Uri.EscapeDataString(credential)}{InvitationLinkBuilder.CompanyQuery(company)}";
    }
}
