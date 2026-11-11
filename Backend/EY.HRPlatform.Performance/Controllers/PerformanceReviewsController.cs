using EY.HRPlatform.Performance.Features.Ai;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EY.HRPlatform.Performance.Controllers;

[ApiController]
[Authorize]
[Route("api/performance/reviews")]
public sealed class PerformanceReviewsController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    [HttpGet("history")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewHistoryItemDto>>>> History(Guid? cycleId, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User) && !policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewHistoryQuery(cycleId, User.GetEmployeeId() ?? Guid.Empty,
            policy.CanAdministerCycles(User), policy.CanReviewDirectReports(User)), token));
    }

    [HttpGet("workspace")]
    public async Task<ActionResult<ApiResponse<ReviewsWorkspaceDto>>> Workspace(Guid? cycle, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User) && !policy.CanAdministerCycles(User) && !policy.CanCalibrateReviews(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewsWorkspaceQuery(cycle, new ReviewsWorkspaceViewer(User.GetEmployeeId() ?? Guid.Empty,
            policy.CanManageOwnParticipation(User), policy.CanReviewDirectReports(User), policy.CanAdministerCycles(User),
            User.GetUserId(), policy.CanCalibrateReviews(User))), token));
    }

    /// <summary>Each readable person's step in the active review rounds, for Core HR's org chart lens.</summary>
    [HttpGet("progress")]
    public async Task<ActionResult<ApiResponse<ReviewProgressDto>>> Progress(CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User) && !policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewProgressQuery(new ReviewActor(User.GetEmployeeId() ?? Guid.Empty,
            policy.CanAdministerCycles(User), CanReviewReports: policy.CanReviewDirectReports(User))), token));
    }

    [HttpGet("{reviewId:guid}")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewDto>>> Get(Guid reviewId, CancellationToken token)
    {
        var calibrates = policy.CanCalibrateReviews(User);
        if (!policy.CanEnterPerformance(User) && !policy.CanAdministerCycles(User) && !calibrates) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetPerformanceReviewQuery(reviewId,
            new ReviewActor(User.GetEmployeeId() ?? Guid.Empty, policy.CanAdministerCycles(User),
                CalibratorUserId: calibrates ? User.GetUserId() : null,
                CanParticipate: policy.CanManageOwnParticipation(User),
                CanReviewReports: policy.CanReviewDirectReports(User))), token));
    }

    [HttpPut("{reviewId:guid}/self-assessment")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewMutationDto>>> SaveSelf(Guid reviewId,
        [FromBody] SaveSelfAssessmentRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SaveSelfAssessmentCommand(reviewId, AssessmentActor(),
            request.ExpectedVersion, request.Summary, request.Items) { OverallRating = request.OverallRating, Answers = request.Answers }, token));
    }

    [HttpPost("{reviewId:guid}/self-assessment")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewMutationDto>>> SubmitSelf(Guid reviewId,
        [FromBody] SaveSelfAssessmentRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SubmitSelfAssessmentCommand(reviewId, AssessmentActor(),
            request.ExpectedVersion, request.Summary, request.Items) { OverallRating = request.OverallRating, Answers = request.Answers }, token));
    }

    [HttpPut("{reviewId:guid}/manager-assessment")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewMutationDto>>> SaveManager(Guid reviewId,
        [FromBody] SaveManagerAssessmentRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SaveManagerAssessmentCommand(reviewId, AssessmentActor(),
            request.ExpectedVersion, request.Summary, request.OverallRating, request.Items) { Potential = request.Potential, Answers = request.Answers }, token));
    }

    [HttpPost("{reviewId:guid}/manager-assessment")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewMutationDto>>> SubmitManager(Guid reviewId,
        [FromBody] SaveManagerAssessmentRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SubmitManagerAssessmentCommand(reviewId, AssessmentActor(),
            request.ExpectedVersion, request.Summary, request.OverallRating, request.Items) { Potential = request.Potential, Answers = request.Answers }, token));
    }

    /// <summary>An AI draft for the review being written (W4, W5). Saves nothing; the client hides the block on any failure or 429.</summary>
    [HttpPost("{reviewId:guid}/draft")]
    [EnableRateLimiting(ReviewDraftVersions.RateLimitPolicy)]
    public async Task<ActionResult<ApiResponse<ReviewDraftDto>>> Draft(Guid reviewId, [FromBody] ReviewDraftRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new RunReviewDraftCommand(reviewId, request, AssessmentActor()), token));
    }

    /// <summary>The person's year beside the review, numbered as drafts cite it (H3); the person's lens or the reviewer's.</summary>
    [HttpGet("{reviewId:guid}/year")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewYearItemDto>>>> Year(Guid reviewId, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetReviewYearQuery(reviewId, AssessmentActor()), token));
    }

    [HttpPost("{reviewId:guid}/self-assessment/take-back")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewMutationDto>>> TakeBack(Guid reviewId, CancellationToken token)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new TakeBackSelfAssessmentCommand(reviewId, User.GetEmployeeId() ?? Guid.Empty), token));
    }

    /// <summary>The reviewer nudges the person (<c>self</c>) or the colleagues who haven't answered (<c>peers</c>), D-60.</summary>
    [HttpPost("{reviewId:guid}/nudge")]
    public async Task<ActionResult<ApiResponse<ReviewNudgeDto>>> Nudge(Guid reviewId, [FromBody] ReviewNudgeRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new NudgeForReviewCommand(reviewId, User.GetEmployeeId() ?? Guid.Empty,
            policy.CanReviewDirectReports(User), User.GetFullName(), request.Who), token));
    }

    /// <summary>"Talk it over in our 1:1": the released review goes on the next 1:1's agenda with the manager.</summary>
    [HttpPost("{reviewId:guid}/talk-it-over")]
    public async Task<ActionResult<ApiResponse<ReviewTalkDto>>> TalkItOver(Guid reviewId, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new TalkItOverCommand(reviewId, User.GetEmployeeId() ?? Guid.Empty), token));
    }

    [HttpPost("{reviewId:guid}/acknowledgement-comment")]
    public async Task<ActionResult<ApiResponse<ReviewAcknowledgementDto>>> AcknowledgementComment(Guid reviewId,
        [FromBody] AcknowledgementCommentRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CommentOnAcknowledgementCommand(reviewId, User.GetEmployeeId() ?? Guid.Empty, request.Comment), token));
    }

    [HttpPut("{reviewId:guid}/manager-summary")]
    public async Task<ActionResult<ApiResponse<ReviewSummaryStateDto>>> ReviseSummary(Guid reviewId,
        [FromBody] ReviseReviewSummaryRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ReviseReviewSummaryCommand(reviewId, AssessmentActor(), request.Summary, request.ExpectedVersion), token));
    }

    [HttpPost("{reviewId:guid}/summary-checked")]
    public async Task<ActionResult<ApiResponse<ReviewSummaryStateDto>>> SummaryChecked(Guid reviewId, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new MarkReviewSummaryCheckedCommand(reviewId, AssessmentActor()), token));
    }

    [HttpPost("{reviewId:guid}/finalize")]
    public async Task<ActionResult<ApiResponse<ReviewFinalizationDto>>> Finalize(Guid reviewId, [FromBody] FinalizeReviewRequest request, CancellationToken token)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new FinalizeReviewCommand(reviewId, request.ExpectedVersion, User.GetEmployeeId() ?? Guid.Empty), token));
    }

    [HttpGet("{reviewId:guid}/pdf")]
    public async Task<IActionResult> Pdf(Guid reviewId, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User) && !policy.CanAdministerCycles(User)) return CapabilityForbidden();
        var result = await mediator.Send(new DownloadReviewPdfCommand(reviewId, new ReviewActor(User.GetEmployeeId() ?? Guid.Empty,
            policy.CanAdministerCycles(User), CanParticipate: policy.CanManageOwnParticipation(User),
            CanReviewReports: policy.CanReviewDirectReports(User))), token);
        if (result.IsFailure) return MapResult(result).Result!;
        return File(result.Value.Content, "application/pdf", result.Value.FileName);
    }

    [HttpPost("{reviewId:guid}/acknowledge")]
    public async Task<ActionResult<ApiResponse<ReviewAcknowledgementDto>>> Acknowledge(Guid reviewId, [FromBody] AcknowledgeReviewRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new AcknowledgeReviewCommand(reviewId, User.GetEmployeeId() ?? Guid.Empty, request.Comment), token));
    }

    [HttpPost("{reviewId:guid}/due-date")]
    public async Task<ActionResult<ApiResponse<ReviewDueDateMoveDto>>> MoveDueDate(Guid reviewId, [FromBody] MoveReviewDueDateRequest request, CancellationToken token)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new MoveReviewDueDateCommand(reviewId, request,
            new ScheduleActor(User.GetEmployeeId(), User.GetFullName())), token));
    }

    [HttpPost("{reviewId:guid}/close")]
    public async Task<ActionResult<ApiResponse<PerformanceReviewMutationDto>>> Close(Guid reviewId,
        [FromBody] CloseReviewRequest request, CancellationToken token)
    {
        if (!policy.CanAdministerCycles(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CloseReviewCommand(reviewId, request.ExpectedVersion, request.Reason), token));
    }

    private ReviewActor AssessmentActor()
        => new(User.GetEmployeeId() ?? Guid.Empty, policy.CanAdministerCycles(User),
            CanParticipate: policy.CanManageOwnParticipation(User),
            CanReviewReports: policy.CanReviewDirectReports(User));
}
