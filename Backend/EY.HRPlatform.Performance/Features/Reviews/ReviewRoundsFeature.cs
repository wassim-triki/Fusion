using System.Text.Json;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Models;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.Reviews;

public sealed record ListReviewRoundsQuery(Guid CycleId) : IQuery<Result<IReadOnlyList<ReviewRoundSummaryDto>>>;
public sealed record CreateReviewRoundCommand(Guid CycleId, CreateReviewRoundRequest Request) : ICommand<Result<ReviewRoundDto>>;
public sealed record GetReviewRoundQuery(Guid RoundId) : IQuery<Result<ReviewRoundDto>>;
public sealed record GetEligibleReviewersQuery(Guid RoundId) : IQuery<Result<IReadOnlyList<EligibleReviewerDto>>>;
public sealed record UpdateReviewRoundCommand(Guid RoundId, UpdateReviewRoundRequest Request) : ICommand<Result<ReviewRoundDto>>;
public sealed record GetReviewRoundPopulationQuery(Guid RoundId) : IQuery<Result<IReadOnlyList<ReviewRoundSubjectDto>>>;
public sealed record UpdateReviewRoundPopulationCommand(Guid RoundId, UpdateReviewRoundPopulationRequest Request) : ICommand<Result<IReadOnlyList<ReviewRoundSubjectDto>>>;
public sealed record LaunchReviewRoundCommand(Guid RoundId, uint ExpectedVersion) : ICommand<Result<ReviewRoundLaunchDto>>;
public sealed record GetReviewRoundStatusQuery(Guid RoundId, Guid ViewerEmployeeId = default) : IQuery<Result<ReviewRoundStatusDto>>;
public sealed record GetReviewWorkQuery(Guid CycleId, Guid EmployeeId, bool IsAdmin, bool CanReviewReports) : IQuery<Result<IReadOnlyList<ReviewWorkItemDto>>>;
public sealed record GetReviewHistoryQuery(Guid? CycleId, Guid EmployeeId, bool IsAdmin, bool CanReviewReports) : IQuery<Result<IReadOnlyList<ReviewHistoryItemDto>>>;

public sealed record ReviewRoundLaunchDto(Guid ReviewRoundId, ReviewRoundState State, int ReviewCount, IReadOnlyList<Guid> ReviewIds);
public sealed record EligibleReviewerDto(Guid EmployeeId, string DisplayName, string? JobTitle, string? OrgUnitName);
public sealed record ReviewStageCountDto(PerformanceReviewState State, int Count);
public sealed record ReviewRoundStatusDto(Guid ReviewRoundId, ReviewRoundState State,
    IReadOnlyList<ReviewStageCountDto> StageCounts, int OverdueSelfAssessments, int OverdueManagerAssessments,
    int ReadyToFinalizeCount, ReviewCompletionDto SelfAssessments, ReviewCompletionDto ManagerAssessments,
    IReadOnlyList<ReviewRatingCountDto> RatingDistribution);
/// <summary>Submitted out of the reviews that need this assessment (closed reviews and disabled stages need none).</summary>
public sealed record ReviewCompletionDto(int Submitted, int Required);
/// <summary>
/// Reviews at one rating level: the final rating once calibration or finalization set it, otherwise the
/// submitted manager rating. Round administrators only; the ids are the drill-through they may open.
/// </summary>
public sealed record ReviewRatingCountDto(int Value, string Label, int Count, IReadOnlyList<ReviewRatingSubjectDto> Reviews);
public sealed record ReviewRatingSubjectDto(Guid ReviewId, string SubjectDisplayName);
public sealed record ReviewWorkItemDto(Guid ReviewId, Guid ReviewRoundId, Guid CycleId, string ReviewRoundName,
    string SubjectDisplayName, string ReviewerDisplayName, PerformanceReviewState State, DateOnly? DueDate,
    bool IsSubject, bool IsReviewer, bool IsAssignedToCaller);
public sealed record ReviewHistoryItemDto(Guid ReviewId, Guid ReviewRoundId, Guid CycleId, string CycleName, string ReviewRoundName,
    string SubjectDisplayName, string ReviewerDisplayName, int? FinalRating, string? FinalRatingLabel, DateTime? FinalizedAt);

internal static class ReviewRoundProjection
{
    public static ReviewRoundSummaryDto Summary(ReviewRound round, IReadOnlyList<ReviewRoundSubject> subjects)
        => new(round.Id, round.CycleId, round.Name, round.PeriodStart, round.PeriodEnd, round.State,
            subjects.Count, subjects.Count(s => s.IsExcluded), round.Version);

    public static ReviewRoundDto Detail(ReviewRound round, IReadOnlyList<ReviewRoundSubject> subjects,
        IReadOnlyDictionary<Guid, IReadOnlyList<ReviewReadinessIssueDto>> issues)
        => new(round.Id, round.CycleId, round.Name, round.PeriodStart, round.PeriodEnd,
            round.SelfAssessmentEnabled, round.ObjectiveRatingsEnabled, round.CalibrationEnabled,
            round.SelfAssessmentDueDate, round.ManagerAssessmentDueDate,
            JsonSerializer.Deserialize<IReadOnlyList<Guid>>(round.CompetencyIdsJson) ?? [],
            round.State, round.Version, Subjects(subjects, issues));

