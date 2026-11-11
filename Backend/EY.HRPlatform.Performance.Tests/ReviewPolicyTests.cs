using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Tests.TestHelpers;

namespace EY.HRPlatform.Performance.Tests;

public sealed class ReviewPolicyTests
{
    [Fact]
    public void Composer_visibility_matrix_hides_each_partys_draft_and_releases_manager_content_only_at_finalization()
    {
        var tenant = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", new(2026, 1, 1), new(2026, 12, 31), new(2026, 1, 31)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, Guid.NewGuid(), "Subject", null, null, null,
            Guid.NewGuid(), "Reviewer", false, new(2026, 1, 1));
        var round = ReviewRound.CreateDraft(tenant, cycle, "Mid-year", new(2026, 1, 1), new(2026, 12, 31), true, true, true);
        var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, participant.ManagerEmployeeId, "Reviewer");
        var review = PerformanceReview.Open(tenant, round, subject, Guid.NewGuid(), "[{\"Value\":3,\"Label\":\"Effective\"}]", DateTime.UtcNow);
        var subjectActor = new ReviewActor(participant.EmployeeId, false, CanParticipate: true);
        var reviewerActor = new ReviewActor(participant.ManagerEmployeeId!.Value, false, CanReviewReports: true);
        var adminActor = new ReviewActor(Guid.Empty, true);
        var unrelated = new ReviewActor(Guid.NewGuid(), false);

        AssertVisibility(review, subjectActor, true, true, false);
        AssertVisibility(review, reviewerActor, true, false, true);
        AssertVisibility(review, adminActor, true, true, true);
        AssertVisibility(review, unrelated, false, false, false);
        Assert.True(ReviewPolicy.Visibility(subjectActor, review).CanEditSelfAssessment);
        Assert.False(ReviewPolicy.Visibility(subjectActor, review).CanEditManagerAssessment);
        Assert.False(ReviewPolicy.Visibility(adminActor, review).CanEditSelfAssessment);
        Assert.False(ReviewPolicy.Visibility(adminActor, review).CanEditManagerAssessment);

        review.SubmitSelfAssessment(participant.EmployeeId, "Self submitted", 3, DateTime.UtcNow);
        AssertVisibility(review, reviewerActor, true, true, true);
        Assert.True(ReviewPolicy.Visibility(reviewerActor, review).CanEditManagerAssessment);
        Assert.False(ReviewPolicy.Visibility(reviewerActor, review).CanEditSelfAssessment);
        review.SubmitManagerAssessment(participant.ManagerEmployeeId.Value, "Manager submitted", 3, DateTime.UtcNow);
        Assert.Equal(PerformanceReviewState.Calibration, review.State);
        AssertVisibility(review, subjectActor, true, true, false);
        AssertVisibility(review, reviewerActor, true, true, true);
        AssertVisibility(review, new ReviewActor(Guid.NewGuid(), false, IsCalibrationFacilitator: true), true, true, true);
    }

    [Fact]
    public void Calibration_detail_reaches_facilitators_during_and_reviewers_and_admins_after_but_never_the_subject()
    {
        var tenant = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", new(2026, 1, 1), new(2026, 12, 31), new(2026, 1, 31)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, Guid.NewGuid(), "Subject", null, null, null,
            Guid.NewGuid(), "Reviewer", false, new(2026, 1, 1));
        var round = ReviewRound.CreateDraft(tenant, cycle, "Year-end", new(2026, 1, 1), new(2026, 12, 31), false, false, true);
        var subject = ReviewRoundSubject.Create(tenant, round.Id, participant, participant.ManagerEmployeeId, "Reviewer");
        var review = PerformanceReview.Open(tenant, round, subject, Guid.NewGuid(), "[{\"Value\":3,\"Label\":\"Effective\"}]", DateTime.UtcNow);
        review.SubmitManagerAssessment(participant.ManagerEmployeeId!.Value, "Manager submitted", 3, DateTime.UtcNow);
        var subjectActor = new ReviewActor(participant.EmployeeId, false, CanParticipate: true);
        var adminSubject = new ReviewActor(participant.EmployeeId, true);
        var reviewer = new ReviewActor(participant.ManagerEmployeeId.Value, false, CanReviewReports: true);
        var admin = new ReviewActor(Guid.Empty, true);
        var facilitator = new ReviewActor(Guid.Empty, false, IsCalibrationFacilitator: true);

        Assert.True(ReviewPolicy.Visibility(facilitator, review).ShowCalibration);
        Assert.False(ReviewPolicy.Visibility(reviewer, review).ShowCalibration);
        Assert.False(ReviewPolicy.Visibility(admin, review).ShowCalibration);

        var reviewerWithoutGrant = new ReviewActor(participant.ManagerEmployeeId.Value, false);
        Assert.False(ReviewPolicy.Visibility(reviewerWithoutGrant, review).CanRead);
        Assert.Empty(ReviewPolicy.Readable(new[] { review }.AsQueryable(), reviewerWithoutGrant));
        Assert.Single(ReviewPolicy.Readable(new[] { review }.AsQueryable(), reviewer));

        Assert.True(ReviewPolicy.Visibility(reviewer, review, calibrationDecided: true).ShowCalibration);
        Assert.True(ReviewPolicy.Visibility(admin, review, calibrationDecided: true).ShowCalibration);
        Assert.False(ReviewPolicy.Visibility(subjectActor, review, calibrationDecided: true).ShowCalibration);
        // Administering rounds does not lift the subject's own limits on their review.
        var own = ReviewPolicy.Visibility(adminSubject, review, calibrationDecided: true);
        Assert.False(own.ShowCalibration);
        Assert.False(own.ShowManagerAssessment);
        // Facilitating the round does not either: no pre-release manager content, no calibration detail.
        var facilitatorSubject = ReviewPolicy.Visibility(new ReviewActor(participant.EmployeeId, false, IsCalibrationFacilitator: true), review);
        Assert.True(facilitatorSubject.CanRead);
        Assert.False(facilitatorSubject.ShowManagerAssessment);
        Assert.False(facilitatorSubject.ShowCalibration);
    }

    [Fact]
    public void Finalized_calibrated_rating_hides_the_original_overall_rating_only_from_the_subject()
    {
        var tenant = Guid.NewGuid();
        var cycle = PerformanceCycle.CreateDraft(tenant, "FY26", new(2026, 1, 1), new(2026, 12, 31), new(2026, 1, 31)).Activated();
        var participant = Participant.Create(tenant, cycle.Id, Guid.NewGuid(), "Subject", null, null, null,
            Guid.NewGuid(), "Reviewer", false, new(2026, 1, 1));
        var round = ReviewRound.CreateDraft(tenant, cycle, "Year-end", new(2026, 1, 1), new(2026, 12, 31), false, false, true);
        var roundSubject = ReviewRoundSubject.Create(tenant, round.Id, participant, participant.ManagerEmployeeId, "Reviewer");
        var review = PerformanceReview.Open(tenant, round, roundSubject, Guid.NewGuid(),
            "[{\"Value\":3,\"Label\":\"Effective\"},{\"Value\":4,\"Label\":\"Strong\"}]", DateTime.UtcNow);
        review.SubmitManagerAssessment(participant.ManagerEmployeeId!.Value, "Strong year", 4, DateTime.UtcNow);
        var items = Array.Empty<ReviewItemAssessmentDto>();
        var snapshot = System.Text.Json.JsonSerializer.Serialize(new
        {
            review = new { review.Id, review.CycleId, review.ReviewRoundId, Name = round.Name, round.PeriodStart, round.PeriodEnd,
                review.SubjectEmployeeId, review.SubjectDisplayName, review.ReviewerEmployeeId, review.ReviewerDisplayName,
                review.SelfAssessmentEnabled, review.ObjectiveRatingsEnabled, HasApprovedPlan = false },
            ratingScale = Array.Empty<ReviewRatingLevelDto>(), selfAssessment = (ReviewAssessmentDto?)null,
            managerAssessment = new ReviewAssessmentDto("Strong year", 4, DateTime.UtcNow, DateTime.UtcNow), items,
        });
        review.CompleteCalibration(3, calibrated: true);
        review.Finalize(snapshot, 3, "Calibration", DateTime.UtcNow);

        var subjectView = ReviewComposer.Compose(review, round, new(participant.EmployeeId, false), false, items);
        Assert.Null(subjectView.ManagerAssessment!.OverallRating);
        Assert.Equal(3, subjectView.FinalRating);
        Assert.Null(subjectView.FinalRatingSource);
        Assert.Null(subjectView.Calibration);

        var reviewerView = ReviewComposer.Compose(review, round,
            new(participant.ManagerEmployeeId.Value, false, CanReviewReports: true), false, items);
        var adminView = ReviewComposer.Compose(review, round, new(Guid.Empty, true), false, items);
        Assert.Equal(4, reviewerView.ManagerAssessment!.OverallRating);
        Assert.Equal(4, adminView.ManagerAssessment!.OverallRating);
    }

    private static void AssertVisibility(PerformanceReview review, ReviewActor actor, bool canRead, bool showSelf, bool showManager)
    {
        var visibility = ReviewPolicy.Visibility(actor, review);
        Assert.Equal(canRead, visibility.CanRead);
        Assert.Equal(showSelf, visibility.ShowSelfAssessment);
        Assert.Equal(showManager, visibility.ShowManagerAssessment);
    }
}
