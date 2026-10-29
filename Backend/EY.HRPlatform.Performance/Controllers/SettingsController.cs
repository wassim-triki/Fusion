using EY.HRPlatform.Performance.Features.Notifications;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Notifications;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

[ApiController]
[Authorize]
[Route("api/performance/settings")]
public sealed class SettingsController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<CycleSettingsDto>>> Get(CancellationToken cancellationToken)
    {
        if (!policy.CanViewSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetCycleSettingsQuery(), cancellationToken));
    }

    /// <summary>The caller's settings sections (B-071 D1): empty when they can't view Performance settings.</summary>
    [HttpGet("sections")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<FusionSettingsSectionDto>>>> Sections(CancellationToken cancellationToken)
    {
        var access = policy.CanManageSettings(User) ? FusionSettingsSectionDto.Manage
            : policy.CanViewSettings(User) ? FusionSettingsSectionDto.View
            : null;
        return MapResult(await mediator.Send(new GetSettingsSectionsQuery(access), cancellationToken));
    }

    [HttpPut]
    public async Task<ActionResult<ApiResponse<CycleSettingsDto>>> Update(
        [FromBody] UpdateCycleSettingsRequest request,
        CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateCycleSettingsCommand(request), cancellationToken));
    }

    /// <summary>The company's email mode per Performance notification group (B-002 N7).</summary>
    [HttpGet("notifications")]
    public async Task<ActionResult<ApiResponse<NotificationDefaultsDto>>> GetNotificationDefaults(CancellationToken cancellationToken)
    {
        if (!policy.CanViewSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetNotificationDefaultsQuery(), cancellationToken));
    }

    [HttpPut("notifications")]
    public async Task<ActionResult<ApiResponse<NotificationDefaultsDto>>> UpdateNotificationDefaults(
        [FromBody] UpdateNotificationDefaultsRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateNotificationDefaultsCommand(request), cancellationToken));
    }

    [HttpGet("rating-scale")]
    public async Task<ActionResult<ApiResponse<RatingScaleDto>>> GetRatingScale(CancellationToken cancellationToken)
    {
        if (!policy.CanViewSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetRatingScaleQuery(), cancellationToken));
    }

    [HttpPut("rating-scale")]
    public async Task<ActionResult<ApiResponse<RatingScaleDto>>> UpdateRatingScale(
        [FromBody] UpdateRatingScaleRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateRatingScaleCommand(request), cancellationToken));
    }

    [HttpGet("competencies")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<CompetencyDto>>>> ListCompetencies(CancellationToken cancellationToken)
    {
        if (!policy.CanViewSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ListCompetenciesQuery(), cancellationToken));
    }

    [HttpPost("competencies")]
    public async Task<ActionResult<ApiResponse<CompetencyDto>>> CreateCompetency([FromBody] CreateCompetencyRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CreateCompetencyCommand(request), cancellationToken));
    }

    [HttpPut("competencies/{id:guid}")]
    public async Task<ActionResult<ApiResponse<CompetencyDto>>> UpdateCompetency(Guid id, [FromBody] UpdateCompetencyRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateCompetencyCommand(id, request), cancellationToken));
    }

    [HttpPost("competencies/{id:guid}/archive")]
    public async Task<ActionResult<ApiResponse<CompetencyDto>>> ArchiveCompetency(Guid id, [FromBody] CompetencyVersionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ArchiveCompetencyCommand(id, request), cancellationToken));
    }

    [HttpGet("review-questions")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewQuestionDto>>>> ListReviewQuestions(CancellationToken cancellationToken)
    {
        if (!policy.CanViewSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ListReviewQuestionsQuery(), cancellationToken));
    }

    [HttpPost("review-questions")]
    public async Task<ActionResult<ApiResponse<ReviewQuestionDto>>> CreateReviewQuestion([FromBody] CreateReviewQuestionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new CreateReviewQuestionCommand(request), cancellationToken));
    }

    [HttpPut("review-questions/order")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ReviewQuestionDto>>>> ReorderReviewQuestions([FromBody] ReorderReviewQuestionsRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ReorderReviewQuestionsCommand(request), cancellationToken));
    }

    [HttpPut("review-questions/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ReviewQuestionDto>>> UpdateReviewQuestion(Guid id, [FromBody] UpdateReviewQuestionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new UpdateReviewQuestionCommand(id, request), cancellationToken));
    }

    [HttpPost("review-questions/{id:guid}/archive")]
    public async Task<ActionResult<ApiResponse<ReviewQuestionDto>>> ArchiveReviewQuestion(Guid id, [FromBody] ReviewQuestionVersionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ArchiveReviewQuestionCommand(id, request), cancellationToken));
    }

    [HttpDelete("review-questions/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteReviewQuestion(Guid id, [FromBody] ReviewQuestionVersionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new DeleteReviewQuestionCommand(id, request), cancellationToken));
    }

    [HttpDelete("competencies/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteCompetency(Guid id, [FromBody] CompetencyVersionRequest request, CancellationToken cancellationToken)
    {
        if (!policy.CanManageSettings(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new DeleteCompetencyCommand(id, request), cancellationToken));
    }
}
