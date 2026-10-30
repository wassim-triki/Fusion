using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>Core HR says a tenant's jobs, units, places or reporting lines changed; rule-held roles follow.</summary>
[ApiController]
[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
[Route("internal/identity/roles")]
public sealed class InternalRolesController(
    IInternalServiceRequestAuthorizer authorizer,
    RoleRecomputeQueue queue) : ControllerBase
{
    [HttpPost("recompute")]
    public async Task<IActionResult> Recompute(CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();
        if (!Guid.TryParse(Request.Headers["X-Tenant-Id"].ToString(), out var tenantId) || tenantId == Guid.Empty)
            return BadRequest();

        queue.Enqueue(tenantId);
        return Accepted();
    }
}