    public static IReadOnlyList<ReviewRoundSubjectDto> Subjects(IReadOnlyList<ReviewRoundSubject> subjects,
        IReadOnlyDictionary<Guid, IReadOnlyList<ReviewReadinessIssueDto>>? issues = null)
        => subjects.OrderBy(s => s.SubjectDisplayName, StringComparer.OrdinalIgnoreCase)
            .Select(s => new ReviewRoundSubjectDto(s.ParticipantId, s.SubjectEmployeeId, s.SubjectDisplayName,
                s.ReviewerEmployeeId, s.ReviewerDisplayName, s.ReviewerBasis, s.IsExcluded, s.ExclusionReason,
                issues?.GetValueOrDefault(s.ParticipantId) ?? []))
            .ToList();
}

internal static class ReviewReadinessResolver
{
    public sealed record Resolution(
        Dictionary<Guid, IReadOnlyList<ReviewReadinessIssueDto>> Issues,
        IReadOnlyDictionary<Guid, WorkforceSnapshot> People);

    public static async Task<Resolution> ResolveAsync(
        IReadOnlyList<ReviewRoundSubject> subjects, ICoreWorkforceClient workforce, DateTime asOf, CancellationToken cancellationToken)
    {
        var ids = subjects.SelectMany(s => s.ReviewerEmployeeId is Guid reviewer
            ? new[] { s.SubjectEmployeeId, reviewer } : new[] { s.SubjectEmployeeId }).Distinct().ToArray();
        var people = await workforce.ResolveAsync(asOf, ids, cancellationToken);
        var byId = people.ToDictionary(p => p.EmployeeId);
        var issues = new Dictionary<Guid, IReadOnlyList<ReviewReadinessIssueDto>>();
        foreach (var subject in subjects)
        {
            if (subject.IsExcluded) { issues[subject.ParticipantId] = []; continue; }
            var found = new List<ReviewReadinessIssueDto>();
            if (!byId.TryGetValue(subject.SubjectEmployeeId, out var employee) || !employee.IsActive)
                found.Add(new("InactiveSubject", subject.SubjectEmployeeId, subject.ReviewerEmployeeId));
            if (subject.ReviewerEmployeeId is null)
                found.Add(new("MissingReviewer", subject.SubjectEmployeeId, null));
            else if (subject.ReviewerEmployeeId == subject.SubjectEmployeeId)
                found.Add(new("SelfReview", subject.SubjectEmployeeId, subject.ReviewerEmployeeId));
            else if (!byId.TryGetValue(subject.ReviewerEmployeeId.Value, out var reviewer) || !reviewer.IsActive)
                found.Add(new("InactiveReviewer", subject.SubjectEmployeeId, subject.ReviewerEmployeeId));
            issues[subject.ParticipantId] = found;
        }
        return new Resolution(issues, byId);
    }
}

public sealed class ListReviewRoundsHandler(PerformanceDbContext db)
    : IQueryHandler<ListReviewRoundsQuery, Result<IReadOnlyList<ReviewRoundSummaryDto>>>
{
    public async Task<Result<IReadOnlyList<ReviewRoundSummaryDto>>> Handle(ListReviewRoundsQuery request, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.AsNoTracking().FirstOrDefaultAsync(c => c.Id == request.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<IReadOnlyList<ReviewRoundSummaryDto>>(PerformanceErrors.NotFound("Cycle", request.CycleId));
        var rounds = await db.ReviewRounds.AsNoTracking().Where(r => r.CycleId == cycle.Id).OrderBy(r => r.PeriodStart).ToListAsync(cancellationToken);
        var ids = rounds.Select(r => r.Id).ToArray();
        var subjects = await db.ReviewRoundSubjects.AsNoTracking().Where(s => ids.Contains(s.ReviewRoundId)).ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ReviewRoundSummaryDto>>(rounds.Select(r => ReviewRoundProjection.Summary(r, subjects.Where(s => s.ReviewRoundId == r.Id).ToList())).ToList());
    }
}

public sealed class CreateReviewRoundHandler(PerformanceDbContext db, ITenantContext tenant, IPerformanceAudit audit, ICoreWorkforceClient workforce)
    : ICommandHandler<CreateReviewRoundCommand, Result<ReviewRoundDto>>
{
    public async Task<Result<ReviewRoundDto>> Handle(CreateReviewRoundCommand command, CancellationToken cancellationToken)
    {
        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == command.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<ReviewRoundDto>(PerformanceErrors.NotFound("Cycle", command.CycleId));
        var settings = await db.CycleSettings.FirstOrDefaultAsync(cancellationToken);
        var createdSettings = settings is null;
        settings ??= CycleSettings.CreateDefault(tenant.TenantId);
        if (createdSettings) db.CycleSettings.Add(settings);

        ReviewRound round;
        try
        {
            round = ReviewRound.CreateDraft(tenant.TenantId, cycle, command.Request.Name,
                command.Request.PeriodStart, command.Request.PeriodEnd, settings);
        }
        catch (InvalidOperationException ex)
        {
            return Result.Failure<ReviewRoundDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundCycleNotActive, ex.Message));
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<ReviewRoundDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundInvalid, ex.Message));
        }

        var participants = await db.Participants.AsNoTracking().Where(p => p.CycleId == cycle.Id).ToListAsync(cancellationToken);
        var participantIds = participants.Select(p => p.Id).ToArray();
        var plans = await db.EmployeePlans.AsNoTracking().Where(p => p.CycleId == cycle.Id && participantIds.Contains(p.ParticipantId)).ToDictionaryAsync(p => p.ParticipantId, cancellationToken);
        var rows = participants.Select(p =>
        {
            plans.TryGetValue(p.Id, out var plan);
            var reviewerId = plan?.ResponsibleManagerId ?? p.ManagerEmployeeId;
            var reviewerName = plan?.ResponsibleManagerName ?? p.ManagerDisplayName;
            return ReviewRoundSubject.Create(tenant.TenantId, round.Id, p, reviewerId, reviewerName);
        }).ToList();
        db.ReviewRounds.Add(round);
        db.ReviewRoundSubjects.AddRange(rows);
        audit.Record(tenant.TenantId, "ReviewRound", round.Id, cycle.Id, PerformanceAuditActions.ReviewRoundCreated,
            new { round.Name, round.PeriodStart, round.PeriodEnd, subjectCount = rows.Count });
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(await ReviewRoundReads.ComposeAsync(db, workforce, round, rows, cancellationToken, tolerateCore: true));
    }
}

