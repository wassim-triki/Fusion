using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Search;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

[ApiController]
[Authorize]
[Route("api/performance/search")]
public sealed class SearchController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    /// <summary>
    /// The top bar's search over Performance (B-211): objectives the caller may open, their 1:1s, review rounds and,
    /// for administrators, cycles. The caller comes from the token; nothing in the request widens what they see.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PerformanceSearchDto>>> Search([FromQuery] string? q, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        var actor = new GoalActorContext(User.GetEmployeeId() ?? Guid.Empty, policy.CanAdministerCycles(User),
            policy.CanManageOrganizationalObjectives(User), policy.CanReviewDirectReports(User), policy.CanPublishStrategy(User));
        return MapResult(await mediator.Send(new PerformanceSearchQuery(q ?? "", actor), cancellationToken));
    }
}
