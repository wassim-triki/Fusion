using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.Membership;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Models.Requests;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

[ApiController]
[Route("api/identity/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly AppIdentityDbContext _dbContext;
    private readonly IAuthSessionFactory _sessions;
    private readonly SsoPolicy _ssoPolicy;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        AppIdentityDbContext dbContext,
        IAuthSessionFactory sessions,
        SsoPolicy ssoPolicy)
    {
        _userManager = userManager;
        _dbContext = dbContext;
        _sessions = sessions;
        _ssoPolicy = ssoPolicy;
    }

    /// <summary>
    /// Registration is disabled for workforce users.
    /// CoreHR employees and managers must activate access from an employee-linked invitation.
    /// </summary>
    [HttpPost("register")]
    [Authorize(Roles = PlatformRole.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<AuthResponse>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<ApiResponse<AuthResponse>> Register(
        [FromBody] RegisterRequest request)
    {
        _ = request;

        return BadRequest(ApiResponse<AuthResponse>.Failure(
            "Self-service registration is disabled. Core workforce access must be activated from a trusted employee record invitation."));
    }

    [HttpPost("login")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Login(
        [FromBody] LoginRequest request)
    {
        // Find user by email — bypass tenant filter since no JWT exists at login time
        var normalizedEmail = request.Email?.Trim().ToUpperInvariant();
        var user = await _dbContext.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.NormalizedEmail == normalizedEmail);
        // An account that signs in only through a provider has no password to check (B-191).
        if (user is null || !user.IsActive || string.IsNullOrEmpty(user.PasswordHash))
            return Unauthorized(ApiResponse<AuthResponse>.Failure("Invalid credentials."));

        // Verify password directly (SignInManager uses UserManager which is affected by query filters)
        var verificationResult = _userManager.PasswordHasher
            .VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (verificationResult == PasswordVerificationResult.Failed)
            return Unauthorized(ApiResponse<AuthResponse>.Failure("Invalid credentials."));

        // Where the company requires its own provider, only its administrators keep the password, and their use of
        // it is recorded. Everyone else gets the same answer as a wrong password, so it gives nothing away.
        var membership = await _ssoPolicy.ActiveMembershipAsync(user.Id, HttpContext.RequestAborted);
        if (membership is not null
            && await _ssoPolicy.RequiresCompanyProviderAsync(membership.TenantId, user.Email, HttpContext.RequestAborted))
        {
            if (!await _ssoPolicy.IsUsableAdministratorAsync(membership.TenantId, user.Id, HttpContext.RequestAborted))
                return Unauthorized(ApiResponse<AuthResponse>.Failure("Invalid credentials."));

            _dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
                membership.TenantId, user.Id, string.Empty, string.Empty, SsoAuditActions.PasswordUsedWhileRequired,
                SsoAuditActions.ResourceType, membership.Id.ToString(),
                $"{user.FullName} signed in with their password while the company's provider is required.", null, null, null));
        }

        // Rehash inline if the hasher settings have changed since the password was last set
        if (verificationResult == PasswordVerificationResult.SuccessRehashNeeded)
            user.PasswordHash = _userManager.PasswordHasher.HashPassword(user, request.Password);

        // Update last login timestamp (and persists rehash if applicable)
        user.LastLoginAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync();

        // Generate tokens and return
        var authResponse = await GenerateAuthResponseAsync(user);
        return Ok(ApiResponse<AuthResponse>.Success(authResponse));
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Refresh(
        [FromBody] RefreshTokenRequest request)
    {
        // Find the refresh token in database
        var storedToken = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(rt => rt.Token == request.RefreshToken);

        if (storedToken is null || !storedToken.IsActive)
        {
            // A password session the company's requirement ended says why, so the page can send the person to
            // their company's provider instead of a bare sign-in form (B-191).
            if (storedToken is not null && !storedToken.IsExpired && SessionMethods.IsPassword(storedToken.Method))
            {
                var holder = await _dbContext.Users.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(u => u.Id == storedToken.UserId && u.IsActive);
                if (holder is not null && await _ssoPolicy.PasswordRefusedAsync(holder, HttpContext.RequestAborted))
                    return Unauthorized(ApiResponse<AuthResponse>.Failure(
                        "Your company signs in with its own provider.", new { code = SsoRefusals.SsoRequired }));
            }

            return Unauthorized(ApiResponse<AuthResponse>.Failure(
                "Invalid or expired refresh token."));
        }

        // Revoke the old token (one-time use)
        storedToken.RevokedAt = DateTime.UtcNow;

        // Find the user — bypass tenant filter since refresh may happen without tenant context
        var user = await _dbContext.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == storedToken.UserId);
        if (user is null || !user.IsActive)
            return Unauthorized(ApiResponse<AuthResponse>.Failure(
                "User not found or deactivated."));

        // A password session ends once the company requires its own provider for this person (B-191).
        if (SessionMethods.IsPassword(storedToken.Method) && await _ssoPolicy.PasswordRefusedAsync(user, HttpContext.RequestAborted))
        {
            await _dbContext.SaveChangesAsync();
            return Unauthorized(ApiResponse<AuthResponse>.Failure(
                "Your company signs in with its own provider.", new { code = SsoRefusals.SsoRequired }));
        }

        // Generate new token pair, started the same way as the one it replaces
        var authResponse = await _sessions.CreateAsync(user, storedToken.Method);
        await _dbContext.SaveChangesAsync();

        return Ok(ApiResponse<AuthResponse>.Success(authResponse));
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<ActionResult<ApiResponse>> Logout()
    {
        // Get current user's ID from the JWT claims
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId is null)
            return Unauthorized();

        // Revoke ALL refresh tokens for this user
        var tokens = await _dbContext.RefreshTokens
            .Where(rt => rt.UserId == Guid.Parse(userId) && rt.RevokedAt == null)
            .ToListAsync();

        foreach (var token in tokens)
            token.RevokedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();
        return Ok(ApiResponse.Success());
    }

    /// <summary>
    /// One session-building path, shared with administrator activation.
    /// </summary>
    private Task<AuthResponse> GenerateAuthResponseAsync(ApplicationUser user)
        => _sessions.CreateAsync(user);
}
