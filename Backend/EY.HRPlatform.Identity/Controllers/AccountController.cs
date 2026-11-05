using System.Security.Claims;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Requests;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Localization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// The signed-in person's own account settings. Every action changes the account
/// named by the caller's token and nothing else: no route or body takes an
/// account id, so there is no way to aim it at someone else.
/// </summary>
[ApiController]
[Route("api/identity/account")]
[Authorize]
public class AccountController(
    AppIdentityDbContext dbContext,
    Microsoft.AspNetCore.Identity.UserManager<Domain.Entities.ApplicationUser> userManager,
    Features.SingleSignOn.SsoStepUp stepUp,
    Features.SingleSignOn.SsoPolicy ssoPolicy) : ControllerBase
{
    public const string UnsupportedLanguageCode = "unsupported-language";
    public const string NothingToChangeCode = "nothing-to-change";

    /// <summary>
    /// Sets the person's language. No permission: like a password, it is their own.
    /// </summary>
    [HttpPut("language")]
    [ProducesResponseType(typeof(ApiResponse<AccountLanguageResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<AccountLanguageResponse>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ApiResponse<AccountLanguageResponse>>> SetLanguage(
        [FromBody] SetAccountLanguageRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
            return Unauthorized();

        if (!FusionLanguages.IsSupported(request.Language))
            return BadRequest(ApiResponse<AccountLanguageResponse>.Failure(
                "That language isn't available.", new { code = UnsupportedLanguageCode }));

        var user = await dbContext.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, cancellationToken);
        if (user is null)
            return Unauthorized();

        user.PreferredLanguage = request.Language;
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ApiResponse<AccountLanguageResponse>.Success(
            new AccountLanguageResponse(FusionLanguages.Resolve(user.PreferredLanguage, null))));
    }

    /// <summary>
    /// Turns pop-ups for new notifications, and their chime, on or off. No permission: they are the person's own.
    /// </summary>
    [HttpPut("alerts")]
    [ProducesResponseType(typeof(ApiResponse<AccountAlertsResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<AccountAlertsResponse>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ApiResponse<AccountAlertsResponse>>> SetAlerts(
        [FromBody] SetAccountAlertsRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
            return Unauthorized();

        if (request.Popups is null && request.Sound is null)
            return BadRequest(ApiResponse<AccountAlertsResponse>.Failure(
                "Say which choice to change.", new { code = NothingToChangeCode }));

        var user = await dbContext.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, cancellationToken);
        if (user is null)
            return Unauthorized();

        if (request.Popups is bool popups) user.NotificationPopups = popups;
        if (request.Sound is bool sound) user.NotificationSound = sound;
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ApiResponse<AccountAlertsResponse>.Success(
            new AccountAlertsResponse(user.NotificationPopups, user.NotificationSound)));
    }

    /// <summary>
    /// Sets the person's password (B-191): someone who signs in only through a provider sets a first one after
    /// confirming through it; someone with a password changes it with the current one.
    /// </summary>
    [HttpPost("password")]
    public async Task<IActionResult> SetPassword([FromBody] SetAccountPasswordRequest request, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
            return Unauthorized();
        var user = await dbContext.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Id == userId && u.IsActive, cancellationToken);
        if (user is null)
            return Unauthorized();

        var outcome = await stepUp.VerifyAsync(user,
            new Features.SingleSignOn.StepUpProof(request.CurrentPassword, request.Sso && string.IsNullOrEmpty(user.PasswordHash)),
            cancellationToken);
        if (outcome != Features.SingleSignOn.StepUpOutcome.Confirmed)
        {
            var (status, code, message) = Features.SingleSignOn.SsoStepUp.Refusal(outcome);
            return StatusCode(status, ApiResponse<object>.Failure(message, new { code }));
        }

        var result = string.IsNullOrEmpty(user.PasswordHash)
            ? await userManager.AddPasswordAsync(user, request.NewPassword ?? string.Empty)
            : await userManager.ChangePasswordAsync(user, request.CurrentPassword!, request.NewPassword ?? string.Empty);
        if (!result.Succeeded)
            return BadRequest(ApiResponse<object>.Failure(
                result.Errors.Select(error => error.Description).FirstOrDefault() ?? "That password can't be used.", new { code = "invalid-password" }));

        var membership = await ssoPolicy.ActiveMembershipAsync(user.Id, cancellationToken);
        if (membership is not null)
        {
            dbContext.AccessAuditEvents.Add(Domain.Entities.AccessAuditEvent.Create(
                membership.TenantId, user.Id, string.Empty, string.Empty, Features.SingleSignOn.SsoAuditActions.PasswordSet,
                Features.SingleSignOn.SsoAuditActions.ResourceType, membership.Id.ToString(), $"{user.FullName} set their password.",
                null, null, HttpContext.TraceIdentifier));
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(ApiResponse<object>.Success(new { hasPassword = true }));
    }
}

public sealed record SetAccountPasswordRequest(string? NewPassword, string? CurrentPassword, bool Sso);
