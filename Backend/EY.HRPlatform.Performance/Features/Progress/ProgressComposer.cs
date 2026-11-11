using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Progress;

/// <summary>
/// Builds the objective progress surface — current derived state, the append-only history in business
/// language, and evidence with a download path only where named-detail authorization holds — and
/// holds the progress authorization helpers. Never exposes raw event payloads; a never-reported
/// objective is surfaced as missing, not a reported 0.
/// </summary>
public static class ProgressComposer
{
    /// <summary>The history page size — the first page shipped with the surface, and the default "load more" size.</summary>
    public const int HistoryPageSize = 6;

    public static async Task<ObjectiveProgressDto> BuildAsync(
        PerformanceDbContext db, ICoreWorkforceClient workforce, Objective objective, EmployeePlan? plan, ProgressActorContext actor, CancellationToken cancellationToken)
    {
        var (items, nextCursor) = await BuildHistoryPageAsync(db, workforce, objective, plan, actor, null, HistoryPageSize, cancellationToken);

        var measurement = objective.Measurement;
        var milestones = measurement?.Milestones ?? [];
        return new ObjectiveProgressDto(
            objective.Id,
            objective.Title,
            objective.OwnershipScope,
            measurement?.Method ?? MeasurementMethod.ManualPercentage,
            objective.HasProgress,
            decimal.Round(objective.DerivedProgress, 2),
            objective.CurrentPercentage,
            objective.CurrentActual,
            measurement?.Baseline,
            measurement?.Target,
            measurement?.Unit,
            measurement?.Direction,
            milestones.Select(m => new ProgressMilestoneDto(m.Id, m.Title, m.Weight, m.DueDate, m.IsCompleted)).ToList(),
            CanUpdate(objective, plan, actor),
            items,
            nextCursor) { Version = objective.Version, CurrentStatus = objective.CurrentStatus };
    }

    /// <summary>
    /// One newest-first page of an objective's history. Keyset-paginated on <see cref="ProgressUpdate.RecordedAt"/>
    /// so paging is stable as older pages load. Each item carries its resulting derived progress and the signed
    /// change from the prior update, computed by replaying the full append-only trail in chronological order —
    /// the only faithful way to attribute a delta to a milestone toggle, whose event value alone cannot express it.
    /// </summary>
    public static async Task<(IReadOnlyList<ProgressUpdateDto> Items, string? NextCursor)> BuildHistoryPageAsync(
        PerformanceDbContext db, ICoreWorkforceClient workforce, Objective objective, EmployeePlan? plan,
        ProgressActorContext actor, string? cursor, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, 50);
        var trail = await BuildTrailAsync(db, objective, cancellationToken);

        var query = db.ProgressUpdates.AsNoTracking()
            .Include(u => u.Evidence)
            .Where(u => u.ObjectiveId == objective.Id);
        if (DecodeCursor(cursor) is DateTime before)
            query = query.Where(u => u.RecordedAt < before);

        // Fetch one extra to learn whether an older page exists without a second round-trip.
        var rows = await query.OrderByDescending(u => u.RecordedAt).Take(limit + 1).ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = hasMore ? rows.Take(limit).ToList() : rows;
        var nextCursor = hasMore ? EncodeCursor(page[^1].RecordedAt) : null;

        var authorIds = page.Select(u => u.AuthorEmployeeId).Distinct().ToList();
        var names = new Dictionary<Guid, string>();
        if (authorIds.Count > 0)
        {
            var snapshots = await workforce.ResolveAsync(PerformanceClock.UtcNow, authorIds, cancellationToken);
            foreach (var snapshot in snapshots) names[snapshot.EmployeeId] = snapshot.DisplayName;
        }

        var milestoneTitles = (objective.Measurement?.Milestones ?? []).ToDictionary(m => m.Id, m => m.Title);
        var canSeeNamedDetail = CanSeeNamedDetail(objective, plan, actor);

        var items = page.Select(update =>
        {
            var (resulting, delta) = trail.GetValueOrDefault(update.Id);
            return new ProgressUpdateDto(
                update.Id,
                update.Kind,
                update.Value,
                update.MilestoneChanges
                    .Select(change => new ProgressMilestoneChangeDto(change.MilestoneId, milestoneTitles.GetValueOrDefault(change.MilestoneId), change.Completed))
                    .ToList(),
                update.Status,
                update.ContextNote,
                update.IsCorrection,
                new PersonRefDto(update.AuthorEmployeeId, names.GetValueOrDefault(update.AuthorEmployeeId)),
                update.RecordedAt,
                update.Evidence.Select(item => ToEvidenceDto(item, objective.CycleId, canSeeNamedDetail)).ToList(),
                resulting,
                delta);
        }).ToList();

