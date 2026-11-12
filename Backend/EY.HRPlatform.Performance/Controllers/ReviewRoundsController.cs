using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

[ApiController]
[Authorize]
[Route("api/performance")]
public sealed class ReviewRoundsController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    [HttpGet("cycles/{cycleId:guid}/review-rounds")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewRoundSummaryDto>>>> List(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ListReviewRoundsQuery(cycleId), cancellationToken));
    }

    [HttpPost("cycles/{cycleId:guid}/review-rounds")]
    public async Task<ActionResult<ApiResponse<ReviewRoundDto>>> Create(Guid cycleId, [FromBody] CreateReviewRoundRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CreateReviewRoundCommand(cycleId, request), cancellationToken));
    }

    [HttpGet("review-rounds/{roundId:guid}")]
    public async Task<ActionResult<ApiResponse<ReviewRoundDto>>> Get(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewRoundQuery(roundId), cancellationToken));
    }

    /// <summary>The round's results as a spreadsheet (B-434).</summary>
    [HttpGet("review-rounds/{roundId:guid}/results.csv")]
    public async Task<IActionResult> ExportResults(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        var result = await mediator.Send(new ExportRoundResultsQuery(roundId), cancellationToken);
        if (result.IsFailure) return MapResult(result).Result!;
        return File(result.Value.Content, "text/csv; charset=utf-8", result.Value.FileName);
    }

    [HttpGet("review-rounds/{roundId:guid}/eligible-reviewers")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<EligibleReviewerDto>>>> EligibleReviewers(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetEligibleReviewersQuery(roundId), cancellationToken));
    }

    [HttpPut("review-rounds/{roundId:guid}")]
    public async Task<ActionResult<ApiResponse<ReviewRoundDto>>> Update(Guid roundId, [FromBody] UpdateReviewRoundRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateReviewRoundCommand(roundId, request), cancellationToken));
    }

    [HttpGet("review-rounds/{roundId:guid}/population")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewRoundSubjectDto>>>> GetPopulation(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewRoundPopulationQuery(roundId), cancellationToken));
    }

    [HttpPut("review-rounds/{roundId:guid}/population")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewRoundSubjectDto>>>> UpdatePopulation(Guid roundId, [FromBody] UpdateReviewRoundPopulationRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateReviewRoundPopulationCommand(roundId, request), cancellationToken));
    }

    [HttpPost("review-rounds/{roundId:guid}/launch")]
    public async Task<ActionResult<ApiResponse<ReviewRoundLaunchDto>>> Launch(Guid roundId, [FromBody] ExpectedVersionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new LaunchReviewRoundCommand(roundId, request.ExpectedVersion), cancellationToken));
    }

    [HttpGet("review-rounds/{roundId:guid}/status")]
    public async Task<ActionResult<ApiResponse<ReviewRoundStatusDto>>> Status(Guid roundId, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewRoundStatusQuery(roundId, User.GetEmployeeId() ?? Guid.Empty), cancellationToken));
    }

    [HttpPost("review-rounds/{roundId:guid}/due-dates")]
    public async Task<ActionResult<ApiResponse<ReviewDueDateMoveDto>>> MoveDueDate(Guid roundId, [FromBody] MoveRoundDueDateRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new MoveRoundDueDateCommand(roundId, request,
            new ScheduleActor(User.GetEmployeeId(), User.GetFullName())), cancellationToken));
    }

    [HttpPost("review-rounds/{roundId:guid}/finalize")]
    public async Task<ActionResult<ApiResponse<ReviewRoundFinalizationDto>>> Finalize(Guid roundId,
        [FromBody] FinalizeReviewRoundRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new FinalizeReviewRoundCommand(roundId, request.ExpectedVersion, request.ReviewIds, User.GetEmployeeId() ?? Guid.Empty), cancellationToken));
    }


    [HttpGet("reviews/work")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewWorkItemDto>>>> Work(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewWorkQuery(cycleId, User.GetEmployeeId() ?? Guid.Empty,
            policy.CanAdministerCycles(User), policy.CanReviewDirectReports(User)), cancellationToken));
    }
}
