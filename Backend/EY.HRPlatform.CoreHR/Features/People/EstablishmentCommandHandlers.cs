using System.Data;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed class HireEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IEmployeeNumberAllocator employeeNumberAllocator,
    IWorkforceMutationService mutationService,
    IOrganizationService organizationService,
    CoreChangeNotifications? notifications = null)
    : ICommandHandler<HireEmployeeCommand, Result<EstablishmentResultDto>>
{
    public Task<Result<EstablishmentResultDto>> Handle(HireEmployeeCommand command, CancellationToken cancellationToken)
        => EstablishmentOrchestrator.ExecuteAsync(
            dbContext,
            tenantContext,
            employeeNumberAllocator,
            mutationService,
            organizationService,
            EstablishmentInput.FromHire(command.Request),
            command.Actor,
            cancellationToken,
            notifications);
}

public sealed class AddExistingEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IEmployeeNumberAllocator employeeNumberAllocator,
    IWorkforceMutationService mutationService,
    IOrganizationService organizationService)
    : ICommandHandler<AddExistingEmployeeCommand, Result<EstablishmentResultDto>>
{
    public Task<Result<EstablishmentResultDto>> Handle(AddExistingEmployeeCommand command, CancellationToken cancellationToken)
        => EstablishmentOrchestrator.ExecuteAsync(
            dbContext,
            tenantContext,
            employeeNumberAllocator,
            mutationService,
            organizationService,
            EstablishmentInput.FromAddExisting(command.Request),
            command.Actor,
            cancellationToken);
}

internal sealed record EstablishmentInput(
    string FirstName,
    string LastName,
    string? PreferredName,
    string? WorkEmail,
    string? Phone,
    EmployeeNumberMode NumberMode,
    string? ManualEmployeeNumber,
    DateTime EmploymentStart,
    DateTime WorkEffectiveFrom,
    Guid? EmploymentTypeId,
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId,
    Guid? ManagerEmployeeId,
    WorkforceAuditAction EstablishmentAction)
{
    public static EstablishmentInput FromHire(HireEmployeeRequest request) => new(
        request.FirstName, request.LastName, request.PreferredName, request.WorkEmail, request.Phone,
        request.EmployeeNumberMode, request.EmployeeNumber, request.StartDate, request.StartDate,
        request.EmploymentTypeId, request.OrgUnitId, request.JobId, request.PlaceId,
        request.PrimaryManagerEmployeeId, WorkforceAuditAction.Hire);

    public static EstablishmentInput FromAddExisting(AddExistingEmployeeRequest request) => new(
        request.FirstName, request.LastName, request.PreferredName, request.WorkEmail, request.Phone,
        request.EmployeeNumberMode, request.EmployeeNumber, request.EmploymentStart, request.WorkDetailsEffectiveFrom,
        request.EmploymentTypeId, request.OrgUnitId, request.JobId, request.PlaceId,
        request.PrimaryManagerEmployeeId, WorkforceAuditAction.Establish);
}

