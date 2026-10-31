using System.Security.Claims;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

/// <summary>The invite sheet (D-11): who, when, and what is planned. Workforce access rights decide every call.</summary>
[ApiController]
[Route("api/corehr/employees/people/invitations")]
[Authorize]
public class PeopleInvitationsController(
    PeopleInvitations invitations,
    IWorkforceContractService workforce,
    ICoreAccessPolicyService accessPolicy) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<InvitationPlanDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPlan(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewAccess(User)) return Forbid();
        return Ok(ApiResponse<InvitationPlanDto>.Success(await invitations.PlanAsync(cancellationToken)));
    }

    [HttpPost]
    [ProducesResponseType(typeof(ApiResponse<SendInvitationsResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Send([FromBody] SendInvitationsRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User)) return Forbid();
        if (request is null || !Enum.IsDefined(request.Audience))
            return BadRequest(ApiResponse.Failure("Choose who the invitations go to."));

        // Chosen people resolve in the caller's own scope; anyone they can't see is left out.
        var chosen = request.Audience == InvitationAudience.Chosen
            ? await workforce.ResolveEmployeesAsync(
                (request.EmployeeIds ?? []).Where(id => id != Guid.Empty).Distinct().Take(InvitationSchedule.MaxChosen + 1).ToArray(),
                User, cancellationToken)
            : null;
        if (chosen is { Count: 0 }) return BadRequest(ApiResponse.Failure("Choose at least one person."));
        try
        {
            var result = await invitations.SendAsync(request, chosen, Actor(), cancellationToken);
            return Ok(ApiResponse<SendInvitationsResultDto>.Success(result));
        }
        catch (ArgumentException exception)
        {
            return BadRequest(ApiResponse.Failure(exception.Message));
        }
    }

    [HttpDelete("{scheduleId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Cancel(Guid scheduleId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User)) return Forbid();
        return await invitations.CancelAsync(scheduleId, Actor(), cancellationToken)
            ? NoContent()
            : NotFound(ApiResponse.Failure("Those invitations were already sent or canceled."));
    }

    /// <summary>Who planned it, as the sheet shows it.</summary>
    private string Actor()
        => User.FindFirstValue(CustomClaimTypes.FullName) ?? User.FindFirstValue(ClaimTypes.Email) ?? "Unknown user";
}
