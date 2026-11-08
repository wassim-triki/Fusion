using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using EY.HRPlatform.Identity.Models.Responses;

namespace EY.HRPlatform.Identity.Controllers;

public sealed record InitiateAdministratorRecoveryRequest(
    string RecipientEmail,
    bool VerificationAcknowledged,
    string? VerificationReference);

/// <summary>
/// What Platform can see and do about a customer tenant's administration.
/// <para>
/// Read the health, and — only when the tenant has no usable administrator —
/// start recovery. There is deliberately no invite, suspend, reactivate, or
/// authority-removal action here: routine administration belongs to the
/// customer, and offering it to Platform would make Platform a co-administrator
/// of every tenant.
/// </para>
/// </summary>
[ApiController]
[Route("api/identity/platform-admin/tenants/{tenantId:guid}")]
[Authorize(Roles = PlatformRole.PlatformAdmin)]
public sealed class PlatformTenantAccessController(
    ITenantContinuityHealthProjection health,
    IPlatformAdministratorRecoveryService recovery) : ControllerBase
{
    [HttpGet("access")]
    public async Task<ActionResult<ApiResponse<TenantContinuityHealthDto>>> Access(
        Guid tenantId, CancellationToken cancellationToken)
        => Ok(ApiResponse<TenantContinuityHealthDto>.Success(
            await health.GetAsync(tenantId, cancellationToken)));

    [HttpPost("administrator-recovery")]
    public async Task<IActionResult> InitiateRecovery(
        Guid tenantId,
        [FromBody] InitiateAdministratorRecoveryRequest request,
        CancellationToken cancellationToken)
    {
        var result = await recovery.InitiateAsync(
            tenantId,
            new InitiateRecoveryRequest(
                request.RecipientEmail,
                request.VerificationAcknowledged,
                request.VerificationReference),
            User.GetUserId(),
            cancellationToken);

        return result.Outcome switch
        {
            RecoveryOutcome.Initiated => Ok(ApiResponse<object>.Success(new
            {
                invitationId = result.InvitationId,
                deliveryFailed = result.DeliveryFailed,
            })),

            // Distinguished from a permission problem: the operator is allowed to
            // do this, it just does not apply to a tenant that can still
            // administer itself.
            RecoveryOutcome.NotEligible => Problem(
                "recovery-not-eligible",
                "This tenant still has a usable administrator.",
                StatusCodes.Status409Conflict),

            RecoveryOutcome.AlreadyPending => Problem(
                "recovery-already-pending",
                "A recovery invitation is already pending for this tenant.",
                StatusCodes.Status409Conflict),

            RecoveryOutcome.VerificationNotAcknowledged => Problem(
                "validation-failed",
                "Confirm that the external verification process was completed.",
                StatusCodes.Status400BadRequest),

            RecoveryOutcome.InvalidRecipient => Problem(
                "validation-failed",
                "Enter a valid recipient email address.",
                StatusCodes.Status400BadRequest),

            RecoveryOutcome.ExistingAccount => Problem(
                "existing-account",
                "This email already belongs to a Fusion account and cannot be used for recovery.",
                StatusCodes.Status409Conflict),

            _ => Problem("not-found", "That tenant was not found.", StatusCodes.Status404NotFound),
        };
    }

    /// <summary>
    /// Reissues the recovery link after a message that never arrived. Rotating the
    /// credential invalidates the previous one.
    /// </summary>
    [HttpPost("administrator-recovery/{invitationId:guid}/resend")]
    public async Task<IActionResult> ResendRecovery(
        Guid tenantId, Guid invitationId, CancellationToken cancellationToken)
        => Translate(await recovery.ResendAsync(tenantId, invitationId, User.GetUserId(), cancellationToken));

    /// <summary>Withdraws a recovery attempt. Terminal for that invitation.</summary>
    [HttpPost("administrator-recovery/{invitationId:guid}/revoke")]
    public async Task<IActionResult> RevokeRecovery(
        Guid tenantId, Guid invitationId, CancellationToken cancellationToken)
        => Translate(await recovery.RevokeAsync(tenantId, invitationId, User.GetUserId(), cancellationToken));

    private IActionResult Translate(RecoveryResult result)
        => result.Outcome == RecoveryOutcome.Initiated
            ? Ok(ApiResponse<object>.Success(new
            {
                invitationId = result.InvitationId,
                deliveryFailed = result.DeliveryFailed,
            }))
            : Problem(
                "not-found",
                "That recovery invitation is no longer available.",
                StatusCodes.Status404NotFound);

    private IActionResult Problem(string type, string title, int statusCode)
        => StatusCode(statusCode, new { type, title, status = statusCode });
}
