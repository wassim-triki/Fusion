using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

/// <summary>The kind of a business change/event surfaced in Upcoming and the Timeline.</summary>
public enum PeopleChangeKind
{
    Work,
    Manager,
    EmploymentStarted,
    EmploymentEnded,
    WorkEstablished,
    /// <summary>The person or HR changed contact or personal details; the fields name the sections, never the values.</summary>
    PersonalDetails,
    /// <summary>Leave that is over (B-316): <see cref="PeopleTimelineEventDto.Leave"/> carries its type and days.</summary>
    Leave
}

/// <summary>A single changed value expressed as before → after; either side may be absent.</summary>
public sealed record PeopleChangeFieldDto(string Label, string? From, string? To);

/// <summary>A scheduled future change, distinct per kind even when it shares an effective date.</summary>
public sealed record PeopleUpcomingChangeDto(
    DateTime EffectiveDate,
    PeopleChangeKind Kind,
    string EmployeeKey,
    IReadOnlyList<PeopleChangeFieldDto> Fields);

/// <summary>A dated business event in the timeline — a change or a lifecycle milestone.</summary>
public sealed record PeopleTimelineEventDto(
    DateTime EffectiveDate,
    PeopleChangeKind Kind,
    string Title,
    bool IsFuture,
    IReadOnlyList<PeopleChangeFieldDto> Fields,
    PeopleTimelineLeaveDto? Leave = null);

/// <summary>Ended leave as History shows it: its type (every History reader may see it) and its working days.</summary>
public sealed record PeopleTimelineLeaveDto(string? Type, DateOnly From, DateOnly Until, int WorkingDays);

public sealed record PeopleTimelineDto(
    IReadOnlyList<PeopleUpcomingChangeDto> Upcoming,
    IReadOnlyList<PeopleTimelineEventDto> Timeline);

/// <param name="BranchOfEmployeeId">Set for a reader without tenant-wide access: only this manager's branch is readable.</param>
/// <param name="SelfEmployeeId">The caller's own person: their own history is always theirs to read (B-180).</param>
/// <param name="BranchScope">How far the branch reaches: their team, or their unit (B-212).</param>
public sealed record PeopleTimelineQuery(string EmployeeKey, Guid? BranchOfEmployeeId = null, Guid? SelfEmployeeId = null,
    string BranchScope = PermissionScopes.DirectReports) : IQuery<Result<PeopleTimelineDto>>;

public sealed class PeopleTimelineQueryHandler(
    CoreHRDbContext dbContext,
    PeopleTimelineComposer composer)
    : IQueryHandler<PeopleTimelineQuery, Result<PeopleTimelineDto>>
{
    public async Task<Result<PeopleTimelineDto>> Handle(
        PeopleTimelineQuery request,
        CancellationToken cancellationToken)
    {
        var key = request.EmployeeKey.Trim().ToUpperInvariant();
        var employee = await dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(item => item.StableEmployeeKey == key, cancellationToken);
        if (employee is null)
            return Result.Failure<PeopleTimelineDto>(new Error("Employee.NotFound", "Employee was not found."));
        if (request.BranchOfEmployeeId is { } managerId && employee.Id != request.SelfEmployeeId
            && !(await ViewerReach.PeopleAsync(dbContext, managerId, request.BranchScope, cancellationToken)).Contains(employee.Id))
            return Result.Failure<PeopleTimelineDto>(new Error("Employee.NotFound", "Employee was not found."));

        var timeline = await composer.ComposeAsync(employee.Id, employee.StableEmployeeKey, cancellationToken);
        return Result.Success(timeline);
    }
}

