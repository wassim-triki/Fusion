using EY.HRPlatform.Performance.Features.People;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>One person's performance, shaped for the caller (D-32). Always 200 with only the visible sections.</summary>
[ApiController]
[Authorize]
[Route("api/performance/people")]
public sealed class PeopleController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    [HttpGet("{employeeId:guid}/summary")]
    public async Task<ActionResult<ApiResponse<PersonPerformanceSummaryDto>>> Summary(
        Guid employeeId, [FromQuery] Guid? cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        var viewer = new PersonSummaryViewer(
            User.GetEmployeeId() ?? Guid.Empty,
            policy.CanReviewDirectReports(User),
            policy.CanAdministerCycles(User)) { PlansReach = policy.AggregateViewScope(User) };
        return MapResult(await mediator.Send(new GetPersonSummaryQuery(employeeId, cycleId, viewer), cancellationToken));
    }

    /// <summary>
    /// What a reporting-line change does here (reviewer stays, 1:1s end), for Core HR's change panel. Only people who
    /// may change reporting lines in Core HR ask it.
    /// </summary>
    [HttpGet("{employeeId:guid}/line-effects")]
    public async Task<ActionResult<ApiResponse<LineEffectsDto>>> LineEffects(
        Guid employeeId, [FromQuery] Guid? manager, CancellationToken cancellationToken)
    {
        if (!User.HasCorePermission(CorePermissions.EmployeeManage, PermissionScopes.Tenant)
            && !User.HasCorePermission(CorePermissions.ReportingManage, PermissionScopes.Tenant))
            return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetLineEffectsQuery(employeeId, manager), cancellationToken));
    }

    /// <summary>Active colleagues by name for the feedback, request and praise pickers. Core HR being down answers 503.</summary>
    [HttpGet("directory")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<DirectoryPersonDto>>>> Directory([FromQuery] string? search,
        CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SearchPeopleDirectoryQuery(search), cancellationToken));
    }
}
