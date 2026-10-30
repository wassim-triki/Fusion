using EY.HRPlatform.Identity.Features.Branding;

namespace EY.HRPlatform.Identity.Features.WorkforceAccounts;

public sealed record WorkforceInvitationEmailMessage(
    Guid InviteId,
    Guid TenantId,
    string TenantName,
    Guid? EmployeeId,
    string Email,
    string? RecipientName,
    string InviteLink,
    DateTime ExpiresAt,
    IReadOnlyList<string> AccessProfileNames,
    InvitationBranding? Branding = null);

public sealed record WorkforceInvitationDeliveryResult(
    string Status,
    string? Message,
    DateTime RecordedAt)
{
    public static WorkforceInvitationDeliveryResult Sent(string? message = null)
        => new("Sent", message, DateTime.UtcNow);

    public static WorkforceInvitationDeliveryResult Suppressed(string message)
        => new("Suppressed", message, DateTime.UtcNow);

    public static WorkforceInvitationDeliveryResult Failed(string message)
        => new("Failed", message, DateTime.UtcNow);
}

public interface IWorkforceInvitationEmailSender
{
    Task<WorkforceInvitationDeliveryResult> SendInviteAsync(
        WorkforceInvitationEmailMessage invitation,
        CancellationToken cancellationToken);
}
