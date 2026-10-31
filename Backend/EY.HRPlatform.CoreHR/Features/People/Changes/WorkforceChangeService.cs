using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People.Changes;

/// <summary>
/// Stages people changes (job change, end of employment, rehire) and their cancellation onto the tracked
/// <see cref="CoreHRDbContext"/>. Each change goes through <see cref="IWorkforceMutationService"/> for the row
/// rules, then <see cref="WorkforceChangeRecorder"/> turns what it staged into one <see cref="WorkforceChange"/>.
/// Callers commit once, inside a transaction.
/// </summary>
public sealed class WorkforceChangeService(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IWorkforceMutationService mutations,
    IOrganizationService organizations,
    IWorkEmailOccupancyService occupancy,
    CoreChangeNotifications notifications)
{
    public const string ForbiddenCode = "Change.Forbidden";

    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    internal static DateTime At(DateOnly date) => DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

    // --- Job change -------------------------------------------------------------------------------

    public async Task<Result<WorkforceChange>> StageJobChangeAsync(
        Employee subject, JobChangeRequest request, string actor, bool canManageEmployees, CancellationToken cancellationToken)
    {
        var date = DateOnly.FromDateTime(request.EffectiveDate);
        var at = At(date);
        var touchesWork = request.OrgUnitId is not null || request.JobId is not null || request.PlaceId is not null || request.RemovePlace;
        if (touchesWork && !canManageEmployees)
            return Forbidden<WorkforceChange>();

        var refused = ValidateDate(date) ?? await EnsureAfterLastScheduledAsync(subject.Id, subject.DisplayName, date, cancellationToken);
        if (refused is not null)
            return Result.Failure<WorkforceChange>(refused);

        var reason = await ReasonAsync(request.ReasonId, cancellationToken);
        if (reason.IsFailure)
            return Result.Failure<WorkforceChange>(reason.Error);

        var assignment = await ActiveAssignmentAsync(subject.Id, at, cancellationToken);
        if (assignment is null)
            return Fail<WorkforceChange>("Change.NotEmployed", $"{subject.DisplayName} is not employed on {date:d MMM yyyy}.");
        var currentLine = await ActivePrimaryLineAsync(subject.Id, at, cancellationToken);

        var unitTo = request.OrgUnitId ?? assignment.OrgUnitId;
        var jobTo = request.JobId ?? assignment.JobId;
        var placeTo = request.RemovePlace ? null : request.PlaceId ?? assignment.PlaceId;
        var unitChanged = unitTo != assignment.OrgUnitId;
        var titleChanged = jobTo != assignment.JobId;
        var locationChanged = placeTo != assignment.PlaceId;
        string? titleTo = null;
        string? locationTo = null;

        Guid? managerTo = request.RemoveManager ? null : request.ManagerEmployeeId ?? currentLine?.ManagerEmployeeId;
        var managerChanged = managerTo != currentLine?.ManagerEmployeeId;
        if (!unitChanged && !titleChanged && !locationChanged && !managerChanged)
            return Fail<WorkforceChange>("Change.NothingChanges", "Nothing changes. Pick a new manager or change a job fact.");

        // The team is read before anything is staged: the reports of the person on that date.
        var team = await ActiveReportLinesAsync(subject.Id, at, cancellationToken);

        if (unitChanged || titleChanged || locationChanged)
        {
            var work = await mutations.ChangeWorkAssignmentAsync(
                subject.Id, new ChangeWorkAssignmentInput(unitTo, jobTo, placeTo, at, WorkforceSourceType.Manual), actor, cancellationToken);
            if (work.IsFailure)
                return Result.Failure<WorkforceChange>(work.Error);
            titleTo = work.Value.JobTitle;
            locationTo = work.Value.WorkLocation;
        }

        var dottedLinesEnded = new List<EndedDottedLine>();
        if (managerChanged)
        {
            if (managerTo is { } newManager)
            {
                // A dotted line to the new manager ends: they become the manager.
                var dotted = await OpenDottedLineAsync(subject.Id, newManager, at, cancellationToken);
                if (dotted is not null && dotted.EffectiveFrom < at)
                {
                    var ended = await mutations.EndDottedLineManagerAsync(
                        subject.Id, new ChangeManagerInput(newManager, at), actor, cancellationToken);
                    if (ended.IsFailure)
                        return Result.Failure<WorkforceChange>(ended.Error);
                    dottedLinesEnded.Add(new EndedDottedLine(Ref(subject), await PersonAsync(newManager, cancellationToken)));
                }

                var changed = await mutations.ChangeManagerAsync(
                    subject.Id, new ChangeManagerInput(newManager, at), actor, cancellationToken);
                if (changed.IsFailure)
                    return Result.Failure<WorkforceChange>(changed.Error);
            }
            else
            {
                var removed = await mutations.RemovePrimaryManagerAsync(
                    subject.Id, at, WorkforceSourceType.Manual, null, null, actor, cancellationToken);
                if (removed.IsFailure)
                    return Result.Failure<WorkforceChange>(removed.Error);
            }
        }

        string? teamOutcome = null;
        ChangePersonRef? teamManager = null;
        if (team.Count > 0)
        {
            teamOutcome = request.Team?.Stays == true ? "Stays" : "Along";
            if (teamOutcome == "Stays")
            {
                var target = request.Team!.ManagerEmployeeId ?? currentLine?.ManagerEmployeeId;
                if (target is not { } teamTarget)
                    return Fail<WorkforceChange>("Change.TeamManagerRequired", $"Choose who {subject.DisplayName}'s team reports to.");
                if (teamTarget == subject.Id)
                    return Fail<WorkforceChange>("Change.TeamManagerSelf", $"The team can't stay with {subject.DisplayName}: they are the one moving.");

                foreach (var line in team)
                {
                    if (line.SubjectEmployeeId == teamTarget)
                        continue; // The new manager of the team keeps their own line.
                    var report = await dbContext.Employees.FirstAsync(item => item.Id == line.SubjectEmployeeId, cancellationToken);
                    var reportRefused = await EnsureAfterLastScheduledAsync(report.Id, report.DisplayName, date, cancellationToken);
                    if (reportRefused is not null)
                        return Result.Failure<WorkforceChange>(reportRefused);
                    var moved = await mutations.ChangeManagerAsync(
                        report.Id, new ChangeManagerInput(teamTarget, at), actor, cancellationToken);
                    if (moved.IsFailure)
                        return Result.Failure<WorkforceChange>(moved.Error);
                }
                teamManager = await PersonAsync(teamTarget, cancellationToken);
            }
        }

        var details = new WorkforceChangeDetails(
            ManagerFrom: currentLine is null ? null : await PersonAsync(currentLine.ManagerEmployeeId, cancellationToken),
            ManagerTo: managerTo is { } to ? await PersonAsync(to, cancellationToken) : null,
            ManagerChanged: managerChanged,
            UnitFromId: assignment.OrgUnitId,
            UnitFrom: await UnitNameAsync(assignment.OrgUnitId, date, cancellationToken),
            UnitToId: unitTo,
            UnitTo: unitChanged ? await UnitNameAsync(unitTo, date, cancellationToken) : null,
            TitleFrom: assignment.JobTitle,
            TitleTo: titleChanged ? titleTo : null,
            LocationFrom: assignment.WorkLocation,
            LocationTo: locationChanged ? locationTo : null,
            UnitChanged: unitChanged,
            TitleChanged: titleChanged,
            LocationChanged: locationChanged,
            TeamOutcome: teamOutcome,
            TeamCount: team.Count,
            TeamManager: teamManager,
            DottedLinesEnded: dottedLinesEnded,
            JobFromId: assignment.JobId,
            JobToId: titleChanged ? jobTo : null,
            PlaceFromId: assignment.PlaceId,
            PlaceToId: locationChanged ? placeTo : null,
            ReasonId: reason.Value?.Id,
            Reason: reason.Value?.Label);

        var change = WorkforceChangeRecorder.Record(
            dbContext, tenantContext.TenantId, subject.Id, WorkforceChangeKind.JobChange, date, request.Note, details, actor);
        await notifications.StageAsync(change, details, cancellationToken);
        return Result.Success(change);
    }

    // --- End of employment ------------------------------------------------------------------------

    public async Task<Result<EndEmploymentChangePreviewDto>> PreviewEndEmploymentAsync(
        Employee subject, DateOnly lastDay, CancellationToken cancellationToken)
    {
        var lastAt = At(lastDay);
        var boundary = At(lastDay.AddDays(1));
        var todayAt = At(Today);

        var ownLine = await ActivePrimaryLineAsync(subject.Id, lastAt, cancellationToken);
        var defaultManager = ownLine is null ? null : await PersonAsync(ownLine.ManagerEmployeeId, cancellationToken);

        // Everyone who reports to them between today and the last day, found by the manager (not their assignment).
        var lines = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(line => line.ManagerEmployeeId == subject.Id
                && line.Type == ReportingRelationshipType.PrimaryManager
                && line.EffectiveFrom <= lastAt
                && (line.EffectiveTo == null || line.EffectiveTo > todayAt))
            .ToListAsync(cancellationToken);

        var reports = new List<EndEmploymentReportDto>();
        foreach (var line in lines.GroupBy(item => item.SubjectEmployeeId).Select(group => group.OrderByDescending(item => item.EffectiveFrom).First()))
        {
            var person = await PersonAsync(line.SubjectEmployeeId, cancellationToken);
            var title = await dbContext.WorkAssignments.AsNoTracking()
                .Where(item => item.EmployeeId == line.SubjectEmployeeId && item.IsPrimary
                    && item.EffectiveFrom <= lastAt && (item.EffectiveTo == null || lastAt < item.EffectiveTo))
                .Select(item => item.JobTitle)
                .FirstOrDefaultAsync(cancellationToken);
            var teamSize = await dbContext.ManagerRelationships.AsNoTracking()
                .CountAsync(item => item.ManagerEmployeeId == line.SubjectEmployeeId
                    && item.Type == ReportingRelationshipType.PrimaryManager
                    && item.EffectiveFrom <= lastAt && (item.EffectiveTo == null || lastAt < item.EffectiveTo), cancellationToken);

            if (line.EffectiveTo is null || line.EffectiveTo > boundary)
            {
                reports.Add(new EndEmploymentReportDto(person, title, teamSize, "Reassign", null));
                continue;
            }

            var leaves = await dbContext.Employments.AsNoTracking()
                .AnyAsync(item => item.EmployeeId == line.SubjectEmployeeId && item.EffectiveTo == line.EffectiveTo, cancellationToken);
            reports.Add(new EndEmploymentReportDto(
                person, title, teamSize, leaves ? "LeavesFirst" : "MovesFirst",
                DateOnly.FromDateTime(line.EffectiveTo.Value).AddDays(leaves ? -1 : 0)));
        }

        return Result.Success(new EndEmploymentChangePreviewDto(
            lastDay,
            defaultManager,
            reports.OrderBy(item => item.Outcome == "Reassign" ? 0 : 1).ThenBy(item => item.Person.DisplayName, StringComparer.OrdinalIgnoreCase).ToList(),
            await DottedLinesEndingAsync(subject.Id, lastAt, boundary, cancellationToken)));
    }

    public async Task<Result<WorkforceChange>> StageEndEmploymentAsync(
        Employee subject, EndEmploymentChangeRequest request, string actor, CancellationToken cancellationToken)
    {
        var lastDay = DateOnly.FromDateTime(request.LastDay);
        var boundaryDate = lastDay.AddDays(1);
        var boundary = At(boundaryDate);

        var refused = ValidateDate(lastDay) ?? await EnsureAfterLastScheduledAsync(subject.Id, subject.DisplayName, boundaryDate, cancellationToken);
        if (refused is not null)
            return Result.Failure<WorkforceChange>(refused);

        var reason = await ReasonAsync(request.ReasonId, cancellationToken);
        if (reason.IsFailure)
            return Result.Failure<WorkforceChange>(reason.Error);

        var preview = await PreviewEndEmploymentAsync(subject, lastDay, cancellationToken);
        var overrides = (request.Reports ?? []).ToDictionary(item => item.EmployeeId, item => item.ManagerEmployeeId);
        var toReassign = preview.Value.Reports.Where(item => item.Outcome == "Reassign").ToList();
        var targets = new List<(ChangePersonRef Report, Guid? Manager)>();
        var missing = new List<string>();
        foreach (var report in toReassign)
        {
            var target = overrides.TryGetValue(report.Person.EmployeeId, out var chosen) ? chosen : preview.Value.DefaultManager?.EmployeeId;
            if (!overrides.ContainsKey(report.Person.EmployeeId) && target is null)
                missing.Add(report.Person.DisplayName);
            if (target == subject.Id)
                return Fail<WorkforceChange>("Change.ReportToLeaver", $"{report.Person.DisplayName} can't report to {subject.DisplayName} after their last day.");
            targets.Add((report.Person, target));
        }
        if (missing.Count > 0)
            return Fail<WorkforceChange>("Change.ReportsNeedManager", $"Choose who {string.Join(", ", missing)} report to.");

        var ended = await mutations.EndEmploymentReleasingReportsAsync(
            subject.Id, new EndEmploymentInput(At(lastDay), request.Note, WorkforceSourceType.Manual), actor, cancellationToken);
        if (ended.IsFailure)
            return Result.Failure<WorkforceChange>(ended.Error);

        var reassigned = new List<ReassignedReport>();
        foreach (var (report, target) in targets)
        {
            if (target is { } manager)
            {
                var reportRefused = await EnsureAfterLastScheduledAsync(report.EmployeeId, report.DisplayName, boundaryDate, cancellationToken);
                if (reportRefused is not null)
                    return Result.Failure<WorkforceChange>(reportRefused);
                var moved = await mutations.ChangeManagerAsync(report.EmployeeId, new ChangeManagerInput(manager, boundary), actor, cancellationToken);
                if (moved.IsFailure)
                    return Result.Failure<WorkforceChange>(moved.Error);
                reassigned.Add(new ReassignedReport(report, await PersonAsync(manager, cancellationToken)));
            }
            else
            {
                reassigned.Add(new ReassignedReport(report, null));
            }
        }

        var details = new WorkforceChangeDetails(
            ManagerFrom: preview.Value.DefaultManager,
            Reassigned: reassigned,
            DottedLinesEnded: preview.Value.DottedLinesEnding,
            LastDay: lastDay,
            ReasonId: reason.Value?.Id,
            Reason: reason.Value?.Label);
        var change = WorkforceChangeRecorder.Record(
            dbContext, tenantContext.TenantId, subject.Id, WorkforceChangeKind.EndEmployment, boundaryDate, request.Note, details, actor);
        await notifications.StageAsync(change, details, cancellationToken);
        return Result.Success(change);
    }

    // --- Join (rehire) ----------------------------------------------------------------------------

    public async Task<Result<WorkforceChange>> StageJoinAsync(
        Employee subject, JoinChangeRequest request, string actor, CancellationToken cancellationToken)
    {
        var date = DateOnly.FromDateTime(request.StartDate);
        var at = At(date);
        var refused = ValidateDate(date) ?? await EnsureAfterLastScheduledAsync(subject.Id, subject.DisplayName, date, cancellationToken);
        if (refused is not null)
            return Result.Failure<WorkforceChange>(refused);
        if (request.OrgUnitId == Guid.Empty)
            return Fail<WorkforceChange>("WorkAssignment.OrgUnitRequired", "Unit is required.");

        var employment = await mutations.StartEmploymentAsync(
            subject.Id, new StartEmploymentInput(at, request.EmploymentTypeId, WorkforceSourceType.Manual), actor, cancellationToken);
        if (employment.IsFailure)
            return Result.Failure<WorkforceChange>(employment.Error);
        var work = await mutations.ChangeWorkAssignmentAsync(
            subject.Id, new ChangeWorkAssignmentInput(request.OrgUnitId, request.JobId, request.PlaceId, at, WorkforceSourceType.Manual), actor, cancellationToken);
        if (work.IsFailure)
            return Result.Failure<WorkforceChange>(work.Error);
        if (request.ManagerEmployeeId is { } manager)
        {
            var line = await mutations.ChangeManagerAsync(subject.Id, new ChangeManagerInput(manager, at), actor, cancellationToken);
            if (line.IsFailure)
                return Result.Failure<WorkforceChange>(line.Error);
        }

        dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
            tenantContext.TenantId, "Employee", subject.Id, WorkforceAuditAction.EmployeeRehired,
            WorkforceSourceType.Manual, actor, at, changeDetails: $"Employment starts again on {date:yyyy-MM-dd}."));

        var details = JoinDetails(
            request.ManagerEmployeeId is { } to ? await PersonAsync(to, cancellationToken) : null,
            request.OrgUnitId, await UnitNameAsync(request.OrgUnitId, date, cancellationToken),
            work.Value, employment.Value, isHire: false);
        var change = WorkforceChangeRecorder.Record(
            dbContext, tenantContext.TenantId, subject.Id, WorkforceChangeKind.Join, date, request.Note, details, actor);
        await notifications.StageAsync(change, details, cancellationToken);
        return Result.Success(change);
    }

    internal static WorkforceChangeDetails JoinDetails(
        ChangePersonRef? manager, Guid unitId, string? unitName, WorkAssignment? work, Employment employment, bool isHire)
        => new(
            ManagerTo: manager,
            ManagerChanged: manager is not null,
            UnitToId: unitId,
            UnitTo: unitName,
            TitleTo: work?.JobTitle ?? "",
            LocationTo: work?.WorkLocation,
            UnitChanged: true,
            TitleChanged: true,
            LocationChanged: work?.WorkLocation is not null,
            IsHire: isHire,
            EmploymentType: employment.EmploymentType,
            JobToId: work?.JobId,
            PlaceToId: work?.PlaceId,
            EmploymentTypeId: employment.EmploymentTypeId);

    // --- Cancel -----------------------------------------------------------------------------------

    /// <summary>
    /// Cancels inside the caller's transaction: every row the change created goes (saved first), then every row it
    /// ended gets its old end back (staged).
    /// Only the person's latest change can be cancelled, from its day on it can't, and nothing later may build on it.
    /// </summary>
    public async Task<Result<WorkforceChange>> StageCancelAsync(
        WorkforceChange change, string actor, bool canManageEmployees, CancellationToken cancellationToken)
    {
        var details = ReadDetails(change);
        if (!canManageEmployees && (change.Kind != WorkforceChangeKind.JobChange || !details.IsReportingOnly))
            return Forbidden<WorkforceChange>();
        if (change.IsCancelled)
            return Fail<WorkforceChange>("Change.AlreadyCancelled", "This change was already cancelled.");
        var today = Today;
        var lastDayInEffect = change.Kind == WorkforceChangeKind.EndEmployment ? change.EffectiveDate.AddDays(-1) : change.EffectiveDate;
        if (lastDayInEffect < today)
            return Fail<WorkforceChange>("Change.InEffect", "This change is already in effect. Correcting the past is a separate operation.");

        var later = await dbContext.WorkforceChanges.AsNoTracking()
            .Where(item => item.EmployeeId == change.EmployeeId && item.Id != change.Id && !item.IsCancelled
                && (item.EffectiveDate > change.EffectiveDate || (item.EffectiveDate == change.EffectiveDate && item.CreatedAt > change.CreatedAt)))
            .OrderBy(item => item.EffectiveDate)
            .FirstOrDefaultAsync(cancellationToken);
        if (later is not null)
            return Fail<WorkforceChange>("Change.NotLatestConflict", $"There is a later change on {later.EffectiveDate:d MMM yyyy}. Cancel that one first.");

        // Children before parents, so a removed row never leaves a tracked dependent behind.
        string[] order = [WorkforceChangeEffect.ManagerRelationshipEntity, WorkforceChangeEffect.WorkAssignmentEntity,
            WorkforceChangeEffect.EmploymentEntity, WorkforceChangeEffect.EmployeeEntity];
        var effects = change.Effects.OrderBy(item => Array.IndexOf(order, item.EntityType)).ToList();
        var created = effects.Where(item => item.Action == WorkforceChangeEffectAction.Created).Select(item => item.EntityId).ToHashSet();
        var builtOn = Fail<WorkforceChange>("Change.BuiltOnConflict", "A later change builds on this one. Cancel that one first.");

        var deletesEmployee = false;
        var removals = new List<object>();
        var restores = new List<Action>();
        foreach (var effect in effects)
        {
            switch (effect.EntityType)
            {
                case WorkforceChangeEffect.ManagerRelationshipEntity:
                {
                    var row = await dbContext.ManagerRelationships.FirstOrDefaultAsync(item => item.Id == effect.EntityId, cancellationToken);
                    if (row is null || row.EffectiveTo != effect.AppliedEffectiveTo)
                        return builtOn;
                    if (effect.Action == WorkforceChangeEffectAction.Created) removals.Add(row);
                    else restores.Add(() => row.RestoreEnd(effect.PreviousEffectiveTo));
                    break;
                }
                case WorkforceChangeEffect.WorkAssignmentEntity:
                {
                    var row = await dbContext.WorkAssignments.FirstOrDefaultAsync(item => item.Id == effect.EntityId, cancellationToken);
                    if (row is null || row.EffectiveTo != effect.AppliedEffectiveTo)
                        return builtOn;
                    if (effect.Action == WorkforceChangeEffectAction.Created)
                    {
                        var referenced = await dbContext.ManagerRelationships.AnyAsync(
                            item => (item.SubjectWorkAssignmentId == row.Id || item.ManagerWorkAssignmentId == row.Id) && !created.Contains(item.Id),
                            cancellationToken);
                        if (referenced)
                            return builtOn;
                        removals.Add(row);
                    }
                    else restores.Add(() => row.RestoreEnd(effect.PreviousEffectiveTo));
                    break;
                }
                case WorkforceChangeEffect.EmploymentEntity:
                {
                    var row = await dbContext.Employments.FirstOrDefaultAsync(item => item.Id == effect.EntityId, cancellationToken);
                    if (row is null || row.EffectiveTo != effect.AppliedEffectiveTo)
                        return builtOn;
                    if (effect.Action == WorkforceChangeEffectAction.Created)
                    {
                        if (await dbContext.WorkAssignments.AnyAsync(item => item.EmploymentId == row.Id && !created.Contains(item.Id), cancellationToken))
                            return builtOn;
                        removals.Add(row);
                    }
                    else restores.Add(() => row.RestoreEnd(effect.PreviousEffectiveTo));
                    break;
                }
                case WorkforceChangeEffect.EmployeeEntity:
                {
                    // A scheduled hire: nobody else may have been placed against the person yet.
                    var referenced = await dbContext.ManagerRelationships.AnyAsync(
                        item => (item.SubjectEmployeeId == effect.EntityId || item.ManagerEmployeeId == effect.EntityId) && !created.Contains(item.Id),
                        cancellationToken);
                    if (referenced)
                        return builtOn;
                    deletesEmployee = true;
                    break;
                }
            }
        }

        // Rows the change created go first, so reopening the rows it ended never meets them (one open row per person).
        foreach (var row in removals)
            dbContext.Remove(row);
        await dbContext.SaveChangesAsync(cancellationToken);
        foreach (var restore in restores)
            restore();

        dbContext.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(
            tenantContext.TenantId, "WorkforceChange", change.Id, WorkforceAuditAction.WorkforceChangeCancelled,
            WorkforceSourceType.Manual, actor, At(change.EffectiveDate),
            changeDetails: $"{change.Kind} on {change.EffectiveDate:yyyy-MM-dd} cancelled."));
        await notifications.StageCancelledAsync(change, actor, cancellationToken);

        if (deletesEmployee)
        {
            var employee = await dbContext.Employees.FirstAsync(item => item.Id == change.EmployeeId, cancellationToken);
            dbContext.Employees.Remove(employee); // The change record and the email claim go with them.
        }
        else
        {
            change.Cancel(actor);
            var synced = await occupancy.SynchronizeAsync(change.EmployeeId, cancellationToken);
            if (synced.IsFailure)
                return Result.Failure<WorkforceChange>(synced.Error);
        }

        return Result.Success(change);
    }

    // --- Rules and lookups ------------------------------------------------------------------------

    /// <summary>A reason from the company's change reasons that is still offered; none is fine.</summary>
    private async Task<Result<CompanyListValue?>> ReasonAsync(Guid? reasonId, CancellationToken cancellationToken)
    {
        if (reasonId is not { } id)
            return Result.Success<CompanyListValue?>(null);
        var value = await dbContext.CompanyListValues.AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id && item.List == CompanyList.ChangeReasons && !item.IsRetired, cancellationToken);
        return value is null
            ? Fail<CompanyListValue?>("Change.UnknownReason", "Choose a reason from your company's list.")
            : Result.Success<CompanyListValue?>(value);
    }

    private static Error? ValidateDate(DateOnly date)
        => date < Today
            ? Error.Validation("Change.PastDate", "A change takes effect today or later. Correcting the past is a separate operation.")
            : null;

    /// <summary>
    /// A person's changes apply in order: a new one comes after their last scheduled one (recorded, or written by
    /// someone else's change as a ripple), so a change never ends a row a later one already replaced.
    /// </summary>
    internal async Task<Error?> EnsureAfterLastScheduledAsync(
        Guid employeeId, string displayName, DateOnly date, CancellationToken cancellationToken)
    {
        var today = Today;
        var todayAt = At(today);
        var lastChange = await dbContext.WorkforceChanges.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && !item.IsCancelled && item.EffectiveDate >= today)
            .MaxAsync(item => (DateOnly?)item.EffectiveDate, cancellationToken);
        var lastLine = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.SubjectEmployeeId == employeeId && item.Type == ReportingRelationshipType.PrimaryManager && item.EffectiveFrom > todayAt)
            .MaxAsync(item => (DateTime?)item.EffectiveFrom, cancellationToken);
        var lastWork = await dbContext.WorkAssignments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && item.IsPrimary && item.EffectiveFrom > todayAt)
            .MaxAsync(item => (DateTime?)item.EffectiveFrom, cancellationToken);
        var lastEmployment = await dbContext.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && (item.EffectiveFrom > todayAt || item.EffectiveTo > todayAt))
            .Select(item => item.EffectiveTo > todayAt ? item.EffectiveTo : (DateTime?)item.EffectiveFrom)
            .MaxAsync(cancellationToken);

        var last = new[] { lastLine, lastWork, lastEmployment }
            .Where(item => item.HasValue)
            .Select(item => (DateOnly?)DateOnly.FromDateTime(item!.Value))
            .Append(lastChange)
            .Max();
        return last is { } scheduled && date <= scheduled
            ? Error.Validation("Change.BeforeScheduled",
                $"{displayName} already has a change on {scheduled:d MMM yyyy}. A new change has to come after it.")
            : null;
    }

    private Task<WorkAssignment?> ActiveAssignmentAsync(Guid employeeId, DateTime at, CancellationToken cancellationToken)
        => dbContext.WorkAssignments.AsNoTracking().FirstOrDefaultAsync(
            item => item.EmployeeId == employeeId && item.IsPrimary
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo), cancellationToken);

    private Task<ManagerRelationship?> ActivePrimaryLineAsync(Guid employeeId, DateTime at, CancellationToken cancellationToken)
        => dbContext.ManagerRelationships.AsNoTracking().FirstOrDefaultAsync(
            item => item.SubjectEmployeeId == employeeId && item.Type == ReportingRelationshipType.PrimaryManager
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo), cancellationToken);

    private Task<List<ManagerRelationship>> ActiveReportLinesAsync(Guid managerId, DateTime at, CancellationToken cancellationToken)
        => dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.ManagerEmployeeId == managerId && item.Type == ReportingRelationshipType.PrimaryManager
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .ToListAsync(cancellationToken);

    private Task<ManagerRelationship?> OpenDottedLineAsync(Guid employeeId, Guid managerId, DateTime at, CancellationToken cancellationToken)
        => dbContext.ManagerRelationships.AsNoTracking().FirstOrDefaultAsync(
            item => item.SubjectEmployeeId == employeeId && item.ManagerEmployeeId == managerId
                && item.Type == ReportingRelationshipType.SecondaryManager
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo), cancellationToken);

    private async Task<IReadOnlyList<EndedDottedLine>> DottedLinesEndingAsync(
        Guid employeeId, DateTime lastAt, DateTime boundary, CancellationToken cancellationToken)
    {
        var lines = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.Type == ReportingRelationshipType.SecondaryManager
                && (item.SubjectEmployeeId == employeeId || item.ManagerEmployeeId == employeeId)
                && item.EffectiveFrom <= lastAt
                && (item.EffectiveTo == null || boundary < item.EffectiveTo))
            .ToListAsync(cancellationToken);
        var result = new List<EndedDottedLine>();
        foreach (var line in lines)
            result.Add(new EndedDottedLine(
                await PersonAsync(line.SubjectEmployeeId, cancellationToken),
                await PersonAsync(line.ManagerEmployeeId, cancellationToken)));
        return result;
    }

    private async Task<ChangePersonRef> PersonAsync(Guid employeeId, CancellationToken cancellationToken)
    {
        var employee = await dbContext.Employees.AsNoTracking().FirstAsync(item => item.Id == employeeId, cancellationToken);
        return Ref(employee);
    }

    internal static ChangePersonRef Ref(Employee employee)
        => new(employee.Id, employee.StableEmployeeKey, employee.DisplayName);

    private async Task<string?> UnitNameAsync(Guid unitId, DateOnly asOf, CancellationToken cancellationToken)
    {
        try
        {
            return (await organizations.GetUnitAsync(unitId, asOf, cancellationToken)).Name;
        }
        catch (EntityNotFoundException)
        {
            return null;
        }
    }

    internal static WorkforceChangeDetails ReadDetails(WorkforceChange change)
        => JsonSerializer.Deserialize<WorkforceChangeDetails>(change.PayloadJson, WorkforceChangeRecorder.Json) ?? new WorkforceChangeDetails();

    private static Result<T> Fail<T>(string code, string message) => Result.Failure<T>(Error.Validation(code, message));

    private static Result<T> Forbidden<T>()
        => Result.Failure<T>(new Error(ForbiddenCode, "You can change who people report to, not their job."));
}

