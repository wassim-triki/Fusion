using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Features.Calibration;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>
/// A round's calibration by exception (D-35). Every action needs the calibrate grant; nobody opens or staffs a session.
/// Releasing results is the year's move and stays with cycle administration.
/// </summary>
[ApiController]
[Authorize]
[Route("api/performance/review-rounds/{roundId:guid}/calibration")]
public sealed class CalibrationController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    private CalibratorIdentity Actor => new(User.GetUserId(), User.GetEmployeeId(), User.GetFullName());

    [HttpGet]
    public async Task<ActionResult<ApiResponse<CalibrationDto>>> Get(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanCalibrateReviews(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetCalibrationQuery(roundId, Actor, true, policy.CanAdministerCycles(User)), cancellationToken));
    }

    [HttpGet("everyone")]
    public async Task<ActionResult<ApiResponse<CalibrationEveryoneDto>>> Everyone(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanCalibrateReviews(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetCalibrationEveryoneQuery(roundId, Actor, true), cancellationToken));
    }

    [HttpPut("subjects/{reviewId:guid}/decision")]
    public async Task<ActionResult<ApiResponse<CalibrationSubjectDto>>> Decide(Guid roundId, Guid reviewId,
        [FromBody] CalibrationDecisionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanCalibrateReviews(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new DecideCalibrationCommand(roundId, reviewId, Actor, request.Rating, request.Reason,
            request.ExpectedVersion, true), cancellationToken));
    }

    [HttpDelete("subjects/{reviewId:guid}/decision")]
    public async Task<ActionResult<ApiResponse<CalibrationSubjectDto>>> Undo(Guid roundId, Guid reviewId, [FromQuery] uint expectedVersion,
        CancellationToken cancellationToken)
    {
        if (!policy.CanCalibrateReviews(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UndoCalibrationDecisionCommand(roundId, reviewId, Actor, expectedVersion, true), cancellationToken));
    }
}
