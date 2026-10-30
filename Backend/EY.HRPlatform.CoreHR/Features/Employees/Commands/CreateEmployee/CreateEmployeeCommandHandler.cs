using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Employees.Commands.CreateEmployee;

public sealed class CreateEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IWorkforceMutationService? workforceMutationService = null,
    IEmployeeDetailsReadModelService? employeeDetailsReadModelService = null,
    ITenantSettingsReadService? tenantSettingsReadService = null,
    IEmployeeNumberAllocator? employeeNumberAllocator = null)
    : ICommandHandler<CreateEmployeeCommand, Result<EmployeeDetailsDto>>
{
    private readonly IWorkforceMutationService workforceMutationService =
        workforceMutationService ?? new WorkforceMutationService(dbContext, tenantContext, new WorkforceCanonicalResolver(dbContext));

    private readonly IEmployeeDetailsReadModelService employeeDetailsReadModelService =
        employeeDetailsReadModelService ?? new EmployeeDetailsReadModelService(
            dbContext,
            new WorkforceCanonicalResolver(dbContext),
            tenantSettingsReadService ?? new TenantSettingsReadService(dbContext));

    private readonly ITenantSettingsReadService tenantSettingsReader =
        tenantSettingsReadService ?? new TenantSettingsReadService(dbContext);

    private readonly IEmployeeNumberAllocator employeeNumberAllocator =
        employeeNumberAllocator ?? new EmployeeNumberAllocatorService(dbContext, tenantContext);

    private static readonly HashSet<string> OperationallyRequiredFields =
        ["firstName", "lastName", "hireDate", "jobTitle"];

    public async Task<Result<EmployeeDetailsDto>> Handle(CreateEmployeeCommand request, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var settings = await tenantSettingsReader.GetCurrentAsync(cancellationToken);

        ValidateConfiguredRequiredField(request.FirstName, "firstName", "First name", settings, true);
        ValidateConfiguredRequiredField(request.LastName, "lastName", "Last name", settings, true);
        ValidateConfiguredRequiredField(request.Email, "email", "Email", settings, false);
        ValidateConfiguredRequiredField(request.Phone, "phone", "Phone", settings, false);
        ValidateConfiguredRequiredField(request.JobId?.ToString(), "jobTitle", "Job title", settings, false);
        ValidateConfiguredRequiredField(request.PlaceId?.ToString(), "workLocation", "Work location", settings, false);
        ValidateConfiguredRequiredField(request.EmploymentTypeId?.ToString(), "employmentType", "Employment type", settings, false);

        if (!request.OrgUnitId.HasValue || request.OrgUnitId.Value == Guid.Empty)
        {
            return Result.Failure<EmployeeDetailsDto>(Error.Validation(
                "WorkAssignment.OrgUnitRequired",
                "An active organization unit is required to create the employee's primary work assignment."));
        }

        var useTransaction = dbContext.Database.IsRelational();
        await using var transaction = useTransaction
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var normalizedEmail = string.IsNullOrWhiteSpace(request.Email)
            ? null
            : request.Email.Trim().ToLowerInvariant();
        var normalizedEmployeeNumber = string.IsNullOrWhiteSpace(request.EmployeeNumber)
            ? await employeeNumberAllocator.AllocateAsync(cancellationToken)
            : request.EmployeeNumber.Trim().ToUpperInvariant();

        if (!string.IsNullOrWhiteSpace(request.EmployeeNumber))
        {
            var employeeNumberExists = await dbContext.Employees
                .AnyAsync(e => e.EmployeeNumber == normalizedEmployeeNumber, cancellationToken);

            if (employeeNumberExists)
            {
                return Result.Failure<EmployeeDetailsDto>(Error.Conflict(
                    "Employee.DuplicateEmployeeNumber",
                    $"Employee number '{normalizedEmployeeNumber}' is already in use."));
            }
        }

        var employee = Employee.Create(
            tenantId,
            request.FirstName,
            request.LastName,
            normalizedEmail,
            employeeNumber: normalizedEmployeeNumber,
            phone: request.Phone);

        dbContext.Employees.Add(employee);

        var employmentResult = await workforceMutationService.StartEmploymentAsync(
            employee.Id,
            new StartEmploymentInput(request.HireDate, request.EmploymentTypeId),
            actor: null,
            cancellationToken);
        if (employmentResult.IsFailure)
        {
            return Result.Failure<EmployeeDetailsDto>(employmentResult.Error);
        }

        var assignmentResult = await workforceMutationService.ChangeWorkAssignmentAsync(
            employee.Id,
            new ChangeWorkAssignmentInput(
                request.OrgUnitId.Value,
                request.JobId ?? Guid.Empty,
                request.PlaceId,
                request.HireDate),
            actor: null,
            cancellationToken);
        if (assignmentResult.IsFailure)
        {
            return Result.Failure<EmployeeDetailsDto>(assignmentResult.Error);
        }

        if (request.ManagerId.HasValue)
        {
            var managerResult = await workforceMutationService.ChangeManagerAsync(
                employee.Id,
                new ChangeManagerInput(request.ManagerId.Value, request.HireDate),
                actor: null,
                cancellationToken);
            if (managerResult.IsFailure)
            {
                return Result.Failure<EmployeeDetailsDto>(managerResult.Error);
            }
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null)
                await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            return Result.Failure<EmployeeDetailsDto>(ResolveDuplicateError(ex, normalizedEmployeeNumber));
        }

        var details = await employeeDetailsReadModelService.BuildAsync(
            employee,
            EmployeeReadAudience.HrAdmin,
            request.HireDate,
            cancellationToken);

        return Result.Success(details);
    }

    private static void ValidateConfiguredRequiredField(
        string? requestedValue,
        string fieldKey,
        string displayName,
        TenantSettingsDto settings,
        bool fallbackRequired)
    {
        if (!IsFieldRequired(settings, fieldKey, fallbackRequired))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(requestedValue))
        {
            throw new ArgumentException($"{displayName} is required.", fieldKey);
        }
    }

    private static bool IsFieldRequired(TenantSettingsDto settings, string fieldKey, bool fallbackRequired)
        => OperationallyRequiredFields.Contains(fieldKey)
            || (settings.EmployeeFieldConfig.TryGetValue(fieldKey, out var fieldConfig)
                ? fieldConfig.Required
                : fallbackRequired);

    private static bool IsUniqueConstraintViolation(DbUpdateException ex)
        => ex.InnerException?.Message.Contains("23505") == true
            || ex.InnerException?.Message.Contains("unique constraint") == true
            || ex.InnerException?.Message.Contains("duplicate key") == true;

    private static Error ResolveDuplicateError(
        DbUpdateException ex,
        string normalizedEmployeeNumber)
    {
        if (ex.InnerException?.Message.Contains("IX_Employees_TenantId_EmployeeNumber") == true
            && !string.IsNullOrWhiteSpace(normalizedEmployeeNumber))
        {
            return Error.Conflict(
                "Employee.DuplicateEmployeeNumber",
                $"Employee number '{normalizedEmployeeNumber}' is already in use.");
        }

        if (ex.InnerException?.Message.Contains("UX_WorkEmailOccupancies_TenantId_NormalizedEmail") == true)
        {
            return Error.Conflict(
                "Employee.EmailOccupied",
                "This work email is already used by a scheduled or active employee.");
        }

        return Error.Conflict("Employee.Duplicate", "The employee conflicts with an existing workforce record.");
    }
}
