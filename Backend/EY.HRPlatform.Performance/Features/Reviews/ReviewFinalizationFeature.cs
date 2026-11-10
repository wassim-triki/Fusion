using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Calibration;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

public sealed record FinalizeReviewCommand(Guid ReviewId, uint ExpectedVersion, Guid ViewerEmployeeId = default) : ICommand<Result<ReviewFinalizationDto>>;
public sealed record FinalizeReviewRoundCommand(Guid RoundId, uint ExpectedVersion, IReadOnlyList<Guid>? ReviewIds, Guid ViewerEmployeeId = default) : ICommand<Result<ReviewRoundFinalizationDto>>;
public sealed record CloseReviewCommand(Guid ReviewId, uint ExpectedVersion, string Reason) : ICommand<Result<PerformanceReviewMutationDto>>;
public sealed record SkippedReviewDto(Guid ReviewId, string Reason);
/// <summary>The rating source is calibration detail: an administrator finalizing their own review gets it null.</summary>
public sealed record ReviewFinalizationDto(Guid ReviewId, PerformanceReviewState State, int FinalRating, string? FinalRatingSource, DateTime FinalizedAt);
public sealed record ReviewRoundFinalizationDto(Guid ReviewRoundId, IReadOnlyList<ReviewFinalizationDto> Finalized, IReadOnlyList<SkippedReviewDto> Skipped, ReviewRoundState State);

internal static class ReviewFinalization
{
    public static ReviewFinalizationDto ForViewer(ReviewFinalizationDto dto, PerformanceReview review, Guid viewerEmployeeId)
        => viewerEmployeeId != Guid.Empty && review.SubjectEmployeeId == viewerEmployeeId ? dto with { FinalRatingSource = null } : dto;

    public static async Task<ReviewFinalizationDto?> FinalizeAsync(PerformanceDbContext db, PerformanceReview review,
        ReviewRound round, IPerformanceAudit audit, IPerformanceNotifications notifications, CancellationToken token)
    {
        if (review.State == PerformanceReviewState.Finalized) return null;
        if (review.State != PerformanceReviewState.ReadyToFinalize)
            throw new InvalidOperationException("The review is not ready for finalization.");
        if (!review.ManagerAssessment.IsSubmitted || review.ManagerAssessment.OverallRating is not int managerRating)
            throw new InvalidOperationException("A submitted reviewer assessment and overall rating are required.");
        // Calibration already set the outcome; without it the manager's rating stands.
        var finalRating = review.FinalRating ?? managerRating;
        var source = review.FinalRatingSource ?? FinalRatingSources.Manager;

        var composed = await new GetPerformanceReviewHandler(db).Handle(
            new GetPerformanceReviewQuery(review.Id, new ReviewActor(Guid.Empty, true)), token);
        if (!composed.IsSuccess) throw new InvalidOperationException("The review snapshot could not be composed.");
        var snapshot = JsonSerializer.Serialize(new
        {
            capturedAt = PerformanceClock.UtcNow,
            review = new { review.Id, review.CycleId, review.ReviewRoundId, round.Name, round.PeriodStart, round.PeriodEnd,
                review.SubjectEmployeeId, review.SubjectDisplayName, review.ReviewerEmployeeId, review.ReviewerDisplayName,
                review.SubjectJobTitle, review.SubjectOrgUnitId, review.SubjectOrgUnitName,
                reviewerBasis = review.ReviewerBasis.ToString(),
                review.SelfAssessmentEnabled, review.ObjectiveRatingsEnabled, HasApprovedPlan = composed.Value.HasApprovedPlan },
            ratingScale = composed.Value.RatingScale,
            ratingScaleVersionId = review.RatingScaleVersionId,
            ratingScaleVersion = composed.Value.RatingScaleVersion,
            selfAssessment = composed.Value.SelfAssessment,
            managerAssessment = composed.Value.ManagerAssessment,
            items = composed.Value.Items,
            // Both people's answers, potential and attributed peer answers (D-21); projections strip what the person may not see.
            questions = composed.Value.Questions,
            potential = composed.Value.Potential,
            peers = composed.Value.Peers,
            finalRating,
            finalRatingSource = source,
        });
        var now = PerformanceClock.UtcNow;
        if (!review.Finalize(snapshot, finalRating, source, now)) return null;
        audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId,
            PerformanceAuditActions.ReviewFinalized,
            new { before = PerformanceReviewState.ReadyToFinalize.ToString(), after = review.State.ToString(), finalRating, source });
        notifications.EnqueueReview(review, PerformanceNotificationKind.ReviewFinalized, round.Name);
        return new(review.Id, review.State, finalRating, source, now);
    }
}

