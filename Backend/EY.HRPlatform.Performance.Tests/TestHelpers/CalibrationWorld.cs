using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Calibration;
using EY.HRPlatform.Performance.Features.Reviews;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests.TestHelpers;

/// <summary>A launched calibration round with named people and reviewers, for the slice 5 calibration tests.</summary>
internal static class CalibrationWorld
{
    public sealed record Person(string Name, string Reviewer, Guid? EmployeeId = null, Guid? ReviewerId = null, string? Unit = null);
    public sealed record World(PerformanceCycle Cycle, ReviewRound Round, IReadOnlyList<PerformanceReview> Reviews)
    {
        public ReviewQuestionSnapshot? ManagerQuestion { get; init; }
        public PerformanceReview Of(string name) => Reviews.Single(review => review.SubjectDisplayName == name);
    }

    public static readonly CalibratorIdentity Hr = new(Guid.NewGuid(), null, "Amira Khelifi");

    /// <summary>One id per reviewer name, so a reviewer's reviews group together.</summary>
    public static async Task<World> SeedAsync(PerformanceDbContext db, TestStore store, IReadOnlyList<Person> people, bool potential = true,
        DateOnly? start = null, string cycleName = "FY27", bool selfAssessment = false, string? managerQuestion = null)
    {
        var from = start ?? new DateOnly(2026, 10, 1);
        var to = from.AddYears(1).AddDays(-1);
        var cycle = PerformanceCycle.CreateDraft(store.TenantId, cycleName, from, to, from.AddDays(30)).Activated();
        var round = ReviewRound.CreateDraft(store.TenantId, cycle, "Year-end review", from, to, false, false, true);
        round.UpdateDraft(cycle, "Year-end review", from, to,
            new ReviewRoundComponents(selfAssessment, false, false, managerQuestion is not null, potential, true),
            new ReviewRoundDueDates(selfAssessment ? to.AddDays(-7) : null, null, to), "[]", from);
        var question = managerQuestion is null ? null : ReviewQuestion.Create(store.TenantId, managerQuestion, ReviewQuestionAudience.Manager, 0);
        if (question is not null) round.SetQuestions([question]);
        var scale = await db.RatingScales.FirstOrDefaultAsync() ?? RatingScale.CreateDefault(store.TenantId);
        var version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
        var reviewerIds = new Dictionary<string, Guid>();
        var participants = new List<Participant>();
        var subjects = new List<ReviewRoundSubject>();
        var reviews = new List<PerformanceReview>();
        foreach (var person in people)
        {
            var reviewerId = person.ReviewerId ?? (reviewerIds.TryGetValue(person.Reviewer, out var known) ? known : Guid.NewGuid());
            reviewerIds[person.Reviewer] = reviewerId;
            var participant = Participant.Create(store.TenantId, cycle.Id, person.EmployeeId ?? Guid.NewGuid(), person.Name, "Consultant",
                Guid.NewGuid(), person.Unit ?? "Consulting", reviewerId, person.Reviewer, false, from);
            var subject = ReviewRoundSubject.Create(store.TenantId, round.Id, participant, reviewerId, person.Reviewer);
            participants.Add(participant);
            subjects.Add(subject);
            reviews.Add(PerformanceReview.Open(store.TenantId, round, subject, version.Id, version.LevelsJson,
                person.Name, "Consultant", participant.OrgUnitId, person.Unit ?? "Consulting", person.Reviewer, subject.ReviewerBasis, DateTime.UtcNow));
        }
        round.Launch("{\"competencies\":[]}", version.Id, DateTime.UtcNow);
        var snapshot = question is null ? null : ReviewQuestionSnapshot.Create(round, round.Questions.Single(), question);
        if (question is not null) db.AddRange(question, snapshot!);
        db.Cycles.Add(cycle);
        db.Participants.AddRange(participants);
        if (db.Entry(scale).State == EntityState.Detached) db.RatingScales.Add(scale);
        db.RatingScaleVersions.Add(version);
        db.ReviewRounds.Add(round);
        db.ReviewRoundSubjects.AddRange(subjects);
        db.PerformanceReviews.AddRange(reviews);
        await db.SaveChangesAsync();
        return new(cycle, round, reviews) { ManagerQuestion = snapshot };
    }

