using EY.HRPlatform.Performance.Domain.Common;

namespace EY.HRPlatform.Performance.Domain.Reviews;

public enum PeerRequestState { Open, Answered, Declined, Closed }

/// <summary>
/// One colleague's input on one review (D3, D-18). Its own aggregate so a peer writing never collides with the
/// review's version. The peer sees the person's name and the round's peer questions, never the review.
/// Open → Answered | Declined, or Closed (not answered) once the manager assessment is submitted.
/// </summary>
public sealed class PeerRequest : PerformanceAggregate
{
    public const int MaxAnswerLength = 2000;
    public const int MaxDeclineNote = 500;

    private PeerRequest() { }
    private readonly List<PeerAnswer> _answers = [];

    public Guid ReviewId { get; private set; }
    public Guid ReviewRoundId { get; private set; }
    public Guid CycleId { get; private set; }
    public Guid PeerEmployeeId { get; private set; }
    public string PeerDisplayName { get; private set; } = string.Empty;
    public Guid SubjectEmployeeId { get; private set; }
    public string SubjectDisplayName { get; private set; } = string.Empty;
    public PeerRequestState State { get; private set; }
    public DateOnly? DueDate { get; private set; }
    public DateTime RequestedAt { get; private set; }
    public DateTime? RespondedAt { get; private set; }
    public DateTime? ClosedAt { get; private set; }
    public string? DeclineNote { get; private set; }
    public IReadOnlyList<PeerAnswer> Answers => _answers;

    public static PeerRequest Create(PerformanceReview review, Guid peerEmployeeId, string peerDisplayName, DateOnly? dueDate, DateTime at)
    {
        ArgumentNullException.ThrowIfNull(review);
        if (peerEmployeeId == Guid.Empty || peerEmployeeId == review.SubjectEmployeeId || peerEmployeeId == review.ReviewerEmployeeId)
            throw new ArgumentException("A peer is a colleague other than the person and their reviewer.", nameof(peerEmployeeId));
        return new PeerRequest
        {
            TenantId = review.TenantId, ReviewId = review.Id, ReviewRoundId = review.ReviewRoundId, CycleId = review.CycleId,
            PeerEmployeeId = peerEmployeeId, PeerDisplayName = peerDisplayName.Trim(),
            SubjectEmployeeId = review.SubjectEmployeeId, SubjectDisplayName = review.SubjectDisplayName,
            State = PeerRequestState.Open, DueDate = dueDate, RequestedAt = at,
        };
    }

    /// <summary>Autosave: any subset of answers, blanks cleared. Only while open.</summary>
    public void SaveDraft(Guid actorEmployeeId, IReadOnlyDictionary<Guid, string?> answers, IReadOnlyCollection<Guid> questionIds)
    {
        RequirePeer(actorEmployeeId);
        RequireOpen();
        Apply(answers, questionIds);
        MarkUpdated();
    }

    /// <summary>Sends every answer and locks them. A retry of the same send returns false.</summary>
    public bool Send(Guid actorEmployeeId, IReadOnlyDictionary<Guid, string?> answers, IReadOnlyCollection<Guid> questionIds, DateTime at)
    {
        RequirePeer(actorEmployeeId);
        if (State == PeerRequestState.Answered && Matches(answers)) return false;
        RequireOpen();
        Apply(answers, questionIds);
        var missing = questionIds.Where(id => _answers.All(answer => answer.QuestionSnapshotId != id)).ToArray();
        if (missing.Length > 0) throw new PeerAnswersMissingException(missing);
        State = PeerRequestState.Answered;
        RespondedAt = at;
        MarkUpdated();
        return true;
    }

    public bool Decline(Guid actorEmployeeId, string? note, DateTime at)
    {
        RequirePeer(actorEmployeeId);
        if (State == PeerRequestState.Declined) return false;
        RequireOpen();
        var cleaned = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (cleaned?.Length > MaxDeclineNote) throw new ArgumentException($"A note can be up to {MaxDeclineNote} characters.", nameof(note));
        _answers.Clear();
        DeclineNote = cleaned;
        State = PeerRequestState.Declined;
        RespondedAt = at;
        MarkUpdated();
        return true;
    }

    /// <summary>The review left manager assessment (or closed): an unanswered request closes as not answered.</summary>
    public bool Close(DateTime at)
    {
        if (State != PeerRequestState.Open) return false;
        State = PeerRequestState.Closed;
        ClosedAt = at;
        MarkUpdated();
        return true;
    }

    /// <summary>Asked again after the manager left them off: the closed request opens again, answers cleared.</summary>
    public void Reopen(DateOnly? dueDate, DateTime at)
    {
        if (State != PeerRequestState.Closed) throw new InvalidOperationException("Only a closed request opens again.");
        _answers.Clear();
        State = PeerRequestState.Open;
        DueDate = dueDate;
        RequestedAt = at;
        ClosedAt = null;
        MarkUpdated();
    }

