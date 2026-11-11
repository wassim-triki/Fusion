using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Features.Conversations;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>Public praise tagged with a company value (D-14): everyone in Performance reads it; the author or HR removes it.</summary>
[ApiController]
[Authorize]
[Route("api/performance/praise")]
public sealed class PraiseController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    private PraiseActor Actor => new(User.GetEmployeeId() ?? Guid.Empty, policy.CanAdministerCycles(User));
    private bool Entered => policy.CanEnterPerformance(User);
    private bool AsPerson => Entered && User.GetEmployeeId() is Guid id && id != Guid.Empty;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<PraisePageDto>>> List([FromQuery] PraiseScope scope = PraiseScope.All, [FromQuery] Guid? employeeId = null,
        [FromQuery] string? before = null, [FromQuery] int limit = 10, CancellationToken cancellationToken = default)
        => Entered ? MapResult(await mediator.Send(new ListPraiseQuery(scope, employeeId, before, limit, Actor), cancellationToken)) : CapabilityForbidden();

    /// <summary>This week's count for the wall, each value's count this month, and the caller's received and given counts.</summary>
    [HttpGet("summary")]
    public async Task<ActionResult<ApiResponse<PraiseSummaryDto>>> Summary(CancellationToken cancellationToken)
        => Entered ? MapResult(await mediator.Send(new GetPraiseSummaryQuery(Actor.EmployeeId), cancellationToken)) : CapabilityForbidden();

    /// <summary>The company's values, the list praise names (D-36); a company that never had any starts with the starters.</summary>
    [HttpGet("~/api/performance/values")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<CompanyValueDto>>>> Values(CancellationToken cancellationToken)
        => Entered ? MapResult(await mediator.Send(new ListCompanyValuesQuery(), cancellationToken)) : CapabilityForbidden();

    [HttpGet("{praiseId:guid}")]
    public async Task<ActionResult<ApiResponse<PraiseDetailDto>>> Get(Guid praiseId, CancellationToken cancellationToken)
        => Entered ? MapResult(await mediator.Send(new GetPraiseQuery(praiseId, Actor), cancellationToken)) : CapabilityForbidden();

    [HttpPost]
    public async Task<ActionResult<ApiResponse<PraiseDto>>> Give([FromBody] GivePraiseRequest request, CancellationToken cancellationToken)
        => AsPerson ? MapResult(await mediator.Send(new GivePraiseCommand(request, Actor), cancellationToken)) : CapabilityForbidden();

    [HttpPut("{praiseId:guid}/reactions/{kind}")]
    public async Task<ActionResult<ApiResponse<PraiseDto>>> React(Guid praiseId, PraiseReactionKind kind, CancellationToken cancellationToken)
        => AsPerson ? MapResult(await mediator.Send(new ReactToPraiseCommand(praiseId, kind, true, Actor), cancellationToken)) : CapabilityForbidden();

    [HttpDelete("{praiseId:guid}/reactions/{kind}")]
    public async Task<ActionResult<ApiResponse<PraiseDto>>> Unreact(Guid praiseId, PraiseReactionKind kind, CancellationToken cancellationToken)
        => AsPerson ? MapResult(await mediator.Send(new ReactToPraiseCommand(praiseId, kind, false, Actor), cancellationToken)) : CapabilityForbidden();

    [HttpDelete("{praiseId:guid}")]
    public async Task<ActionResult<ApiResponse>> Delete(Guid praiseId, CancellationToken cancellationToken)
        => Entered ? MapResult(await mediator.Send(new DeletePraiseCommand(praiseId, Actor), cancellationToken)) : CapabilityForbidden();
}
