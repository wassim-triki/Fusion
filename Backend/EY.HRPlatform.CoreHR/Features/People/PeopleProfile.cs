using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <param name="Audience">
/// The viewer's read audience. HR admins and managers see the full record; a plain
/// colleague (Employee) receives a reduced workforce-directory projection.
/// </param>
/// <param name="BranchOfEmployeeId">
/// Set for a manager without tenant-wide access: they read their own branch as a manager and everyone else
/// (themselves included) as a colleague.
/// </param>
public sealed record PeopleProfileQuery(
    string EmployeeKey,
    DateTime? AsOf = null,
    EmployeeReadAudience Audience = EmployeeReadAudience.HrAdmin,
    Guid? BranchOfEmployeeId = null,
    Guid? ViewerEmployeeId = null) : IQuery<Result<PeopleProfileDto>>;

public sealed record PeopleProfileIdentityDto(
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string FirstName,
    string LastName,
    string? PreferredName,
    string? WorkEmail,
    string? Phone,
    /// <summary>The worker's id, which other modules (Performance) key their records by.</summary>
    Guid EmployeeId,
    /// <summary>API-relative photo address with a cache version, or null without a photo.</summary>
    string? PhotoUrl = null);

public sealed record PeopleProfileEmploymentDto(
    PeopleEmploymentState State,
    DateTime? Start,
    DateTime? End,
    string? EmploymentType,
    Guid? EmploymentTypeId = null);

public sealed record PeopleProfileReportDto(
    string EmployeeKey,
    string EmployeeNumber,
    string DisplayName,
    string? JobTitle,
    /// <summary>API-relative photo address with a cache version, or null without a photo.</summary>
    string? PhotoUrl = null);

public sealed record PeopleProfileDto(
    PeopleProfileIdentityDto Identity,
    PeopleProfileEmploymentDto Employment,
    PeopleWorkDto? Work,
    PeopleManagerDto? PrimaryManager,
    int DirectReportCount,
    IReadOnlyList<PeopleProfileReportDto> DirectReports,
    string Completeness,
    uint Version,
    /// <summary>The effective date this snapshot was resolved for (Today by default).</summary>
    DateTime ViewedDate,
    /// <summary>True when viewing a non-Today date; the snapshot is read-only.</summary>
    bool IsAsOf,
    /// <summary>Change records from today on (scheduled, or today's while it can be undone); Today view only.</summary>
    IReadOnlyList<Changes.WorkforceChangeDto> ComingUp,
    /// <summary>Dotted-line (secondary) managers on the viewed date, beside the primary chain.</summary>
    IReadOnlyList<PeopleDottedLineManagerDto> DottedLineManagers);

/// <summary>A dotted-line manager on the profile; the id is what the dotted-line end command takes.</summary>
public sealed record PeopleDottedLineManagerDto(
    string EmployeeKey,
    string DisplayName,
    string EmployeeNumber,
    Guid EmployeeId,
    DateTime Since,
    /// <summary>API-relative photo address with a cache version, or null without a photo.</summary>
    string? PhotoUrl = null);

