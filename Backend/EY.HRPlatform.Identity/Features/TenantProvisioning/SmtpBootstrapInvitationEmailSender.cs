using System.Net;
using System.Net.Mail;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.Extensions.Options;

namespace EY.HRPlatform.Identity.Features.TenantProvisioning;

public sealed class BootstrapInvitationEmailOptions
{
    public const string SectionName = "BootstrapInvitationEmail";

    public bool Enabled { get; set; }

    public string SmtpHost { get; set; } = string.Empty;

    public int SmtpPort { get; set; } = 587;

    public bool UseSsl { get; set; } = true;

    /// <summary>
    /// Bounds a server that accepts the connection and then stalls. Delivery is
    /// awaited inside provisioning, so .NET's 100-second default would hold the
    /// caller's request open for that long on a single unresponsive relay.
    /// </summary>
    public int TimeoutMilliseconds { get; set; } = 15_000;

    public string? Username { get; set; }

    public string? Password { get; set; }

    /// <summary>`Fusion` is the visible identity; the address is deployment-specific.</summary>
    public string FromEmail { get; set; } = "no-reply@fusion.local";

    public string FromName { get; set; } = "Fusion";

    public string? ReplyToEmail { get; set; }
}

/// <summary>
/// Sends the bootstrap invitation over SMTP.
///
/// Modelled on the workforce sender, but deliberately separate: the message, its
/// audit vocabulary and its failure codes belong to tenant bootstrap, and folding
/// them together would make a workforce configuration change silently alter how
/// the first administrator of a tenant is invited.
/// </summary>
public sealed class SmtpBootstrapInvitationEmailSender(
    IOptions<BootstrapInvitationEmailOptions> optionsAccessor,
    ILogger<SmtpBootstrapInvitationEmailSender> logger) : IBootstrapInvitationEmailSender
{
    public async Task<BootstrapDeliveryOutcome> SendAsync(
        BootstrapInvitationMessage message,
        CancellationToken cancellationToken)
    {
        var options = optionsAccessor.Value;

        // Not configured is a failure, never a silent success: the invitation must
        // stay visibly Pending and recoverable rather than appearing delivered.
        if (!options.Enabled || string.IsNullOrWhiteSpace(options.SmtpHost))
        {
            logger.LogError("Bootstrap invitation SMTP delivery is enabled but not configured.");
            return BootstrapDeliveryOutcome.Failed("delivery_not_configured");
        }

        using var mail = BuildMessage(message, options);

        try
        {
            using var client = new SmtpClient(options.SmtpHost, options.SmtpPort)
            {
                EnableSsl = options.UseSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Timeout = options.TimeoutMilliseconds,
            };

            if (!string.IsNullOrWhiteSpace(options.Username))
            {
                client.Credentials = new NetworkCredential(options.Username, options.Password ?? string.Empty);
            }

            await client.SendMailAsync(mail, cancellationToken);
            return BootstrapDeliveryOutcome.Sent();
        }
        catch (SmtpException exception)
        {
            // The recipient address and the provider's text stay in logs. Only a
            // bounded code reaches the delivery record.
            logger.LogWarning(exception, "Bootstrap invitation SMTP delivery failed.");
            return BootstrapDeliveryOutcome.Failed("delivery_rejected");
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unexpected bootstrap invitation delivery failure.");
            return BootstrapDeliveryOutcome.Failed("delivery_error");
        }
    }

    /// <summary>
    /// Assembles the multipart message.
    ///
    /// The plain text is the body and the HTML is the single alternate view. The
    /// obvious-looking alternative — an HTML body plus one alternate view per
    /// representation — makes .NET emit the HTML twice and leaves plain-text
    /// clients rendering markup as if it were prose.
    /// </summary>
    public static MailMessage BuildMessage(
        BootstrapInvitationMessage message, BootstrapInvitationEmailOptions options)
    {
        var rendered = BootstrapInvitationTemplate.Render(message);

        var mail = new MailMessage
        {
            Subject = rendered.Subject,
            Body = rendered.Text,
            IsBodyHtml = false,
            From = new MailAddress(options.FromEmail, options.FromName),
        };

        mail.AlternateViews.Add(FusionMailer.HtmlView(rendered.Html, rendered.Images));

        mail.To.Add(message.Email);

        if (!string.IsNullOrWhiteSpace(options.ReplyToEmail))
        {
            mail.ReplyToList.Add(new MailAddress(options.ReplyToEmail));
        }

        return mail;
    }
}