/// <summary>
/// Derives the bounded business Upcoming preview and Timeline from canonical rows only. It shows
/// what changed (from → to), never persistence structure, and never fabricates work/title/manager
/// history before Fusion's known baseline: an employment that started before the first Fusion work
/// record yields exactly an employment-started event and a work-established event, nothing between.
/// </summary>
public sealed class PeopleTimelineComposer(CoreHRDbContext dbContext)
{
    public async Task<PeopleTimelineDto> ComposeAsync(
        Guid employeeId,
        string employeeKey,
        CancellationToken cancellationToken)
    {
        var today = DateTime.UtcNow.Date;

        var employments = await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId)
            .OrderBy(item => item.EffectiveFrom)
            .ToListAsync(cancellationToken);

        var assignments = await dbContext.WorkAssignments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && item.IsPrimary)
            .OrderBy(item => item.EffectiveFrom)
            .ToListAsync(cancellationToken);

        var relationships = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.SubjectEmployeeId == employeeId
                && item.Type == ReportingRelationshipType.PrimaryManager)
            .OrderBy(item => item.EffectiveFrom)
            .ToListAsync(cancellationToken);

        var orgNames = await ResolveOrgNamesAsync(assignments, cancellationToken);
        var managerNames = await ResolveManagerNamesAsync(relationships, cancellationToken);

        var upcoming = BuildUpcoming(employeeKey, today, assignments, relationships, orgNames, managerNames);
        var timeline = BuildTimeline(today, employments, assignments, relationships, orgNames, managerNames);
        timeline.AddRange(await PersonalDetailEventsAsync(employeeId, cancellationToken));
        timeline.AddRange(await EndedLeaveEventsAsync(employeeId, DateOnly.FromDateTime(today), cancellationToken));
        timeline = timeline.OrderByDescending(e => e.EffectiveDate).ThenBy(e => e.Kind).ToList();

        return new PeopleTimelineDto(upcoming, timeline);
    }

    /// <summary>Leave whose last day has passed; leave now or ahead shows under Coming up instead.</summary>
    private async Task<IEnumerable<PeopleTimelineEventDto>> EndedLeaveEventsAsync(
        Guid employeeId, DateOnly today, CancellationToken cancellationToken)
    {
        var leaves = await dbContext.WorkforceChanges.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && item.Kind == WorkforceChangeKind.Leave && !item.IsCancelled
                && item.LastDay != null && item.LastDay < today)
            .ToListAsync(cancellationToken);
        if (leaves.Count == 0)
            return [];
        var week = await Changes.LeaveReader.WorkWeekAsync(dbContext, cancellationToken);
        return leaves.Select(leave =>
        {
            var until = leave.LastDay!.Value;
            var days = Enumerable.Range(0, until.DayNumber - leave.EffectiveDate.DayNumber + 1)
                .Count(offset => week.Length == 0 || week.Contains((int)leave.EffectiveDate.AddDays(offset).DayOfWeek));
            var type = Changes.WorkforceChangeService.ReadDetails(leave).LeaveType;
            return new PeopleTimelineEventDto(Changes.WorkforceChangeService.At(leave.EffectiveDate), PeopleChangeKind.Leave,
                type ?? "Leave", false, [], new PeopleTimelineLeaveDto(type, leave.EffectiveDate, until, days));
        });
    }

    private async Task<IEnumerable<PeopleTimelineEventDto>> PersonalDetailEventsAsync(
        Guid employeeId, CancellationToken cancellationToken)
    {
        var entries = await dbContext.WorkforceAuditEntries.AsNoTracking()
            .Where(entry => entry.EntityType == "Employee" && entry.EntityId == employeeId
                && entry.Action == WorkforceAuditAction.PersonalDetailsUpdated)
            .OrderByDescending(entry => entry.OccurredAt)
            .Take(50)
            .Select(entry => new { entry.OccurredAt, entry.ChangeDetails })
            .ToListAsync(cancellationToken);
        return entries.Select(entry => new PeopleTimelineEventDto(
            entry.OccurredAt, PeopleChangeKind.PersonalDetails, "Updated contact details", false,
            (entry.ChangeDetails ?? string.Empty)
                .Split(", ", StringSplitOptions.RemoveEmptyEntries)
                .Select(section => new PeopleChangeFieldDto(section, null, null))
                .ToList()));
    }

    private async Task<Dictionary<Guid, string>> ResolveOrgNamesAsync(
        IReadOnlyList<WorkAssignment> assignments, CancellationToken cancellationToken)
    {
        var ids = assignments.Select(a => a.OrgUnitId).Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        return await dbContext.OrgUnits.AsNoTracking()
            .Where(o => ids.Contains(o.Id))
            .ToDictionaryAsync(o => o.Id, o => o.Name, cancellationToken);
    }

    private async Task<Dictionary<Guid, string>> ResolveManagerNamesAsync(
        IReadOnlyList<ManagerRelationship> relationships, CancellationToken cancellationToken)
    {
        var ids = relationships.Select(r => r.ManagerEmployeeId).Distinct().ToList();
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        return await dbContext.Employees.AsNoTracking()
            .Where(e => ids.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.DisplayName, cancellationToken);
    }

    private static List<PeopleUpcomingChangeDto> BuildUpcoming(
        string employeeKey,
        DateTime today,
        IReadOnlyList<WorkAssignment> assignments,
        IReadOnlyList<ManagerRelationship> relationships,
        IReadOnlyDictionary<Guid, string> orgNames,
        IReadOnlyDictionary<Guid, string> managerNames)
    {
        var items = new List<PeopleUpcomingChangeDto>();

        foreach (var assignment in assignments.Where(a => a.EffectiveFrom.Date > today))
        {
            var predecessor = assignments.FirstOrDefault(a => a.EffectiveTo == assignment.EffectiveFrom);
            var fields = WorkChangeFields(predecessor, assignment, orgNames);
            if (fields.Count > 0)
                items.Add(new PeopleUpcomingChangeDto(assignment.EffectiveFrom, PeopleChangeKind.Work, employeeKey, fields));
        }

        foreach (var relationship in relationships.Where(r => r.EffectiveFrom.Date > today))
        {
            var predecessor = relationships.FirstOrDefault(r => r.EffectiveTo == relationship.EffectiveFrom);
            var from = predecessor is null ? NoManager : ManagerName(predecessor.ManagerEmployeeId, managerNames);
            var to = ManagerName(relationship.ManagerEmployeeId, managerNames);
            items.Add(new PeopleUpcomingChangeDto(
                relationship.EffectiveFrom, PeopleChangeKind.Manager, employeeKey,
                new[] { new PeopleChangeFieldDto("Manager", from, to) }));
        }

        // Future manager removals: a relationship closing after today with no successor at that date.
        foreach (var relationship in relationships.Where(r => r.EffectiveTo is { } end && end.Date > today))
        {
            var end = relationship.EffectiveTo!.Value;
            var hasSuccessor = relationships.Any(r => r.EffectiveFrom == end);
            if (!hasSuccessor)
            {
                items.Add(new PeopleUpcomingChangeDto(
                    end, PeopleChangeKind.Manager, employeeKey,
                    new[] { new PeopleChangeFieldDto("Manager", ManagerName(relationship.ManagerEmployeeId, managerNames), NoManager) }));
            }
        }

        return items
            .OrderBy(i => i.EffectiveDate)
            .ThenBy(i => i.Kind)
            .ToList();
    }

    private static List<PeopleTimelineEventDto> BuildTimeline(
        DateTime today,
        IReadOnlyList<Employment> employments,
        IReadOnlyList<WorkAssignment> assignments,
        IReadOnlyList<ManagerRelationship> relationships,
        IReadOnlyDictionary<Guid, string> orgNames,
        IReadOnlyDictionary<Guid, string> managerNames)
    {
        var events = new List<PeopleTimelineEventDto>();

        foreach (var employment in employments)
        {
            events.Add(new PeopleTimelineEventDto(
                employment.EffectiveFrom, PeopleChangeKind.EmploymentStarted, "Employment started",
                employment.EffectiveFrom.Date > today, Array.Empty<PeopleChangeFieldDto>()));

            if (employment.EffectiveTo is { } endedAt)
            {
                // Present the human "last employed" date (inclusive) rather than the exclusive boundary.
                var lastEmployed = endedAt.AddDays(-1);
                events.Add(new PeopleTimelineEventDto(
                    lastEmployed, PeopleChangeKind.EmploymentEnded, "Employment ended",
                    lastEmployed.Date > today, Array.Empty<PeopleChangeFieldDto>()));
            }
        }

        var firstAssignment = assignments.FirstOrDefault();
        if (firstAssignment is not null)
        {
            events.Add(new PeopleTimelineEventDto(
                firstAssignment.EffectiveFrom, PeopleChangeKind.WorkEstablished, "Current work established in Fusion",
                firstAssignment.EffectiveFrom.Date > today, Array.Empty<PeopleChangeFieldDto>()));
        }

        foreach (var assignment in assignments)
        {
            var predecessor = assignments.FirstOrDefault(a => a.EffectiveTo == assignment.EffectiveFrom);
            if (predecessor is null)
                continue; // The first assignment is the "established" event, not a change.

            var fields = WorkChangeFields(predecessor, assignment, orgNames);
            if (fields.Count > 0)
                events.Add(new PeopleTimelineEventDto(
                    assignment.EffectiveFrom, PeopleChangeKind.Work, "Work changed",
                    assignment.EffectiveFrom.Date > today, fields));
        }

        foreach (var relationship in relationships)
        {
            var predecessor = relationships.FirstOrDefault(r => r.EffectiveTo == relationship.EffectiveFrom);
            var from = predecessor is null ? NoManager : ManagerName(predecessor.ManagerEmployeeId, managerNames);
            var to = ManagerName(relationship.ManagerEmployeeId, managerNames);
            events.Add(new PeopleTimelineEventDto(
                relationship.EffectiveFrom, PeopleChangeKind.Manager,
                predecessor is null ? "Manager assigned" : "Manager changed",
                relationship.EffectiveFrom.Date > today,
                new[] { new PeopleChangeFieldDto("Manager", from, to) }));
        }

        return events
            .OrderByDescending(e => e.EffectiveDate)
            .ThenBy(e => e.Kind)
            .ToList();
    }

    private static List<PeopleChangeFieldDto> WorkChangeFields(
        WorkAssignment? from, WorkAssignment to, IReadOnlyDictionary<Guid, string> orgNames)
    {
        var fields = new List<PeopleChangeFieldDto>();

        if (from is null)
        {
            fields.Add(new PeopleChangeFieldDto("Title", null, to.JobTitle));
            fields.Add(new PeopleChangeFieldDto("Organization", null, OrgName(to.OrgUnitId, orgNames)));
            if (!string.IsNullOrWhiteSpace(to.WorkLocation))
                fields.Add(new PeopleChangeFieldDto("Location", null, to.WorkLocation));
            return fields;
        }

        if (!string.Equals(from.JobTitle, to.JobTitle, StringComparison.Ordinal))
            fields.Add(new PeopleChangeFieldDto("Title", from.JobTitle, to.JobTitle));
        if (from.OrgUnitId != to.OrgUnitId)
            fields.Add(new PeopleChangeFieldDto("Organization", OrgName(from.OrgUnitId, orgNames), OrgName(to.OrgUnitId, orgNames)));
        if (!string.Equals(from.WorkLocation, to.WorkLocation, StringComparison.Ordinal))
            fields.Add(new PeopleChangeFieldDto("Location", from.WorkLocation, to.WorkLocation));

        return fields;
    }

    private const string NoManager = "No manager";

    private static string OrgName(Guid orgUnitId, IReadOnlyDictionary<Guid, string> orgNames)
        => orgNames.TryGetValue(orgUnitId, out var name) ? name : "Unknown organization";

    private static string ManagerName(Guid managerEmployeeId, IReadOnlyDictionary<Guid, string> managerNames)
        => managerNames.TryGetValue(managerEmployeeId, out var name) ? name : "Unknown manager";
}
