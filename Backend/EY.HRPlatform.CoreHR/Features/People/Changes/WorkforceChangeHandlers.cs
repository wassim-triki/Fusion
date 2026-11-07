using System.Data;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.CoreHR.Features.People.Changes;

// --- Commands and queries -------------------------------------------------------------------------

public sealed record JobChangeCommand(string EmployeeKey, JobChangeRequest Request, string Actor, bool CanManageEmployees)
    : ICommand<Result<WorkforceChangeDto>>;

public sealed record EndEmploymentChangeCommand(string EmployeeKey, EndEmploymentChangeRequest Request, string Actor)
    : ICommand<Result<WorkforceChangeDto>>;

public sealed record JoinChangeCommand(string EmployeeKey, JoinChangeRequest Request, string Actor)
    : ICommand<Result<WorkforceChangeDto>>;

public sealed record CancelWorkforceChangeCommand(Guid ChangeId, string Actor, bool CanManageEmployees)
    : ICommand<Result<bool>>;

public sealed record EditWorkforceChangeCommand(Guid ChangeId, EditChangeRequest Request, string Actor, bool CanManageEmployees)
    : ICommand<Result<WorkforceChangeDto>>;

public sealed record EndEmploymentChangePreviewQuery(string EmployeeKey, DateOnly LastDay)
    : IQuery<Result<EndEmploymentChangePreviewDto>>;

/// <param name="BranchOfEmployeeId">Null for the whole tenant; otherwise only changes in that manager's branch.</param>
public sealed record UpcomingWorkforceChangesQuery(Guid? BranchOfEmployeeId)
    : IQuery<Result<IReadOnlyList<WorkforceChangeDto>>>;

// --- Handlers -------------------------------------------------------------------------------------

public sealed class JobChangeCommandHandler(CoreHRDbContext dbContext, WorkforceChangeService changes, WorkforceChangeReader reader)
    : ICommandHandler<JobChangeCommand, Result<WorkforceChangeDto>>
{
    public async Task<Result<WorkforceChangeDto>> Handle(JobChangeCommand command, CancellationToken cancellationToken)
    {
        var subject = await ChangeSupport.FindEmployeeAsync(dbContext, command.EmployeeKey, cancellationToken);
        if (subject is null)
            return ChangeSupport.NotFound<WorkforceChangeDto>();
        var result = await ChangeSupport.RunAsync(dbContext, [() => changes.StageJobChangeAsync(
            subject, command.Request, command.Actor, command.CanManageEmployees, cancellationToken)], cancellationToken);
        return result.IsFailure ? Result.Failure<WorkforceChangeDto>(result.Error) : Result.Success(await reader.ProjectAsync(result.Value, cancellationToken));
    }
}

public sealed class EndEmploymentChangeCommandHandler(CoreHRDbContext dbContext, WorkforceChangeService changes, WorkforceChangeReader reader)
    : ICommandHandler<EndEmploymentChangeCommand, Result<WorkforceChangeDto>>
{
    public async Task<Result<WorkforceChangeDto>> Handle(EndEmploymentChangeCommand command, CancellationToken cancellationToken)
    {
        var subject = await ChangeSupport.FindEmployeeAsync(dbContext, command.EmployeeKey, cancellationToken);
        if (subject is null)
            return ChangeSupport.NotFound<WorkforceChangeDto>();
        var result = await ChangeSupport.RunAsync(dbContext, [() => changes.StageEndEmploymentAsync(
            subject, command.Request, command.Actor, cancellationToken)], cancellationToken);
        return result.IsFailure ? Result.Failure<WorkforceChangeDto>(result.Error) : Result.Success(await reader.ProjectAsync(result.Value, cancellationToken));
    }
}

public sealed class JoinChangeCommandHandler(CoreHRDbContext dbContext, WorkforceChangeService changes, WorkforceChangeReader reader)
    : ICommandHandler<JoinChangeCommand, Result<WorkforceChangeDto>>
{
    public async Task<Result<WorkforceChangeDto>> Handle(JoinChangeCommand command, CancellationToken cancellationToken)
    {
        var subject = await ChangeSupport.FindEmployeeAsync(dbContext, command.EmployeeKey, cancellationToken);
        if (subject is null)
            return ChangeSupport.NotFound<WorkforceChangeDto>();
        var result = await ChangeSupport.RunAsync(dbContext, [() => changes.StageJoinAsync(
            subject, command.Request, command.Actor, cancellationToken)], cancellationToken);
        return result.IsFailure ? Result.Failure<WorkforceChangeDto>(result.Error) : Result.Success(await reader.ProjectAsync(result.Value, cancellationToken));
    }
}

