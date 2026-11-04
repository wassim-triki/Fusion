using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

/// <summary>
/// Positive evidence of activation establishment, with no subsequent edits to the person's record.
/// Legacy manual establishments cannot prove activation and deliberately fail closed. Tenant filters apply to
/// every query. Extending a start is allowed only for the original, open employment and primary assignment.
/// </summary>
public static class FirstPersonHistory
{
    public const string SourceReference = "FirstPerson:Activation";

    public static async Task<HashSet<Guid>> UntouchedAsync(CoreHRDbContext db, CancellationToken cancellationToken)
    {
        var candidates = await db.Employees.AsNoTracking().Where(person => person.UpdatedAt == null
                && db.WorkforceAuditEntries.Any(entry => entry.EntityId == person.Id && entry.EntityType == "Employee"
                    && entry.Action == WorkforceAuditAction.Establish && entry.SourceReference == SourceReference))
            .Select(person => person.Id).ToListAsync(cancellationToken);
        var eligible = new HashSet<Guid>();
        foreach (var id in candidates)
        {
            var employments = await db.Employments.AsNoTracking().Where(row => row.EmployeeId == id).ToListAsync(cancellationToken);
            var assignments = await db.WorkAssignments.AsNoTracking().Where(row => row.EmployeeId == id).ToListAsync(cancellationToken);
            if (employments.Count != 1 || assignments.Count != 1) continue;
            var employment = employments[0];
            var work = assignments[0];
            if (!employment.IsActive || employment.UpdatedAt != null || employment.SourceReference != SourceReference
                || work.EmploymentId != employment.Id || !work.IsPrimary || work.EffectiveTo != null || work.UpdatedAt != null
                || work.SourceReference != SourceReference || work.EffectiveFrom != employment.EffectiveFrom) continue;
            if (await db.ManagerRelationships.AnyAsync(row => row.SubjectEmployeeId == id || row.ManagerEmployeeId == id, cancellationToken)
                || await db.EmploymentTypePeriods.AnyAsync(row => row.EmployeeId == id, cancellationToken)
                || await db.WorkforceChanges.AnyAsync(row => row.EmployeeId == id, cancellationToken)
                || await db.EmployeeFieldValues.AnyAsync(row => row.EmployeeId == id, cancellationToken)) continue;
            var history = await db.WorkforceAuditEntries.AsNoTracking()
                .Where(entry => entry.EntityId == id || entry.EntityId == employment.Id || entry.EntityId == work.Id)
                .ToListAsync(cancellationToken);
            if (history.Count == 3
                && history.All(entry => entry.Source == WorkforceSourceType.Manual && entry.SourceReference == SourceReference)
                && history.Count(entry => entry.EntityId == id && entry.EntityType == "Employee" && entry.Action == WorkforceAuditAction.Establish) == 1
                && history.Count(entry => entry.EntityId == employment.Id && entry.EntityType == "Employment" && entry.Action == WorkforceAuditAction.EmploymentStarted) == 1
                && history.Count(entry => entry.EntityId == work.Id && entry.EntityType == "WorkAssignment" && entry.Action == WorkforceAuditAction.WorkAssignmentCreated) == 1)
                eligible.Add(id);
        }
        return eligible;
    }
}
