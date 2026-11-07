using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Models.Responses;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// Password reset by an emailed one-time link (B-295), before sign-in. The token travels in the body, never in an
/// address, so it stays out of request logs.
/// </summary>
[ApiController]
[Route("api/identity/auth/password-reset")]
[EnableRateLimiting(RateLimitPolicy)]
public sealed class PasswordResetController(PasswordReset reset) : ControllerBase
{
    public const string RateLimitPolicy = "password-reset";
    public const string InvalidPasswordCode = "invalid-password";

    /// <summary>Always the same answer, whether or not a link was sent, so it tells nobody who has an account.</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status202Accepted)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Ask([FromBody] PasswordResetRequest request, CancellationToken cancellationToken)
    {
        var email = request.Email?.Trim();
        if (string.IsNullOrEmpty(email) || email.Length > 256 || !email.Contains('@'))
            return BadRequest(ApiResponse.Failure("Enter your email address."));

        await reset.RequestAsync(email, cancellationToken);
        return Accepted(ApiResponse.Success());
    }

    /// <summary>Whether a link still works, and for which address, before the page asks for a new password.</summary>
    [HttpPost("inspect")]
    [ProducesResponseType(typeof(ApiResponse<PasswordResetLinkResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<PasswordResetLinkResponse>>> Inspect(
        [FromBody] PasswordResetInspectRequest request, CancellationToken cancellationToken)
    {
        var link = await reset.InspectAsync(request.Token, cancellationToken);
        return Ok(ApiResponse<PasswordResetLinkResponse>.Success(
            new PasswordResetLinkResponse(link.State, link.Email, AccountPasswordPolicy.Describe())));
    }

    [HttpPost("complete")]
    [ProducesResponseType(typeof(ApiResponse<PasswordResetLinkResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Complete([FromBody] PasswordResetCompleteRequest request, CancellationToken cancellationToken)
    {
        var outcome = await reset.CompleteAsync(request.Token, request.NewPassword, cancellationToken);
        if (outcome.PasswordError is not null)
            return BadRequest(ApiResponse<object>.Failure(outcome.PasswordError, new { code = InvalidPasswordCode }));
        if (!outcome.Succeeded)
            return Conflict(ApiResponse<object>.Failure("This link can't be used.", new { code = outcome.State }));

        return Ok(ApiResponse<PasswordResetLinkResponse>.Success(
            new PasswordResetLinkResponse("done", outcome.Email, AccountPasswordPolicy.Describe())));
    }
}

public sealed record PasswordResetRequest(string? Email);

public sealed record PasswordResetInspectRequest(string? Token);

public sealed record PasswordResetCompleteRequest(string? Token, string? NewPassword);

public sealed record PasswordResetLinkResponse(string State, string? Email, AccountPasswordRequirements PasswordRequirements);
