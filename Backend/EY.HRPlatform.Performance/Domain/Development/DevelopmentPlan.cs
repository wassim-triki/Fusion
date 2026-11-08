using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Development;

public enum DevelopmentGoalStatus { NotStarted = 0, InProgress = 1, Done = 2 }

/// <summary>What one goal says, as the employee or their reviewer entered it.</summary>
public sealed record DevelopmentGoalContent(
    string Title,
    Guid? CompetencyId,
    IReadOnlyList<string> Actions,
    DateOnly? TargetDate,
    DevelopmentGoalStatus Status);

/// <summary>
/// A participant's development plan for one Cycle (D-34, S-08): up to five development goals the employee and
/// their responsible reviewer keep together, with no submission or approval. It lives beside the objective
/// plan rather than inside it, so either person's edits never collide with the objective plan's lifecycle,
/// and it exists from the first goal even when no objective does. Open goals carry into a later Cycle; a
/// carried goal stays here as read-only history.
/// </summary>
public sealed class DevelopmentPlan : PerformanceAggregate
{
    public const int MaxGoals = 5;

    private readonly List<DevelopmentGoal> _goals = [];

    private DevelopmentPlan() { }

    public Guid CycleId { get; private set; }
    public Guid ParticipantId { get; private set; }
    public Guid EmployeeId { get; private set; }

    /// <summary>When the offer to carry over the previous Cycle's open goals was dismissed here.</summary>
    public DateTime? CarryOverDismissedAt { get; private set; }

    public IReadOnlyList<DevelopmentGoal> Goals => _goals;

    /// <summary>Goals still counting against the limit here — carried-away goals are history, not room.</summary>
    public int ActiveGoalCount => _goals.Count(goal => !goal.IsCarriedAway);
    public int Room => MaxGoals - ActiveGoalCount;

    public static DevelopmentPlan Create(Guid tenantId, Guid cycleId, Guid participantId, Guid employeeId)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("TenantId is required.", nameof(tenantId));
        if (cycleId == Guid.Empty) throw new ArgumentException("CycleId is required.", nameof(cycleId));
        if (participantId == Guid.Empty) throw new ArgumentException("A development plan belongs to a participant.", nameof(participantId));
        if (employeeId == Guid.Empty) throw new ArgumentException("A development plan belongs to an employee.", nameof(employeeId));
        return new DevelopmentPlan { TenantId = tenantId, CycleId = cycleId, ParticipantId = participantId, EmployeeId = employeeId };
    }

    public DevelopmentGoal AddGoal(DevelopmentGoalContent content, Guid actorEmployeeId)
    {
        if (Room <= 0) throw new ArgumentException($"A development plan holds up to {MaxGoals} goals.", nameof(content));
        var goal = DevelopmentGoal.Create(TenantId, content, actorEmployeeId);
        goal.AttachTo(Id);
        _goals.Add(goal);
        MarkUpdated();
        return goal;
    }

    public DevelopmentGoal UpdateGoal(Guid goalId, DevelopmentGoalContent content, Guid actorEmployeeId)
    {
        var goal = Find(goalId);
        goal.Update(content, actorEmployeeId);
        MarkUpdated();
        return goal;
    }

    public DevelopmentGoal RemoveGoal(Guid goalId)
    {
        var goal = Find(goalId);
        if (goal.IsCarriedAway) throw new InvalidOperationException("A goal carried into a later cycle is kept as history.");
        _goals.Remove(goal);
        MarkUpdated();
        return goal;
    }

    /// <summary>
    /// Copies the chosen open goals of an earlier plan into this one and marks the originals carried. A
    /// target date before this Cycle's start no longer means anything, so it is dropped.
    /// </summary>
    public IReadOnlyList<DevelopmentGoal> CarryOver(DevelopmentPlan from, IReadOnlyCollection<Guid> goalIds, DateOnly cycleStart, Guid actorEmployeeId)
    {
        ArgumentNullException.ThrowIfNull(from);
        if (from.EmployeeId != EmployeeId || from.CycleId == CycleId)
            throw new ArgumentException("Goals carry over from the same person's earlier cycle.", nameof(from));
        if (goalIds.Count == 0) throw new ArgumentException("Choose at least one goal to bring over.", nameof(goalIds));
        if (goalIds.Count > Room)
            throw new ArgumentException(Room == 1 ? "There is room for 1 more goal." : $"There is room for {Room} more goals.", nameof(goalIds));

        var carried = new List<DevelopmentGoal>();
        foreach (var goalId in goalIds.Distinct())
        {
            var source = from.Find(goalId);
            if (!source.IsOpenForCarryOver)
                throw new ArgumentException("Only open goals that haven't been brought over already can carry over.", nameof(goalIds));
            var target = source.TargetDate is { } date && date >= cycleStart ? date : (DateOnly?)null;
            var copy = DevelopmentGoal.Create(TenantId, source.Content with { TargetDate = target }, actorEmployeeId, source.Id);
            copy.AttachTo(Id);
            _goals.Add(copy);
            source.MarkCarriedTo(CycleId);
            carried.Add(copy);
        }
        from.MarkUpdated();
        MarkUpdated();
        return carried;
    }

    /// <summary>Stops offering carry-over in this Cycle. False when already dismissed.</summary>
    public bool DismissCarryOver(DateTime at)
    {
        if (CarryOverDismissedAt is not null) return false;
        CarryOverDismissedAt = at;
        MarkUpdated();
        return true;
    }

    private DevelopmentGoal Find(Guid goalId)
        => _goals.FirstOrDefault(goal => goal.Id == goalId) ?? throw new KeyNotFoundException("That goal is not part of this plan.");
}

