using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;

namespace EY.HRPlatform.SharedKernel.Notifications;

public sealed class FusionSmtpOptions
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public string From { get; set; } = string.Empty;
    public bool UseSsl { get; set; } = true;
    public string? Username { get; set; }
    public string? Password { get; set; }
}

/// <summary>
/// One email on its way out. <paramref name="MessageId"/> is stable for the durable message, so a retry is the same
/// email. <paramref name="UnsubscribeUrl"/> is set for groups a person may turn off: it becomes the one-click
/// <c>List-Unsubscribe</c> header (RFC 8058) that mail apps show as "Unsubscribe".
/// </summary>
public sealed record FusionOutgoingEmail(string To, RenderedEmail Content, string MessageId, string? UnsubscribeUrl = null);

/// <summary>Sends a Fusion email as HTML with its plain-text twin. Headers carry no business content.</summary>
public static class FusionMailer
{
    public static MailMessage Compose(FusionSmtpOptions smtp, FusionOutgoingEmail email)
    {
        var mail = new MailMessage
        {
            From = new MailAddress(smtp.From),
            Subject = email.Content.Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            Body = email.Content.Text,
            IsBodyHtml = false,
        };
        mail.To.Add(email.To);
        mail.AlternateViews.Add(HtmlView(email.Content.Html, email.Content.Images));
        mail.Headers.Add("Message-ID", email.MessageId);
        if (email.UnsubscribeUrl is not null)
        {
            mail.Headers.Add("List-Unsubscribe", $"<{email.UnsubscribeUrl}>");
            mail.Headers.Add("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        }
        return mail;
    }

    /// <summary>The HTML part, with the images it shows by <c>cid:</c> attached to it.</summary>
    public static AlternateView HtmlView(string html, IReadOnlyList<FusionEmailImage> images)
    {
        var view = AlternateView.CreateAlternateViewFromString(html, Encoding.UTF8, MediaTypeNames.Text.Html);
        foreach (var image in images)
        {
            view.LinkedResources.Add(new LinkedResource(new MemoryStream(image.Content), image.MediaType)
            {
                ContentId = image.ContentId,
                TransferEncoding = TransferEncoding.Base64,
            });
        }
        return view;
    }

    public static async Task SendAsync(FusionSmtpOptions smtp, FusionOutgoingEmail email, CancellationToken cancellationToken)
    {
        using var mail = Compose(smtp, email);
        using var client = new SmtpClient(smtp.Host, smtp.Port)
        {
            EnableSsl = smtp.UseSsl, DeliveryMethod = SmtpDeliveryMethod.Network, UseDefaultCredentials = false,
        };
        if (!string.IsNullOrWhiteSpace(smtp.Username))
            client.Credentials = new NetworkCredential(smtp.Username, smtp.Password ?? string.Empty);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await client.SendMailAsync(mail, timeout.Token);
    }
}
