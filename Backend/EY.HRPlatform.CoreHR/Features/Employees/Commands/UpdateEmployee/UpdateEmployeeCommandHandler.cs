using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Exceptions;
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

namespace EY.HRPlatform.CoreHR.Features.Employees.Commands.UpdateEmployee;

public sealed class UpdateEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IWorkforceMutationService? workforceMutationService = null,
    IEmployeeDetailsReadModelService? employeeDetailsReadModelService = null,
    ITenantSettingsReadService? tenantSettingsReadService = null)
    : ICommandHandler<UpdateEmployeeCommand, Result<EmployeeDetailsDto>>
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

    private readonly IWorkforceCanonicalResolver workforceCanonicalResolver = new WorkforceCanonicalResolver(dbContext);

    private static readonly HashSet<string> OperationallyRequiredFields =
        ["firstName", "lastName", "jobTitle"];

    public async Task<Result<EmployeeDetailsDto>> Handle(UpdateEmployeeCommand request, CancellationToken cancellationToken)
    {
        var employee = await dbContext.Employees
            .FirstOrDefaultAsync(e => e.Id == request.EmployeeId, cancellationToken);

        if (employee is null)
        {
            throw new EntityNotFoundException("Employee", request.EmployeeId);
        }

        if (employee.Version != request.ExpectedVersion)
        {
            throw new ConcurrencyException("Employee", request.EmployeeId);
        }

        var settings = await tenantSettingsReader.GetCurrentAsync(cancellationToken);
        ValidateConfiguredRequiredField(request.FirstName, "firstName", "First name", settings, true);
        ValidateConfiguredRequiredField(request.LastName, "lastName", "Last name", settings, true);
        ValidateConfiguredRequiredField(request.Email, "email", "Email", settings, false);
        ValidateConfiguredRequiredField(request.Phone, "phone", "Phone", settings, false);
        ValidateConfiguredRequiredField(request.JobId?.ToString(), "jobTitle", "Job title", settings, false);
        ValidateConfiguredRequiredField(request.PlaceId?.ToString(), "workLocation", "Work location", settings, false);
        ValidateConfiguredRequiredField(request.EmploymentTypeId?.ToString(), "employmentType", "Employment type", settings, false);

        if (request.ManagerId.HasValue)
        {
            return Result.Failure<EmployeeDetailsDto>(Error.Validation(
                "Employee.UpdateManagerRequiresDedicatedAction",
                "Manager changes must use POST /api/corehr/employees/{id}/change-manager."));
        }

        var currentEmployment = await workforceCanonicalResolver.GetCurrentEmploymentAsync(employee.Id, DateTime.UtcNow, cancellationToken);
        if (request.HireDate.HasValue
            && (currentEmployment is null || request.HireDate.Value != currentEmployment.EffectiveFrom))
        {
            return Result.Failure<EmployeeDetailsDto>(Error.Validation(
                "Employee.UpdateHireDateRequiresDedicatedAction",
                "Employment start-date changes require a dedicated lifecycle action."));
        }

        var firstName = request.FirstName ?? employee.FirstName;
        var lastName = request.LastName ?? employee.LastName;
        var preferredName = request.PreferredName ?? employee.PreferredName;
        var email = request.Email is null ? employee.Email : request.Email;
        var phone = request.Phone ?? employee.Phone;
        var employeeNumber = request.EmployeeNumber ?? employee.EmployeeNumber;

        var normalizedEmail = string.IsNullOrWhiteSpace(email)
            ? null
            : email.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(employeeNumber))
            throw new ArgumentException("Employee Number is required.", nameof(request.EmployeeNumber));
        var normalizedEmployeeNumber = employeeNumber.Trim().ToUpperInvariant();

        if (!string.Equals(normalizedEmployeeNumber, employee.EmployeeNumber, StringComparison.Ordinal))
        {
            var employeeNumberExists = await dbContext.Employees
                .AnyAsync(e => e.EmployeeNumber == normalizedEmployeeNumber && e.Id != request.EmployeeId, cancellationToken);

            if (employeeNumberExists)
            {
                throw new DuplicateEntityException("Employee", "employeeNumber", normalizedEmployeeNumber);
            }
        }

        if (ProfileChanged(employee, firstName, lastName, preferredName, normalizedEmail, phone))
        {
            var profileResult = await workforceMutationService.UpdateEmployeeProfileAsync(
                employee.Id,
                new UpdateEmployeeProfileInput(firstName, lastName, normalizedEmail, preferredName, phone),
                actor: null,
                cancellationToken);
            if (profileResult.IsFailure)
            {
                return Result.Failure<EmployeeDetailsDto>(profileResult.Error);
            }
        }

        if (!string.Equals(employee.EmployeeNumber, normalizedEmployeeNumber, StringComparison.Ordinal))
        {
            employee.UpdateEmployeeNumber(normalizedEmployeeNumber);
        }

        if (request.EmploymentTypeId is not null && request.EmploymentTypeId != currentEmployment?.EmploymentTypeId)
        {
            var employmentResult = await workforceMutationService.UpdateEmploymentDetailsAsync(
                employee.Id,
                new UpdateEmploymentDetailsInput(request.EmploymentTypeId),
                actor: null,
                cancellationToken);
            if (employmentResult.IsFailure)
            {
                return Result.Failure<EmployeeDetailsDto>(employmentResult.Error);
            }
        }

        var currentAssignment = await workforceCanonicalResolver.GetPrimaryWorkAssignmentAsync(employee.Id, DateTime.UtcNow, cancellationToken);
        var targetOrgUnitId = request.OrgUnitId ?? currentAssignment?.OrgUnitId;
        var targetJobId = request.JobId ?? currentAssignment?.JobId;
        var targetPlaceId = request.PlaceId ?? currentAssignment?.PlaceId;

        var assignmentChanged =
            request.OrgUnitId.HasValue
            || request.JobId is not null
            || request.PlaceId is not null;

        if (assignmentChanged)
        {
            if (!targetOrgUnitId.HasValue || targetJobId is null)
            {
                return Result.Failure<EmployeeDetailsDto>(Error.Validation(
                    "WorkAssignment.IncompleteUpdate",
                    "Updating the primary work assignment requires an active assignment with organization and job."));
            }

            var assignmentResult = await workforceMutationService.CorrectPrimaryWorkAssignmentAsync(
                employee.Id,
                new CorrectWorkAssignmentInput(targetOrgUnitId.Value, targetJobId.Value, targetPlaceId),
                actor: null,
                cancellationToken);
            if (assignmentResult.IsFailure)
            {
                return Result.Failure<EmployeeDetailsDto>(assignmentResult.Error);
            }
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyException("Employee", request.EmployeeId);
        }

        var details = await employeeDetailsReadModelService.BuildAsync(
            employee,
            EmployeeReadAudience.HrAdmin,
            null,
            cancellationToken);

        return Result.Success(details);
    }

    private static bool ProfileChanged(
        Employee employee,
        string firstName,
        string lastName,
        string? preferredName,
        string? email,
        string? phone)
        => !string.Equals(employee.FirstName, firstName, StringComparison.Ordinal)
            || !string.Equals(employee.LastName, lastName, StringComparison.Ordinal)
            || !string.Equals(employee.PreferredName, preferredName, StringComparison.Ordinal)
            || !string.Equals(employee.Email, email, StringComparison.Ordinal)
            || !string.Equals(employee.Phone, phone, StringComparison.Ordinal);

    private static void ValidateConfiguredRequiredField(
        string? requestedValue,
        string fieldKey,
        string displayName,
        TenantSettingsDto settings,
        bool fallbackRequired)
    {
        if (requestedValue is null || !IsFieldRequired(settings, fieldKey, fallbackRequired))
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
}