        return (items, nextCursor);
    }

    /// <summary>
    /// Replays every update oldest-first to derive each one's resulting objective progress and its change from the
    /// prior state. Reuses the domain's measurement formula for manual/numeric; for weighted milestones it folds the
    /// completed-weight set forward (the live measurement reflects only the final state, so it cannot be reused here).
    /// Evidence is not loaded — this pass needs only kind, value, and milestone changes.
    /// </summary>
    private static async Task<Dictionary<Guid, (decimal Resulting, decimal Delta)>> BuildTrailAsync(
        PerformanceDbContext db, Objective objective, CancellationToken cancellationToken)
    {
        var ascending = await TrailRows(db.ProgressUpdates.AsNoTracking().Where(u => u.ObjectiveId == objective.Id))
            .ToListAsync(cancellationToken);

        var trail = new Dictionary<Guid, (decimal, decimal)>(ascending.Count);
        var previous = 0m;
        foreach (var (row, resulting) in Replay(objective.Measurement, ascending))
        {
            trail[row.Id] = (resulting, decimal.Round(resulting - previous, 2));
            previous = resulting;
        }
        return trail;
    }

    /// <summary>
    /// Each objective's progress after every update, oldest first, in one query for all of them: the line its year is
    /// drawn with. Objectives with no update have an empty line.
    /// </summary>
    public static async Task<Dictionary<Guid, IReadOnlyList<ProgressPointDto>>> LinesAsync(
        PerformanceDbContext db, IReadOnlyCollection<Objective> objectives, CancellationToken cancellationToken)
    {
        var ids = objectives.Select(o => o.Id).ToList();
        var rows = ids.Count == 0 ? [] : await TrailRows(db.ProgressUpdates.AsNoTracking().Where(u => ids.Contains(u.ObjectiveId)))
            .ToListAsync(cancellationToken);
        var byObjective = rows.ToLookup(row => row.ObjectiveId);
        return objectives.ToDictionary(o => o.Id, o => (IReadOnlyList<ProgressPointDto>)Replay(o.Measurement, byObjective[o.Id].ToList())
            .Select(step => new ProgressPointDto(step.Row.RecordedAt, step.Resulting))
            .ToList());
    }

    private sealed record TrailRow(Guid Id, Guid ObjectiveId, DateTime RecordedAt, ProgressEventKind Kind, decimal? Value, List<TrailChange> Changes);
    private sealed record TrailChange(Guid MilestoneId, bool Completed);

    private static IQueryable<TrailRow> TrailRows(IQueryable<ProgressUpdate> updates)
        => updates.OrderBy(u => u.RecordedAt)
            .Select(u => new TrailRow(u.Id, u.ObjectiveId, u.RecordedAt, u.Kind, u.Value,
                u.MilestoneChanges.Select(c => new TrailChange(c.MilestoneId, c.Completed)).ToList()));

    /// <summary>Folds the updates forward, oldest first, yielding the objective's progress after each.</summary>
    private static IEnumerable<(TrailRow Row, decimal Resulting)> Replay(ObjectiveMeasurement? measurement, IReadOnlyList<TrailRow> ascending)
    {
        var weights = (measurement?.Milestones ?? []).ToDictionary(m => m.Id, m => m.Weight);
        var completed = new HashSet<Guid>();
        decimal? percentage = null;
        decimal? actual = null;
        foreach (var u in ascending)
        {
            switch (u.Kind)
            {
                case ProgressEventKind.PercentageSet: percentage = u.Value; break;
                case ProgressEventKind.NumericActual: actual = u.Value; break;
                case ProgressEventKind.MilestonesChanged:
                    foreach (var (milestoneId, done) in u.Changes)
                    {
                        if (done) completed.Add(milestoneId);
                        else completed.Remove(milestoneId);
                    }
                    break;
            }

            var resulting = measurement is null ? 0m
                : measurement.Method == MeasurementMethod.WeightedMilestones
                    ? completed.Sum(id => weights.GetValueOrDefault(id))
                    : measurement.DerivedProgress(percentage, actual);
            yield return (u, decimal.Round(resulting, 2));
        }
    }

    private static string EncodeCursor(DateTime recordedAt) => recordedAt.ToString("O");

    private static DateTime? DecodeCursor(string? cursor)
        => DateTime.TryParse(cursor, null, System.Globalization.DateTimeStyles.RoundtripKind, out var value) ? value : null;

    public static EvidenceItem ToEvidence(EvidenceInput input, Guid tenantId)
        => input.Kind switch
        {
            EvidenceKind.File => throw new ArgumentException("File evidence must be claimed from a staged upload."),
            EvidenceKind.Link => EvidenceItem.Link(tenantId, input.Url ?? throw new ArgumentException("A link evidence item requires a URL."), input.Label),
            EvidenceKind.Reference => EvidenceItem.Reference(tenantId, input.ReferenceText ?? throw new ArgumentException("A reference evidence item requires text.")),
            _ => throw new ArgumentOutOfRangeException(nameof(input)),
        };

    private static EvidenceDto ToEvidenceDto(EvidenceItem item, Guid cycleId, bool canSeeNamedDetail)
        => new(
            item.Id,
            item.Kind,
            item.FileName,
            item.ContentType,
            item.SizeBytes,
            item.Url,
            item.ReferenceText,
            // A file's download action is exposed only where named-detail authorization holds.
            item.Kind == EvidenceKind.File && !item.IsRemovedUnderRetention && canSeeNamedDetail
                ? $"/performance/cycles/{cycleId}/evidence/{item.Id}"
                : null)
        {
            IsRemovedUnderRetention = item.IsRemovedUnderRetention,
        };

    // ── Authorization ────────────────────────────────────────────────────────

    /// <summary>Only the accountable owner records progress, once the objective's baseline is set.</summary>
    public static bool CanUpdate(Objective objective, EmployeePlan? plan, ProgressActorContext actor)
        => ObjectivePolicy.CanUpdateProgress(actor.ToGoalActor(), objective, plan);

    /// <summary>
    /// Named detail (evidence, individual history) from ownership, responsibility, or administration —
    /// the lookup-free part of <see cref="ObjectivePolicy.CanReadProgressHistory"/>.
    /// </summary>
    public static bool CanSeeNamedDetail(Objective objective, EmployeePlan? plan, ProgressActorContext actor)
        => ObjectivePolicy.CanReadProgressHistory(new CycleViewer(actor.ToGoalActor(), null), objective, plan);
}
