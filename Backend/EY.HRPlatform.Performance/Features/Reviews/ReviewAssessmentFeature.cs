using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Calibration;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;


namespace EY.HRPlatform.Performance.Features.Reviews;

/// <summary>One side's input: the summary and overall rating, item responses, answers, and potential (manager side).</summary>
public sealed record AssessmentInput(string Summary, int? OverallRating, IReadOnlyList<ReviewItemResponseInput>? Items = null,
    IReadOnlyList<ReviewAnswerInput>? Answers = null, ReviewPotential? Potential = null);

public sealed record SaveSelfAssessmentCommand(Guid ReviewId, ReviewActor Actor, uint ExpectedVersion, string Summary, IReadOnlyList<ReviewItemResponseInput>? Items = null)
    : ICommand<Result<PerformanceReviewMutationDto>>
{
    public int? OverallRating { get; init; }
    public IReadOnlyList<ReviewAnswerInput>? Answers { get; init; }
}
public sealed record SubmitSelfAssessmentCommand(Guid ReviewId, ReviewActor Actor, uint ExpectedVersion, string Summary, IReadOnlyList<ReviewItemResponseInput>? Items = null)
    : ICommand<Result<PerformanceReviewMutationDto>>
{
    public int? OverallRating { get; init; }
    public IReadOnlyList<ReviewAnswerInput>? Answers { get; init; }
}
public sealed record SaveManagerAssessmentCommand(Guid ReviewId, ReviewActor Actor, uint ExpectedVersion, string Summary, int? OverallRating, IReadOnlyList<ReviewItemResponseInput>? Items = null)
    : ICommand<Result<PerformanceReviewMutationDto>>
{
    public ReviewPotential? Potential { get; init; }
    public IReadOnlyList<ReviewAnswerInput>? Answers { get; init; }
}
public sealed record SubmitManagerAssessmentCommand(Guid ReviewId, ReviewActor Actor, uint ExpectedVersion, string Summary, int? OverallRating, IReadOnlyList<ReviewItemResponseInput>? Items = null)
    : ICommand<Result<PerformanceReviewMutationDto>>
{
    public ReviewPotential? Potential { get; init; }
    public IReadOnlyList<ReviewAnswerInput>? Answers { get; init; }
}

public sealed record PerformanceReviewMutationDto(Guid Id, PerformanceReviewState State, DateOnly? DueDate, uint Version);

internal static class ReviewAssessmentCommands
{
    public static async Task<PerformanceReview?> LoadAsync(PerformanceDbContext db, Guid id, CancellationToken token)
        => await db.PerformanceReviews.Include(review => review.ItemResponses).Include(review => review.Answers)
            .FirstOrDefaultAsync(review => review.Id == id, token);

    public static PerformanceReviewMutationDto ToDto(PerformanceReview review)
        => new(review.Id, review.State, review.CurrentStageDueDate, review.Version);