/// <summary>
/// A round closes itself (D-34): once nothing in it is still open, it is over and nobody presses Close.
/// Called after the finalization or closure that may have settled it is saved; saves the closure itself.
/// </summary>
public static class ReviewRoundSettlement
{
    public static async Task CloseWhenSettledAsync(PerformanceDbContext db, ReviewRound round, IPerformanceAudit audit, CancellationToken token)
    {
        if (round.State != ReviewRoundState.Active) return;
        var open = await db.PerformanceReviews.AnyAsync(r => r.ReviewRoundId == round.Id
            && r.State != PerformanceReviewState.Finalized && r.State != PerformanceReviewState.Closed, token);
        if (open) return;
        round.Close();
        audit.Record(round.TenantId, "ReviewRound", round.Id, round.CycleId, PerformanceAuditActions.ReviewRoundClosed,
            new { before = ReviewRoundState.Active.ToString(), after = round.State.ToString() });
        await db.SaveChangesAsync(token);
    }
}

public sealed class FinalizeReviewHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<FinalizeReviewCommand, Result<ReviewFinalizationDto>>
{
    public async Task<Result<ReviewFinalizationDto>> Handle(FinalizeReviewCommand command, CancellationToken token)
    {
        var review = await db.PerformanceReviews.FirstOrDefaultAsync(r => r.Id == command.ReviewId, token);
        if (review is null) return Result.Failure<ReviewFinalizationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        if (review.State == PerformanceReviewState.Finalized)
            return Result.Success(ReviewFinalization.ForViewer(new(review.Id, review.State, review.FinalRating!.Value, review.FinalRatingSource!,
                review.FinalizedAt!.Value), review, command.ViewerEmployeeId));
        if (VersionGuard.Check(review, command.ExpectedVersion) is { } stale)
            return Result.Failure<ReviewFinalizationDto>(stale);
        var round = await db.ReviewRounds.FirstOrDefaultAsync(r => r.Id == review.ReviewRoundId, token);
        if (round is null) return Result.Failure<ReviewFinalizationDto>(PerformanceErrors.NotFound("ReviewRound", review.ReviewRoundId));
        if (round.State != ReviewRoundState.Active)
            return Result.Failure<ReviewFinalizationDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewFinalizationNotReady, "Only an Active review round can be finalized."));
        try
        {
            var result = await ReviewFinalization.FinalizeAsync(db, review, round, audit, notifications, token);
            await db.SaveChangesAsync(token);
            await ReviewRoundSettlement.CloseWhenSettledAsync(db, round, audit, token);
            return Result.Success(ReviewFinalization.ForViewer(result!, review, command.ViewerEmployeeId));
        }
        catch (InvalidOperationException ex) { return Result.Failure<ReviewFinalizationDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewFinalizationNotReady, ex.Message)); }
    }
}