internal static class EstablishmentOrchestrator
{
    public static async Task<Result<EstablishmentResultDto>> ExecuteAsync(
        CoreHRDbContext dbContext,
        ITenantContext tenantContext,
        IEmployeeNumberAllocator employeeNumberAllocator,
        IWorkforceMutationService mutationService,
        IOrganizationService organizationService,
        EstablishmentInput input,
        string actor,
        CancellationToken cancellationToken,
        CoreChangeNotifications? notifications = null)
    {
        var employmentStart = NormalizeDate(input.EmploymentStart);
        var workEffectiveFrom = NormalizeDate(input.WorkEffectiveFrom);
        var today = DateTime.UtcNow.Date;

        var validation = Validate(input, employmentStart, workEffectiveFrom, today);
        if (validation is not null)
            return Result.Failure<EstablishmentResultDto>(validation);

        var useTransaction = dbContext.Database.IsRelational();
        await using var transaction = useTransaction
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        try
        {
            var number = input.NumberMode == EmployeeNumberMode.Generated
                ? await employeeNumberAllocator.AllocateAsync(cancellationToken)
                : input.ManualEmployeeNumber!.Trim().ToUpperInvariant();
            var numberOwner = await dbContext.Employees.AsNoTracking()
                .Where(employee => employee.EmployeeNumber == number)
                .Select(employee => new
                {
                    employee.StableEmployeeKey,
                    DisplayName = (employee.PreferredName ?? employee.FirstName) + " " + employee.LastName
                })
                .FirstOrDefaultAsync(cancellationToken);
            if (numberOwner is not null)
            {
                await RollbackAsync(transaction, cancellationToken);
                return Result.Failure<EstablishmentResultDto>(Error.Conflict(
                    "EmployeeNumber.AlreadyOwned",
                    $"Employee number {number} already belongs to {numberOwner.DisplayName}. Open /core/people/{numberOwner.StableEmployeeKey}."));
            }

            var suggestions = await FindSuggestionsAsync(dbContext, input, cancellationToken);
            var employee = Employee.Create(
                tenantContext.TenantId,
                input.FirstName,
                input.LastName,
                input.WorkEmail,
                employmentStart,
                department: null,
                jobTitle: null,
                employeeNumber: number,
                phone: input.Phone,
                workLocation: null,
                employmentType: null);
            if (!string.IsNullOrWhiteSpace(input.PreferredName))
                employee.UpdateProfile(input.FirstName, input.LastName, input.WorkEmail, input.PreferredName, input.Phone);
            dbContext.Employees.Add(employee);

            var employmentResult = await mutationService.StartEmploymentAsync(
                employee.Id,
                new StartEmploymentInput(employmentStart, input.EmploymentTypeId, WorkforceSourceType.Manual),
                actor,
                cancellationToken);
            if (employmentResult.IsFailure)
                return await FailAsync(dbContext, transaction, employmentResult.Error, cancellationToken);

            var assignmentResult = await mutationService.ChangeWorkAssignmentAsync(
                employee.Id,
                new ChangeWorkAssignmentInput(
                    input.OrgUnitId,
                    input.JobId,
                    input.PlaceId,
                    workEffectiveFrom,
                    WorkforceSourceType.Manual),
                actor,
                cancellationToken);
            if (assignmentResult.IsFailure)
                return await FailAsync(dbContext, transaction, assignmentResult.Error, cancellationToken);

            string? managerName = null;
            if (input.ManagerEmployeeId.HasValue)
            {
                var managerResult = await mutationService.ChangeManagerAsync(
                    employee.Id,
                    new ChangeManagerInput(
                        input.ManagerEmployeeId.Value,
                        workEffectiveFrom,
                        WorkforceSourceType.Manual),
                    actor,
                    cancellationToken);
                if (managerResult.IsFailure)
                    return await FailAsync(dbContext, transaction, managerResult.Error, cancellationToken);

                managerName = await dbContext.Employees
                    .Where(item => item.Id == input.ManagerEmployeeId.Value)
                    .Select(item => (item.PreferredName ?? item.FirstName) + " " + item.LastName)
                    .FirstAsync(cancellationToken);
            }

            var orgUnit = await organizationService.GetUnitAsync(
                input.OrgUnitId,
                DateOnly.FromDateTime(workEffectiveFrom),
                cancellationToken);
            dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
                tenantContext.TenantId,
                "Employee",
                employee.Id,
                input.EstablishmentAction,
                WorkforceSourceType.Manual,
                actor,
                employmentStart,
                changeDetails: input.EstablishmentAction == WorkforceAuditAction.Hire
                    ? $"Hire established Employment and work from {employmentStart:yyyy-MM-dd}."
                    : $"Employee established with Employment from {employmentStart:yyyy-MM-dd} and work from {workEffectiveFrom:yyyy-MM-dd}."));