/// <summary>Loads and composes a round for its page; a Draft's readiness needs Core.</summary>
internal static class ReviewRoundReads
{
    public static async Task<ReviewRoundDto> ComposeAsync(PerformanceDbContext db, ICoreWorkforceClient workforce, ReviewRound round,
        IReadOnlyList<ReviewRoundSubject> subjects, CancellationToken token, bool tolerateCore)
    {
        ReviewReadinessResolver.Resolution? readiness = null;
        if (round.State == ReviewRoundState.Draft)
        {
            try { readiness = await ReviewReadinessResolver.ResolveAsync(subjects, workforce, PerformanceClock.UtcNow, token); }
            catch (HttpRequestException) when (tolerateCore) { }
        }
        return await ReviewRoundComposer.ComposeAsync(db, workforce, round, subjects, readiness, PerformanceClock.Today, token);
    }
}

public sealed class GetReviewRoundHandler(PerformanceDbContext db, ICoreWorkforceClient workforce)
    : IQueryHandler<GetReviewRoundQuery, Result<ReviewRoundDto>>
{
    public async Task<Result<ReviewRoundDto>> Handle(GetReviewRoundQuery request, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.RoundId, cancellationToken);
        if (round is null) return Result.Failure<ReviewRoundDto>(PerformanceErrors.NotFound("ReviewRound", request.RoundId));
        var subjects = await db.ReviewRoundSubjects.AsNoTracking().Where(s => s.ReviewRoundId == round.Id).ToListAsync(cancellationToken);
        try { return Result.Success(await ReviewRoundReads.ComposeAsync(db, workforce, round, subjects, cancellationToken, tolerateCore: false)); }
        catch (HttpRequestException) { return Result.Failure<ReviewRoundDto>(PerformanceErrors.CoreUnavailable()); }
    }
}

public sealed class GetEligibleReviewersHandler(PerformanceDbContext db, ICoreWorkforceClient workforce)
    : IQueryHandler<GetEligibleReviewersQuery, Result<IReadOnlyList<EligibleReviewerDto>>>
{
    public async Task<Result<IReadOnlyList<EligibleReviewerDto>>> Handle(GetEligibleReviewersQuery request, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.RoundId, cancellationToken);
        if (round is null) return Result.Failure<IReadOnlyList<EligibleReviewerDto>>(PerformanceErrors.NotFound("ReviewRound", request.RoundId));
        try
        {
            var asOf = PerformanceClock.UtcNow;
            var people = await workforce.GetAllActiveAsOfAsync(asOf, cancellationToken);
            return Result.Success<IReadOnlyList<EligibleReviewerDto>>(people
                .Where(person => person.IsActive)
                .OrderBy(person => person.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Select(person => new EligibleReviewerDto(person.EmployeeId, person.DisplayName, person.JobTitle, person.OrgUnit?.Name))
                .ToList());
        }
        catch (HttpRequestException)
        {
            return Result.Failure<IReadOnlyList<EligibleReviewerDto>>(PerformanceErrors.CoreUnavailable());
        }
    }
}

