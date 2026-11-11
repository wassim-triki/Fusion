using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Settings;

namespace EY.HRPlatform.Performance.Domain.Reviews;

/// <summary>A review task with a due date: what HR moves and what reminders are about.</summary>
public enum ReviewStage { SelfAssessment, PeerInput, ManagerAssessment }

/// <summary>What a round asks for. Competencies are "a non-empty competency set", not a flag.</summary>
public sealed record ReviewRoundComponents(bool SelfAssessment, bool PeerInput, bool ObjectiveRatings, bool Questions,
    bool Potential, bool Calibration);

/// <summary>Due dates HR set on a Draft round; a null date follows the round's day offsets.</summary>
public sealed record ReviewRoundDueDates(DateOnly? SelfAssessment, DateOnly? PeerInput, DateOnly? ManagerAssessment);

/// <summary>The dates a round's tasks are due on.</summary>
public sealed record ReviewRoundSchedule(DateOnly SelfAssessment, DateOnly PeerInput, DateOnly ManagerAssessment);

/// <summary>A configured review episode within one Cycle; launch freezes its effective configuration.</summary>
public sealed class ReviewRound : PerformanceAggregate
{
    public const int MaxQuestionsPerAudience = 5;

    private ReviewRound() { }
    private readonly List<ReviewRoundQuestion> _questions = [];

    public Guid CycleId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public DateOnly PeriodStart { get; private set; }
    public DateOnly PeriodEnd { get; private set; }
    public bool SelfAssessmentEnabled { get; private set; }
    public bool PeerInputEnabled { get; private set; }
    public bool ObjectiveRatingsEnabled { get; private set; }
    public bool QuestionsEnabled { get; private set; }
    public bool PotentialEnabled { get; private set; }
    public bool CalibrationEnabled { get; private set; }

    /// <summary>While Draft, a set date overrides its offset; launch fixes every date.</summary>
    public DateOnly? SelfAssessmentDueDate { get; private set; }
    public DateOnly? PeerInputDueDate { get; private set; }
    public DateOnly? ManagerAssessmentDueDate { get; private set; }

    /// <summary>Offsets copied from Settings when the round was created (D-02).</summary>
    public int SelfAssessmentDueDays { get; private set; } = 14;
    public int PeerInputDueDays { get; private set; } = 14;
    public int ManagerAssessmentDueDays { get; private set; } = 7;
    public int AcknowledgementReminderDays { get; private set; } = 7;

    public string CompetencyIdsJson { get; private set; } = "[]";
    public string? ConfigSnapshotJson { get; private set; }
    public Guid? RatingScaleVersionId { get; private set; }
    public DateTime? LaunchedAt { get; private set; }
    /// <summary>The day a Draft opens by itself (D-74); "Open it today" launches it sooner. Null waits for HR.</summary>
    public DateOnly? OpensOn { get; private set; }
    public ReviewRoundState State { get; private set; }

    /// <summary>Questions picked while Draft; launch freezes their text into <see cref="ReviewQuestionSnapshot"/> rows.</summary>
    public IReadOnlyList<ReviewRoundQuestion> Questions => _questions;

    /// <summary>Non-null only while Active; a filtered unique index enforces one Active round per Cycle.</summary>
    public Guid? ActiveCycleSlot { get; private set; }

    public static ReviewRound CreateDraft(Guid tenantId, PerformanceCycle cycle, string name,
        DateOnly periodStart, DateOnly periodEnd, bool selfAssessmentEnabled,
        bool objectiveRatingsEnabled, bool calibrationEnabled)
    {
        ArgumentNullException.ThrowIfNull(cycle);
        if (cycle.State != CycleLifecycleState.Active)
            throw new InvalidOperationException("Review rounds can only be created in an Active Cycle.");
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("A round requires a name.", nameof(name));
        ValidatePeriod(cycle, periodStart, periodEnd);
        return new ReviewRound
        {
            TenantId = tenantId,
            CycleId = cycle.Id,
            Name = name.Trim(),
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            SelfAssessmentEnabled = selfAssessmentEnabled,
            ObjectiveRatingsEnabled = objectiveRatingsEnabled,
            CalibrationEnabled = calibrationEnabled,
            State = ReviewRoundState.Draft,
        };
    }

