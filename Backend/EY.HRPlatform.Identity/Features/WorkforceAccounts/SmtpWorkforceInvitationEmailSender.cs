using System.Net;
using System.Net.Mail;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Invitations;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.Identity.Features.WorkforceAccounts;

public sealed class SmtpWorkforceInvitationEmailSender(
    IOptions<WorkforceInvitationEmailOptions> optionsAccessor,
    ILogger<SmtpWorkforceInvitationEmailSender> logger) : IWorkforceInvitationEmailSender
{
    public async Task<WorkforceInvitationDeliveryResult> SendInviteAsync(
        WorkforceInvitationEmailMessage invitation,
        CancellationToken cancellationToken)
    {
        var options = optionsAccessor.Value;

        if (!options.Enabled)
        {
            return WorkforceInvitationDeliveryResult.Suppressed(
                "Email disabled. Manual link available.");
        }

        if (string.IsNullOrWhiteSpace(options.SmtpHost))
        {
            return WorkforceInvitationDeliveryResult.Suppressed(
                "Email delivery is not configured. Manual link available.");
        }

        // Same canonical render as every other supported invitation, assembled once
        // into a multipart message: the plain text is the body and the HTML is the
        // single alternate view.
        using var message = WorkforceInvitationMailAssembly.Build(invitation, options);

        try
        {
            using var smtpClient = new SmtpClient(options.SmtpHost, options.SmtpPort)
            {
                EnableSsl = options.UseSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
            };

            if (!string.IsNullOrWhiteSpace(options.Username))
            {
                smtpClient.Credentials = new NetworkCredential(
                    options.Username,
                    options.Password ?? string.Empty);
            }

            await smtpClient.SendMailAsync(message, cancellationToken);

            logger.LogInformation(
                "Audit Event: WorkforceInvitationEmailSent | InviteId={InviteId} | TenantId={TenantId} | EmployeeId={EmployeeId} | Email={Email}",
                invitation.InviteId,
                invitation.TenantId,
                invitation.EmployeeId,
                invitation.Email);

            return WorkforceInvitationDeliveryResult.Sent("Email sent.");
        }
        catch (SmtpException ex)
        {
            logger.LogWarning(
                ex,
                "Workforce invitation email failed for InviteId={InviteId} to {Email}.",
                invitation.InviteId,
                invitation.Email);

            return WorkforceInvitationDeliveryResult.Failed(
                "Email failed. Manual link available.");
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Unexpected workforce invitation email failure for InviteId={InviteId} to {Email}.",
                invitation.InviteId,
                invitation.Email);

            return WorkforceInvitationDeliveryResult.Failed(
                "Email failed. Manual link available.");
        }
    }
}

/// <summary>
/// Renders and assembles a workforce invitation through the one canonical renderer,
/// so SMTP delivery and Development capture produce the identical message. The friendly
/// access summary is the assigned baseline names only — never permission keys, claims,
/// or internal identifiers.
/// </summary>
public static class WorkforceInvitationMailAssembly
{
    public static RenderedInvitation Render(WorkforceInvitationEmailMessage invitation)
        => CanonicalInvitationRenderer.Render(new CanonicalInvitation(
            Purpose: InvitationPurpose.WorkforceAccount,
            TenantName: invitation.TenantName,
            Email: invitation.Email,
            ActionUrl: invitation.InviteLink,
            ExpiresAtUtc: invitation.ExpiresAt,
            RecipientName: invitation.RecipientName,
            AccessSummary: ResolveAccessSummary(invitation.AccessProfileNames),
            Language: invitation.Branding?.Language ?? FusionLanguages.English,
            Brand: invitation.Branding?.Brand));

    public static MailMessage Build(
        WorkforceInvitationEmailMessage invitation,
        WorkforceInvitationEmailOptions options)
    {
        var rendered = Render(invitation);

        var mail = new MailMessage
        {
            Subject = rendered.Subject,
            Body = rendered.Text,
            IsBodyHtml = false,
            From = new MailAddress(options.FromEmail, options.FromName),
        };

        mail.AlternateViews.Add(FusionMailer.HtmlView(rendered.Html, rendered.Images));

        mail.To.Add(invitation.Email);

        if (!string.IsNullOrWhiteSpace(options.ReplyToEmail))
        {
            mail.ReplyToList.Add(new MailAddress(options.ReplyToEmail));
        }

        return mail;
    }

    private static string? ResolveAccessSummary(IReadOnlyList<string> accessProfileNames)
        => accessProfileNames.Count == 0
            ? null
            : string.Join(", ", accessProfileNames);
}
