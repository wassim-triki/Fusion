using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Development;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Plans;

/// <summary>
/// My Team per phase (performance-team-workspace, design D5): each person's group — what needs the manager now — and
/// the facts of the phase. Planning: objectives and alignment to the manager's team objectives (scalars only, so a
/// private Draft stays private). Execution: owner-set status mix, the attention reason with the owner's reason, last
/// update. Review: self-assessment, peers, the manager's own review. Closed: the released result and acknowledgement.
/// Everything is over the caller's recorded responsibility; ratings appear only once released.
/// </summary>
public static class TeamPhaseFacts
{
    public const string Planning = "Planning";
    public const string Execution = "Execution";
    public const string Review = "Review";
    public const string Closed = "Closed";
    private const int RecentDays = 30;

    /// <summary>The groups of each phase, in the order the page shows them.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> Groups = new Dictionary<string, string[]>
    {
        [Planning] = ["waiting", "planning", "approved"],
        [Execution] = ["needsYou", "rest"],
        [Review] = ["ready", "waiting", "submitted", "notInRound"],
        [Closed] = ["notAcknowledged", "acknowledged", "noResult"],
    };

    /// <summary>
    /// The team page's section for the year's phase (<see cref="YearPhase"/>): Results out, a Closed year and a
    /// Review with no round still running show the results facts.
    /// </summary>
    public static string PhaseOf(CyclePhase? phase, ReviewRound? activeRound)
        => phase switch
        {
            CyclePhase.Planning => Planning,
            CyclePhase.Execution => Execution,
            CyclePhase.Review when activeRound is not null => Review,
            _ => Closed,
        };

    public sealed record Composed(IReadOnlyList<TeamRosterMemberDto> Members, TeamPhaseSummaryDto Summary);

    public static async Task<Composed> ComposeAsync(PerformanceDbContext db, PerformanceCycle cycle, Guid me, string phase,
        ReviewRound? activeRound, IReadOnlyList<TeamRosterMemberDto> members, CancellationToken cancellationToken)
    {
        var now = PerformanceClock.UtcNow;
        return phase switch
        {
            Planning => await PlanningAsync(db, cycle, me, members, cancellationToken),
            Execution => await ExecutionAsync(db, members, now, cancellationToken),
            Review => await ReviewAsync(db, activeRound!, me, members, cancellationToken),
            _ => await ClosedAsync(db, cycle, me, members, cancellationToken),
        };
    }

    private static TeamPhaseSummaryDto Summary(StatusMixDto? status = null, int updated = 0, int approved = 0, string? round = null,
        int selfSubmitted = 0, int selfTotal = 0, DateOnly? selfDue = null, IReadOnlyList<string>? peerLists = null,
        int reviewsSubmitted = 0, int reviewsReady = 0, int reviewsTotal = 0, DateOnly? reviewsDue = null,
        string? firstReadyName = null, Guid? firstReadyReviewId = null, DateTime? releasedAt = null)
        => new(status, updated, approved, round, selfSubmitted, selfTotal, selfDue, peerLists ?? [], reviewsSubmitted, reviewsReady,
            reviewsTotal, reviewsDue, firstReadyName, firstReadyReviewId, releasedAt);

    // ── Planning ─────────────────────────────────────────────────────────────────────────────────────────────────

