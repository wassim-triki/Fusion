using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Domain.Entities;

public enum ChecklistKind
{
    Joining = 1,
    Leaving = 2,
}

/// <summary>Who does a task: HR, the person's manager, or the person themselves.</summary>
public enum ChecklistOwner
{
    Hr = 1,
    Manager = 2,
    Person = 3,
}

/// <summary>
/// One task of the company's joining or leaving checklist, due a number of days from the person's first day
/// (joining) or last day (leaving). Negative is before that day.
/// </summary>
public sealed class ChecklistTemplateTask : BaseEntity, ITenantEntity
{
    public const int MaxTitleLength = 200;
    public const int MaxOffsetDays = 90;

    private ChecklistTemplateTask() { }

    public Guid TenantId { get; private set; }
    public ChecklistKind Kind { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public ChecklistOwner Owner { get; private set; }
    public int OffsetDays { get; private set; }
    public int SortOrder { get; private set; }

    public static ChecklistTemplateTask Create(Guid tenantId, ChecklistKind kind, string title, ChecklistOwner owner, int offsetDays,
        int sortOrder, string? actor)
    {
        var text = title?.Trim() ?? "";
        if (text.Length == 0) throw new ArgumentException("A task needs a name.");
        if (text.Length > MaxTitleLength) throw new ArgumentException($"A task's name is at most {MaxTitleLength} characters.");
        if (Math.Abs(offsetDays) > MaxOffsetDays) throw new ArgumentException($"A task is due at most {MaxOffsetDays} days from the day.");
        if (!Enum.IsDefined(owner)) throw new ArgumentException("Choose who does the task.");
        return new ChecklistTemplateTask
        {
            TenantId = tenantId, Kind = kind, Title = text, Owner = owner, OffsetDays = offsetDays, SortOrder = sortOrder, CreatedBy = actor,
        };
    }
}

/// <summary>
/// A person's joining or leaving checklist, made from the company's template when the hire, rehire or end of
/// employment is recorded, and removed when that change is cancelled. <see cref="ManagerEmployeeId"/> is the manager
/// at the time: the one who joins them or sees them leave.
/// </summary>
public sealed class Checklist : BaseEntity, ITenantEntity
{
    private Checklist() { }

    public Guid TenantId { get; private set; }
    public Guid EmployeeId { get; private set; }
    public ChecklistKind Kind { get; private set; }

    /// <summary>The first day (joining) or the last day (leaving).</summary>
    public DateOnly Day { get; private set; }

    public Guid? ManagerEmployeeId { get; private set; }
    public Guid WorkforceChangeId { get; private set; }
    public List<ChecklistTask> Tasks { get; private set; } = [];

    public static Checklist Create(Guid tenantId, Guid employeeId, ChecklistKind kind, DateOnly day, Guid? managerEmployeeId,
        Guid workforceChangeId, IEnumerable<ChecklistTemplateTask> template, string? actor)
    {
        var checklist = new Checklist
        {
            TenantId = tenantId, EmployeeId = employeeId, Kind = kind, Day = day, ManagerEmployeeId = managerEmployeeId,
            WorkforceChangeId = workforceChangeId, CreatedBy = actor,
        };
        checklist.Tasks = template.OrderBy(task => task.SortOrder)
            .Select((task, index) => ChecklistTask.Create(tenantId, checklist.Id, task.Title, task.Owner, day.AddDays(task.OffsetDays), index))
            .ToList();
        return checklist;
    }
}

public sealed class ChecklistTask : BaseEntity, ITenantEntity
{
    private ChecklistTask() { }

    public Guid TenantId { get; private set; }
    public Guid ChecklistId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public ChecklistOwner Owner { get; private set; }
    public DateOnly DueDate { get; private set; }
    public int SortOrder { get; private set; }
    public DateTime? DoneAt { get; private set; }
    public string? DoneByName { get; private set; }
    public Guid? DoneByEmployeeId { get; private set; }

    public bool IsDone => DoneAt is not null;

    internal static ChecklistTask Create(Guid tenantId, Guid checklistId, string title, ChecklistOwner owner, DateOnly due, int sortOrder)
        => new() { TenantId = tenantId, ChecklistId = checklistId, Title = title, Owner = owner, DueDate = due, SortOrder = sortOrder };

    public void MarkDone(string byName, Guid? byEmployeeId, DateTime at)
    {
        if (IsDone) return;
        DoneAt = at;
        DoneByName = byName;
        DoneByEmployeeId = byEmployeeId;
        UpdatedAt = at;
    }

    public void MarkUndone()
    {
        if (!IsDone) return;
        DoneAt = null;
        DoneByName = null;
        DoneByEmployeeId = null;
        UpdatedAt = DateTime.UtcNow;
    }
}
