using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

public sealed record ReviewNudgeRequest(string Who);
public sealed record ReviewNudgeDto(int Nudged);
public sealed record ReviewTalkDto(Guid MeetingId, DateTime At);
public sealed record AcknowledgementCommentRequest(string Comment);

public sealed record TakeBackSelfAssessmentCommand(Guid ReviewId, Guid ActorEmployeeId) : ICommand<Result<PerformanceReviewMutationDto>>;
public sealed record NudgeForReviewCommand(Guid ReviewId, Guid ActorEmployeeId, bool ReviewsReports, string ActorName, string Who) : ICommand<Result<ReviewNudgeDto>>;
public sealed record TalkItOverCommand(Guid ReviewId, Guid ActorEmployeeId) : ICommand<Result<ReviewTalkDto>>;
public sealed record CommentOnAcknowledgementCommand(Guid ReviewId, Guid ActorEmployeeId, string Comment) : ICommand<Result<ReviewAcknowledgementDto>>;

public static class ReviewNudgeTargets
{
    public const string Self = "self";
    public const string Peers = "peers";
}

/// <summary>"Take it back": the person reopens their sent self-review while the manager hasn't sent theirs.</summary>
public sealed class TakeBackSelfAssessmentHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<TakeBackSelfAssessmentCommand, Result<PerformanceReviewMutationDto>>
{
    public async Task<Result<PerformanceReviewMutationDto>> Handle(TakeBackSelfAssessmentCommand command, CancellationToken token)
    {
        var review = await db.PerformanceReviews.FirstOrDefaultAsync(r => r.Id == command.ReviewId, token);
        if (review is null || review.SubjectEmployeeId != command.ActorEmployeeId)
            return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        bool changed;
        try { changed = review.TakeBackSelfAssessment(command.ActorEmployeeId); }
        catch (InvalidOperationException ex) { return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewNotOpen, ex.Message)); }
        if (changed)
        {
            audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId, PerformanceAuditActions.ReviewSelfAssessmentTakenBack,
                new { state = review.State.ToString() });
            await db.SaveChangesAsync(token);
        }
        return Result.Success(new PerformanceReviewMutationDto(review.Id, review.State, review.CurrentStageDueDate, review.Version));
    }
}

/// <summary>
/// The manager's nudges from the review (D-60): the person toward their self-review, or each colleague who hasn't
/// answered yet. One notification per person per nudge; only the reviewer of record nudges from here.
/// </summary>
public sealed class NudgeForReviewHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<NudgeForReviewCommand, Result<ReviewNudgeDto>>
{
    public async Task<Result<ReviewNudgeDto>> Handle(NudgeForReviewCommand command, CancellationToken token)
    {
        var review = await db.PerformanceReviews.AsNoTracking().FirstOrDefaultAsync(r => r.Id == command.ReviewId, token);
        if (review is null || !command.ReviewsReports || review.ReviewerEmployeeId != command.ActorEmployeeId)
            return Result.Failure<ReviewNudgeDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        if (review.State is not (PerformanceReviewState.SelfAssessment or PerformanceReviewState.ManagerAssessment) || review.ManagerAssessment.IsSubmitted)
            return Result.Failure<ReviewNudgeDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewNotOpen, "This review is no longer being written."));
        var nudgeId = Guid.NewGuid();
        var nudged = 0;
        switch (command.Who)
        {
            case ReviewNudgeTargets.Self:
                if (review.State != PerformanceReviewState.SelfAssessment)
                    return Result.Failure<ReviewNudgeDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewNotOpen, "The self-review is already in."));
                notifications.EnqueueYearNudge(review.TenantId, review.CycleId, review.SubjectEmployeeId, command.ActorEmployeeId, command.ActorName,
                    "selfReview", PerformanceNotificationTemplates.ReviewPath(review.Id), nudgeId);
                nudged = 1;
                break;
            case ReviewNudgeTargets.Peers:
                var open = await db.PeerRequests.AsNoTracking().Where(r => r.ReviewId == review.Id && r.State == PeerRequestState.Open)
                    .Select(r => new { r.Id, r.PeerEmployeeId }).ToListAsync(token);
                foreach (var request in open)
                    notifications.EnqueueYearNudge(review.TenantId, review.CycleId, request.PeerEmployeeId, command.ActorEmployeeId, command.ActorName,
                        "peerInput", PerformanceNotificationTemplates.PeerRequestPath(request.Id), nudgeId);
                nudged = open.Count;
                break;
            default:
                return Result.Failure<ReviewNudgeDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, "Nudge the person or their peers."));
        }
        audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId, PerformanceAuditActions.ReviewNudged,
            new { who = command.Who, count = nudged });
        await db.SaveChangesAsync(token);
        return Result.Success(new ReviewNudgeDto(nudged));
    }
}

