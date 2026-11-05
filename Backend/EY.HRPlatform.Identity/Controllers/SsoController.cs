using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Models.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// The public side of single sign-on (B-191): which ways in an address has, starting a provider round trip, the
/// provider's return, and handing the result to the page that started it. Nothing here takes a token, code or id
/// in a URL; the round trip is bound to the browser by an httpOnly cookie.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/identity/sso")]
public sealed class SsoController(SsoFlowService flows, SsoPolicy policy, SsoOptions options) : ControllerBase
{
    public const string RateLimitPolicy = "sso";

    /// <summary>Sign-in step 2. Answers by domain and the company's switches, never by whether an account exists.</summary>
    [HttpGet("discover")]
    [EnableRateLimiting(RateLimitPolicy)]
    public async Task<ActionResult<ApiResponse<SsoWaysIn>>> Discover(
        [FromQuery] string? email, [FromQuery] string? company, CancellationToken cancellationToken)
        => Ok(ApiResponse<SsoWaysIn>.Success(options.Enabled
            ? await policy.DiscoverAsync(email, company, cancellationToken)
            : SsoWaysIn.PasswordOnly));

    [HttpPost("flows")]
    [EnableRateLimiting(RateLimitPolicy)]
    public async Task<IActionResult> Start([FromBody] StartSsoFlowRequest request, CancellationToken cancellationToken)
    {
        var started = await flows.StartAsync(request, User, cancellationToken);
        if (started.AuthorizeUrl is null || started.Binding is null)
            return StatusCode(started.Status, ApiResponse<object>.Failure(started.Message ?? "That didn't work.", new { code = started.Code }));

        Response.Cookies.Append(SsoFlowService.CookieName, started.Binding, CookieOptions(SsoFlow.Lifetime));
        return Ok(ApiResponse<SsoFlowStartedDto>.Success(new SsoFlowStartedDto(started.AuthorizeUrl)));
    }

    [HttpGet("callback/microsoft")]
    public Task<IActionResult> MicrosoftCallback(CancellationToken cancellationToken)
        => CallbackAsync(SsoProviderKeys.Microsoft, null, cancellationToken);

    [HttpGet("callback/google")]
    public Task<IActionResult> GoogleCallback(CancellationToken cancellationToken)
        => CallbackAsync(SsoProviderKeys.Google, null, cancellationToken);

    [HttpGet("callback/c/{connectionId:guid}")]
    public Task<IActionResult> CompanyCallback(Guid connectionId, CancellationToken cancellationToken)
        => CallbackAsync(SsoProviderKeys.Company, connectionId, cancellationToken);

    /// <summary>Collects a sign-in or invitation flow's outcome once, with the cookie that started it.</summary>
    [HttpPost("result")]
    public async Task<IActionResult> Result(CancellationToken cancellationToken)
    {
        var result = await flows.CollectAsync(Request.Cookies[SsoFlowService.CookieName], cancellationToken);
        Response.Cookies.Delete(SsoFlowService.CookieName, CookieOptions(TimeSpan.Zero));
        if (result is null)
            return NotFound(ApiResponse<object>.Failure("Signing in took too long. Try again.", new { code = SsoRefusals.Expired }));

        return Ok(ApiResponse<SsoResultDto>.Success(new SsoResultDto(result.Session, result.Refusal)));
    }

    private async Task<IActionResult> CallbackAsync(string provider, Guid? connectionId, CancellationToken cancellationToken)
    {
        var query = Request.Query.ToDictionary(pair => pair.Key, pair => (string?)pair.Value.FirstOrDefault());
        var location = await flows.CallbackAsync(provider, connectionId, query, Request.Cookies[SsoFlowService.CookieName], cancellationToken);
        Response.Headers.CacheControl = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        return Redirect(location);
    }

    private CookieOptions CookieOptions(TimeSpan lifetime) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Secure = options.SecureCookies,
        Path = SsoFlowService.CookiePath,
        MaxAge = lifetime,
        IsEssential = true,
    };
}

public sealed record SsoFlowStartedDto(string AuthorizeUrl);

public sealed record SsoResultDto(AuthResponse? Session, SsoRefusalDto? Refusal);
