using System.Security.Claims;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.ChangeEmployeeManager;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.CreateEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.RehireEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.TerminateEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.UpdateEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeByKey;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeById;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployees;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeReportingLines;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetEmployeeReportingLinesByKey;
using EY.HRPlatform.CoreHR.Features.Employees.Queries.GetWorkforceReadinessSummary;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Models.Requests;
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
    ICoreAccessPolicyService accessPolicy) : ControllerBase
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
            new HireEmployeeCommand(request, GetAuditActor()),
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
            new AddExistingEmployeeCommand(request, GetAuditActor()),
            cancellationToken);
        if (result.IsFailure)
            return MapEmployeeMutationFailure(result.Error);

        Response.Headers.Location = $"/core/people/{result.Value.EmployeeKey}";
        return StatusCode(
            StatusCodes.Status201Created,
            EY.HRPlatform.SharedKernel.Api.ApiResponse<EstablishmentResultDto>.Success(result.Value));
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
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewTenantEmployees(User))
            return Forbid();

        var result = await sender.Send(
            new PeopleQuery(q, state, orgUnitId, organizationScope, sort, direction, page, pageSize, importBatch),
            cancellationToken);
        return Ok(ApiResponseOfPeoplePageDto.Success(result.Value));
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
            new PeopleProfileQuery(employeeKey, effectiveAsOf, audience, branchOf, User.GetEmployeeId()),
            cancellationToken);
        if (result.IsFailure)
            return NotFound(ApiResponse.Failure("Employee was not found."));

        Response.Headers.ETag = $"\"{result.Value.Version}\"";
        return Ok(ApiResponseOfPeopleProfileDto.Success(result.Value));
    }

    /// <summary>Bounded business Upcoming preview and Timeline for an employee.</summary>
    [HttpGet("people/{employeeKey}/timeline")]
    public async Task<IActionResult> GetPeopleTimeline(
        string employeeKey,
        CancellationToken cancellationToken)
    {
        // History is a manager/HR view, not part of the colleague directory projection. A manager without
        // tenant-wide People access sees it for their own branch only.
        Guid? branchOf = null;
        if (!accessPolicy.CanViewTenantEmployees(User))
        {
            if (!accessPolicy.CanViewTeam(User) || User.GetEmployeeId() is not { } managerId)
                return Forbid();
            branchOf = managerId;
        }

        var result = await sender.Send(new PeopleTimelineQuery(employeeKey, branchOf), cancellationToken);
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
        if (!accessPolicy.CanManageEmployees(User) && !accessPolicy.CanManageReporting(User))
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
    /// Create a new employee within the current tenant.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeDetailsDto), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Create(
        [FromBody] CreateEmployeeRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
        {
            return Forbid();
        }

        var command = new CreateEmployeeCommand(
            request.FirstName,
            request.LastName,
            request.Email,
            request.HireDate,
            request.JobId,
            request.ManagerId,
            request.OrgUnitId,
            request.EmployeeNumber,
            request.Phone,
            request.PlaceId,
            request.EmploymentTypeId);

        var result = await sender.Send(command, cancellationToken);
        if (result.IsFailure)
        {
            return MapEmployeeMutationFailure(result.Error);
        }

        Response.Headers.ETag = $"\"{result.Value.Version}\"";

        return CreatedAtAction(
            nameof(GetById),
            new { id = result.Value.Id },
            ApiResponseOfEmployeeDetailsDto.Success(result.Value));
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

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(result.Value));
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

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(result.Value));
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

    /// <summary>
    /// Update an existing employee's details.
    /// Requires If-Match header with current version for optimistic concurrency.
    /// </summary>
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status412PreconditionFailed)]
    public async Task<IActionResult> Update(
        Guid id,
        [FromBody] UpdateEmployeeRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!CanUpdateEmployee(request))
        {
            return Forbid();
        }

        if (!TryParseVersion(ifMatch, out var expectedVersion))
        {
            return StatusCode(
                StatusCodes.Status412PreconditionFailed,
                ApiResponse.Failure("If-Match header with valid version is required for updates."));
        }

        var command = new UpdateEmployeeCommand(
            id,
            expectedVersion,
            request.FirstName,
            request.LastName,
            request.PreferredName,
            request.Email,
            request.JobId,
            request.ManagerId,
            request.OrgUnitId,
            request.HireDate,
            request.EmployeeNumber,
            request.Phone,
            request.PlaceId,
            request.EmploymentTypeId);

        var result = await sender.Send(command, cancellationToken);
        if (result.IsFailure)
        {
            return MapEmployeeMutationFailure(result.Error);
        }

        Response.Headers.ETag = $"\"{result.Value.Version}\"";

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(result.Value));
    }

    /// <summary>
    /// Terminate an employee's active canonical employment chain.
    /// Requires If-Match header with current version for optimistic concurrency.
    /// </summary>
    [HttpPost("{id:guid}/terminate")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status412PreconditionFailed)]
    public async Task<IActionResult> Terminate(
        Guid id,
        [FromBody] TerminateEmployeeRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
        {
            return Forbid();
        }

        if (!TryParseVersion(ifMatch, out var expectedVersion))
        {
            return StatusCode(
                StatusCodes.Status412PreconditionFailed,
                ApiResponse.Failure("If-Match header with valid version is required for termination."));
        }

        var result = await sender.Send(
            new TerminateEmployeeCommand(id, expectedVersion, request.EffectiveDate, request.Note),
            cancellationToken);
        if (result.IsFailure)
        {
            return MapEmployeeMutationFailure(result.Error);
        }

        return NoContent();
    }

    /// <summary>
    /// Rehire a previously employed worker: creates a new employment, primary work assignment, and
    /// optional manager relationship without reopening prior employment.
    /// Requires If-Match header with current version for optimistic concurrency.
    /// </summary>
    [HttpPost("{id:guid}/rehire")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status412PreconditionFailed)]
    public async Task<IActionResult> Rehire(
        Guid id,
        [FromBody] RehireEmployeeRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User))
        {
            return Forbid();
        }

        if (!TryParseVersion(ifMatch, out var expectedVersion))
        {
            return StatusCode(
                StatusCodes.Status412PreconditionFailed,
                ApiResponse.Failure("If-Match header with valid version is required for rehire."));
        }

        var result = await sender.Send(
            new RehireEmployeeCommand(
                id,
                expectedVersion,
                request.EffectiveDate,
                request.OrgUnitId,
                request.JobId,
                request.PlaceId,
                request.ManagerId,
                request.EmploymentTypeId),
            cancellationToken);
        if (result.IsFailure)
        {
            return MapEmployeeMutationFailure(result.Error);
        }

        Response.Headers.ETag = $"\"{result.Value.Version}\"";

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(result.Value));
    }

    /// <summary>
    /// Change an employee's primary manager effective a given date. Atomically ends the current
    /// primary manager relationship and creates the new one.
    /// Requires If-Match header with current version for optimistic concurrency.
    /// </summary>
    [HttpPost("{id:guid}/change-manager")]
    [ProducesResponseType(typeof(ApiResponseOfEmployeeDetailsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status412PreconditionFailed)]
    public async Task<IActionResult> ChangeManager(
        Guid id,
        [FromBody] ChangeEmployeeManagerRequest request,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageEmployees(User) && !accessPolicy.CanManageReporting(User))
        {
            return Forbid();
        }

        if (!TryParseVersion(ifMatch, out var expectedVersion))
        {
            return StatusCode(
                StatusCodes.Status412PreconditionFailed,
                ApiResponse.Failure("If-Match header with valid version is required for a manager change."));
        }

        var result = await sender.Send(
            new ChangeEmployeeManagerCommand(id, expectedVersion, request.ManagerId, request.EffectiveDate),
            cancellationToken);
        if (result.IsFailure)
        {
            return MapEmployeeMutationFailure(result.Error);
        }

        Response.Headers.ETag = $"\"{result.Value.Version}\"";

        return Ok(ApiResponseOfEmployeeDetailsDto.Success(result.Value));
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

    private bool CanUpdateEmployee(UpdateEmployeeRequest request)
        => accessPolicy.CanManageEmployees(User)
            || (accessPolicy.CanManageReporting(User) && IsReportingOnlyUpdate(request));

    // Reporting-only users can reuse the employee update endpoint when the request
    // only changes manager relationships.
    private static bool IsReportingOnlyUpdate(UpdateEmployeeRequest request)
        => request.ManagerId.HasValue
            && request.EmployeeNumber is null
            && request.FirstName is null
            && request.LastName is null
            && request.PreferredName is null
            && request.Email is null
            && request.Phone is null
            && request.JobId is null
            && request.PlaceId is null
            && request.EmploymentTypeId is null
            && request.OrgUnitId is null
            && request.HireDate is null;

    private EmployeeReadAudience GetCurrentReadAudience()
        => accessPolicy.GetEmployeeReadAudience(User);

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

        return scope == PermissionScopes.DirectReports && employee.ManagerId == linkedEmployeeId.Value;
    }

    private bool CanViewEmployeeDetails(Guid employeeId)
        => accessPolicy.CanViewTenantEmployees(User)
            || (accessPolicy.CanViewOwnProfile(User)
                && User.GetEmployeeId() is { } linkedEmployeeId
                && linkedEmployeeId == employeeId);

    private IActionResult MapEmployeeMutationFailure(EY.HRPlatform.SharedKernel.Results.Error error)
    {
        if (error.Code.EndsWith(".NotFound", StringComparison.Ordinal))
        {
            return NotFound(ApiResponse.Failure(error.Message));
        }

        if (error.Code.Contains("Duplicate", StringComparison.OrdinalIgnoreCase)
            || error.Code.Contains("Conflict", StringComparison.OrdinalIgnoreCase)
            || error.Code.Contains("AlreadyActive", StringComparison.OrdinalIgnoreCase))
        {
            return Conflict(ApiResponse.Failure(error.Message));
        }

        return BadRequest(ApiResponse.Failure(error.Message));
    }

    private EmployeeReportingLinesDto ApplyReportingScope(EmployeeReportingLinesDto reportingLines)
    {
        var scope = accessPolicy.GetEmployeeViewScope(User);
        if (scope == PermissionScopes.Tenant)
        {
            return reportingLines;
        }

        if (scope == PermissionScopes.DirectReports)
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
