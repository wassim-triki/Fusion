using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// The public surface behind `/activate-invitation`.
///
/// It is anonymous by necessity — the recipient has no account yet, and creating
/// one is the entire point — so possession of the invitation credential is the
/// only authority it accepts. Every refusal is deliberately shaped so a caller
/// holding a wrong credential learns nothing about which tenant, invitation or
/// account exists.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/identity/tenant-activation")]
public sealed class TenantActivationController(
    IBootstrapActivationService activation,
    AppIdentityDbContext dbContext,
    IAuthSessionFactory sessions,
    Features.SingleSignOn.SsoPolicy ssoPolicy) : ControllerBase
{
    /// <summary>
    /// What the link opens onto. Read-only: inspecting an invitation never
    /// consumes, expires or records anything.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<ActivationEntryDto>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<ActivationEntryDto>>> Inspect(
        [FromQuery] string? credential, CancellationToken cancellationToken)
    {
        var entry = await activation.InspectAsync(credential ?? string.Empty, cancellationToken);

        // Always 200. A refused credential is a state the page renders, not a
        // transport error, and status codes that differ per state would let a
        // caller enumerate invitations without reading the body.
        return Ok(ApiResponse<ActivationEntryDto>.Success(new ActivationEntryDto
        {
            State = ToWireState(entry.State),
            TenantName = entry.TenantName,
            InvitedEmail = entry.InvitedEmail,
            ExpiresAt = entry.ExpiresAtUtc,
            FirstName = entry.FirstName,
            LastName = entry.LastName,
            Role = entry.Role,
            PasswordRequirements = entry.State == BootstrapEntryState.AccountCreation
                ? AccountPasswordPolicy.Describe()
                : null,
            WaysIn = entry.State == BootstrapEntryState.AccountCreation
                ? await ssoPolicy.WaysInForAdministrativeCredentialAsync(credential, entry.InvitedEmail, cancellationToken)
                : null,
        }));
    }

    /// <summary>
    /// Creates the administrator account and, on success, returns the new
    /// tenant-scoped session. The invited address is never accepted from the
    /// client: it is read from the invitation the credential identifies, so the
    /// address cannot be altered by editing a request.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(ApiResponse<AuthResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<ActivationRefusalDto>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<ActivationRefusalDto>), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Activate(
        [FromBody] ActivateInvitationRequest request, CancellationToken cancellationToken)
    {
        // Revalidated here rather than trusting the state the form was rendered
        // from, so an invitation revoked, replaced, expired or accepted while the
        // recipient was typing produces the accurate state and not a generic
        // refusal.
        var entry = await activation.InspectAsync(request.Credential, cancellationToken);
        if (entry.State != BootstrapEntryState.AccountCreation || entry.InvitedEmail is null)
        {
            return Refuse(StatusCodes.Status409Conflict, ToWireState(entry.State));
        }

        var result = await activation.ActivateAsync(new BootstrapActivationRequest
        {
            Credential = request.Credential,
            Email = entry.InvitedEmail,
            Password = request.Password,
            FirstName = request.FirstName,
            LastName = request.LastName,
        }, cancellationToken);

        switch (result.Outcome)
        {
            case BootstrapActivationOutcome.Activated:
                return await IssueSessionAsync(result, cancellationToken);

            // Correctable: the invitation is untouched and the recipient can fix
            // the named field and submit again.
            case BootstrapActivationOutcome.InvalidAccountDetails:
                return Refuse(StatusCodes.Status400BadRequest, "invalid_details", result.FieldErrors);

            case BootstrapActivationOutcome.ExistingAccountConflict:
                return Refuse(StatusCodes.Status409Conflict, "existing_account");

            case BootstrapActivationOutcome.AlreadyAccepted:
                return Refuse(StatusCodes.Status409Conflict, "already_accepted");

            default:
                // Whichever rule refused it, the recipient's link no longer works
                // and the reason is not theirs to act on.
                return Refuse(StatusCodes.Status409Conflict, "not_activatable");
        }
    }

    /// <summary>
    /// Activation has committed by this point. If the session cannot be built the
    /// account, membership and access still exist, so the response must say so
    /// rather than imply the work should be repeated.
    /// </summary>
    private async Task<IActionResult> IssueSessionAsync(
        BootstrapActivationResult result, CancellationToken cancellationToken)
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
            var session = await sessions.CreateAsync(account, cancellationToken);
            return Ok(ApiResponse<AuthResponse>.Success(session));
        }
        catch (Exception)
        {
            return Refuse(StatusCodes.Status409Conflict, "session_unavailable");
        }
    }

    private IActionResult Refuse(
        int status,
        string reason,
        IReadOnlyList<BootstrapActivationFieldError>? fieldErrors = null)
        => StatusCode(status, ApiResponse<ActivationRefusalDto>.Success(new ActivationRefusalDto
        {
            Reason = reason,
            FieldErrors = fieldErrors?
                .Select(error => new ActivationFieldErrorDto
                {
                    Field = error.Field,
                    Message = error.Message,
                })
                .ToList() ?? [],
        }));

    private static string ToWireState(BootstrapEntryState state) => state switch
    {
        BootstrapEntryState.AccountCreation => "account_creation",
        BootstrapEntryState.Expired => "expired",
        BootstrapEntryState.Revoked => "revoked",
        BootstrapEntryState.Superseded => "superseded",
        BootstrapEntryState.AlreadyAccepted => "already_accepted",
        BootstrapEntryState.ExistingAccountConflict => "existing_account",
        _ => "invalid",
    };
}

public sealed class ActivateInvitationRequest
{
    public string Credential { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Password { get; set; }
}

public sealed class ActivationEntryDto
{
    public string State { get; set; } = "invalid";
    public string? TenantName { get; set; }
    public string? InvitedEmail { get; set; }
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Pre-filled from the invitation when provisioning captured them; the
    /// recipient can still correct them. Absent when the invitation stored no name.</summary>
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

public sealed class ActivationRefusalDto
{
    public string Reason { get; set; } = string.Empty;
    public List<ActivationFieldErrorDto> FieldErrors { get; set; } = [];
}

public sealed class ActivationFieldErrorDto
{
    public string Field { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}