/// <summary>
/// "Talk it over in our 1:1" (D-74): the released review goes on the agenda of the person's next 1:1 with their manager,
/// saying where it came from. Once is enough: asking again answers with the same meeting.
/// </summary>
public sealed class TalkItOverHandler(PerformanceDbContext db, IPerformanceAudit audit) : ICommandHandler<TalkItOverCommand, Result<ReviewTalkDto>>
{
    public const int MaxText = 120;

    public async Task<Result<ReviewTalkDto>> Handle(TalkItOverCommand command, CancellationToken token)
    {
        var review = await db.PerformanceReviews.AsNoTracking().FirstOrDefaultAsync(r => r.Id == command.ReviewId, token);
        if (review is null || review.SubjectEmployeeId != command.ActorEmployeeId)
            return Result.Failure<ReviewTalkDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        if (review.State != PerformanceReviewState.Finalized)
            return Result.Failure<ReviewTalkDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewNotReleased, "Results aren't out yet."));
        var now = PerformanceClock.UtcNow;
        var next = await (from item in db.OneOnOneMeetings.AsNoTracking()
                          join series in db.OneOnOneSeries.AsNoTracking() on item.SeriesId equals series.Id
                          where series.ReportEmployeeId == review.SubjectEmployeeId && series.ManagerEmployeeId == review.ReviewerEmployeeId
                                && item.State == OneOnOneMeetingState.Upcoming && item.ScheduledAt >= now
                          orderby item.ScheduledAt
                          select (Guid?)item.Id).FirstOrDefaultAsync(token);
        // Loaded on its own so the meeting is tracked: a query mixing in AsNoTracking tracks nothing.
        var meeting = next is Guid id ? await db.OneOnOneMeetings.Include(m => m.Agenda).FirstAsync(m => m.Id == id, token) : null;
        if (meeting is null)
            return Result.Failure<ReviewTalkDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneWrongState,
                $"No 1:1 with {review.ReviewerDisplayName} is planned yet."));
        if (meeting.Agenda.Any(i => i.SourceKind == AgendaSourceKind.Review && i.SourceId == review.Id))
            return Result.Success(new ReviewTalkDto(meeting.Id, meeting.ScheduledAt));
        var round = await db.ReviewRounds.AsNoTracking().Where(r => r.Id == review.ReviewRoundId).Select(r => r.Name).SingleAsync(token);
        var text = $"My {round} review";
        try
        {
            meeting.AddAgendaItem(Guid.NewGuid(), text.Length <= MaxText ? text : text[..MaxText], command.ActorEmployeeId,
                new AgendaSource(AgendaSourceKind.Review, review.Id, review.CycleId), out _);
        }
        catch (InvalidOperationException ex) { return Result.Failure<ReviewTalkDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneWrongState, ex.Message)); }
        catch (ArgumentException ex) { return Result.Failure<ReviewTalkDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneInvalid, ex.Message)); }
        audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId, PerformanceAuditActions.ReviewTalkedOver,
            new { meetingId = meeting.Id });
        await db.SaveChangesAsync(token);
        return Result.Success(new ReviewTalkDto(meeting.Id, meeting.ScheduledAt));
    }
}

/// <summary>A comment for the manager after acknowledging; the manager reads it on the review.</summary>
public sealed class CommentOnAcknowledgementHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<CommentOnAcknowledgementCommand, Result<ReviewAcknowledgementDto>>
{
    public async Task<Result<ReviewAcknowledgementDto>> Handle(CommentOnAcknowledgementCommand command, CancellationToken token)
    {
        var review = await db.PerformanceReviews.FirstOrDefaultAsync(r => r.Id == command.ReviewId, token);
        if (review is null || review.SubjectEmployeeId != command.ActorEmployeeId)
            return Result.Failure<ReviewAcknowledgementDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        bool changed;
        try { changed = review.CommentOnAcknowledgement(command.ActorEmployeeId, command.Comment); }
        catch (ArgumentException ex) { return Result.Failure<ReviewAcknowledgementDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAcknowledgementInvalid, ex.Message)); }
        catch (InvalidOperationException ex) { return Result.Failure<ReviewAcknowledgementDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewNotReleased, ex.Message)); }
        if (changed)
        {
            audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId, PerformanceAuditActions.ReviewAcknowledgementCommented,
                new { hasComment = true });
            await db.SaveChangesAsync(token);
        }
        return Result.Success(new ReviewAcknowledgementDto(review.AcknowledgedAt!.Value, review.AcknowledgementComment));
    }
}
