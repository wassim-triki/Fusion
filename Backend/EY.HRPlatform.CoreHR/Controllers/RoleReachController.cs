using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Controllers;

/// <summary>What "their unit" covers for one person, for the role page's preview (B-212). Role editors only.</summary>
[ApiController]
[Route("api/corehr/roles/reach")]
[Authorize]
public sealed class RoleReachController(CoreHRDbContext db, ICoreAccessPolicyService accessPolicy) : ControllerBase
{
    [HttpGet("{employeeId:guid}")]
    [ProducesResponseType(typeof(ApiResponse<ViewerUnitReachDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccessProfiles(User)) return Forbid();
        // Another tenant's person is invisible through the query filter and reads as not found.
        if (!await db.Employees.AsNoTracking().AnyAsync(employee => employee.Id == employeeId, cancellationToken))
            return NotFound(ApiResponse.Failure("Employee was not found."));
        return Ok(ApiResponse<ViewerUnitReachDto>.Success(await ViewerReach.DescribeAsync(db, employeeId, cancellationToken)));
    }
}
