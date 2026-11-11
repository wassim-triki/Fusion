using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Domain.Population;
using System.Text.Json;

namespace EY.HRPlatform.Performance.Domain.Reviews;

/// <summary>The reviewer's view of what someone could grow into (D-24). Never the tenant rating scale; never shown to the person.</summary>
public enum ReviewPotential { Developing, Growing, High }

/// <summary>One employee's formal review, created atomically with its round launch.</summary>
public sealed class PerformanceReview : PerformanceAggregate
{
    private PerformanceReview() { }
    private readonly List<ReviewItemResponse> _itemResponses = [];
    private readonly List<ReviewQuestionAnswer> _answers = [];
    private readonly List<PeerNomination> _peerNominations = [];
    public const int MaxPeers = 5;
    public const int MaxAcknowledgementComment = 1000;

    public Guid ReviewRoundId { get; private set; }
    public Guid CycleId { get; private set; }
    public Guid SubjectEmployeeId { get; private set; }
    public string SubjectDisplayName { get; private set; } = string.Empty;
    public string? SubjectJobTitle { get; private set; }
    public Guid? SubjectOrgUnitId { get; private set; }
    public string? SubjectOrgUnitName { get; private set; }
    public Guid ReviewerEmployeeId { get; private set; }
    public string ReviewerDisplayName { get; private set; } = string.Empty;
    public ReviewerBasis ReviewerBasis { get; private set; }
    public Guid RatingScaleVersionId { get; private set; }
    public string RatingScaleSnapshotJson { get; private set; } = "[]";
    public PerformanceReviewState State { get; private set; }
    public DateOnly? CurrentStageDueDate { get; private set; }
    public DateTime OpenedAt { get; private set; }
    public bool SelfAssessmentEnabled { get; private set; }
    public bool ObjectiveRatingsEnabled { get; private set; }
    public bool CalibrationEnabled { get; private set; }
    public DateOnly? ManagerAssessmentDueDate { get; private set; }
    public DateOnly? SelfAssessmentDueDate { get; private set; }
    /// <summary>Set when HR moved this review's own date: later round-level moves of that stage skip it.</summary>
    public bool SelfDueOverridden { get; private set; }
    public bool ManagerDueOverridden { get; private set; }
    public bool PeerInputEnabled { get; private set; }
    public bool QuestionsEnabled { get; private set; }
    public bool PotentialEnabled { get; private set; }
    public ReviewPotential? Potential { get; private set; }
    /// <summary>When peers were first asked: picked by Fusion at launch, or added by the manager later.</summary>
    public DateTime? PeersNominatedAt { get; private set; }
    public DateTime? AcknowledgedAt { get; private set; }
    public string? AcknowledgementComment { get; private set; }
    public ReviewAssessment SelfAssessment { get; private set; } = new();
    public ReviewAssessment ManagerAssessment { get; private set; } = new();
    public string? FinalizedSnapshotJson { get; private set; }
    public DateTime? FinalizedAt { get; private set; }
    public int? FinalRating { get; private set; }
    public string? FinalRatingSource { get; private set; }
    /// <summary>The potential calibration settled on (the manager's when unchanged). <see cref="Potential"/> stays the manager's.</summary>
    public ReviewPotential? FinalPotential { get; private set; }
    /// <summary>Calibration released a rating other than the manager's.</summary>
    public bool CalibrationChangedRating { get; private set; }
    public DateTime? ClosedAt { get; private set; }
    public string? CloseReason { get; private set; }
    public IReadOnlyList<ReviewItemResponse> ItemResponses => _itemResponses;
    public IReadOnlyList<ReviewQuestionAnswer> Answers => _answers;
    public IReadOnlyList<PeerNomination> PeerNominations => _peerNominations;

