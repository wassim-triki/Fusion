using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[Route("api/corehr/organization")]
[Authorize]
public sealed class OrganizationController(
    IOrganizationService organizationService,
    ICoreAccessPolicyService accessPolicy) : ControllerBase
{
    /// <summary>The structure on a date as a workbook the import reads back: code, name, type and parent per unit.</summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] DateOnly asOf, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        var hierarchy = await organizationService.GetHierarchyAsync(asOf, cancellationToken);
        if (hierarchy.Roots.Count == 0) return NotFound(ApiResponse.Failure("There is no structure on this date."));
        var units = new List<OrganizationUnitStateDto>();
        void Walk(OrganizationHierarchyNodeDto node) { units.Add(node.Unit); foreach (var child in node.Children) Walk(child); }
        foreach (var root in hierarchy.Roots) Walk(root);
        var codes = units.ToDictionary(unit => unit.Id, unit => unit.Code);
        var bytes = SimpleWorkbook.Build([new SimpleSheet("Units", ["Code", "Name", "Type", "Parent"],
            units.Select(unit => (IReadOnlyList<string?>)[unit.Code, unit.Name, unit.TypeName,
                unit.ParentId is { } parent && codes.TryGetValue(parent, out var code) ? code : null]).ToList())]);
        return File(bytes, SimpleWorkbook.ContentType, $"Fusion-organization-{asOf:yyyy-MM-dd}.xlsx");
    }

    [HttpGet("hierarchy")]
    public async Task<ActionResult<ApiResponse<OrganizationHierarchyDto>>> GetHierarchy(
        [FromQuery] DateOnly asOf,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        return Ok(ApiResponse<OrganizationHierarchyDto>.Success(
            await organizationService.GetHierarchyAsync(asOf, cancellationToken)));
    }

    [HttpGet("units/{id:guid}")]
    public async Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> GetUnit(
        Guid id, [FromQuery] DateOnly asOf, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        var result = await organizationService.GetUnitAsync(id, asOf, cancellationToken);
        SetEtag(result.Version);
        return Ok(ApiResponse<OrganizationUnitStateDto>.Success(result));
    }

    [HttpGet("search")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<OrganizationUnitStateDto>>>> Search(
        [FromQuery] string query, [FromQuery] DateOnly asOf, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<OrganizationUnitStateDto>>.Success(
            await organizationService.SearchAsync(query, asOf, cancellationToken)));
    }

    [HttpGet("changes/upcoming")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<OrganizationChangeDto>>>> GetUpcomingChanges(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<OrganizationChangeDto>>.Success(
            await organizationService.GetUpcomingChangesAsync(cancellationToken)));
    }

    [HttpGet("units/{id:guid}/history")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<OrganizationChangeDto>>>> GetHistory(Guid id, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<OrganizationChangeDto>>.Success(
            await organizationService.GetHistoryAsync(id, cancellationToken)));
    }

    [HttpGet("readiness")]
    public async Task<ActionResult<ApiResponse<OrganizationReadinessDto>>> GetReadiness(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        return Ok(ApiResponse<OrganizationReadinessDto>.Success(
            await organizationService.GetReadinessAsync(cancellationToken)));
    }

    [HttpGet("types")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<OrganizationalUnitTypeDto>>>> GetTypes(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOrganization(User)) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<OrganizationalUnitTypeDto>>.Success(
            await organizationService.GetTypesAsync(cancellationToken)));
    }

    [HttpPost("root")]
    public async Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> CreateRoot(
        [FromBody] CreateOrganizationRootRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        var result = await organizationService.CreateRootAsync(request, cancellationToken);
        SetEtag(result.Version);
        return CreatedAtAction(nameof(GetUnit), new { id = result.Id, asOf = request.EffectiveDate }, ApiResponse<OrganizationUnitStateDto>.Success(result));
    }

    [HttpPost("units")]
    public async Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> CreateUnit(
        [FromBody] CreateOrganizationUnitRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        var result = await organizationService.CreateUnitAsync(request, cancellationToken);
        SetEtag(result.Version);
        return CreatedAtAction(nameof(GetUnit), new { id = result.Id, asOf = request.EffectiveDate }, ApiResponse<OrganizationUnitStateDto>.Success(result));
    }

    [HttpPost("units/{id:guid}/change")]
    public Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> Change(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody] ChangeOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, ifMatch, () => organizationService.ChangeAsync(id, RequiredVersion(ifMatch), request, cancellationToken));

    [HttpPost("units/{id:guid}/move")]
    public Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> Move(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody] MoveOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, ifMatch, () => organizationService.MoveAsync(id, RequiredVersion(ifMatch), request, cancellationToken));

    [HttpPost("units/{id:guid}/inactivate")]
    public Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> Inactivate(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody] InactivateOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, ifMatch, () => organizationService.InactivateAsync(id, RequiredVersion(ifMatch), request, cancellationToken));

    [HttpPost("units/{id:guid}/correct")]
    public Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> Correct(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody] CorrectOrganizationUnitRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, ifMatch, () => organizationService.CorrectAsync(id, RequiredVersion(ifMatch), request, cancellationToken));

    [HttpPost("units/{id:guid}/correct-code")]
    public Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> CorrectCode(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody] CorrectOrganizationCodeRequest request, CancellationToken cancellationToken)
        => MutateAsync(id, ifMatch, () => organizationService.CorrectCodeAsync(id, RequiredVersion(ifMatch), request, cancellationToken));

    [HttpPost("changes/{changeId:guid}/cancel")]
    public async Task<IActionResult> CancelChange(Guid changeId, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        if (!TryParseVersion(ifMatch, out var orgUnitVersion))
            return StatusCode(StatusCodes.Status412PreconditionFailed, ApiResponse.Failure("If-Match header with a valid version is required."));
        await organizationService.CancelChangeAsync(changeId, orgUnitVersion, cancellationToken);
        return NoContent();
    }

    [HttpPost("types")]
    public async Task<ActionResult<ApiResponse<OrganizationalUnitTypeDto>>> CreateType([FromBody] CreateOrganizationalUnitTypeRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        return Ok(ApiResponse<OrganizationalUnitTypeDto>.Success(await organizationService.CreateTypeAsync(request, cancellationToken)));
    }

    [HttpPut("types/{id:guid}")]
    public async Task<ActionResult<ApiResponse<OrganizationalUnitTypeDto>>> RenameType(Guid id, [FromBody] RenameOrganizationalUnitTypeRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        return Ok(ApiResponse<OrganizationalUnitTypeDto>.Success(await organizationService.RenameTypeAsync(id, request, cancellationToken)));
    }

    [HttpDelete("types/{id:guid}")]
    public async Task<IActionResult> DeleteType(Guid id, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        await organizationService.DeleteTypeAsync(id, cancellationToken);
        return NoContent();
    }

    private async Task<ActionResult<ApiResponse<OrganizationUnitStateDto>>> MutateAsync(Guid id, string? ifMatch, Func<Task<OrganizationUnitStateDto>> mutation)
    {
        if (!accessPolicy.CanManageOrganization(User)) return Forbid();
        if (!TryParseVersion(ifMatch, out _))
            return StatusCode(StatusCodes.Status412PreconditionFailed, ApiResponse.Failure("If-Match header with a valid version is required."));
        var result = await mutation();
        SetEtag(result.Version);
        return Ok(ApiResponse<OrganizationUnitStateDto>.Success(result));
    }

    private static uint RequiredVersion(string? ifMatch)
        => TryParseVersion(ifMatch, out var version) ? version : throw new InvalidOperationException("If-Match must be validated before use.");

    private static bool TryParseVersion(string? ifMatch, out uint version)
        => uint.TryParse(ifMatch?.Trim().Trim('"'), out version);

    private void SetEtag(uint version) => Response.Headers.ETag = $"\"{version}\"";
}