    public static async Task SubmitManagerAsync(PerformanceDbContext db, PerformanceReview review, int rating,
        ReviewPotential? potential = ReviewPotential.Growing, string summary = "A strong year with clear delivery.")
    {
        var current = await db.PerformanceReviews.AsNoTracking().SingleAsync(item => item.Id == review.Id);
        var result = await new SubmitManagerAssessmentHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new SubmitManagerAssessmentCommand(review.Id, new ReviewActor(review.ReviewerEmployeeId, false, CanReviewReports: true),
                current.Version, summary, rating) { Potential = current.PotentialEnabled ? potential : null }, default);
        Assert.True(result.IsSuccess, result.IsSuccess ? null : result.Error.Message);
    }

    /// <summary>An approved plan for the review's person with weighted objectives at the given progress.</summary>
    public static async Task PlanAsync(PerformanceDbContext db, World world, PerformanceReview review, params (string Title, decimal Weight, decimal Progress)[] objectives)
    {
        var cycle = world.Cycle;
        var plan = EmployeePlan.Create(review.TenantId, cycle.Id, Guid.NewGuid(), review.SubjectEmployeeId, review.SubjectDisplayName,
            "Consulting", review.ReviewerEmployeeId, review.ReviewerDisplayName);
        var created = objectives.Select(item => Objective.CreateEmployee(review.TenantId, cycle.Id, plan.Id, review.SubjectEmployeeId, item.Title, null,
            null, cycle.StartDate, cycle.EndDate, ObjectiveMeasurement.ManualPercentage(), item.Weight, null, null, cycle.StartDate, cycle.EndDate)).ToArray();
        plan.Submit(review.SubjectEmployeeId, new PlanSubmissionFacts(created.Length, true, 100m, true, false, PlanAlignmentPolicy.AtLeastOneConnected));
        plan.Approve(review.ReviewerEmployeeId);
        foreach (var (objective, item) in created.Zip(objectives)) objective.ApplyManualPercentage(item.Progress);
        db.EmployeePlans.Add(plan);
        db.Objectives.AddRange(created);
        await db.SaveChangesAsync();
    }

    /// <summary>A released result for the same person in an earlier cycle.</summary>
    public static async Task ReleasedEarlierAsync(PerformanceDbContext db, TestStore store, PerformanceReview review, int rating)
    {
        var earlier = await SeedAsync(db, store, [new(review.SubjectDisplayName, review.ReviewerDisplayName, review.SubjectEmployeeId, review.ReviewerEmployeeId)],
            potential: false, start: new DateOnly(2025, 10, 1), cycleName: "FY26");
        var old = await db.PerformanceReviews.SingleAsync(item => item.Id == earlier.Reviews[0].Id);
        old.SubmitManagerAssessment(old.ReviewerEmployeeId, "Last year.", rating, DateTime.UtcNow.AddYears(-1));
        old.CompleteCalibration(rating, false);
        old.Finalize("{}", rating, FinalRatingSources.Manager, DateTime.UtcNow.AddYears(-1));
        await db.SaveChangesAsync();
    }

    /// <summary>Keeps (the manager's level, no reason) or changes a rating, at the subject's current version.</summary>
    public static async Task<Result<CalibrationSubjectDto>> DecideAsync(PerformanceDbContext db, World world, PerformanceReview review,
        int rating, string? reason = null, CalibratorIdentity? actor = null)
    {
        var version = await db.CalibrationSubjects.AsNoTracking().Where(subject => subject.ReviewId == review.Id)
            .Select(subject => (uint?)subject.Version).SingleOrDefaultAsync() ?? 0;
        return await new DecideCalibrationHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new(world.Round.Id, review.Id, actor ?? Hr, rating, reason, version, true), default);
    }

    public static Task<Result<CalibrationDto>> ReadAsync(PerformanceDbContext db, World world, CalibratorIdentity? actor = null)
        => new GetCalibrationHandler(db).Handle(new(world.Round.Id, actor ?? Hr, true, true), default);

    /// <summary>Releases what is ready in the round, as the Year page does.</summary>
    public static async Task<Result<ReviewRoundFinalizationDto>> ReleaseAsync(PerformanceDbContext db, World world)
    {
        var version = await db.ReviewRounds.AsNoTracking().Where(round => round.Id == world.Round.Id).Select(round => round.Version).SingleAsync();
        return await new FinalizeReviewRoundHandler(db, new TestPerformanceAudit(db), new PerformanceNotifications(db))
            .Handle(new(world.Round.Id, version, null), default);
    }
}