/// <summary>One development goal: title, optional competency, actions, optional target date and status.</summary>
public sealed class DevelopmentGoal : PerformanceChildEntity
{
    public const int MaxTitleLength = 200;
    public const int MaxActions = 5;
    public const int MaxActionLength = 200;

    private DevelopmentGoal() { }

    public Guid DevelopmentPlanId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public Guid? CompetencyId { get; private set; }
    public string ActionsJson { get; private set; } = "[]";
    public DateOnly? TargetDate { get; private set; }
    public DevelopmentGoalStatus Status { get; private set; }
    public Guid CreatedByEmployeeId { get; private set; }
    public Guid UpdatedByEmployeeId { get; private set; }

    /// <summary>The earlier goal this one was carried from.</summary>
    public Guid? CarriedFromGoalId { get; private set; }

    /// <summary>Set once this goal has been carried into a later Cycle; it is read-only from then on.</summary>
    public Guid? CarriedToCycleId { get; private set; }
    public DateTime? CarriedAt { get; private set; }

    public bool IsCarriedAway => CarriedToCycleId is not null;
    public bool IsOpenForCarryOver => !IsCarriedAway && Status != DevelopmentGoalStatus.Done;

    public IReadOnlyList<string> Actions => JsonSerializer.Deserialize<List<string>>(ActionsJson) ?? [];

    public DevelopmentGoalContent Content => new(Title, CompetencyId, Actions, TargetDate, Status);

    internal static DevelopmentGoal Create(Guid tenantId, DevelopmentGoalContent content, Guid actorEmployeeId, Guid? carriedFrom = null)
    {
        var goal = new DevelopmentGoal
        {
            TenantId = tenantId,
            CreatedByEmployeeId = actorEmployeeId,
            CarriedFromGoalId = carriedFrom,
        };
        goal.Apply(content, actorEmployeeId);
        return goal;
    }

    internal void AttachTo(Guid planId) => DevelopmentPlanId = planId;

    internal void Update(DevelopmentGoalContent content, Guid actorEmployeeId)
    {
        if (IsCarriedAway) throw new InvalidOperationException("A goal carried into a later cycle is kept as history.");
        Apply(content, actorEmployeeId);
        MarkUpdated();
    }

    internal void MarkCarriedTo(Guid cycleId)
    {
        CarriedToCycleId = cycleId;
        CarriedAt = PerformanceClock.UtcNow;
        MarkUpdated();
    }

    private void Apply(DevelopmentGoalContent content, Guid actorEmployeeId)
    {
        ArgumentNullException.ThrowIfNull(content);
        var title = content.Title?.Trim() ?? string.Empty;
        if (title.Length == 0) throw new ArgumentException("Give the goal a title.", nameof(content));
        if (title.Length > MaxTitleLength) throw new ArgumentException($"Keep the title to {MaxTitleLength} characters.", nameof(content));
        var actions = (content.Actions ?? []).Select(action => action?.Trim() ?? string.Empty).Where(action => action.Length > 0).ToList();
        if (actions.Count > MaxActions) throw new ArgumentException($"A goal holds up to {MaxActions} actions.", nameof(content));
        if (actions.Any(action => action.Length > MaxActionLength))
            throw new ArgumentException($"Keep each action to {MaxActionLength} characters.", nameof(content));
        if (!Enum.IsDefined(content.Status)) throw new ArgumentException("Choose the goal's status.", nameof(content));
        if (content.CompetencyId == Guid.Empty) throw new ArgumentException("Choose a competency or none.", nameof(content));

        Title = title;
        CompetencyId = content.CompetencyId;
        ActionsJson = JsonSerializer.Serialize(actions);
        TargetDate = content.TargetDate;
        Status = content.Status;
        UpdatedByEmployeeId = actorEmployeeId;
    }
}
