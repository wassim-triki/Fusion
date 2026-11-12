using EY.HRPlatform.Performance.Features.Insights;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>Insights › Performance (D-88): a year's figures for those who administer years, and the people behind each.</summary>
[ApiController]
[Authorize]
[Route("api/performance/insights")]
public sealed class InsightsController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    /// <summary>The year named (else the latest started), against the one before, scoped to a unit and everything below it.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<InsightsDto>>> Get([FromQuery] Guid? cycleId, [FromQuery] Guid? unitId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetInsightsQuery(cycleId, unitId), cancellationToken));
    }

    /// <summary>The people behind one figure, paged.</summary>
    [HttpGet("people")]
    public async Task<ActionResult<ApiResponse<InsightsPeoplePageDto>>> People(
        [FromQuery] string metric, [FromQuery] Guid? cycleId, [FromQuery] Guid? unitId, [FromQuery] Guid? departmentId, [FromQuery] Guid? managerId,
        [FromQuery] int? level, [FromQuery] string? bucket, [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        CancellationToken cancellationToken = default)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(
            new GetInsightsPeopleQuery(cycleId, metric, unitId, departmentId, managerId, level, bucket, page, pageSize), cancellationToken));
    }
}