    public static async Task<Result<PerformanceReviewMutationDto>> SaveAsync(
        PerformanceDbContext db, PerformanceReview review, uint expectedVersion, AssessmentInput input,
        ReviewActor actor, bool self, IPerformanceAudit audit, CancellationToken token)
    {
        if (!(self ? ReviewPolicy.CanSelfAssess(actor, review) : ReviewPolicy.CanManagerAssess(actor, review)))
            return Forbidden();
        if (VersionGuard.Check(review, expectedVersion) is { } stale) return Result.Failure<PerformanceReviewMutationDto>(stale);
        try
        {
            var itemError = await ApplyItemsAsync(db, review, input.Items, self, token);
            if (itemError is not null) return Result.Failure<PerformanceReviewMutationDto>(itemError);
            var answerError = await ApplyAnswersAsync(db, review, input.Answers, self, token);
            if (answerError is not null) return Result.Failure<PerformanceReviewMutationDto>(answerError);
            if (self) review.SaveSelfAssessment(actor.EmployeeId, input.Summary, PerformanceClock.UtcNow, input.OverallRating);
            else review.SaveManagerAssessment(actor.EmployeeId, input.Summary, input.OverallRating, PerformanceClock.UtcNow, input.Potential);
            audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId,
                self ? PerformanceAuditActions.ReviewSelfAssessmentSaved : PerformanceAuditActions.ReviewManagerAssessmentSaved,
                new { before = new { state = review.State.ToString() }, after = new { state = review.State.ToString(), summaryLength = input.Summary?.Length ?? 0, overallRating = self ? null : input.OverallRating } });
            await db.SaveChangesAsync(token);
            return Result.Success(ToDto(review));
        }
        catch (ArgumentException ex) { return Invalid(ex.Message); }
        catch (InvalidOperationException ex) { return InvalidState(ex.Message); }
        catch (UnauthorizedAccessException) { return Forbidden(); }
    }

    public static async Task<Result<PerformanceReviewMutationDto>> SubmitAsync(
        PerformanceDbContext db, PerformanceReview review, uint expectedVersion, AssessmentInput input,
        ReviewActor actor, bool self, IPerformanceAudit audit, IPerformanceNotifications notifications, CancellationToken token)
    {
        var alreadySubmitted = self ? review.SelfAssessment.IsSubmitted : review.ManagerAssessment.IsSubmitted;
        var authorized = self
            ? ReviewPolicy.CanSelfAssess(actor, review, allowSubmittedRetry: alreadySubmitted)
            : ReviewPolicy.CanManagerAssess(actor, review, allowSubmittedRetry: alreadySubmitted);
        if (!authorized) return Forbidden();
        if (!alreadySubmitted && VersionGuard.Check(review, expectedVersion) is { } stale)
            return Result.Failure<PerformanceReviewMutationDto>(stale);
        try
        {
            if (!alreadySubmitted)
            {
                var itemError = await ApplyItemsAsync(db, review, input.Items, self, token);
                if (itemError is not null) return Result.Failure<PerformanceReviewMutationDto>(itemError);
                var answerError = await ApplyAnswersAsync(db, review, input.Answers, self, token);
                if (answerError is not null) return Result.Failure<PerformanceReviewMutationDto>(answerError);
                var missing = await MissingAsync(db, review, input, self, token);
                if (missing is not null)
                    return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid,
                        MissingMessage(missing), missing));
            }
            var changed = self
                ? review.SubmitSelfAssessment(actor.EmployeeId, input.Summary, input.OverallRating, PerformanceClock.UtcNow)
                : review.SubmitManagerAssessment(actor.EmployeeId, input.Summary, input.OverallRating, PerformanceClock.UtcNow, input.Potential);
            if (!changed) return Result.Success(ToDto(review));
            audit.Record(review.TenantId, "PerformanceReview", review.Id, review.CycleId,
                self ? PerformanceAuditActions.ReviewSelfAssessmentSubmitted : PerformanceAuditActions.ReviewManagerAssessmentSubmitted,
                new { before = new { state = self ? PerformanceReviewState.SelfAssessment.ToString() : PerformanceReviewState.ManagerAssessment.ToString() }, after = new { state = review.State.ToString(), overallRating = self ? null : input.OverallRating } });
            if (self)
            {
                var round = await db.ReviewRounds.AsNoTracking().SingleAsync(item => item.Id == review.ReviewRoundId, token);
                notifications.EnqueueReview(review, PerformanceNotificationKind.SelfAssessmentSubmitted, round.Name);
            }
            else
            {
                // Peer input closes with the manager assessment, in the same transaction (D3).
                await PeerRequestClosure.CloseOpenAsync(db, review.Id, PerformanceClock.UtcNow, token);
                await CalibrationSessions.JoinAsync(db, review, token);
            }
            await db.SaveChangesAsync(token);
            // Once the round's results are out, a review that arrives ready goes out by itself (D-35).
            if (!self) await CalibrationRelease.ReleaseIfDueAsync(db, review.Id, audit, notifications, token);
            return Result.Success(ToDto(review));
        }
        catch (ArgumentException ex) { return Invalid(ex.Message); }
        catch (InvalidOperationException ex) { return InvalidState(ex.Message); }
        catch (UnauthorizedAccessException) { return Forbidden(); }
    }

    private static string MissingMessage(ReviewMissingDto missing)
    {
        var parts = new List<string>();
        if (missing.Items.Count > 0) parts.Add(missing.Items.Count == 1 ? "1 rating" : $"{missing.Items.Count} ratings");
        if (missing.Questions.Count > 0) parts.Add(missing.Questions.Count == 1 ? "1 question" : $"{missing.Questions.Count} questions");
        if (missing.OverallRating) parts.Add("the overall rating");
        if (missing.Potential) parts.Add("potential");
        if (missing.Summary) parts.Add("the summary");
        return $"Complete {string.Join(", ", parts)} before submitting.";
    }

    private static Result<PerformanceReviewMutationDto> Forbidden()
        => Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.ReviewAssessmentForbidden,
            "You do not have authority to assess this review."));

    private static Result<PerformanceReviewMutationDto> Invalid(string message)
        => Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, message));
    private static Result<PerformanceReviewMutationDto> InvalidState(string message)
        => Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewAssessmentInvalid, message));

    /// <summary>The review's items: approved-plan objectives and the round's snapshotted competencies.</summary>
    private static async Task<HashSet<(ReviewItemKind Kind, Guid Id)>> ExpectedItemsAsync(PerformanceDbContext db, PerformanceReview review, CancellationToken token)
    {
        var competencyIds = new HashSet<Guid>();
        var round = await db.ReviewRounds.AsNoTracking().SingleAsync(item => item.Id == review.ReviewRoundId, token);
        if (!string.IsNullOrWhiteSpace(round.ConfigSnapshotJson))
        {
            try
            {
                using var snapshot = System.Text.Json.JsonDocument.Parse(round.ConfigSnapshotJson);
                if (snapshot.RootElement.TryGetProperty("competencies", out var values))
                    foreach (var competency in values.EnumerateArray())
                        if (competency.TryGetProperty("id", out var id) && id.TryGetGuid(out var value)) competencyIds.Add(value);
            }
            catch (System.Text.Json.JsonException) { }
        }
        var plan = await db.EmployeePlans.AsNoTracking().FirstOrDefaultAsync(item => item.CycleId == review.CycleId
            && item.EmployeeId == review.SubjectEmployeeId && item.State == PlanLifecycleState.Approved, token);
        var objectiveIds = plan is null ? new HashSet<Guid>() : (await db.Objectives.AsNoTracking()
            .Where(item => item.EmployeePlanId == plan.Id && item.State != ObjectiveLifecycleState.Archived)
            .Select(item => item.Id).ToListAsync(token)).ToHashSet();
        return competencyIds.Select(id => (ReviewItemKind.Competency, id))
            .Concat(objectiveIds.Select(id => (ReviewItemKind.Objective, id))).ToHashSet();
    }

    private static async Task<EY.HRPlatform.SharedKernel.Results.Error?> ApplyItemsAsync(PerformanceDbContext db,
        PerformanceReview review, IReadOnlyList<ReviewItemResponseInput>? inputs, bool self, CancellationToken token)
    {
        inputs ??= [];
        if (inputs.Select(item => (item.Kind, item.ItemId)).Distinct().Count() != inputs.Count)
            return PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, "Each review item can be submitted only once.");
        var expected = await ExpectedItemsAsync(db, review, token);
        if (inputs.Any(item => !expected.Contains((item.Kind, item.ItemId))))
            return PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, "An assessment contains an item that is not part of this review.");
        var levels = System.Text.Json.JsonSerializer.Deserialize<RatingScaleLevel[]>(review.RatingScaleSnapshotJson) ?? [];
        if (inputs.Any(item => item.Kind == ReviewItemKind.Competency && item.Rating is int value && !levels.Any(level => level.Value == value)))
            return PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, "Every item rating must be a level on this review's snapshotted scale.");

        foreach (var key in expected)
            if (!review.ItemResponses.Any(item => item.Kind == key.Item1 && item.ItemId == key.Item2))
            {
                var response = ReviewItemResponse.Create(review.TenantId, review.Id, key.Item1, key.Item2);
                review.AddItemResponse(response);
                db.ReviewItemResponses.Add(response);
            }
        foreach (var input in inputs)
        {
            var response = review.ItemResponses.Single(item => item.Kind == input.Kind && item.ItemId == input.ItemId);
            // A goal is graded from its measure, never rated by hand (D-38); only a changed grade and its reason are kept.
            if (input.Kind == ReviewItemKind.Objective)
            {
                response.SetGrade(self, input.Grade, input.GradeReason);
                continue;
            }
            if (self) response.SaveSelf(input.Reflection, input.Rating, input.Comment);
            else response.SaveManager(input.Assessment, input.Rating);
        }
        return null;
    }

    /// <summary>The side's questions: the round's frozen person questions for the self side, manager questions for the reviewer.</summary>
    public static async Task<IReadOnlyList<ReviewQuestionSnapshot>> QuestionsAsync(PerformanceDbContext db, PerformanceReview review, bool self,
        CancellationToken token)
    {
        if (!review.QuestionsEnabled) return [];
        var audience = self ? ReviewQuestionAudience.Person : ReviewQuestionAudience.Manager;
        return await db.ReviewQuestionSnapshots.AsNoTracking()
            .Where(q => q.ReviewRoundId == review.ReviewRoundId && q.Audience == audience).OrderBy(q => q.SortOrder).ToListAsync(token);
    }

    private static async Task<EY.HRPlatform.SharedKernel.Results.Error?> ApplyAnswersAsync(PerformanceDbContext db,
        PerformanceReview review, IReadOnlyList<ReviewAnswerInput>? answers, bool self, CancellationToken token)
    {
        if (answers is null || answers.Count == 0) return null;
        if (answers.Select(a => a.QuestionId).Distinct().Count() != answers.Count)
            return PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, "Answer each question once.");
        var questions = (await QuestionsAsync(db, review, self, token)).Select(q => q.Id).ToHashSet();
        if (answers.Any(a => !questions.Contains(a.QuestionId)))
            return PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewAssessmentInvalid, "An answer is for a question this review doesn't ask you.");
        var author = self ? ReviewQuestionAuthor.Self : ReviewQuestionAuthor.Manager;
        foreach (var answer in answers)
        {
            var before = review.Answers.Select(a => a.Id).ToHashSet();
            review.SetAnswer(author, answer.QuestionId, answer.Text, answer.Citations);
            foreach (var added in review.Answers.Where(a => !before.Contains(a.Id))) db.ReviewQuestionAnswers.Add(added);
        }
        // Answers the person cleared are removed from the review; delete their rows too.
        foreach (var entry in db.ChangeTracker.Entries<ReviewQuestionAnswer>()
                     .Where(e => e.Entity.ReviewId == review.Id && e.State == EntityState.Unchanged && !review.Answers.Contains(e.Entity)).ToList())
            entry.State = EntityState.Deleted;
        return null;
    }

    /// <summary>Everything a submit still lacks: each enabled rating, every answer, the overall rating, potential and the summary.</summary>
    private static async Task<ReviewMissingDto?> MissingAsync(PerformanceDbContext db, PerformanceReview review, AssessmentInput input,
        bool self, CancellationToken token)
    {
        var expected = await ExpectedItemsAsync(db, review, token);
        var items = expected.Where(key =>
        {
            var response = review.ItemResponses.FirstOrDefault(item => item.Kind == key.Kind && item.ItemId == key.Id);
            var rating = self ? response?.SelfRating : response?.ManagerRating;
            return key.Kind == ReviewItemKind.Competency && rating is null;
        }).Select(key => new ReviewMissingItemDto(key.Kind, key.Id)).ToArray();
        var author = self ? ReviewQuestionAuthor.Self : ReviewQuestionAuthor.Manager;
        var questions = (await QuestionsAsync(db, review, self, token))
            .Where(q => !review.Answers.Any(a => a.Author == author && a.QuestionSnapshotId == q.Id)).Select(q => q.Id).ToArray();
        // The words are the round's questions; a round without questions still asks for a summary.
        var summary = string.IsNullOrWhiteSpace(input.Summary) && (await QuestionsAsync(db, review, self, token)).Count == 0;
        var overall = input.OverallRating is null;
        var potential = !self && review.PotentialEnabled && input.Potential is null;
        return items.Length == 0 && questions.Length == 0 && !summary && !overall && !potential
            ? null : new ReviewMissingDto(items, questions, summary, overall, potential);
    }
}