    private static async Task<Composed> PlanningAsync(PerformanceDbContext db, PerformanceCycle cycle, Guid me,
        IReadOnlyList<TeamRosterMemberDto> members, CancellationToken cancellationToken)
    {
        var teamObjectives = await db.Objectives.AsNoTracking()
            .Where(o => o.CycleId == cycle.Id && o.OwnershipScope == ObjectiveOwnershipScope.OrgUnit && o.AccountablePersonId == me)
            .Select(o => o.Id).ToListAsync(cancellationToken);
        var planIds = members.Where(m => m.PlanId is not null).Select(m => m.PlanId!.Value).ToList();
        var objectives = planIds.Count == 0 ? [] : await db.Objectives.AsNoTracking()
            .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value) && o.State != ObjectiveLifecycleState.Archived)
            .Select(o => new { PlanId = o.EmployeePlanId!.Value, o.ParentObjectiveId })
            .ToListAsync(cancellationToken);
        var byPlan = objectives.GroupBy(o => o.PlanId).ToDictionary(g => g.Key, g => g.ToList());

        var composed = members.Select(m =>
        {
            var mine = m.PlanId is Guid planId ? byPlan.GetValueOrDefault(planId) ?? [] : [];
            var group = m.Status == RosterPlanStatus.Submitted ? "waiting" : m.Status == RosterPlanStatus.Approved ? "approved" : "planning";
            return m with
            {
                Group = group,
                Facts = new RosterPhaseFactsDto(
                    new RosterPlanningFactsDto(mine.Count, mine.Count(o => o.ParentObjectiveId is Guid parent && teamObjectives.Contains(parent))),
                    null, null, null),
            };
        }).ToList();
        return new Composed(composed, Summary(approved: members.Count(m => m.Status == RosterPlanStatus.Approved)));
    }

    // ── Execution ────────────────────────────────────────────────────────────────────────────────────────────────

    private static async Task<Composed> ExecutionAsync(PerformanceDbContext db, IReadOnlyList<TeamRosterMemberDto> members, DateTime now,
        CancellationToken cancellationToken)
    {
        var approved = members.Where(m => m.Status == RosterPlanStatus.Approved && m.PlanId is not null).ToList();
        var planIds = approved.Select(m => m.PlanId!.Value).ToList();
        var objectives = planIds.Count == 0 ? [] : await db.Objectives.AsNoTracking()
            .Where(o => o.EmployeePlanId != null && planIds.Contains(o.EmployeePlanId.Value) && o.State != ObjectiveLifecycleState.Archived)
            .Select(o => new { o.Id, PlanId = o.EmployeePlanId!.Value, o.Title, o.CurrentStatus, o.StatusSince, o.LastProgressAt, o.StatusReportedAt })
            .ToListAsync(cancellationToken);
        var flaggedIds = objectives.Where(o => o.CurrentStatus is ObjectiveStatus.AtRisk or ObjectiveStatus.OffTrack).Select(o => o.Id).ToList();
        var reasons = flaggedIds.Count == 0 ? new Dictionary<Guid, string?>() : (await db.ProgressUpdates.AsNoTracking()
                .Where(u => flaggedIds.Contains(u.ObjectiveId) && u.Status != null)
                .Select(u => new { u.ObjectiveId, u.ContextNote, u.RecordedAt })
                .ToListAsync(cancellationToken))
            .GroupBy(u => u.ObjectiveId).ToDictionary(g => g.Key, g => g.OrderByDescending(u => u.RecordedAt).First().ContextNote);
        var byPlan = objectives.GroupBy(o => o.PlanId).ToDictionary(g => g.Key, g => g.ToList());

        static DateTime? CheckIn(DateTime? progress, DateTime? status) => status is { } s && (progress is null || s > progress) ? s : progress;
        var recent = now.AddDays(-RecentDays);
        var updated = 0;

        var composed = members.Select(m =>
        {
            // A plan still not approved needs the manager: first their own decision, otherwise a nudge.
            if (m.Status != RosterPlanStatus.Approved || m.PlanId is null)
                return m with
                {
                    Group = "needsYou",
                    Facts = new RosterPhaseFactsDto(null,
                        new RosterExecutionFactsDto(new StatusMixDto(0, 0, 0, 0),
                            new RosterAttentionDto(m.CanReview ? "planWaiting" : "notApproved", null, null, null, m.CanReview ? m.ActivityAt : null, null), null),
                        null, null),
                };

            var mine = byPlan.GetValueOrDefault(m.PlanId.Value) ?? [];
            var lastUpdate = mine.Select(o => CheckIn(o.LastProgressAt, o.StatusReportedAt)).Where(d => d is not null).Max();
            if (lastUpdate >= recent) updated++;
            var status = new StatusMixDto(mine.Count(o => o.CurrentStatus == ObjectiveStatus.OnTrack), mine.Count(o => o.CurrentStatus == ObjectiveStatus.AtRisk),
                mine.Count(o => o.CurrentStatus == ObjectiveStatus.OffTrack), mine.Count(o => o.CurrentStatus is null));
            var worst = mine.Where(o => o.CurrentStatus is ObjectiveStatus.OffTrack or ObjectiveStatus.AtRisk)
                .OrderBy(o => o.CurrentStatus == ObjectiveStatus.OffTrack ? 0 : 1).ThenBy(o => o.StatusSince).FirstOrDefault();
            RosterAttentionDto? attention = worst is not null
                ? new(worst.CurrentStatus == ObjectiveStatus.OffTrack ? "offTrack" : "atRisk", worst.Id, worst.Title,
                    reasons.GetValueOrDefault(worst.Id), worst.StatusSince, null)
                : lastUpdate is null || lastUpdate < recent
                    ? new("noUpdate", null, null, null, lastUpdate, lastUpdate is DateTime last ? (int)(now - last).TotalDays : null)
                    : m.UpdateRequest?.State == UpdateRequestState.Open
                        ? new("openRequest", null, m.UpdateRequest.ObjectiveTitle, null, m.UpdateRequest.RequestedAt, null)
                        : null;
            return m with
            {
                Group = attention is null ? "rest" : "needsYou",
                Facts = new RosterPhaseFactsDto(null, new RosterExecutionFactsDto(status, attention, lastUpdate), null, null),
            };
        }).ToList();

        var mix = new StatusMixDto(objectives.Count(o => o.CurrentStatus == ObjectiveStatus.OnTrack), objectives.Count(o => o.CurrentStatus == ObjectiveStatus.AtRisk),
            objectives.Count(o => o.CurrentStatus == ObjectiveStatus.OffTrack), objectives.Count(o => o.CurrentStatus is null));
        return new Composed(composed, Summary(status: mix, updated: updated, approved: approved.Count));
    }

    /// <summary>Within a group: the most severe reason first, then the longest waiting.</summary>
    public static int Severity(TeamRosterMemberDto m) => m.Facts?.Execution?.Attention?.Kind switch
    {
        "planWaiting" => -1,
        "offTrack" => 0,
        "atRisk" => 1,
        "noUpdate" => 2,
        "openRequest" => 3,
        "notApproved" => 4,
        _ => 5,
    };

    // ── Review ───────────────────────────────────────────────────────────────────────────────────────────────────

    private static async Task<Composed> ReviewAsync(PerformanceDbContext db, ReviewRound round, Guid me,
        IReadOnlyList<TeamRosterMemberDto> members, CancellationToken cancellationToken)
    {
        var reviews = await db.PerformanceReviews.AsNoTracking()
            .Where(r => r.ReviewRoundId == round.Id && r.ReviewerEmployeeId == me && r.SubjectEmployeeId != me && r.State != PerformanceReviewState.Closed)
            .Select(r => new
            {
                r.Id, r.SubjectEmployeeId, r.SubjectDisplayName, r.State, r.SelfAssessmentEnabled, r.PeerInputEnabled, r.PeersNominatedAt, r.PeerListApprovedAt,
                SelfSubmitted = r.SelfAssessment.SubmittedAt, SelfSaved = r.SelfAssessment.SavedAt,
                ManagerSubmitted = r.ManagerAssessment.SubmittedAt, ManagerSaved = r.ManagerAssessment.SavedAt,
                SelfDue = r.SelfAssessmentDueDate ?? round.SelfAssessmentDueDate,
                ManagerDue = r.ManagerAssessmentDueDate ?? round.ManagerAssessmentDueDate,
            })
            .ToListAsync(cancellationToken);
        var reviewIds = reviews.Select(r => r.Id).ToList();
        var peers = reviewIds.Count == 0 ? [] : await db.PeerRequests.AsNoTracking().Where(p => reviewIds.Contains(p.ReviewId))
            .Select(p => new { p.ReviewId, p.State }).ToListAsync(cancellationToken);
        var peersByReview = peers.GroupBy(p => p.ReviewId).ToDictionary(g => g.Key, g => g.ToList());
        var bySubject = reviews.ToDictionary(r => r.SubjectEmployeeId);

        var composed = members.Select(m =>
        {
            if (!bySubject.TryGetValue(m.EmployeeId, out var r)) return m with { Group = "notInRound" };
            var asked = peersByReview.GetValueOrDefault(r.Id) ?? [];
            var proposed = r.PeerInputEnabled && r.PeersNominatedAt != null && r.PeerListApprovedAt == null && r.ManagerSubmitted == null;
            var ready = r.State == PerformanceReviewState.ManagerAssessment && r.ManagerSubmitted == null;
            var self = !r.SelfAssessmentEnabled ? "off" : r.SelfSubmitted != null ? "submitted" : r.SelfSaved != null ? "writing" : "notStarted";
            var yours = r.ManagerSubmitted != null ? "submitted" : r.ManagerSaved != null ? "draftSaved" : "notStarted";
            return m with
            {
                Group = r.ManagerSubmitted != null ? "submitted" : ready || proposed ? "ready" : "waiting",
                Facts = new RosterPhaseFactsDto(null, null,
                    new RosterReviewFactsDto(self, r.SelfSubmitted, r.SelfDue,
                        new RosterPeersDto(r.PeerInputEnabled, asked.Count(p => p.State != PeerRequestState.Closed),
                            asked.Count(p => p.State == PeerRequestState.Answered), proposed ? asked.Count : 0, proposed),
                        yours, r.ManagerSubmitted == null ? r.ManagerSaved : null),
                    null),
            };
        }).ToList();

        var firstReady = reviews.Where(r => r.State == PerformanceReviewState.ManagerAssessment && r.ManagerSubmitted == null)
            .OrderBy(r => r.SubjectDisplayName).FirstOrDefault();
        return new Composed(composed, Summary(
            round: round.Name,
            selfSubmitted: reviews.Count(r => r.SelfAssessmentEnabled && r.SelfSubmitted != null),
            selfTotal: reviews.Count(r => r.SelfAssessmentEnabled),
            selfDue: reviews.Select(r => r.SelfDue).Where(d => d is not null).Min(),
            peerLists: reviews.Where(r => r.PeerInputEnabled && r.PeersNominatedAt != null && r.PeerListApprovedAt == null && r.ManagerSubmitted == null)
                .Select(r => r.SubjectDisplayName).OrderBy(n => n).ToList(),
            reviewsSubmitted: reviews.Count(r => r.ManagerSubmitted != null),
            reviewsReady: reviews.Count(r => r.State == PerformanceReviewState.ManagerAssessment && r.ManagerSubmitted == null),
            reviewsTotal: reviews.Count,
            reviewsDue: reviews.Select(r => r.ManagerDue).Where(d => d is not null).Min(),
            firstReadyName: firstReady?.SubjectDisplayName,
            firstReadyReviewId: firstReady?.Id));
    }

    // ── Closed ───────────────────────────────────────────────────────────────────────────────────────────────────

    private static async Task<Composed> ClosedAsync(PerformanceDbContext db, PerformanceCycle cycle, Guid me,
        IReadOnlyList<TeamRosterMemberDto> members, CancellationToken cancellationToken)
    {
        var released = await ReleasedAsync(db, cycle.Id, me, cancellationToken);
        var subjects = released.Select(r => r.SubjectEmployeeId).ToList();
        var openGoals = await OpenGoalsAsync(db, cycle.Id, subjects, cancellationToken);
        var bySubject = released.GroupBy(r => r.SubjectEmployeeId).ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.FinalizedAt).First());

        var composed = members.Select(m =>
        {
            if (!bySubject.TryGetValue(m.EmployeeId, out var r)) return m with { Group = "noResult" };
            return m with
            {
                Group = r.AcknowledgedAt is null ? "notAcknowledged" : "acknowledged",
                Facts = new RosterPhaseFactsDto(null, null, null,
                    new RosterClosedFactsDto(r.Id, r.FinalRating, r.Label, r.CalibrationChangedRating ? r.ManagerRating : null,
                        r.AcknowledgedAt, !string.IsNullOrWhiteSpace(r.AcknowledgementComment), openGoals.GetValueOrDefault(m.EmployeeId))),
            };
        }).ToList();
        return new Composed(composed, Summary(releasedAt: released.Max(r => (DateTime?)r.FinalizedAt)));
    }

    public sealed record ReleasedReview(Guid Id, Guid SubjectEmployeeId, string SubjectDisplayName, int FinalRating, string Label,
        int? ManagerRating, bool CalibrationChangedRating, DateTime FinalizedAt, DateTime? AcknowledgedAt, string? AcknowledgementComment,
        IReadOnlyList<RatingScaleLevel> Scale);

    /// <summary>The caller's released reviews in the cycle, as their recorded reviewer, never their own.</summary>
    public static async Task<List<ReleasedReview>> ReleasedAsync(PerformanceDbContext db, Guid cycleId, Guid me, CancellationToken cancellationToken)
    {
        var rows = await db.PerformanceReviews.AsNoTracking()
            .Where(r => r.CycleId == cycleId && r.ReviewerEmployeeId == me && r.SubjectEmployeeId != me
                && r.State == PerformanceReviewState.Finalized && r.FinalRating != null && r.FinalizedAt != null)
            .Select(r => new
            {
                r.Id, r.SubjectEmployeeId, r.SubjectDisplayName, FinalRating = r.FinalRating!.Value, ManagerRating = r.ManagerAssessment.OverallRating,
                r.CalibrationChangedRating, FinalizedAt = r.FinalizedAt!.Value, r.AcknowledgedAt, r.AcknowledgementComment, r.RatingScaleSnapshotJson,
            })
            .ToListAsync(cancellationToken);
        return rows.Select(r =>
        {
            var scale = JsonSerializer.Deserialize<RatingScaleLevel[]>(r.RatingScaleSnapshotJson) ?? [];
            return new ReleasedReview(r.Id, r.SubjectEmployeeId, r.SubjectDisplayName, r.FinalRating,
                scale.FirstOrDefault(l => l.Value == r.FinalRating)?.Label ?? $"Level {r.FinalRating}", r.ManagerRating,
                r.CalibrationChangedRating, r.FinalizedAt, r.AcknowledgedAt, r.AcknowledgementComment, scale);
        }).ToList();
    }

    public static async Task<Dictionary<Guid, int>> OpenGoalsAsync(PerformanceDbContext db, Guid cycleId, IReadOnlyCollection<Guid> employees,
        CancellationToken cancellationToken)
        => employees.Count == 0 ? [] : (await (from goal in db.DevelopmentGoals.AsNoTracking()
                                               join plan in db.DevelopmentPlans.AsNoTracking() on goal.DevelopmentPlanId equals plan.Id
                                               where plan.CycleId == cycleId && employees.Contains(plan.EmployeeId) && goal.Status != DevelopmentGoalStatus.Done
                                               select plan.EmployeeId).ToListAsync(cancellationToken))
            .GroupBy(id => id).ToDictionary(g => g.Key, g => g.Count());
}
