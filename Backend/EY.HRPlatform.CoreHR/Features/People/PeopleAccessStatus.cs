using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed record PeopleAccessStatusQuery(string EmployeeKey)
    : IQuery<Result<PeopleAccessStatusDto>>;

public sealed record PeopleAccessStatusDto(
    string State,
    string Label,
    string? Detail);

public sealed class PeopleAccessStatusQueryHandler(
    CoreHRDbContext dbContext,
    IWorkforceAccountStatusReader statusReader)
    : IQueryHandler<PeopleAccessStatusQuery, Result<PeopleAccessStatusDto>>
{
    public async Task<Result<PeopleAccessStatusDto>> Handle(
        PeopleAccessStatusQuery request,
        CancellationToken cancellationToken)
    {
        var key = request.EmployeeKey.Trim().ToUpperInvariant();
        var employee = await dbContext.Employees.AsNoTracking()
            .Where(item => item.StableEmployeeKey == key)
            .Select(item => new
            {
                item.Id,
                item.Email,
                item.FirstName,
                item.LastName
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (employee is null)
            return Result.Failure<PeopleAccessStatusDto>(new Error("Employee.NotFound", "Employee was not found."));
        if (string.IsNullOrWhiteSpace(employee.Email))
            return Result.Success(new PeopleAccessStatusDto(
                "NoAccess",
                "No Fusion access",
                "A work email is required before access can be linked."));

        var statuses = await statusReader.GetStatusesAsync(
            [new WorkforceAccountSubjectDto(employee.Id, employee.Email, employee.FirstName, employee.LastName)],
            cancellationToken);
        var status = statuses.GetValueOrDefault(employee.Id);
        return Result.Success(Project(status));
    }

    private static PeopleAccessStatusDto Project(WorkforceAccountStatusDto? status)
        => status?.ProvisioningState switch
        {
            // What the person can do is their roles, listed with why beside this (B-177); the old token role
            // ("Manager access") contradicted them.
            "Active" => new PeopleAccessStatusDto("Active", "Active", null),
            "Inactive" => new PeopleAccessStatusDto(
                "Suspended",
                "Suspended",
                "Fusion sign-in is currently suspended."),
            "InvitePending" => new PeopleAccessStatusDto(
                "InvitationPending",
                "Invitation pending",
                status.Email),
            "Conflict" => new PeopleAccessStatusDto(
                "NeedsReview",
                "Needs review",
                status.Conflict?.Message ?? "Fusion access needs review."),
            "InviteExpired" => new PeopleAccessStatusDto(
                "NeedsReview",
                "Needs review",
                "The workforce invitation has expired."),
            "InviteRevoked" => new PeopleAccessStatusDto(
                "NeedsReview",
                "Needs review",
                "The workforce invitation was withdrawn."),
            "InviteAccepted" => new PeopleAccessStatusDto(
                "NeedsReview",
                "Needs review",
                "The invitation was accepted, but the workforce account is not linked."),
            "Unprovisioned" or null => new PeopleAccessStatusDto(
                "NoAccess",
                "No Fusion access",
                null),
            _ => new PeopleAccessStatusDto(
                "NeedsReview",
                "Needs review",
                "Fusion access could not be classified. Review Workforce Access."),
        };
}
