using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace EY.HRPlatform.Identity.Features.TenantAdministration;

public interface IAdministrativeInvitationDelivery
{
    /// <summary>
    /// Requests delivery of an administrative or recovery link and records exactly
    /// one attempt. Never throws: a delivery problem must not unwind a committed
    /// invitation that can simply be resent.
    /// </summary>
    Task DeliverAsync(
        Guid invitationId,
        string email,
        BootstrapCredential credential,
        InvitationPurpose purpose,
        Guid initiatedByAccountId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Post-commit delivery for administrative and recovery invitations.
/// <para>
/// Shares the bootstrap attempt model — one Sent or Failed record per request,
/// no Started or Unknown state — so no lease, inference window, or reconciliation
/// job is needed to read the history. Delivery failure leaves the invitation
/// Pending and recoverable, and the customer surface shows the delivery outcome
/// as a fact distinct from whether the invitation is valid.
/// </para>
/// </summary>
public sealed class AdministrativeInvitationDelivery(
    AppIdentityDbContext dbContext,
    IBootstrapInvitationEmailSender emailSender,
    IConfiguration configuration,
    ILogger<AdministrativeInvitationDelivery> logger) : IAdministrativeInvitationDelivery
{
    public async Task DeliverAsync(
        Guid invitationId,
        string email,
        BootstrapCredential credential,
        InvitationPurpose purpose,
        Guid initiatedByAccountId,
        CancellationToken cancellationToken = default)
    {
        var link = AdministrativeAcceptanceLinkBuilder.Build(configuration, credential.RawValue, purpose);

        InvitationDeliveryAttempt attempt;
        try
        {
            var context = await dbContext.InviteTokens
                .IgnoreQueryFilters()
                .Where(item => item.Id == invitationId)
                .Select(item => new
                {
                    item.ExpiresAt,
                    item.TenantId,
                    TenantName = dbContext.Tenants.IgnoreQueryFilters()
                        .Where(tenant => tenant.Id == item.TenantId)
                        .Select(tenant => tenant.Name)
                        .FirstOrDefault(),
                })
                .FirstOrDefaultAsync(cancellationToken);

            // The purpose is carried into the message so the canonical renderer emits
            // the additional-administrator or recovery variant — never bootstrap's
            // first-administrator wording, which this path previously inherited.
            var message = new BootstrapInvitationMessage(
                TenantName: context?.TenantName ?? string.Empty,
                Email: email,
                ActivationLink: link,
                ExpiresAtUtc: context?.ExpiresAt ?? DateTime.UtcNow,
                Purpose: purpose,
                Branding: context is null ? null : await CompanyBrandReader.ForInvitationAsync(dbContext, context.TenantId, cancellationToken));

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
            logger.LogWarning(exception, "Administrator invitation delivery failed for {InvitationId}", invitationId);
            attempt = InvitationDeliveryAttempt.Failed(invitationId, "delivery_error", initiatedByAccountId);
        }

        dbContext.InvitationDeliveryAttempts.Add(attempt);

        var invitation = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == invitationId, cancellationToken);

        // Recorded on the invitation itself so the customer Access workspace can
        // show "invitation valid, delivery failed" without joining an attempt log.
        invitation?.RecordDeliveryAttempt(
            attempt.Outcome.ToString(), attempt.SanitizedFailureCode ?? string.Empty);

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static string Sanitize(string? failureCode)
    {
        if (string.IsNullOrWhiteSpace(failureCode))
        {
            return "delivery_failed";
        }

        var trimmed = failureCode.Trim();
        return trimmed.Length <= 64 ? trimmed : trimmed[..64];
    }
}

/// <summary>
/// Builds the shell-owned acceptance link.
/// <para>
/// Administrative acceptance is a distinct destination from bootstrap activation
/// and from the workforce invite route. The recipient of an administrator
/// invitation is joining a tenant that is already running, and the recipient of a
/// recovery invitation is restoring administration to one that has lost it —
/// neither is the tenant's first activation, and the journeys say different
/// things.
/// </para>
/// </summary>
public static class AdministrativeAcceptanceLinkBuilder
{
    private const string DefaultPublicBaseUrl = "http://localhost:3000";
    private const string AdministratorPath = "/accept-administrator-invitation";
    private const string RecoveryPath = "/recover-administrator-access";

    public static string Build(IConfiguration configuration, string credential, InvitationPurpose purpose)
        => Build(configuration["Application:PublicBaseUrl"], credential, purpose);

    public static string Build(string? publicBaseUrl, string credential, InvitationPurpose purpose)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(credential);

        var baseUrl = string.IsNullOrWhiteSpace(publicBaseUrl)
            ? DefaultPublicBaseUrl
            : publicBaseUrl.TrimEnd('/');

        var path = purpose == InvitationPurpose.TenantAdministratorRecovery
            ? RecoveryPath
            : AdministratorPath;

        return $"{baseUrl}{path}?credential={Uri.EscapeDataString(credential)}";
    }
}
