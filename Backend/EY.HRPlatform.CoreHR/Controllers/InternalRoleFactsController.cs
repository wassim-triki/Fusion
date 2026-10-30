using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

/// <summary>What Identity needs to keep rule-held roles current (B-177). Signed calls only; the tenant is the signed X-Tenant-Id.</summary>
[ApiController]
[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
[Route("internal/corehr/role-facts")]
public sealed class InternalRoleFactsController(
    IInternalServiceRequestAuthorizer authorizer,
    IRoleFactsService roleFacts) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<IReadOnlyList<RoleFactDto>>> Facts(CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await roleFacts.GetFactsAsync(DateTime.UtcNow, cancellationToken));
    }

    [HttpPost("targets")]
    public async Task<ActionResult<RoleTargetsDto>> Targets([FromBody] RoleTargetsRequest request, CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await roleFacts.ResolveTargetsAsync(request.Ids ?? [], DateTime.UtcNow, cancellationToken));
    }
}