    public void AddItemResponse(ReviewItemResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);
        if (response.ReviewId != Id || response.TenantId != TenantId)
            throw new ArgumentException("The item response must belong to this review.", nameof(response));
        if (_itemResponses.Any(item => item.Kind == response.Kind && item.ItemId == response.ItemId))
            throw new ArgumentException("A review item response already exists for this item.", nameof(response));
        _itemResponses.Add(response);
    }

    public static PerformanceReview Open(Guid tenantId, ReviewRound round, ReviewRoundSubject subject,
        Guid ratingScaleVersionId, string ratingScaleSnapshotJson, DateTime openedAt)
        => Open(tenantId, round, subject, ratingScaleVersionId, ratingScaleSnapshotJson,
            subject.SubjectDisplayName, null, null, null, subject.ReviewerDisplayName ?? string.Empty,
            subject.ReviewerBasis, openedAt);

    public static PerformanceReview Open(Guid tenantId, ReviewRound round, ReviewRoundSubject subject,
        Guid ratingScaleVersionId, string ratingScaleSnapshotJson, string subjectDisplayName, string? subjectJobTitle,
        Guid? subjectOrgUnitId, string? subjectOrgUnitName, string reviewerDisplayName, ReviewerBasis reviewerBasis, DateTime openedAt)
    {
        if (round.State != ReviewRoundState.Draft) throw new InvalidOperationException("A review can only be created from a Draft round being launched.");
        if (subject.ReviewRoundId != round.Id || subject.IsExcluded)
            throw new ArgumentException("Only an included subject of this round can be reviewed.", nameof(subject));
        if (subject.ReviewerEmployeeId is not Guid reviewerId || reviewerId == Guid.Empty)
            throw new ArgumentException("A review requires a recorded reviewer.", nameof(subject));
        var schedule = round.ScheduleFor(DateOnly.FromDateTime(openedAt));
        return new PerformanceReview
        {
            TenantId = tenantId,
            ReviewRoundId = round.Id,
            CycleId = round.CycleId,
            SubjectEmployeeId = subject.SubjectEmployeeId,
            SubjectDisplayName = subjectDisplayName,
            SubjectJobTitle = subjectJobTitle,
            SubjectOrgUnitId = subjectOrgUnitId,
            SubjectOrgUnitName = subjectOrgUnitName,
            ReviewerEmployeeId = reviewerId,
            ReviewerDisplayName = reviewerDisplayName,
            ReviewerBasis = reviewerBasis,
            RatingScaleVersionId = ratingScaleVersionId,
            RatingScaleSnapshotJson = ratingScaleSnapshotJson,
            State = round.SelfAssessmentEnabled ? PerformanceReviewState.SelfAssessment : PerformanceReviewState.ManagerAssessment,
            CurrentStageDueDate = round.SelfAssessmentEnabled ? schedule.SelfAssessment : schedule.ManagerAssessment,
            SelfAssessmentEnabled = round.SelfAssessmentEnabled,
            PeerInputEnabled = round.PeerInputEnabled,
            QuestionsEnabled = round.QuestionsEnabled,
            PotentialEnabled = round.PotentialEnabled,
            ObjectiveRatingsEnabled = round.ObjectiveRatingsEnabled,
            CalibrationEnabled = round.CalibrationEnabled,
            SelfAssessmentDueDate = round.SelfAssessmentEnabled ? schedule.SelfAssessment : null,
            ManagerAssessmentDueDate = schedule.ManagerAssessment,
            SelfAssessment = new ReviewAssessment(),
            ManagerAssessment = new ReviewAssessment(),
            OpenedAt = openedAt,
        };
    }

    public bool SaveSelfAssessment(Guid actorEmployeeId, string summary, DateTime savedAt, int? overallRating = null)
    {
        RequireActor(actorEmployeeId, SubjectEmployeeId, "Only the subject can save a self-assessment.");
        if (!SelfAssessmentEnabled || State != PerformanceReviewState.SelfAssessment || SelfAssessment.IsSubmitted)
            throw new InvalidOperationException("The self-assessment is not editable at this stage.");
        ValidateRating(overallRating, required: false);
        SelfAssessment.Save(summary, overallRating, savedAt);
        MarkUpdated();
        return true;
    }

    /// <summary>The person's own overall view is required on submit (D-16); only the manager's rating counts.</summary>
    public bool SubmitSelfAssessment(Guid actorEmployeeId, string summary, int? overallRating, DateTime submittedAt)
    {
        RequireActor(actorEmployeeId, SubjectEmployeeId, "Only the subject can submit a self-assessment.");
        if (SelfAssessment.IsSubmitted)
            return SelfAssessment.Summary == NormalizeSummary(summary) && SelfAssessment.OverallRating == overallRating
                ? false : throw new InvalidOperationException("A submitted self-assessment is locked.");
        if (!SelfAssessmentEnabled || State != PerformanceReviewState.SelfAssessment)
            throw new InvalidOperationException("The self-assessment cannot be submitted at this stage.");
        ValidateRating(overallRating, required: true);
        SelfAssessment.Submit(summary, overallRating, submittedAt);
        State = PerformanceReviewState.ManagerAssessment;
        CurrentStageDueDate = ManagerAssessmentDueDate;
        MarkUpdated();
        return true;
    }

    public bool SaveManagerAssessment(Guid actorEmployeeId, string summary, int? overallRating, DateTime savedAt,
        ReviewPotential? potential = null)
    {
        RequireActor(actorEmployeeId, ReviewerEmployeeId, "Only the reviewer of record can save a manager assessment.");
        // The manager may start while the self-review is still being written (D-60); sending waits for it.
        if (State is not (PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment) || ManagerAssessment.IsSubmitted)
            throw new InvalidOperationException("The manager assessment is not editable at this stage.");
        ValidateRating(overallRating, required: false);
        ValidatePotential(potential, required: false);
        ManagerAssessment.Save(summary, overallRating, savedAt);
        Potential = PotentialEnabled ? potential : null;
        MarkUpdated();
        return true;
    }

    public bool SubmitManagerAssessment(Guid actorEmployeeId, string summary, int? overallRating, DateTime submittedAt,
        ReviewPotential? potential = null)
    {
        RequireActor(actorEmployeeId, ReviewerEmployeeId, "Only the reviewer of record can submit a manager assessment.");
        if (ManagerAssessment.IsSubmitted)
            return ManagerAssessment.Summary == NormalizeSummary(summary) && ManagerAssessment.OverallRating == overallRating
                && (!PotentialEnabled || Potential == potential)
                ? false : throw new InvalidOperationException("A submitted manager assessment is locked.");
        if (State != PerformanceReviewState.ManagerAssessment)
            throw new InvalidOperationException("The manager assessment cannot be submitted at this stage.");
        ValidateRating(overallRating, required: true);
        ValidatePotential(potential, required: true);
        ManagerAssessment.Submit(summary, overallRating, submittedAt);
        Potential = PotentialEnabled ? potential : null;
        State = CalibrationEnabled ? PerformanceReviewState.Calibration : PerformanceReviewState.ReadyToFinalize;
        CurrentStageDueDate = null;
        MarkUpdated();
        return true;
    }

    /// <summary>Calibration sets the outcome as the result goes out: the calibrated rating when there is one, otherwise the manager's.</summary>
    public bool CompleteCalibration(int finalRating, bool calibrated)
    {
        if (State == PerformanceReviewState.ReadyToFinalize && FinalRating == finalRating) return false;
        if (State != PerformanceReviewState.Calibration)
            throw new InvalidOperationException("Only a review in calibration can take a calibrated outcome.");
        ValidateRating(finalRating, required: true);
        FinalRating = finalRating;
        FinalRatingSource = calibrated ? FinalRatingSources.Calibration : FinalRatingSources.Manager;
        FinalPotential = PotentialEnabled ? Potential : null;
        CalibrationChangedRating = calibrated && finalRating != ManagerAssessment.OverallRating;
        State = PerformanceReviewState.ReadyToFinalize;
        MarkUpdated();
        return true;
    }

    public bool Finalize(string snapshotJson, int finalRating, string ratingSource, DateTime finalizedAt)
    {
        if (State == PerformanceReviewState.Finalized) return false;
        if (State != PerformanceReviewState.ReadyToFinalize)
            throw new InvalidOperationException("Only a review ready for finalization can be finalized.");
        if (SelfAssessmentEnabled && !SelfAssessment.IsSubmitted)
            throw new InvalidOperationException("A submitted self-assessment is required before finalization.");
        if (string.IsNullOrWhiteSpace(snapshotJson)) throw new ArgumentException("A final review snapshot is required.", nameof(snapshotJson));
        if (finalRating <= 0) throw new ArgumentOutOfRangeException(nameof(finalRating));
        ValidateRating(finalRating, required: true);
        if (string.IsNullOrWhiteSpace(ratingSource)) throw new ArgumentException("A final rating source is required.", nameof(ratingSource));
        FinalizedSnapshotJson = snapshotJson;
        FinalRating = finalRating;
        FinalRatingSource = ratingSource;
        FinalizedAt = finalizedAt;
        State = PerformanceReviewState.Finalized;
        CurrentStageDueDate = null;
        MarkUpdated();
        return true;
    }

    public bool CloseAdministratively(string reason, DateTime closedAt)
    {
        if (State == PerformanceReviewState.Closed) return false;
        if (State == PerformanceReviewState.Finalized)
            throw new InvalidOperationException("A finalized review cannot be closed administratively.");
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 1000)
            throw new ArgumentException("A close reason between 1 and 1,000 characters is required.", nameof(reason));
        CloseReason = reason.Trim();
        ClosedAt = closedAt;
        State = PerformanceReviewState.Closed;
        CurrentStageDueDate = null;
        MarkUpdated();
        return true;
    }

    /// <summary>Saves or clears one answer on the side that is still being written; answers lock with that side's submit.</summary>
    public void SetAnswer(ReviewQuestionAuthor author, Guid questionSnapshotId, string? text, IReadOnlyList<ReviewCitation>? citations = null)
    {
        if (!QuestionsEnabled) throw new InvalidOperationException("This round asks no questions.");
        var open = author == ReviewQuestionAuthor.Self
            ? SelfAssessmentEnabled && State == PerformanceReviewState.SelfAssessment && !SelfAssessment.IsSubmitted
            : State is PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment && !ManagerAssessment.IsSubmitted;
        if (!open) throw new InvalidOperationException("These answers are no longer editable.");
        var existing = _answers.FirstOrDefault(item => item.Author == author && item.QuestionSnapshotId == questionSnapshotId);
        if (existing is null)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            _answers.Add(ReviewQuestionAnswer.Create(TenantId, Id, questionSnapshotId, author, text, citations));
            return;
        }
        if (string.IsNullOrWhiteSpace(text)) _answers.Remove(existing);
        else existing.Change(text, citations);
    }

    /// <summary>
    /// The colleagues Fusion picked when the round opened, from who worked with the person (D-40): asked at once, with
    /// nobody's approval first. Up to <see cref="MaxPeers"/>; none when nobody worked with them.
    /// </summary>
    public void PickPeers(IReadOnlyList<(Guid EmployeeId, string DisplayName)> peers, DateTime at)
    {
        if (!PeerInputEnabled) throw new InvalidOperationException("This round does not ask for peer input.");
        if (_peerNominations.Count > 0) throw new InvalidOperationException("Peers were already picked for this review.");
        ValidatePeers(peers);
        foreach (var peer in peers)
            _peerNominations.Add(PeerNomination.Create(TenantId, Id, peer.EmployeeId, peer.DisplayName, PeerNominationSource.Fusion, at));
        PeersNominatedAt = at;
        MarkUpdated();
    }

    /// <summary>
    /// The manager changes who is asked (D-40), any time until their review is in: colleagues left off stop being asked,
    /// new ones are asked. Returns who was removed and who was added.
    /// </summary>
    public PeerListDecision ChangePeers(Guid actorEmployeeId, IReadOnlyList<(Guid EmployeeId, string DisplayName)> peers, DateTime at)
    {
        RequireActor(actorEmployeeId, ReviewerEmployeeId, "Only the reviewer changes who is asked.");
        if (!PeerInputEnabled) throw new InvalidOperationException("This round does not ask for peer input.");
        if (State is not (PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment) || ManagerAssessment.IsSubmitted)
            throw new InvalidOperationException("Who is asked can change until the manager's review is in.");
        ValidatePeers(peers);
        var asked = _peerNominations.Select(item => item.EmployeeId).ToHashSet();
        var wanted = peers.Select(item => item.EmployeeId).ToHashSet();
        var decision = new PeerListDecision(asked.Where(id => !wanted.Contains(id)).ToArray(), wanted.Where(id => !asked.Contains(id)).ToArray());
        if (decision.Removed.Count == 0 && decision.Added.Count == 0) return decision;
        _peerNominations.RemoveAll(item => !wanted.Contains(item.EmployeeId));
        foreach (var peer in peers.Where(peer => !asked.Contains(peer.EmployeeId)))
            _peerNominations.Add(PeerNomination.Create(TenantId, Id, peer.EmployeeId, peer.DisplayName, PeerNominationSource.Reviewer, at));
        PeersNominatedAt ??= at;
        MarkUpdated();
        return decision;
    }

    /// <summary>
    /// The person takes their sent self-review back while the manager hasn't sent theirs ("Take it back"): it reopens
    /// as it was, due on its own date again.
    /// </summary>
    public bool TakeBackSelfAssessment(Guid actorEmployeeId)
    {
        RequireActor(actorEmployeeId, SubjectEmployeeId, "Only the person reviewed takes their self-review back.");
        if (!SelfAssessment.IsSubmitted) return false;
        if (State != PerformanceReviewState.ManagerAssessment || ManagerAssessment.IsSubmitted)
            throw new InvalidOperationException("The self-review can be taken back until the manager's review is in.");
        SelfAssessment.Reopen();
        State = PerformanceReviewState.SelfAssessment;
        CurrentStageDueDate = SelfAssessmentDueDate;
        MarkUpdated();
        return true;
    }

    /// <summary>
    /// A round-level move of one stage. Returns true when this review's open task is the one that moved
    /// (its owner is told); reviews with their own date for that stage keep it.
    /// </summary>
    public bool ApplyRoundDueDateMove(ReviewStage stage, DateOnly to)
    {
        switch (stage)
        {
            case ReviewStage.SelfAssessment:
                if (!SelfAssessmentEnabled || SelfDueOverridden || State != PerformanceReviewState.SelfAssessment
                    || SelfAssessmentDueDate == to) return false;
                SelfAssessmentDueDate = to;
                CurrentStageDueDate = to;
                MarkUpdated();
                return true;
            case ReviewStage.ManagerAssessment:
                if (ManagerDueOverridden || ManagerAssessment.IsSubmitted || ManagerAssessmentDueDate == to
                    || State is not (PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment)) return false;
                ManagerAssessmentDueDate = to;
                if (State == PerformanceReviewState.ManagerAssessment) CurrentStageDueDate = to;
                MarkUpdated();
                return State == PerformanceReviewState.ManagerAssessment;
            default:
                return false;
        }
    }

    /// <summary>Moves this review's current task only. Later round-level moves of that stage leave it alone.</summary>
    public (ReviewStage Stage, DateOnly? From) MoveCurrentDueDate(DateOnly to)
    {
        if (State == PerformanceReviewState.SelfAssessment && SelfAssessmentEnabled)
        {
            var from = SelfAssessmentDueDate;
            if (ManagerAssessmentDueDate is DateOnly manager && to > manager)
                throw new ArgumentException("The manager assessment is due on or after the self-assessment.", nameof(to));
            SelfAssessmentDueDate = to;
            SelfDueOverridden = true;
            CurrentStageDueDate = to;
            MarkUpdated();
            return (ReviewStage.SelfAssessment, from);
        }
        if (State == PerformanceReviewState.ManagerAssessment && !ManagerAssessment.IsSubmitted)
        {
            var from = ManagerAssessmentDueDate;
            ManagerAssessmentDueDate = to;
            ManagerDueOverridden = true;
            CurrentStageDueDate = to;
            MarkUpdated();
            return (ReviewStage.ManagerAssessment, from);
        }
        throw new InvalidOperationException("This review has no open task with a due date.");
    }

    /// <summary>"I've read this" (D-20): once, by the person, after release. It never changes the result.</summary>
    public bool Acknowledge(Guid actorEmployeeId, string? comment, DateTime at)
    {
        RequireActor(actorEmployeeId, SubjectEmployeeId, "Only the person reviewed acknowledges their result.");
        if (State != PerformanceReviewState.Finalized) throw new InvalidOperationException("Only a released review can be acknowledged.");
        if (AcknowledgedAt is not null) return false;
        var cleaned = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        if (cleaned?.Length > MaxAcknowledgementComment)
            throw new ArgumentException($"A comment can be up to {MaxAcknowledgementComment:N0} characters.", nameof(comment));
        AcknowledgedAt = at;
        AcknowledgementComment = cleaned;
        MarkUpdated();
        return true;
    }

    /// <summary>A comment for the manager after acknowledging ("Add a comment for Mariam"); replaces an earlier one.</summary>
    public bool CommentOnAcknowledgement(Guid actorEmployeeId, string? comment)
    {
        RequireActor(actorEmployeeId, SubjectEmployeeId, "Only the person reviewed comments on their result.");
        if (AcknowledgedAt is null) throw new InvalidOperationException("Acknowledge the review first.");
        var cleaned = string.IsNullOrWhiteSpace(comment) ? throw new ArgumentException("Write a comment.", nameof(comment)) : comment.Trim();
        if (cleaned.Length > MaxAcknowledgementComment)
            throw new ArgumentException($"A comment can be up to {MaxAcknowledgementComment:N0} characters.", nameof(comment));
        if (AcknowledgementComment == cleaned) return false;
        AcknowledgementComment = cleaned;
        MarkUpdated();
        return true;
    }

    private void ValidatePeers(IReadOnlyList<(Guid EmployeeId, string DisplayName)> peers)
    {
        ArgumentNullException.ThrowIfNull(peers);
        if (peers.Count > MaxPeers) throw new ArgumentException($"Ask up to {MaxPeers} colleagues.", nameof(peers));
        if (peers.Select(item => item.EmployeeId).Distinct().Count() != peers.Count)
            throw new ArgumentException("Choose each colleague once.", nameof(peers));
        if (peers.Any(item => item.EmployeeId == Guid.Empty || string.IsNullOrWhiteSpace(item.DisplayName)))
            throw new ArgumentException("Each colleague needs a name.", nameof(peers));
        if (peers.Any(item => item.EmployeeId == SubjectEmployeeId))
            throw new ArgumentException("The person reviewed can't give their own peer input.", nameof(peers));
        if (peers.Any(item => item.EmployeeId == ReviewerEmployeeId))
            throw new ArgumentException("The reviewer writes the review; choose other colleagues.", nameof(peers));
    }

    private void ValidatePotential(ReviewPotential? potential, bool required)
    {
        if (potential is { } value && !Enum.IsDefined(value)) throw new ArgumentException("Choose Developing, Growing or High.", nameof(potential));
        if (required && PotentialEnabled && potential is null) throw new ArgumentException("Rate their potential before submitting.", nameof(potential));
    }

    private void ValidateRating(int? rating, bool required)
    {
        if (rating is null)
        {
            if (required) throw new ArgumentException("An overall rating is required.", nameof(rating));
            return;
        }
        var levels = JsonSerializer.Deserialize<RatingScaleLevel[]>(RatingScaleSnapshotJson) ?? [];
        if (!levels.Any(level => level.Value == rating.Value))
            throw new ArgumentException("The overall rating must be a level on this review's snapshotted scale.", nameof(rating));
    }

    /// <summary>The words live in the round's questions now; a summary is optional and may be empty.</summary>
    internal static string NormalizeSummary(string? summary)
    {
        var normalized = summary?.Trim() ?? string.Empty;
        if (normalized.Length > 4000) throw new ArgumentException("A summary cannot exceed 4,000 characters.", nameof(summary));
        return normalized;
    }

    private static void RequireActor(Guid actorId, Guid ownerId, string message)
    {
        if (actorId == Guid.Empty || actorId != ownerId) throw new UnauthorizedAccessException(message);
    }
}

public static class FinalRatingSources
{
    public const string Manager = "Manager";
    public const string Calibration = "Calibration";
}

public sealed class ReviewAssessment
{
    public string Summary { get; private set; } = string.Empty;
    public int? OverallRating { get; private set; }
    public DateTime? SavedAt { get; private set; }
    public DateTime? SubmittedAt { get; private set; }
    public bool IsSubmitted => SubmittedAt is not null;

    internal ReviewAssessment() { }
    internal void Save(string summary, int? overallRating, DateTime savedAt)
    {
        Summary = PerformanceReview.NormalizeSummary(summary);
        OverallRating = overallRating;
        SavedAt = savedAt;
    }
    internal void Submit(string summary, int? overallRating, DateTime submittedAt)
    {
        Save(summary, overallRating, submittedAt);
        SubmittedAt = submittedAt;
    }
    /// <summary>Replaces only the text of a submitted assessment; its rating and submission stand.</summary>
    /// <summary>Taken back by its author: editable again, everything written kept.</summary>
    internal void Reopen() => SubmittedAt = null;
}
