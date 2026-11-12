using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
[Route("internal/corehr/workforce/snapshots")]
public sealed class InternalWorkforceSnapshotsController(
    IInternalServiceRequestAuthorizer authorizer,
    IInternalWorkforceSnapshotService workforceSnapshotService) : ControllerBase
{
    [HttpPost("org-units/resolve")]
    public async Task<ActionResult<IReadOnlyList<InternalOrgUnitSnapshotDto>>> ResolveOrgUnits(
        [FromBody] InternalOrgUnitResolveRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.ResolveOrgUnitsAsync(
            request.AsOf,
            request.OrgUnitIds,
            cancellationToken));
    }

    [HttpPost("resolve")]
    public async Task<ActionResult<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>>> ResolveEmployees(
        [FromBody] InternalWorkforceEmployeeResolveRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.ResolveEmployeesAsync(
            request.AsOf,
            request.EmployeeIds,
            cancellationToken));
    }

    [HttpPost("by-scope")]
    public async Task<ActionResult<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>>> GetEmployeesByScope(
        [FromBody] InternalWorkforceEmployeesByScopeRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.GetEmployeesByScopeAsync(
            request.AsOf,
            request.OrgUnitIds,
            request.IncludeDescendants,
            request.IncludeInactive,
            cancellationToken));
    }

    [HttpPost("all-active")]
    public async Task<ActionResult<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>>> GetAllActive(
        [FromBody] InternalWorkforceAllActiveRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.GetAllActiveAsOfAsync(
            request.AsOf,
            request.IncludeInactive,
            cancellationToken));
    }

    [HttpPost("direct-reports")]
    public async Task<ActionResult<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>>> GetDirectReports(
        [FromBody] InternalWorkforceDirectReportsRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.GetDirectReportsAsync(
            request.AsOf,
            request.ManagerEmployeeIds ?? [],
            cancellationToken));
    }

    [HttpPost("job-catalogue")]
    public async Task<ActionResult<InternalJobCatalogueDto>> GetJobCatalogue(CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.GetJobCatalogueAsync(cancellationToken));
    }

    [HttpPost("search")]
    public async Task<ActionResult<IReadOnlyList<InternalWorkforceEmployeeSnapshotDto>>> Search(
        [FromBody] InternalWorkforceSearchRequest request,
        CancellationToken cancellationToken)
    {
        if (!await authorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        return Ok(await workforceSnapshotService.SearchActiveAsync(
            request.AsOf,
            request.Term ?? string.Empty,
            request.Limit,
            cancellationToken));
    }
}
