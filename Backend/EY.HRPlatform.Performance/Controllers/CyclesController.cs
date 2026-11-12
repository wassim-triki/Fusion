using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

[ApiController]
[Authorize]
[Route("api/performance/cycles")]
public sealed class CyclesController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    [HttpGet("{cycleId:guid}")]
    public async Task<ActionResult<ApiResponse<CycleDetailDto>>> Get(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetCycleDetailQuery(cycleId, VisibilityActor()), cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<CycleSummaryDto>>> Create(
        [FromBody] CreateCycleRequest request,
        CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CreateCycleCommand(request), cancellationToken));
    }

    [HttpPut("{cycleId:guid}")]
    public async Task<ActionResult<ApiResponse<CycleSummaryDto>>> Update(
        Guid cycleId,
        [FromBody] UpdateCycleRequest request,
        CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateCycleCommand(cycleId, request), cancellationToken));
    }

    /// <summary>Setting up a year (D-91): the draft or the year proposed from last year, who's in and what comes along.</summary>
    [HttpGet("setup")]
    public async Task<ActionResult<ApiResponse<YearSetupDto>>> Setup(CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetYearSetupQuery(), cancellationToken));
    }

    /// <summary>Launches a year being set up onto the Year; the year before ends with its unfinished goals carried (D-57).</summary>
    [HttpPost("{cycleId:guid}/launch")]
    public async Task<ActionResult<ApiResponse<YearLaunchDto>>> Launch(Guid cycleId, [FromBody] ExpectedVersionRequest version, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new LaunchYearCommand(cycleId, version.ExpectedVersion, User.GetEmployeeId() ?? Guid.Empty), cancellationToken));
    }

    /// <summary>The year as one object (D-34, D-55): its phase, its steps with the people in each at the viewer's reach, HR's next move.</summary>
    [HttpGet("{cycleId:guid}/year")]
    public async Task<ActionResult<ApiResponse<YearDto>>> Year(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetYearQuery(cycleId, VisibilityActor()), cancellationToken));
    }


    /// <summary>Moves the year on to the step the year's next move previews (D-58); the preview itself is the year's <c>nextMove</c>.</summary>
    [HttpPost("{cycleId:guid}/move-on")]
    public async Task<ActionResult<ApiResponse<YearDto>>> MoveOn(Guid cycleId, [FromBody] MoveYearOnRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new MoveYearOnCommand(cycleId, request.To, request.ExpectedVersion, VisibilityActor()), cancellationToken));
    }

    /// <summary>Nudges people toward their next step in the year: administrators anyone in it, a manager their own people.</summary>
    [HttpPost("{cycleId:guid}/nudges")]
    public async Task<ActionResult<ApiResponse<NudgeResultDto>>> Nudge(Guid cycleId, [FromBody] NudgeRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new NudgeCommand(cycleId, request.EmployeeIds ?? [], request.Standings ?? [], VisibilityActor()), cancellationToken));
    }

    [HttpDelete("{cycleId:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid cycleId, [FromBody] ExpectedVersionRequest version, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new DeleteDraftCycleCommand(cycleId, version.ExpectedVersion), cancellationToken));
    }
    private CycleVisibilityActor VisibilityActor()
        => new(User.GetEmployeeId() ?? Guid.Empty, policy.CanAdministerCycles(User), policy.AggregateViewScope(User));
}