    public bool MoveDueDate(DateOnly to)
    {
        if (State != PeerRequestState.Open || DueDate == to) return false;
        DueDate = to;
        MarkUpdated();
        return true;
    }

    private void Apply(IReadOnlyDictionary<Guid, string?> answers, IReadOnlyCollection<Guid> questionIds)
    {
        ArgumentNullException.ThrowIfNull(answers);
        if (answers.Keys.Any(id => !questionIds.Contains(id)))
            throw new ArgumentException("An answer is for a question this request doesn't ask.", nameof(answers));
        foreach (var (questionId, text) in answers)
        {
            var value = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
            if (value?.Length > MaxAnswerLength)
                throw new ArgumentException($"An answer can be up to {MaxAnswerLength:N0} characters.", nameof(answers));
            var existing = _answers.FirstOrDefault(answer => answer.QuestionSnapshotId == questionId);
            if (value is null) { if (existing is not null) _answers.Remove(existing); continue; }
            if (existing is null) _answers.Add(PeerAnswer.Create(TenantId, Id, questionId, value));
            else existing.Change(value);
        }
    }

    private bool Matches(IReadOnlyDictionary<Guid, string?> answers)
        => answers.All(pair => _answers.Any(answer => answer.QuestionSnapshotId == pair.Key && answer.Text == pair.Value?.Trim()));

    private void RequireOpen()
    {
        if (State == PeerRequestState.Closed) throw new PeerRequestClosedException();
        if (State != PeerRequestState.Open) throw new InvalidOperationException("Your input was already sent.");
    }

    private void RequirePeer(Guid actorEmployeeId)
    {
        if (actorEmployeeId == Guid.Empty || actorEmployeeId != PeerEmployeeId)
            throw new UnauthorizedAccessException("Only the colleague asked can answer this request.");
    }
}

/// <summary>One answer a peer gave to one of the round's peer questions.</summary>
public sealed class PeerAnswer : PerformanceChildEntity
{
    private PeerAnswer() { }

    public Guid PeerRequestId { get; private set; }
    public Guid QuestionSnapshotId { get; private set; }
    public string Text { get; private set; } = string.Empty;

    internal static PeerAnswer Create(Guid tenantId, Guid requestId, Guid questionSnapshotId, string text)
        => new() { TenantId = tenantId, PeerRequestId = requestId, QuestionSnapshotId = questionSnapshotId, Text = text };

    internal void Change(string text)
    {
        if (text == Text) return;
        Text = text;
        MarkUpdated();
    }
}

/// <summary>The manager assessment was submitted or the review closed: the request no longer takes answers.</summary>
public sealed class PeerRequestClosedException() : InvalidOperationException("This review no longer takes peer input.");

/// <summary>Send was attempted with questions left blank; carries which ones.</summary>
public sealed class PeerAnswersMissingException(IReadOnlyList<Guid> questionIds)
    : ArgumentException("Answer every question before sending.")
{
    public IReadOnlyList<Guid> QuestionIds { get; } = questionIds;
}

/// <summary>A due date HR moved after launch, for a whole round or one review, with the reason (D-02).</summary>
public sealed class ReviewDueDateMove : PerformanceChildEntity
{
    public const int MaxReason = 500;

    private ReviewDueDateMove() { }

    public Guid ReviewRoundId { get; private set; }
    public Guid? ReviewId { get; private set; }
    public string? SubjectDisplayName { get; private set; }
    public ReviewStage Stage { get; private set; }
    public DateOnly? FromDate { get; private set; }
    public DateOnly ToDate { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public Guid? ActorEmployeeId { get; private set; }
    public string ActorName { get; private set; } = string.Empty;
    public DateTime MovedAt { get; private set; }
    public int AffectedCount { get; private set; }

    public static string NormalizeReason(string? reason)
    {
        var value = reason?.Trim() ?? string.Empty;
        if (value.Length is < 1 or > MaxReason) throw new ArgumentException($"Give a reason of 1 to {MaxReason} characters.", nameof(reason));
        return value;
    }

    public static ReviewDueDateMove Create(ReviewRound round, PerformanceReview? review, ReviewStage stage, DateOnly? from, DateOnly to,
        string reason, Guid? actorEmployeeId, string actorName, DateTime at, int affectedCount)
    {
        if (review is not null && review.ReviewRoundId != round.Id) throw new ArgumentException("The review belongs to another round.", nameof(review));
        return new ReviewDueDateMove
        {
            TenantId = round.TenantId, ReviewRoundId = round.Id, ReviewId = review?.Id, SubjectDisplayName = review?.SubjectDisplayName,
            Stage = stage, FromDate = from, ToDate = to, Reason = NormalizeReason(reason), ActorEmployeeId = actorEmployeeId,
            ActorName = string.IsNullOrWhiteSpace(actorName) ? "HR" : actorName.Trim(), MovedAt = at, AffectedCount = affectedCount,
        };
    }
}
