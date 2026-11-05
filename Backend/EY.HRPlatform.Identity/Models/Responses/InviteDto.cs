using System.Text.Json.Serialization;
using EY.HRPlatform.Identity.Features.Accounts;

namespace EY.HRPlatform.Identity.Models.Responses;

/// <summary>
/// Response model for invitation token operations.
/// </summary>
public class InviteDto
{
    public Guid Id { get; set; }

    /// <summary>
    /// The invitation token (for building invite link).
    /// Only returned when creating an invite.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Token { get; set; }

    /// <summary>
    /// Full invite link (only on creation).
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? InviteLink { get; set; }

    public string Email { get; set; } = string.Empty;

    public Guid? EmployeeId { get; set; }

    public Guid TenantId { get; set; }

    public string TenantName { get; set; } = string.Empty;

    public string Role { get; set; } = string.Empty;

    public List<AccessProfileAssignmentSummaryDto> AccessProfiles { get; set; } = [];

    public string? FirstName { get; set; }

    public string? LastName { get; set; }

    public DateTime ExpiresAt { get; set; }

    public bool IsExpired { get; set; }

    public bool IsUsed { get; set; }

    public DateTime CreatedAt { get; set; }

    public string? DeliveryStatus { get; set; }

    public string? DeliveryMessage { get; set; }

    public DateTime? DeliveryRecordedAt { get; set; }

    /// <summary>The account rules this recipient must satisfy, from the server policy.</summary>
    public AccountPasswordRequirements? PasswordRequirements { get; set; }

    /// <summary>How the invited address can accept: providers and whether a password is offered (B-191).</summary>
    public Features.SingleSignOn.SsoWaysIn? WaysIn { get; set; }
}
