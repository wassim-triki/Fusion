using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Reviews;

namespace EY.HRPlatform.Performance.Domain.Calibration;

/// <summary>Who decided: an account holding the calibrate grant. Tenant administrators may have no employee record.</summary>
public sealed record CalibratorIdentity(Guid UserId, Guid? EmployeeId, string DisplayName);

/// <summary>
/// A calibration-enabled round's calibration (D-35). It opens itself when the first manager review arrives; nobody
/// opens, staffs or finalizes it. Each arrived review is a subject; Fusion flags the ones worth a look and only those
/// wait on a decision. Subjects live in their own rows with their own versions, so two calibrators never collide.
/// </summary>
public sealed class CalibrationSession : PerformanceAggregate
{
    private CalibrationSession() { }

    public Guid ReviewRoundId { get; private set; }
    public Guid CycleId { get; private set; }
    public DateTime OpenedAt { get; private set; }

    /// <summary>The rating bands copied from Settings when the session opened, so the grid never shifts mid-round.</summary>
    public int BandLowTop { get; private set; }
    public int BandMidTop { get; private set; }
    public NineBoxBands Bands => new(BandLowTop, BandMidTop);

    public static CalibrationSession Open(Guid tenantId, ReviewRound round, NineBoxBands bands, DateTime openedAt)
    {
        ArgumentNullException.ThrowIfNull(round);
        if (!round.CalibrationEnabled)
            throw new InvalidOperationException("This review round does not use calibration.");
        return new CalibrationSession
        {
            TenantId = tenantId,
            ReviewRoundId = round.Id,
            CycleId = round.CycleId,
            OpenedAt = openedAt,
            BandLowTop = bands.LowTop,
            BandMidTop = bands.MidTop,
        };
    }

    public CalibrationSubject AddSubject(PerformanceReview review)
    {
        if (review.ReviewRoundId != ReviewRoundId || review.TenantId != TenantId)
            throw new ArgumentException("Only reviews of this round can join its calibration.", nameof(review));
        if (review.State != PerformanceReviewState.Calibration || review.ManagerAssessment.OverallRating is not int original)
            throw new InvalidOperationException("Only a review with a submitted manager rating can join calibration.");
        return CalibrationSubject.Create(this, review, original);
    }
}

/// <summary>
/// One review under calibration. The original rating is the manager's and never changes. A flagged subject waits on a
/// decision: kept as rated in one click, or changed with a reason the manager reads (D-35, D-70). An unflagged one is
/// ready as rated and never needs one. A decision can be undone until the result is released.
/// </summary>
public sealed class CalibrationSubject : PerformanceChildEntity
{
    public const int ReasonMaxLength = 2000;

    private CalibrationSubject() { }

    public Guid SessionId { get; private set; }
    public Guid ReviewId { get; private set; }
    public int OriginalRating { get; private set; }
    public int? CalibratedRating { get; private set; }
    public string? Rationale { get; private set; }
    public DateTime? DecidedAt { get; private set; }
    public Guid? DecidedByUserId { get; private set; }
    public uint Version { get; private set; }

    public int CurrentRating => CalibratedRating ?? OriginalRating;
    public bool IsAdjusted => CalibratedRating is not null;
    public bool IsDecided => DecidedAt is not null;

    internal static CalibrationSubject Create(CalibrationSession session, PerformanceReview review, int originalRating) => new()
    {
        TenantId = session.TenantId,
        SessionId = session.Id,
        ReviewId = review.Id,
        OriginalRating = originalRating,
    };

    /// <summary>
    /// Decides the subject: the manager's rating kept, or another level of the scale with a reason. Returns the history
    /// entry when the rating or its reason changed.
    /// </summary>
    public CalibrationAdjustment? Decide(int rating, string? reason, IReadOnlyCollection<int> scale, CalibratorIdentity actor, DateTime at)
    {
        if (!scale.Contains(rating)) throw new ArgumentException("The rating must be a level of this round's scale.", nameof(rating));
        var cleaned = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (cleaned is { Length: > ReasonMaxLength }) throw new ArgumentException("A reason cannot exceed 2,000 characters.", nameof(reason));
        var changed = rating != OriginalRating;
        if (changed && cleaned is null) throw new ArgumentException("Say why the rating changes; the manager reads it.", nameof(reason));
        var nextReason = changed ? cleaned : null;
        CalibrationAdjustment? adjustment = null;
        if (CurrentRating != rating || nextReason != Rationale)
            adjustment = CalibrationAdjustment.Record(this, actor, CurrentRating, rating, nextReason, at);
        CalibratedRating = changed ? rating : null;
        Rationale = nextReason;
        DecidedAt = at;
        DecidedByUserId = actor.UserId;
        MarkUpdated();
        return adjustment;
    }

    /// <summary>Back to waiting on a decision, at the manager's rating. Returns the history entry when the rating moves back.</summary>
    public CalibrationAdjustment? Undo(CalibratorIdentity actor, DateTime at)
    {
        if (!IsDecided) return null;
        var adjustment = IsAdjusted ? CalibrationAdjustment.Record(this, actor, CurrentRating, OriginalRating, null, at) : null;
        CalibratedRating = null;
        Rationale = null;
        DecidedAt = null;
        DecidedByUserId = null;
        MarkUpdated();
        return adjustment;
    }
}

/// <summary>Append-only history of a subject's rating changes.</summary>
public sealed class CalibrationAdjustment : PerformanceChildEntity
{
    private CalibrationAdjustment() { }

    public Guid SessionId { get; private set; }
    public Guid SubjectId { get; private set; }
    public Guid ReviewId { get; private set; }
    public Guid ActorUserId { get; private set; }
    public string ActorDisplayName { get; private set; } = string.Empty;
    public DateTime At { get; private set; }
    public int PreviousRating { get; private set; }
    public int NewRating { get; private set; }
    public string? Rationale { get; private set; }

    internal static CalibrationAdjustment Record(CalibrationSubject subject, CalibratorIdentity actor, int previous, int next, string? rationale, DateTime at) => new()
    {
        TenantId = subject.TenantId,
        SessionId = subject.SessionId,
        SubjectId = subject.Id,
        ReviewId = subject.ReviewId,
        ActorUserId = actor.UserId,
        ActorDisplayName = string.IsNullOrWhiteSpace(actor.DisplayName) ? "HR" : actor.DisplayName.Trim(),
        At = at,
        PreviousRating = previous,
        NewRating = next,
        Rationale = rationale,
    };
}
