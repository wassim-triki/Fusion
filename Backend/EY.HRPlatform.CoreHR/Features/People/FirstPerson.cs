using EY.HRPlatform.CoreHR.Features.Catalog;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <summary>"Do you work at …? Yes" at activation (D-10): the job title they gave; the names are their account's.</summary>
public sealed record FirstPersonRequest(string? FirstName, string? LastName, string? JobTitle, string? CompanyName);

/// <summary>The administrator's new record, and whether their account now opens it.</summary>
public sealed record FirstPersonDto(string EmployeeKey, string DisplayName, string JobTitle, bool Linked);

/// <summary>
/// Makes the activating administrator the company's first person (D-10): only while the company has nobody, only for an
/// account without a person here. The company's root unit (named for the company) and the job are made when missing;
/// the person starts today and their account is linked to the record through Identity, so Home opens on them.
/// </summary>
public sealed class FirstPersonService(
    CoreHRDbContext db,
    ITenantContext tenant,
    IOrganizationService organization,
    IEmployeeNumberAllocator numbers,
    IWorkforceMutationService mutation,
    IWorkforceAccessIdentityClient identity)
{
    public async Task<Result<FirstPersonDto>> CreateAsync(FirstPersonRequest request, string email, string actor,
        CancellationToken cancellationToken)
    {
        var first = request.FirstName?.Trim() ?? "";
        var last = request.LastName?.Trim() ?? "";
        var title = request.JobTitle?.Trim() ?? "";
        if (first.Length == 0 || last.Length == 0)
            return Result.Failure<FirstPersonDto>(Error.Validation("FirstPerson.NameRequired", "First name and last name are required."));
        if (title.Length is 0 or > 200)
            return Result.Failure<FirstPersonDto>(Error.Validation("FirstPerson.JobTitleRequired", "Enter your job title."));
        if (await db.Employees.AnyAsync(cancellationToken))
            return Result.Failure<FirstPersonDto>(Error.Conflict("FirstPerson.CompanyHasPeople", "The company already has people."));

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var root = await db.OrgUnits.AsNoTracking().Where(unit => unit.IsRoot).Select(unit => (Guid?)unit.Id).FirstOrDefaultAsync(cancellationToken);
        if (root is null)
        {
            var name = string.IsNullOrWhiteSpace(request.CompanyName) ? "Company" : request.CompanyName.Trim();
            root = (await organization.CreateRootAsync(new CreateOrganizationRootRequest("COMPANY", name, today), cancellationToken)).Id;
        }

        var job = await new CatalogReferences(db, tenant).JobByTitleAsync(title, actor, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        var start = today.ToDateTime(TimeOnly.MinValue);
        var made = await new AddExistingEmployeeCommandHandler(db, tenant, numbers, mutation, organization).Handle(new AddExistingEmployeeCommand(new AddExistingEmployeeRequest(
            first, last, null, email, null, EmployeeNumberMode.Generated, null, start, start, null, root.Value, job.Id, null, null), actor),
            cancellationToken);
        if (made.IsFailure) return Result.Failure<FirstPersonDto>(made.Error);

        var employeeId = await db.Employees.AsNoTracking().Where(employee => employee.StableEmployeeKey == made.Value.EmployeeKey)
            .Select(employee => employee.Id).FirstAsync(cancellationToken);
        var link = await identity.MutateAsync(employeeId, email.Trim().ToLowerInvariant(), "Link", "Employee", cancellationToken);
        return Result.Success(new FirstPersonDto(made.Value.EmployeeKey, made.Value.DisplayName, made.Value.JobTitle, link.Outcome == "Ok"));
    }
}