/// <summary>Closes a review's unanswered peer requests when it leaves manager assessment or closes (D3).</summary>
internal static class PeerRequestClosure
{
    public static async Task CloseOpenAsync(PerformanceDbContext db, Guid reviewId, DateTime at, CancellationToken token)
    {
        foreach (var request in await db.PeerRequests.Where(r => r.ReviewId == reviewId && r.State == PeerRequestState.Open).ToListAsync(token))
            request.Close(at);
    }
}

public sealed class SaveSelfAssessmentHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<SaveSelfAssessmentCommand, Result<PerformanceReviewMutationDto>>
{
    public async Task<Result<PerformanceReviewMutationDto>> Handle(SaveSelfAssessmentCommand command, CancellationToken token)
    {
        var review = await ReviewAssessmentCommands.LoadAsync(db, command.ReviewId, token);
        if (review is null) return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        return await ReviewAssessmentCommands.SaveAsync(db, review, command.ExpectedVersion,
            new(command.Summary, command.OverallRating, command.Items, command.Answers), command.Actor, true, audit, token);
    }
}

public sealed class SubmitSelfAssessmentHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<SubmitSelfAssessmentCommand, Result<PerformanceReviewMutationDto>>
{
    public async Task<Result<PerformanceReviewMutationDto>> Handle(SubmitSelfAssessmentCommand command, CancellationToken token)
    {
        var review = await ReviewAssessmentCommands.LoadAsync(db, command.ReviewId, token);
        if (review is null) return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        return await ReviewAssessmentCommands.SubmitAsync(db, review, command.ExpectedVersion,
            new(command.Summary, command.OverallRating, command.Items, command.Answers), command.Actor, true, audit, notifications, token);
    }
}