    /// <summary>A new Draft with the tenant's component and due-date defaults copied in.</summary>
    public static ReviewRound CreateDraft(Guid tenantId, PerformanceCycle cycle, string name,
        DateOnly periodStart, DateOnly periodEnd, CycleSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var round = CreateDraft(tenantId, cycle, name, periodStart, periodEnd, settings.DefaultSelfAssessmentEnabled,
            settings.DefaultObjectiveRatingsEnabled, settings.DefaultCalibrationEnabled);
        round.SelfAssessmentDueDays = settings.SelfAssessmentDueDays;
        round.PeerInputDueDays = settings.PeerInputDueDays;
        round.ManagerAssessmentDueDays = settings.ManagerAssessmentDueDays;
        round.AcknowledgementReminderDays = settings.AcknowledgementReminderDays;
        return round;
    }

    /// <summary>The configuration editor before peer input, questions and potential existed; those keep their values.</summary>
    public void UpdateDraft(PerformanceCycle cycle, string name, DateOnly periodStart, DateOnly periodEnd,
        bool selfAssessmentEnabled, bool objectiveRatingsEnabled, bool calibrationEnabled,
        DateOnly? selfAssessmentDueDate, DateOnly? managerAssessmentDueDate, string competencyIdsJson)
        => UpdateDraft(cycle, name, periodStart, periodEnd,
            new ReviewRoundComponents(selfAssessmentEnabled, PeerInputEnabled && selfAssessmentEnabled, objectiveRatingsEnabled,
                QuestionsEnabled, PotentialEnabled, calibrationEnabled),
            new ReviewRoundDueDates(selfAssessmentDueDate, PeerInputDueDate, managerAssessmentDueDate), competencyIdsJson,
            PerformanceClock.Today);

    public void UpdateDraft(PerformanceCycle cycle, string name, DateOnly periodStart, DateOnly periodEnd,
        ReviewRoundComponents components, ReviewRoundDueDates dueDates, string competencyIdsJson, DateOnly plannedLaunch)
    {
        RequireDraft();
        ArgumentNullException.ThrowIfNull(components);
        ArgumentNullException.ThrowIfNull(dueDates);
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("A round requires a name.", nameof(name));
        ValidatePeriod(cycle, periodStart, periodEnd);
        if (components.PeerInput && !components.SelfAssessment)
            throw new ArgumentException("Peer input needs the self-assessment: peers are nominated while the person self-assesses.", nameof(components));
        foreach (var date in new[] { dueDates.SelfAssessment, dueDates.PeerInput, dueDates.ManagerAssessment })
            if (date is DateOnly value && value > cycle.EndDate)
                throw new ArgumentException("Due dates must be on or before the cycle ends.", nameof(dueDates));
        var schedule = Schedule(dueDates, plannedLaunch);
        if (components.SelfAssessment && schedule.ManagerAssessment < schedule.SelfAssessment)
            throw new ArgumentException("The manager assessment is due on or after the self-assessment.", nameof(dueDates));

        Name = name.Trim();
        PeriodStart = periodStart;
        PeriodEnd = periodEnd;
        SelfAssessmentEnabled = components.SelfAssessment;
        PeerInputEnabled = components.PeerInput;
        ObjectiveRatingsEnabled = components.ObjectiveRatings;
        QuestionsEnabled = components.Questions;
        PotentialEnabled = components.Potential;
        CalibrationEnabled = components.Calibration;
        SelfAssessmentDueDate = dueDates.SelfAssessment;
        PeerInputDueDate = dueDates.PeerInput;
        ManagerAssessmentDueDate = dueDates.ManagerAssessment;
        CompetencyIdsJson = competencyIdsJson;
        MarkUpdated();
    }

    /// <summary>The day the Draft opens by itself, within the year. Returns false when unchanged.</summary>
    public bool SetOpensOn(PerformanceCycle cycle, DateOnly on)
    {
        RequireDraft();
        if (cycle.Id != CycleId) throw new ArgumentException("The cycle does not own this round.", nameof(cycle));
        if (on < cycle.StartDate || on > cycle.EndDate) throw new ArgumentException("The round opens within its year.", nameof(on));
        if (OpensOn == on) return false;
        OpensOn = on;
        MarkUpdated();
        return true;
    }

