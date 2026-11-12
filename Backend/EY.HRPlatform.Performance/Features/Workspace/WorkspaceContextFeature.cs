using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Features.Ai;
using EY.HRPlatform.Performance.Infrastructure.Ai;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Workspace;

/// <summary>The caller's token capabilities, resolved by the controller from the policy service.</summary>
public sealed record WorkspaceGrants(
    bool Administers,
    bool PublishesStrategy,
    bool ManagesOrgObjectives,
    bool Participates,
    bool CanCalibrate,
    string? AggregateViewScope,
    bool ViewsSettings = false);

public sealed record GetWorkspaceContextQuery(Guid? CycleId, WorkspaceGrants Grants) : IQuery<Result<WorkspaceContextDto>>;

/// <summary>
/// The selected Cycle, the Cycles the caller may switch to, and what the Performance workspace offers
/// them in that Cycle — composed from capabilities plus the responsibilities Performance recorded
/// (participation, responsible reviewer), never from a persona. Navigation follows this read; every
/// action is still authorized on its own.
/// </summary>
public sealed class GetWorkspaceContextHandler(PerformanceDbContext db, PerformanceViewer viewer, IPerformanceAiProvider ai)
    : IQueryHandler<GetWorkspaceContextQuery, Result<WorkspaceContextDto>>
{
    public async Task<Result<WorkspaceContextDto>> Handle(GetWorkspaceContextQuery request, CancellationToken cancellationToken)
    {
        var grants = request.Grants;
        var visibilityActor = new CycleVisibilityActor(viewer.EmployeeId ?? Guid.Empty, grants.Administers, grants.AggregateViewScope);
        var visible = await CyclePolicy.Visible(db.Cycles.AsNoTracking(), db.Participants.AsNoTracking(),
                db.PerformanceReviews.AsNoTracking(), visibilityActor)
            .OrderByDescending(cycle => cycle.State == CycleLifecycleState.Active)
            .ThenByDescending(cycle => cycle.StartDate)
            .ToListAsync(cancellationToken);

        PerformanceCycle? selected = null;
        if (request.CycleId is Guid requested)
        {
            selected = visible.FirstOrDefault(c => c.Id == requested);
            if (selected is null)
                return Result.Failure<WorkspaceContextDto>(PerformanceErrors.NotFound("Cycle", requested));
        }
        selected ??= visible
            .OrderByDescending(c => c.State == CycleLifecycleState.Active)
            .ThenByDescending(c => c.StartDate)
            .FirstOrDefault();

        var responsibilities = selected is null
            ? new CycleResponsibilities(false, [])
            : await viewer.ResponsibilitiesAsync(selected.Id, cancellationToken);
        var participates = grants.Participates && responsibilities.Participates;
        var canReviewReports = grants.AggregateViewScope is "DirectReports" or "OrgUnit" or "Tenant";
        var reviewer = canReviewReports && responsibilities.ReviewedEmployeeIds.Count > 0;
        var employeeId = viewer.EmployeeId ?? Guid.Empty;
        // Reviews is a destination for anyone with review work in any cycle (B-069 S-02), so past results stay reachable
        // while the selected cycle has no round yet; only HasReviewWork is about the selected cycle.
        var hasReviewRelationship = employeeId != Guid.Empty
            && await ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(),
                new ReviewActor(employeeId, grants.Administers, CanReviewReports: canReviewReports))
                .AnyAsync(cancellationToken);
        var hasReviewWork = selected is not null && employeeId != Guid.Empty
            && await ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(),
                new ReviewActor(employeeId, grants.Administers, CanReviewReports: canReviewReports))
                .AnyAsync(review => review.CycleId == selected.Id && review.ReviewerEmployeeId == employeeId, cancellationToken);
        // A calibrator has review work wherever a launched round uses calibration.
        var calibrates = grants.CanCalibrate && await db.ReviewRounds.AsNoTracking()
            .AnyAsync(round => round.CalibrationEnabled && round.State != Domain.Reviews.ReviewRoundState.Draft, cancellationToken);
        // A colleague asked for peer input has review work too: their request lives in Reviews (D-18).
        var hasPeerRequest = employeeId != Guid.Empty && grants.Participates
            && await db.PeerRequests.AsNoTracking().AnyAsync(request => request.PeerEmployeeId == employeeId, cancellationToken);
        var hasReviews = selected is not null && (grants.Administers || hasReviewRelationship || calibrates || hasPeerRequest);
        var orgRead = grants.AggregateViewScope is "DirectReports" or "OrgUnit" or "Tenant";

        var capabilities = new WorkspaceCapabilitiesDto(
            Participates: participates,
            IsResponsibleReviewer: reviewer,
            HasReviewWork: hasReviewWork,
            Administers: grants.Administers,
            PublishesStrategy: grants.PublishesStrategy,
            ManagesOrgObjectives: grants.ManagesOrgObjectives,
            CanCalibrate: grants.CanCalibrate,
            CanViewOrgDirection: grants.Administers || grants.PublishesStrategy || grants.ManagesOrgObjectives || orgRead,
            CanChooseOrganizationScope: grants.Administers || grants.AggregateViewScope == "Tenant",
            AiAssistance: await PerformanceAiAccess.IsAvailableAsync(db, ai, cancellationToken));

        var destinations = new WorkspaceDestinationsDto(
            MyPlan: participates,
            // Core HR's direct reports make the team too (B-383), not only the plans recorded as theirs to review.
            Team: reviewer || (canReviewReports && await LeadsPeopleAsync(cancellationToken)),
            Reviews: hasReviews,
            Settings: grants.ViewsSettings)
        {
            OneOnOnes = await HasOneOnOnesAsync(employeeId, cancellationToken),
            Feedback = true,
        };

        var phase = selected is null ? null : await YearPhases.ComputeAsync(db, selected, cancellationToken);
        return new WorkspaceContextDto(
            visible.Select(PerformanceMappers.ToSummary).ToList(),
            selected is null ? null : PerformanceMappers.ToSummary(selected),
            phase,
            capabilities,
            destinations);
    }

    /// <summary>Direct reports in Core HR today; false while Core HR can't say.</summary>
    private async Task<bool> LeadsPeopleAsync(CancellationToken cancellationToken)
    {
        try { return (await viewer.CurrentLineAsync(cancellationToken)).DirectReports.Count > 0; }
        catch (HttpRequestException) { return false; }
    }

    /// <summary>
    /// 1:1s follow people, not cycles: anyone with a current manager or direct reports in Core HR, or any series. With Core
    /// HR down, a series alone decides; navigation never grants access.
    /// </summary>
    private async Task<bool> HasOneOnOnesAsync(Guid employeeId, CancellationToken cancellationToken)
    {
        if (employeeId == Guid.Empty) return false;
        if (await db.OneOnOneSeries.AsNoTracking().AnyAsync(s => s.ManagerEmployeeId == employeeId || s.ReportEmployeeId == employeeId, cancellationToken))
            return true;
        try
        {
            var line = await viewer.CurrentLineAsync(cancellationToken);
            return line.ManagerEmployeeId is not null || line.DirectReports.Count > 0;
        }
        catch (HttpRequestException) { return false; }
    }

}
