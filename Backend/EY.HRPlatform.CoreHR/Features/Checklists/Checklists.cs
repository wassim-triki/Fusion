using System.Globalization;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Notifications;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Checklists;

public sealed record ChecklistTemplateTaskDto(Guid Id, string Title, string Owner, int OffsetDays);
public sealed record ChecklistTemplatesDto(IReadOnlyList<ChecklistTemplateTaskDto> Joining, IReadOnlyList<ChecklistTemplateTaskDto> Leaving);
public sealed record ChecklistTemplateTaskInput(string Title, string Owner, int OffsetDays);
public sealed record SaveChecklistTemplateRequest(IReadOnlyList<ChecklistTemplateTaskInput>? Tasks);

/// <summary><paramref name="DoneBy"/> and <paramref name="DoneAt"/> say who ticked it and when.</summary>
public sealed record ChecklistTaskDto(Guid Id, string Title, string Owner, DateOnly DueDate, DateTime? DoneAt, string? DoneBy, bool CanComplete);
public sealed record ChecklistDto(Guid Id, string Kind, DateOnly Day, IReadOnlyList<ChecklistTaskDto> Tasks);
public sealed record SetChecklistTaskRequest(bool Done);

/// <summary>Who is asking: their own record (null for someone without one) and whether they run people's records (HR).</summary>
public sealed record ChecklistViewer(Guid? EmployeeId, string Name, bool IsHr);

/// <summary>
/// Joining and leaving checklists (B-184, D-12, D-27). The company keeps one template per kind; a hire, rehire or end of
/// employment copies it onto the person, dated from their first or last day. HR sees and ticks every task; the manager
/// sees the manager's and the person's tasks and ticks the manager's; the person sees and ticks their own.
/// </summary>
public sealed class ChecklistService(CoreHRDbContext db, TenantContext tenant)
{
    public const string Module = "core";
    /// <summary>Needs you shows a checklist while the viewer has a task due within this many days (or overdue).</summary>
    public const int WorkHorizonDays = 14;
    public const int MaxTemplateTasks = 40;

    // --- Templates --------------------------------------------------------------------------------

    public async Task<ChecklistTemplatesDto> TemplatesAsync(CancellationToken cancellationToken)
    {
        var tasks = await db.ChecklistTemplateTasks.AsNoTracking().OrderBy(task => task.SortOrder).ToListAsync(cancellationToken);
        IReadOnlyList<ChecklistTemplateTaskDto> Of(ChecklistKind kind) => tasks.Where(task => task.Kind == kind)
            .Select(task => new ChecklistTemplateTaskDto(task.Id, task.Title, OwnerName(task.Owner), task.OffsetDays)).ToList();
        return new ChecklistTemplatesDto(Of(ChecklistKind.Joining), Of(ChecklistKind.Leaving));
    }

    /// <summary>Replaces one template. Checklists already made keep their tasks.</summary>
    public async Task<ChecklistTemplatesDto> SaveTemplateAsync(ChecklistKind kind, SaveChecklistTemplateRequest request, string actor,
        CancellationToken cancellationToken)
    {
        var inputs = request.Tasks ?? [];
        if (inputs.Count > MaxTemplateTasks) throw new ArgumentException($"A checklist holds at most {MaxTemplateTasks} tasks.");
        var tasks = inputs.Select((input, index) => ChecklistTemplateTask.Create(
            tenant.TenantId, kind, input.Title, ParseOwner(input.Owner), input.OffsetDays, index, actor)).ToList();
        db.ChecklistTemplateTasks.RemoveRange(await db.ChecklistTemplateTasks.Where(task => task.Kind == kind).ToListAsync(cancellationToken));
        db.ChecklistTemplateTasks.AddRange(tasks);
        await db.SaveChangesAsync(cancellationToken);
        return await TemplatesAsync(cancellationToken);
    }

    // --- Made by changes --------------------------------------------------------------------------

    /// <summary>
    /// Copies the template onto the person when a join (hire or rehire) or end of employment is recorded, inside the
    /// change's transaction. A company without that template gets no checklist.
    /// </summary>
    public static async Task StageAsync(CoreHRDbContext db, Guid tenantId, WorkforceChange change, WorkforceChangeDetails details,
        string? actor, CancellationToken cancellationToken)
    {
        ChecklistKind kind;
        DateOnly day;
        Guid? manager;
        switch (change.Kind)
        {
            case WorkforceChangeKind.Join:
                (kind, day, manager) = (ChecklistKind.Joining, change.EffectiveDate, details.ManagerTo?.EmployeeId);
                break;
            case WorkforceChangeKind.EndEmployment:
                (kind, day, manager) = (ChecklistKind.Leaving, details.LastDay ?? change.EffectiveDate.AddDays(-1), details.ManagerFrom?.EmployeeId);
                break;
            default:
                return;
        }
        var template = await db.ChecklistTemplateTasks.AsNoTracking().Where(task => task.Kind == kind).ToListAsync(cancellationToken);
        if (template.Count == 0) return;
        db.Checklists.Add(Checklist.Create(tenantId, change.EmployeeId, kind, day, manager, change.Id, template, actor));
    }