    /// <summary>
    /// Replaces the picked questions: active library questions, at most five per audience, in the given order
    /// within each audience. Returns false when nothing changed.
    /// </summary>
    public bool SetQuestions(IReadOnlyList<ReviewQuestion> questions)
    {
        RequireDraft();
        ArgumentNullException.ThrowIfNull(questions);
        if (questions.Select(item => item.Id).Distinct().Count() != questions.Count)
            throw new ArgumentException("Pick each question once.", nameof(questions));
        if (questions.Any(item => item.TenantId != TenantId || item.State != ReviewQuestionState.Active))
            throw new ArgumentException("Pick only active questions from this tenant's library.", nameof(questions));
        if (questions.GroupBy(item => item.Audience).Any(group => group.Count() > MaxQuestionsPerAudience))
            throw new ArgumentException($"A round asks up to {MaxQuestionsPerAudience} questions per audience.", nameof(questions));
        var next = questions.GroupBy(item => item.Audience)
            .SelectMany(group => group.Select((item, index) => (item.Id, item.Audience, Order: index))).ToArray();
        var current = _questions.OrderBy(item => item.Audience).ThenBy(item => item.SortOrder)
            .Select(item => (item.QuestionId, item.Audience, Order: item.SortOrder)).ToArray();
        if (current.SequenceEqual(next.OrderBy(item => item.Audience).ThenBy(item => item.Order))) return false;
        _questions.Clear();
        foreach (var (id, audience, order) in next)
            _questions.Add(ReviewRoundQuestion.Create(TenantId, Id, id, audience, order));
        MarkUpdated();
        return true;
    }

    /// <summary>The dates each task is due on if the round launched on <paramref name="launchDay"/>.</summary>
    public ReviewRoundSchedule ScheduleFor(DateOnly launchDay)
        => Schedule(new ReviewRoundDueDates(SelfAssessmentDueDate, PeerInputDueDate, ManagerAssessmentDueDate), launchDay);

    private ReviewRoundSchedule Schedule(ReviewRoundDueDates dates, DateOnly launchDay)
    {
        var self = dates.SelfAssessment ?? launchDay.AddDays(SelfAssessmentDueDays);
        var peer = dates.PeerInput ?? launchDay.AddDays(PeerInputDueDays);
        var manager = dates.ManagerAssessment ?? self.AddDays(ManagerAssessmentDueDays);
        return new ReviewRoundSchedule(self, peer, manager);
    }

    /// <summary>Launch readiness for the schedule: every enabled task due between launch and the cycle end.</summary>
    public IReadOnlyList<string> ScheduleIssues(PerformanceCycle cycle, DateOnly launchDay)
    {
        var schedule = ScheduleFor(launchDay);
        var dates = new List<DateOnly> { schedule.ManagerAssessment };
        if (SelfAssessmentEnabled) dates.Add(schedule.SelfAssessment);
        if (PeerInputEnabled) dates.Add(schedule.PeerInput);
        var issues = new List<string>();
        if (dates.Any(date => date < launchDay)) issues.Add(ReviewRoundIssueCodes.DueDateBeforeLaunch);
        if (dates.Any(date => date > cycle.EndDate)) issues.Add(ReviewRoundIssueCodes.DueDateAfterCycleEnd);
        if (SelfAssessmentEnabled && schedule.ManagerAssessment < schedule.SelfAssessment) issues.Add(ReviewRoundIssueCodes.ManagerBeforeSelf);
        return issues;
    }

    public void Launch(string configSnapshotJson, Guid ratingScaleVersionId, DateTime launchedAt)
    {
        RequireDraft();
        if (string.IsNullOrWhiteSpace(configSnapshotJson)) throw new ArgumentException("A configuration snapshot is required.", nameof(configSnapshotJson));
        if (ratingScaleVersionId == Guid.Empty) throw new ArgumentException("A rating-scale version is required.", nameof(ratingScaleVersionId));
        var schedule = ScheduleFor(DateOnly.FromDateTime(launchedAt));
        SelfAssessmentDueDate = SelfAssessmentEnabled ? schedule.SelfAssessment : null;
        PeerInputDueDate = PeerInputEnabled ? schedule.PeerInput : null;
        ManagerAssessmentDueDate = schedule.ManagerAssessment;
        ConfigSnapshotJson = configSnapshotJson;
        RatingScaleVersionId = ratingScaleVersionId;
        LaunchedAt = launchedAt;
        State = ReviewRoundState.Active;
        ActiveCycleSlot = CycleId;
        MarkUpdated();
    }

