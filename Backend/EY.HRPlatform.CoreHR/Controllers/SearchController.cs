using EY.HRPlatform.CoreHR.Features.Reports;
using EY.HRPlatform.CoreHR.Features.Search;
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
[Route("api/corehr/search")]
[Authorize]
public sealed class SearchController(ISender sender, ICoreAccessPolicyService accessPolicy, ITenantSettingsReadService tenantSettings) : ControllerBase
{
    /// <summary>
    /// The top bar's search over Core HR (B-211): people as the directory shows them, their teams and places, jobs for
    /// HR, saved reports the caller may open. Empty text brings the caller's own people. Needs the directory's right.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<CoreSearchDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Search([FromQuery] string? q, CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null) return Forbid();

        var result = await sender.Send(
            new CoreSearchQuery(q ?? "", User.GetEmployeeId(), accessPolicy.CanViewTenantEmployees(User), ReportViewer.From(User)),
            cancellationToken);
        return result.IsFailure
            ? BadRequest(ApiResponse.Failure(result.Error.Message))
            : Ok(ApiResponse<CoreSearchDto>.Success(result.Value with { OrgChart = await ShowsOrgChartAsync(cancellationToken) }));
    }

    /// <summary>The org chart's own rule for today: a chart grant, narrowed to managers and HR when the company says so.</summary>
    private async Task<bool> ShowsOrgChartAsync(CancellationToken cancellationToken)
    {
        if (accessPolicy.GetOrgChartScope(User) is null) return false;
        if (accessPolicy.CanViewTenantEmployees(User)) return true;
        var settings = await tenantSettings.GetCurrentAsync(cancellationToken);
        return settings.OrgChart.Audience != OrgChartAudiences.ManagersAndHr || accessPolicy.CanViewTeam(User);
    }
}