public sealed class CancelWorkforceChangeCommandHandler(
    CoreHRDbContext dbContext, WorkforceChangeService changes, IWorkforceAccountStatusReader accounts)
    : ICommandHandler<CancelWorkforceChangeCommand, Result<bool>>
{
    /// <summary>Identity states that leave nothing behind for a person who is deleted.</summary>
    private static readonly HashSet<string> NoAccess = ["Unprovisioned", "InviteRevoked"];

    public async Task<Result<bool>> Handle(CancelWorkforceChangeCommand command, CancellationToken cancellationToken)
    {
        var change = await dbContext.WorkforceChanges.Include(item => item.Effects)
            .FirstOrDefaultAsync(item => item.Id == command.ChangeId, cancellationToken);
        if (change is null)
            return ChangeSupport.NotFound<bool>();

        // Cancelling a scheduled hire deletes the person, so it must not strand a Fusion account or a live
        // invitation in Identity. Without a work email no access can be linked; if Identity can't say, refuse.
        if (!change.IsCancelled && WorkforceChangeService.ReadDetails(change).IsHire)
        {
            var person = await dbContext.Employees.AsNoTracking().FirstAsync(item => item.Id == change.EmployeeId, cancellationToken);
            if (!string.IsNullOrWhiteSpace(person.Email))
            {
                IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> statuses;
                try
                {
                    statuses = await accounts.GetStatusesAsync(
                        [new WorkforceAccountSubjectDto(person.Id, person.Email, person.FirstName, person.LastName)], cancellationToken);
                }
                catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or TaskCanceledException)
                {
                    return Result.Failure<bool>(Error.Validation("Change.AccessUnknown",
                        "Fusion access couldn't be checked, so the hire wasn't cancelled. Try again."));
                }
                if (statuses.GetValueOrDefault(person.Id) is { } status && !NoAccess.Contains(status.ProvisioningState))
                    return Result.Failure<bool>(Error.Validation("Change.HireAccessConflict",
                        $"{person.DisplayName} already has Fusion access or an invitation. Revoke it in Workforce access, then cancel the hire."));
            }
        }
        var result = await ChangeSupport.RunAsync(dbContext, [() => changes.StageCancelAsync(
            change, command.Actor, command.CanManageEmployees, cancellationToken)], cancellationToken);
        return result.IsFailure ? Result.Failure<bool>(result.Error) : Result.Success(true);
    }
}

/// <summary>Edit replaces a scheduled change in one step: the old one is cancelled and the new one made, or neither.</summary>
public sealed class EditWorkforceChangeCommandHandler(CoreHRDbContext dbContext, WorkforceChangeService changes, WorkforceChangeReader reader)
    : ICommandHandler<EditWorkforceChangeCommand, Result<WorkforceChangeDto>>
{
    public async Task<Result<WorkforceChangeDto>> Handle(EditWorkforceChangeCommand command, CancellationToken cancellationToken)
    {
        var change = await dbContext.WorkforceChanges.Include(item => item.Effects)
            .FirstOrDefaultAsync(item => item.Id == command.ChangeId, cancellationToken);
        if (change is null)
            return ChangeSupport.NotFound<WorkforceChangeDto>();
        if (WorkforceChangeService.ReadDetails(change).IsHire)
            return Result.Failure<WorkforceChangeDto>(Error.Validation("Change.HireNotEditable", "A hire can be cancelled, not edited."));

        var request = command.Request;
        var matches = change.Kind switch
        {
            WorkforceChangeKind.JobChange => request.Job is not null,
            WorkforceChangeKind.EndEmployment => request.End is not null,
            WorkforceChangeKind.Leave => request.Leave is not null,
            _ => request.Join is not null,
        };
        if (!matches)
            return Result.Failure<WorkforceChangeDto>(Error.Validation("Change.KindMismatch", "An edit keeps the kind of change."));

        if (change.Kind == WorkforceChangeKind.Leave)
        {
            var revised = await ChangeSupport.RunAsync(dbContext, [() => changes.StageLeaveRevisionAsync(
                change, request.Leave!, command.Actor, command.CanManageEmployees, cancellationToken)], cancellationToken);
            return revised.IsFailure ? Result.Failure<WorkforceChangeDto>(revised.Error) : Result.Success(await reader.ProjectAsync(revised.Value, cancellationToken));
        }

        var subject = await dbContext.Employees.FirstAsync(item => item.Id == change.EmployeeId, cancellationToken);
        var result = await ChangeSupport.RunAsync(dbContext,
        [
            () => changes.StageCancelAsync(change, command.Actor, command.CanManageEmployees, cancellationToken),
            () => change.Kind switch
            {
                WorkforceChangeKind.JobChange => changes.StageJobChangeAsync(subject, request.Job!, command.Actor, command.CanManageEmployees, cancellationToken),
                WorkforceChangeKind.EndEmployment => changes.StageEndEmploymentAsync(subject, request.End!, command.Actor, cancellationToken),
                _ => changes.StageJoinAsync(subject, request.Join!, command.Actor, cancellationToken),
            },
        ], cancellationToken);
        return result.IsFailure ? Result.Failure<WorkforceChangeDto>(result.Error) : Result.Success(await reader.ProjectAsync(result.Value, cancellationToken));
    }
}

