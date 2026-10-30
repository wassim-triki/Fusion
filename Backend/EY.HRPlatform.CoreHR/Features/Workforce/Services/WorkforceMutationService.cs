using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Catalog;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

/// <summary>Identity/profile fields for an <see cref="Employee"/> (no workforce facts).</summary>
public sealed record UpdateEmployeeProfileInput(
    string FirstName,
    string LastName,
    string? Email,
    string? PreferredName,
    string? Phone);

/// <summary>Inputs to start a new <see cref="Employment"/>.</summary>
public sealed record StartEmploymentInput(
    DateTime EffectiveFrom,
    Guid? EmploymentTypeId,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>Inputs to correct the active <see cref="Employment"/> details in place.</summary>
public sealed record UpdateEmploymentDetailsInput(
    Guid? EmploymentTypeId,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>Inputs to open or change an employee's primary <see cref="WorkAssignment"/>.</summary>
public sealed record ChangeWorkAssignmentInput(
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId,
    DateTime EffectiveDate,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>Inputs to correct the active primary <see cref="WorkAssignment"/> in place.</summary>
public sealed record CorrectWorkAssignmentInput(
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>Inputs to set or change an employee's primary <see cref="ManagerRelationship"/>.</summary>
public sealed record ChangeManagerInput(
    Guid ManagerEmployeeId,
    DateTime EffectiveDate,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>Inputs to terminate an employee's active employment chain.</summary>
public sealed record TerminateEmployeeInput(
    DateTime EffectiveDate,
    string? Note = null,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>
/// Inputs to end employment coherently while releasing direct reports. The employee is employed
/// <b>through</b> <see cref="LastEmployedDate"/> and inactive after it.
/// </summary>
public sealed record EndEmploymentInput(
    DateTime LastEmployedDate,
    string? Note = null,
    WorkforceSourceType Source = WorkforceSourceType.Manual,
    string? SourceReference = null,
    Guid? ImportBatchId = null);

/// <summary>A minimal reference to a direct report affected by an employment end.</summary>
public sealed record AffectedDirectReport(Guid EmployeeId, string DisplayName, string EmployeeNumber);

/// <summary>The consequence preview for an employment end: reports that become managerless.</summary>
public sealed record EndEmploymentPreview(
    DateTime LastEmployedDate,
    int DirectReportCount,
    IReadOnlyList<AffectedDirectReport> DirectReports);

/// <summary>
/// Explicit, effective-dated canonical write operations over the
/// <c>Employee -&gt; Employment -&gt; WorkAssignment -&gt; ManagerRelationship</c> chain. Each
/// operation validates the canonical invariants (single active employment, single active primary
/// assignment, half-open <c>[from, to)</c> dating with close-and-succeed, no self/cross-tenant/cyclic
/// manager links) and stages a <see cref="WorkforceAuditEntry"/> for every material action.
///
/// Operations <b>stage</b> their changes onto the tracked <see cref="CoreHRDbContext"/> and do NOT
/// call <c>SaveChanges</c>: the orchestrating handler commits once so a composed action (and its
/// audit entry) is written atomically in a single transaction. Lookups are unit-of-work aware, so a
/// freshly-staged employment/assignment created earlier in the same composition resolves correctly.
/// </summary>
public interface IWorkforceMutationService
{
    /// <summary>Updates Core-owned identity/profile fields; audited as <c>EmployeeProfileUpdated</c>.</summary>
    Task<Result<Employee>> UpdateEmployeeProfileAsync(
        Guid employeeId, UpdateEmployeeProfileInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Starts a new active employment; rejects a second active employment.</summary>
    Task<Result<Employment>> StartEmploymentAsync(
        Guid employeeId, StartEmploymentInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Updates the employee's active employment details in place.</summary>
    Task<Result<Employment>> UpdateEmploymentDetailsAsync(
        Guid employeeId, UpdateEmploymentDetailsInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Ends the employee's active employment effective the given date (employment fact only).</summary>
    Task<Result<Employment>> EndEmploymentAsync(
        Guid employeeId, DateTime effectiveDate, string? actor, CancellationToken cancellationToken);

    /// <summary>Terminates the active employment, primary assignment, and subject-side manager links.</summary>
    Task<Result<Employment>> TerminateEmployeeAsync(
        Guid employeeId, TerminateEmployeeInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Opens the first, or close-and-succeeds the current, primary work assignment.</summary>
    Task<Result<WorkAssignment>> ChangeWorkAssignmentAsync(
        Guid employeeId, ChangeWorkAssignmentInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Corrects the current primary work assignment in place.</summary>
    Task<Result<WorkAssignment>> CorrectPrimaryWorkAssignmentAsync(
        Guid employeeId, CorrectWorkAssignmentInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Sets the first, or close-and-succeeds the current, primary manager relationship.</summary>
    Task<Result<ManagerRelationship>> ChangeManagerAsync(
        Guid employeeId, ChangeManagerInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>
    /// Ends the current active primary manager relationship effective the given date, leaving the
    /// employee validly managerless. A no-op success when the employee already has no manager.
    /// </summary>
    Task<Result<ManagerRelationship?>> RemovePrimaryManagerAsync(
        Guid employeeId, DateTime effectiveDate, WorkforceSourceType source, string? sourceReference,
        Guid? importBatchId, string? actor, CancellationToken cancellationToken);

    /// <summary>
    /// Adds a dotted-line (secondary) manager from the given date. Dotted lines sit beside the primary chain: they
    /// never count in it, so they need no cycle guard, but they can't repeat the primary manager or an open dotted line.
    /// </summary>
    Task<Result<ManagerRelationship>> AddDottedLineManagerAsync(
        Guid employeeId, ChangeManagerInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Ends a dotted-line manager relationship effective the given date.</summary>
    Task<Result<ManagerRelationship>> EndDottedLineManagerAsync(
        Guid employeeId, ChangeManagerInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>
    /// Ends employment coherently: the employee is employed through <c>LastEmployedDate</c> and
    /// inactive after it. Closes the active employment, its primary work assignment, and the
    /// employee's own manager relationships, and ends the relationships in which the employee is the
    /// manager (leaving those direct reports managerless) instead of blocking.
    /// </summary>
    Task<Result<Employment>> EndEmploymentReleasingReportsAsync(
        Guid employeeId, EndEmploymentInput input, string? actor, CancellationToken cancellationToken);

    /// <summary>Previews an employment end: the direct reports that would become managerless.</summary>
    Task<Result<EndEmploymentPreview>> PreviewEndEmploymentAsync(
        Guid employeeId, DateTime lastEmployedDate, CancellationToken cancellationToken);
}

public sealed class WorkforceMutationService(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IWorkforceCanonicalResolver resolver,
    WorkforceResolutionScope? resolutionScope = null,
    IWorkEmailOccupancyService? workEmailOccupancyService = null) : IWorkforceMutationService
{
    private const int ManagerChainGuardDepth = 100;
    private readonly WorkforceResolutionScope _resolutionScope = resolutionScope ?? new WorkforceResolutionScope();
    private readonly IWorkEmailOccupancyService _workEmailOccupancyService =
        workEmailOccupancyService ?? new WorkEmailOccupancyService(dbContext, tenantContext);
    private readonly CatalogReferences _catalog = new(dbContext, tenantContext);

    public async Task<Result<Employee>> UpdateEmployeeProfileAsync(
        Guid employeeId, UpdateEmployeeProfileInput input, string? actor, CancellationToken cancellationToken)
    {
        var employee = await FindEmployeeAsync(employeeId, cancellationToken);
        if (employee is null)
            return Result.Failure<Employee>(Error.NotFound("Employee", employeeId));

        employee.UpdateProfile(input.FirstName, input.LastName, input.Email, input.PreferredName, input.Phone);

        var occupancy = await _workEmailOccupancyService.SynchronizeAsync(employeeId, cancellationToken);
        if (occupancy.IsFailure)
            return Result.Failure<Employee>(occupancy.Error);

        StageAudit("Employee", employee.Id, WorkforceAuditAction.EmployeeProfileUpdated,
            WorkforceSourceType.Manual, actor, effectiveDate: null, sourceReference: null, importBatchId: null,
            changeDetails: "Employee profile updated.");

        return Result.Success(employee);
    }

    public async Task<Result<Employment>> StartEmploymentAsync(
        Guid employeeId, StartEmploymentInput input, string? actor, CancellationToken cancellationToken)
    {
        var employee = await FindEmployeeAsync(employeeId, cancellationToken);
        if (employee is null)
            return Result.Failure<Employment>(Error.NotFound("Employee", employeeId));

        var effectiveFrom = NormalizeDate(input.EffectiveFrom);

        // At most one active employment per employee at a time (D1 single-active rule).
        var existingActive = await ResolveActiveEmploymentAsync(employeeId, effectiveFrom, cancellationToken);
        if (existingActive is not null)
            return Result.Failure<Employment>(Error.Conflict(
                "Employment.AlreadyActive",
                "Employee already has an active employment; end it before starting a new one."));

        var employmentType = await _catalog.ListValueAsync(CompanyList.EmploymentTypes, input.EmploymentTypeId, null, cancellationToken);
        if (employmentType.IsFailure)
            return Result.Failure<Employment>(employmentType.Error);

        var employment = Employment.Start(
            tenantContext.TenantId, employeeId, effectiveFrom, employmentType.Value,
            input.Source, input.SourceReference, input.ImportBatchId);
        dbContext.Employments.Add(employment);

        var occupancy = await _workEmailOccupancyService.SynchronizeAsync(employeeId, cancellationToken);
        if (occupancy.IsFailure)
            return Result.Failure<Employment>(occupancy.Error);

        StageAudit("Employment", employment.Id, WorkforceAuditAction.EmploymentStarted,
            input.Source, actor, effectiveFrom, input.SourceReference, input.ImportBatchId,
            "Employment started.");

        return Result.Success(employment);
    }

    public async Task<Result<Employment>> UpdateEmploymentDetailsAsync(
        Guid employeeId, UpdateEmploymentDetailsInput input, string? actor, CancellationToken cancellationToken)
    {
        var employment = await ResolveActiveEmploymentAsync(employeeId, DateTime.UtcNow, cancellationToken);
        if (employment is null)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.NoActive",
                "Employee has no active employment to update."));

        var employmentType = await _catalog.ListValueAsync(
            CompanyList.EmploymentTypes, input.EmploymentTypeId, employment.EmploymentTypeId, cancellationToken);
        if (employmentType.IsFailure)
            return Result.Failure<Employment>(employmentType.Error);

        employment.UpdateEmploymentType(employmentType.Value);

        StageAudit("Employment", employment.Id, WorkforceAuditAction.EmploymentUpdated,
            input.Source, actor, effectiveDate: null, input.SourceReference, input.ImportBatchId,
            "Employment details updated.");

        return Result.Success(employment);
    }

    public async Task<Result<Employment>> EndEmploymentAsync(
        Guid employeeId, DateTime effectiveDate, string? actor, CancellationToken cancellationToken)
    {
        var at = NormalizeDate(effectiveDate);
        var employment = await ResolveActiveEmploymentAsync(employeeId, at, cancellationToken);
        if (employment is null)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.NoActive", "Employee has no active employment to end."));

        if (at <= employment.EffectiveFrom)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.EndBeforeStart", "Employment end date must be after its start date."));

        employment.End(at);

        var occupancy = await _workEmailOccupancyService.SynchronizeAsync(employeeId, cancellationToken);
        if (occupancy.IsFailure)
            return Result.Failure<Employment>(occupancy.Error);

        StageAudit("Employment", employment.Id, WorkforceAuditAction.EmploymentEnded,
            WorkforceSourceType.Manual, actor, at, sourceReference: null, importBatchId: null,
            changeDetails: "Employment ended.");

        return Result.Success(employment);
    }

    public async Task<Result<Employment>> TerminateEmployeeAsync(
        Guid employeeId, TerminateEmployeeInput input, string? actor, CancellationToken cancellationToken)
    {
        var at = NormalizeDate(input.EffectiveDate);
        var employment = await ResolveActiveEmploymentAsync(employeeId, at, cancellationToken);
        if (employment is null)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.NoActive",
                "Employee has no active employment to terminate."));

        if (at <= employment.EffectiveFrom)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.EndBeforeStart",
                "Employment end date must be after its start date."));

        var assignment = await ResolveActivePrimaryAssignmentAsync(employeeId, at, cancellationToken);
        if (assignment is null)
            return Result.Failure<Employment>(Error.Validation(
                "WorkAssignment.NoActivePrimary",
                "Employee has no active primary work assignment to terminate."));

        if (at <= assignment.EffectiveFrom)
            return Result.Failure<Employment>(Error.Validation(
                "WorkAssignment.EndBeforeStart",
                "Work assignment end date must be after its start date."));

        var blockingDirectReports = await ResolveBlockingDirectReportsAsync(employeeId, at, cancellationToken);
        if (blockingDirectReports.Count > 0)
        {
            return Result.Failure<Employment>(Error.Validation(
                "Employment.TerminationBlockedByDirectReports",
                BuildTerminationBlockedMessage(blockingDirectReports)));
        }

        var subjectRelationships = await ResolveActiveSubjectManagerRelationshipsAsync(assignment.Id, at, cancellationToken);
        foreach (var relationship in subjectRelationships)
        {
            if (at <= relationship.EffectiveFrom)
            {
                return Result.Failure<Employment>(Error.Validation(
                    "Manager.EndBeforeStart",
                    "Manager relationship end date must be after its start date."));
            }
        }

        foreach (var relationship in subjectRelationships)
        {
            relationship.End(at);
        }

        assignment.End(at);
        employment.End(at);

        var occupancy = await _workEmailOccupancyService.SynchronizeAsync(employeeId, cancellationToken);
        if (occupancy.IsFailure)
            return Result.Failure<Employment>(occupancy.Error);

        StageAudit("Employment", employment.Id, WorkforceAuditAction.EmploymentEnded,
            input.Source, actor, at, input.SourceReference, input.ImportBatchId,
            BuildTerminationAuditDetails(input.Note));

        return Result.Success(employment);
    }

    public async Task<Result<WorkAssignment>> ChangeWorkAssignmentAsync(
        Guid employeeId, ChangeWorkAssignmentInput input, string? actor, CancellationToken cancellationToken)
    {
        var effectiveDate = NormalizeDate(input.EffectiveDate);

        var employment = await ResolveActiveEmploymentAsync(employeeId, effectiveDate, cancellationToken);
        if (employment is null)
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.NoActiveEmployment",
                "Employee has no active employment to attach a work assignment to."));

        if (effectiveDate < employment.EffectiveFrom
            || (employment.EffectiveTo is { } end && effectiveDate >= end))
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.OutsideEmploymentWindow",
                "Work assignment effective date must fall within the employment window."));

        var orgUnit = await FindOrgUnitAsync(input.OrgUnitId, cancellationToken);
        if (orgUnit is null || orgUnit.TenantId != tenantContext.TenantId)
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.OrgUnitNotFound",
                "The work assignment organization unit was not found in this tenant."));
        // Initial establishment (Import) may back-date the assignment before the org unit's Fusion
        // timeline — that timeline's start is the unit's import/establishment date, not proof the real
        // unit did not exist earlier. The unit must still be a valid CURRENT target, so establishment
        // validates the unit's activity as of today; later effective-dated changes validate at the
        // change date, where an inactive unit on that date is a genuine error.
        var orgActivityAsOf = input.Source == WorkforceSourceType.Import
            ? DateOnly.FromDateTime(DateTime.UtcNow)
            : DateOnly.FromDateTime(effectiveDate);
        if (!await IsOrgUnitActiveOnAsync(orgUnit.Id, orgActivityAsOf, orgUnit.IsActive, cancellationToken))
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.OrgUnitInactive", "Cannot assign an inactive organization unit."));

        var current = await ResolveActivePrimaryAssignmentAsync(employeeId, effectiveDate, cancellationToken);
        if (current is not null && effectiveDate <= current.EffectiveFrom)
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.EffectiveDateNotAfterCurrent",
                "Work assignment change date must be after the current assignment's start date."));

        var job = await _catalog.JobAsync(input.JobId, current?.JobId, cancellationToken);
        if (job.IsFailure)
            return Result.Failure<WorkAssignment>(job.Error);
        var place = await _catalog.PlaceAsync(input.PlaceId, current?.PlaceId, cancellationToken);
        if (place.IsFailure)
            return Result.Failure<WorkAssignment>(place.Error);

        var isFirst = current is null;
        current?.End(effectiveDate);

        var assignment = WorkAssignment.Create(
            tenantContext.TenantId, employment.Id, employeeId, input.OrgUnitId,
            job.Value, place.Value, isPrimary: true,
            effectiveFrom: effectiveDate, effectiveTo: null,
            input.Source, input.SourceReference, input.ImportBatchId);
        dbContext.WorkAssignments.Add(assignment);

        StageAudit("WorkAssignment", assignment.Id,
            isFirst ? WorkforceAuditAction.WorkAssignmentCreated : WorkforceAuditAction.WorkAssignmentChanged,
            input.Source, actor, effectiveDate, input.SourceReference, input.ImportBatchId,
            isFirst ? "Primary work assignment created." : "Primary work assignment changed.");

        return Result.Success(assignment);
    }

    public async Task<Result<WorkAssignment>> CorrectPrimaryWorkAssignmentAsync(
        Guid employeeId, CorrectWorkAssignmentInput input, string? actor, CancellationToken cancellationToken)
    {
        var assignment = await ResolveActivePrimaryAssignmentAsync(employeeId, DateTime.UtcNow, cancellationToken);
        if (assignment is null)
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.NoActivePrimary",
                "Employee has no active primary work assignment to update."));

        var orgUnit = await FindOrgUnitAsync(input.OrgUnitId, cancellationToken);
        if (orgUnit is null || orgUnit.TenantId != tenantContext.TenantId)
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.OrgUnitNotFound",
                "The work assignment organization unit was not found in this tenant."));
        if (!await IsOrgUnitActiveOnAsync(orgUnit.Id, DateOnly.FromDateTime(DateTime.UtcNow), orgUnit.IsActive, cancellationToken))
            return Result.Failure<WorkAssignment>(Error.Validation(
                "WorkAssignment.OrgUnitInactive",
                "Cannot assign an inactive organization unit."));

        var job = await _catalog.JobAsync(input.JobId, assignment.JobId, cancellationToken);
        if (job.IsFailure)
            return Result.Failure<WorkAssignment>(job.Error);
        var place = await _catalog.PlaceAsync(input.PlaceId, assignment.PlaceId, cancellationToken);
        if (place.IsFailure)
            return Result.Failure<WorkAssignment>(place.Error);

        assignment.UpdateDetails(input.OrgUnitId, job.Value, place.Value);

        StageAudit("WorkAssignment", assignment.Id, WorkforceAuditAction.WorkAssignmentChanged,
            input.Source, actor, effectiveDate: null, input.SourceReference, input.ImportBatchId,
            "Primary work assignment corrected.");

        return Result.Success(assignment);
    }

    public async Task<Result<ManagerRelationship>> ChangeManagerAsync(
        Guid employeeId, ChangeManagerInput input, string? actor, CancellationToken cancellationToken)
    {
        var effectiveDate = NormalizeDate(input.EffectiveDate);

        if (input.ManagerEmployeeId == Guid.Empty)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.Required", "A manager must be specified."));
        if (input.ManagerEmployeeId == employeeId)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.Self", "An employee cannot report to themselves."));

        var subjectAssignment = await ResolveActivePrimaryAssignmentAsync(employeeId, effectiveDate, cancellationToken);
        if (subjectAssignment is null)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.NoSubjectAssignment",
                "Employee has no active primary work assignment to attach a manager relationship to."));

        var managerAssignment = await ResolveActivePrimaryAssignmentAsync(input.ManagerEmployeeId, effectiveDate, cancellationToken);
        if (managerAssignment is null || managerAssignment.TenantId != tenantContext.TenantId)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.NoManagerAssignment",
                "The manager has no active primary work assignment in this tenant."));

        // Cycle guard: the prospective manager must not already report (directly or transitively) to the subject.
        var managerChain = await resolver.GetManagerChainAsync(
            input.ManagerEmployeeId, effectiveDate, ManagerChainGuardDepth, cancellationToken);
        if (managerChain.Contains(employeeId))
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.Cycle", "The requested manager change would create a reporting cycle."));

        var current = await ResolveActivePrimaryManagerRelationshipAsync(employeeId, effectiveDate, cancellationToken);
        if (current is not null)
        {
            if (effectiveDate <= current.EffectiveFrom)
                return Result.Failure<ManagerRelationship>(Error.Validation(
                    "Manager.EffectiveDateNotAfterCurrent",
                    "Manager change date must be after the current relationship's start date."));
            if (current.ManagerEmployeeId == input.ManagerEmployeeId)
                return Result.Failure<ManagerRelationship>(Error.Validation(
                    "Manager.Unchanged", "The employee already reports to this manager."));
        }

        current?.End(effectiveDate);

        var relationship = ManagerRelationship.Create(
            tenantContext.TenantId, employeeId, input.ManagerEmployeeId,
            subjectAssignment.Id, managerAssignment.Id,
            ReportingRelationshipType.PrimaryManager, effectiveDate,
            input.Source, effectiveTo: null, input.SourceReference, input.ImportBatchId);
        dbContext.ManagerRelationships.Add(relationship);

        StageAudit("ManagerRelationship", relationship.Id, WorkforceAuditAction.ManagerChanged,
            input.Source, actor, effectiveDate, input.SourceReference, input.ImportBatchId,
            "Primary manager changed.");

        return Result.Success(relationship);
    }

    public async Task<Result<ManagerRelationship?>> RemovePrimaryManagerAsync(
        Guid employeeId, DateTime effectiveDate, WorkforceSourceType source, string? sourceReference,
        Guid? importBatchId, string? actor, CancellationToken cancellationToken)
    {
        var at = NormalizeDate(effectiveDate);

        var current = await ResolveActivePrimaryManagerRelationshipAsync(employeeId, at, cancellationToken);
        if (current is null)
            return Result.Success<ManagerRelationship?>(null); // Already managerless — a valid no-op.

        if (at <= current.EffectiveFrom)
            return Result.Failure<ManagerRelationship?>(Error.Validation(
                "Manager.EffectiveDateNotAfterCurrent",
                "Manager change date must be after the current relationship's start date."));

        current.End(at);

        StageAudit("ManagerRelationship", current.Id, WorkforceAuditAction.ManagerChanged,
            source, actor, at, sourceReference, importBatchId, "Primary manager removed.");

        return Result.Success<ManagerRelationship?>(current);
    }

    public async Task<Result<ManagerRelationship>> AddDottedLineManagerAsync(
        Guid employeeId, ChangeManagerInput input, string? actor, CancellationToken cancellationToken)
    {
        var effectiveDate = NormalizeDate(input.EffectiveDate);

        if (input.ManagerEmployeeId == Guid.Empty)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.Required", "A manager must be specified."));
        if (input.ManagerEmployeeId == employeeId)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.Self", "An employee cannot report to themselves."));

        var subjectAssignment = await ResolveActivePrimaryAssignmentAsync(employeeId, effectiveDate, cancellationToken);
        if (subjectAssignment is null)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.NoSubjectAssignment",
                "Employee has no active primary work assignment to attach a manager relationship to."));

        var managerAssignment = await ResolveActivePrimaryAssignmentAsync(input.ManagerEmployeeId, effectiveDate, cancellationToken);
        if (managerAssignment is null || managerAssignment.TenantId != tenantContext.TenantId)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.NoManagerAssignment",
                "The manager has no active primary work assignment in this tenant."));

        var primary = await ResolveActivePrimaryManagerRelationshipAsync(employeeId, effectiveDate, cancellationToken);
        if (primary?.ManagerEmployeeId == input.ManagerEmployeeId)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.DottedLineIsPrimary", "This person is already the employee's manager."));

        if (await ResolveDottedLineAsync(employeeId, input.ManagerEmployeeId, effectiveDate, openOnly: false, cancellationToken) is not null)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.DottedLineExists", "The employee already has a dotted line to this manager."));

        var relationship = ManagerRelationship.Create(
            tenantContext.TenantId, employeeId, input.ManagerEmployeeId,
            subjectAssignment.Id, managerAssignment.Id,
            ReportingRelationshipType.SecondaryManager, effectiveDate,
            input.Source, effectiveTo: null, input.SourceReference, input.ImportBatchId);
        dbContext.ManagerRelationships.Add(relationship);

        StageAudit("ManagerRelationship", relationship.Id, WorkforceAuditAction.ManagerChanged,
            input.Source, actor, effectiveDate, input.SourceReference, input.ImportBatchId,
            "Dotted-line manager added.");

        return Result.Success(relationship);
    }

    public async Task<Result<ManagerRelationship>> EndDottedLineManagerAsync(
        Guid employeeId, ChangeManagerInput input, string? actor, CancellationToken cancellationToken)
    {
        var effectiveDate = NormalizeDate(input.EffectiveDate);

        var current = await ResolveDottedLineAsync(employeeId, input.ManagerEmployeeId, effectiveDate, openOnly: true, cancellationToken);
        if (current is null)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.DottedLineNotFound", "The employee has no dotted line to this manager on that date."));
        if (effectiveDate <= current.EffectiveFrom)
            return Result.Failure<ManagerRelationship>(Error.Validation(
                "Manager.EffectiveDateNotAfterCurrent",
                "Manager change date must be after the current relationship's start date."));

        current.End(effectiveDate);

        StageAudit("ManagerRelationship", current.Id, WorkforceAuditAction.ManagerChanged,
            input.Source, actor, effectiveDate, input.SourceReference, input.ImportBatchId,
            "Dotted-line manager ended.");

        return Result.Success(current);
    }

    /// <summary>
    /// The dotted line from employee to manager active on the date; with <paramref name="openOnly"/> false, also one
    /// that starts later (a second one would overlap it).
    /// </summary>
    private Task<ManagerRelationship?> ResolveDottedLineAsync(
        Guid employeeId, Guid managerId, DateTime asOf, bool openOnly, CancellationToken cancellationToken)
    {
        var lines = dbContext.ManagerRelationships.Where(
            m => m.SubjectEmployeeId == employeeId
                && m.ManagerEmployeeId == managerId
                && m.Type == ReportingRelationshipType.SecondaryManager
                && (m.EffectiveTo == null || asOf < m.EffectiveTo));
        if (openOnly) lines = lines.Where(m => m.EffectiveFrom <= asOf);
        return lines.FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<Result<Employment>> EndEmploymentReleasingReportsAsync(
        Guid employeeId, EndEmploymentInput input, string? actor, CancellationToken cancellationToken)
    {
        var lastEmployed = NormalizeDate(input.LastEmployedDate);
        var boundary = lastEmployed.AddDays(1); // Employed THROUGH lastEmployed; inactive AFTER it.

        var employment = await ResolveActiveEmploymentAsync(employeeId, lastEmployed, cancellationToken);
        if (employment is null)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.NoActive", "Employee has no active employment to end."));

        if (boundary <= employment.EffectiveFrom)
            return Result.Failure<Employment>(Error.Validation(
                "Employment.EndBeforeStart", "Last employed date must fall on or after the employment start date."));

        // The employee's own primary reporting link closes at the boundary (resolved by employee,
        // so a prior Change Work that superseded the assignment does not orphan it).
        var ownManager = await ResolveActivePrimaryManagerRelationshipAsync(employeeId, lastEmployed, cancellationToken);
        ownManager?.End(boundary);

        // Dotted lines end with the employment on either side: theirs, and the ones others hold to them.
        var dottedLines = await dbContext.ManagerRelationships
            .Where(m => m.Type == ReportingRelationshipType.SecondaryManager
                && (m.SubjectEmployeeId == employeeId || m.ManagerEmployeeId == employeeId)
                && m.EffectiveFrom <= lastEmployed
                && (m.EffectiveTo == null || boundary < m.EffectiveTo))
            .ToListAsync(cancellationToken);
        foreach (var dottedLine in dottedLines)
            dottedLine.End(boundary);

        // Direct reports are RELEASED (left managerless), not blocked. They are found by the manager, not the
        // manager's current assignment: a report linked before the manager's last work change still reports to them.
        var reportRelationships = await ResolveActiveManagerSideRelationshipsAsync(employeeId, lastEmployed, cancellationToken);
        foreach (var relationship in reportRelationships)
            relationship.End(boundary);

        var assignment = await ResolveActivePrimaryAssignmentAsync(employeeId, lastEmployed, cancellationToken);
        assignment?.End(boundary);

        employment.End(boundary);

        var occupancy = await _workEmailOccupancyService.SynchronizeAsync(employeeId, cancellationToken);
        if (occupancy.IsFailure)
            return Result.Failure<Employment>(occupancy.Error);

        StageAudit("Employment", employment.Id, WorkforceAuditAction.EmploymentEnded,
            input.Source, actor, boundary, input.SourceReference, input.ImportBatchId,
            BuildEndEmploymentAuditDetails(input.Note));

        return Result.Success(employment);
    }

    public async Task<Result<EndEmploymentPreview>> PreviewEndEmploymentAsync(
        Guid employeeId, DateTime lastEmployedDate, CancellationToken cancellationToken)
    {
        var lastEmployed = NormalizeDate(lastEmployedDate);

        var reports = await ResolveBlockingDirectReportsAsync(employeeId, lastEmployed, cancellationToken);
        var affected = reports
            .Select(employee => new AffectedDirectReport(employee.Id, employee.DisplayName, employee.EmployeeNumber))
            .ToList();

        return Result.Success(new EndEmploymentPreview(lastEmployed, affected.Count, affected));
    }

    // --- Unit-of-work aware lookups (staged adds first, then persisted, tracked for mutation) -------

    private async Task<Employee?> FindEmployeeAsync(Guid employeeId, CancellationToken cancellationToken)
    {
        var local = _resolutionScope.TrackedGraphOnly
            ? _resolutionScope.FindEmployee(employeeId)
            : dbContext.Employees.Local.FirstOrDefault(e => e.Id == employeeId);
        if (local is not null || _resolutionScope.TrackedGraphOnly)
            return local;
        return await dbContext.Employees.FirstOrDefaultAsync(e => e.Id == employeeId, cancellationToken);
    }

    private async Task<OrgUnit?> FindOrgUnitAsync(Guid orgUnitId, CancellationToken cancellationToken)
    {
        var local = _resolutionScope.TrackedGraphOnly
            ? _resolutionScope.FindOrgUnit(orgUnitId)
            : dbContext.OrgUnits.Local.FirstOrDefault(o => o.Id == orgUnitId);
        if (local is not null || _resolutionScope.TrackedGraphOnly)
            return local;
        return await dbContext.OrgUnits.FirstOrDefaultAsync(o => o.Id == orgUnitId, cancellationToken);
    }

    private async Task<bool> IsOrgUnitActiveOnAsync(Guid orgUnitId, DateOnly asOf, bool legacyIsActive, CancellationToken cancellationToken)
    {
        var state = await dbContext.OrgUnitEffectiveStates
            .Where(item => item.OrgUnitId == orgUnitId
                && item.EffectiveFrom <= asOf
                && (item.EffectiveTo == null || asOf < item.EffectiveTo))
            .Select(item => (OrgUnitLifecycleState?)item.LifecycleState)
            .FirstOrDefaultAsync(cancellationToken);
        if (state.HasValue)
            return state == OrgUnitLifecycleState.Active;

        var hasCanonicalTimeline = await dbContext.OrgUnitEffectiveStates
            .AnyAsync(item => item.OrgUnitId == orgUnitId, cancellationToken);
        return hasCanonicalTimeline ? false : legacyIsActive;
    }

    private async Task<Employment?> ResolveActiveEmploymentAsync(Guid employeeId, DateTime asOf, CancellationToken cancellationToken)
    {
        var local = _resolutionScope.TrackedGraphOnly
            ? _resolutionScope.ResolveActiveEmployment(employeeId, asOf)
            : dbContext.Employments.Local.FirstOrDefault(
                e => e.EmployeeId == employeeId && e.Status == EmploymentStatus.Active && e.IsActiveOn(asOf));
        if (local is not null || _resolutionScope.TrackedGraphOnly)
            return local;

        return await dbContext.Employments.FirstOrDefaultAsync(
            e => e.EmployeeId == employeeId
                && e.Status == EmploymentStatus.Active
                && e.EffectiveFrom <= asOf
                && (e.EffectiveTo == null || asOf < e.EffectiveTo),
            cancellationToken);
    }

    private async Task<WorkAssignment?> ResolveActivePrimaryAssignmentAsync(Guid employeeId, DateTime asOf, CancellationToken cancellationToken)
    {
        var local = _resolutionScope.TrackedGraphOnly
            ? _resolutionScope.ResolveActivePrimaryAssignment(employeeId, asOf)
            : dbContext.WorkAssignments.Local.FirstOrDefault(
                w => w.EmployeeId == employeeId && w.IsPrimary && w.IsActiveOn(asOf));
        if (local is not null || _resolutionScope.TrackedGraphOnly)
            return local;

        return await dbContext.WorkAssignments.FirstOrDefaultAsync(
            w => w.EmployeeId == employeeId
                && w.IsPrimary
                && w.EffectiveFrom <= asOf
                && (w.EffectiveTo == null || asOf < w.EffectiveTo),
            cancellationToken);
    }

    private async Task<ManagerRelationship?> ResolveActivePrimaryManagerRelationshipAsync(Guid employeeId, DateTime asOf, CancellationToken cancellationToken)
    {
        var local = _resolutionScope.TrackedGraphOnly
            ? _resolutionScope.ResolveActivePrimaryManagerRelationship(employeeId, asOf)
            : dbContext.ManagerRelationships.Local.FirstOrDefault(
                m => m.SubjectEmployeeId == employeeId
                    && m.Type == ReportingRelationshipType.PrimaryManager
                    && m.IsActiveOn(asOf));
        if (local is not null || _resolutionScope.TrackedGraphOnly)
            return local;

        return await dbContext.ManagerRelationships.FirstOrDefaultAsync(
            m => m.SubjectEmployeeId == employeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= asOf
                && (m.EffectiveTo == null || asOf < m.EffectiveTo),
            cancellationToken);
    }

    private async Task<List<ManagerRelationship>> ResolveActiveSubjectManagerRelationshipsAsync(
        Guid subjectWorkAssignmentId,
        DateTime asOf,
        CancellationToken cancellationToken)
    {
        var locals = dbContext.ManagerRelationships.Local
            .Where(m => m.SubjectWorkAssignmentId == subjectWorkAssignmentId && m.IsActiveOn(asOf))
            .ToList();

        var localIds = locals.Select(m => m.Id).ToHashSet();
        var persisted = await dbContext.ManagerRelationships
            .Where(m => m.SubjectWorkAssignmentId == subjectWorkAssignmentId
                && m.EffectiveFrom <= asOf
                && (m.EffectiveTo == null || asOf < m.EffectiveTo)
                && !localIds.Contains(m.Id))
            .ToListAsync(cancellationToken);

        return [.. locals, .. persisted];
    }

    private async Task<List<ManagerRelationship>> ResolveActiveManagerSideRelationshipsAsync(
        Guid managerEmployeeId,
        DateTime asOf,
        CancellationToken cancellationToken)
    {
        var locals = dbContext.ManagerRelationships.Local
            .Where(m => m.ManagerEmployeeId == managerEmployeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.IsActiveOn(asOf))
            .ToList();

        var localIds = locals.Select(m => m.Id).ToHashSet();
        var persisted = await dbContext.ManagerRelationships
            .Where(m => m.ManagerEmployeeId == managerEmployeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= asOf
                && (m.EffectiveTo == null || asOf < m.EffectiveTo)
                && !localIds.Contains(m.Id))
            .ToListAsync(cancellationToken);

        return [.. locals, .. persisted];
    }

    private async Task<List<Employee>> ResolveBlockingDirectReportsAsync(
        Guid managerEmployeeId,
        DateTime asOf,
        CancellationToken cancellationToken)
    {
        var localRelationships = dbContext.ManagerRelationships.Local
            .Where(m => m.ManagerEmployeeId == managerEmployeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.IsActiveOn(asOf))
            .ToList();

        var localRelationshipIds = localRelationships.Select(m => m.Id).ToHashSet();
        var persistedRelationships = await dbContext.ManagerRelationships
            .Where(m => m.ManagerEmployeeId == managerEmployeeId
                && m.Type == ReportingRelationshipType.PrimaryManager
                && m.EffectiveFrom <= asOf
                && (m.EffectiveTo == null || asOf < m.EffectiveTo)
                && !localRelationshipIds.Contains(m.Id))
            .ToListAsync(cancellationToken);

        var blockedEmployeeIds = localRelationships
            .Concat(persistedRelationships)
            .Select(m => m.SubjectEmployeeId)
            .Distinct()
            .ToList();

        if (blockedEmployeeIds.Count == 0)
        {
            return new List<Employee>();
        }

        var localEmployees = dbContext.Employees.Local
            .Where(e => blockedEmployeeIds.Contains(e.Id))
            .ToList();
        var localEmployeeIds = localEmployees.Select(e => e.Id).ToHashSet();
        var persistedEmployees = await dbContext.Employees
            .Where(e => blockedEmployeeIds.Contains(e.Id) && !localEmployeeIds.Contains(e.Id))
            .ToListAsync(cancellationToken);

        return localEmployees
            .Concat(persistedEmployees)
            .OrderBy(e => e.LastName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.FirstName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private void StageAudit(
        string entityType, Guid entityId, WorkforceAuditAction action, WorkforceSourceType source,
        string? actor, DateTime? effectiveDate, string? sourceReference, Guid? importBatchId, string? changeDetails)
    {
        dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
            tenantContext.TenantId, entityType, entityId, action, source, actor,
            effectiveDate, sourceReference, importBatchId, changeDetails));
    }

    private static DateTime NormalizeDate(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };

    private static string BuildTerminationAuditDetails(string? note)
        => string.IsNullOrWhiteSpace(note)
            ? "Employee terminated."
            : $"Employee terminated. Note: {note.Trim()}";

    private static string BuildEndEmploymentAuditDetails(string? note)
        => string.IsNullOrWhiteSpace(note)
            ? "Employment ended."
            : $"Employment ended. Note: {note.Trim()}";

    private static string BuildTerminationBlockedMessage(IReadOnlyList<Employee> directReports)
        => $"Termination is blocked until these direct reports are reassigned effective on or before the termination date: {string.Join(", ", directReports.Select(FormatEmployeeReference))}.";

    private static string FormatEmployeeReference(Employee employee)
        => string.IsNullOrWhiteSpace(employee.EmployeeNumber)
            ? $"{employee.FirstName} {employee.LastName} <{employee.Email}>"
            : $"{employee.FirstName} {employee.LastName} ({employee.EmployeeNumber})";
}
