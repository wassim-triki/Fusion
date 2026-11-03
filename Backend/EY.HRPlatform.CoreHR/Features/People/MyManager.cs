using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <summary>The Home card only: no employee identifiers, contact details or workforce record.</summary>
public sealed record MyManagerCardDto(string DisplayName, string? JobTitle);
public sealed record MyManagerDto(MyManagerCardDto? Manager, bool IsFirstWeek);

/// <summary>Employee id comes exclusively from the authenticated caller, never the request.</summary>
public sealed record MyManagerQuery(Guid EmployeeId, DateTime AsOf) : IQuery<Result<MyManagerDto>>;

public sealed class MyManagerQueryHandler(CoreHRDbContext dbContext, IWorkforceCanonicalResolver resolver)
    : IQueryHandler<MyManagerQuery, Result<MyManagerDto>>
{
    public async Task<Result<MyManagerDto>> Handle(MyManagerQuery request, CancellationToken cancellationToken)
    {
        // All reads retain the fail-closed tenant filter, including the manager lookup.
        if (!await dbContext.Employees.AnyAsync(item => item.Id == request.EmployeeId, cancellationToken))
            return Result.Failure<MyManagerDto>(new Error("Employee.NotFound", "Employee was not found."));

        var employment = await resolver.GetCurrentEmploymentAsync(request.EmployeeId, request.AsOf, cancellationToken);
        var days = employment is null ? -1 : (request.AsOf.Date - employment.EffectiveFrom.Date).Days;
        var firstWeek = days >= 0 && days < 7;
        var relationship = await resolver.GetPrimaryManagerAsync(request.EmployeeId, request.AsOf, cancellationToken);
        if (relationship is null) return Result.Success(new MyManagerDto(null, firstWeek));
        var manager = await dbContext.Employees.AsNoTracking()
            .Where(item => item.Id == relationship.ManagerEmployeeId)
            .Select(item => new { item.FirstName, item.LastName, item.PreferredName })
            .FirstOrDefaultAsync(cancellationToken);
        if (manager is null) return Result.Success(new MyManagerDto(null, firstWeek));

        var assignment = await resolver.GetPrimaryWorkAssignmentAsync(relationship.ManagerEmployeeId, request.AsOf, cancellationToken);
        var name = string.IsNullOrWhiteSpace(manager.PreferredName) ? manager.FirstName : manager.PreferredName;
        return Result.Success(new MyManagerDto(new MyManagerCardDto($"{name} {manager.LastName}",
            string.IsNullOrWhiteSpace(assignment?.JobTitle) ? null : assignment.JobTitle), firstWeek));
    }
}
