using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ApiResponse = EY.HRPlatform.SharedKernel.Api.ApiResponse;

namespace EY.HRPlatform.Identity.Controllers;

public sealed record AcceptAdministratorInvitationRequest(
    string Credential,
    string? Password,
    string? FirstName,
    string? LastName);

/// <summary>
/// The public surface behind the administrator and recovery acceptance links.
/// <para>
/// Anonymous by necessity — the recipient has no account yet, and creating one is
/// the point — so possession of the credential is the only authority accepted.
/// Refusals are shaped so a caller holding a wrong credential learns nothing
/// about which tenant, invitation, or account exists.
/// </para>
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/identity/tenant-access/invitations")]
public sealed class AdministratorInvitationAcceptanceController(
    IAdministratorInvitationService invitations,
    IAdministrativeInvitationAcceptanceService acceptance,
    AppIdentityDbContext dbContext,
    IAuthSessionFactory sessions,
    Features.SingleSignOn.SsoPolicy ssoPolicy) : ControllerBase
{
    /// <summary>
    /// What the link opens onto. Read-only: inspecting never consumes, expires,
    /// or records anything.
    /// </summary>
    [HttpGet("inspect")]
    public async Task<IActionResult> Inspect(
        [FromQuery] string? credential, CancellationToken cancellationToken)
    {
        var entry = await invitations.InspectAsync(credential ?? string.Empty, cancellationToken);

        // Always 200. A refused credential is a state the page renders, not a
        // transport error, and status codes that differ per state would let a
        // caller enumerate invitations without reading the body.
        return Ok(ApiResponse<AdministratorEntryDto>.Success(new AdministratorEntryDto
        {
            State = ToWireState(entry.State),
            Purpose = entry.Purpose?.ToString(),
            TenantName = entry.TenantName,
            InvitedEmail = entry.InvitedEmail,
            ExpiresAt = entry.ExpiresAtUtc,
            FirstName = entry.FirstName,
            LastName = entry.LastName,
            Role = entry.Role,
            PasswordRequirements = entry.State == AdministrativeInvitationEntryState.AccountCreation
                ? AccountPasswordPolicy.Describe()
                : null,
            WaysIn = entry.State == AdministrativeInvitationEntryState.AccountCreation
                ? await ssoPolicy.WaysInForAdministrativeCredentialAsync(credential, entry.InvitedEmail, cancellationToken)
                : null,
        }));
    }

    [HttpPost("accept")]
    public async Task<IActionResult> Accept(
        [FromBody] AcceptAdministratorInvitationRequest request, CancellationToken cancellationToken)
    {
        // Revalidated here rather than trusting the state the form was rendered
        // from, so an invitation revoked, replaced, expired, or accepted while the
        // recipient was typing produces the accurate state.
        var entry = await invitations.InspectAsync(request.Credential, cancellationToken);

        if (entry.State != AdministrativeInvitationEntryState.AccountCreation || entry.InvitedEmail is null)
        {
            return Refuse(StatusCodes.Status409Conflict, ToWireState(entry.State));
        }

        var result = await acceptance.AcceptAsync(new AdministrativeAcceptanceRequest
        {
            Credential = request.Credential,
            // Read from the invitation, never from the request, so the invited
            // address cannot be altered by editing the payload.
            Email = entry.InvitedEmail,
            Password = request.Password,
            FirstName = request.FirstName,
            LastName = request.LastName,
        }, cancellationToken);

        return result.Outcome switch
        {
            AdministrativeAcceptanceOutcome.Accepted =>
                await IssueSessionAsync(result, cancellationToken),

            // Correctable: the invitation is untouched and the recipient can fix
            // the named field and submit again.
            AdministrativeAcceptanceOutcome.InvalidAccountDetails =>
                Refuse(StatusCodes.Status400BadRequest, "invalid_details", result.FieldErrors),

            AdministrativeAcceptanceOutcome.ExistingAccountConflict =>
                Refuse(StatusCodes.Status409Conflict, "existing_account"),

            AdministrativeAcceptanceOutcome.AlreadyAccepted =>
                Refuse(StatusCodes.Status409Conflict, "already_accepted"),

            _ => Refuse(StatusCodes.Status409Conflict, "not_acceptable"),
        };
    }

    /// <summary>
    /// Acceptance has committed by this point. If the session cannot be built, the
    /// account, membership, and authority still exist — so the response says so
    /// and offers sign-in rather than implying the work should be repeated.
    /// </summary>
    private async Task<IActionResult> IssueSessionAsync(
        AdministrativeAcceptanceResult result, CancellationToken cancellationToken)
    {
        var account = await dbContext.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(user => user.Id == result.AccountId, cancellationToken);

        if (account is null)
        {
            return Refuse(StatusCodes.Status409Conflict, "session_unavailable");
        }

        try
        {
            return Ok(ApiResponse<AuthResponse>.Success(await sessions.CreateAsync(account, cancellationToken)));
        }
        catch (Exception)
        {
            return Refuse(StatusCodes.Status409Conflict, "session_unavailable");
        }
    }

    private IActionResult Refuse(
        int status,
        string reason,
        IReadOnlyList<AdministrativeAcceptanceFieldError>? fieldErrors = null)
        => StatusCode(status, ApiResponse<AdministratorRefusalDto>.Success(new AdministratorRefusalDto
        {
            Reason = reason,
            FieldErrors = fieldErrors?
                .Select(error => new AdministratorFieldErrorDto
                {
                    Field = error.Field,
                    Message = error.Message,
                })
                .ToList() ?? [],
        }));

    private static string ToWireState(AdministrativeInvitationEntryState state) => state switch
    {
        AdministrativeInvitationEntryState.AccountCreation => "account_creation",
        AdministrativeInvitationEntryState.Expired => "expired",
        AdministrativeInvitationEntryState.Revoked => "revoked",
        AdministrativeInvitationEntryState.Superseded => "superseded",
        AdministrativeInvitationEntryState.AlreadyAccepted => "already_accepted",
        AdministrativeInvitationEntryState.ExistingAccountConflict => "existing_account",
        _ => "invalid",
    };
}

/// <summary>
/// Tenant, address, and expiry are populated only for the account-creation
/// state. A refused credential learns nothing about the tenant behind it.
/// </summary>
public sealed class AdministratorEntryDto
{
    public string State { get; set; } = "invalid";

    /// <summary>
    /// Distinguishes an ordinary administrator invitation from a Platform
    /// recovery, which the acceptance journey describes differently.
    /// </summary>
    public string? Purpose { get; set; }

    public string? TenantName { get; set; }
    public string? InvitedEmail { get; set; }
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Pre-filled from the invitation when it captured them; still editable.</summary>
    public string? FirstName { get; set; }
    public string? LastName { get; set; }

    /// <summary>The access this invitation grants, for the context panel.</summary>
    public string? Role { get; set; }

    /// <summary>
    /// The rules the service will actually enforce, so the form states its
    /// requirements from one source instead of a second copy that can drift.
    /// </summary>
    public AccountPasswordRequirements? PasswordRequirements { get; set; }

    /// <summary>How the invited address can accept: providers, and the password (B-191).</summary>
    public Features.SingleSignOn.SsoWaysIn? WaysIn { get; set; }
}

public sealed class AdministratorRefusalDto
{
    public string Reason { get; set; } = string.Empty;
    public List<AdministratorFieldErrorDto> FieldErrors { get; set; } = [];
}

public sealed class AdministratorFieldErrorDto
{
    public string Field { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}