public sealed class EndEmploymentChangePreviewQueryHandler(CoreHRDbContext dbContext, WorkforceChangeService changes)
    : IQueryHandler<EndEmploymentChangePreviewQuery, Result<EndEmploymentChangePreviewDto>>
{
    public async Task<Result<EndEmploymentChangePreviewDto>> Handle(EndEmploymentChangePreviewQuery request, CancellationToken cancellationToken)
    {
        var subject = await ChangeSupport.FindEmployeeAsync(dbContext, request.EmployeeKey, cancellationToken);
        if (subject is null)
            return ChangeSupport.NotFound<EndEmploymentChangePreviewDto>();
        return await changes.PreviewEndEmploymentAsync(subject, request.LastDay, cancellationToken);
    }
}

public sealed class UpcomingWorkforceChangesQueryHandler(CoreHRDbContext dbContext, WorkforceChangeReader reader)
    : IQueryHandler<UpcomingWorkforceChangesQuery, Result<IReadOnlyList<WorkforceChangeDto>>>
{
    public async Task<Result<IReadOnlyList<WorkforceChangeDto>>> Handle(UpcomingWorkforceChangesQuery request, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var upcoming = await dbContext.WorkforceChanges.AsNoTracking()
            .Where(item => !item.IsCancelled && (item.EffectiveDate >= today
                || item.Kind == WorkforceChangeKind.Leave && (item.LastDay == null || item.LastDay >= today)))
            .OrderBy(item => item.EffectiveDate).ThenBy(item => item.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);
        var projected = await reader.ProjectAsync(upcoming, cancellationToken);
        if (request.BranchOfEmployeeId is not { } managerId)
            return Result.Success(projected);

        // A manager sees what is coming in their branch: people in it, and people joining it.
        var branch = await ChangeSupport.BranchAsync(dbContext, managerId, cancellationToken);
        branch.Add(managerId);
        IReadOnlyList<WorkforceChangeDto> scoped = projected
            .Where(item => item.Person.EmployeeId != managerId
                && (branch.Contains(item.Person.EmployeeId)
                    || item.Details.ManagerTo is { } to && branch.Contains(to.EmployeeId)
                    || item.Details.TeamManager is { } team && branch.Contains(team.EmployeeId)))
            .ToList();
        return Result.Success(scoped);
    }
}

/// <summary>Projects change records for the API: who, what, and whether Cancel and Edit apply now.</summary>
public sealed class WorkforceChangeReader(CoreHRDbContext dbContext)
{
    public async Task<WorkforceChangeDto> ProjectAsync(WorkforceChange change, CancellationToken cancellationToken)
        => (await ProjectAsync([change], cancellationToken))[0];

