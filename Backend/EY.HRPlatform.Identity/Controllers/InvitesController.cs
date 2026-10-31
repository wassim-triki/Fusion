using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Models.Requests;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.Identity.Controllers;

[ApiController]
[Route("api/identity")]
public class InvitesController : ControllerBase
{
    private readonly AppIdentityDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IConfiguration _configuration;
    private readonly ITrainingServiceClient _trainingClient;
    private readonly IAccessProfileService _accessProfileService;
    private readonly IWorkforceInvitationAcceptanceService _workforceAcceptance;

    public InvitesController(
        AppIdentityDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IConfiguration configuration,
        ITrainingServiceClient trainingClient,
        IAccessProfileService accessProfileService,
        IWorkforceInvitationAcceptanceService workforceAcceptance)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _configuration = configuration;
        _trainingClient = trainingClient;
        _accessProfileService = accessProfileService;
        _workforceAcceptance = workforceAcceptance;
    }

    /// <summary>
    /// Validate an invitation token and return its metadata.
    /// This is an anonymous endpoint for the invite acceptance flow.
    /// </summary>
    [HttpGet("invites/{token}")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ApiResponse<InviteDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<InviteDto>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<InviteDto>), StatusCodes.Status410Gone)]
    public async Task<ActionResult<ApiResponse<InviteDto>>> ValidateInvite(string token)
    {
        // Anonymous endpoint — bypass tenant filter (no auth context). The value carries
        // either a selector/secret credential (new) or a legacy raw token (transitional);
        // purpose is bound at creation, so only a Workforce invitation resolves here.
        var invite = await ResolveWorkforceInvitationAsync(token);

        if (invite is null)
            return NotFound(ApiResponse<InviteDto>.Failure("Invalid invitation token."));

        if (invite.IsRevoked)
            return StatusCode(StatusCodes.Status410Gone,
                ApiResponse<InviteDto>.Failure("This invitation has been revoked."));

        if (invite.IsUsed)
            return StatusCode(StatusCodes.Status410Gone,
                ApiResponse<InviteDto>.Failure("This invitation has already been used."));

        if (invite.IsExpired)
            return StatusCode(StatusCodes.Status410Gone,
                ApiResponse<InviteDto>.Failure("This invitation has expired."));

        var dto = new InviteDto
        {
            Id = invite.Id,
            Email = invite.Email,
            EmployeeId = invite.EmployeeId,
            TenantName = invite.Tenant?.Name ?? string.Empty,
            Role = invite.Role,
            AccessProfiles = (await _accessProfileService.GetInviteAccessProfilesAsync(invite.Id)).ToList(),
            FirstName = invite.FirstName,
            LastName = invite.LastName,
            ExpiresAt = invite.ExpiresAt,
            IsExpired = invite.IsExpired,
            IsUsed = invite.IsUsed,
            CreatedAt = invite.CreatedAt,
            DeliveryStatus = invite.DeliveryStatus,
            DeliveryMessage = invite.DeliveryMessage,
            DeliveryRecordedAt = invite.DeliveryRecordedAt,
            PasswordRequirements = AccountPasswordPolicy.Describe()
        };

        return Ok(ApiResponse<InviteDto>.Success(dto));
    }

    /// <summary>
    /// Accept an invitation and create a user account.
    /// This is an anonymous endpoint for the invite acceptance flow.
    /// </summary>
    [HttpPost("invites/{token}/accept")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ApiResponse<UserDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<UserDto>), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse<UserDto>), StatusCodes.Status410Gone)]
    public async Task<ActionResult<ApiResponse<UserDto>>> AcceptInvite(
        string token,
        [FromBody] AcceptInviteRequest request)
    {
        // The account, its Active membership, the authoritative Employee binding, the
        // reviewed baseline, the accepted invitation, and the audit are created together
        // by the acceptance service — or none of them are. Credential verification,
        // re-resolution, and the transitional raw-token path live there too.
        var result = await _workforceAcceptance.AcceptAsync(
            new WorkforceAcceptanceRequest(
                Credential: token,
                Email: null,
                FirstName: request.FirstName,
                LastName: request.LastName,
                Password: request.Password),
            HttpContext.RequestAborted);

        switch (result.Outcome)
        {
            case WorkforceAcceptanceOutcome.Accepted:
            {
                var account = await _dbContext.Users
                    .IgnoreQueryFilters()
                    .FirstAsync(u => u.Id == result.AccountId);
                var employeeId = await _dbContext.TenantMemberships
                    .IgnoreQueryFilters()
                    .Where(membership => membership.TenantId == result.TenantId
                        && membership.UserId == account.Id
                        && membership.Status == TenantMembershipStatus.Active)
                    .Select(membership => membership.EmployeeId)
                    .SingleAsync();

                // Fire-and-forget: provision downstream employee profile.
                _ = _trainingClient.ProvisionEmployeeAsync(account.Id);

                var dto = new UserDto
                {
                    Id = account.Id,
                    EmployeeId = employeeId,
                    Email = account.Email!,
                    FullName = account.FullName,
                    Department = account.Department,
                    JobTitle = account.JobTitle,
                    HireDate = account.HireDate,
                    TenantId = result.TenantId ?? Guid.Empty,
                    Roles = [],
                    AccessProfiles = (await _accessProfileService.GetAssignedProfilesAsync(account)).ToList(),
                };

                return StatusCode(StatusCodes.Status201Created, ApiResponse<UserDto>.Success(dto));
            }

            case WorkforceAcceptanceOutcome.AlreadyAccepted:
                return StatusCode(StatusCodes.Status410Gone,
                    ApiResponse<UserDto>.Failure("This invitation has already been used."));

            case WorkforceAcceptanceOutcome.ExistingAccountConflict:
            case WorkforceAcceptanceOutcome.EmployeeAlreadyLinked:
                // Recoverable only through an allowed administrator path — never by
                // creating a duplicate account here.
                return Conflict(ApiResponse<UserDto>.Failure(
                    "This invitation can no longer be completed automatically. Ask an administrator to review workforce access."));

            case WorkforceAcceptanceOutcome.InvalidAccountDetails:
            {
                var errors = (result.FieldErrors ?? [])
                    .Select(error => error.Message)
                    .DefaultIfEmpty("The submitted account details were rejected.")
                    .ToArray();
                return BadRequest(ApiResponse<UserDto>.Failure(errors));
            }

            default:
                // Unknown credential, wrong purpose/email, expired, or revoked — one
                // indistinct answer, so a caller cannot probe for valid credentials.
                return NotFound(ApiResponse<UserDto>.Failure("This invitation is not valid."));
        }
    }

    /// <summary>
    /// Resolves a Workforce invitation from a presented value: a selector/secret credential
    /// verified by digest, or — transitionally — a pre-cutover raw token. Read-only; the
    /// acceptance service does the locked, authoritative resolution.
    /// </summary>
    private async Task<InviteToken?> ResolveWorkforceInvitationAsync(string presented)
    {
        if (BootstrapCredential.TryParse(presented, out var selector, out var secret))
        {
            var bySelector = await _dbContext.InviteTokens
                .IgnoreQueryFilters()
                .Include(i => i.Tenant)
                .FirstOrDefaultAsync(i => i.CredentialSelector == selector);

            if (bySelector is null
                || bySelector.Purpose != InvitationPurpose.WorkforceAccount
                || !bySelector.MatchesCredentialDigest(BootstrapCredential.Digest(secret)))
            {
                return null;
            }

            return bySelector;
        }

        if (string.IsNullOrWhiteSpace(presented))
            return null;

        var byToken = await _dbContext.InviteTokens
            .IgnoreQueryFilters()
            .Include(i => i.Tenant)
            .FirstOrDefaultAsync(i => i.Token == presented);

        return byToken?.Purpose == InvitationPurpose.WorkforceAccount ? byToken : null;
    }

    /// <summary>
    /// Dev-only: remove an orphaned user by email (partial-failure cleanup on InMemory).
    /// </summary>
    [HttpDelete("dev/users/{email}")]
    [Authorize(Roles = PlatformRole.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse>> DeleteUserByEmail(string email)
    {
        var user = await _userManager.FindByEmailAsync(email);
        if (user is null)
            return NotFound(ApiResponse.Failure("User not found."));

        var result = await _userManager.DeleteAsync(user);
        if (!result.Succeeded)
        {
            var errors = result.Errors.Select(e => e.Description).ToArray();
            return BadRequest(ApiResponse.Failure(errors));
        }

        return Ok(ApiResponse.Success());
    }
}