public sealed class FinalizeReviewRoundHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<FinalizeReviewRoundCommand, Result<ReviewRoundFinalizationDto>>
{
    public async Task<Result<ReviewRoundFinalizationDto>> Handle(FinalizeReviewRoundCommand command, CancellationToken token)
    {
        var round = await db.ReviewRounds.FirstOrDefaultAsync(r => r.Id == command.RoundId, token);
        if (round is null) return Result.Failure<ReviewRoundFinalizationDto>(PerformanceErrors.NotFound("ReviewRound", command.RoundId));
        if (round.State == ReviewRoundState.Closed)
            return Result.Success<ReviewRoundFinalizationDto>(new(round.Id, [], [], round.State));
        if (round.State != ReviewRoundState.Active)
            return Result.Failure<ReviewRoundFinalizationDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewFinalizationNotReady, "Only an Active review round can be finalized."));
        var query = db.PerformanceReviews.Where(r => r.ReviewRoundId == round.Id);
        if (command.ReviewIds is not null)
        {
            if (command.ReviewIds.Distinct().Count() != command.ReviewIds.Count)
                return Result.Failure<ReviewRoundFinalizationDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewFinalizationInvalid, "Review IDs must be unique."));
            var found = await query.CountAsync(r => command.ReviewIds.Contains(r.Id), token);
            if (found != command.ReviewIds.Count)
                return Result.Failure<ReviewRoundFinalizationDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewFinalizationInvalid, "Every review ID must belong to this round."));
            query = query.Where(r => command.ReviewIds.Contains(r.Id));
        }
        var reviews = await query.OrderBy(r => r.SubjectDisplayName).ToListAsync(token);
        var ready = reviews.Any(review => review.State == PerformanceReviewState.ReadyToFinalize
            && review.ManagerAssessment.IsSubmitted && review.ManagerAssessment.OverallRating is not null);
        if (!ready)
        {
            var skippedCurrent = reviews.Select(review => new SkippedReviewDto(review.Id,
                review.State == PerformanceReviewState.Finalized ? "Already finalized." : "Review is not ready for finalization.")).ToArray();
            return Result.Success(new ReviewRoundFinalizationDto(round.Id, [], skippedCurrent, round.State));
        }
        if (VersionGuard.Check(round, command.ExpectedVersion) is { } stale)
            return Result.Failure<ReviewRoundFinalizationDto>(stale);
        var finalized = new List<ReviewFinalizationDto>();
        var skipped = new List<SkippedReviewDto>();
        foreach (var review in reviews)
        {
            if (review.State == PerformanceReviewState.Finalized) { skipped.Add(new(review.Id, "Already finalized.")); continue; }
            if (review.State != PerformanceReviewState.ReadyToFinalize || !review.ManagerAssessment.IsSubmitted || review.ManagerAssessment.OverallRating is null)
            { skipped.Add(new(review.Id, "Review is not ready for finalization.")); continue; }
            var value = await ReviewFinalization.FinalizeAsync(db, review, round, audit, notifications, token);
            if (value is not null) finalized.Add(ReviewFinalization.ForViewer(value, review, command.ViewerEmployeeId));
        }
        if (finalized.Count > 0)
        {
            round.Touch();
            audit.Record(round.TenantId, "ReviewRound", round.Id, round.CycleId, PerformanceAuditActions.ReviewRoundFinalized,
                new { finalizedReviewIds = finalized.Select(r => r.ReviewId).ToArray(), skippedReviewIds = skipped.Select(r => r.ReviewId).ToArray() });
        }
        await db.SaveChangesAsync(token);
        await ReviewRoundSettlement.CloseWhenSettledAsync(db, round, audit, token);
        return Result.Success<ReviewRoundFinalizationDto>(new(round.Id, finalized, skipped, round.State));
    }
}

public sealed class CloseReviewHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<CloseReviewCommand, Result<PerformanceReviewMutationDto>>
{
    public async Task<Result<PerformanceReviewMutationDto>> Handle(CloseReviewCommand command, CancellationToken token)
    {
        var review = await db.PerformanceReviews.FirstOrDefaultAsync(r => r.Id == command.ReviewId, token);
        if (review is null) return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        if (review.State == PerformanceReviewState.Closed) return Result.Success(ReviewAssessmentCommands.ToDto(review));
        if (VersionGuard.Check(review, command.ExpectedVersion) is { } stale)
            return Result.Failure<PerformanceReviewMutationDto>(stale);
        var before = review.State;
        try
        {
            review.CloseAdministratively(command.Reason, PerformanceClock.UtcNow);
            await PeerRequestClosure.CloseOpenAsync(db, review.Id, PerformanceClock.UtcNow, token);
        }
        catch (InvalidOperationException ex) { return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewFinalizationInvalid, ex.Message)); }
        catch (ArgumentException ex) { return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewFinalizationInvalid, ex.Message)); }
        audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId, PerformanceAuditActions.ReviewAdministrativelyClosed,
            new { before = before.ToString(), after = review.State.ToString(), reason = review.CloseReason });
        // Closing the last outstanding review can be what brings the round to calibration.
        if (await CalibrationSessions.FindAsync(db, review.ReviewRoundId, token) is { State: CalibrationSessionState.Open } session)
            await CalibrationSessions.NotifyIfReadyAsync(db, session, notifications, token);
        await db.SaveChangesAsync(token);
        await CalibrationSessions.ConfirmReadyAfterCommitAsync(db, review.ReviewRoundId, notifications, token);
        // Closing the last open review can also be what settles the round.
        if (await db.ReviewRounds.FirstOrDefaultAsync(r => r.Id == review.ReviewRoundId, token) is { } round)
            await ReviewRoundSettlement.CloseWhenSettledAsync(db, round, audit, token);
        return Result.Success(ReviewAssessmentCommands.ToDto(review));
    }
}
