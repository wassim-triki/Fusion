using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Performance.Controllers;

/// <summary>Peer input: who the manager asks (Fusion picks first, D-40), suggestions, and the peer's own request.</summary>
[ApiController]
[Authorize]
[Route("api/performance")]
public sealed class PeerInputController(IMediator mediator, IPerformanceAccessPolicyService policy) : PerformanceControllerBase
{
    /// <summary>The manager changes who is asked (D-40): the whole list as it should stand.</summary>
    [HttpPut("reviews/{reviewId:guid}/peers")]
    public async Task<ActionResult<ApiResponse<ReviewPeersDto>>> Change(Guid reviewId, [FromBody] ChangePeersRequest request, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new ChangePeersCommand(reviewId, Employee(), policy.CanReviewDirectReports(User), request), token));
    }

    [HttpGet("reviews/{reviewId:guid}/peer-suggestions")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<PeerSuggestionDto>>>> Suggestions(Guid reviewId, CancellationToken token)
    {
        if (!policy.CanEnterPerformance(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetPeerSuggestionsQuery(reviewId, Employee(), policy.CanReviewDirectReports(User)), token));
    }

    [HttpGet("peer-requests/{requestId:guid}")]
    public async Task<ActionResult<ApiResponse<PeerRequestDto>>> Get(Guid requestId, CancellationToken token)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new GetPeerRequestQuery(requestId, Employee()), token));
    }

    [HttpPut("peer-requests/{requestId:guid}")]
    public async Task<ActionResult<ApiResponse<PeerRequestDto>>> Save(Guid requestId, [FromBody] PeerAnswersRequest request, CancellationToken token)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SavePeerAnswersCommand(requestId, Employee(), request), token));
    }

    [HttpPost("peer-requests/{requestId:guid}/send")]
    public async Task<ActionResult<ApiResponse<PeerRequestDto>>> Send(Guid requestId, [FromBody] PeerAnswersRequest request, CancellationToken token)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new SendPeerAnswersCommand(requestId, Employee(), request), token));
    }

    [HttpPost("peer-requests/{requestId:guid}/decline")]
    public async Task<ActionResult<ApiResponse<PeerRequestDto>>> Decline(Guid requestId, [FromBody] DeclinePeerRequestRequest request, CancellationToken token)
    {
        if (!policy.CanManageOwnParticipation(User)) return CapabilityForbidden();
        return MapResult(await mediator.Send(new DeclinePeerRequestCommand(requestId, Employee(), request), token));
    }

    private Guid Employee() => User.GetEmployeeId() ?? Guid.Empty;
}