    /// <summary>A cancelled change takes its checklist with it.</summary>
    public static async Task RemoveForChangeAsync(CoreHRDbContext db, Guid changeId, CancellationToken cancellationToken)
    {
        var made = await db.Checklists.Include(checklist => checklist.Tasks)
            .Where(checklist => checklist.WorkforceChangeId == changeId).ToListAsync(cancellationToken);
        db.ChecklistTasks.RemoveRange(made.SelectMany(checklist => checklist.Tasks));
        db.Checklists.RemoveRange(made);
    }

    // --- Reading and ticking ----------------------------------------------------------------------

    /// <summary>The person's checklists as the viewer may see them, newest first; null when the person isn't here.</summary>
    public async Task<IReadOnlyList<ChecklistDto>?> ForPersonAsync(string employeeKey, ChecklistViewer viewer, CancellationToken cancellationToken)
    {
        var person = await db.Employees.AsNoTracking().FirstOrDefaultAsync(employee => employee.StableEmployeeKey == employeeKey, cancellationToken);
        if (person is null) return null;
        var checklists = await db.Checklists.AsNoTracking().Include(checklist => checklist.Tasks)
            .Where(checklist => checklist.EmployeeId == person.Id)
            .OrderByDescending(checklist => checklist.Day).ToListAsync(cancellationToken);
        return checklists.Select(checklist => new ChecklistDto(checklist.Id, checklist.Kind.ToString(), checklist.Day,
                checklist.Tasks.Where(task => Sees(checklist, task, viewer)).OrderBy(task => task.SortOrder)
                    .Select(task => Dto(task, CanComplete(checklist, task, viewer))).ToList()))
            .Where(checklist => checklist.Tasks.Count > 0)
            .ToList();
    }

    public enum TickOutcome { Done, NotFound, Forbidden }

    /// <summary>A task the viewer can't see reads as not found; one they can see but isn't theirs to do is refused.</summary>
    public async Task<(TickOutcome Outcome, ChecklistTaskDto? Task)> SetDoneAsync(Guid taskId, bool done, ChecklistViewer viewer,
        CancellationToken cancellationToken)
    {
        var task = await db.ChecklistTasks.FirstOrDefaultAsync(item => item.Id == taskId, cancellationToken);
        if (task is null) return (TickOutcome.NotFound, null);
        var checklist = await db.Checklists.AsNoTracking().FirstAsync(item => item.Id == task.ChecklistId, cancellationToken);
        if (!Sees(checklist, task, viewer)) return (TickOutcome.NotFound, null);
        if (!CanComplete(checklist, task, viewer)) return (TickOutcome.Forbidden, null);
        if (done) task.MarkDone(viewer.Name, viewer.EmployeeId, DateTime.UtcNow);
        else task.MarkUndone();
        await db.SaveChangesAsync(cancellationToken);
        return (TickOutcome.Done, Dto(task, true));
    }