            if (input.EstablishmentAction == WorkforceAuditAction.Hire)
            {
                // A hire is a Join change, so a scheduled one shows as coming and can be cancelled.
                var manager = input.ManagerEmployeeId is { } managerId
                    ? Changes.WorkforceChangeService.Ref(await dbContext.Employees.FirstAsync(item => item.Id == managerId, cancellationToken))
                    : null;
                var details = Changes.WorkforceChangeService.JoinDetails(
                    manager, input.OrgUnitId, orgUnit.Name, assignmentResult.Value, employmentResult.Value, isHire: true);
                var change = Changes.WorkforceChangeRecorder.Record(
                    dbContext, tenantContext.TenantId, employee.Id, WorkforceChangeKind.Join, DateOnly.FromDateTime(employmentStart), null,
                    details, actor);
                // The new hire's manager hears who joins their team.
                if (notifications is not null)
                    await notifications.StageAsync(change, details, cancellationToken);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
                await transaction.CommitAsync(cancellationToken);

            return Result.Success(new EstablishmentResultDto(
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                employee.DisplayName,
                employee.Email,
                employmentStart > today ? PeopleEmploymentState.Scheduled : PeopleEmploymentState.Active,
                employmentStart,
                workEffectiveFrom,
                assignmentResult.Value.JobTitle,
                orgUnit.Name,
                orgUnit.Path,
                assignmentResult.Value.WorkLocation,
                managerName,
                suggestions));
        }
        catch (DbUpdateException exception) when (TryMapConstraint(exception, out var error))
        {
            await RollbackAsync(transaction, cancellationToken);
            dbContext.ChangeTracker.Clear();
            return Result.Failure<EstablishmentResultDto>(error);
        }
        catch
        {
            await RollbackAsync(transaction, cancellationToken);
            dbContext.ChangeTracker.Clear();
            throw;
        }
    }

    private static Error? Validate(
        EstablishmentInput input,
        DateTime employmentStart,
        DateTime workEffectiveFrom,
        DateTime today)
    {
        if (string.IsNullOrWhiteSpace(input.FirstName) || string.IsNullOrWhiteSpace(input.LastName))
            return Error.Validation("Employee.NameRequired", "First name and last name are required.");
        if (input.OrgUnitId == Guid.Empty)
            return Error.Validation("WorkAssignment.OrgUnitRequired", "Organization is required.");
        if (input.JobId == Guid.Empty)
            return Error.Validation("WorkAssignment.JobRequired", "Pick a job.");
        if (input.NumberMode == EmployeeNumberMode.Manual && string.IsNullOrWhiteSpace(input.ManualEmployeeNumber))
            return Error.Validation("EmployeeNumber.Required", "Enter an Employee Number or choose Generate automatically.");
        if (input.NumberMode == EmployeeNumberMode.Generated && !string.IsNullOrWhiteSpace(input.ManualEmployeeNumber))
            return Error.Validation("EmployeeNumber.ModeMismatch", "Generated Employee Numbers cannot include a manual value.");
        if (input.EstablishmentAction == WorkforceAuditAction.Hire && employmentStart < today)
            return Error.Validation("Hire.StartDatePast", "Hire start date must be Today or later. Use Add existing employee for a past start.");
        if (input.EstablishmentAction == WorkforceAuditAction.Establish && employmentStart > today)
            return Error.Validation("Establish.StartDateFuture", "Employment start cannot be in the future. Use Hire employee instead.");
        if (workEffectiveFrom < employmentStart
            || (workEffectiveFrom > today && input.EstablishmentAction == WorkforceAuditAction.Establish))
            return Error.Validation("Establish.DateOrder", "Work details effective from must be on or after Employment start and no later than Today.");
        if (input.EstablishmentAction == WorkforceAuditAction.Hire && workEffectiveFrom != employmentStart)
            return Error.Validation("Hire.DateAlignment", "Hire work details must begin on the Employment start date.");
        return null;
    }

    private static async Task<IReadOnlyList<EstablishmentSuggestionDto>> FindSuggestionsAsync(
        CoreHRDbContext dbContext,
        EstablishmentInput input,
        CancellationToken cancellationToken)
    {
        var first = input.FirstName.Trim().ToLowerInvariant();
        var last = input.LastName.Trim().ToLowerInvariant();
        var email = string.IsNullOrWhiteSpace(input.WorkEmail) ? null : input.WorkEmail.Trim().ToLowerInvariant();
        return await dbContext.Employees.AsNoTracking()
            .Where(employee =>
                (employee.FirstName.ToLower() == first && employee.LastName.ToLower() == last)
                || (email != null && employee.Email == email))
            .OrderBy(employee => employee.LastName)
            .ThenBy(employee => employee.FirstName)
            .Take(3)
            .Select(employee => new EstablishmentSuggestionDto(
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                (employee.PreferredName ?? employee.FirstName) + " " + employee.LastName,
                email != null && employee.Email == email ? "Same work email" : "Same name"))
            .ToListAsync(cancellationToken);
    }

    private static async Task<Result<EstablishmentResultDto>> FailAsync(
        CoreHRDbContext dbContext,
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction,
        Error error,
        CancellationToken cancellationToken)
    {
        await RollbackAsync(transaction, cancellationToken);
        dbContext.ChangeTracker.Clear();
        return Result.Failure<EstablishmentResultDto>(error);
    }

    private static async Task RollbackAsync(
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? transaction,
        CancellationToken cancellationToken)
    {
        if (transaction is not null)
            await transaction.RollbackAsync(cancellationToken);
    }

    private static bool TryMapConstraint(DbUpdateException exception, out Error error)
    {
        var postgres = exception.InnerException as PostgresException;
        error = postgres?.ConstraintName switch
        {
            "IX_Employees_TenantId_EmployeeNumber" => Error.Conflict(
                "EmployeeNumber.AlreadyOwned", "That Employee Number was just assigned. Review the existing Employee and choose another number."),
            "UX_WorkEmailOccupancies_TenantId_NormalizedEmail" => Error.Conflict(
                "WorkEmail.Occupied", "That work email is already used by an active or scheduled Employee."),
            _ => Error.Conflict("Establishment.ConcurrentChange", "The workforce changed while this employee was being added. Review and try again.")
        };
        return postgres?.SqlState == PostgresErrorCodes.UniqueViolation;
    }

    private static DateTime NormalizeDate(DateTime value)
        => DateTime.SpecifyKind(value.Date, DateTimeKind.Utc);
}
