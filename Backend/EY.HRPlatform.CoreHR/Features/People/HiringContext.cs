using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Checklists;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed record HiringOpenRoleDto(
    Guid Id,
    Guid JobId,
    string JobTitle,
    Guid OrgUnitId,
    string? OrgUnitName,
    Guid? PlaceId,
    string? PlaceName,
    DateOnly? TargetStartDate);

public sealed record HiringTeamMemberDto(string EmployeeKey, string DisplayName, string JobTitle);

/// <summary>The chosen manager on the first day: their unit, who reports to them and the roles they're hiring for.</summary>
public sealed record HiringManagerDto(
    Guid? OrgUnitId,
    string? OrgUnitName,
    IReadOnlyList<HiringTeamMemberDto> Team,
    int TeamCount,
    IReadOnlyList<HiringOpenRoleDto> OpenRoles);

/// <summary>A company field every new person needs.</summary>
public sealed record HiringFieldDto(string Key, string Label, string Type);

/// <summary>What Add a person shows around the form (B-239).</summary>
public sealed record HiringContextDto(
    HiringManagerDto? Manager,
    IReadOnlyList<HiringFieldDto> RequiredFields,
    IReadOnlyList<ChecklistTemplateTaskDto> Checklist,
    /// <summary>The company invites joiners on their first day on its own.</summary>
    bool InvitesOnFirstDay,
    /// <summary>The caller may send invitations; without it only Later (or the company's first-day send) is open.</summary>
    bool CanInvite);

/// <summary>
/// Reads for Add a person. Everything runs inside the tenant query filter, so another company's manager reads as
/// nobody; the caller was authorized at the endpoint to add people.
/// </summary>
public sealed class HiringContextReader(
    CoreHRDbContext dbContext,
    IOrganizationService organizationService,
    ChecklistService checklists,
    ITenantSettingsReadService settings)
{
    public const int TeamShown = 7;

    public async Task<HiringContextDto> ReadAsync(Guid? managerId, DateOnly on, bool canInvite, CancellationToken cancellationToken)
    {
        var fields = await dbContext.EmployeeFieldDefinitions.AsNoTracking()
            .Where(item => item.IsActive && item.Required && item.SourceKey == null && item.Type != EmployeeFieldType.Section)
            .OrderBy(item => item.Area).ThenBy(item => item.SortOrder)
            .Select(item => new HiringFieldDto(item.Key, item.Label, item.Type.ToString()))
            .ToListAsync(cancellationToken);
        var templates = await checklists.TemplatesAsync(cancellationToken);
        var firstDay = (await settings.GetCurrentAsync(cancellationToken)).Provisioning.InviteJoinersOnFirstDay;
        var manager = managerId is { } id ? await ManagerAsync(id, on, cancellationToken) : null;
        return new HiringContextDto(manager, fields, templates.Joining, firstDay, canInvite);
    }

    private async Task<HiringManagerDto?> ManagerAsync(Guid managerId, DateOnly on, CancellationToken cancellationToken)
    {
        var at = on.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        if (!await dbContext.Employees.AsNoTracking().AnyAsync(item => item.Id == managerId, cancellationToken))
            return null;

        var unitId = await dbContext.WorkAssignments.AsNoTracking()
            .Where(item => item.EmployeeId == managerId && item.IsPrimary && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => (Guid?)item.OrgUnitId)
            .FirstOrDefaultAsync(cancellationToken);

        var team = await (
                from line in dbContext.ManagerRelationships.AsNoTracking()
                join employee in dbContext.Employees.AsNoTracking() on line.SubjectEmployeeId equals employee.Id
                join employment in dbContext.Employments.AsNoTracking() on employee.Id equals employment.EmployeeId
                join assignment in dbContext.WorkAssignments.AsNoTracking()
                    on new { EmployeeId = employee.Id, EmploymentId = employment.Id } equals new { assignment.EmployeeId, assignment.EmploymentId }
                where line.ManagerEmployeeId == managerId
                    && line.Type == ReportingRelationshipType.PrimaryManager
                    && line.EffectiveFrom <= at && (line.EffectiveTo == null || at < line.EffectiveTo)
                    && employment.EffectiveFrom <= at && (employment.EffectiveTo == null || at < employment.EffectiveTo)
                    && assignment.IsPrimary && assignment.EffectiveFrom <= at && (assignment.EffectiveTo == null || at < assignment.EffectiveTo)
                orderby employee.FirstName, employee.LastName
                select new HiringTeamMemberDto(
                    employee.StableEmployeeKey, (employee.PreferredName ?? employee.FirstName) + " " + employee.LastName, assignment.JobTitle))
            .ToListAsync(cancellationToken);

        var roles = await dbContext.OpenRoles.AsNoTracking()
            .Where(item => item.ManagerEmployeeId == managerId && item.Status == OpenRoleStatus.Open)
            .OrderBy(item => item.TargetStartDate).ThenBy(item => item.JobTitle)
            .ToListAsync(cancellationToken);

        var hierarchy = await organizationService.GetHierarchyAsync(on, cancellationToken);
        var names = Flatten(hierarchy.Roots).ToDictionary(node => node.Unit.Id, node => node.Unit.Name);
        return new HiringManagerDto(
            unitId,
            unitId is { } unit ? names.GetValueOrDefault(unit) : null,
            team.Take(TeamShown).ToList(),
            team.Count,
            roles.Select(role => new HiringOpenRoleDto(
                role.Id, role.JobId, role.JobTitle, role.OrgUnitId, names.GetValueOrDefault(role.OrgUnitId),
                role.PlaceId, role.PlaceName, role.TargetStartDate)).ToList());
    }

    private static IEnumerable<OrganizationHierarchyNodeDto> Flatten(IEnumerable<OrganizationHierarchyNodeDto> nodes)
        => nodes.SelectMany(node => new[] { node }.Concat(Flatten(node.Children)));
}
