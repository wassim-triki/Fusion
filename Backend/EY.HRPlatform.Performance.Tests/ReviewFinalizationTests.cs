using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Cycles;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Net.Http.Json;

namespace EY.HRPlatform.Performance.Tests;

public sealed class ReviewFinalizationTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    [Fact]
    public async Task Bulk_finalization_persists_snapshot_notifies_once_and_skips_unready_reviews_on_retry()
    {
        var store = TestStore.ForNewTenant();
        var fixture = CreateFixture(store, reviewCount: 2);
        var ready = fixture.Reviews[0];
        ready.SubmitManagerAssessment(ready.ReviewerEmployeeId, "Strong work", 2, DateTime.UtcNow);
        await using var db = store.NewContext();
        db.Cycles.Add(fixture.Cycle);
        db.Participants.AddRange(fixture.Participants);
        db.RatingScales.Add(fixture.Scale);
        db.RatingScaleVersions.Add(fixture.ScaleVersion);
        db.ReviewRounds.Add(fixture.Round);
        db.ReviewRoundSubjects.AddRange(fixture.Subjects);
        db.PerformanceReviews.AddRange(fixture.Reviews);
        db.EmployeePlans.AddRange(fixture.Plans);
        db.Objectives.AddRange(fixture.Objectives);
        await db.SaveChangesAsync();

        var handler = new FinalizeReviewRoundHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db));
        var command = new FinalizeReviewRoundCommand(fixture.Round.Id, fixture.Round.Version, fixture.Reviews.Select(review => review.Id).ToArray());
        var stale = await handler.Handle(command with { ExpectedVersion = command.ExpectedVersion + 1 }, default);
        Assert.Equal("Performance.Stale", stale.Error.Code);
        Assert.Equal(PerformanceReviewState.ReadyToFinalize, ready.State);
        var result = await handler.Handle(command, default);
        Assert.True(result.IsSuccess);
        Assert.Single(result.Value.Finalized);
        Assert.Equal(ready.Id, result.Value.Finalized[0].ReviewId);
        Assert.Single(result.Value.Skipped);
        Assert.Equal(fixture.Reviews[1].Id, result.Value.Skipped[0].ReviewId);
        var snapshot = await db.PerformanceReviews.Where(review => review.Id == ready.Id).Select(review => review.FinalizedSnapshotJson).SingleAsync();
        Assert.Contains("Strong work", snapshot);
        Assert.Contains("\"finalRating\":2", snapshot);
        Assert.Contains("Improve reliability", snapshot);
        Assert.Contains("\"Progress\":30", snapshot);
        Assert.Contains("\"Label\":\"Strong\"", snapshot);
        Assert.Contains(ready.RatingScaleVersionId.ToString(), snapshot);
        Assert.Contains("\"ratingScaleVersion\":1", snapshot);
        Assert.Contains("Principal Engineer", snapshot);
        Assert.Contains("Product Engineering", snapshot);
        Assert.Equal(2, await db.PerformanceReviews.Where(review => review.Id == ready.Id).Select(review => review.FinalRating).SingleAsync());
        Assert.Equal("Manager", await db.PerformanceReviews.Where(review => review.Id == ready.Id).Select(review => review.FinalRatingSource).SingleAsync());

        var retry = await handler.Handle(command, default);
        Assert.True(retry.IsSuccess);
        Assert.Empty(retry.Value.Finalized);
        Assert.Equal(2, retry.Value.Skipped.Count);
        Assert.Equal(1, await db.OutboxMessages.CountAsync(message => message.Kind == PerformanceNotificationKind.ReviewFinalized));
        Assert.Equal(1, await db.AuditEntries.CountAsync(entry => entry.Action == PerformanceAuditActions.ReviewFinalized));

        var objective = fixture.Objectives.Single();
        objective.ApplyManualPercentage(85m);
        var relabeledVersion = fixture.Scale.CreateNextVersion(fixture.ScaleVersion.Levels
            .Select(level => level with { Label = $"Updated {level.Label}" }).ToArray());
        db.RatingScaleVersions.Add(relabeledVersion);
        var participant = await db.Participants.SingleAsync(item => item.Id == fixture.Participants[0].Id);
        db.Entry(participant).Property(item => item.JobTitle).CurrentValue = "Renamed role";
        db.Entry(participant).Property(item => item.OrgUnitName).CurrentValue = "Renamed unit";
        await db.SaveChangesAsync();
        Assert.Equal(snapshot, await db.PerformanceReviews.Where(review => review.Id == ready.Id).Select(review => review.FinalizedSnapshotJson).SingleAsync());

        var historical = await new GetPerformanceReviewHandler(db).Handle(
            new GetPerformanceReviewQuery(ready.Id, new ReviewActor(ready.SubjectEmployeeId, false)), default);
        Assert.True(historical.IsSuccess);
        Assert.Equal(2, historical.Value.FinalRating);
        Assert.Equal("Developing", historical.Value.RatingScale.Single(level => level.Value == 2).Label);
        Assert.Contains("Principal Engineer", snapshot);
        Assert.DoesNotContain("Renamed role", snapshot);
        Assert.DoesNotContain("Renamed unit", snapshot);
        Assert.Equal(30m, historical.Value.Items.Single(item => item.Title == "Improve reliability").Progress);

        var otherCycle = CreateFixture(store, reviewCount: 1);
        var otherReview = otherCycle.Reviews[0];
        otherReview.SubmitManagerAssessment(otherReview.ReviewerEmployeeId, "Another cycle", 1, DateTime.UtcNow);
        db.Cycles.Add(otherCycle.Cycle);
        db.Participants.AddRange(otherCycle.Participants);
        db.RatingScales.Add(otherCycle.Scale);
        db.RatingScaleVersions.Add(otherCycle.ScaleVersion);
        db.ReviewRounds.Add(otherCycle.Round);
        db.ReviewRoundSubjects.AddRange(otherCycle.Subjects);
        db.PerformanceReviews.AddRange(otherCycle.Reviews);
        db.EmployeePlans.AddRange(otherCycle.Plans);
        db.Objectives.AddRange(otherCycle.Objectives);
        await db.SaveChangesAsync();
        var otherResult = await new FinalizeReviewRoundHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new(otherCycle.Round.Id, otherCycle.Round.Version, [otherReview.Id]), default);
        Assert.True(otherResult.IsSuccess);
        var history = await new GetReviewHistoryHandler(db).Handle(new(null, Guid.Empty, true, false), default);
        Assert.True(history.IsSuccess);
        Assert.Equal(2, history.Value.Count);
        Assert.Equal(2, history.Value.Select(item => item.CycleId).Distinct().Count());
        Assert.Equal("Developing", history.Value.Single(item => item.ReviewId == ready.Id).FinalRatingLabel);
    }

    [Fact]
    public async Task Review_close_requires_reason_and_the_round_closes_itself_once_nothing_is_open()
    {
        var store = TestStore.ForNewTenant();
        var fixture = CreateFixture(store, reviewCount: 2);
        await using var db = store.NewContext();
        db.Cycles.Add(fixture.Cycle);
        db.Participants.AddRange(fixture.Participants);
        db.RatingScales.Add(fixture.Scale);
        db.RatingScaleVersions.Add(fixture.ScaleVersion);
        db.ReviewRounds.Add(fixture.Round);
        db.ReviewRoundSubjects.AddRange(fixture.Subjects);
        db.PerformanceReviews.AddRange(fixture.Reviews);
        db.EmployeePlans.AddRange(fixture.Plans);
        db.Objectives.AddRange(fixture.Objectives);
        await db.SaveChangesAsync();

        var audit = new TestPerformanceAudit(db);
        var reviewHandler = new CloseReviewHandler(db, audit, new PerformanceNotifications(db));
        var idle = fixture.Reviews[1];
        var staleReviewClose = await reviewHandler.Handle(new(idle.Id, idle.Version + 1, "Round ended by HR."), default);
        Assert.Equal("Performance.Stale", staleReviewClose.Error.Code);
        Assert.Equal(PerformanceReviewState.ManagerAssessment, idle.State);
        var invalid = await reviewHandler.Handle(new(idle.Id, idle.Version, " "), default);
        Assert.True(invalid.IsFailure);
        var closed = await reviewHandler.Handle(new(idle.Id, idle.Version, "Round ended by HR."), default);
        Assert.True(closed.IsSuccess);
        var retried = await reviewHandler.Handle(new(idle.Id, 0, "Different reason"), default);
        Assert.True(retried.IsSuccess);
        Assert.Equal(1, await db.AuditEntries.CountAsync(entry => entry.Action == PerformanceAuditActions.ReviewAdministrativelyClosed));
        // One review still open: the round runs on.
        Assert.Equal(ReviewRoundState.Active, await db.ReviewRounds.Where(r => r.Id == fixture.Round.Id).Select(r => r.State).SingleAsync());

        // Releasing the last one settles the round: it closes by itself, nobody presses Close (D-34).
        var last = fixture.Reviews[0];
        last.SubmitManagerAssessment(last.ReviewerEmployeeId, "Ready", 3, DateTime.UtcNow);
        await db.SaveChangesAsync();
        var released = await new FinalizeReviewRoundHandler(db, audit, new PerformanceNotifications(db))
            .Handle(new(fixture.Round.Id, fixture.Round.Version, null), default);
        Assert.True(released.IsSuccess);
        Assert.Single(released.Value.Finalized);
        Assert.Equal(ReviewRoundState.Closed, released.Value.State);
        Assert.Equal(ReviewRoundState.Closed, await db.ReviewRounds.Where(r => r.Id == fixture.Round.Id).Select(r => r.State).SingleAsync());
        Assert.Equal(1, await db.AuditEntries.CountAsync(entry => entry.Action == PerformanceAuditActions.ReviewRoundClosed));
        var finalizedAfterClose = await new FinalizeReviewRoundHandler(db, audit, new PerformanceNotifications(db))
            .Handle(new(fixture.Round.Id, 0, null), default);
        Assert.True(finalizedAfterClose.IsSuccess);
        Assert.Equal(ReviewRoundState.Closed, finalizedAfterClose.Value.State);
    }

    [Fact]
    public async Task Single_review_finalization_checks_version_and_old_retry_returns_finalized_state()
    {
        var store = TestStore.ForNewTenant();
        var fixture = CreateFixture(store, reviewCount: 1);
        var review = fixture.Reviews[0];
        review.SubmitManagerAssessment(review.ReviewerEmployeeId, "Ready", 3, DateTime.UtcNow);
        await using var db = store.NewContext();
        db.Cycles.Add(fixture.Cycle);
        db.Participants.AddRange(fixture.Participants);
        db.RatingScales.Add(fixture.Scale);
        db.RatingScaleVersions.Add(fixture.ScaleVersion);
        db.ReviewRounds.Add(fixture.Round);
        db.ReviewRoundSubjects.AddRange(fixture.Subjects);
        db.PerformanceReviews.Add(review);
        db.EmployeePlans.AddRange(fixture.Plans);
        db.Objectives.AddRange(fixture.Objectives);
        await db.SaveChangesAsync();
        var handler = new FinalizeReviewHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db));
        var stale = await handler.Handle(new(review.Id, review.Version + 1), default);
        Assert.Equal("Performance.Stale", stale.Error.Code);
        Assert.Equal(PerformanceReviewState.ReadyToFinalize, review.State);
        var finalized = await handler.Handle(new(review.Id, review.Version), default);
        Assert.True(finalized.IsSuccess);
        var retry = await handler.Handle(new(review.Id, 0), default);
        Assert.True(retry.IsSuccess);
        Assert.Equal(finalized.Value, retry.Value);
    }

    [Fact]
    public async Task Reviewer_cannot_cross_the_administrative_finalization_boundary()
    {
        await using var factory = new PerformanceApiFactory();
        using var client = factory.CreateAuthenticatedClient(employeeId: Guid.NewGuid(),
            permissions: [new(PerformancePermissions.CycleView, PermissionScopes.Tenant)]);
        using var response = await client.PostAsJsonAsync($"/api/performance/reviews/{Guid.NewGuid()}/finalize", new { expectedVersion = 0 });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static Fixture CreateFixture(TestStore store, int reviewCount)
    {
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, "FY26", Start, End, Start.AddDays(30)).Activated();
        var round = ReviewRound.CreateDraft(store.TenantId, cycle, "Mid-year", Start, End, false, false, false);
        round.UpdateDraft(cycle, "Mid-year", Start, End, false, false, false, null, End, "[]");
        var scale = RatingScale.CreateDefault(store.TenantId);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var participants = new List<Participant>();
        var subjects = new List<ReviewRoundSubject>();
        var reviews = new List<PerformanceReview>();
        var plans = new List<EmployeePlan>();
        var objectives = new List<Objective>();
        for (var i = 0; i < reviewCount; i++)
        {
            var subjectId = Guid.NewGuid();
            var reviewerId = Guid.NewGuid();
            var participant = Participant.Create(store.TenantId, cycle.Id, subjectId, $"Subject {i}", "Principal Engineer", Guid.NewGuid(), "Product Engineering",
                reviewerId, "Reviewer", false, Start);
            var roundSubject = ReviewRoundSubject.Create(store.TenantId, round.Id, participant, reviewerId, "Reviewer");
            participants.Add(participant);
            subjects.Add(roundSubject);
            reviews.Add(PerformanceReview.Open(store.TenantId, round, roundSubject, version.Id, version.LevelsJson,
                participant.DisplayName, participant.JobTitle, participant.OrgUnitId, participant.OrgUnitName,
                "Reviewer", roundSubject.ReviewerBasis, DateTime.UtcNow));
            if (i == 0)
            {
                var plan = EmployeePlan.Create(store.TenantId, cycle.Id, participant.Id, subjectId, participant.DisplayName, null, reviewerId, "Reviewer");
                plan.Submit(subjectId, new PlanSubmissionFacts(1, true, 100m, false, true, PlanAlignmentPolicy.Optional));
                plan.Approve(reviewerId);
                plans.Add(plan);
                var objective = Objective.CreateEmployee(store.TenantId, cycle.Id, plan.Id, subjectId,
                    "Improve reliability", "Reduce repeat incidents", null, Start, End,
                    ObjectiveMeasurement.ManualPercentage(), 100m, null, null, Start, End);
                objective.ApplyManualPercentage(30m);
                objectives.Add(objective);
            }
        }
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        return new(cycle, round, scale, version, participants, subjects, reviews, plans, objectives);
    }

    private sealed record Fixture(PerformanceCycle Cycle, ReviewRound Round, RatingScale Scale, RatingScaleVersion ScaleVersion,
        IReadOnlyList<Participant> Participants, IReadOnlyList<ReviewRoundSubject> Subjects, IReadOnlyList<PerformanceReview> Reviews,
        IReadOnlyList<EmployeePlan> Plans, IReadOnlyList<Objective> Objectives);
}