    public async Task<IReadOnlyList<WorkforceChangeDto>> ProjectAsync(IReadOnlyList<WorkforceChange> changes, CancellationToken cancellationToken)
    {
        if (changes.Count == 0)
            return [];
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var people = changes.Select(item => item.EmployeeId).Distinct().ToList();
        var employees = await dbContext.Employees.AsNoTracking()
            .Where(item => people.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var open = await dbContext.WorkforceChanges.AsNoTracking()
            .Where(item => people.Contains(item.EmployeeId) && !item.IsCancelled && item.EffectiveDate >= today
                && item.Kind != WorkforceChangeKind.Leave)
            .Select(item => new { item.Id, item.EmployeeId, item.EffectiveDate, item.CreatedAt })
            .ToListAsync(cancellationToken);
        var latest = open.GroupBy(item => item.EmployeeId)
            .Select(group => group.OrderByDescending(item => item.EffectiveDate).ThenByDescending(item => item.CreatedAt).First().Id)
            .ToHashSet();
        var week = changes.Any(item => item.Kind == WorkforceChangeKind.Leave) ? await LeaveReader.WorkWeekAsync(dbContext, cancellationToken) : [];

        return changes.Select(change =>
        {
            var details = WorkforceChangeService.ReadDetails(change);
            var status = change.StatusOn(today);
            var person = employees.TryGetValue(change.EmployeeId, out var employee)
                ? WorkforceChangeService.Ref(employee)
                : new ChangePersonRef(change.EmployeeId, "", "");
            if (change.Kind == WorkforceChangeKind.Leave)
            {
                // Leave stands alone: cancelled until it starts, changed (or ended early) until it is over.
                var standing = !change.IsCancelled && (change.LastDay is null || change.LastDay >= today);
                return new WorkforceChangeDto(
                    change.Id, change.Kind, change.EffectiveDate, status, standing && change.EffectiveDate >= today, standing,
                    person, ChangeSupport.ActorName(change.CreatedBy), change.CreatedAt, change.Note, details,
                    change.LastDay, LeaveReader.Back(change.LastDay, week));
            }
            var lastDayInEffect = change.Kind == WorkforceChangeKind.EndEmployment ? change.EffectiveDate.AddDays(-1) : change.EffectiveDate;
            var canCancel = !change.IsCancelled && lastDayInEffect >= today && latest.Contains(change.Id);
            return new WorkforceChangeDto(
                change.Id, change.Kind, change.EffectiveDate, status, canCancel, canCancel && !details.IsHire,
                person, ChangeSupport.ActorName(change.CreatedBy), change.CreatedAt, change.Note, details);
        }).ToList();
    }

    public async Task<IReadOnlyList<WorkforceChangeDto>> ComingUpAsync(Guid employeeId, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var changes = await dbContext.WorkforceChanges.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && !item.IsCancelled && (item.EffectiveDate >= today
                || item.Kind == WorkforceChangeKind.Leave && (item.LastDay == null || item.LastDay >= today)))
            .OrderBy(item => item.EffectiveDate).ThenBy(item => item.CreatedAt)
            .ToListAsync(cancellationToken);
        return await ProjectAsync(changes, cancellationToken);
    }
}

internal static class ChangeSupport
{
    public static Task<Employee?> FindEmployeeAsync(CoreHRDbContext dbContext, string employeeKey, CancellationToken cancellationToken)
    {
        var key = employeeKey.Trim().ToUpperInvariant();
        return dbContext.Employees.FirstOrDefaultAsync(item => item.StableEmployeeKey == key, cancellationToken);
    }

    public static Result<T> NotFound<T>() => Result.Failure<T>(new Error("Change.NotFound", "Not found."));

    /// <summary>"id|Name" audit actors show as the name.</summary>
    public static string? ActorName(string? actor)
        => actor is null ? null : actor.Contains('|') ? actor[(actor.IndexOf('|') + 1)..] : actor;

    /// <summary>Everyone below the manager today, through primary lines.</summary>
    public static async Task<HashSet<Guid>> BranchAsync(CoreHRDbContext dbContext, Guid managerId, CancellationToken cancellationToken)
    {
        var at = DateTime.SpecifyKind(DateTime.UtcNow.Date, DateTimeKind.Utc);
        var lines = await dbContext.ManagerRelationships.AsNoTracking()
            .Where(item => item.Type == ReportingRelationshipType.PrimaryManager
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => new { item.SubjectEmployeeId, item.ManagerEmployeeId })
            .ToListAsync(cancellationToken);
        var byManager = lines.ToLookup(item => item.ManagerEmployeeId, item => item.SubjectEmployeeId);
        var branch = new HashSet<Guid>();
        var queue = new Queue<Guid>([managerId]);
        while (queue.Count > 0)
            foreach (var report in byManager[queue.Dequeue()])
                if (branch.Add(report))
                    queue.Enqueue(report);
        return branch;
    }

    /// <summary>
    /// Runs the staged steps in one read-committed transaction, saving after each so a later step reads what an
    /// earlier one wrote (an edit's cancel, then its new change). Any failure rolls everything back.
    /// </summary>
    public static async Task<Result<WorkforceChange>> RunAsync(
        CoreHRDbContext dbContext,
        IReadOnlyList<Func<Task<Result<WorkforceChange>>>> steps,
        CancellationToken cancellationToken)
    {
        var useTransaction = dbContext.Database.IsRelational();
        await using IDbContextTransaction? transaction = useTransaction
            ? await dbContext.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        try
        {
            Result<WorkforceChange>? last = null;
            foreach (var step in steps)
            {
                last = await step();
                if (last.IsFailure)
                {
                    if (transaction is not null)
                        await transaction.RollbackAsync(cancellationToken);
                    dbContext.ChangeTracker.Clear();
                    return last;
                }
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            if (transaction is not null)
                await transaction.CommitAsync(cancellationToken);
            return last!;
        }
        catch
        {
            if (transaction is not null)
                await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            throw;
        }
    }
}
