using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Employees.Services;

public interface IEmployeeDetailsReadModelService
{
    Task<EmployeeDetailsDto> BuildAsync(
        Employee employee,
        EmployeeReadAudience audience,
        DateTime? asOf,
        CancellationToken cancellationToken);

    Task<EmployeeListItemDto> BuildListItemAsync(
        Employee employee,
        EmployeeReadAudience audience,
        DateTime? asOf,
        CancellationToken cancellationToken);
}

public sealed class EmployeeDetailsReadModelService(
    CoreHRDbContext dbContext,
    IWorkforceCanonicalResolver workforceCanonicalResolver,
    ITenantSettingsReadService tenantSettingsReadService) : IEmployeeDetailsReadModelService
{
    public async Task<EmployeeDetailsDto> BuildAsync(
        Employee employee,
        EmployeeReadAudience audience,
        DateTime? asOf,
        CancellationToken cancellationToken)
    {
        var settings = await tenantSettingsReadService.GetCurrentAsync(cancellationToken);
        var facts = await BuildFactsAsync(employee, asOf, cancellationToken);

        return new EmployeeDetailsDto(
            employee.Id,
            employee.TenantId,
            employee.StableEmployeeKey,
            employee.EmployeeNumber,
            employee.FirstName,
            employee.LastName,
            employee.PreferredName,
            employee.Email,
            CanViewField(settings, "phone", audience) ? employee.Phone : null,
            facts.Employment is null
                ? null
                : new EmployeeCurrentEmploymentDto(
                    facts.Employment.Id,
                    facts.Employment.EffectiveFrom,
                    facts.Employment.EffectiveTo,
                    facts.Employment.Status,
                    CanViewField(settings, "employmentType", audience) ? facts.Employment.EmploymentType : null),
            facts.Assignment is null
                ? null
                : new EmployeeCurrentWorkAssignmentDto(
                    facts.Assignment.WorkAssignmentId,
                    facts.Assignment.EmploymentId,
                    facts.Assignment.OrgUnitId,
                    facts.OrgUnit?.Name,
                    facts.OrgUnit?.Type,
                    facts.Assignment.JobTitle,
                    CanViewField(settings, "workLocation", audience) ? facts.Assignment.WorkLocation : null,
                    true,
                    facts.Assignment.EffectiveFrom,
                    facts.Assignment.EffectiveTo),
            facts.Manager is null || facts.ManagerEmployee is null
                ? null
                : new EmployeeCurrentManagerDto(
                    facts.Manager.RelationshipId,
                    facts.Manager.ManagerEmployeeId,
                    facts.ManagerEmployee.StableEmployeeKey,
                    facts.Manager.ManagerWorkAssignmentId,
                    facts.ManagerEmployee.FirstName,
                    facts.ManagerEmployee.LastName,
                    facts.ManagerEmployee.Email,
                    facts.Manager.EffectiveFrom,
                    facts.Manager.EffectiveTo),
            new EmployeeHistorySummaryDto(facts.EmploymentCount, facts.WorkAssignmentCount, facts.ManagerRelationshipCount),
            BuildReadiness(employee, settings, facts),
            employee.CreatedAt,
            employee.UpdatedAt,
            employee.Version);
    }

    public async Task<EmployeeListItemDto> BuildListItemAsync(
        Employee employee,
        EmployeeReadAudience audience,
        DateTime? asOf,
        CancellationToken cancellationToken)
    {
        var settings = await tenantSettingsReadService.GetCurrentAsync(cancellationToken);
        var facts = await BuildFactsAsync(employee, asOf, cancellationToken);

        return new EmployeeListItemDto(
            employee.Id,
            employee.StableEmployeeKey,
            employee.EmployeeNumber,
            employee.FirstName,
            employee.LastName,
            employee.PreferredName,
            employee.Email,
            facts.Assignment?.OrgUnitId,
            facts.OrgUnit?.Name,
            CanViewField(settings, "jobTitle", audience) ? facts.Assignment?.JobTitle : null,
            ToEmployeeStatus(facts.Employment),
            facts.Employment?.EffectiveFrom ?? default,
            facts.Manager?.ManagerEmployeeId,
            facts.ManagerEmployee is null ? null : $"{facts.ManagerEmployee.FirstName} {facts.ManagerEmployee.LastName}",
            facts.HierarchyStatus,
            facts.DirectReportCount,
            employee.Version)
        {
            Readiness = BuildReadiness(employee, settings, facts)
        };
    }

    private static EmployeeReadinessSummaryDto BuildReadiness(
        Employee employee,
        TenantSettingsDto settings,
        CanonicalEmployeeReadFacts facts)
    {
        var issues = new List<EmployeeReadinessIssueDto>();

        AddRequiredFieldIssueIfMissing(issues, employee.FirstName, "firstName", "First name", settings, employee);
        AddRequiredFieldIssueIfMissing(issues, employee.LastName, "lastName", "Last name", settings, employee);
        AddRequiredFieldIssueIfMissing(issues, employee.Email, "email", "Email", settings, employee);
        AddRequiredFieldIssueIfMissing(issues, employee.Phone, "phone", "Phone", settings, employee);

        if (IsFieldRequired(settings, "employmentType") && string.IsNullOrWhiteSpace(facts.Employment?.EmploymentType))
        {
            issues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.MissingRequiredField,
                "Employment type is required.",
                EmployeeReadinessIssueSeverities.Attention,
                "employmentType",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileEmployment, employee.Id, employee.StableEmployeeKey, FieldKey: "employmentType")));
        }

        if (facts.Assignment is null)
        {
            issues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.MissingOrgUnit,
                "Primary work assignment is missing.",
                EmployeeReadinessIssueSeverities.Attention,
                "orgUnitId",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileOrganization, employee.Id, employee.StableEmployeeKey, FieldKey: "orgUnitId")));
        }

        if (IsFieldRequired(settings, "jobTitle") && string.IsNullOrWhiteSpace(facts.Assignment?.JobTitle))
        {
            issues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.MissingRequiredField,
                "Job title is required.",
                EmployeeReadinessIssueSeverities.Attention,
                "jobTitle",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileEmployment, employee.Id, employee.StableEmployeeKey, FieldKey: "jobTitle")));
        }

        if (IsFieldRequired(settings, "workLocation") && string.IsNullOrWhiteSpace(facts.Assignment?.WorkLocation))
        {
            issues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.MissingRequiredField,
                "Work location is required.",
                EmployeeReadinessIssueSeverities.Attention,
                "workLocation",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileEmployment, employee.Id, employee.StableEmployeeKey, FieldKey: "workLocation")));
        }

        if (facts.Manager is null)
        {
            if (facts.DirectReportCount == 0)
            {
                issues.Add(new EmployeeReadinessIssueDto(
                    EmployeeReadinessIssueCodes.NoManagerAssigned,
                    "No manager is assigned.",
                    EmployeeReadinessIssueSeverities.Attention,
                    "managerId",
                    new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ReportingRelationships, employee.Id, employee.StableEmployeeKey, FieldKey: "managerId")));
            }
        }
        else if (facts.ManagerEmployee is null)
        {
            issues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.ManagerMissing,
                "Assigned manager could not be resolved.",
                EmployeeReadinessIssueSeverities.Attention,
                "managerId",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ReportingRelationships, employee.Id, employee.StableEmployeeKey, FieldKey: "managerId")));
        }
        else if (facts.ManagerEmployment?.Status != EmploymentStatus.Active)
        {
            issues.Add(new EmployeeReadinessIssueDto(
                EmployeeReadinessIssueCodes.ManagerInactive,
                "Assigned manager does not have an active employment.",
                EmployeeReadinessIssueSeverities.Attention,
                "managerId",
                new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ReportingRelationships, employee.Id, employee.StableEmployeeKey, FieldKey: "managerId")));
        }

        var blockers = facts.Employment?.Status == EmploymentStatus.Active && facts.DirectReportCount > 0
            ? new[]
            {
                new EmployeeReadinessIssueDto(
                    EmployeeReadinessIssueCodes.DeactivationBlocked,
                    facts.DirectReportCount == 1
                        ? "Employee cannot be deactivated while 1 active direct report remains"
                        : $"Employee cannot be deactivated while {facts.DirectReportCount} active direct report{(facts.DirectReportCount == 1 ? string.Empty : "s")} remain",
                    EmployeeReadinessIssueSeverities.Blocker,
                    null,
                    new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileStatus, employee.Id, employee.StableEmployeeKey))
            }
            : Array.Empty<EmployeeReadinessIssueDto>();

        return new EmployeeReadinessSummaryDto(
            issues.Count,
            blockers.Length,
            issues,
            blockers);
    }

    private static void AddRequiredFieldIssueIfMissing(
        ICollection<EmployeeReadinessIssueDto> issues,
        string? value,
        string fieldKey,
        string label,
        TenantSettingsDto settings,
        Employee employee)
    {
        if (!IsFieldRequired(settings, fieldKey) || !string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        issues.Add(new EmployeeReadinessIssueDto(
            EmployeeReadinessIssueCodes.MissingRequiredField,
            $"{label} is required.",
            EmployeeReadinessIssueSeverities.Attention,
            fieldKey,
            new EmployeeReadinessFixTargetDto(EmployeeReadinessFixTargetKinds.ProfileIdentity, employee.Id, employee.StableEmployeeKey, FieldKey: fieldKey)));
    }

    private static bool IsFieldRequired(TenantSettingsDto settings, string fieldKey)
        => settings.EmployeeFieldConfig.TryGetValue(fieldKey, out var fieldConfig) && fieldConfig.Required;

    private static bool CanViewField(TenantSettingsDto settings, string fieldName, EmployeeReadAudience audience)
    {
        if (!settings.EmployeeFieldConfig.TryGetValue(fieldName, out var fieldConfig))
        {
            return true;
        }

        return audience switch
        {
            EmployeeReadAudience.HrAdmin => fieldConfig.Visible,
            EmployeeReadAudience.Manager => fieldConfig.Visible && fieldConfig.VisibleToManager,
            EmployeeReadAudience.Employee => fieldConfig.Visible && fieldConfig.VisibleToEmployee,
            _ => false,
        };
    }

    private static DateTime Normalize(DateTime? value)
    {
        if (value is null)
        {
            return DateTime.UtcNow;
        }

        return value.Value.Kind switch
        {
            DateTimeKind.Utc => value.Value,
            DateTimeKind.Local => value.Value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value.Value, DateTimeKind.Utc)
        };
    }

    private async Task<CanonicalEmployeeReadFacts> BuildFactsAsync(
        Employee employee,
        DateTime? asOf,
        CancellationToken cancellationToken)
    {
        var at = Normalize(asOf);
        var employment = await workforceCanonicalResolver.GetCurrentEmploymentAsync(employee.Id, at, cancellationToken)
            ?? await dbContext.Employments
                .AsNoTracking()
                .Where(x => x.EmployeeId == employee.Id)
                .OrderByDescending(x => x.EffectiveFrom)
                .FirstOrDefaultAsync(cancellationToken);

        var assignment = await workforceCanonicalResolver.GetPrimaryWorkAssignmentAsync(employee.Id, at, cancellationToken)
            ?? await dbContext.WorkAssignments
                .AsNoTracking()
                .Where(x => x.EmployeeId == employee.Id && x.IsPrimary)
                .OrderByDescending(x => x.EffectiveFrom)
                .Select(x => new PrimaryWorkAssignmentSnapshot(
                    x.Id,
                    x.EmploymentId,
                    x.OrgUnitId,
                    x.JobTitle,
                    x.WorkLocation,
                    x.EffectiveFrom,
                    x.EffectiveTo,
                    x.JobId,
                    x.PlaceId))
                .FirstOrDefaultAsync(cancellationToken);

        var manager = await workforceCanonicalResolver.GetPrimaryManagerAsync(employee.Id, at, cancellationToken);
        OrgUnit? orgUnit = null;
        if (assignment is not null)
        {
            orgUnit = await dbContext.OrgUnits
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == assignment.OrgUnitId, cancellationToken);
        }

        Employee? managerEmployee = null;
        Employment? managerEmployment = null;
        if (manager is not null)
        {
            managerEmployee = await dbContext.Employees
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == manager.ManagerEmployeeId, cancellationToken);

            if (managerEmployee is not null)
            {
                managerEmployment = await workforceCanonicalResolver.GetCurrentEmploymentAsync(
                    manager.ManagerEmployeeId,
                    at,
                    cancellationToken);
            }
        }

        var canonicalDirectReportCount = await dbContext.ManagerRelationships
            .AsNoTracking()
            .CountAsync(
                x => x.ManagerEmployeeId == employee.Id
                    && x.Type == ReportingRelationshipType.PrimaryManager
                    && x.EffectiveFrom <= at
                    && (x.EffectiveTo == null || at < x.EffectiveTo),
                cancellationToken);
        var directReportCount = canonicalDirectReportCount;

        var employmentCount = await dbContext.Employments
            .AsNoTracking()
            .CountAsync(x => x.EmployeeId == employee.Id, cancellationToken);
        var workAssignmentCount = await dbContext.WorkAssignments
            .AsNoTracking()
            .CountAsync(x => x.EmployeeId == employee.Id, cancellationToken);
        var managerRelationshipCount = await dbContext.ManagerRelationships
            .AsNoTracking()
            .CountAsync(
                x => x.SubjectEmployeeId == employee.Id
                    && x.Type == ReportingRelationshipType.PrimaryManager,
                cancellationToken);

        var hierarchyStatus = manager switch
        {
            null when directReportCount > 0 => EmployeeHierarchyStatuses.Root,
            null => EmployeeHierarchyStatuses.NoManagerAssigned,
            _ when managerEmployee is null => EmployeeHierarchyStatuses.ManagerMissing,
            _ when managerEmployment?.Status != EmploymentStatus.Active => EmployeeHierarchyStatuses.ManagerInactive,
            _ => EmployeeHierarchyStatuses.Healthy
        };

        return new CanonicalEmployeeReadFacts(
            employment,
            assignment,
            manager,
            orgUnit,
            managerEmployee,
            managerEmployment,
            directReportCount,
            hierarchyStatus,
            employmentCount,
            workAssignmentCount,
            managerRelationshipCount);
    }

    private static EmployeeStatus ToEmployeeStatus(Employment? employment)
        => employment?.Status == EmploymentStatus.Active
            ? EmployeeStatus.Active
            : EmployeeStatus.Inactive;
}

internal sealed record CanonicalEmployeeReadFacts(
    Employment? Employment,
    PrimaryWorkAssignmentSnapshot? Assignment,
    PrimaryManagerSnapshot? Manager,
    OrgUnit? OrgUnit,
    Employee? ManagerEmployee,
    Employment? ManagerEmployment,
    int DirectReportCount,
    string HierarchyStatus,
    int EmploymentCount,
    int WorkAssignmentCount,
    int ManagerRelationshipCount);