/// <summary>Turns what a change staged on the tracker into its <see cref="WorkforceChange"/> record.</summary>
internal static class WorkforceChangeRecorder
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static WorkforceChange Record(
        CoreHRDbContext dbContext,
        Guid tenantId,
        Guid employeeId,
        WorkforceChangeKind kind,
        DateOnly effectiveDate,
        string? note,
        WorkforceChangeDetails details,
        string? actor)
    {
        dbContext.ChangeTracker.DetectChanges();
        var effects = new List<WorkforceChangeEffect>();
        foreach (var entry in dbContext.ChangeTracker.Entries())
        {
            var (type, id, subject) = entry.Entity switch
            {
                Employee item => (WorkforceChangeEffect.EmployeeEntity, item.Id, item.Id),
                Employment item => (WorkforceChangeEffect.EmploymentEntity, item.Id, item.EmployeeId),
                WorkAssignment item => (WorkforceChangeEffect.WorkAssignmentEntity, item.Id, item.EmployeeId),
                ManagerRelationship item => (WorkforceChangeEffect.ManagerRelationshipEntity, item.Id, item.SubjectEmployeeId),
                _ => (null, Guid.Empty, Guid.Empty),
            };
            if (type is null)
                continue;

            if (entry.State == EntityState.Added)
            {
                var appliedTo = type == WorkforceChangeEffect.EmployeeEntity ? null : (DateTime?)entry.Property("EffectiveTo").CurrentValue;
                effects.Add(WorkforceChangeEffect.Record(tenantId, subject, type, id, WorkforceChangeEffectAction.Created, null, appliedTo));
            }
            else if (entry.State == EntityState.Modified && type != WorkforceChangeEffect.EmployeeEntity)
            {
                var end = entry.Property("EffectiveTo");
                var previous = (DateTime?)end.OriginalValue;
                var applied = (DateTime?)end.CurrentValue;
                if (end.IsModified && previous != applied)
                    effects.Add(WorkforceChangeEffect.Record(tenantId, subject, type, id, WorkforceChangeEffectAction.Ended, previous, applied));
            }
        }

        var change = WorkforceChange.Create(
            tenantId, employeeId, kind, effectiveDate, note, JsonSerializer.Serialize(details, Json), actor, effects);
        dbContext.WorkforceChanges.Add(change);
        return change;
    }
}
