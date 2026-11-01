using EY.HRPlatform.CoreHR.Features.CompanyImport;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

/// <summary>
/// The import (B-186): one session for any number of files. Bringing a company in creates units and people, so
/// every call needs both: managing the organization and importing people. Sessions belong to their tenant.
/// </summary>
[ApiController]
[Authorize]
[Route("api/corehr/imports")]
public sealed class CompanyImportController(CompanyImportService imports, ICoreAccessPolicyService access) : ControllerBase
{
    private const long UploadLimit = 12L * 11 * 1024 * 1024;

    private bool Allowed => access.CanManageOrganization(User) && access.CanImportEmployees(User);

    [HttpGet("active")]
    public async Task<ActionResult<ApiResponse<CompanyImportActiveDto>>> Active(CancellationToken cancellationToken)
    {
        if (!Allowed) return Forbid();
        return Ok(ApiResponse<CompanyImportActiveDto>.Success(new(await imports.ActiveAsync(cancellationToken))));
    }

    /// <summary>A workbook with a People and a Units sheet, headed the way Fusion reads them.</summary>
    [HttpGet("template")]
    public IActionResult Template()
    {
        if (!Allowed) return Forbid();
        var bytes = SimpleWorkbook.Build([
            new SimpleSheet("People", ["Employee number", "First name", "Last name", "Work email", "Job title", "Level", "Unit", "Manager", "Location", "Start date"], []),
            new SimpleSheet("Units", ["Code", "Name", "Parent", "Type", "Head"], []),
        ]);
        return File(bytes, SimpleWorkbook.ContentType, "Fusion-import-template.xlsx");
    }

    [HttpGet("earlier")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<CompanyImportEarlierDto>>>> Earlier(CancellationToken cancellationToken)
    {
        if (!Allowed) return Forbid();
        return Ok(ApiResponse<IReadOnlyList<CompanyImportEarlierDto>>.Success(await imports.EarlierAsync(cancellationToken)));
    }

    [HttpPost]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public Task<IActionResult> Start([FromForm] List<IFormFile> files, [FromForm] string? companyName, CancellationToken cancellationToken)
        => Run(async () =>
        {
            var id = await imports.StartAsync(Uploads(files), companyName, Actor(), cancellationToken);
            return await Read(id, cancellationToken);
        });

    [HttpGet("{id:guid}")]
    public Task<IActionResult> Get(Guid id, CancellationToken cancellationToken) => Run(() => Read(id, cancellationToken));

    [HttpPost("{id:guid}/files")]
    [RequestSizeLimit(UploadLimit)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadLimit)]
    public Task<IActionResult> AddFiles(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, [FromForm] List<IFormFile> files, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.AddFilesAsync(id, version, Uploads(files), cancellationToken), cancellationToken);

    [HttpDelete("{id:guid}/files/{fileId:guid}")]
    public Task<IActionResult> RemoveFile(Guid id, Guid fileId, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.RemoveFileAsync(id, version, fileId, cancellationToken), cancellationToken);

    [HttpPut("{id:guid}/columns")]
    public Task<IActionResult> SetColumn(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, [FromBody] SetColumnRequest request, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.SetColumnAsync(id, version, request, cancellationToken), cancellationToken);

    [HttpPut("{id:guid}/answers")]
    public Task<IActionResult> Answer(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, [FromBody] AnswerRequest request, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.AnswerAsync(id, version, request, cancellationToken), cancellationToken);

    [HttpPost("{id:guid}/leans")]
    public Task<IActionResult> TakeLeans(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.TakeLeansAsync(id, version, cancellationToken), cancellationToken);

    /// <summary>Reads a sentence as a fix; changes nothing. Null when Fusion can't place it.</summary>
    [HttpPost("{id:guid}/say")]
    public Task<IActionResult> Say(Guid id, [FromBody] SayRequest request, CancellationToken cancellationToken)
        => Run(async () => Ok(ApiResponse<CompanyImportSaid?>.Success(await imports.InterpretAsync(id, request.Text ?? string.Empty, cancellationToken))));

    [HttpPost("{id:guid}/fixes")]
    public Task<IActionResult> AddFix(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, [FromBody] AddFixRequest request, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.AddFixAsync(id, version, request, cancellationToken), cancellationToken);

    [HttpDelete("{id:guid}/fixes/{fixId}")]
    public Task<IActionResult> RemoveFix(Guid id, string fixId, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.RemoveFixAsync(id, version, fixId, cancellationToken), cancellationToken);

    [HttpPost("{id:guid}/bring-in")]
    public Task<IActionResult> BringIn(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, [FromBody] BringInRequest request, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.BringInAsync(id, version, request.Fingerprint ?? string.Empty, Actor(), cancellationToken), cancellationToken);

    [HttpPost("{id:guid}/discard")]
    public Task<IActionResult> Discard(Guid id, [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
        => Change(id, ifMatch, version => imports.DiscardAsync(id, version, cancellationToken), cancellationToken);

    private async Task<IActionResult> Read(Guid id, CancellationToken cancellationToken)
    {
        var dto = await imports.GetAsync(id, User.GetEmail(), cancellationToken);
        Response.Headers.ETag = $"\"{dto.Version}\"";
        return Ok(ApiResponse<CompanyImportDto>.Success(dto));
    }

    private Task<IActionResult> Change(Guid id, string? ifMatch, Func<uint, Task> change, CancellationToken cancellationToken)
        => Run(async () =>
        {
            if (!uint.TryParse(ifMatch?.Trim().Trim('"'), out var version))
                return BadRequest(ApiResponse.Failure("The import's current version is required."));
            await change(version);
            return await Read(id, cancellationToken);
        });

    private async Task<IActionResult> Run(Func<Task<IActionResult>> action)
    {
        if (!Allowed) return Forbid();
        try { return await action(); }
        catch (CompanyImportException exception)
        {
            var problem = new ProblemDetails { Status = exception.Status, Title = "Import", Detail = exception.Message };
            problem.Extensions["code"] = exception.Code;
            return StatusCode(exception.Status, problem);
        }
    }

    private static List<CompanyImportUpload> Uploads(List<IFormFile>? files)
        => (files ?? []).Select(file => new CompanyImportUpload(file.OpenReadStream(), file.FileName, file.ContentType)).ToList();

    private ImportActor Actor() => new(User.GetUserId(), User.GetFullName());
}