public sealed class PeopleProfileQueryHandler(
    CoreHRDbContext dbContext,
    IOrganizationService organizationService,
    Changes.WorkforceChangeReader changeReader)
    : IQueryHandler<PeopleProfileQuery, Result<PeopleProfileDto>>
{
    public async Task<Result<PeopleProfileDto>> Handle(
        PeopleProfileQuery request,
        CancellationToken cancellationToken)
    {
        var key = request.EmployeeKey.Trim().ToUpperInvariant();
        var employee = await dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(item => item.StableEmployeeKey == key, cancellationToken);
        if (employee is null)
            return Result.Failure<PeopleProfileDto>(new Error("Employee.NotFound", "Employee was not found."));

        if (request.Audience == EmployeeReadAudience.Manager && request.BranchOfEmployeeId is { } managerId
            && !(await Changes.ChangeSupport.BranchAsync(dbContext, managerId, cancellationToken)).Contains(employee.Id))
            request = request with { Audience = EmployeeReadAudience.Employee, AsOf = null };

        var today = DateTime.UtcNow.Date;
        var asOf = request.AsOf?.Date is { } requested
            ? DateTime.SpecifyKind(requested, DateTimeKind.Utc)
            : (DateTime?)null;
        var isAsOf = asOf.HasValue && asOf.Value != today;

        Employment? employment;
        PeopleEmploymentState state;
        DateTime displayAt;
        if (isAsOf)
        {
            // Page-level as-of: resolve every fact on the same requested date; read-only.
            displayAt = asOf!.Value;
            employment = await ResolveEmploymentAtAsync(employee.Id, displayAt, cancellationToken);
            state = await ResolveStateAtAsync(employee.Id, employment, displayAt, cancellationToken);
        }
        else
        {
            employment = await ResolveEmploymentAsync(employee.Id, today, cancellationToken);
            state = ResolveState(employment, today);
            displayAt = ResolveDisplayAt(employment, state, today);
        }
        var assignment = employment is null
            ? null
            : await dbContext.WorkAssignments.AsNoTracking()
                .Where(item => item.EmployeeId == employee.Id
                    && item.EmploymentId == employment.Id
                    && item.IsPrimary
                    && item.EffectiveFrom <= displayAt
                    && (item.EffectiveTo == null || displayAt < item.EffectiveTo))
                .OrderByDescending(item => item.EffectiveFrom)
                .FirstOrDefaultAsync(cancellationToken);

        PeopleWorkDto? work = null;
        if (assignment is not null)
        {
            var organization = await organizationService.GetUnitAsync(
                assignment.OrgUnitId,
                DateOnly.FromDateTime(displayAt),
                cancellationToken);
            work = new PeopleWorkDto(
                assignment.OrgUnitId,
                assignment.JobTitle,
                organization.Name,
                organization.Path,
                assignment.WorkLocation,
                assignment.EffectiveFrom,
                state == PeopleEmploymentState.Former,
                assignment.JobId,
                assignment.PlaceId);
            var classification = await (
                    from job in dbContext.Jobs.AsNoTracking()
                    where job.Id == assignment.JobId
                    select new
                    {
                        Family = dbContext.CompanyListValues.Where(value => value.Id == job.FamilyId).Select(value => value.Label).FirstOrDefault(),
                        Level = dbContext.CompanyListValues.Where(value => value.Id == job.LevelId).Select(value => value.Label).FirstOrDefault(),
                    })
                .FirstOrDefaultAsync(cancellationToken);
            work = work with { JobFamily = classification?.Family, JobLevel = classification?.Level };
        }

        PeopleManagerDto? manager = null;
        if (assignment is not null)
        {
            manager = await (
                from relationship in dbContext.ManagerRelationships.AsNoTracking()
                join managerEmployee in dbContext.Employees.AsNoTracking()
                    on relationship.ManagerEmployeeId equals managerEmployee.Id
                where relationship.SubjectEmployeeId == employee.Id
                    && relationship.Type == ReportingRelationshipType.PrimaryManager
                    && relationship.EffectiveFrom <= displayAt
                    && (relationship.EffectiveTo == null || displayAt < relationship.EffectiveTo)
                orderby relationship.EffectiveFrom descending
                select new PeopleManagerDto(
                    managerEmployee.StableEmployeeKey,
                    (managerEmployee.PreferredName ?? managerEmployee.FirstName) + " " + managerEmployee.LastName,
                    managerEmployee.EmployeeNumber,
                    EmployeePhotos.UrlFor(managerEmployee.StableEmployeeKey, managerEmployee.PhotoKey),
                    managerEmployee.Id))
                .FirstOrDefaultAsync(cancellationToken);
        }

        var dottedLineManagers = assignment is null
            ? []
            : await (
                from relationship in dbContext.ManagerRelationships.AsNoTracking()
                join managerEmployee in dbContext.Employees.AsNoTracking()
                    on relationship.ManagerEmployeeId equals managerEmployee.Id
                where relationship.SubjectEmployeeId == employee.Id
                    && relationship.Type == ReportingRelationshipType.SecondaryManager
                    && relationship.EffectiveFrom <= displayAt
                    && (relationship.EffectiveTo == null || displayAt < relationship.EffectiveTo)
                orderby managerEmployee.LastName, managerEmployee.FirstName
                select new PeopleDottedLineManagerDto(
                    managerEmployee.StableEmployeeKey,
                    (managerEmployee.PreferredName ?? managerEmployee.FirstName) + " " + managerEmployee.LastName,
                    managerEmployee.EmployeeNumber,
                    managerEmployee.Id,
                    relationship.EffectiveFrom,
                    EmployeePhotos.UrlFor(managerEmployee.StableEmployeeKey, managerEmployee.PhotoKey)))
                .ToListAsync(cancellationToken);

        var directReportQuery =
            from relationship in dbContext.ManagerRelationships.AsNoTracking()
            join report in dbContext.Employees.AsNoTracking()
                on relationship.SubjectEmployeeId equals report.Id
            where relationship.ManagerEmployeeId == employee.Id
                && relationship.Type == ReportingRelationshipType.PrimaryManager
                && relationship.EffectiveFrom <= displayAt
                && (relationship.EffectiveTo == null || displayAt < relationship.EffectiveTo)
            select report;
        var directReportCount = await directReportQuery.CountAsync(cancellationToken);
        var directReports = await directReportQuery
            .OrderBy(report => report.LastName)
            .ThenBy(report => report.FirstName)
            .ThenBy(report => report.Id)
            .Take(5)
            .Select(report => new PeopleProfileReportDto(
                report.StableEmployeeKey,
                report.EmployeeNumber,
                (report.PreferredName ?? report.FirstName) + " " + report.LastName,
                dbContext.WorkAssignments.AsNoTracking()
                    .Where(assignment => assignment.EmployeeId == report.Id
                        && assignment.IsPrimary
                        && assignment.EffectiveFrom <= displayAt
                        && (assignment.EffectiveTo == null || displayAt < assignment.EffectiveTo))
                    .OrderByDescending(assignment => assignment.EffectiveFrom)
                    .Select(assignment => assignment.JobTitle)
                    .FirstOrDefault(),
                EmployeePhotos.UrlFor(report.StableEmployeeKey, report.PhotoKey)))
            .ToListAsync(cancellationToken);

        var comingUp = isAsOf || request.Audience == EmployeeReadAudience.Employee
            ? []
            : await changeReader.ComingUpAsync(employee.Id, cancellationToken);

        var result = new PeopleProfileDto(
            new PeopleProfileIdentityDto(
                employee.StableEmployeeKey,
                employee.EmployeeNumber,
                employee.DisplayName,
                employee.FirstName,
                employee.LastName,
                employee.PreferredName,
                employee.Email,
                // The mobile follows the Personal tab: the person, HR and their branch manager; not colleagues.
                request.Audience != EmployeeReadAudience.Employee || employee.Id == request.ViewerEmployeeId ? employee.Phone : null,
                employee.Id,
                EmployeePhotos.UrlFor(employee.StableEmployeeKey, employee.PhotoKey)),
            new PeopleProfileEmploymentDto(
                state,
                employment?.EffectiveFrom,
                employment?.EffectiveTo,
                employment?.EmploymentType,
                employment?.EmploymentTypeId),
            work,
            manager,
            directReportCount,
            directReports,
            employment is null ? "EmploymentUnavailable"
                : work is null ? "WorkDetailsUnavailable"
                : "Complete",
            employee.Version,
            isAsOf ? asOf!.Value : today,
            isAsOf,
            comingUp,
            dottedLineManagers);

        // A plain colleague sees workforce-directory context only: identity, current
        // work, org, and reporting relationships — never employment tenure/type or
        // scheduled changes. History and Fusion-access are withheld at the endpoint.
        if (request.Audience == EmployeeReadAudience.Employee)
        {
            result = result with
            {
                Employment = result.Employment with
                {
                    Start = null,
                    End = null,
                    EmploymentType = null,
                },
                ComingUp = [],
            };
        }

        return Result.Success(result);
    }

    private async Task<Employment?> ResolveEmploymentAsync(
        Guid employeeId,
        DateTime today,
        CancellationToken cancellationToken)
    {
        var active = await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId
                && item.EffectiveFrom <= today
                && (item.EffectiveTo == null || today < item.EffectiveTo))
            .OrderByDescending(item => item.EffectiveFrom)
            .FirstOrDefaultAsync(cancellationToken);
        if (active is not null)
            return active;

        var scheduled = await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && item.EffectiveFrom > today)
            .OrderBy(item => item.EffectiveFrom)
            .FirstOrDefaultAsync(cancellationToken);
        if (scheduled is not null)
            return scheduled;

        return await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId
                && (item.Status == EmploymentStatus.Ended || item.EffectiveTo <= today))
            .OrderByDescending(item => item.EffectiveTo ?? item.EffectiveFrom)
            .ThenByDescending(item => item.EffectiveFrom)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<Employment?> ResolveEmploymentAtAsync(
        Guid employeeId,
        DateTime at,
        CancellationToken cancellationToken)
        => await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId
                && item.EffectiveFrom <= at
                && (item.EffectiveTo == null || at < item.EffectiveTo))
            .OrderByDescending(item => item.EffectiveFrom)
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<PeopleEmploymentState> ResolveStateAtAsync(
        Guid employeeId,
        Employment? activeOnDate,
        DateTime at,
        CancellationToken cancellationToken)
    {
        if (activeOnDate is not null)
            return PeopleEmploymentState.Active;

        var hasFuture = await dbContext.Employments.AsNoTracking()
            .AnyAsync(item => item.EmployeeId == employeeId && item.EffectiveFrom > at, cancellationToken);
        if (hasFuture)
            return PeopleEmploymentState.Scheduled;

        var hasEnded = await dbContext.Employments.AsNoTracking()
            .AnyAsync(item => item.EmployeeId == employeeId && item.EffectiveTo != null && item.EffectiveTo <= at, cancellationToken);
        return hasEnded ? PeopleEmploymentState.Former : PeopleEmploymentState.Incomplete;
    }

    private static PeopleEmploymentState ResolveState(Employment? employment, DateTime today)
        => employment switch
        {
            null => PeopleEmploymentState.Incomplete,
            _ when employment.EffectiveFrom > today => PeopleEmploymentState.Scheduled,
            _ when employment.EffectiveTo is null || today < employment.EffectiveTo => PeopleEmploymentState.Active,
            _ => PeopleEmploymentState.Former
        };

    private static DateTime ResolveDisplayAt(
        Employment? employment,
        PeopleEmploymentState state,
        DateTime today)
        => state switch
        {
            PeopleEmploymentState.Scheduled => employment!.EffectiveFrom,
            PeopleEmploymentState.Former => employment!.EffectiveTo!.Value.AddTicks(-1),
            _ => today
        };
}