public sealed class UpdateReviewRoundHandler(PerformanceDbContext db, IPerformanceAudit audit, ICoreWorkforceClient workforce)
    : ICommandHandler<UpdateReviewRoundCommand, Result<ReviewRoundDto>>
{
    public async Task<Result<ReviewRoundDto>> Handle(UpdateReviewRoundCommand command, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.Include(r => r.Questions).FirstOrDefaultAsync(r => r.Id == command.RoundId, cancellationToken);
        if (round is null) return Result.Failure<ReviewRoundDto>(PerformanceErrors.NotFound("ReviewRound", command.RoundId));
        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == round.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<ReviewRoundDto>(PerformanceErrors.NotFound("Cycle", round.CycleId));
        if (VersionGuard.Check(round, command.Request.ExpectedVersion) is { } stale) return Result.Failure<ReviewRoundDto>(stale);
        var request = command.Request;
        var before = Facts(round);
        try
        {
            var competencies = request.CompetencyIds.Distinct().ToArray();
            if (competencies.Length != request.CompetencyIds.Count)
                return Result.Failure<ReviewRoundDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundInvalid, "Competencies must be unique."));
            var activeCompetencyIds = await db.Competencies.Where(item => item.State == CompetencyState.Active && competencies.Contains(item.Id))
                .Select(item => item.Id).ToListAsync(cancellationToken);
            if (activeCompetencyIds.Count != competencies.Length)
                return Result.Failure<ReviewRoundDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundInvalid, "Choose only active competencies from this tenant."));
            round.UpdateDraft(cycle, request.Name, request.PeriodStart, request.PeriodEnd,
                new ReviewRoundComponents(request.SelfAssessmentEnabled, request.PeerInputEnabled ?? round.PeerInputEnabled,
                    request.ObjectiveRatingsEnabled, request.QuestionsEnabled ?? round.QuestionsEnabled,
                    request.PotentialEnabled ?? round.PotentialEnabled, request.CalibrationEnabled),
                new ReviewRoundDueDates(request.SelfAssessmentDueDate,
                    request.PeerInputDueDate is not null || request.PeerInputDueDateSet ? request.PeerInputDueDate : round.PeerInputDueDate,
                    request.ManagerAssessmentDueDate),
                JsonSerializer.Serialize(competencies), PerformanceClock.Today);
            if (request.OpensOn is DateOnly opensOn) round.SetOpensOn(cycle, opensOn);
            if (request.QuestionIds is { } questionIds)
            {
                var unique = questionIds.Distinct().ToArray();
                var library = await db.ReviewQuestions.Where(q => unique.Contains(q.Id)).ToDictionaryAsync(q => q.Id, cancellationToken);
                if (library.Count != unique.Length)
                    return Result.Failure<ReviewRoundDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundInvalid, "Choose questions from this tenant's library."));
                var picked = questionIds.Select(id => library[id]).ToList();
                var old = round.Questions.ToList();
                if (round.SetQuestions(picked))
                {
                    db.ReviewRoundQuestions.RemoveRange(old);
                    db.ReviewRoundQuestions.AddRange(round.Questions);
                }
            }
        }
        catch (InvalidOperationException ex) { return Result.Failure<ReviewRoundDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundNotDraft, ex.Message)); }
        catch (ArgumentException ex) { return Result.Failure<ReviewRoundDto>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundInvalid, ex.Message)); }
        var after = Facts(round);
        if (before != after) audit.Record(round.TenantId, "ReviewRound", round.Id, round.CycleId, PerformanceAuditActions.ReviewRoundChanged, new { before, after });
        await db.SaveChangesAsync(cancellationToken);
        var subjects = await db.ReviewRoundSubjects.AsNoTracking().Where(s => s.ReviewRoundId == round.Id).ToListAsync(cancellationToken);
        return Result.Success(await ReviewRoundReads.ComposeAsync(db, workforce, round, subjects, cancellationToken, tolerateCore: true));
    }

    private static string Facts(ReviewRound round) => JsonSerializer.Serialize(new
    {
        round.Name, round.PeriodStart, round.PeriodEnd, round.SelfAssessmentEnabled, round.PeerInputEnabled,
        round.ObjectiveRatingsEnabled, round.QuestionsEnabled, round.PotentialEnabled, round.CalibrationEnabled,
        round.SelfAssessmentDueDate, round.PeerInputDueDate, round.ManagerAssessmentDueDate, round.CompetencyIdsJson,
        questions = round.Questions.OrderBy(q => q.Audience).ThenBy(q => q.SortOrder).Select(q => q.QuestionId).ToArray(),
    });
}

public sealed class GetReviewRoundPopulationHandler(PerformanceDbContext db)
    : IQueryHandler<GetReviewRoundPopulationQuery, Result<IReadOnlyList<ReviewRoundSubjectDto>>>
{
    public async Task<Result<IReadOnlyList<ReviewRoundSubjectDto>>> Handle(GetReviewRoundPopulationQuery request, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.RoundId, cancellationToken);
        if (round is null) return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.NotFound("ReviewRound", request.RoundId));
        var subjects = await db.ReviewRoundSubjects.AsNoTracking().Where(s => s.ReviewRoundId == round.Id).ToListAsync(cancellationToken);
        return Result.Success(ReviewRoundProjection.Subjects(subjects));
    }
}

