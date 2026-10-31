using System.Security.Claims;
using EY.HRPlatform.CoreHR.Features.OrgChart;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[Route("api/corehr/org-chart")]
[Authorize]
public sealed class OrgChartController(
    ISender sender,
    ICoreAccessPolicyService accessPolicy,
    ITenantSettingsReadService tenantSettings) : ControllerBase
{
    /// <summary>
    /// The people org chart as of a date (today by default), shaped for the caller: Tenant scope sees everyone,
    /// DirectReports scope sees its own chain and branch with the rest folded into counts. Another date than today
    /// is for HR only, since future moves and exits are confidential. Above 3,000 people, or with a root, a window
    /// comes back: the root's chain to the top and its branch to a depth, the rest folded into loadable counts. A tenant
    /// that shows the chart to managers and HR only narrows everyone else (<see cref="Chart"/>).
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<OrgChartDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(
        [FromQuery] DateOnly? asOf, [FromQuery] string? root, [FromQuery] int? depth, CancellationToken cancellationToken)
    {
        if (await Chart(asOf, cancellationToken) is not { } chart) return Forbid();
        if (depth is < 1 or > OrgChartQuery.MaxDepth)
            return BadRequest(ApiResponse.Failure($"Give a depth from 1 to {OrgChartQuery.MaxDepth}."));

        var result = await sender.Send(
            new OrgChartQuery(chart.AsOf, chart.Scope, User.GetEmployeeId(), chart.Hr, string.IsNullOrWhiteSpace(root) ? null : root,
                depth ?? OrgChartQuery.DefaultDepth),
            cancellationToken);
        return result.IsFailure ? NotFound(ApiResponse.Failure(result.Error.Message)) : Ok(ApiResponse<OrgChartDto>.Success(result.Value));
    }

    /// <summary>People on the chart whose name, or job title or unit as the caller sees them, contains the text: at most eight.</summary>
    [HttpGet("search")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<OrgChartPersonDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] DateOnly? asOf, CancellationToken cancellationToken)
    {
        if (await Chart(asOf, cancellationToken) is not { } chart) return Forbid();

        var result = await sender.Send(new OrgChartSearchQuery(chart.AsOf, chart.Scope, User.GetEmployeeId(), chart.Hr, q ?? ""), cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<OrgChartPersonDto>>.Success(result.Value));
    }

    /// <summary>
    /// Every unit's people, head and open roles as of a date (today by default): the Organization's Structure and List
    /// views. Needs Organization view; another date than today is for HR only, like the chart. Heads come back only to
    /// those who see the whole company's chart.
    /// </summary>
    [HttpGet("staffing")]
    [ProducesResponseType(typeof(ApiResponse<OrganizationStaffingDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetStaffing([FromQuery] DateOnly? asOf, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        var hr = accessPolicy.CanViewTenantEmployees(User);
        var date = asOf ?? DateOnly.FromDateTime(DateTime.UtcNow);
        if (date != DateOnly.FromDateTime(DateTime.UtcNow) && !hr) return Forbid();

        var withHeads = await Chart(date, cancellationToken) is { Scope: OrgChartScopes.Tenant };
        var result = await sender.Send(new OrganizationStaffingQuery(date, withHeads, hr), cancellationToken);
        return Ok(ApiResponse<OrganizationStaffingDto>.Success(result.Value));
    }

    /// <summary>
    /// A unit's page as of a date: its head, everyone in it and under it, its open roles. Needs Organization view and
    /// the whole company's chart; another date than today is for HR only.
    /// </summary>
    [HttpGet("units/{id:guid}")]
    [ProducesResponseType(typeof(ApiResponse<OrganizationUnitPeopleDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetUnit(Guid id, [FromQuery] DateOnly? asOf, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        if (await Chart(asOf, cancellationToken) is not { Scope: OrgChartScopes.Tenant } chart) return Forbid();

        var result = await sender.Send(new OrganizationUnitPeopleQuery(id, chart.AsOf, chart.Hr), cancellationToken);
        return result.IsFailure ? NotFound(ApiResponse.Failure(result.Error.Message)) : Ok(ApiResponse<OrganizationUnitPeopleDto>.Success(result.Value));
    }

    /// <summary>
    /// The caller's chart scope and date, or null when they may not read the chart on that date. When the tenant shows
    /// the chart to managers and HR only, people who read the whole workforce keep their scope, managers see their own
    /// chain and branch, and nobody else sees it.
    /// </summary>
    private async Task<(DateOnly AsOf, string Scope, bool Hr)?> Chart(DateOnly? asOf, CancellationToken cancellationToken)
    {
        var scope = accessPolicy.GetOrgChartScope(User);
        if (scope is null) return null;

        var hr = accessPolicy.CanViewTenantEmployees(User);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (asOf is { } date && date != today && !hr) return null;
        if (!hr)
        {
            var settings = await tenantSettings.GetCurrentAsync(cancellationToken);
            if (settings.OrgChart.Audience == OrgChartAudiences.ManagersAndHr)
            {
                if (!accessPolicy.CanViewTeam(User)) return null;
                scope = PermissionScopes.DirectReports;
            }
        }
        return (asOf ?? today, scope == PermissionScopes.Tenant ? OrgChartScopes.Tenant : OrgChartScopes.DirectReports, hr);
    }

    /// <summary>
    /// Joins, leavers and manager moves dated within a window of up to two years, both days included: the upcoming
    /// cards and badges on HR's time bar. HR only, like any date other than today.
    /// </summary>
    [HttpGet("changes")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<OrgChartChangeDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetChanges([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken cancellationToken)
    {
        if (accessPolicy.GetOrgChartScope(User) is null || !accessPolicy.CanViewTenantEmployees(User)) return Forbid();
        if (from is not { } start || to is not { } end || end < start || end.DayNumber - start.DayNumber > MaxChangeWindowDays)
            return BadRequest(ApiResponse.Failure("Give a window that ends on or after its start and spans two years at most."));

        var result = await sender.Send(new OrgChartChangesQuery(start, end), cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<OrgChartChangeDto>>.Success(result.Value));
    }

    /// <summary>Adds an open role under a manager: a dashed Hiring card in their line. People admins only.</summary>
    [HttpPost("open-roles")]
    [ProducesResponseType(typeof(ApiResponse<OrgChartOpenRoleDto>), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> CreateOpenRole([FromBody] OpenRoleRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User)) return Forbid();

        var result = await sender.Send(new CreateOpenRoleCommand(request, AuditActor()), cancellationToken);
        return result.IsFailure
            ? OpenRoleFailure(result.Error)
            : StatusCode(StatusCodes.Status201Created, ApiResponse<OrgChartOpenRoleDto>.Success(result.Value));
    }

    /// <summary>Edits an open role: title, manager, unit, target start and status (Filled or Closed take it off the chart).</summary>
    [HttpPut("open-roles/{id:guid}")]
    [ProducesResponseType(typeof(ApiResponse<OrgChartOpenRoleDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateOpenRole(Guid id, [FromBody] OpenRoleRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User)) return Forbid();

        var result = await sender.Send(new UpdateOpenRoleCommand(id, request, AuditActor()), cancellationToken);
        return result.IsFailure ? OpenRoleFailure(result.Error) : Ok(ApiResponse<OrgChartOpenRoleDto>.Success(result.Value));
    }

    private IActionResult OpenRoleFailure(EY.HRPlatform.SharedKernel.Results.Error error)
        => error.Code == OpenRoleErrors.NotFoundCode
            ? NotFound(ApiResponse.Failure(error.Message))
            : BadRequest(ApiResponse.Failure(error.Message));

    private string AuditActor()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var name = User.FindFirstValue(CustomClaimTypes.FullName) ?? User.FindFirstValue(ClaimTypes.Email) ?? "Unknown user";
        return $"{id}|{name}";
    }

    private const int MaxChangeWindowDays = 731;
}