    /// <summary>
    /// Needs you: one item per checklist where the viewer has a task of their own open and due within two weeks. HR's
    /// own are HR's tasks; a manager's, the manager's tasks; a joiner's, their own (their first week, D-27).
    /// </summary>
    public async Task<IReadOnlyList<FusionWorkItemDto>> WorkAsync(ChecklistViewer viewer, string language, CancellationToken cancellationToken)
    {
        var horizon = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(WorkHorizonDays);
        var me = viewer.EmployeeId;
        var candidateIds = await db.ChecklistTasks.AsNoTracking()
            .Where(task => task.DoneAt == null && task.DueDate <= horizon)
            .Join(db.Checklists.AsNoTracking(), task => task.ChecklistId, checklist => checklist.Id, (task, checklist) => new { task, checklist })
            .Where(row => (viewer.IsHr && row.task.Owner == ChecklistOwner.Hr)
                || (me != null && row.task.Owner == ChecklistOwner.Manager && row.checklist.ManagerEmployeeId == me)
                || (me != null && row.task.Owner == ChecklistOwner.Person && row.checklist.EmployeeId == me))
            .Select(row => row.checklist.Id).Distinct().Take(50).ToListAsync(cancellationToken);
        if (candidateIds.Count == 0) return [];
        var checklists = await db.Checklists.AsNoTracking().Include(checklist => checklist.Tasks)
            .Where(checklist => candidateIds.Contains(checklist.Id)).ToListAsync(cancellationToken);
        var peopleIds = checklists.Select(checklist => checklist.EmployeeId).Distinct().ToList();
        var people = await db.Employees.AsNoTracking().Where(employee => peopleIds.Contains(employee.Id))
            .ToDictionaryAsync(employee => employee.Id, cancellationToken);

        var items = new List<FusionWorkItemDto>();
        foreach (var checklist in checklists)
        {
            if (!people.TryGetValue(checklist.EmployeeId, out var person)) continue;
            var mine = checklist.Tasks.Where(task => Owns(checklist, task, viewer))
                .OrderBy(task => task.DueDate).ThenBy(task => task.SortOrder).ToList();
            var left = mine.Where(task => !task.IsDone).ToList();
            if (left.Count == 0) continue;
            var self = checklist.EmployeeId == me;
            var values = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["name"] = person.DisplayName,
                ["date"] = checklist.Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["count"] = left.Count.ToString(CultureInfo.InvariantCulture),
            };
            var key = $"Checklist.{checklist.Kind.ToString().ToLowerInvariant()}{(self ? ".you" : "")}";
            string Text(string entry) => CoreNotificationRenderer.Catalog.Text(language, entry, values) ?? entry;
            var current = left[0];
            items.Add(new FusionWorkItemDto(
                $"{Module}:checklist:{checklist.Id}", Module, "checklist",
                Text(key), Text($"{key}.context"), current.DueDate,
                self ? "/core/profile#checklist" : $"/core/people/{person.StableEmployeeKey}#checklist",
                Subject: self ? null : new FusionWorkSubjectDto(person.DisplayName),
                Section: self ? "/core/profile" : "/core/people",
                Steps: mine.Select(task => new FusionWorkStepDto(task.Title, null,
                    task.IsDone ? FusionWorkStepDto.Done : task.Id == current.Id ? FusionWorkStepDto.Current : FusionWorkStepDto.Upcoming)).ToList(),
                ActionLabel: Text("Checklist.action")));
        }
        return items.OrderBy(item => item.DueOn).ToList();
    }

    // --- Rules ------------------------------------------------------------------------------------

    private static bool IsManager(Checklist checklist, ChecklistViewer viewer)
        => viewer.EmployeeId is { } me && checklist.ManagerEmployeeId == me;

    private static bool IsPerson(Checklist checklist, ChecklistViewer viewer)
        => viewer.EmployeeId is { } me && checklist.EmployeeId == me;

    public static bool Sees(Checklist checklist, ChecklistTask task, ChecklistViewer viewer)
        => viewer.IsHr
            || (IsManager(checklist, viewer) && task.Owner is ChecklistOwner.Manager or ChecklistOwner.Person)
            || (IsPerson(checklist, viewer) && task.Owner == ChecklistOwner.Person);

    /// <summary>HR may tick any task; the manager and the person only their own.</summary>
    public static bool CanComplete(Checklist checklist, ChecklistTask task, ChecklistViewer viewer)
        => viewer.IsHr || Owns(checklist, task, viewer);

    private static bool Owns(Checklist checklist, ChecklistTask task, ChecklistViewer viewer) => task.Owner switch
    {
        ChecklistOwner.Hr => viewer.IsHr,
        ChecklistOwner.Manager => IsManager(checklist, viewer),
        _ => IsPerson(checklist, viewer),
    };

    private static ChecklistTaskDto Dto(ChecklistTask task, bool canComplete)
        => new(task.Id, task.Title, OwnerName(task.Owner), task.DueDate, task.DoneAt, task.DoneByName, canComplete);

    public static string OwnerName(ChecklistOwner owner) => owner switch
    {
        ChecklistOwner.Hr => "hr",
        ChecklistOwner.Manager => "manager",
        _ => "person",
    };

    public static ChecklistOwner ParseOwner(string? owner) => owner?.Trim().ToLowerInvariant() switch
    {
        "hr" => ChecklistOwner.Hr,
        "manager" => ChecklistOwner.Manager,
        "person" => ChecklistOwner.Person,
        _ => throw new ArgumentException("Choose who does the task: HR, the manager or the person."),
    };

    public static ChecklistKind? ParseKind(string? kind) => kind?.Trim().ToLowerInvariant() switch
    {
        "joining" => ChecklistKind.Joining,
        "leaving" => ChecklistKind.Leaving,
        _ => null,
    };
}
