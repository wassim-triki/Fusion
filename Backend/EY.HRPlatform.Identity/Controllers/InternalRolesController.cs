using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EY.HRPlatform.Identity.Infrastructure.Persistence;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>Core HR says a tenant's jobs, units, places or reporting lines changed; rule-held roles follow.</summary>
[ApiController]
[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
[Route("internal/identity/roles")]
public sealed class InternalRolesController(
    IInternalServiceRequestAuthorizer authorizer,
    RoleRecomputeQueue queue, AppIdentityDbContext db) : ControllerBase
{
    public sealed record ReportRoleRequest(Guid TenantId, Guid UserId);

    // Signed service call. Explicit tenant predicates are required: internal requests have no user tenant filter.
    [HttpPost("report-audience")]
    public async Task<IActionResult> ReportAudience([FromBody] ReportRoleRequest request, CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken)) return Unauthorized();
        if (request.TenantId == Guid.Empty || request.UserId == Guid.Empty
            || Request.Headers["X-Tenant-Id"].ToString() != request.TenantId.ToString()) return BadRequest();
        var held = await db.UserAccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(a => a.TenantId == request.TenantId && a.UserId == request.UserId && (a.IsChosen || a.ByRule))
            .Select(a => a.AccessProfileId).ToListAsync(cancellationToken);
        return Ok(await db.AccessProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(role => role.TenantId == request.TenantId)
            .OrderBy(role => role.Name)
            .Select(role => new { role.Id, role.Name, Held = held.Contains(role.Id) }).ToListAsync(cancellationToken));
    }

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