public sealed class UpdateReviewRoundPopulationHandler(PerformanceDbContext db, ITenantContext tenant,
    ICoreWorkforceClient workforce, IPerformanceAudit audit)
    : ICommandHandler<UpdateReviewRoundPopulationCommand, Result<IReadOnlyList<ReviewRoundSubjectDto>>>
{
    public async Task<Result<IReadOnlyList<ReviewRoundSubjectDto>>> Handle(UpdateReviewRoundPopulationCommand command, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.FirstOrDefaultAsync(r => r.Id == command.RoundId, cancellationToken);
        if (round is null) return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.NotFound("ReviewRound", command.RoundId));
        if (VersionGuard.Check(round, command.Request.ExpectedVersion) is { } stale)
            return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(stale);
        if (round.State != ReviewRoundState.Draft)
            return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundNotDraft, "Only a Draft round population can be changed."));
        var subjects = await db.ReviewRoundSubjects.Where(s => s.ReviewRoundId == round.Id).ToListAsync(cancellationToken);
        var byParticipant = subjects.ToDictionary(s => s.ParticipantId);
        if (command.Request.Subjects.Select(s => s.ParticipantId).Distinct().Count() != command.Request.Subjects.Count
            || command.Request.Subjects.Any(s => !byParticipant.ContainsKey(s.ParticipantId)))
            return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundPopulationInvalid, "Population updates must refer to unique participants in this round."));

        var reviewerIds = command.Request.Subjects
            .Where(edit => edit.ReviewerEmployeeId is Guid reviewerId
                && byParticipant[edit.ParticipantId].ReviewerEmployeeId != reviewerId)
            .Select(edit => edit.ReviewerEmployeeId!.Value)
            .Distinct()
            .ToArray();
        IReadOnlyList<WorkforceSnapshot> reviewers;
        try { reviewers = await workforce.ResolveAsync(PerformanceClock.UtcNow, reviewerIds, cancellationToken); }
        catch (HttpRequestException) { return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.CoreUnavailable()); }
        var reviewerById = reviewers.ToDictionary(p => p.EmployeeId);
        var changed = false;
        foreach (var edit in command.Request.Subjects)
        {
            var subject = byParticipant[edit.ParticipantId];
            var wasExcluded = subject.IsExcluded;
            var priorReason = subject.ExclusionReason;
            var priorReviewerId = subject.ReviewerEmployeeId;
            var priorReviewerName = subject.ReviewerDisplayName;
            var priorReviewerBasis = subject.ReviewerBasis;
            if (edit.IsExcluded)
            {
                try { subject.Exclude(round, edit.ExclusionReason ?? string.Empty); }
                catch (ArgumentException ex) { return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundExclusionReason, ex.Message)); }
            }
            else subject.Include(round);
            if (edit.ReviewerEmployeeId is Guid reviewerId && reviewerId != subject.ReviewerEmployeeId)
            {
                if (!reviewerById.TryGetValue(reviewerId, out var person))
                    return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundReviewerInvalid, "The assigned reviewer was not found in Core."));
                try { subject.AssignReviewer(round, reviewerId, person.DisplayName); }
                catch (ArgumentException ex) { return Result.Failure<IReadOnlyList<ReviewRoundSubjectDto>>(PerformanceErrors.Validation(PerformanceErrors.Codes.ReviewRoundReviewerInvalid, ex.Message)); }
            }
            if (wasExcluded != subject.IsExcluded || priorReason != subject.ExclusionReason)
            {
                changed = true;
                audit.Record(tenant.TenantId, "ReviewRoundSubject", subject.Id, round.CycleId,
                    PerformanceAuditActions.ReviewRoundSubjectExcluded,
                    new { subject.ParticipantId, subject.SubjectEmployeeId, subject.SubjectDisplayName,
                        before = new { isExcluded = wasExcluded, reason = priorReason },
                        after = new { isExcluded = subject.IsExcluded, reason = subject.ExclusionReason } });
            }
            if (priorReviewerId != subject.ReviewerEmployeeId || priorReviewerName != subject.ReviewerDisplayName || priorReviewerBasis != subject.ReviewerBasis)
            {
                changed = true;
                audit.Record(tenant.TenantId, "ReviewRoundSubject", subject.Id, round.CycleId,
                    PerformanceAuditActions.ReviewRoundReviewerAssigned,
                    new { subject.ParticipantId, subject.SubjectEmployeeId, subject.SubjectDisplayName,
                        before = new { reviewerEmployeeId = priorReviewerId, reviewerDisplayName = priorReviewerName, reviewerBasis = priorReviewerBasis },
                        after = new { reviewerEmployeeId = subject.ReviewerEmployeeId, reviewerDisplayName = subject.ReviewerDisplayName, reviewerBasis = subject.ReviewerBasis } });
            }
        }
        if (changed) round.Touch();
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(ReviewRoundProjection.Subjects(subjects));
    }
}

