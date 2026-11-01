using EY.HRPlatform.CoreHR.Features.Reports;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[Authorize]
[Route("api/corehr/reports")]
public sealed class ReportsController(ReportService reports, ReportEngine engine, IWorkforceAccessIdentityClient identity) : ControllerBase
{
    private ReportViewer Viewer => ReportViewer.From(User);
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => !Viewer.CanSee ? Forbid()
        : Ok(ApiResponse<IReadOnlyList<ReportSummaryDto>>.Success(await reports.ListAsync(Viewer, ct)));

    [HttpGet("fields")]
    public async Task<IActionResult> Fields(CancellationToken ct) => !Viewer.CanSee ? Forbid()
        : Ok(ApiResponse<IReadOnlyList<ReportFieldDto>>.Success(await engine.FieldsAsync(Viewer, ct)));

    [HttpGet("roles")]
    public async Task<IActionResult> Roles(CancellationToken ct) => !Viewer.CanSee || !Viewer.Build ? Forbid()
        : Ok(ApiResponse<IReadOnlyList<ReportRoleDto>>.Success(await identity.ReportRolesAsync(Viewer.UserId, ct)));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        if (!Viewer.CanSee) return Forbid();
        try
        {
            var report = await reports.GetAsync(id, Viewer, ct);
            return report is null ? NotFound() : Ok(ApiResponse<SavedReportDto>.Success(report));
        }
        catch (UnauthorizedAccessException) { return Forbid(); }
    }

    [HttpPost("run")]
    public async Task<IActionResult> Run([FromBody] ReportDefinition definition, CancellationToken ct)
    {
        if (!Viewer.CanSee) return Forbid();
        try { return Ok(ApiResponse<ReportRunDto>.Success(await engine.RunAsync(definition, Viewer, ct))); }
        catch (UnauthorizedAccessException) { return Forbid(); }
    }

    [HttpPost("export")]
    public async Task<IActionResult> Export([FromBody] ReportDefinition definition, [FromQuery] string format, CancellationToken ct)
    {
        if (!Viewer.CanSee) return Forbid();
        if (format is not ("csv" or "xlsx")) return BadRequest();
        try
        {
            var file = ReportService.Export(await engine.RunAsync(definition, Viewer, ct), format == "xlsx");
            return File(file.Bytes, file.ContentType, file.FileName);
        }
        catch (UnauthorizedAccessException) { return Forbid(); }
    }

    [HttpPost]
    public Task<IActionResult> Create([FromBody] SaveReportRequest request, CancellationToken ct) => Save(null, request, ct);
    [HttpPut("{id:guid}")]
    public Task<IActionResult> Update(Guid id, [FromBody] SaveReportRequest request, CancellationToken ct) => Save(id, request, ct);
    private async Task<IActionResult> Save(Guid? id, SaveReportRequest request, CancellationToken ct)
    {
        if (!Viewer.CanSee || !Viewer.Build) return Forbid();
        try
        {
            var report = await reports.SaveAsync(id, request, Viewer, ct);
            return report is null ? NotFound() : Ok(ApiResponse<SavedReportDto>.Success(report));
        }
        catch (UnauthorizedAccessException) { return Forbid(); }
    }

    [HttpPut("{id:guid}/share")]
    public async Task<IActionResult> Share(Guid id, [FromBody] ShareReportRequest request, CancellationToken ct)
    {
        if (!Viewer.CanSee || !Viewer.Build) return Forbid();
        return await reports.ShareAsync(id, request.RoleIds, Viewer, ct) ? Ok(ApiResponse.Success()) : NotFound();
    }
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        if (!Viewer.CanSee || !Viewer.Build) return Forbid();
        return await reports.DeleteAsync(id, Viewer, ct) ? Ok(ApiResponse.Success()) : NotFound();
    }
}
