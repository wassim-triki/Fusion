using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using System.Data;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Catalog;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.Employees.Import.Services;

public sealed record WorkforceImportApplyResult(
    Guid SessionId,
    bool AlreadyApplied,
    int AddedEmployeeCount,
    int ManagerRelationshipCount,
    IReadOnlyList<string> AddedEmployeeKeys,
    int ExistingCount = 0,
    int NotImportedCount = 0);

/// <summary>Structured stale-review outcome — never a bare "validation failed".</summary>
public sealed record WorkforceReviewOutdatedItem(int SourceRowNumber, string Field, string Reason, string? DecisionKey);
public sealed record WorkforceReviewOutdatedResult(
    int AffectedCount, int PreservedDecisionCount, int NewBlockerCount, uint Version, IReadOnlyList<WorkforceReviewOutdatedItem> Items);

public enum WorkforceImportApplyFailureKind { Blocked, ReviewOutdated, Transient }

public sealed class WorkforceImportApplyException(WorkforceImportApplyFailureKind kind, string message, WorkforceReviewOutdatedResult? outdated = null) : Exception(message)
{
    public WorkforceImportApplyFailureKind Kind { get; } = kind;
    public WorkforceReviewOutdatedResult? Outdated { get; } = outdated;
}

/// <summary>
/// Performs create-only canonical establishment for a reviewed Workforce Import in ONE atomic
/// transaction through the existing Slice-1 mutation seam. Either the whole included batch commits
/// (with its durable history/provenance marker in the same transaction) or nothing does. Fresh
/// pre-apply recomputation compares reviewed meaning against current canonical facts and refuses to
/// silently adapt; an already-committed session replays its stored result without re-writing.
/// The <see cref="WorkforceImportApplyProcessor"/> drives this with an observable operation.
/// </summary>
public sealed class WorkforceImportApplyOrchestrator(
    CoreHRDbContext context,
    ITenantContext tenant,
    WorkforceImportDerivation derivation,
    IWorkforceMutationService mutation,
    IEmployeeNumberAllocator allocator)
{
    private Guid TenantId => tenant.TenantId;

    /// <summary>
    /// Execute the atomic apply for a session already in the frozen Applying state. Progress is
    /// reported through <paramref name="onPhase"/>. Throws <see cref="WorkforceImportApplyException"/>
    /// on blockers, stale review, or transient failure (transaction rolled back).
    /// </summary>
    public async Task<WorkforceImportApplyResult> ExecuteAsync(
        Guid sessionId, string reviewedProposalFingerprint, ImportActor actor, Action<string, int, int?>? onPhase, CancellationToken cancellationToken)
    {
        var session = await context.WorkforceImportSessions.Include(s => s.Source)
            .SingleOrDefaultAsync(s => s.Id == sessionId, cancellationToken)
            ?? throw new WorkforceImportApplyException(WorkforceImportApplyFailureKind.Blocked, "Import session was not found.");

        if (session.Status == WorkforceImportStatus.Committed) return ReplayResult(session);

        var useTransaction = context.Database.IsRelational();
        await using var transaction = useTransaction
            ? await context.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        try
        {
            onPhase?.Invoke("Preparing", 0, null);
            if (transaction is not null && context.Database.IsNpgsql())
            {
                // One workforce publication per tenant at a time: a concurrent attempt re-derives after
                // this one commits and sees the employees it created.
                var lockKey = $"workforce-import:{TenantId}";
                await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken);
            }
            var result = await ApplyInTransactionAsync(session, reviewedProposalFingerprint, actor, onPhase, cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return result;
        }
        catch (WorkforceImportApplyException)
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            throw;
        }
        catch (Exception exception)
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            throw new WorkforceImportApplyException(WorkforceImportApplyFailureKind.Transient,
                $"The import could not be completed. No employees were added. ({exception.GetType().Name})");
        }
    }

    private async Task<WorkforceImportApplyResult> ApplyInTransactionAsync(
        WorkforceImportSession session, string reviewedProposalFingerprint, ImportActor actor, Action<string, int, int?>? onPhase, CancellationToken cancellationToken)
    {
        // Re-derive under the write boundary against current CoreHR; never trust a cached proposal.
        var rows = await context.WorkforceImportRows.Where(r => r.SessionId == session.Id).OrderBy(r => r.SourceRowNumber).ToListAsync(cancellationToken);
        var derived = await derivation.DeriveAsync(session, rows, cancellationToken);
        var interpretation = derived.Interpretation;
        var proposal = derived.Proposal;

        // Publish only the exact proposal the administrator confirmed.
        if (!ImportFingerprint.Matches(derived.ProposalFingerprint, reviewedProposalFingerprint))
            throw new WorkforceImportApplyException(WorkforceImportApplyFailureKind.ReviewOutdated,
                "The workforce changed since you reviewed it.", DetectReviewOutdated(session, rows, proposal));

        onPhase?.Invoke("Validating", 0, proposal.CreateCount);
        var included = proposal.Rows.Where(r => r.Classification == WorkforceImportRowClassification.Create).ToList();
        if (!derived.Readiness.CanContinue || proposal.BlockedCount > 0)
            throw new WorkforceImportApplyException(WorkforceImportApplyFailureKind.Blocked, "Some rows still need attention.");
        if (included.Count == 0)
            throw new WorkforceImportApplyException(WorkforceImportApplyFailureKind.Blocked, "There's nobody new to import.");

        var normalizedByRow = interpretation.Rows.ToDictionary(r => r.SourceRowNumber);
        var actorName = actor.Normalize().DisplayName;
        var sourceRef = $"WorkforceImport:{session.Id}";

        // Establishment is dated at the resolver's per-row resolvedWorkEffectiveDate — the SOURCE "work
        // details effective from" when present, else the baseline fallback, or the baseline when the
        // administrator explicitly normalized this row's current work context. NEVER silently clamped.
        // The resolver validated Organization history at this exact date (one readiness contract), so a
        // row that reaches apply is org-valid at it. Both the WorkAssignment AND the initial primary
        // Manager relationship are established on this same date; Manager remains a separate effective-
        // dated relationship for all later lifecycle behavior.
        var resolvedRowByNumber = proposal.Rows.ToDictionary(r => r.SourceRowNumber);

        onPhase?.Invoke("Saving", 0, included.Count);

        // Bulk-reserve generated Employee Numbers once (no per-row allocator round trips / O(n²) scans).
        var manualNumbers = included
            .Select(r => normalizedByRow[r.SourceRowNumber].EmployeeNumber)
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n!.Trim().ToUpperInvariant())
            .ToHashSet(StringComparer.Ordinal);
        var generateCount = included.Count(r => string.IsNullOrWhiteSpace(normalizedByRow[r.SourceRowNumber].EmployeeNumber));
        var generated = new Queue<string>(await allocator.AllocateManyAsync(generateCount, manualNumbers, cancellationToken));

        // Disable auto DetectChanges during the bulk graph build to avoid O(n²) tracker cost; the
        // final SaveChanges performs one DetectChanges over the whole batch.
        var autoDetect = context.ChangeTracker.AutoDetectChangesEnabled;
        context.ChangeTracker.AutoDetectChangesEnabled = false;
        // Until the import learns jobs and places (B-186), titles and locations resolve to the catalogue by name.
        var catalog = new CatalogReferences(context, tenant);
        var employeeIdByRow = new Dictionary<int, Guid>();
        var keys = new List<string>();
        var processed = 0;
        var managerCount = 0;
        try
        {
            foreach (var row in included)
            {
                var normalized = normalizedByRow[row.SourceRowNumber];
                var number = string.IsNullOrWhiteSpace(normalized.EmployeeNumber) ? generated.Dequeue() : normalized.EmployeeNumber!.Trim().ToUpperInvariant();

                var employee = Employee.Create(TenantId, normalized.FirstName!, normalized.LastName!, normalized.WorkEmail, employeeNumber: number);
                if (!string.IsNullOrWhiteSpace(normalized.PreferredName)) employee.UpdatePreferredName(normalized.PreferredName);
                context.Employees.Add(employee);
                employeeIdByRow[row.SourceRowNumber] = employee.Id;
                keys.Add(employee.StableEmployeeKey);

                var employmentStart = normalized.EmploymentStart!.Value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
                var employment = await mutation.StartEmploymentAsync(employee.Id,
                    new StartEmploymentInput(employmentStart, null, WorkforceSourceType.Import, sourceRef, session.Id), actorName, cancellationToken);
                if (employment.IsFailure) throw MutationFailure(employment.Error.Code);

                var workEffective = resolvedRowByNumber[row.SourceRowNumber].ResolvedWorkEffectiveDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
                var job = await catalog.JobByTitleAsync(normalized.DisplayTitle!, actorName, cancellationToken);
                var place = await catalog.PlaceByNameAsync(normalized.Location, actorName, cancellationToken);
                var assignment = await mutation.ChangeWorkAssignmentAsync(employee.Id,
                    new ChangeWorkAssignmentInput(row.ResolvedOrgUnitId!.Value, job.Id, place?.Id, workEffective, WorkforceSourceType.Import, sourceRef, session.Id),
                    actorName, cancellationToken);
                if (assignment.IsFailure) throw MutationFailure(assignment.Error.Code);
                onPhase?.Invoke("Saving", ++processed, included.Count);
            }

            // Existing-employee managers were established in a prior import at their own (historical)
            // assignment date; look those up so an initial relationship never predates the manager's
            // own assignment. Same-import managers use their resolved establishment date directly.
            var existingManagerIds = included
                .Select(r => r.Manager)
                .Where(m => m.Kind == ManagerResolutionKind.ExistingEmployee && m.EmployeeId is not null)
                .Select(m => m.EmployeeId!.Value)
                .Distinct()
                .ToList();
            var existingManagerAssignmentFrom = existingManagerIds.Count == 0
                ? new Dictionary<Guid, DateTime>()
                : (await context.WorkAssignments.AsNoTracking()
                        .Where(w => w.IsPrimary && w.EffectiveTo == null && existingManagerIds.Contains(w.EmployeeId))
                        .Select(w => new { w.EmployeeId, w.EffectiveFrom })
                        .ToListAsync(cancellationToken))
                    .GroupBy(w => w.EmployeeId)
                    .ToDictionary(g => g.Key, g => g.Max(x => x.EffectiveFrom));

            // Manager relationships once the same-batch employee graph exists.
            foreach (var row in included)
            {
                var managerEmployeeId = row.Manager.Kind switch
                {
                    ManagerResolutionKind.ExistingEmployee => row.Manager.EmployeeId,
                    ManagerResolutionKind.SameImportRow when row.Manager.SameImportSourceRowNumber is int n && employeeIdByRow.TryGetValue(n, out var id) => id,
                    _ => (Guid?)null,
                };
                if (managerEmployeeId is null) continue;

                // The initial primary manager relationship begins at the later of the subject's and the
                // manager's resolved work-assignment dates, so it never predates either assignment (nor
                // the import baseline). Coherent with ChangeManagerAsync, which requires both parties to
                // have an active primary assignment on the relationship's effective date.
                var subjectEffective = resolvedRowByNumber[row.SourceRowNumber].ResolvedWorkEffectiveDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
                var managerAssignmentEffective = row.Manager.Kind switch
                {
                    ManagerResolutionKind.SameImportRow when row.Manager.SameImportSourceRowNumber is int mn
                        => resolvedRowByNumber[mn].ResolvedWorkEffectiveDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
                    ManagerResolutionKind.ExistingEmployee when existingManagerAssignmentFrom.TryGetValue(managerEmployeeId.Value, out var from)
                        => from,
                    _ => subjectEffective,
                };
                var managerEffective = subjectEffective >= managerAssignmentEffective ? subjectEffective : managerAssignmentEffective;

                var managerResult = await mutation.ChangeManagerAsync(employeeIdByRow[row.SourceRowNumber],
                    new ChangeManagerInput(managerEmployeeId.Value, managerEffective, WorkforceSourceType.Import, sourceRef, session.Id), actorName, cancellationToken);
                if (managerResult.IsFailure) throw MutationFailure(managerResult.Error.Code);
                managerCount++;
            }
        }
        finally
        {
            context.ChangeTracker.AutoDetectChangesEnabled = autoDetect;
        }

        // The attempt itself is the durable record: who published, when, which proposal, and what it created.
        var applyResult = new WorkforceImportApplyResult(session.Id, false, included.Count, managerCount, keys, proposal.ExistingCount, proposal.NotImportedCount);
        var provenance = JsonSerializer.Serialize(new
        {
            sourceFileName = session.Source.OriginalFileName,
            sourceSha256 = session.Source.Sha256,
            baselineDate = session.BaselineDate,
            createdEmployeeKeys = keys,
        });
        session.Commit(derived.ProposalFingerprint, JsonSerializer.Serialize(applyResult), provenance, actor);
        await context.SaveChangesAsync(cancellationToken); // commit marker + canonical writes persist together
        return applyResult;
    }

    private static WorkforceReviewOutdatedResult DetectReviewOutdated(WorkforceImportSession session, List<WorkforceImportRow> persistedRows, WorkforceImportProposal fresh)
    {
        var freshByRow = fresh.Rows.ToDictionary(r => r.SourceRowNumber);
        var items = new List<WorkforceReviewOutdatedItem>();
        foreach (var persisted in persistedRows)
        {
            if (!freshByRow.TryGetValue(persisted.SourceRowNumber, out var now)) continue;
            // A previously-clean row that is now needs-attention (or a changed match/org) is affected.
            // Any material change to the reviewed meaning of a row makes it outdated — not only
            // Organization. A fresh re-resolution against current canonical facts (Employee identity/
            // lifecycle, Employee-Number ownership, work-email occupancy, Organization as-of validity,
            // Manager identity/eligibility) surfaces as a changed classification, match, resolved
            // OrgUnit, or resolved manager.
            var wasClean = persisted.Classification is WorkforceImportRowClassification.Create or WorkforceImportRowClassification.Existing;
            var nowAttention = now.Classification == WorkforceImportRowClassification.Blocked;
            var matchChanged = persisted.CandidateEmployeeId != now.MatchedEmployeeId;
            var orgChanged = persisted.ResolvedOrgUnitId != now.ResolvedOrgUnitId;
            var managerChanged = !string.Equals(persisted.ResolvedManagerKey, now.Manager.RawReference, StringComparison.Ordinal)
                && now.Manager.Kind == ManagerResolutionKind.Unresolved;
            var classificationChanged = persisted.Classification != now.Classification;
            if ((wasClean && nowAttention) || classificationChanged || matchChanged || orgChanged || managerChanged)
            {
                var blocker = now.Issues.FirstOrDefault(i => i.IsBlocker);
                items.Add(new WorkforceReviewOutdatedItem(persisted.SourceRowNumber,
                    blocker?.Field ?? "Organization",
                    blocker?.Message ?? "A referenced canonical fact changed.",
                    blocker?.DecisionKey));
            }
        }
        var preserved = persistedRows.Count - items.Count;
        return new WorkforceReviewOutdatedResult(items.Count, preserved, fresh.BlockedCount, session.Version, items);
    }

    private static WorkforceImportApplyResult ReplayResult(WorkforceImportSession session)
    {
        if (!string.IsNullOrWhiteSpace(session.CommitResultJson))
        {
            var stored = JsonSerializer.Deserialize<WorkforceImportApplyResult>(session.CommitResultJson!);
            if (stored is not null) return stored with { AlreadyApplied = true };
        }
        return new WorkforceImportApplyResult(session.Id, true, session.CreateCount, 0, []);
    }

    /// <summary>
    /// A canonical writer that returns a failed <see cref="Result"/> hit a deterministic business
    /// invariant (e.g. an Organization not active as of the effective date). Retrying an unchanged
    /// proposal cannot help, so this is a <c>Blocked</c> failure — never <c>Transient</c>. The raw
    /// error code is retained as the message for forensic diagnosis; user-facing copy is produced at
    /// the operation/status boundary, not here. Genuine infrastructure faults surface as thrown
    /// exceptions and are classified <c>Transient</c> by the caller's outer catch.
    /// </summary>
    private static WorkforceImportApplyException MutationFailure(string errorCode)
        => new(WorkforceImportApplyFailureKind.Blocked,
            $"A canonical rule prevented establishing this workforce. ({errorCode})");

}