public sealed class LaunchReviewRoundHandler(PerformanceDbContext db, ITenantContext tenant,
    ICoreWorkforceClient workforce, IPerformanceAudit audit, IPerformanceNotifications notifications)
    : ICommandHandler<LaunchReviewRoundCommand, Result<ReviewRoundLaunchDto>>
{
    public async Task<Result<ReviewRoundLaunchDto>> Handle(LaunchReviewRoundCommand command, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.Include(r => r.Questions).FirstOrDefaultAsync(r => r.Id == command.RoundId, cancellationToken);
        if (round is null) return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.NotFound("ReviewRound", command.RoundId));
        if (round.State == ReviewRoundState.Active)
        {
            var existing = await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == round.Id)
                .OrderBy(r => r.SubjectDisplayName).Select(r => r.Id).ToListAsync(cancellationToken);
            return Result.Success(new ReviewRoundLaunchDto(round.Id, round.State, existing.Count, existing));
        }
        if (VersionGuard.Check(round, command.ExpectedVersion) is { } stale)
            return Result.Failure<ReviewRoundLaunchDto>(stale);
        if (round.State != ReviewRoundState.Draft)
            return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundNotDraft, "Only a Draft review round can launch."));

        var cycle = await db.Cycles.FirstOrDefaultAsync(c => c.Id == round.CycleId, cancellationToken);
        if (cycle is null) return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.NotFound("Cycle", round.CycleId));
        if (cycle.State != CycleLifecycleState.Active)
            return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundCycleNotActive, "The Cycle must be Active to launch this round."));

        var subjects = await db.ReviewRoundSubjects.Where(s => s.ReviewRoundId == round.Id).ToListAsync(cancellationToken);
        var included = subjects.Where(s => !s.IsExcluded).ToList();
        if (included.Count == 0)
            return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundPopulationEmpty, "A review round needs at least one included subject."));
        var now = PerformanceClock.UtcNow;
        var launchDay = DateOnly.FromDateTime(now);
        ReviewReadinessResolver.Resolution readiness;
        try { readiness = await ReviewReadinessResolver.ResolveAsync(included, workforce, now, cancellationToken); }
        catch (HttpRequestException) { return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.CoreUnavailable()); }

        // Archived picks drop out: archiving removes a question from new rounds.
        var pickedIds = round.Questions.Select(q => q.QuestionId).ToArray();
        var library = await db.ReviewQuestions.Where(q => pickedIds.Contains(q.Id) && q.State == ReviewQuestionState.Active)
            .ToDictionaryAsync(q => q.Id, cancellationToken);
        var picks = round.Questions.Where(q => library.ContainsKey(q.QuestionId)
                && (q.Audience == ReviewQuestionAudience.Peer ? round.PeerInputEnabled : round.QuestionsEnabled))
            .OrderBy(q => q.Audience).ThenBy(q => q.SortOrder).ToList();
        var running = await ReviewRoundComposer.RunningRoundAsync(db, round, cancellationToken);
        var roundIssues = ReviewRoundComposer.RoundIssues(round, cycle, included.Count,
            picks.Select(p => new ReviewRoundQuestionDto(p.Id, p.QuestionId, p.Audience, p.SortOrder, library[p.QuestionId].Text)).ToArray(),
            running is not null, launchDay);
        var blocking = readiness.Issues.Values.SelectMany(values => values).ToArray();
        if (blocking.Length > 0 || roundIssues.Count > 0)
        {
            var message = running is not null
                ? $"{running.Name} is running. Launch this round once it is closed."
                : "Resolve every review readiness issue before launch.";
            return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundNotReady,
                message, new { issues = blocking, roundIssues, runningRound = running }));
        }

        var scale = await db.RatingScales.SingleOrDefaultAsync(cancellationToken);
        RatingScaleVersion version;
        if (scale is null)
        {
            scale = RatingScale.CreateDefault(tenant.TenantId);
            version = scale.CreateNextVersion(RatingScaleDefaults.Levels);
            db.RatingScales.Add(scale);
            db.RatingScaleVersions.Add(version);
        }
        else
        {
            version = scale.CurrentVersionId is Guid currentId
                ? await db.RatingScaleVersions.SingleAsync(v => v.Id == currentId && v.RatingScaleId == scale.Id, cancellationToken)
                : scale.CreateNextVersion(RatingScaleDefaults.Levels);
            if (db.Entry(version).State == EntityState.Detached) db.RatingScaleVersions.Add(version);
            // Include the shared scale row in the atomic save. If its current pointer changes
            // between this read and commit, xmin rejects the launch rather than freezing a stale scale.
            scale.Touch();
        }

        var selectedCompetencyIds = JsonSerializer.Deserialize<IReadOnlyList<Guid>>(round.CompetencyIdsJson) ?? [];
        var competencies = await db.Competencies.Where(item => selectedCompetencyIds.Contains(item.Id)).ToListAsync(cancellationToken);
        if (competencies.Count != selectedCompetencyIds.Count || competencies.Any(item => item.State != CompetencyState.Active))
            return Result.Failure<ReviewRoundLaunchDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.ReviewRoundInvalid, "The round includes a competency that is no longer active."));
        foreach (var competency in competencies) competency.MarkUsed(now);
        var snapshots = picks.Select(pick => ReviewQuestionSnapshot.Create(round, pick, library[pick.QuestionId])).ToList();
        foreach (var question in library.Values.Where(q => picks.Any(p => p.QuestionId == q.Id))) question.MarkUsed(now);
        var schedule = round.ScheduleFor(launchDay);
        var configSnapshot = JsonSerializer.Serialize(new
        {
            round.Name, round.PeriodStart, round.PeriodEnd,
            round.SelfAssessmentEnabled, round.PeerInputEnabled, round.ObjectiveRatingsEnabled, round.QuestionsEnabled,
            round.PotentialEnabled, round.CalibrationEnabled,
            SelfAssessmentDueDate = round.SelfAssessmentEnabled ? schedule.SelfAssessment : (DateOnly?)null,
            PeerInputDueDate = round.PeerInputEnabled ? schedule.PeerInput : (DateOnly?)null,
            ManagerAssessmentDueDate = schedule.ManagerAssessment,
            competencyIds = selectedCompetencyIds,
            competencies = competencies.Select(item => new { id = item.Id, name = item.Name, description = item.Description, behaviors = item.Behaviors }).ToArray(),
            questions = snapshots.Select(q => new { id = q.Id, questionId = q.QuestionId, audience = q.Audience.ToString(), q.SortOrder, q.Text }).ToArray(),
            ratingScaleVersionId = version.Id,
            ratingScaleVersion = version.Number,
            ratingScale = version.Levels,
        });
        var reviews = included.Select(subject =>
        {
            var subjectSnapshot = readiness.People[subject.SubjectEmployeeId];
            var reviewerSnapshot = readiness.People[subject.ReviewerEmployeeId!.Value];
            return PerformanceReview.Open(tenant.TenantId, round, subject, version.Id, version.LevelsJson,
                subjectSnapshot.DisplayName, subjectSnapshot.JobTitle, subjectSnapshot.OrgUnit?.OrgUnitId,
                subjectSnapshot.OrgUnit?.Name, reviewerSnapshot.DisplayName, subject.ReviewerBasis, now);
        }).ToList();
        var beforeState = round.State;
        round.Launch(configSnapshot, version.Id, now);
        db.ReviewQuestionSnapshots.AddRange(snapshots);
        db.PerformanceReviews.AddRange(reviews);
        foreach (var review in reviews)
            notifications.EnqueueReview(review,
                round.SelfAssessmentEnabled ? PerformanceNotificationKind.SelfAssessmentOpened : PerformanceNotificationKind.ManagerAssessmentOpened,
                round.Name);
        if (round.PeerInputEnabled) await AskPeersAsync(round, reviews, now, cancellationToken);
        audit.Record(tenant.TenantId, "ReviewRound", round.Id, round.CycleId, PerformanceAuditActions.ReviewRoundLaunched,
            new { before = new { state = beforeState }, after = new { state = round.State, reviewCount = reviews.Count, ratingScaleVersion = version.Number,
                questionCount = snapshots.Count } });
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(new ReviewRoundLaunchDto(round.Id, round.State, reviews.Count, reviews.Select(r => r.Id).ToArray()));
    }

    /// <summary>
    /// Fusion asks each person's three closest colleagues in the year at once (D-40), nobody's approval first; each is
    /// told, opening on Home. Someone nobody worked with gets no peers; their manager may add some.
    /// </summary>
    private async Task AskPeersAsync(ReviewRound round, IReadOnlyList<PerformanceReview> reviews, DateTime now, CancellationToken token)
    {
        var affinity = await PeerAffinity.LoadAsync(db, round.CycleId, round.PeriodStart, round.PeriodEnd, null, token);
        var names = await db.Participants.AsNoTracking().Where(p => p.CycleId == round.CycleId)
            .ToDictionaryAsync(p => p.EmployeeId, p => p.DisplayName, token);
        foreach (var review in reviews)
        {
            var picks = affinity.Pick(review.SubjectEmployeeId, review.ReviewerEmployeeId, names.Keys);
            if (picks.Count == 0) continue;
            review.PickPeers(picks.Select(id => (id, names[id])).ToArray(), now);
            db.PeerNominations.AddRange(review.PeerNominations);
            foreach (var peer in picks)
            {
                var request = PeerRequest.Create(review, peer, names[peer], round.PeerInputDueDate, now);
                db.PeerRequests.Add(request);
                PeerInput.Tell(notifications, review, round, request);
            }
        }
    }
}

