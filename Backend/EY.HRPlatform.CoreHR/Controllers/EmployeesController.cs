using System.Security.Claims;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeByKey;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeById;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployees;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeReportingLines;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeReportingLinesByKey;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetWorkforceReadinessSummary;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.EmployeeFields;
using EY.HRPlatform.CoreHR.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using ApiResponse = EY.HRPlatform.SharedKernel.Api.ApiResponse;
using ApiResponseOfEmployeeDetailsDto = EY.HRPlatform.SharedKernel.Api.ApiResponse<EY.HRPlatform.CoreHR.Features.Employees.Dtos.EmployeeDetailsDto>;
using ApiResponseOfPagedEmployeeList = EY.HRPlatform.SharedKernel.Api.ApiResponse<EY.HRPlatform.CoreHR.Models.Responses.PagedResponse<EY.HRPlatform.CoreHR.Features.Employees.Dtos.EmployeeListItemDto>>;
using ApiResponseOfEmployeeReportingLinesDto = EY.HRPlatform.SharedKernel.Api.ApiResponse<EY.HRPlatform.CoreHR.Features.Employees.Dtos.EmployeeReportingLinesDto>;
using ApiResponseOfWorkforceReadinessSummaryDto = EY.HRPlatform.SharedKernel.Api.ApiResponse<EY.HRPlatform.CoreHR.Features.Employees.Dtos.WorkforceReadinessSummaryDto>;
using ApiResponseOfPeoplePageDto = EY.HRPlatform.SharedKernel.Api.ApiResponse<EY.HRPlatform.CoreHR.Features.People.PeoplePageDto>;
using ApiResponseOfPeopleProfileDto = EY.HRPlatform.SharedKernel.Api.ApiResponse<EY.HRPlatform.CoreHR.Features.People.PeopleProfileDto>;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[Route("api/corehr/employees")]
[Authorize]
public class EmployeesController(
    ISender sender,
    ICoreAccessPolicyService accessPolicy,
    EmployeeFieldService? employeeFields = null) : ControllerBase
{
    [HttpPost("hire")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentResultDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> Hire(
        [FromBody] HireEmployeeRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await sender.Send(
            new HireEmployeeCommand(request, GetAuditActor(), accessPolicy.CanManageAccess(User)),
            cancellationToken);
        if (result.IsFailure)
            return MapEmployeeMutationFailure(result.Error);

        Response.Headers.Location = $"/core/people/{result.Value.EmployeeKey}";
        return StatusCode(
            StatusCodes.Status201Created,
            EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentResultDto>.Success(result.Value));
    }

    [HttpPost("add-existing")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentResultDto>), StatusCodes.Status201Created)]
    public async Task<IActionResult> AddExisting(
        [FromBody] AddExistingEmployeeRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await sender.Send(
            new AddExistingEmployeeCommand(request, GetAuditActor(), accessPolicy.CanManageAccess(User)),
            cancellationToken);
        if (result.IsFailure)
            return MapEmployeeMutationFailure(result.Error);

        Response.Headers.Location = $"/core/people/{result.Value.EmployeeKey}";
        return StatusCode(
            StatusCodes.Status201Created,
            EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentResultDto>.Success(result.Value));
    }

    /// <summary>What Add a person shows around the form: the manager's unit, team and open roles on the first day, and the company's required fields, joining checklist and invitation rule.</summary>
    [HttpGet("people/hiring-context")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<HiringContextDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetHiringContext(
        [FromServices] HiringContextReader reader,
        [FromQuery] Guid? managerId,
        [FromQuery] DateOnly? on,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await reader.ReadAsync(
            managerId, on ?? DateOnly.FromDateTime(DateTime.UtcNow), accessPolicy.CanManageAccess(User), cancellationToken);
        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<HiringContextDto>.Success(result));
    }

    [HttpPost("people/establishment-review")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentReviewDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ReviewEstablishment(
        [FromBody] EstablishmentReviewRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await sender.Send(new EstablishmentReviewQuery(request), cancellationToken);
        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentReviewDto>.Success(result.Value));
    }

    /// <summary>Bounded canonical People roster.</summary>
    [HttpGet("people")]
    [ProducesResponseType(typeof(ApiResponseOfPeoplePageDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPeople(
        [FromQuery] string? q,
        [FromQuery] PeopleEmploymentState? state,
        [FromQuery] Guid? orgUnitId,
        [FromQuery] PeopleOrganizationScope organizationScope = PeopleOrganizationScope.Subtree,
        [FromQuery] PeopleSortField sort = PeopleSortField.Name,
        [FromQuery] PeopleSortDirection direction = PeopleSortDirection.Asc,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] Guid? importBatch = null,
        [FromQuery] PeopleView? view = null,
        [FromQuery] Guid? jobId = null,
        [FromQuery] Guid? placeId = null,
        [FromQuery] string? manager = null,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
            return Forbid();

        var result = await sender.Send(
            new PeopleQuery(q, state, orgUnitId, organizationScope, sort, direction, page, pageSize, importBatch,
                view, jobId, placeId, manager, FieldFilters(), IncludeSignIn: accessPolicy.CanViewAccess(User)),
            cancellationToken);
        return Ok(ApiResponseOfPeoplePageDto.Success(result.Value));
    }

    /// <summary>People as filtered, as CSV or Excel: the table's rows, with sign-in only for who may see access.</summary>
    [HttpGet("people/export")]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    public async Task<IActionResult> ExportPeople(
        [FromServices] PeopleExport export,
        [FromQuery] PeopleExportFormat format = PeopleExportFormat.Csv,
        [FromQuery] string? q = null,
        [FromQuery] Guid? orgUnitId = null,
        [FromQuery] PeopleOrganizationScope organizationScope = PeopleOrganizationScope.Subtree,
        [FromQuery] PeopleSortField sort = PeopleSortField.Name,
        [FromQuery] PeopleSortDirection direction = PeopleSortDirection.Asc,
        [FromQuery] PeopleView? view = null,
        [FromQuery] Guid? jobId = null,
        [FromQuery] Guid? placeId = null,
        [FromQuery] string? manager = null,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
            return Forbid();

        var fields = FieldFilters();
        var includeSignIn = accessPolicy.CanViewAccess(User);
        var result = await sender.Send(
            new PeopleQuery(q, null, orgUnitId, organizationScope, sort, direction, 1, 1, null,
                view, jobId, placeId, manager, fields, includeSignIn, Unpaged: true),
            cancellationToken);
        var file = await export.BuildAsync(result.Value.Items, includeSignIn, format, cancellationToken);
        return File(file.Bytes, file.ContentType, file.FileName);
    }

    /// <summary>The directory (D-28): everyone in the company as any colleague sees them.</summary>
    [HttpGet("people/directory")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<PeopleDirectoryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPeopleDirectory(CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null)
            return Forbid();

        var result = await sender.Send(new PeopleDirectoryQuery(User.GetEmployeeId()), cancellationToken);
        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<PeopleDirectoryDto>.Success(result.Value));
    }

    [HttpGet("people/{employeeKey}")]
    [ProducesResponseType(typeof(ApiResponseOfPeopleProfileDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetPeopleProfile(
        string employeeKey,
        [FromQuery] DateTime? asOf,
        CancellationToken cancellationToken)
    {
        // Any worker in the tenant may open a colleague's profile; the audience
        // controls how much is projected. Cross-tenant keys are excluded by the
        // DbContext tenant filter and surface as NotFound.
        var audience = accessPolicy.GetEmployeeReadAudience(User);
        if (accessPolicy.GetEmployeeViewScope(User) is null)
            return Forbid();

        // Temporal as-of exploration is a manager/HR affordance, not a colleague one. A manager is one for their
        // own branch only; a missing employee id gives an empty branch, so it fails closed.
        var effectiveAsOf = audience == EmployeeReadAudience.Employee ? null : asOf;
        Guid? branchOf = audience == EmployeeReadAudience.Manager ? User.GetEmployeeId() ?? Guid.Empty : null;
        var result = await sender.Send(
            new PeopleProfileQuery(employeeKey, effectiveAsOf, audience, branchOf, User.GetEmployeeId(), accessPolicy.GetPersonalGrant(User), BranchScope()),
            cancellationToken);
        if (result.IsFailure)
            return NotFound(ApiResponse.Failure("Employee was not found."));

        Response.Headers.ETag = $"\"{result.Value.Version}\"";
        return Ok(ApiResponseOfPeopleProfileDto.Success(result.Value));
    }

    [HttpGet("people/{employeeKey}/fields")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<IReadOnlyList<EmployeeProfileFieldDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetEmployeeFields(string employeeKey, CancellationToken cancellationToken)
    {
        var audience = accessPolicy.GetEmployeeReadAudience(User);
        if (accessPolicy.GetEmployeeViewScope(User) is null) return Forbid();
        var profile = await sender.Send(new PeopleProfileQuery(
            employeeKey, null, audience,
            audience == EmployeeReadAudience.Manager ? User.GetEmployeeId() ?? Guid.Empty : null,
            User.GetEmployeeId(), accessPolicy.GetPersonalGrant(User), BranchScope()), cancellationToken);
        if (profile.IsFailure) return NotFound(ApiResponse.Failure("Employee was not found."));
        var fields = await employeeFields!.ProfileFieldsAsync(
            profile.Value.Identity.EmployeeId, audience, User.GetEmployeeId(), accessPolicy.CanManageEmployees(User), cancellationToken, BranchScope());
        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<IReadOnlyList<EmployeeProfileFieldDto>>.Success(fields));
    }

    [HttpPut("people/{employeeKey}/fields/{fieldKey}")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<EmployeeProfileFieldDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> PutEmployeeField(
        string employeeKey,
        string fieldKey,
        [FromBody] UpdateEmployeeFieldValueRequest request,
        CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null) return Forbid();
        var result = await employeeFields!.UpdateValueAsync(
            employeeKey,
            fieldKey,
            request.Value,
            accessPolicy.GetEmployeeReadAudience(User),
            User.GetEmployeeId(),
            accessPolicy.CanManageEmployees(User),
            GetAuditActor(),
            cancellationToken,
            BranchScope());
        if (result.IsSuccess)
            return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<EmployeeProfileFieldDto>.Success(result.Value));
        return result.Error.Code switch
        {
            "Employee.NotFound" or "EmployeeField.NotFound" => NotFound(ApiResponse.Failure(result.Error.Message)),
            "EmployeeField.Forbidden" => Forbid(),
            _ => BadRequest(ApiResponse.Failure(result.Error.Message)),
        };
    }

    /// <summary>Bounded business Upcoming preview and Timeline for an employee.</summary>
    [HttpGet("people/{employeeKey}/timeline")]
    public async Task<IActionResult> GetPeopleTimeline(
        string employeeKey,
        CancellationToken cancellationToken)
    {
        // History is a manager/HR view, not part of the colleague directory projection. A manager without
        // tenant-wide People access sees it for their own branch only; everyone reads their own (B-180).
        Guid? branchOf = null;
        var self = User.GetEmployeeId();
        if (!accessPolicy.CanViewTenantEmployees(User))
        {
            if (self is not { } me || !(accessPolicy.CanViewTeam(User) || accessPolicy.CanViewOwnProfile(User)))
                return Forbid();
            branchOf = accessPolicy.CanViewTeam(User) ? me : Guid.Empty;
        }

        var result = await sender.Send(new PeopleTimelineQuery(employeeKey, branchOf, self, BranchScope()), cancellationToken);
        if (result.IsFailure)
            return NotFound(ApiResponse.Failure("Employee was not found."));

        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<PeopleTimelineDto>.Success(result.Value));
    }

    /// <summary>
    /// Change job: any mix of manager, unit, title and location on one date, with what happens to the team.
    /// Reporting admins may change only the manager and the team.
    /// </summary>
    [HttpPost("people/{employeeKey}/changes/job")]
    public async Task<IActionResult> ChangeJob(
        string employeeKey,
        [FromBody] JobChangeRequest request,
        CancellationToken cancellationToken)
    {
        var canManageEmployees = accessPolicy.CanManageEmployees(User);
        if (!canManageEmployees && !accessPolicy.CanManageReporting(User))
            return Forbid();

        var result = await sender.Send(
            new JobChangeCommand(employeeKey, request, GetAuditActor(), canManageEmployees), cancellationToken);
        return ChangeResult(result);
    }

    /// <summary>Who reports to someone ending employment, where they go by default, and the dotted lines that end.</summary>
    [HttpGet("people/{employeeKey}/changes/end-employment/preview")]
    public async Task<IActionResult> PreviewEndEmploymentChange(
        string employeeKey,
        [FromQuery] DateOnly lastDay,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await sender.Send(new EndEmploymentChangePreviewQuery(employeeKey, lastDay), cancellationToken);
        return ChangeResult(result);
    }

    /// <summary>Ends employment on the last day; each report goes to a named manager (the leaver's by default).</summary>
    [HttpPost("people/{employeeKey}/changes/end-employment")]
    public async Task<IActionResult> EndEmploymentChange(
        string employeeKey,
        [FromBody] EndEmploymentChangeRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await sender.Send(new EndEmploymentChangeCommand(employeeKey, request, GetAuditActor()), cancellationToken);
        return ChangeResult(result);
    }

    /// <summary>Starts employment again for a former employee.</summary>
    [HttpPost("people/{employeeKey}/changes/join")]
    public async Task<IActionResult> JoinChange(
        string employeeKey,
        [FromBody] JoinChangeRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        var result = await sender.Send(new JoinChangeCommand(employeeKey, request, GetAuditActor()), cancellationToken);
        return ChangeResult(result);
    }

    /// <summary>Cancels a person's latest change, from today on; every row it touched goes back.</summary>
    [HttpPost("people/changes/{changeId:guid}/cancel")]
    public async Task<IActionResult> CancelChange(Guid changeId, CancellationToken cancellationToken)
    {
        var canManageEmployees = accessPolicy.CanManageEmployees(User);
        if (!canManageEmployees && !accessPolicy.CanManageReporting(User))
            return Forbid();

        var result = await sender.Send(new CancelWorkforceChangeCommand(changeId, GetAuditActor(), canManageEmployees), cancellationToken);
        return result.IsFailure ? MapChangeFailure(result.Error) : NoContent();
    }

    /// <summary>Replaces a scheduled change with a new one of the same kind, in one step.</summary>
    [HttpPut("people/changes/{changeId:guid}")]
    public async Task<IActionResult> EditChange(
        Guid changeId,
        [FromBody] EditChangeRequest request,
        CancellationToken cancellationToken)
    {
        var canManageEmployees = accessPolicy.CanManageEmployees(User);
        if (!canManageEmployees && !accessPolicy.CanManageReporting(User))
            return Forbid();

        var result = await sender.Send(new EditWorkforceChangeCommand(changeId, request, GetAuditActor(), canManageEmployees), cancellationToken);
        return ChangeResult(result);
    }

    /// <summary>Changes coming from today: the whole tenant for People viewers, a manager's branch for managers.</summary>
    [HttpGet("people/changes/upcoming")]
    public async Task<IActionResult> GetUpcomingChanges(CancellationToken cancellationToken)
    {
        Guid? branchOf = null;
        if (!accessPolicy.CanViewTenantEmployees(User))
        {
            if (!accessPolicy.CanViewTeam(User) || User.GetEmployeeId() is not { } managerId)
                return Forbid();
            branchOf = managerId;
        }

        var result = await sender.Send(new UpcomingWorkforceChangesQuery(branchOf), cancellationToken);
        return ChangeResult(result);
    }

    private IActionResult ChangeResult<T>(EY.HRPlatform.SharedKernel.Results.Result<T> result)
        => result.IsFailure
            ? MapChangeFailure(result.Error)
            : Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<T>.Success(result.Value));

    private IActionResult MapChangeFailure(EY.HRPlatform.SharedKernel.Results.Error error)
        => error.Code == WorkforceChangeService.ForbiddenCode
            ? StatusCode(StatusCodes.Status403Forbidden, ApiResponse.Failure(error.Message))
            : MapEmployeeMutationFailure(error);

    /// <summary>Adds a dotted-line manager from the effective date, beside the primary chain.</summary>
    [HttpPost("people/{employeeKey}/dotted-lines")]
    public Task<IActionResult> AddDottedLine(
        string employeeKey,
        [FromBody] DottedLineRequest request,
        CancellationToken cancellationToken)
        => ChangeDottedLine(employeeKey, request, end: false, cancellationToken);

    /// <summary>Ends a dotted-line manager on the effective date.</summary>
    [HttpPost("people/{employeeKey}/dotted-lines/end")]
    public Task<IActionResult> EndDottedLine(
        string employeeKey,
        [FromBody] DottedLineRequest request,
        CancellationToken cancellationToken)
        => ChangeDottedLine(employeeKey, request, end: true, cancellationToken);

    private async Task<IActionResult> ChangeDottedLine(
        string employeeKey, DottedLineRequest request, bool end, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User) && !accessPolicy.CanManageReporting(User))
            return Forbid();

        var result = await sender.Send(
            new DottedLineCommand(employeeKey, request.EffectiveDate, request.ManagerEmployeeId, end, GetAuditActor()),
            cancellationToken);
        if (result.IsFailure)
            return MapEmployeeMutationFailure(result.Error);

        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<MaintenanceResultDto>.Success(result.Value));
    }

    /// <summary>
    /// People someone can report to on a date. With <paramref name="forEmployee"/>, leaves out that person, their own
    /// branch (a cycle) and their current manager.
    /// </summary>
    [HttpGet("people/manager-options")]
    public async Task<IActionResult> GetManagerOptions(
        [FromQuery] DateTime effectiveDate,
        [FromQuery] string? q,
        [FromQuery] Guid? excludeEmployeeId,
        [FromQuery] Guid? forEmployee,
        [FromQuery] int limit = 30,
        CancellationToken cancellationToken = default)
    {
        // Proposers pick a new manager when they describe a change for their team (B-179).
        if (!accessPolicy.CanManageEmployees(User) && !accessPolicy.CanManageReporting(User) && !accessPolicy.CanProposeChanges(User))
            return Forbid();

        var result = await sender.Send(
            new ManagerOptionsQuery(effectiveDate, q, excludeEmployeeId, limit, forEmployee),
            cancellationToken);
        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<IReadOnlyList<ManagerOptionDto>>.Success(result.Value));
    }

    [HttpGet("people/{employeeKey}/access-status")]
    public async Task<IActionResult> GetPeopleAccessStatus(
        string employeeKey,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
            return Forbid();

        var result = await sender.Send(new PeopleAccessStatusQuery(employeeKey), cancellationToken);
        if (result.IsFailure)
            return NotFound(ApiResponse.Failure("Employee was not found."));
        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<PeopleAccessStatusDto>.Success(result.Value));
    }

    /// <summary>Updates the canonical work email through the People identity surface.</summary>
    [HttpPut("people/{employeeKey}/work-email")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status412PreconditionFailed)]
    public async Task<IActionResult> UpdatePeopleWorkEmail(
        string employeeKey,
        [FromBody] UpdateWorkEmailRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
            return Forbid();

        if (!TryParseVersion(ifMatch, out var expectedVersion))
        {
            return StatusCode(
                StatusCodes.Status412PreconditionFailed,
                ApiResponse.Failure("If-Match header with valid version is required for updates."));
        }

        var result = await sender.Send(
            new UpdateWorkEmailCommand(employeeKey, expectedVersion, request.WorkEmail, GetAuditActor()),
            cancellationToken);
        if (result.IsFailure)
            return MapEmployeeMutationFailure(result.Error);

        Response.Headers.ETag = $"\"{result.Value.Version}\"";
        return NoContent();
    }

    /// <summary>The company's field filters, sent as <c>fields[key]=value</c>.</summary>
    private Dictionary<string, string>? FieldFilters()
    {
        var fields = (HttpContext?.Request.Query ?? new Microsoft.AspNetCore.Http.QueryCollection())
            .Where(pair => pair.Key.StartsWith("fields[", StringComparison.Ordinal) && pair.Key.EndsWith(']') && pair.Key.Length > 8)
            .ToDictionary(pair => pair.Key[7..^1], pair => pair.Value.ToString());
        return fields.Count == 0 ? null : fields;
    }

    private string GetAuditActor()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var name = User.FindFirstValue(CustomClaimTypes.FullName)
            ?? User.FindFirstValue(ClaimTypes.Email)
            ?? "Unknown user";
        return $"{id}|{name}";
    }

    /// <summary>
    /// List employees with optional search, status filtering, sorting, and pagination.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponseOfPagedEmployeeList), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? search,
        [FromQuery] EmployeeStatus? status,
        [FromQuery] EmployeeAccessFilter? access,
        [FromQuery] EmployeeReadinessFilter? readiness,
        [FromQuery] Guid? orgUnitId,
        [FromQuery] string? orgUnitCode,
        [FromQuery] Guid? managerId,
        [FromQuery] EmployeeSortField sortBy = EmployeeSortField.Name,
        [FromQuery] SortDirection sortDir = SortDirection.Asc,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
        {
            return Forbid();
        }

        var query = new GetEmployeesQuery(search, status, access, readiness, orgUnitId, orgUnitCode, managerId, sortBy, sortDir, page, pageSize);
        var result = await sender.Send(query, cancellationToken);

        if (result.IsFailure)
        {
            return NotFound(ApiResponse.Failure(result.Error.Message));
        }

        return Ok(ApiResponseOfPagedEmployeeList.Success(result.Value));
    }

    [HttpGet("readiness-summary")]
    [ProducesResponseType(typeof(ApiResponseOfWorkforceReadinessSummaryDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetReadinessSummary(CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
        {
            return Forbid();
        }

        var result = await sender.Send(new GetWorkforceReadinessSummaryQuery(), cancellationToken);
        return Ok(ApiResponseOfWorkforceReadinessSummaryDto.Success(result.Value));
    }

    /// <summary>
    /// Get an employee by stable public key (visible URLs use this).
    /// </summary>
    [HttpGet("by-key/{employeeKey}")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetByKey(string employeeKey, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
        {
            return Forbid();
        }

        var result = await sender.Send(new GetEmployeeByKeyQuery(employeeKey), cancellationToken);

        if (result.IsFailure)
        {
            return NotFound(ApiResponse.Failure(result.Error.Message));
        }

        Response.Headers.ETag = $"\"{result.Value.Version}\"";

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(WithPersonalReach(result.Value)));
    }

    /// <summary>
    /// Get an employee by ID.
    /// </summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(Guid id, CancellationToken cancellationToken)
    {
        if (!CanViewEmployeeDetails(id))
        {
            return Forbid();
        }

        var result = await sender.Send(new GetEmployeeByIdQuery(id), cancellationToken);

        if (result.IsFailure)
        {
            return NotFound(ApiResponse.Failure(result.Error.Message));
        }

        Response.Headers.ETag = $"\"{result.Value.Version}\"";

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(WithPersonalReach(result.Value)));
    }

    /// <summary>
    /// Self-service extras for the signed-in worker's own profile: their assignment
    /// history and a lean view of their own Fusion access. Scoped strictly to the
    /// caller's own employee id, resolved from authenticated claims.
    /// </summary>
    [HttpGet("me/profile-context")]
    [ProducesResponseType(typeof(EY.HRPlatform.SharedKernel.Api.ApiResponse<MyProfileContextDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetMyProfileContext(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        if (User.GetEmployeeId() is not { } employeeId)
        {
            return NotFound(ApiResponse.Failure("No linked employee record."));
        }

        var result = await sender.Send(new MyProfileContextQuery(employeeId), cancellationToken);
        if (result.IsFailure)
        {
            return NotFound(ApiResponse.Failure(result.Error.Message));
        }

        return Ok(EY.HRPlatform.SharedKernel.Api.ApiResponse<MyProfileContextDto>.Success(result.Value));
    }

    /// <summary>
    /// Get reporting-line summary by stable employee key (visible URLs use this).
    /// </summary>
    [HttpGet("by-key/{employeeKey}/reporting-lines")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeReportingLinesDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetReportingLinesByKey(string employeeKey, CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var audience = GetCurrentReadAudience();
        var result = await sender.Send(new GetEmployeeReportingLinesByKeyQuery(employeeKey, audience), cancellationToken);

        if (result.IsFailure)
        {
            return NotFound(ApiResponse.Failure(result.Error.Message));
        }

        if (!CanReadReportingLines(result.Value.Employee))
        {
            return Forbid();
        }

        return Ok(ApiResponseOfEmployeeReportingLinesDto.Success(ApplyReportingScope(result.Value)));
    }

    /// <summary>
    /// Get reporting-line summary for an employee, including manager chain, direct reports, and flat downline.
    /// </summary>
    [HttpGet("{id:guid}/reporting-lines")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeReportingLinesDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetReportingLines(Guid id, CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var audience = GetCurrentReadAudience();
        var result = await sender.Send(new GetEmployeeReportingLinesQuery(id, audience), cancellationToken);

        if (result.IsFailure)
        {
            return NotFound(ApiResponse.Failure(result.Error.Message));
        }

        if (!CanReadReportingLines(result.Value.Employee))
        {
            return Forbid();
        }

        return Ok(ApiResponseOfEmployeeReportingLinesDto.Success(ApplyReportingScope(result.Value)));
    }

    private static bool TryParseVersion(string? ifMatch, out uint version)
    {
        version = 0;

        if (string.IsNullOrWhiteSpace(ifMatch))
            return false;

        // Remove surrounding quotes if present: "123" -> 123
        var trimmed = ifMatch.Trim().Trim('"');

        return uint.TryParse(trimmed, out version);
    }

    // Reporting-only users can reuse the employee update endpoint when the request
    // only changes manager relationships.

    private EmployeeReadAudience GetCurrentReadAudience()
        => accessPolicy.GetEmployeeReadAudience(User);

    /// <summary>Below tenant scope, how far the caller's branch reaches: their unit (B-212) or their team.</summary>
    private string BranchScope() => accessPolicy.GetEmployeeViewScope(User) == PermissionScopes.OrgUnit
        ? PermissionScopes.OrgUnit : PermissionScopes.DirectReports;

    private bool CanReadReportingLines(EmployeeListItemDto employee)
    {
        var scope = accessPolicy.GetEmployeeViewScope(User);
        if (scope == PermissionScopes.Tenant)
        {
            return true;
        }

        var linkedEmployeeId = User.GetEmployeeId();
        if (!linkedEmployeeId.HasValue)
        {
            return false;
        }

        if (employee.Id == linkedEmployeeId.Value)
        {
            return scope == PermissionScopes.Self || scope == PermissionScopes.DirectReports || accessPolicy.CanViewOwnProfile(User);
        }

        return scope is PermissionScopes.DirectReports or PermissionScopes.OrgUnit && employee.ManagerId == linkedEmployeeId.Value;
    }

    /// <summary>
    /// These reads are for the person and tenant-wide readers; the mobile goes only to the person and to whoever
    /// sees everyone's personal details (B-214), not to a role that sees jobs alone.
    /// </summary>
    private EmployeeDetailsDto WithPersonalReach(EmployeeDetailsDto details)
        => User.GetEmployeeId() == details.Id
            || accessPolicy.GetPersonalGrant(User) is PersonalGrant.Everyone or PersonalGrant.Change
                ? details
                : details with { Phone = null };

    private bool CanViewEmployeeDetails(Guid employeeId)
        => accessPolicy.CanViewTenantEmployees(User)
            || (accessPolicy.CanViewOwnProfile(User)
                && User.GetEmployeeId() is { } linkedEmployeeId
                && linkedEmployeeId == employeeId);

    private IActionResult MapEmployeeMutationFailure(EY.HRPlatform.SharedKernel.Results.Error error)
    {
        // Errors that belong to one field say which, so the form can show them there.
        var details = error.Details ?? (error.Code.Split('.')[0] switch
        {
            "WorkEmail" => new { field = "workEmail" },
            "EmployeeNumber" => new { field = "employeeNumber" },
            _ => null,
        });

        if (error.Code.EndsWith(".NotFound", StringComparison.Ordinal))
        {
            return NotFound(ApiResponse.Failure(error.Message, details));
        }

        if (error.Code.EndsWith(".Forbidden", StringComparison.Ordinal))
        {
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse.Failure(error.Message, details));
        }

        if (error.Code.Contains("Duplicate", StringComparison.OrdinalIgnoreCase)
            || error.Code.Contains("Conflict", StringComparison.OrdinalIgnoreCase)
            || error.Code.Contains("AlreadyActive", StringComparison.OrdinalIgnoreCase))
        {
            return Conflict(ApiResponse.Failure(error.Message, details));
        }

        return BadRequest(ApiResponse.Failure(error.Message, details));
    }

    private EmployeeReportingLinesDto ApplyReportingScope(EmployeeReportingLinesDto reportingLines)
    {
        var scope = accessPolicy.GetEmployeeViewScope(User);
        if (scope == PermissionScopes.Tenant)
        {
            return reportingLines;
        }

        if (scope is PermissionScopes.DirectReports or PermissionScopes.OrgUnit)
        {
            return reportingLines with
            {
                Downline = reportingLines.DirectReports,
                DownlineCount = reportingLines.DirectReports.Count
            };
        }

        return reportingLines with
        {
            DirectReports = Array.Empty<EmployeeHierarchyNodeDto>(),
            Downline = Array.Empty<EmployeeHierarchyNodeDto>(),
            DirectReportCount = 0,
            DownlineCount = 0
        };
    }
}
