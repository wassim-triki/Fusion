using System.Security.Claims;
using EY.HRPlatform.CoreHR.Features.Checklists;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Controllers;

public sealed record BirthdaySharingDto(bool Share, bool HasDate);
public sealed record BirthdaySharingRequest(bool Share);

/// <summary>
/// Joining and leaving checklists and the caller's birthday choice (B-184). Templates are people-data settings; a
/// person's checklist shows each viewer only the tasks they may see (<see cref="ChecklistService"/>). Everything is the
/// caller's tenant: the query filter hides other companies' rows, so their ids read as not found.
/// </summary>
[ApiController]
[Route("api/corehr")]
[Authorize]
public sealed class ChecklistsController(ChecklistService checklists, ICoreAccessPolicyService accessPolicy, CoreHRDbContext db) : ControllerBase
{
    public static ChecklistViewer Viewer(ClaimsPrincipal user, ICoreAccessPolicyService accessPolicy)
        => new(user.GetEmployeeId(), user.GetFullName(), accessPolicy.CanManageEmployees(user));

    [HttpGet("checklists/templates")]
    public async Task<ActionResult<ApiResponse<ChecklistTemplatesDto>>> GetTemplates(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewPeopleDataSettings(User)) return Forbid();
        return Ok(ApiResponse<ChecklistTemplatesDto>.Success(await checklists.TemplatesAsync(cancellationToken)));
    }

    [HttpPut("checklists/templates/{kind}")]
    public async Task<ActionResult<ApiResponse<ChecklistTemplatesDto>>> SaveTemplate(string kind, [FromBody] SaveChecklistTemplateRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManagePeopleDataSettings(User)) return Forbid();
        if (ChecklistService.ParseKind(kind) is not { } parsed) return NotFound();
        return Ok(ApiResponse<ChecklistTemplatesDto>.Success(
            await checklists.SaveTemplateAsync(parsed, request, User.GetFullName(), cancellationToken)));
    }

    [HttpGet("people/{employeeKey}/checklists")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<ChecklistDto>>>> ForPerson(string employeeKey, CancellationToken cancellationToken)
    {
        var result = await checklists.ForPersonAsync(employeeKey, Viewer(User, accessPolicy), cancellationToken);
        return result is null ? NotFound(ApiResponse<IReadOnlyList<ChecklistDto>>.Failure("Person not found."))
            : Ok(ApiResponse<IReadOnlyList<ChecklistDto>>.Success(result));
    }

    [HttpPut("checklists/tasks/{taskId:guid}")]
    public async Task<ActionResult<ApiResponse<ChecklistTaskDto>>> SetDone(Guid taskId, [FromBody] SetChecklistTaskRequest request,
        CancellationToken cancellationToken)
    {
        var (outcome, task) = await checklists.SetDoneAsync(taskId, request.Done, Viewer(User, accessPolicy), cancellationToken);
        return outcome switch
        {
            ChecklistService.TickOutcome.NotFound => NotFound(ApiResponse<ChecklistTaskDto>.Failure("Task not found.")),
            ChecklistService.TickOutcome.Forbidden => Forbid(),
            _ => Ok(ApiResponse<ChecklistTaskDto>.Success(task!)),
        };
    }

    [HttpGet("me/birthday")]
    public async Task<ActionResult<ApiResponse<BirthdaySharingDto>>> GetBirthday(CancellationToken cancellationToken)
    {
        if (User.GetEmployeeId() is not { } employeeId) return NotFound();
        var me = await db.Employees.AsNoTracking().FirstOrDefaultAsync(item => item.Id == employeeId, cancellationToken);
        return me is null ? NotFound() : Ok(ApiResponse<BirthdaySharingDto>.Success(new BirthdaySharingDto(me.SharesBirthday, me.DateOfBirth is not null)));
    }

    /// <summary>Only the person decides whether colleagues see their birthday.</summary>
    [HttpPut("me/birthday")]
    public async Task<ActionResult<ApiResponse<BirthdaySharingDto>>> SetBirthday([FromBody] BirthdaySharingRequest request, CancellationToken cancellationToken)
    {
        if (User.GetEmployeeId() is not { } employeeId) return NotFound();
        var me = await db.Employees.FirstOrDefaultAsync(item => item.Id == employeeId, cancellationToken);
        if (me is null) return NotFound();
        me.SetBirthdaySharing(request.Share);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<BirthdaySharingDto>.Success(new BirthdaySharingDto(me.SharesBirthday, me.DateOfBirth is not null)));
    }
}