public sealed class GetReviewRoundStatusHandler(PerformanceDbContext db)
    : IQueryHandler<GetReviewRoundStatusQuery, Result<ReviewRoundStatusDto>>
{
    public async Task<Result<ReviewRoundStatusDto>> Handle(GetReviewRoundStatusQuery request, CancellationToken cancellationToken)
    {
        var round = await db.ReviewRounds.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.RoundId, cancellationToken);
        if (round is null) return Result.Failure<ReviewRoundStatusDto>(PerformanceErrors.NotFound("ReviewRound", request.RoundId));
        var reviews = await db.PerformanceReviews.AsNoTracking().Where(r => r.ReviewRoundId == round.Id).ToListAsync(cancellationToken);
        var today = PerformanceClock.Today;
        var counts = Enum.GetValues<PerformanceReviewState>().Select(state => new ReviewStageCountDto(state, reviews.Count(r => r.State == state))).ToArray();
        var open = reviews.Where(r => r.State != PerformanceReviewState.Closed).ToArray();
        var levels = round.RatingScaleVersionId is Guid versionId
            ? (await db.RatingScaleVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == versionId, cancellationToken))?.Levels ?? []
            : [];
        // An administrator who is also a subject of the round does not see their own rating here.
        var rated = open.Where(r => request.ViewerEmployeeId == Guid.Empty || r.SubjectEmployeeId != request.ViewerEmployeeId).Select(r => (Review: new ReviewRatingSubjectDto(r.Id, r.SubjectDisplayName), Rating: r.FinalRating ?? (r.ManagerAssessment.IsSubmitted ? r.ManagerAssessment.OverallRating : null)))
            .Where(r => r.Rating is not null).ToArray();
        return Result.Success(new ReviewRoundStatusDto(round.Id, round.State, counts,
            reviews.Count(r => r.State == PerformanceReviewState.SelfAssessment && r.CurrentStageDueDate < today),
            reviews.Count(r => r.State == PerformanceReviewState.ManagerAssessment && r.CurrentStageDueDate < today),
            reviews.Count(r => r.State == PerformanceReviewState.ReadyToFinalize),
            new ReviewCompletionDto(open.Count(r => r.SelfAssessmentEnabled && r.SelfAssessment.IsSubmitted), open.Count(r => r.SelfAssessmentEnabled)),
            new ReviewCompletionDto(open.Count(r => r.ManagerAssessment.IsSubmitted), open.Length),
            levels.Select(level =>
            {
                var at = rated.Where(r => r.Rating == level.Value).Select(r => r.Review)
                    .OrderBy(r => r.SubjectDisplayName, StringComparer.OrdinalIgnoreCase).ToArray();
                return new ReviewRatingCountDto(level.Value, level.Label, at.Length, at);
            }).ToArray()));
    }
}

