using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
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
[Authorize(Roles = $"{PlatformRole.PlatformAdmin},{PlatformRole.HRAdmin}")]
// What's left of the old user endpoints is Learning's: its admin dashboard lists the
// company's accounts here, on its HRAdmin role copy. Reading one account and creating
// accounts retired with the token roles (B-178); people get accounts by invitation.
public class UsersController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly AppIdentityDbContext _dbContext;
    private readonly ITrainingServiceClient _trainingClient;

    public UsersController(
        UserManager<ApplicationUser> userManager,
        AppIdentityDbContext dbContext,
        ITrainingServiceClient trainingClient)
    {
        _userManager = userManager;
        _dbContext = dbContext;
        _trainingClient = trainingClient;
    }

    /// <summary>
    /// Get the active users of the caller's own tenant.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<List<UserDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<List<UserDto>>>> GetAll()
    {
        // Listing customer accounts requires a customer tenant context. A Platform
        // Administrator has none, so this returns nothing rather than every tenant.
        var callerTenantId = User.GetTenantId();
        if (callerTenantId is null)
            return Ok(ApiResponse<List<UserDto>>.Success([]));

        var users = await _userManager.Users
            .Where(u => u.IsActive)
            .Select(u => new UserDto
            {
                Id = u.Id,
                EmployeeId = u.TenantMemberships
                    .Where(membership => membership.TenantId == callerTenantId.Value
                        && membership.Status == TenantMembershipStatus.Active)
                    .Select(membership => membership.EmployeeId)
                    .FirstOrDefault(),
                Email = u.Email!,
                FullName = u.FullName,
                Department = u.Department,
                JobTitle = u.JobTitle,
                HireDate = u.HireDate,
                TenantId = callerTenantId.Value
            })
            .ToListAsync();

        return Ok(ApiResponse<List<UserDto>>.Success(users));
    }

    /// <summary>
    /// One-time backfill: re-syncs every existing Employee user's name + email into the Training
    /// service. Idempotent (provisioning upserts). PlatformAdmin only.
    /// </summary>
    [HttpPost("sync-to-training")]
    [Authorize(Roles = PlatformRole.PlatformAdmin)]
    [ProducesResponseType(typeof(ApiResponse<int>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<int>>> SyncEmployeesToTraining(CancellationToken cancellationToken)
    {
        // Everyone who signs in to a company; tenant roles no longer live on accounts (B-178).
        var employees = await _dbContext.Users
            .IgnoreQueryFilters()
            .Where(user => user.IsActive && user.TenantMemberships.Any(membership => membership.Status == TenantMembershipStatus.Active))
            .ToListAsync(cancellationToken);

        var count = 0;
        foreach (var employee in employees)
        {
            await _trainingClient.ProvisionEmployeeAsync(employee.Id, employee.FullName, employee.Email, cancellationToken);
            count++;
        }

        return Ok(ApiResponse<int>.Success(count));
    }
}