public sealed class SaveManagerAssessmentHandler(PerformanceDbContext db, IPerformanceAudit audit)
    : ICommandHandler<SaveManagerAssessmentCommand, Result<PerformanceReviewMutationDto>>
{
    public async Task<Result<PerformanceReviewMutationDto>> Handle(SaveManagerAssessmentCommand command, CancellationToken token)
    {
        var review = await ReviewAssessmentCommands.LoadAsync(db, command.ReviewId, token);
        if (review is null) return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        return await ReviewAssessmentCommands.SaveAsync(db, review, command.ExpectedVersion,
            new(command.Summary, command.OverallRating, command.Items, command.Answers, command.Potential), command.Actor, false, audit, token);
    }
}

public sealed class SubmitManagerAssessmentHandler(PerformanceDbContext db, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<SubmitManagerAssessmentCommand, Result<PerformanceReviewMutationDto>>
{
    public async Task<Result<PerformanceReviewMutationDto>> Handle(SubmitManagerAssessmentCommand command, CancellationToken token)
    {
        var review = await ReviewAssessmentCommands.LoadAsync(db, command.ReviewId, token);
        if (review is null) return Result.Failure<PerformanceReviewMutationDto>(PerformanceErrors.NotFound("PerformanceReview", command.ReviewId));
        return await ReviewAssessmentCommands.SubmitAsync(db, review, command.ExpectedVersion,
            new(command.Summary, command.OverallRating, command.Items, command.Answers, command.Potential), command.Actor, false, audit, notifications, token);
    }
}
