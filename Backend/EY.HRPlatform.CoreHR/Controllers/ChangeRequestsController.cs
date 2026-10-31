using System.Security.Claims;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

/// <summary>
/// Changes and approvals (B-179, D-15/D-16): describe and draft a change, propose it (HR's own and changes of a type
/// the company doesn't ask approval for apply at once), approve or decline it with a reason, withdraw your own, and the
/// company's approval settings. Who may do what is decided here from the caller's claims and again in the service.
/// </summary>
[ApiController]
[Authorize]
[Route("api/corehr/changes")]
public sealed class ChangeRequestsController(
    ChangeRequestService requests,
    ChangeDrafter drafter,
    ICoreAccessPolicyService accessPolicy,
    Features.TenantSettings.Services.ISettingsAuditService audit) : ControllerBase
{
    [HttpGet("approvals")]
    public async Task<IActionResult> GetApprovals(CancellationToken cancellationToken)
    {
        if (User.GetTenantId() is null)
            return Forbid();
        return Ok(ApiResponse<ChangeApprovalSettingsDto>.Success(
            await requests.SettingsAsync(User.GetEmployeeId(), accessPolicy.CanManagePeopleDataSettings(User), cancellationToken)));
    }

    [HttpPut("approvals")]
    public async Task<IActionResult> UpdateApprovals([FromBody] UpdateChangeApprovalsRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManagePeopleDataSettings(User))
            return Forbid();
        var before = (await requests.RequiredTypesAsync(cancellationToken)).Order(StringComparer.Ordinal).ToList();
        var result = await requests.UpdateSettingsAsync(request.Required ?? [], Actor().Audit, User.GetEmployeeId(), cancellationToken);
        if (result.IsSuccess)
        {
            var after = result.Value.Types.Where(type => type.Required).Select(type => type.Type).ToList();
            await audit.RecordAsync(Features.TenantSettings.Dtos.SettingsSectionIds.Approvals, "Update", "ChangeApprovals", null,
                after.Count == 0 ? "Turned approval off for every change." : $"Approval now needed for: {string.Join(", ", after)}.",
                before, after, User, cancellationToken);
        }
        return Respond(result);
    }

    /// <summary>Reads a sentence into picks from the company's jobs, units, places and reasons. Saves nothing.</summary>
    [HttpPost("people/{employeeKey}/draft")]
    public async Task<IActionResult> Draft(string employeeKey, [FromBody] DraftChangeRequest request, CancellationToken cancellationToken)
    {
        var actor = Actor();
        if (!actor.ManagesPeople && !actor.Proposes)
            return Forbid();
        if (string.IsNullOrWhiteSpace(request.Text) || request.Text.Length > ChangeDrafter.MaxTextLength)
            return BadRequest(ApiResponse.Failure($"Describe the change in up to {ChangeDrafter.MaxTextLength} characters."));
        var subject = await requests.SubjectForAsync(employeeKey, actor, cancellationToken);
        if (subject.IsFailure)
            return Failure(subject.Error);
        return Ok(ApiResponse<ChangeDraftDto>.Success(await drafter.DraftAsync(subject.Value, request.Text, cancellationToken)));
    }

    [HttpPost("people/{employeeKey}/propose")]
    public async Task<IActionResult> Propose(string employeeKey, [FromBody] ProposeChangeRequest request, CancellationToken cancellationToken)
    {
        var actor = Actor();
        if (!actor.ManagesPeople && !actor.Proposes)
            return Forbid();
        return Respond(await requests.ProposeAsync(employeeKey, request, actor, cancellationToken));
    }

    /// <summary>Waiting (default) or answered requests: every one for approvers, your own otherwise.</summary>
    [HttpGet("requests")]
    public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? employeeKey, CancellationToken cancellationToken)
    {
        if (User.GetTenantId() is null)
            return Forbid();
        var pending = !string.Equals(status, "decided", StringComparison.OrdinalIgnoreCase);
        return Ok(ApiResponse<IReadOnlyList<ChangeRequestDto>>.Success(
            await requests.ListAsync(Actor(), pending, employeeKey, cancellationToken)));
    }

    [HttpGet("requests/{requestId:guid}")]
    public async Task<IActionResult> Get(Guid requestId, CancellationToken cancellationToken)
        => Respond(await requests.GetAsync(requestId, Actor(), cancellationToken));

    [HttpPost("requests/{requestId:guid}/approve")]
    public async Task<IActionResult> Approve(Guid requestId, CancellationToken cancellationToken)
    {
        var actor = Actor();
        if (!actor.Approves)
            return Forbid();
        return Respond(await requests.ApproveAsync(requestId, actor, cancellationToken));
    }

    [HttpPost("requests/{requestId:guid}/decline")]
    public async Task<IActionResult> Decline(Guid requestId, [FromBody] DeclineChangeRequestBody body, CancellationToken cancellationToken)
    {
        var actor = Actor();
        if (!actor.Approves)
            return Forbid();
        return Respond(await requests.DeclineAsync(requestId, body.Reason, actor, cancellationToken));
    }

    [HttpPost("requests/{requestId:guid}/withdraw")]
    public async Task<IActionResult> Withdraw(Guid requestId, CancellationToken cancellationToken)
        => Respond(await requests.WithdrawAsync(requestId, Actor(), cancellationToken));

    private ChangeActor Actor() => new(
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ? userId.ToString() : "",
        User.GetEmployeeId(),
        User.FindFirstValue(CustomClaimTypes.FullName) ?? User.FindFirstValue(ClaimTypes.Email) ?? "Someone",
        accessPolicy.CanManageEmployees(User),
        accessPolicy.CanProposeChanges(User),
        accessPolicy.CanApproveChanges(User));

    private IActionResult Respond<T>(Result<T> result)
        => result.IsFailure ? Failure(result.Error) : Ok(ApiResponse<T>.Success(result.Value));

    private ObjectResult Failure(Error error) => error.Code switch
    {
        ChangeRequestService.ForbiddenCode or WorkforceChangeService.ForbiddenCode
            => StatusCode(StatusCodes.Status403Forbidden, ApiResponse.Failure(error.Message)),
        ChangeRequestService.ConflictCode => Conflict(ApiResponse.Failure(error.Message)),
        _ when error.Code.EndsWith(".NotFound", StringComparison.Ordinal) => NotFound(ApiResponse.Failure(error.Message)),
        _ when error.Code.Contains("Conflict", StringComparison.OrdinalIgnoreCase) => Conflict(ApiResponse.Failure(error.Message)),
        _ => BadRequest(ApiResponse.Failure(error.Message)),
    };
}
