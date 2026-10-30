using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Employees.Commands.RehireEmployee;

public sealed class RehireEmployeeCommandHandler(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IWorkforceMutationService? workforceMutationService = null,
    IEmployeeDetailsReadModelService? employeeDetailsReadModelService = null,
    ITenantSettingsReadService? tenantSettingsReadService = null)
    : ICommandHandler<RehireEmployeeCommand, Result<EmployeeDetailsDto>>
{
    private readonly IWorkforceMutationService workforceMutationService =
        workforceMutationService ?? new WorkforceMutationService(dbContext, tenantContext, new WorkforceCanonicalResolver(dbContext));

    private readonly IEmployeeDetailsReadModelService employeeDetailsReadModelService =
        employeeDetailsReadModelService ?? new EmployeeDetailsReadModelService(
            dbContext,
            new WorkforceCanonicalResolver(dbContext),
            tenantSettingsReadService ?? new TenantSettingsReadService(dbContext));

    public async Task<Result<EmployeeDetailsDto>> Handle(RehireEmployeeCommand request, CancellationToken cancellationToken)
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

        if (request.OrgUnitId == Guid.Empty)
        {
            return Result.Failure<EmployeeDetailsDto>(Error.Validation(
                "WorkAssignment.OrgUnitRequired",
                "An active organization unit is required to create the rehire's primary work assignment."));
        }

        // StartEmployment rejects a second active employment, enforcing the "no active employment" precondition.
        var employmentResult = await workforceMutationService.StartEmploymentAsync(
            request.EmployeeId,
            new StartEmploymentInput(request.EffectiveDate, request.EmploymentTypeId),
            actor: null,
            cancellationToken);
        if (employmentResult.IsFailure)
        {
            return Result.Failure<EmployeeDetailsDto>(employmentResult.Error);
        }

        var assignmentResult = await workforceMutationService.ChangeWorkAssignmentAsync(
            request.EmployeeId,
            new ChangeWorkAssignmentInput(
                request.OrgUnitId,
                request.JobId,
                request.PlaceId,
                request.EffectiveDate),
            actor: null,
            cancellationToken);
        if (assignmentResult.IsFailure)
        {
            return Result.Failure<EmployeeDetailsDto>(assignmentResult.Error);
        }

        if (request.ManagerId.HasValue)
        {
            var managerResult = await workforceMutationService.ChangeManagerAsync(
                request.EmployeeId,
                new ChangeManagerInput(request.ManagerId.Value, request.EffectiveDate),
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
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConcurrencyException("Employee", request.EmployeeId);
        }

        var details = await employeeDetailsReadModelService.BuildAsync(
            employee,
            EmployeeReadAudience.HrAdmin,
            request.EffectiveDate,
            cancellationToken);

        return Result.Success(details);
    }
}
