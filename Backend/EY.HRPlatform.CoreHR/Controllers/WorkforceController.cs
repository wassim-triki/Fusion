using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Models.Responses;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Controllers;

[ApiController]
[Route("api/corehr/workforce")]
[Authorize]
public class WorkforceController(
    IWorkforceContractService workforceContractService,
    ICoreAccessPolicyService accessPolicy,
    IWorkforceAccessIdentityClient workforceAccessClient,
    IWorkforceBulkProvisioner workforceBulkProvisioner,
    WorkforceInvitationSender invitationSender) : ControllerBase
{
    [HttpGet("me")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceCurrentUserContextDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetCurrentContext(CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewOwnProfile(User)
            && !accessPolicy.CanViewTeam(User)
            && !accessPolicy.CanViewTenantEmployees(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetCurrentUserContextAsync(User, cancellationToken);
        return Ok(ApiResponse<WorkforceCurrentUserContextDto>.Success(result));
    }

    [HttpGet("employees/{employeeId:guid}")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceEmployeeSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetEmployee(Guid employeeId, CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (result is null)
        {
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        }

        return Ok(ApiResponse<WorkforceEmployeeSummaryDto>.Success(result));
    }

    [HttpPost("employees/resolve")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ResolveEmployees(
        [FromBody] WorkforceEmployeeResolveRequest request,
        CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.ResolveEmployeesAsync(request.EmployeeIds, User, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpGet("employees/search")]
    [ProducesResponseType(typeof(ApiResponse<PagedResponse<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchEmployees(
        [FromQuery] string? search,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.SearchEmployeesAsync(search, page, pageSize, User, cancellationToken);
        return Ok(ApiResponse<PagedResponse<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpPost("employees/by-scope")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetEmployeesByScope(
        [FromBody] WorkforceEmployeesByScopeRequest request,
        CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetEmployeesByScopeAsync(
            request.OrgUnitIds,
            request.IncludeDescendants,
            request.IncludeInactive,
            User,
            cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpGet("access-subjects")]
    [ProducesResponseType(typeof(ApiResponse<PagedResponse<WorkforceAccessSubjectSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchAccessSubjects(
        [FromQuery] string? search,
        [FromQuery] string? access,
        [FromQuery] Guid? profileId,
        [FromQuery] string? employeeStatus,
        [FromQuery] string? deliveryState,
        [FromQuery] string? employeeKey,
        [FromQuery] string? baseline,
        [FromQuery] Guid? cohort,
        [FromQuery] Guid? orgUnitId,
        [FromQuery] string? organizationScope,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewAccess(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.SearchAccessSubjectsAsync(
            search,
            access,
            profileId,
            employeeStatus,
            deliveryState,
            employeeKey,
            baseline,
            cohort,
            orgUnitId,
            !string.Equals(organizationScope, "Direct", StringComparison.OrdinalIgnoreCase),
            page,
            pageSize,
            cancellationToken);
        return Ok(ApiResponse<PagedResponse<WorkforceAccessSubjectSummaryDto>>.Success(result));
    }

    [HttpGet("access-subjects/summary")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessRosterSummaryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAccessRosterSummary(CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewAccess(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetAccessRosterSummaryAsync(cancellationToken);
        return Ok(ApiResponse<WorkforceAccessRosterSummaryDto>.Success(result));
    }

    [HttpGet("access-subjects/preview")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceAccessSubjectSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAccessSubjectSelectionPreview(
        [FromQuery] string? search,
        [FromQuery] string? access,
        [FromQuery] Guid? profileId,
        [FromQuery] string? employeeStatus,
        [FromQuery] string? deliveryState,
        [FromQuery] string? employeeKey,
        [FromQuery] string? baseline,
        [FromQuery] Guid? cohort,
        [FromQuery] Guid? orgUnitId,
        [FromQuery] string? organizationScope,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetAccessSubjectSelectionPreviewAsync(
            search,
            access,
            profileId,
            employeeStatus,
            deliveryState,
            employeeKey,
            baseline,
            cohort,
            orgUnitId,
            !string.Equals(organizationScope, "Direct", StringComparison.OrdinalIgnoreCase),
            cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceAccessSubjectSummaryDto>>.Success(result));
    }

    [HttpPost("access-subjects/bulk-invite")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceBulkInviteResponseDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> BulkInvite(
        [FromBody] WorkforceBulkInviteRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        try
        {
            var result = await workforceContractService.BulkInviteAsync(request, User, cancellationToken);
            return Ok(ApiResponse<WorkforceBulkInviteResponseDto>.Success(result));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse.Failure(ex.Message));
        }
    }

    [HttpGet("access-subjects/{employeeId:guid}/candidate")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCandidateDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetAccessCandidate(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewAccess(User))
        {
            return Forbid();
        }

        // CoreHR resolves the canonical Employee (existence, ownership, work email) from its
        // own authority; only then does it ask Identity for the non-disclosing account state.
        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
        {
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        }

        var candidate = await workforceAccessClient.ResolveCandidateAsync(
            employee.EmployeeId, NormalizeEmail(employee.WorkEmail), cancellationToken);

        return Ok(ApiResponse<WorkforceAccessCandidateDto>.Success(BuildCandidate(employee, candidate)));
    }

    [HttpPost("access-subjects/candidates")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceAccessCandidateDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetAccessCandidates(
        [FromBody] WorkforceAccessCandidatesRequest request,
        CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        var employeeIds = request.EmployeeIds
            .Where(employeeId => employeeId != Guid.Empty)
            .Distinct()
            .ToArray();
        if (employeeIds.Length == 0)
        {
            return BadRequest(ApiResponse.Failure("Select at least one person to review."));
        }

        var employees = await workforceContractService.ResolveEmployeesAsync(employeeIds, User, cancellationToken);
        var candidates = await workforceAccessClient.ResolveCandidatesAsync(
            employees.Select(employee => new WorkforceAccessCandidateSubject(
                employee.EmployeeId, NormalizeEmail(employee.WorkEmail))).ToArray(),
            cancellationToken);

        var resolved = employees
            .Where(employee => candidates.ContainsKey(employee.EmployeeId))
            .Select(employee => BuildCandidate(employee, candidates[employee.EmployeeId]))
            .ToList();

        return Ok(ApiResponse<IReadOnlyList<WorkforceAccessCandidateDto>>.Success(resolved));
    }

    [HttpPost("access-subjects/{employeeId:guid}/activate")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ActivateAccess(
        Guid employeeId, [FromBody] WorkforceAccessCommand? command, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
        {
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        }

        // A new account is activated by issuing exactly one purpose-bound Workforce
        // invitation. Without a work email there is nowhere to send it, so the state
        // is a truthful, recoverable block rather than a failure.
        var email = NormalizeEmail(employee.WorkEmail);
        if (string.IsNullOrEmpty(email))
        {
            return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
                employee.EmployeeId,
                "Blocked",
                WorkforceAccountStates.NewAccount,
                "Add a work email for this person in People before inviting them.",
                null)));
        }

        var baseline = NormalizeBaseline(command?.Baseline) ?? RecommendedBaseline(employee.DirectReportCount);

        var provision = await workforceBulkProvisioner.BulkProvisionAsync(
            [new WorkforceBulkProvisionSubject(employee.EmployeeId, email, employee.FirstName, employee.LastName)],
            Guid.Empty,
            cancellationToken,
            baseline);

        var item = provision.Items.FirstOrDefault();
        var (outcome, message) = item?.Outcome switch
        {
            "Created" => ("Ok", "Invitation sent."),
            "Pending" => ("Ok", "Invitation refreshed."),
            "Active" => ("Stale", "This person already has active access."),
            null => ("Failed", "The invitation could not be issued."),
            _ => ("Failed", item?.Message ?? "The invitation could not be issued."),
        };

        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            employee.EmployeeId,
            outcome,
            WorkforceAccountStates.NewAccount,
            message,
            null)));
    }

    [HttpPost("access-subjects/{employeeId:guid}/link")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> LinkAccess(Guid employeeId, [FromBody] WorkforceAccessCommand? command, CancellationToken cancellationToken)
        => MutateAsync(employeeId, "Link", command, cancellationToken);

    [HttpPost("access-subjects/{employeeId:guid}/reactivate")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> ReactivateAccess(Guid employeeId, [FromBody] WorkforceAccessCommand? command, CancellationToken cancellationToken)
        => MutateAsync(employeeId, "ReactivateAndLink", command, cancellationToken);

    [HttpPost("access-subjects/{employeeId:guid}/connect")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public Task<IActionResult> ConnectAccess(Guid employeeId, [FromBody] WorkforceAccessCommand? command, CancellationToken cancellationToken)
        => MutateAsync(employeeId, "Connect", command, cancellationToken);

    [HttpPost("access-subjects/{employeeId:guid}/correct")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CorrectAccess(
        Guid employeeId, [FromBody] WorkforceAccessCorrectionCommand? command, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        if (command is null || command.TargetEmployeeId == Guid.Empty)
        {
            return BadRequest(ApiResponse.Failure("Choose the corrected person."));
        }

        if (string.IsNullOrWhiteSpace(command.Reason))
        {
            return BadRequest(ApiResponse.Failure("A correction reason is required."));
        }

        // Resolve BOTH the currently-bound source (route) and the corrected target (body)
        // canonically. The browser never supplies an Employee identity fact — only the two
        // references, the reviewed baseline, the reason, and the revision it reviewed.
        var source = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (source is null)
        {
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        }

        var target = await workforceContractService.GetEmployeeAsync(command.TargetEmployeeId, User, cancellationToken);
        if (target is null)
        {
            return NotFound(ApiResponse.Failure("The corrected person was not found or is not visible in the current scope."));
        }

        var baseline = NormalizeBaseline(command.Baseline) ?? RecommendedBaseline(target.DirectReportCount);
        var expectedRevision = command.ExpectedVersion > int.MaxValue ? int.MaxValue : (int)command.ExpectedVersion;

        var result = await workforceAccessClient.CorrectAsync(
            source.EmployeeId, target.EmployeeId, baseline, command.Reason.Trim(), expectedRevision, cancellationToken);

        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            source.EmployeeId,
            result.Outcome,
            result.AccountState,
            result.Message,
            result.AccessRevision is { } rev ? (uint)rev : null)));
    }

    [HttpPost("access-subjects/{employeeId:guid}/resend")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ResendInvite(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User)) return Forbid();
        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        var ok = await workforceAccessClient.ResendInviteAsync(employee.EmployeeId, cancellationToken);
        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            employee.EmployeeId, ok ? "Ok" : "Failed", null,
            ok ? "Invitation resent." : "The invitation could not be resent.", null)));
    }

    [HttpPost("access-subjects/{employeeId:guid}/withdraw")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> WithdrawInvite(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User)) return Forbid();
        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        var ok = await workforceAccessClient.WithdrawInviteAsync(employee.EmployeeId, cancellationToken);
        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            employee.EmployeeId, ok ? "Ok" : "Failed", null,
            ok ? "Invitation withdrawn." : "The invitation could not be withdrawn.", null)));
    }

    [HttpPost("access-subjects/{employeeId:guid}/suspend")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SuspendAccess(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User)) return Forbid();
        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        var (ok, message) = await workforceAccessClient.SuspendAccountAsync(employee.EmployeeId, cancellationToken);
        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            employee.EmployeeId, ok ? "Ok" : "Blocked", null,
            ok ? "Workforce access suspended." : message, null)));
    }

    [HttpPost("access-subjects/{employeeId:guid}/restore")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessCommandResultDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> RestoreAccess(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User)) return Forbid();
        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        var (ok, message) = await workforceAccessClient.RestoreAccountAsync(employee.EmployeeId, cancellationToken);
        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            employee.EmployeeId, ok ? "Ok" : "Blocked", null,
            ok ? "Workforce access restored." : message, null)));
    }

    [HttpGet("access-subjects/{employeeId:guid}/audit")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceAccessAuditLineDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAccessAudit(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewAccess(User)) return Forbid();
        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        var lines = await workforceAccessClient.GetAuditAsync(employee.EmployeeId, cancellationToken);
        var mapped = lines
            .Select(l => new WorkforceAccessAuditLineDto(l.Action, l.ActorName, l.ActorRole, l.OccurredAt, l.Summary))
            .ToList();
        return Ok(ApiResponse<IReadOnlyList<WorkforceAccessAuditLineDto>>.Success(mapped));
    }

    [HttpPost("access-subjects/bulk-activate")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccessBulkResultDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> BulkActivate(
        [FromBody] WorkforceAccessBulkRequest request, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        if (request?.Items is null || request.Items.Count == 0)
        {
            return BadRequest(ApiResponse.Failure("Select at least one person to activate."));
        }

        // Resolve the canonical Employees once, in the caller's scope; the sender re-resolves account state.
        var requestedItems = request.Items
            .Where(item => item.EmployeeId != Guid.Empty)
            .DistinctBy(item => item.EmployeeId)
            .ToList();
        var employees = await workforceContractService.ResolveEmployeesAsync(
            requestedItems.Select(item => item.EmployeeId).ToArray(),
            User,
            cancellationToken);
        var employeesById = employees.ToDictionary(employee => employee.EmployeeId);
        var visible = requestedItems.Where(item => employeesById.ContainsKey(item.EmployeeId)).ToList();
        var sent = await invitationSender.SendAsync(
            visible.Select(item => employeesById[item.EmployeeId]).ToList(),
            visible.ToDictionary(item => item.EmployeeId, item => item.Baseline),
            cancellationToken);
        var unseen = requestedItems.Where(item => !employeesById.ContainsKey(item.EmployeeId))
            .Select(item => new WorkforceAccessBulkResultItemDto(item.EmployeeId, "Unknown", "Failed", null, "This person is no longer visible."))
            .ToList();
        return Ok(ApiResponse<WorkforceAccessBulkResultDto>.Success(sent with
        {
            Items = [.. sent.Items, .. unseen],
            Failed = sent.Failed + unseen.Count,
        }));
    }

    private async Task<IActionResult> MutateAsync(
        Guid employeeId, string action, WorkforceAccessCommand? command, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanManageAccess(User))
        {
            return Forbid();
        }

        var employee = await workforceContractService.GetEmployeeAsync(employeeId, User, cancellationToken);
        if (employee is null)
        {
            return NotFound(ApiResponse.Failure("Employee was not found or is not visible in the current scope."));
        }

        // The reviewed baseline is the operator's choice; absent one, the effective-today
        // direct-report count recommends it. CoreHR passes the canonical work email so the
        // browser can never substitute an Employee fact.
        var baseline = NormalizeBaseline(command?.Baseline) ?? RecommendedBaseline(employee.DirectReportCount);

        var result = await workforceAccessClient.MutateAsync(
            employee.EmployeeId, NormalizeEmail(employee.WorkEmail), action, baseline, cancellationToken);

        return Ok(ApiResponse<WorkforceAccessCommandResultDto>.Success(new WorkforceAccessCommandResultDto(
            employee.EmployeeId,
            result.Outcome,
            result.AccountState,
            result.Message,
            result.AccessRevision is { } rev ? (uint)rev : null)));
    }

    private static WorkforceAccessCandidateDto BuildCandidate(
        WorkforceEmployeeSummaryDto employee, WorkforceAccessCandidateResult candidate)
        => new(
            employee.EmployeeId,
            employee.StableEmployeeKey,
            employee.EmployeeNumber,
            employee.DisplayName,
            employee.FullName,
            employee.WorkEmail,
            employee.JobTitle,
            employee.EmploymentStatus,
            employee.IsActive,
            employee.OrgUnit,
            employee.Manager,
            employee.DirectReportCount,
            candidate.AccountState,
            AccountStateLabel(candidate.AccountState),
            candidate.AccountEmail,
            RecommendedBaseline(employee.DirectReportCount),
            // Linking an admin account to its Employee is allowed (it preserves admin
            // authority additively). Only the ongoing lifecycle is delegated: an active,
            // bound admin account offers no workforce actions and reads "Managed under
            // Administrators"; the frontend also suppresses suspend/restore for admins.
            AvailableActions(candidate.AccountState),
            candidate.IsAdministrator && AvailableActions(candidate.AccountState).Count == 0
                ? "Managed under Administrators"
                : BlockedReason(candidate.AccountState),
            employee.Version,
            candidate.IsAdministrator,
            candidate.AdditionalAccess,
            candidate.AccessRevision);

    private static string RecommendedBaseline(int directReportCount)
        => directReportCount > 0 ? WorkforceBaselineChoices.Manager : WorkforceBaselineChoices.Employee;

    private static string? NormalizeBaseline(string? baseline)
        => string.Equals(baseline, WorkforceBaselineChoices.Manager, StringComparison.OrdinalIgnoreCase)
            ? WorkforceBaselineChoices.Manager
            : string.Equals(baseline, WorkforceBaselineChoices.Employee, StringComparison.OrdinalIgnoreCase)
                ? WorkforceBaselineChoices.Employee
                : null;

    private static IReadOnlyList<string> AvailableActions(string accountState) => accountState switch
    {
        WorkforceAccountStates.NewAccount => ["Activate"],
        WorkforceAccountStates.ExistingAccountReadyToLink => ["Link"],
        WorkforceAccountStates.SuspendedAccountReadyToReactivate => ["Reactivate"],
        WorkforceAccountStates.ExistingAccountReadyToJoinTenant => ["Connect"],
        _ => [],
    };

    private static string AccountStateLabel(string accountState) => accountState switch
    {
        WorkforceAccountStates.NewAccount => "No account yet",
        WorkforceAccountStates.ExistingAccountReadyToLink => "Account ready to link",
        WorkforceAccountStates.Active => "Active",
        WorkforceAccountStates.BindingConflict => "Linked to a different employee",
        WorkforceAccountStates.SuspendedAccountReadyToReactivate => "Suspended — can reactivate",
        WorkforceAccountStates.ExistingAccountReadyToJoinTenant => "Account can join this workspace",
        WorkforceAccountStates.AccountUnavailable => "Account in use elsewhere",
        _ => accountState,
    };

    private static string? BlockedReason(string accountState) => accountState switch
    {
        WorkforceAccountStates.BindingConflict => "This account is linked to a different employee. Use correction.",
        WorkforceAccountStates.AccountUnavailable => "This account is active in another workspace and cannot be used here.",
        _ => null,
    };

    private static string? NormalizeEmail(string? email)
        => string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();

    [HttpGet("employees/{employeeId:guid}/team")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTeam(Guid employeeId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewTeam(User) && !accessPolicy.CanViewTenantEmployees(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetTeamAsync(employeeId, User, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpGet("employees/{employeeId:guid}/downline")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetDownline(
        Guid employeeId,
        [FromQuery] int maxDepth = 10,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewTeam(User) && !accessPolicy.CanViewTenantEmployees(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetDownlineAsync(employeeId, maxDepth, User, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpGet("employees/{employeeId:guid}/manager-chain")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetManagerChain(Guid employeeId, CancellationToken cancellationToken)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetManagerChainAsync(employeeId, User, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpGet("org-units")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceOrgUnitSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPublishedOrgUnits(
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewStructure(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetPublishedOrgUnitsAsync(includeInactive, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceOrgUnitSummaryDto>>.Success(result));
    }

    [HttpGet("org-units/{orgUnitId:guid}")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceOrgUnitDetailDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetOrgUnitDetail(Guid orgUnitId, CancellationToken cancellationToken)
    {
        if (!accessPolicy.CanViewStructure(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetOrgUnitDetailAsync(orgUnitId, cancellationToken);
        if (result is null)
        {
            return NotFound(ApiResponse.Failure("Org unit was not found or is not visible in the current scope."));
        }

        return Ok(ApiResponse<WorkforceOrgUnitDetailDto>.Success(result));
    }

    [HttpGet("org-units/{orgUnitId:guid}/members")]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOrgUnitMembers(
        Guid orgUnitId,
        [FromQuery] bool includeDescendants = false,
        CancellationToken cancellationToken = default)
    {
        if (accessPolicy.GetEmployeeViewScope(User) is null && !accessPolicy.CanViewOwnProfile(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetOrgUnitMembersAsync(orgUnitId, includeDescendants, User, cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<WorkforceEmployeeSummaryDto>>.Success(result));
    }

    [HttpGet("org-units/tree")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceOrgUnitTreeDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetPublishedOrgUnitTree(
        [FromQuery] Guid? rootId,
        [FromQuery] int maxDepth = 10,
        [FromQuery] bool includeInactive = false,
        CancellationToken cancellationToken = default)
    {
        if (!accessPolicy.CanViewStructure(User))
        {
            return Forbid();
        }

        var result = await workforceContractService.GetPublishedOrgUnitTreeAsync(rootId, maxDepth, includeInactive, cancellationToken);
        return Ok(ApiResponse<WorkforceOrgUnitTreeDto>.Success(result));
    }
}
