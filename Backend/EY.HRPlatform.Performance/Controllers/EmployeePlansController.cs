using EY.HRPlatform.Performance.Features.Plans;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>
/// Employee plans under a Cycle: the employee authors and submits their own weighted plan, and the
/// responsible manager reviews it in a decision workspace and approves or returns it. The controller
/// resolves the caller's contextual authorization inputs from the token and Forbid()s the obvious
/// case first; the handlers enforce self-identity for authoring and the responsible-manager
/// relationship for review, which a claim alone cannot express.
/// </summary>
[ApiController]
[Authorize]
[Route("api/performance/cycles/{cycleId:guid}")]
public sealed class EmployeePlansController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    private PlanActorContext Actor => new(
        User.GetEmployeeId() ?? Guid.Empty,
        policy.CanAdministerCycles(User),
        policy.CanReviewDirectReports(User));

    // ── My plan ──────────────────────────────────────────────────────────────

    [HttpGet("plan")]
    public async Task<ActionResult<ApiResponse<MyPlanStateDto>>> MyPlan(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetMyPlanQuery(cycleId, Actor), cancellationToken));
    }

    [HttpPost("plan")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> CreateMyPlan(Guid cycleId, [FromBody] ExpectedVersionRequest version, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CreateMyPlanCommand(cycleId, Actor, version.ExpectedVersion), cancellationToken));
    }

    [HttpGet("plan/alignment-targets")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<AlignmentTargetDto>>>> AlignmentTargets(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetAlignmentTargetsQuery(cycleId, Actor), cancellationToken));
    }

    [HttpPost("plan/objectives")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> AddObjective(
        Guid cycleId, [FromBody] AddPlanObjectiveRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new AddPlanObjectiveCommand(cycleId, request, Actor), cancellationToken));
    }

    [HttpPut("plan/objectives/{objectiveId:guid}")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> UpdateObjective(
        Guid cycleId, Guid objectiveId, [FromBody] UpdatePlanObjectiveRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdatePlanObjectiveCommand(cycleId, objectiveId, request, Actor), cancellationToken));
    }

    [HttpDelete("plan/objectives/{objectiveId:guid}")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> RemoveObjective(
        Guid cycleId, Guid objectiveId, [FromBody] ExpectedVersionRequest version, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new RemovePlanObjectiveCommand(cycleId, objectiveId, Actor, version.ExpectedVersion), cancellationToken));
    }

    [HttpPut("plan/weights")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> SetWeights(
        Guid cycleId, [FromBody] SetPlanWeightsRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SetPlanWeightsCommand(cycleId, request, Actor), cancellationToken));
    }

    [HttpPost("plan/submit")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> Submit(Guid cycleId, [FromBody] ExpectedVersionRequest version, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SubmitMyPlanCommand(cycleId, Actor, version.ExpectedVersion), cancellationToken));
    }

    // ── Team review work ────────────────────────────────────────────────────────

    /// <summary>Your People: the caller's recorded responsibility, action required first, filtered and paged by the server.</summary>
    [HttpPost("plan/change-requests/{requestId:guid}/address")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> AddressChangeRequest(
        Guid cycleId, Guid requestId, [FromBody] AddressChangeRequestRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new AddressChangeRequestCommand(cycleId, requestId, request, Actor), cancellationToken));
    }

    /// <summary>The Team page's Performance tab (D-79): the caller's goals with the team's under each, then each report's year.</summary>
    [HttpGet("team/year")]
    public async Task<ActionResult<ApiResponse<TeamYearDto>>> TeamYear(Guid cycleId, CancellationToken cancellationToken)
    {
        if (!policy.CanReviewDirectReports(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetTeamYearQuery(cycleId, new Features.Work.WorkActor(
            User.GetEmployeeId() ?? Guid.Empty, User.GetUserId(), policy.CanManageOwnParticipation(User), true,
            policy.CanAdministerCycles(User), policy.CanCalibrateReviews(User))), cancellationToken));
    }

    [HttpGet("plans/{planId:guid}")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> PlanDetail(Guid cycleId, Guid planId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetPlanForReviewQuery(cycleId, planId, Actor), cancellationToken));
    }

    [HttpPost("plans/{planId:guid}/return")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> ReturnPlan(
        Guid cycleId, Guid planId, [FromBody] ReturnPlanRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanReviewDirectReports(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ReturnPlanCommand(cycleId, planId, request, Actor), cancellationToken));
    }

    [HttpPost("plans/{planId:guid}/approve")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> ApprovePlan(Guid cycleId, Guid planId, [FromBody] ExpectedVersionRequest version, CancellationToken cancellationToken)
    {
        if (!policy.CanReviewDirectReports(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ApprovePlanCommand(cycleId, planId, Actor, version.ExpectedVersion), cancellationToken));
    }

    // Home's Needs you answers in place and sends no version: the plan's current one is used, and a plan that
    // isn't waiting for this reviewer is refused by the same handlers as above.
    [HttpPost("plans/{planId:guid}/decision/approve")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> ApproveInPlace(Guid cycleId, Guid planId, CancellationToken cancellationToken)
    {
        if (!policy.CanReviewDirectReports(User)) return CapabilityForbidden();
        var plan = await mediator.Send(new GetPlanForReviewQuery(cycleId, planId, Actor), cancellationToken);
        if (!plan.IsSuccess) return MapResult(plan);
        return MapResult(await mediator.Send(new ApprovePlanCommand(cycleId, planId, Actor, plan.Value.Version), cancellationToken));
    }

    [HttpPost("plans/{planId:guid}/decision/return")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> ReturnInPlace(
        Guid cycleId, Guid planId, [FromBody] PlanDecisionReasonRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanReviewDirectReports(User)) return CapabilityForbidden();
        var plan = await mediator.Send(new GetPlanForReviewQuery(cycleId, planId, Actor), cancellationToken);
        if (!plan.IsSuccess) return MapResult(plan);
        return MapResult(await mediator.Send(
            new ReturnPlanCommand(cycleId, planId, new ReturnPlanRequest(request.Reason) { ExpectedVersion = plan.Value.Version }, Actor), cancellationToken));
    }

    [HttpPost("plans/{planId:guid}/exceptional-approve")]
    public async Task<ActionResult<ApiResponse<EmployeePlanDto>>> ExceptionalApprove(
        Guid cycleId, Guid planId, [FromBody] ExceptionalApprovePlanRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ExceptionalApprovePlanCommand(cycleId, planId, request, Actor), cancellationToken));
    }

    // ── Update requests ──────────────────────────────────────────────────────

    [HttpPost("plans/{planId:guid}/update-requests")]
    public async Task<ActionResult<ApiResponse<UpdateRequestDto>>> RequestUpdate(Guid cycleId, Guid planId,
        [FromBody] CreateUpdateRequestRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CreateUpdateRequestCommand(cycleId, planId, request.ObjectiveId, request.Note, Actor, User.GetFullName()), cancellationToken));
    }

    /// <summary>Goals at risk or off track, answered in place from Home or Team (B-434): ask for an update, or talk it over.</summary>
    [HttpPost("plans/{planId:guid}/attention/ask-for-update")]
    public Task<ActionResult<ApiResponse<OffTrackAnsweredDto>>> AskForUpdate(Guid cycleId, Guid planId, CancellationToken cancellationToken)
        => AnswerOffTrack(cycleId, planId, OffTrackAnswer.AskForUpdate, cancellationToken);

    [HttpPost("plans/{planId:guid}/attention/talk-it-over")]
    public Task<ActionResult<ApiResponse<OffTrackAnsweredDto>>> TalkItOver(Guid cycleId, Guid planId, CancellationToken cancellationToken)
        => AnswerOffTrack(cycleId, planId, OffTrackAnswer.TalkItOver, cancellationToken);

    private async Task<ActionResult<ApiResponse<OffTrackAnsweredDto>>> AnswerOffTrack(Guid cycleId, Guid planId, OffTrackAnswer answer,
        CancellationToken cancellationToken)
    {
        if (!policy.CanReviewDirectReports(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new AnswerOffTrackCommand(cycleId, planId, answer, Actor, User.GetFullName()), cancellationToken));
    }

    [HttpGet("plans/{planId:guid}/update-requests")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<UpdateRequestDto>>>> UpdateRequests(Guid cycleId, Guid planId, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ListUpdateRequestsQuery(cycleId, planId, Actor), cancellationToken));
    }

    [HttpPost("~/api/performance/update-requests/{requestId:guid}/withdraw")]
    public async Task<ActionResult<ApiResponse<UpdateRequestDto>>> WithdrawUpdateRequest(Guid requestId, [FromBody] ExpectedVersionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new WithdrawUpdateRequestCommand(requestId, request.ExpectedVersion, Actor), cancellationToken));
    }
}
