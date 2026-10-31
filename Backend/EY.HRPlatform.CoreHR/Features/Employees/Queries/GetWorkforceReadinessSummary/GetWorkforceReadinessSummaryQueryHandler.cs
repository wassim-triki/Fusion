using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Employees.Queries.GetWorkforceReadinessSummary;

public sealed class GetWorkforceReadinessSummaryQueryHandler(
    CoreHRDbContext dbContext,
    ITenantSettingsReadService tenantSettingsReadService) : IQueryHandler<GetWorkforceReadinessSummaryQuery, Result<WorkforceReadinessSummaryDto>>
{
    public async Task<Result<WorkforceReadinessSummaryDto>> Handle(
        GetWorkforceReadinessSummaryQuery request,
        CancellationToken cancellationToken)
    {
        var settings = await tenantSettingsReadService.GetCurrentAsync(cancellationToken);
        var now = DateTime.UtcNow;

        var activeEmployeeIds = await dbContext.Employments
            .AsNoTracking()
            .Where(e => e.EffectiveFrom <= now && (e.EffectiveTo == null || now < e.EffectiveTo))
            .Select(e => e.EmployeeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var activeEmployeeCount = activeEmployeeIds.Count;

        if (activeEmployeeCount == 0)
        {
            return Result.Success(new WorkforceReadinessSummaryDto(
                0, 0, 0, 100m,
                new WorkforceReadinessIssueCountsDto(0, 0, 0, 0, 0, 0, 0)));
        }

        var (readyCounts, issueCounts) = await ComputeReadinessAsync(activeEmployeeIds, settings, now, cancellationToken);
        // The legacy import follow-up-issue product was retired; canonical establishment leaves no
        // unresolved import issues, so this count is always zero.
        const int unresolvedImportIssueCount = 0;

        var readyEmployeeCount = readyCounts;
        var employeesNeedingAttention = activeEmployeeCount - readyEmployeeCount;
        var readinessScore = activeEmployeeCount == 0
            ? 100m
            : Math.Round(readyEmployeeCount * 100m / activeEmployeeCount, 1, MidpointRounding.AwayFromZero);

        return Result.Success(new WorkforceReadinessSummaryDto(
            activeEmployeeCount,
            readyEmployeeCount,
            employeesNeedingAttention,
            readinessScore,
            new WorkforceReadinessIssueCountsDto(
                issueCounts.MissingRequiredFields,
                issueCounts.MissingOrgUnit,
                issueCounts.NoManagerAssigned,
                issueCounts.ManagerInactive,
                issueCounts.ManagerMissing,
                issueCounts.DeactivationBlocked,
                unresolvedImportIssueCount)));
    }

    private async Task<(int ReadyCount, CanonicalIssueCounts Issues)> ComputeReadinessAsync(
        IReadOnlyList<Guid> employeeIds,
        TenantSettingsDto settings,
        DateTime now,
        CancellationToken cancellationToken)
    {
        // Employee identity facts
        var employees = await dbContext.Employees
            .AsNoTracking()
            .Where(e => employeeIds.Contains(e.Id))
            .Select(e => new { e.Id, e.FirstName, e.LastName, e.Email, e.Phone })
            .ToListAsync(cancellationToken);

        // Active Employment facts (employment type)
        var employmentFacts = await dbContext.Employments
            .AsNoTracking()
            .Where(e => employeeIds.Contains(e.EmployeeId)
                && e.EffectiveFrom <= now && (e.EffectiveTo == null || now < e.EffectiveTo))
            .Select(e => new { e.EmployeeId, e.EmploymentType })
            .ToListAsync(cancellationToken);
        var employmentByEmployee = employmentFacts
            .GroupBy(e => e.EmployeeId)
            .ToDictionary(g => g.Key, g => g.First().EmploymentType);
        var currentEmploymentTypes = await dbContext.EmploymentTypePeriods.AsNoTracking()
            .Where(item => employeeIds.Contains(item.EmployeeId) && item.EffectiveFrom <= now
                && (item.EffectiveTo == null || now < item.EffectiveTo))
            .GroupBy(item => item.EmployeeId)
            .Select(group => group.OrderByDescending(item => item.EffectiveFrom).First())
            .ToDictionaryAsync(item => item.EmployeeId, item => item.EmploymentType, cancellationToken);
        foreach (var (employeeId, employmentType) in currentEmploymentTypes)
            employmentByEmployee[employeeId] = employmentType;

        // Primary WorkAssignment facts (org unit, job title, work location)
        var primaryAssignments = await dbContext.WorkAssignments
            .AsNoTracking()
            .Where(wa => employeeIds.Contains(wa.EmployeeId)
                && wa.IsPrimary
                && wa.EffectiveFrom <= now && (wa.EffectiveTo == null || now < wa.EffectiveTo))
            .Select(wa => new { wa.EmployeeId, wa.JobTitle, wa.WorkLocation })
            .ToListAsync(cancellationToken);
        var assignmentByEmployee = primaryAssignments
            .GroupBy(wa => wa.EmployeeId)
            .ToDictionary(g => g.Key, g => g.First());

        // Primary manager relationships (subject → manager)
        var primaryManagerLinks = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(mr => employeeIds.Contains(mr.SubjectEmployeeId)
                && mr.Type == ReportingRelationshipType.PrimaryManager
                && mr.EffectiveFrom <= now && (mr.EffectiveTo == null || now < mr.EffectiveTo))
            .Select(mr => new { mr.SubjectEmployeeId, mr.ManagerEmployeeId })
            .ToListAsync(cancellationToken);
        var managerByEmployee = primaryManagerLinks
            .GroupBy(m => m.SubjectEmployeeId)
            .ToDictionary(g => g.Key, g => g.First().ManagerEmployeeId);

        // Verify manager existence and active status
        var managerEmployeeIds = managerByEmployee.Values.Distinct().ToList();
        HashSet<Guid> existingManagerIds;
        HashSet<Guid> activeManagerIds;
        if (managerEmployeeIds.Count == 0)
        {
            existingManagerIds = [];
            activeManagerIds = [];
        }
        else
        {
            existingManagerIds = (await dbContext.Employees
                .AsNoTracking()
                .Where(e => managerEmployeeIds.Contains(e.Id))
                .Select(e => e.Id)
                .ToListAsync(cancellationToken)).ToHashSet();

            activeManagerIds = (await dbContext.Employments
                .AsNoTracking()
                .Where(e => managerEmployeeIds.Contains(e.EmployeeId)
                    && e.EffectiveFrom <= now && (e.EffectiveTo == null || now < e.EffectiveTo))
                .Select(e => e.EmployeeId)
                .Distinct()
                .ToListAsync(cancellationToken)).ToHashSet();
        }

        // Direct report counts per manager (for root detection and termination-block counting)
        var directReportCounts = await dbContext.ManagerRelationships
            .AsNoTracking()
            .Where(mr => employeeIds.Contains(mr.ManagerEmployeeId)
                && mr.Type == ReportingRelationshipType.PrimaryManager
                && mr.EffectiveFrom <= now && (mr.EffectiveTo == null || now < mr.EffectiveTo))
            .GroupBy(mr => mr.ManagerEmployeeId)
            .Select(g => new { ManagerId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.ManagerId, g => g.Count, cancellationToken);

        int readyCount = 0, missingRequired = 0, missingOrgUnit = 0, noManager = 0,
            managerInactive = 0, managerMissing = 0, deactivationBlocked = 0;

        foreach (var employee in employees)
        {
            var hasStateIssue = false;

            // Profile identity required fields
            if (IsRequired(settings, "firstName") && string.IsNullOrWhiteSpace(employee.FirstName)) hasStateIssue = true;
            if (IsRequired(settings, "lastName") && string.IsNullOrWhiteSpace(employee.LastName)) hasStateIssue = true;
            if (IsRequired(settings, "email") && string.IsNullOrWhiteSpace(employee.Email)) hasStateIssue = true;

            var hasMissingRequired = false;
            if (IsRequired(settings, "phone") && string.IsNullOrWhiteSpace(employee.Phone)) hasMissingRequired = true;

            // Employment type
            if (IsRequired(settings, "employmentType"))
            {
                var empType = employmentByEmployee.GetValueOrDefault(employee.Id);
                if (string.IsNullOrWhiteSpace(empType)) hasMissingRequired = true;
            }

            // hireDate: satisfied whenever an active Employment exists (already ensured by employeeIds filtering)

            // WorkAssignment-based fields and org unit
            if (!assignmentByEmployee.TryGetValue(employee.Id, out var assignment))
            {
                missingOrgUnit++;
                hasStateIssue = true;
                if (IsRequired(settings, "jobTitle")) hasMissingRequired = true;
                if (IsRequired(settings, "workLocation")) hasMissingRequired = true;
            }
            else
            {
                if (IsRequired(settings, "jobTitle") && string.IsNullOrWhiteSpace(assignment.JobTitle)) hasMissingRequired = true;
                if (IsRequired(settings, "workLocation") && string.IsNullOrWhiteSpace(assignment.WorkLocation)) hasMissingRequired = true;
            }

            if (hasMissingRequired) { missingRequired++; hasStateIssue = true; }

            // Manager relationship
            if (!managerByEmployee.TryGetValue(employee.Id, out var mgr))
            {
                var reportCount = directReportCounts.GetValueOrDefault(employee.Id);
                if (reportCount == 0) { noManager++; hasStateIssue = true; }
                // Root employees (have reports but no manager) are considered healthy
            }
            else if (!existingManagerIds.Contains(mgr))
            {
                managerMissing++;
                hasStateIssue = true;
            }
            else if (!activeManagerIds.Contains(mgr))
            {
                managerInactive++;
                hasStateIssue = true;
            }

            // Termination-blocked: employee has active canonical direct reports
            if (directReportCounts.GetValueOrDefault(employee.Id) > 0) deactivationBlocked++;

            if (!hasStateIssue) readyCount++;
        }

        return (readyCount, new CanonicalIssueCounts(
            missingRequired, missingOrgUnit, noManager, managerInactive, managerMissing, deactivationBlocked));
    }

    private static bool IsRequired(TenantSettingsDto settings, string fieldKey)
        => settings.EmployeeFieldConfig.TryGetValue(fieldKey, out var config) && config.Required;

    private sealed record CanonicalIssueCounts(
        int MissingRequiredFields,
        int MissingOrgUnit,
        int NoManagerAssigned,
        int ManagerInactive,
        int ManagerMissing,
        int DeactivationBlocked);
}
