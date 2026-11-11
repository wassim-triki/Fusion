using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

public sealed class ReviewAssessmentTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    [Fact]
    public void Assessments_follow_the_configured_stage_sequence_and_lock_after_submission()
    {
        var (review, subjectId, reviewerId) = CreateReview(selfEnabled: true, calibration: false);
        Assert.Throws<UnauthorizedAccessException>(() => review.SaveSelfAssessment(reviewerId, "reflection", DateTime.UtcNow));
        // The manager may start while the self-review is open (D-60); sending waits for it.
        Assert.True(review.SaveManagerAssessment(reviewerId, "manager view", 3, DateTime.UtcNow));
        Assert.Throws<InvalidOperationException>(() => review.SubmitManagerAssessment(reviewerId, "manager view", 3, DateTime.UtcNow));

        review.SaveSelfAssessment(subjectId, "  Progress was strong.  ", DateTime.UtcNow);
        Assert.Equal("Progress was strong.", review.SelfAssessment.Summary);
        Assert.True(review.SubmitSelfAssessment(subjectId, "Progress was strong.", 3, DateTime.UtcNow));
        Assert.Equal(PerformanceReviewState.ManagerAssessment, review.State);
        Assert.Equal(Start.AddDays(200), review.CurrentStageDueDate);
        Assert.False(review.SubmitSelfAssessment(subjectId, "Progress was strong.", 3, DateTime.UtcNow));
        Assert.Throws<InvalidOperationException>(() => review.SubmitSelfAssessment(subjectId, "Changed after submit", 3, DateTime.UtcNow));
        Assert.Throws<InvalidOperationException>(() => review.SaveSelfAssessment(subjectId, "Changed", DateTime.UtcNow));

        Assert.Throws<ArgumentException>(() => review.SubmitManagerAssessment(reviewerId, "Manager summary", 99, DateTime.UtcNow));
        Assert.True(review.SubmitManagerAssessment(reviewerId, "Manager summary", 4, DateTime.UtcNow));
        Assert.Equal(PerformanceReviewState.ReadyToFinalize, review.State);
        Assert.False(review.SubmitManagerAssessment(reviewerId, "Manager summary", 4, DateTime.UtcNow));
        Assert.Throws<InvalidOperationException>(() => review.SaveManagerAssessment(reviewerId, "Changed", 4, DateTime.UtcNow));
    }

    [Fact]
    public void Manager_stage_opens_immediately_when_self_assessment_is_disabled_and_calibration_is_next_when_enabled()
    {
        var (direct, subjectId, reviewerId) = CreateReview(selfEnabled: false, calibration: true);
        Assert.Equal(PerformanceReviewState.ManagerAssessment, direct.State);
        Assert.Throws<InvalidOperationException>(() => direct.SaveSelfAssessment(subjectId, "No self stage", DateTime.UtcNow));
        Assert.Throws<ArgumentException>(() => direct.SubmitManagerAssessment(reviewerId, "Missing rating", null, DateTime.UtcNow));
        direct.SaveManagerAssessment(reviewerId, "Draft", 3, DateTime.UtcNow);
        direct.SubmitManagerAssessment(reviewerId, "Final", 3, DateTime.UtcNow);
        Assert.Equal(PerformanceReviewState.Calibration, direct.State);
    }

    [Fact]
    public async Task Assessment_handlers_reject_stale_drafts_and_retry_submit_without_duplicate_audit_or_notice()
    {
        var store = TestStore.ForNewTenant();
        var (cycle, round, review, subjectId, _) = CreatePersistableReview(store, selfEnabled: true, calibration: false);
        await using var db = store.NewContext();
        db.Cycles.Add(cycle);
        db.ReviewRounds.Add(round);
        db.PerformanceReviews.Add(review);
        await db.SaveChangesAsync();
        var audit = new TestPerformanceAudit(db);
        var notifications = new PerformanceNotifications(db);

        var stale = await new SaveSelfAssessmentHandler(db, audit)
            .Handle(new(review.Id, new ReviewActor(subjectId, false, CanParticipate: true), 44, "Draft"), default);
        Assert.True(stale.IsFailure);
        Assert.Equal("Performance.Stale", stale.Error.Code);

        var saved = await new SaveSelfAssessmentHandler(db, audit)
            .Handle(new(review.Id, new ReviewActor(subjectId, false, CanParticipate: true), review.Version, "Draft"), default);
        Assert.True(saved.IsSuccess);
        var submitHandler = new SubmitSelfAssessmentHandler(db, audit, notifications);
        var submitted = await submitHandler.Handle(new(review.Id, new ReviewActor(subjectId, false, CanParticipate: true), review.Version, "Submitted summary") { OverallRating = 3 }, default);
        Assert.True(submitted.IsSuccess);
        var retried = await submitHandler.Handle(new(review.Id, new ReviewActor(subjectId, false, CanParticipate: true), 0, "Submitted summary") { OverallRating = 3 }, default);
        Assert.True(retried.IsSuccess);
        Assert.Equal(1, await db.OutboxMessages.CountAsync(m => m.Kind == PerformanceNotificationKind.SelfAssessmentSubmitted));
        Assert.Equal(1, await db.AuditEntries.CountAsync(e => e.Action == PerformanceAuditActions.ReviewSelfAssessmentSubmitted));
        Assert.Equal(PerformanceReviewState.ManagerAssessment, review.State);
    }

    private static (PerformanceReview Review, Guid SubjectId, Guid ReviewerId) CreateReview(bool selfEnabled, bool calibration)
    {
        var store = TestStore.ForNewTenant();
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY26", Start, End, Start.AddDays(30)).Activated();
        var participant = Participant.Create(store.TenantId, cycle.Id, Guid.NewGuid(), "Subject", null, null, null,
            Guid.NewGuid(), "Reviewer", false, Start);
        var round = ReviewRound.CreateDraft(store.TenantId, cycle, "Mid-year", Start, End, selfEnabled, true, calibration);
        round.UpdateDraft(cycle, "Mid-year", Start, End, selfEnabled, true, calibration,
            Start.AddDays(100), Start.AddDays(200), "[]");
        var subject = ReviewRoundSubject.Create(store.TenantId, round.Id, participant, participant.ManagerEmployeeId, "Reviewer");
        var review = PerformanceReview.Open(store.TenantId, round, subject, Guid.NewGuid(), RatingSnapshot, DateTime.UtcNow);
        return (review, participant.EmployeeId, participant.ManagerEmployeeId!.Value);
    }

    private static (PerformanceCycle Cycle, ReviewRound Round, PerformanceReview Review, Guid SubjectId, Guid ReviewerId)
        CreatePersistableReview(TestStore store, bool selfEnabled, bool calibration)
    {
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY26", Start, End, Start.AddDays(30)).Activated();
        var participant = Participant.Create(store.TenantId, cycle.Id, Guid.NewGuid(), "Subject", null, null, null,
            Guid.NewGuid(), "Reviewer", false, Start);
        var round = ReviewRound.CreateDraft(store.TenantId, cycle, "Mid-year", Start, End, selfEnabled, true, calibration);
        round.UpdateDraft(cycle, "Mid-year", Start, End, selfEnabled, true, calibration,
            Start.AddDays(100), Start.AddDays(200), "[]");
        var subject = ReviewRoundSubject.Create(store.TenantId, round.Id, participant, participant.ManagerEmployeeId, "Reviewer");
        var review = PerformanceReview.Open(store.TenantId, round, subject, Guid.NewGuid(), RatingSnapshot, DateTime.UtcNow);
        return (cycle, round, review, participant.EmployeeId, participant.ManagerEmployeeId!.Value);
    }

    private const string RatingSnapshot = "[{\"Value\":1,\"Label\":\"Low\",\"Description\":null},{\"Value\":2,\"Label\":\"Developing\",\"Description\":null},{\"Value\":3,\"Label\":\"Effective\",\"Description\":null},{\"Value\":4,\"Label\":\"Strong\",\"Description\":null},{\"Value\":5,\"Label\":\"Exceptional\",\"Description\":null}]";
}