    /// <summary>
    /// Moves one stage's round date after launch, between the launch day and the cycle end, keeping the manager
    /// assessment on or after the self-assessment. Returns the previous date.
    /// </summary>
    public DateOnly? MoveDueDate(PerformanceCycle cycle, ReviewStage stage, DateOnly to)
    {
        if (State != ReviewRoundState.Active) throw new InvalidOperationException("Due dates move only while the round runs.");
        ValidateMove(cycle, to);
        if (!Enum.IsDefined(stage)) throw new ArgumentException("Choose a review stage.", nameof(stage));
        if (stage == ReviewStage.SelfAssessment && !SelfAssessmentEnabled || stage == ReviewStage.PeerInput && !PeerInputEnabled)
            throw new InvalidOperationException("This round does not have that stage.");
        if (stage == ReviewStage.SelfAssessment && ManagerAssessmentDueDate is DateOnly manager && to > manager
            || stage == ReviewStage.ManagerAssessment && SelfAssessmentDueDate is DateOnly self && to < self)
            throw new ArgumentException("The manager assessment is due on or after the self-assessment.", nameof(to));
        var from = stage switch
        {
            ReviewStage.SelfAssessment => SelfAssessmentDueDate,
            ReviewStage.PeerInput => PeerInputDueDate,
            _ => ManagerAssessmentDueDate,
        };
        if (from == to) return from;
        switch (stage)
        {
            case ReviewStage.SelfAssessment: SelfAssessmentDueDate = to; break;
            case ReviewStage.PeerInput: PeerInputDueDate = to; break;
            default: ManagerAssessmentDueDate = to; break;
        }
        MarkUpdated();
        return from;
    }

    /// <summary>A moved date lies between the launch day and the cycle end; it may fall after the review period.</summary>
    public void ValidateMove(PerformanceCycle cycle, DateOnly to)
    {
        if (cycle.Id != CycleId) throw new ArgumentException("The cycle does not own this round.", nameof(cycle));
        if (LaunchedAt is DateTime launched && to < DateOnly.FromDateTime(launched))
            throw new ArgumentException("A due date can't be before the round launched.", nameof(to));
        if (to > cycle.EndDate) throw new ArgumentException("Due dates must be on or before the cycle ends.", nameof(to));
    }

    public void Close()
    {
        if (State != ReviewRoundState.Active) throw new InvalidOperationException("Only an Active review round can close.");
        State = ReviewRoundState.Closed;
        ActiveCycleSlot = null;
        MarkUpdated();
    }

    private void RequireDraft()
    {
        if (State != ReviewRoundState.Draft) throw new InvalidOperationException("Only a Draft review round can be configured.");
    }

    private static void ValidatePeriod(PerformanceCycle cycle, DateOnly start, DateOnly end)
    {
        if (end < start || start < cycle.StartDate || end > cycle.EndDate)
            throw new ArgumentException("The review period must lie within the Cycle dates.");
    }
}

/// <summary>Round-level readiness codes, beside the per-subject ones.</summary>
public static class ReviewRoundIssueCodes
{
    public const string NoCompetencies = "NoCompetencies";
    public const string NoPersonQuestions = "NoPersonQuestions";
    public const string NoManagerQuestions = "NoManagerQuestions";
    public const string NoPeerQuestions = "NoPeerQuestions";
    public const string NoQuestions = "NoQuestions";
    public const string DueDateBeforeLaunch = "DueDateBeforeLaunch";
    public const string DueDateAfterCycleEnd = "DueDateAfterCycleEnd";
    public const string ManagerBeforeSelf = "ManagerBeforeSelf";
    public const string RoundRunning = "RoundRunning";
    public const string NoSubjects = "NoSubjects";
}

/// <summary>A library question a Draft round picked, in its audience's order.</summary>
public sealed class ReviewRoundQuestion : PerformanceChildEntity
{
    private ReviewRoundQuestion() { }

    public Guid ReviewRoundId { get; private set; }
    public Guid QuestionId { get; private set; }
    public ReviewQuestionAudience Audience { get; private set; }
    public int SortOrder { get; private set; }

    internal static ReviewRoundQuestion Create(Guid tenantId, Guid roundId, Guid questionId, ReviewQuestionAudience audience, int order)
        => new() { TenantId = tenantId, ReviewRoundId = roundId, QuestionId = questionId, Audience = audience, SortOrder = order };
}

/// <summary>A question's text as a round launched with it: what every review of the round asks, whatever the library says later.</summary>
public sealed class ReviewQuestionSnapshot : PerformanceChildEntity
{
    private ReviewQuestionSnapshot() { }

    public Guid ReviewRoundId { get; private set; }
    public Guid QuestionId { get; private set; }
    public ReviewQuestionAudience Audience { get; private set; }
    public int SortOrder { get; private set; }
    public string Text { get; private set; } = string.Empty;

    public static ReviewQuestionSnapshot Create(ReviewRound round, ReviewRoundQuestion pick, ReviewQuestion question)
    {
        if (pick.ReviewRoundId != round.Id || pick.QuestionId != question.Id || question.TenantId != round.TenantId)
            throw new ArgumentException("The snapshot must freeze a question this round picked.");
        return new ReviewQuestionSnapshot
        {
            TenantId = round.TenantId, ReviewRoundId = round.Id, QuestionId = question.Id,
            Audience = pick.Audience, SortOrder = pick.SortOrder, Text = question.Text,
        };
    }
}