public sealed class GetReviewWorkHandler(PerformanceDbContext db)
    : IQueryHandler<GetReviewWorkQuery, Result<IReadOnlyList<ReviewWorkItemDto>>>
{
    public async Task<Result<IReadOnlyList<ReviewWorkItemDto>>> Handle(GetReviewWorkQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Cycles.AnyAsync(c => c.Id == request.CycleId, cancellationToken))
            return Result.Failure<IReadOnlyList<ReviewWorkItemDto>>(PerformanceErrors.NotFound("Cycle", request.CycleId));
        var readable = ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(),
            new ReviewActor(request.EmployeeId, request.IsAdmin, CanReviewReports: request.CanReviewReports));
        var query = from review in readable
                    join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                    where review.CycleId == request.CycleId
                      && review.State != PerformanceReviewState.Finalized
                      && review.State != PerformanceReviewState.Closed
                    orderby review.CurrentStageDueDate, review.SubjectDisplayName
                    select new ReviewWorkItemDto(review.Id, round.Id, review.CycleId, round.Name,
                        review.SubjectDisplayName, review.ReviewerDisplayName, review.State, review.CurrentStageDueDate,
                        request.EmployeeId != Guid.Empty && review.SubjectEmployeeId == request.EmployeeId,
                        request.EmployeeId != Guid.Empty && review.ReviewerEmployeeId == request.EmployeeId,
                        request.IsAdmin || (request.EmployeeId != Guid.Empty
                            && ((review.State == PerformanceReviewState.SelfAssessment && review.SubjectEmployeeId == request.EmployeeId)
                                || (review.State == PerformanceReviewState.ManagerAssessment && review.ReviewerEmployeeId == request.EmployeeId))));
        return Result.Success<IReadOnlyList<ReviewWorkItemDto>>(await query.ToListAsync(cancellationToken));
    }
}

public sealed class GetReviewHistoryHandler(PerformanceDbContext db)
    : IQueryHandler<GetReviewHistoryQuery, Result<IReadOnlyList<ReviewHistoryItemDto>>>
{
    public async Task<Result<IReadOnlyList<ReviewHistoryItemDto>>> Handle(GetReviewHistoryQuery request, CancellationToken cancellationToken)
    {
        if (request.CycleId is Guid cycleId && !await db.Cycles.AnyAsync(cycle => cycle.Id == cycleId, cancellationToken))
            return Result.Failure<IReadOnlyList<ReviewHistoryItemDto>>(PerformanceErrors.NotFound("Cycle", cycleId));
        var readable = ReviewPolicy.Readable(db.PerformanceReviews.AsNoTracking(),
            new ReviewActor(request.EmployeeId, request.IsAdmin, CanReviewReports: request.CanReviewReports));
        var query = from review in readable
                    join round in db.ReviewRounds.AsNoTracking() on review.ReviewRoundId equals round.Id
                    join cycle in db.Cycles.AsNoTracking() on review.CycleId equals cycle.Id
                    where (request.CycleId == null || review.CycleId == request.CycleId) && review.State == PerformanceReviewState.Finalized
                    orderby review.FinalizedAt descending
                    select new { review.Id, RoundId = round.Id, review.CycleId, CycleName = cycle.Name, RoundName = round.Name,
                        review.SubjectDisplayName, review.ReviewerDisplayName, review.FinalRating, review.FinalizedAt, review.FinalizedSnapshotJson };
        var rows = await query.ToListAsync(cancellationToken);
        return Result.Success<IReadOnlyList<ReviewHistoryItemDto>>(rows.Select(review => new ReviewHistoryItemDto(
            review.Id, review.RoundId, review.CycleId, review.CycleName, review.RoundName, review.SubjectDisplayName,
            review.ReviewerDisplayName, review.FinalRating,
            ReviewHistoryRating.Label(review.FinalizedSnapshotJson, review.FinalRating), review.FinalizedAt)).ToList());
    }
}

public static class ReviewHistoryRating
{
    public static string? Label(string? snapshotJson, int? finalRating)
    {
        if (finalRating is null || string.IsNullOrWhiteSpace(snapshotJson)) return null;
        try
        {
            using var snapshot = System.Text.Json.JsonDocument.Parse(snapshotJson);
            if (!snapshot.RootElement.TryGetProperty("ratingScale", out var levels) || levels.ValueKind != System.Text.Json.JsonValueKind.Array)
                return null;
            foreach (var level in levels.EnumerateArray())
            {
                if ((level.TryGetProperty("value", out var value) || level.TryGetProperty("Value", out value))
                    && value.TryGetInt32(out var number) && number == finalRating
                    && (level.TryGetProperty("label", out var label) || level.TryGetProperty("Label", out label))
                    && label.ValueKind == System.Text.Json.JsonValueKind.String)
                    return label.GetString();
            }
        }
        catch (System.Text.Json.JsonException) { }
        return null;
    }
}
