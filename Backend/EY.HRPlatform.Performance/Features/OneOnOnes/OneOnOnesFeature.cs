using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Common;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Features.Conversations;
using EY.HRPlatform.Performance.Features.Failures;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Features.Security;
using EY.HRPlatform.Performance.Features.Security.Policies;
using EY.HRPlatform.Performance.Infrastructure.Audit;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.CQRS;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Features.OneOnOnes;

// ── Contracts ────────────────────────────────────────────────────────────────

public sealed record OneOnOnePersonDto(Guid EmployeeId, string DisplayName, string? JobTitle);

/// <summary>A meeting on a series' rhythm: when it was or will be, and whether it was held.</summary>
public sealed record OneOnOneBeatDto(DateTime At, OneOnOneMeetingState State);

/// <summary>One of the caller's series in the 1:1s workspace.</summary>
public sealed record OneOnOneRowDto(Guid SeriesId, OneOnOnePersonDto With, OneOnOneCadence Cadence, DateTime? NextMeetingAt,
    int OpenActions, int OverdueActions, bool Ended, DateTime? EndedAt)
{
    public Guid? NextMeetingId { get; init; }
    /// <summary>Talking points already on the next meeting.</summary>
    public int AgendaCount { get; init; }
    /// <summary>When the last held meeting was completed.</summary>
    public DateTime? LastMetAt { get; init; }
    /// <summary>Meetings in the rhythm window (<see cref="OneOnOneRhythm.LookBack"/>) and the next one, oldest first.</summary>
    public IReadOnlyList<OneOnOneBeatDto> Recent { get; init; } = [];
}

/// <summary>Someone the caller can start 1:1s with: their manager or a direct report without a series.</summary>
public sealed record OneOnOneStartOptionDto(OneOnOnePersonDto With);

/// <summary>An open action the caller owns in one of their active series.</summary>
public sealed record OneOnOneOwedActionDto(Guid SeriesId, Guid ActionId, string Text, OneOnOnePersonDto With, DateOnly? DueDate, bool Overdue);

public sealed record OneOnOnesDto(
    OneOnOneRowDto? WithManager,
    OneOnOneStartOptionDto? StartWithManager,
    IReadOnlyList<OneOnOneRowDto> Reports,
    IReadOnlyList<OneOnOneStartOptionDto> StartWithReports,
    IReadOnlyList<OneOnOneRowDto> Ended,
    OneOnOneCadence DefaultCadence,
    // False when Core HR couldn't be reached: rows come from stored state and no start options are offered.
    bool LineAvailable)
{
    /// <summary>Open actions the caller owns across active series, the earliest due first.</summary>
    public IReadOnlyList<OneOnOneOwedActionDto> MyActions { get; init; } = [];
}

/// <summary>What starting 1:1s with someone looks like: the default rhythm and talking points ready for the first agenda.</summary>
public sealed record OneOnOneStartDto(OneOnOnePersonDto With, OneOnOneCadence DefaultCadence, IReadOnlyList<OneOnOneSuggestionDto> Suggestions);

public static class OneOnOneRhythm
{
    /// <summary>How far back the workspace shows a series' meetings.</summary>
    public static readonly TimeSpan LookBack = TimeSpan.FromDays(42);
}

/// <summary>
/// An item on a meeting's agenda with the note both people see; a note marks it talked about (D-64). A starter's
/// <see cref="Text"/> is its key (<see cref="OneOnOneStarters"/>). <see cref="CarriedFromAt"/> is the earlier meeting it
/// carried over from, having no note there.
/// </summary>
public sealed record OneOnOneAgendaItemDto(Guid Id, string Text, Guid AuthorEmployeeId, bool Discussed,
    AgendaSourceKind? SourceKind, Guid? SourceId, string? Href, string Note, uint NoteRevision, DateTime AddedAt, DateTime? CarriedFromAt);

public sealed record OneOnOneActionDto(Guid Id, string Text, Guid OwnerEmployeeId, DateOnly? DueDate, bool Done, DateTime? DoneAt,
    Guid CreatedInMeetingId, DateTime CreatedInMeetingAt, Guid CreatedByEmployeeId, bool CarriedOver, bool Overdue);

/// <summary>
/// A talking point computed for the viewer, shown on the agenda until a note adds it there. Labels never carry feedback
/// or praise text. <see cref="Percent"/> is a goal's progress; <see cref="By"/> who it's from (the requester, the author,
/// an action's owner); <see cref="DueDate"/> a late action's due date.
/// </summary>
public sealed record OneOnOneSuggestionDto(AgendaSourceKind Kind, Guid SourceId, Guid? CycleId, string Label, ObjectiveStatus? Status,
    string Href, DateTime? At)
{
    public decimal? Percent { get; init; }
    public Guid? By { get; init; }
    public DateOnly? DueDate { get; init; }
}

/// <summary>The caller's own private note on a meeting; nobody else's is ever returned.</summary>
public sealed record OneOnOnePrivateNoteDto(string Text, uint Revision);

public sealed record OneOnOneMeetingDto(
    Guid Id,
    uint Version,
    DateTime ScheduledAt,
    OneOnOneMeetingState State,
    DateTime? CompletedAt,
    IReadOnlyList<OneOnOneAgendaItemDto> Agenda,
    OneOnOnePrivateNoteDto PrivateNote,
    bool NotesWritable,
    IReadOnlyList<OneOnOneActionDto> Actions,
    IReadOnlyList<OneOnOneSuggestionDto> Suggestions);

public sealed record OneOnOneCapabilitiesDto(bool Write);

/// <summary>One of the report's goals this year, as the 1:1 shows it beside the agenda.</summary>
public sealed record OneOnOneGoalDto(Guid Id, Guid CycleId, string Title, ObjectiveStatus? Status, decimal? Percent);

/// <summary>The latest praise the report received.</summary>
public sealed record OneOnOnePraiseDto(Guid Id, Guid AuthorEmployeeId, string AuthorName, string Message, DateTime At);

/// <summary>
/// What sits beside the meeting about the report: their goals (when the viewer may read the plan), when a plan is due
/// if there's none approved yet, the latest praise, and who they are.
/// </summary>
public sealed record OneOnOneContextDto(IReadOnlyList<OneOnOneGoalDto> Goals, bool PlanApproved, DateOnly? PlanDue,
    OneOnOnePraiseDto? LatestPraise, DateOnly? JoinedOn, string? Unit);

public sealed record OneOnOneSeriesDto(
    Guid Id,
    uint Version,
    OneOnOnePersonDto Manager,
    OneOnOnePersonDto Report,
    // "Manager" or "Report": the caller's side of the series.
    string ViewerRole,
    OneOnOneCadence Cadence,
    DateTime StartedAt,
    Guid StartedByEmployeeId,
    bool Ended,
    DateTime? EndedAt,
    OneOnOneEndReason? EndReason,
    OneOnOneMeetingDto? Upcoming,
    IReadOnlyList<OneOnOneMeetingDto> Past,
    int OpenActions,
    int OverdueActions,
    OneOnOneCapabilitiesDto Can)
{
    /// <summary>No meeting held yet: the upcoming one is the first.</summary>
    public bool First { get; init; }
    /// <summary>When what isn't noted on the upcoming meeting carries to.</summary>
    public DateTime? CarriesTo { get; init; }
    public OneOnOneContextDto? Context { get; init; }
}

/// <summary>Starts a series; <see cref="Agenda"/> puts talking points on the first meeting, the same way they're added later.</summary>
public sealed record StartOneOnOneRequest(Guid WithEmployeeId, OneOnOneCadence? Cadence, DateTime FirstMeetingAt,
    IReadOnlyList<AddAgendaItemRequest>? Agenda = null);
public sealed record ChangeOneOnOneCadenceRequest(OneOnOneCadence Cadence)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}
public sealed record RescheduleOneOnOneRequest(DateTime ScheduledAt)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedVersion { get; init; }
}
/// <summary>
/// An agenda item, or a suggestion added by naming its source (its label is then derived on the server). A
/// <see cref="Note"/> adds it already talked about: writing on a suggestion is how it joins the agenda.
/// </summary>
public sealed record AddAgendaItemRequest(Guid Id, string? Text, AgendaSourceKind? SourceKind, Guid? SourceId, string? Note = null);
public sealed record SetNotesRequest(string Text)
{
    [System.Text.Json.Serialization.JsonRequired]
    public uint ExpectedRevision { get; init; }
}
public sealed record AddActionRequest(Guid Id, string Text, Guid OwnerEmployeeId, DateOnly? DueDate);
public sealed record EditActionRequest(string Text, Guid OwnerEmployeeId, DateOnly? DueDate);
public sealed record SetActionDoneRequest(bool Done);

/// <summary>The caller: their employee record and whether they hold the direct-reports grant.</summary>
public sealed record OneOnOneViewer(Guid EmployeeId, bool ReviewsReports);

public sealed record GetOneOnOnesQuery(OneOnOneViewer Viewer) : IQuery<Result<OneOnOnesDto>>;
public sealed record GetOneOnOneSeriesQuery(Guid SeriesId, OneOnOneViewer Viewer) : IQuery<Result<OneOnOneSeriesDto>>;
public sealed record GetOneOnOneStartQuery(Guid WithEmployeeId, OneOnOneViewer Viewer) : IQuery<Result<OneOnOneStartDto>>;
public sealed record StartOneOnOneCommand(StartOneOnOneRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record ChangeOneOnOneCadenceCommand(Guid SeriesId, ChangeOneOnOneCadenceRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record RescheduleOneOnOneCommand(Guid MeetingId, RescheduleOneOnOneRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record AddAgendaItemCommand(Guid MeetingId, AddAgendaItemRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record SetAgendaNoteCommand(Guid MeetingId, Guid ItemId, SetNotesRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record RemoveAgendaItemCommand(Guid MeetingId, Guid ItemId, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record SetPrivateNotesCommand(Guid MeetingId, SetNotesRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record AddActionCommand(Guid SeriesId, AddActionRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record EditActionCommand(Guid SeriesId, Guid ActionId, EditActionRequest Request, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;
public sealed record SetActionDoneCommand(Guid SeriesId, Guid ActionId, bool Done, OneOnOneViewer Viewer) : ICommand<Result<OneOnOneSeriesDto>>;

// ── Suggestions ──────────────────────────────────────────────────────────────

/// <summary>
/// Talking points about the report for the upcoming meeting (D-12, D-66), computed on read for the viewer: risky
/// objectives in the active cycle, the series' late actions, open update requests on their plan, and shared feedback
/// and praise they received since the last completed meeting. Every source is filtered through its own policy;
/// manager-only feedback never appears because the agenda is shared with the report.
/// </summary>
public sealed class OneOnOneSuggestions(PerformanceDbContext db)
{
    /// <summary>With no completed meeting yet, feedback and praise from this long before the series started still count.</summary>
    public static readonly TimeSpan FirstMeetingLookBack = TimeSpan.FromDays(30);

    public async Task<IReadOnlyList<OneOnOneSuggestionDto>> ForAsync(Guid report, OneOnOneViewer viewer, DateTime since,
        IReadOnlySet<Guid> viewerReportIds, CancellationToken token, OneOnOneSeries? series = null)
    {
        var suggestions = new List<OneOnOneSuggestionDto>();

        var cycle = await db.Cycles.AsNoTracking().Where(c => c.State == CycleLifecycleState.Active)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);
        var plan = cycle is null ? null : await ReadablePlanAsync(db, cycle.Id, report, viewer, token);
        if (cycle is not null && plan is { State: PlanLifecycleState.Approved })
        {
            var risky = await db.Objectives.AsNoTracking()
                .Where(o => o.EmployeePlanId == plan.Id
                    && (o.CurrentStatus == ObjectiveStatus.AtRisk || o.CurrentStatus == ObjectiveStatus.OffTrack))
                .OrderBy(o => o.Title).ToListAsync(token);
            suggestions.AddRange(risky.Select(o => new OneOnOneSuggestionDto(AgendaSourceKind.Objective, o.Id, cycle.Id, o.Title,
                o.CurrentStatus, PerformanceNotificationTemplates.ObjectivePath(cycle.Id, o.Id), o.LastProgressAt ?? o.StatusSince)
                { Percent = o.CurrentPercentage }));
        }

        if (series is not null)
        {
            var today = PerformanceClock.Today;
            suggestions.AddRange(series.OpenActionItems().Where(a => a.DueDate is DateOnly due && due < today)
                .OrderBy(a => a.DueDate).Select(a => new OneOnOneSuggestionDto(AgendaSourceKind.Action, a.Id, null, a.Text, null,
                    PerformanceNotificationTemplates.ActionLandingPath(series.Id, a.Id), a.CreatedAt) { By = a.OwnerEmployeeId, DueDate = a.DueDate }));
        }

        if (cycle is not null && plan is not null)
        {
            var requests = await db.UpdateRequests.AsNoTracking()
                .Where(r => r.CycleId == cycle.Id && r.PlanId == plan.Id && r.State == UpdateRequestState.Open)
                .OrderBy(r => r.RequestedAt).ToListAsync(token);
            var titles = await ObjectiveTitlesAsync(requests.Select(r => r.ObjectiveId), token);
            suggestions.AddRange(requests.Select(r => new OneOnOneSuggestionDto(AgendaSourceKind.UpdateRequest, r.Id, cycle.Id,
                r.ObjectiveId is Guid o && titles.TryGetValue(o, out var title) ? $"Update requested: {title}" : "Update requested on the plan",
                null,
                r.ObjectiveId is Guid objectiveId
                    ? PerformanceNotificationTemplates.ObjectivePath(cycle.Id, objectiveId)
                    : PerformanceNotificationTemplates.PlanPath(cycle.Id, plan.Id),
                r.RequestedAt) { By = r.RequestedByEmployeeId }));
        }

        var feedbackViewer = FeedbackViewer.For(viewer.EmployeeId, isAdministrator: false, viewer.ReviewsReports, viewerReportIds);
        var feedback = await FeedbackPolicy.Readable(db.Feedback.AsNoTracking(), feedbackViewer)
            .Where(f => f.ReceiverEmployeeId == report && f.Visibility == FeedbackVisibility.Shared && f.SentAt > since)
            .OrderByDescending(f => f.SentAt).Take(10).ToListAsync(token);
        var competencyIds = feedback.Select(f => f.CompetencyId).OfType<Guid>().ToList();
        var praise = await PraisePolicy.Readable(db.Praise.AsNoTracking())
            .Where(p => p.GivenAt > since && p.Recipients.Any(r => r.EmployeeId == report))
            .OrderByDescending(p => p.GivenAt).Take(10).ToListAsync(token);
        var competencies = await db.Competencies.AsNoTracking().Where(c => competencyIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, token);
        var values = await CompanyValues.NamesAsync(db, praise.Select(p => p.ValueId), token);

        suggestions.AddRange(feedback.Select(f => new OneOnOneSuggestionDto(AgendaSourceKind.Feedback, f.Id, null,
            FeedbackLabel(f, competencies), null, PerformanceNotificationTemplates.FeedbackPath(f.Id), f.SentAt) { By = f.AuthorEmployeeId }));
        suggestions.AddRange(praise.Select(p => new OneOnOneSuggestionDto(AgendaSourceKind.Praise, p.Id, null,
            $"Praise from {p.AuthorName} for {values.GetValueOrDefault(p.ValueId) ?? "a company value"}", null,
            PerformanceNotificationTemplates.PraisePath(p.Id), p.GivenAt) { By = p.AuthorEmployeeId }));
        return suggestions;
    }

    /// <summary>The report's plan in the cycle when the viewer may read it; relationship rules only, never an admin's reach.</summary>
    public static async Task<EmployeePlan?> ReadablePlanAsync(PerformanceDbContext db, Guid cycleId, Guid report, OneOnOneViewer viewer,
        CancellationToken token)
    {
        var plan = await db.EmployeePlans.AsNoTracking().Include(p => p.Decisions)
            .FirstOrDefaultAsync(p => p.CycleId == cycleId && p.EmployeeId == report, token);
        var actor = new GoalActorContext(viewer.EmployeeId, IsAdmin: false, HasOrgManageGrant: false, CanReviewReports: viewer.ReviewsReports);
        return plan is not null && PlanPolicy.CanRead(actor, plan) ? plan : null;
    }

    public static AgendaSource SourceOf(OneOnOneSuggestionDto offered) => new(offered.Kind, offered.SourceId, offered.CycleId);

    /// <summary>The agenda text for a suggestion: its server label, with the objective's status when it has one.</summary>
    public static string AgendaText(OneOnOneSuggestionDto offered)
    {
        var text = offered.Status is ObjectiveStatus status ? $"{offered.Label} · {StatusLabel(status)}" : offered.Label;
        return text.Length > OneOnOneAgendaItem.MaxTextLength ? text[..(OneOnOneAgendaItem.MaxTextLength - 1)] + "…" : text;
    }

    private static string StatusLabel(ObjectiveStatus status) => status switch
    {
        ObjectiveStatus.AtRisk => "At risk",
        ObjectiveStatus.OffTrack => "Off track",
        _ => "On track",
    };

    private static string FeedbackLabel(Feedback f, IReadOnlyDictionary<Guid, string> values) => f.SubjectKind switch
    {
        FeedbackSubjectKind.Competency when f.CompetencyId is Guid c && values.TryGetValue(c, out var name) => $"Feedback from {f.AuthorName} about {name}",
        FeedbackSubjectKind.Objective when f.ObjectiveTitle is { } title => $"Feedback from {f.AuthorName} about {title}",
        _ => $"Feedback from {f.AuthorName}",
    };

    private async Task<Dictionary<Guid, string>> ObjectiveTitlesAsync(IEnumerable<Guid?> ids, CancellationToken token)
    {
        var wanted = ids.OfType<Guid>().Distinct().ToList();
        return wanted.Count == 0 ? [] : await db.Objectives.AsNoTracking().Where(o => wanted.Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Title, token);
    }
}

// ── Shared load and projection ───────────────────────────────────────────────

/// <summary>A manager and report who can start 1:1s, and the other person as the caller sees them.</summary>
public sealed record OneOnOnePair(Guid ManagerId, Guid ReportId, string ManagerName, string ReportName, OneOnOnePersonDto With);

public abstract class OneOnOneHandlerBase(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer performanceViewer,
    IPerformanceAudit? audit = null, IPerformanceNotifications? notifications = null)
{
    protected PerformanceDbContext Db => db;

    protected static Result<OneOnOneSeriesDto> NotFound(Guid id) => Result.Failure<OneOnOneSeriesDto>(PerformanceErrors.NotFound("OneOnOne", id));

    protected static Result<OneOnOneSeriesDto> Fail(Error error) => Result.Failure<OneOnOneSeriesDto>(error);

    protected static Result<OneOnOneSeriesDto> Invalid(Exception ex) => ex switch
    {
        KeyNotFoundException => Fail(PerformanceErrors.NotFound("OneOnOneItem", Guid.Empty)),
        UnauthorizedAccessException => Fail(PerformanceErrors.Forbidden(PerformanceErrors.Codes.OneOnOneForbidden, ex.Message)),
        OneOnOneNotesConflictException => Fail(PerformanceErrors.Stale(PerformanceErrors.Codes.OneOnOneNotesChanged, ex.Message)),
        InvalidOperationException => Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneWrongState, ex.Message)),
        _ => Fail(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneInvalid, ex.Message)),
    };

    /// <summary>The series the caller is part of, tracked for a write; the same not-found answer otherwise.</summary>
    protected async Task<OneOnOneSeries?> SeriesAsync(Guid seriesId, OneOnOneViewer viewer, bool tracked, CancellationToken token)
    {
        var source = tracked ? db.OneOnOneSeries : db.OneOnOneSeries.AsNoTracking();
        return await OneOnOnePolicy.Readable(source, viewer.EmployeeId).FirstOrDefaultAsync(s => s.Id == seriesId, token);
    }

    /// <summary>The meeting and its series, both tracked, when the caller is one of the two people.</summary>
    protected async Task<(OneOnOneMeeting Meeting, OneOnOneSeries Series)?> MeetingAsync(Guid meetingId, OneOnOneViewer viewer, CancellationToken token)
    {
        var meeting = await db.OneOnOneMeetings.FirstOrDefaultAsync(m => m.Id == meetingId, token);
        if (meeting is null) return null;
        var series = await SeriesAsync(meeting.SeriesId, viewer, tracked: true, token);
        return series is null ? null : (meeting, series);
    }

    /// <summary>
    /// Every write checks the line in Core HR first. When it has ended, the series ends here and now, in its own save,
    /// and the write is refused. Core being down refuses the write; it never guesses.
    /// </summary>
    protected async Task<Result<OneOnOneSeriesDto>?> GuardWriteAsync(OneOnOneSeries series, OneOnOneViewer viewer, CancellationToken token)
    {
        if (!series.IsActive) return SeriesEnded();
        if (!OneOnOnePolicy.CanWrite(series, viewer.EmployeeId, viewer.ReviewsReports))
            return Fail(PerformanceErrors.Forbidden(PerformanceErrors.Codes.OneOnOneForbidden, "Only the two people in a 1:1 change it."));
        IReadOnlyList<WorkforceSnapshot> people;
        try { people = await workforce.ResolveAsync(PerformanceClock.UtcNow, [series.ReportEmployeeId, series.ManagerEmployeeId], token); }
        catch (HttpRequestException) { return Fail(PerformanceErrors.CoreUnavailable()); }
        if (EndReasonFor(series, people) is not OneOnOneEndReason reason) return null;

        await EndAsync(series, reason, token);
        await db.SaveChangesAsync(token);
        return SeriesEnded();
    }

    protected static Result<OneOnOneSeriesDto> SeriesEnded()
        => Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneSeriesEnded,
            "This 1:1 series ended with the reporting line. Start a new one with the current manager."));

    /// <summary>Why the series can't continue, from Core's current view of the two people; null while the line holds.</summary>
    public static OneOnOneEndReason? EndReasonFor(OneOnOneSeries series, IReadOnlyList<WorkforceSnapshot> people)
    {
        var report = people.FirstOrDefault(p => p.EmployeeId == series.ReportEmployeeId);
        var manager = people.FirstOrDefault(p => p.EmployeeId == series.ManagerEmployeeId);
        if (report is not { IsActive: true } || manager is not { IsActive: true }) return OneOnOneEndReason.PersonInactive;
        return report.Manager?.EmployeeId == series.ManagerEmployeeId ? null : OneOnOneEndReason.ReportingLineEnded;
    }

    /// <summary>Ends the series, marks its upcoming meeting not held, and audits it. The caller saves.</summary>
    protected async Task EndAsync(OneOnOneSeries series, OneOnOneEndReason reason, CancellationToken token)
    {
        if (!series.End(reason, PerformanceClock.UtcNow)) return;
        foreach (var upcoming in await db.OneOnOneMeetings.Where(m => m.SeriesId == series.Id && m.State == OneOnOneMeetingState.Upcoming).ToListAsync(token))
        {
            upcoming.MarkNotHeld();
            notifications?.EnqueueInvite(series, upcoming.Id, OneOnOneInvites.Cancelled);
        }
        audit?.Record(series.TenantId, "OneOnOneSeries", series.Id, null, PerformanceAuditActions.OneOnOneEnded,
            new { reason = reason.ToString(), managerEmployeeId = series.ManagerEmployeeId, reportEmployeeId = series.ReportEmployeeId });
    }

    protected async Task<Result<OneOnOneSeriesDto>> SaveAsync(Guid seriesId, OneOnOneViewer viewer, CancellationToken token)
    {
        try { await db.SaveChangesAsync(token); }
        catch (DbUpdateConcurrencyException) { return Fail(PerformanceErrors.Changed()); }
        db.ChangeTracker.Clear();
        return await ProjectAsync(seriesId, viewer, token);
    }

    /// <summary>The series record as the caller sees it: never the other person's private notes.</summary>
    protected async Task<Result<OneOnOneSeriesDto>> ProjectAsync(Guid seriesId, OneOnOneViewer viewer, CancellationToken token)
    {
        var series = await SeriesAsync(seriesId, viewer, tracked: false, token);
        if (series is null) return NotFound(seriesId);
        var me = viewer.EmployeeId;

        IReadOnlyList<WorkforceSnapshot>? people = null;
        try { people = await workforce.ResolveAsync(PerformanceClock.UtcNow, [series.ManagerEmployeeId, series.ReportEmployeeId], token); }
        catch (HttpRequestException) { /* Stored names and state stand in while Core HR is down. */ }
        var lineEnded = series.IsActive && people is not null && EndReasonFor(series, people) is not null;
        var ended = !series.IsActive || lineEnded;

        var meetings = await db.OneOnOneMeetings.AsNoTracking().Where(m => m.SeriesId == series.Id)
            .OrderByDescending(m => m.ScheduledAt).ToListAsync(token);
        var meetingIds = meetings.Select(m => m.Id).ToList();
        var myNotes = await db.OneOnOnePrivateNotes.AsNoTracking()
            .Where(n => meetingIds.Contains(n.MeetingId) && n.AuthorEmployeeId == me)
            .ToDictionaryAsync(n => n.MeetingId, token);
        var byId = meetings.ToDictionary(m => m.Id);
        var today = PerformanceClock.Today;
        var upcoming = ended ? null : meetings.FirstOrDefault(m => m.State == OneOnOneMeetingState.Upcoming);

        IReadOnlyList<OneOnOneSuggestionDto> suggestions = [];
        if (upcoming is not null)
        {
            var since = meetings.Where(m => m.State == OneOnOneMeetingState.Completed).Select(m => m.CompletedAt).Max()
                ?? series.StartedAt - OneOnOneSuggestions.FirstMeetingLookBack;
            var all = await new OneOnOneSuggestions(db).ForAsync(series.ReportEmployeeId, viewer, since,
                ReportIdsFor(viewer, series.ReportEmployeeId), token, series);
            var onAgenda = upcoming.Agenda.Where(i => i.SourceKind is not null).Select(i => (i.SourceKind!.Value, i.SourceId!.Value)).ToHashSet();
            suggestions = all.Where(s => !onAgenda.Contains((s.Kind, s.SourceId))).ToList();
        }

        OneOnOneActionDto Action(OneOnOneActionItem a, Guid inMeeting) => new(a.Id, a.Text, a.OwnerEmployeeId, a.DueDate, a.DoneAt is not null,
            a.DoneAt, a.CreatedInMeetingId, byId.TryGetValue(a.CreatedInMeetingId, out var created) ? created.ScheduledAt : series.StartedAt,
            a.CreatedByEmployeeId, a.CreatedInMeetingId != inMeeting, a.DoneAt is null && a.DueDate is DateOnly due && due < today);

        var itemMeeting = meetings.SelectMany(m => m.Agenda.Select(i => (i.Id, m.ScheduledAt))).ToDictionary(x => x.Id, x => x.ScheduledAt);
        OneOnOneAgendaItemDto Item(OneOnOneAgendaItem i) => new(i.Id, i.Text, i.AuthorEmployeeId, i.HasNote, i.SourceKind, i.SourceId,
            AgendaHref(series.Id, i), i.Note, i.NoteRevision, i.FirstAddedAt,
            i.CarriedFromItemId is Guid from && itemMeeting.TryGetValue(from, out var fromAt) ? fromAt : null);

        OneOnOneMeetingDto Meeting(OneOnOneMeeting m)
        {
            var successorCompleted = m.NextMeetingId is Guid next && byId.TryGetValue(next, out var successor)
                && successor.State == OneOnOneMeetingState.Completed;
            var writable = !ended && (m.State == OneOnOneMeetingState.Upcoming || (m.State == OneOnOneMeetingState.Completed && !successorCompleted));
            var actions = m.State == OneOnOneMeetingState.Upcoming
                ? series.Actions.Where(a => a.DoneAt is null || a.DoneInMeetingId == m.Id)
                : series.Actions.Where(a => a.CreatedInMeetingId == m.Id || a.DoneInMeetingId == m.Id);
            var note = myNotes.GetValueOrDefault(m.Id);
            return new OneOnOneMeetingDto(m.Id, m.Version, m.ScheduledAt, m.State, m.CompletedAt,
                m.Agenda.OrderBy(i => i.Order).Select(Item).ToList(),
                new OneOnOnePrivateNoteDto(note?.Text ?? string.Empty, note?.Revision ?? 0), writable,
                actions.OrderBy(a => a.DoneAt is not null).ThenBy(a => a.DueDate ?? DateOnly.MaxValue).ThenBy(a => a.CreatedAt)
                    .Select(a => Action(a, m.Id)).ToList(),
                m.Id == upcoming?.Id ? suggestions : []);
        }

        var open = series.OpenActionItems();
        var canWrite = !ended && OneOnOnePolicy.CanWrite(series, me, viewer.ReviewsReports);
        return Result.Success(new OneOnOneSeriesDto(series.Id, series.Version,
            Person(series.ManagerEmployeeId, series.ManagerName, people), Person(series.ReportEmployeeId, series.ReportName, people),
            me == series.ManagerEmployeeId ? "Manager" : "Report", series.Cadence, series.StartedAt, series.StartedByEmployeeId,
            ended, series.EndedAt ?? (lineEnded ? PerformanceClock.UtcNow : null), series.EndReason ?? (lineEnded ? EndReasonFor(series, people!) : null),
            upcoming is null ? null : Meeting(upcoming),
            meetings.Where(m => m.Id != upcoming?.Id && m.State != OneOnOneMeetingState.Upcoming).Select(Meeting).ToList(),
            open.Count, open.Count(a => a.DueDate is DateOnly due && due < today),
            new OneOnOneCapabilitiesDto(canWrite))
        {
            First = meetings.All(m => m.State != OneOnOneMeetingState.Completed),
            CarriesTo = upcoming is null ? null : OneOnOneSchedule.Step(upcoming.ScheduledAt, series.Cadence),
            Context = await ContextAsync(series, viewer, people, token),
        });
    }

    /// <summary>What the 1:1 shows beside the agenda about the report; goals only through the plan's own read rule.</summary>
    private async Task<OneOnOneContextDto> ContextAsync(OneOnOneSeries series, OneOnOneViewer viewer, IReadOnlyList<WorkforceSnapshot>? people,
        CancellationToken token)
    {
        var report = series.ReportEmployeeId;
        var cycle = await db.Cycles.AsNoTracking().Where(c => c.State == CycleLifecycleState.Active)
            .OrderByDescending(c => c.StartDate).FirstOrDefaultAsync(token);
        var plan = cycle is null ? null : await OneOnOneSuggestions.ReadablePlanAsync(db, cycle.Id, report, viewer, token);
        var goals = plan is null ? [] : (await db.Objectives.AsNoTracking()
                .Where(o => o.EmployeePlanId == plan.Id && o.ArchivedAt == null).OrderBy(o => o.CreatedAt).ToListAsync(token))
            .Select(o => new OneOnOneGoalDto(o.Id, o.CycleId, o.Title, o.CurrentStatus, o.CurrentPercentage)).ToList();
        var approved = plan?.State == PlanLifecycleState.Approved;
        var praise = await PraisePolicy.Readable(db.Praise.AsNoTracking())
            .Where(p => p.Recipients.Any(r => r.EmployeeId == report)).OrderByDescending(p => p.GivenAt).FirstOrDefaultAsync(token);
        var snapshot = people?.FirstOrDefault(p => p.EmployeeId == report);
        return new OneOnOneContextDto(goals, approved, cycle is not null && !approved ? cycle.PlanningDeadline : null,
            praise is null ? null : new OneOnOnePraiseDto(praise.Id, praise.AuthorEmployeeId, praise.AuthorName, praise.Message, praise.GivenAt),
            snapshot?.EmploymentStart, snapshot?.OrgUnit?.Name);
    }

    public static OneOnOnePersonDto Person(Guid id, string storedName, IReadOnlyList<WorkforceSnapshot>? people)
    {
        var current = people?.FirstOrDefault(p => p.EmployeeId == id);
        return new OneOnOnePersonDto(id, current?.DisplayName ?? (string.IsNullOrWhiteSpace(storedName) ? "Former colleague" : storedName), current?.JobTitle);
    }

    private static string? AgendaHref(Guid seriesId, OneOnOneAgendaItem item) => (item.SourceKind, item.SourceId, item.SourceCycleId) switch
    {
        (AgendaSourceKind.Action, Guid id, _) => PerformanceNotificationTemplates.ActionLandingPath(seriesId, id),
        (AgendaSourceKind.Objective, Guid id, Guid cycle) => PerformanceNotificationTemplates.ObjectivePath(cycle, id),
        (AgendaSourceKind.Feedback, Guid id, _) => PerformanceNotificationTemplates.FeedbackPath(id),
        (AgendaSourceKind.Praise, Guid id, _) => PerformanceNotificationTemplates.PraisePath(id),
        (AgendaSourceKind.Review, Guid id, _) => PerformanceNotificationTemplates.ReviewPath(id),
        _ => null,
    };

    /// <summary>The viewer's current direct reports, for feedback suggestions; empty when Core is down.</summary>
    protected async Task<IReadOnlySet<Guid>> ReportIdsAsync(CancellationToken token)
    {
        try { return (await performanceViewer.CurrentLineAsync(token)).DirectReportIds; }
        catch (HttpRequestException) { return new HashSet<Guid>(); }
    }

    /// <summary>Who the caller can start 1:1s with, from Core's current line: their manager, or a direct report with the grant.</summary>
    protected static Result<OneOnOnePair> PairFor(Guid with, OneOnOneViewer viewer, CurrentLine line)
    {
        var me = viewer.EmployeeId;
        if (with != Guid.Empty && line.ManagerEmployeeId == with && line.Self is { Manager: { } manager } self)
            return Result.Success(new OneOnOnePair(with, me, manager.DisplayName, self.DisplayName,
                new OneOnOnePersonDto(manager.EmployeeId, manager.DisplayName, null)));
        if (with != Guid.Empty && line.DirectReports.FirstOrDefault(r => r.EmployeeId == with) is { } report)
            return viewer.ReviewsReports
                ? Result.Success(new OneOnOnePair(me, with, line.Self?.DisplayName ?? string.Empty, report.DisplayName,
                    new OneOnOnePersonDto(report.EmployeeId, report.DisplayName, report.JobTitle)))
                : Result.Failure<OneOnOnePair>(PerformanceErrors.Forbidden(PerformanceErrors.Codes.OneOnOneForbidden,
                    "Starting 1:1s with your team needs manager access."));
        return Result.Failure<OneOnOnePair>(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneNotReportingLine,
            "1:1s are between you and your current manager, or one of your direct reports."));
    }

    /// <summary>The caller's reports as far as suggestions need them: the report, when the caller is their manager.</summary>
    protected static IReadOnlySet<Guid> ReportIdsFor(OneOnOneViewer viewer, Guid reportId)
        => viewer.EmployeeId == reportId ? new HashSet<Guid>() : new HashSet<Guid> { reportId };

    protected static string NameOf(OneOnOneSeries series, Guid employeeId)
        => employeeId == series.ManagerEmployeeId ? series.ManagerName : series.ReportName;
}

/// <summary>What changed for a meeting's invite, so each change sends once to each person.</summary>
public static class OneOnOneInvites
{
    public static readonly Guid Cancelled = new("0f1e2d3c-4b5a-4968-8776-655443322110");

    /// <summary>Scheduled for, or moved to, <paramref name="at"/>: one invite per time.</summary>
    public static Guid ScheduledFor(Guid meetingId, DateTime at)
        => new(System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes($"{meetingId:N}:{at:O}")));
}

// ── Handlers ─────────────────────────────────────────────────────────────────

public sealed class GetOneOnOnesHandler(PerformanceDbContext db, PerformanceViewer viewer)
    : IQueryHandler<GetOneOnOnesQuery, Result<OneOnOnesDto>>
{
    public async Task<Result<OneOnOnesDto>> Handle(GetOneOnOnesQuery query, CancellationToken token)
    {
        var me = query.Viewer.EmployeeId;
        CurrentLine? line = null;
        try { line = await viewer.CurrentLineAsync(token); }
        catch (HttpRequestException) { /* Rows from stored state; nothing to start until Core HR answers. */ }

        var series = await OneOnOnePolicy.Readable(db.OneOnOneSeries.AsNoTracking(), me).ToListAsync(token);
        var ids = series.Select(s => s.Id).ToList();
        var windowStart = PerformanceClock.UtcNow - OneOnOneRhythm.LookBack;
        var meetings = (await db.OneOnOneMeetings.AsNoTracking()
                .Where(m => ids.Contains(m.SeriesId) && (m.State == OneOnOneMeetingState.Upcoming || m.ScheduledAt >= windowStart))
                .Select(m => new { m.Id, m.SeriesId, m.ScheduledAt, m.State, AgendaCount = m.Agenda.Count })
                .ToListAsync(token))
            .ToLookup(m => m.SeriesId);
        var lastMet = await db.OneOnOneMeetings.AsNoTracking()
            .Where(m => ids.Contains(m.SeriesId) && m.State == OneOnOneMeetingState.Completed)
            .GroupBy(m => m.SeriesId).Select(g => new { g.Key, At = g.Max(m => m.CompletedAt) })
            .ToDictionaryAsync(x => x.Key, x => x.At, token);
        var today = PerformanceClock.Today;
        var settings = await db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(token);
        var managerId = line?.ManagerEmployeeId;
        var reports = line?.DirectReports.ToDictionary(r => r.EmployeeId) ?? [];

        // Derived from Core: a series whose line no longer holds reads as ended even before the worker records it.
        bool Holds(OneOnOneSeries s) => s.IsActive && (line is null
            || (s.ReportEmployeeId == me ? s.ManagerEmployeeId == managerId : reports.ContainsKey(s.ReportEmployeeId)));

        OneOnOneRowDto Row(OneOnOneSeries s)
        {
            var otherId = s.OtherThan(me);
            var snapshot = otherId == managerId ? line?.Self?.Manager is { } m ? new OneOnOnePersonDto(m.EmployeeId, m.DisplayName, null) : null
                : reports.TryGetValue(otherId, out var r) ? new OneOnOnePersonDto(r.EmployeeId, r.DisplayName, r.JobTitle) : null;
            var with = snapshot ?? new OneOnOnePersonDto(otherId, otherId == s.ManagerEmployeeId ? s.ManagerName : s.ReportName, null);
            var open = s.OpenActionItems();
            var holds = Holds(s);
            var next = holds ? meetings[s.Id].Where(m => m.State == OneOnOneMeetingState.Upcoming).MinBy(m => m.ScheduledAt) : null;
            return new OneOnOneRowDto(s.Id, with, s.Cadence, next?.ScheduledAt, open.Count,
                open.Count(a => a.DueDate is DateOnly due && due < today), !holds, s.EndedAt)
            {
                NextMeetingId = next?.Id,
                AgendaCount = next?.AgendaCount ?? 0,
                LastMetAt = lastMet.GetValueOrDefault(s.Id),
                Recent = meetings[s.Id].Where(m => m.State != OneOnOneMeetingState.Upcoming || m.Id == next?.Id)
                    .OrderBy(m => m.ScheduledAt).Select(m => new OneOnOneBeatDto(m.ScheduledAt, m.State)).ToList(),
            };
        }

        var active = series.Where(Holds).ToList();
        var rows = active.ToDictionary(s => s.Id, Row);
        var withManager = active.FirstOrDefault(s => s.ReportEmployeeId == me);
        var reportRows = active.Where(s => s.ManagerEmployeeId == me).Select(s => rows[s.Id])
            .OrderBy(r => r.NextMeetingAt ?? DateTime.MaxValue).ThenBy(r => r.With.DisplayName).ToList();
        var covered = active.Where(s => s.ManagerEmployeeId == me).Select(s => s.ReportEmployeeId).ToHashSet();
        var startWithReports = query.Viewer.ReviewsReports
            ? reports.Values.Where(r => !covered.Contains(r.EmployeeId)).OrderBy(r => r.DisplayName)
                .Select(r => new OneOnOneStartOptionDto(new OneOnOnePersonDto(r.EmployeeId, r.DisplayName, r.JobTitle))).ToList()
            : [];
        var startWithManager = withManager is null && line?.Self?.Manager is { IsActive: true } manager
            ? new OneOnOneStartOptionDto(new OneOnOnePersonDto(manager.EmployeeId, manager.DisplayName, null))
            : null;
        var ended = series.Where(s => !Holds(s)).Select(Row).OrderByDescending(r => r.EndedAt ?? DateTime.MaxValue).ToList();
        var myActions = active
            .SelectMany(s => s.OpenActionItems().Where(a => a.OwnerEmployeeId == me)
                .Select(a => new OneOnOneOwedActionDto(s.Id, a.Id, a.Text, rows[s.Id].With, a.DueDate, a.DueDate is DateOnly due && due < today)))
            .OrderBy(a => a.DueDate ?? DateOnly.MaxValue).ThenBy(a => a.With.DisplayName).ToList();

        return Result.Success(new OneOnOnesDto(withManager is null ? null : rows[withManager.Id], startWithManager, reportRows, startWithReports,
            ended, settings?.DefaultOneOnOneCadence ?? OneOnOneCadence.EveryTwoWeeks, line is not null) { MyActions = myActions });
    }
}

public sealed class GetOneOnOneSeriesHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), IQueryHandler<GetOneOnOneSeriesQuery, Result<OneOnOneSeriesDto>>
{
    public Task<Result<OneOnOneSeriesDto>> Handle(GetOneOnOneSeriesQuery query, CancellationToken token)
        => ProjectAsync(query.SeriesId, query.Viewer, token);
}

public sealed class StartOneOnOneHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer,
    IPerformanceAudit audit, IPerformanceNotifications notifications, ITenantContext tenant)
    : OneOnOneHandlerBase(db, workforce, viewer, audit, notifications), ICommandHandler<StartOneOnOneCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(StartOneOnOneCommand command, CancellationToken token)
    {
        var me = command.Viewer.EmployeeId;
        CurrentLine line;
        try { line = await viewer.CurrentLineAsync(token); }
        catch (HttpRequestException) { return Fail(PerformanceErrors.CoreUnavailable()); }
        var pair = PairFor(command.Request.WithEmployeeId, command.Viewer, line);
        if (pair.IsFailure) return Fail(pair.Error);
        var (managerId, reportId, managerName, reportName, _) = pair.Value;

        var existing = await Db.OneOnOneSeries.AsNoTracking()
            .FirstOrDefaultAsync(s => s.ManagerEmployeeId == managerId && s.ReportEmployeeId == reportId && s.EndedAt == null, token);
        if (existing is not null)
            return Fail(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneAlreadyActive,
                "You already have 1:1s together.", new { seriesId = existing.Id }));

        var cadence = command.Request.Cadence
            ?? (await Db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(token))?.DefaultOneOnOneCadence
            ?? OneOnOneCadence.EveryTwoWeeks;
        var tenantId = tenant.TenantId;
        OneOnOneSeries series;
        try
        {
            (series, var first) = OneOnOneSeries.Start(tenantId, managerId, reportId, cadence, me, command.Request.FirstMeetingAt,
                PerformanceClock.UtcNow, managerName, reportName);
            if (await FirstAgendaAsync(first, reportId, command, token) is { } refused) return refused;
            Db.OneOnOneSeries.Add(series);
            Db.OneOnOneMeetings.Add(first);
            notifications.EnqueueInvite(series, first.Id, OneOnOneInvites.ScheduledFor(first.Id, first.ScheduledAt));
        }
        catch (ArgumentException ex) { return Invalid(ex); }

        audit.Record(tenantId, "OneOnOneSeries", series.Id, null, PerformanceAuditActions.OneOnOneStarted,
            new { managerEmployeeId = managerId, reportEmployeeId = reportId, cadence = cadence.ToString(), startedBy = me });
        notifications.EnqueueConversation(tenantId, PerformanceNotificationKind.OneOnOneStarted, series.OtherThan(me), me,
            "OneOnOneSeries", series.Id, series.Id, PerformanceNotificationTemplates.ForOneOnOneStarted(NameOf(series, me), series.Id));
        return await SaveAsync(series.Id, command.Viewer, token);
    }

    public const int MaxFirstAgenda = 10;

    /// <summary>
    /// Talking points chosen while starting: written text, or a suggestion offered for the pair right now. Starting with
    /// none, a first 1:1 opens on Fusion's starter agenda (D-66).
    /// </summary>
    private async Task<Result<OneOnOneSeriesDto>?> FirstAgendaAsync(OneOnOneMeeting first, Guid reportId, StartOneOnOneCommand command,
        CancellationToken token)
    {
        var items = command.Request.Agenda ?? [];
        if (items.Count == 0)
        {
            foreach (var key in OneOnOneStarters.Keys)
                first.AddAgendaItem(Guid.NewGuid(), key, command.Viewer.EmployeeId, new AgendaSource(AgendaSourceKind.Starter, Guid.Empty, null), out _);
            return null;
        }
        if (items.Count > MaxFirstAgenda)
            return Fail(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneInvalid, $"Start with up to {MaxFirstAgenda} talking points."));
        var offered = items.Any(i => i.SourceKind is not null)
            ? await new OneOnOneSuggestions(Db).ForAsync(reportId, command.Viewer, PerformanceClock.UtcNow - OneOnOneSuggestions.FirstMeetingLookBack,
                ReportIdsFor(command.Viewer, reportId), token)
            : [];
        foreach (var item in items)
        {
            var text = item.Text;
            AgendaSource? source = null;
            if (item.SourceKind is AgendaSourceKind kind)
            {
                if (offered.FirstOrDefault(o => o.Kind == kind && o.SourceId == item.SourceId) is not { } suggestion)
                    return Fail(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneInvalid, "That isn't something you can add here."));
                (source, text) = (OneOnOneSuggestions.SourceOf(suggestion), OneOnOneSuggestions.AgendaText(suggestion));
            }
            try { first.AddAgendaItem(item.Id, text ?? string.Empty, command.Viewer.EmployeeId, source, out _); }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        }
        return null;
    }
}

public sealed class GetOneOnOneStartHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), IQueryHandler<GetOneOnOneStartQuery, Result<OneOnOneStartDto>>
{
    public async Task<Result<OneOnOneStartDto>> Handle(GetOneOnOneStartQuery query, CancellationToken token)
    {
        CurrentLine line;
        try { line = await viewer.CurrentLineAsync(token); }
        catch (HttpRequestException) { return Result.Failure<OneOnOneStartDto>(PerformanceErrors.CoreUnavailable()); }
        var pair = PairFor(query.WithEmployeeId, query.Viewer, line);
        if (pair.IsFailure) return Result.Failure<OneOnOneStartDto>(pair.Error);
        var (managerId, reportId, _, _, with) = pair.Value;
        if (await Db.OneOnOneSeries.AsNoTracking().FirstOrDefaultAsync(
                s => s.ManagerEmployeeId == managerId && s.ReportEmployeeId == reportId && s.EndedAt == null, token) is { } existing)
            return Result.Failure<OneOnOneStartDto>(PerformanceErrors.InvalidState(PerformanceErrors.Codes.OneOnOneAlreadyActive,
                "You already have 1:1s together.", new { seriesId = existing.Id }));

        var suggestions = await new OneOnOneSuggestions(Db).ForAsync(reportId, query.Viewer,
            PerformanceClock.UtcNow - OneOnOneSuggestions.FirstMeetingLookBack, ReportIdsFor(query.Viewer, reportId), token);
        var cadence = (await Db.CycleSettings.AsNoTracking().FirstOrDefaultAsync(token))?.DefaultOneOnOneCadence ?? OneOnOneCadence.EveryTwoWeeks;
        return Result.Success(new OneOnOneStartDto(with, cadence, suggestions));
    }
}

public sealed class ChangeOneOnOneCadenceHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer, IPerformanceAudit audit)
    : OneOnOneHandlerBase(db, workforce, viewer, audit), ICommandHandler<ChangeOneOnOneCadenceCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(ChangeOneOnOneCadenceCommand command, CancellationToken token)
    {
        var series = await SeriesAsync(command.SeriesId, command.Viewer, tracked: true, token);
        if (series is null) return NotFound(command.SeriesId);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        if (VersionGuard.Check(series, command.Request.ExpectedVersion) is { } stale) return Fail(stale);
        try
        {
            var before = series.Cadence;
            if (series.ChangeCadence(command.Request.Cadence))
                audit.Record(series.TenantId, "OneOnOneSeries", series.Id, null, PerformanceAuditActions.OneOnOneCadenceChanged,
                    new { before = before.ToString(), after = series.Cadence.ToString() });
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

public sealed class RescheduleOneOnOneHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer,
    IPerformanceAudit audit, IPerformanceNotifications notifications)
    : OneOnOneHandlerBase(db, workforce, viewer, audit, notifications), ICommandHandler<RescheduleOneOnOneCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(RescheduleOneOnOneCommand command, CancellationToken token)
    {
        if (await MeetingAsync(command.MeetingId, command.Viewer, token) is not ({ } meeting, { } series)) return NotFound(command.MeetingId);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        if (VersionGuard.Check(meeting, command.Request.ExpectedVersion) is { } stale) return Fail(stale);
        var before = meeting.ScheduledAt;
        try { meeting.Reschedule(command.Request.ScheduledAt, PerformanceClock.UtcNow); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        if (meeting.ScheduledAt != before)
        {
            var me = command.Viewer.EmployeeId;
            audit.Record(series.TenantId, "OneOnOneMeeting", meeting.Id, null, PerformanceAuditActions.OneOnOneRescheduled,
                new { seriesId = series.Id, before, after = meeting.ScheduledAt });
            // One notification per new time: a reschedule to a third time notifies again.
            var transition = OneOnOneInvites.ScheduledFor(meeting.Id, meeting.ScheduledAt);
            notifications.EnqueueConversation(series.TenantId, PerformanceNotificationKind.OneOnOneRescheduled, series.OtherThan(me), me,
                "OneOnOneSeries", series.Id, transition, PerformanceNotificationTemplates.ForOneOnOneRescheduled(NameOf(series, me), series.Id));
            notifications.EnqueueInvite(series, meeting.Id, transition);
        }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

public sealed class AddAgendaItemHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<AddAgendaItemCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(AddAgendaItemCommand command, CancellationToken token)
    {
        if (await MeetingAsync(command.MeetingId, command.Viewer, token) is not ({ } meeting, { } series)) return NotFound(command.MeetingId);
        if (meeting.Agenda.Any(i => i.Id == command.Request.Id)) return await ProjectAsync(series.Id, command.Viewer, token);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;

        var request = command.Request;
        var text = request.Text;
        AgendaSource? source = null;
        if (request.SourceKind is AgendaSourceKind kind)
        {
            // Only what the caller is offered as a suggestion can be added by source; the label is the server's.
            var since = await Db.OneOnOneMeetings.AsNoTracking().Where(m => m.SeriesId == series.Id && m.State == OneOnOneMeetingState.Completed)
                .MaxAsync(m => m.CompletedAt, token) ?? series.StartedAt - OneOnOneSuggestions.FirstMeetingLookBack;
            var offered = (await new OneOnOneSuggestions(Db).ForAsync(series.ReportEmployeeId, command.Viewer, since,
                    ReportIdsFor(command.Viewer, series.ReportEmployeeId), token, series))
                .FirstOrDefault(s => s.Kind == kind && s.SourceId == request.SourceId);
            if (offered is null) return Fail(PerformanceErrors.Validation(PerformanceErrors.Codes.OneOnOneInvalid, "That isn't something you can add here."));
            (source, text) = (OneOnOneSuggestions.SourceOf(offered), OneOnOneSuggestions.AgendaText(offered));
        }
        try
        {
            meeting.AddAgendaItem(request.Id, text ?? string.Empty, command.Viewer.EmployeeId, source, out _);
            if (!string.IsNullOrWhiteSpace(request.Note))
                meeting.SetItemNote(request.Id, request.Note, 0, successorCompleted: false, PerformanceClock.UtcNow);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

/// <summary>
/// Writes an item's note (D-64): a note marks it talked about. Noting an item after its meeting completed drops the
/// copy that carried onto the next one, unless that copy has a note of its own.
/// </summary>
public sealed class SetAgendaNoteHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<SetAgendaNoteCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(SetAgendaNoteCommand command, CancellationToken token)
    {
        if (await MeetingAsync(command.MeetingId, command.Viewer, token) is not ({ } meeting, { } series)) return NotFound(command.MeetingId);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        var successorCompleted = await SetPrivateNotesHandler.SuccessorCompletedAsync(Db, meeting, token);
        try
        {
            meeting.SetItemNote(command.ItemId, command.Request.Text, command.Request.ExpectedRevision, successorCompleted, PerformanceClock.UtcNow);
            if (meeting.State == OneOnOneMeetingState.Completed && meeting.Item(command.ItemId).HasNote && meeting.NextMeetingId is Guid nextId
                && await Db.OneOnOneMeetings.FirstOrDefaultAsync(m => m.Id == nextId, token) is { } next)
                next.DropCarriedCopy(command.ItemId);
        }
        catch (OneOnOneNotesConflictException)
        {
            // The conflict carries the current note so the client can show it beside the unsaved text.
            var item = meeting.Item(command.ItemId);
            return Fail(PerformanceErrors.Create(PerformanceErrors.Codes.OneOnOneNotesChanged, "These notes changed since you opened them.",
                FailureKind.Stale, new { text = item.Note, revision = item.NoteRevision }));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or KeyNotFoundException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

public sealed class RemoveAgendaItemHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<RemoveAgendaItemCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(RemoveAgendaItemCommand command, CancellationToken token)
    {
        if (await MeetingAsync(command.MeetingId, command.Viewer, token) is not ({ } meeting, { } series)) return NotFound(command.MeetingId);
        if (meeting.Agenda.All(i => i.Id != command.ItemId)) return await ProjectAsync(series.Id, command.Viewer, token);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        try { meeting.RemoveAgendaItem(command.ItemId, command.Viewer.EmployeeId); }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

public sealed class SetPrivateNotesHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<SetPrivateNotesCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(SetPrivateNotesCommand command, CancellationToken token)
    {
        if (await MeetingAsync(command.MeetingId, command.Viewer, token) is not ({ } meeting, { } series)) return NotFound(command.MeetingId);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        var me = command.Viewer.EmployeeId;
        try
        {
            meeting.EnsureNotesWritable(await SuccessorCompletedAsync(Db, meeting, token));
            var note = await Db.OneOnOnePrivateNotes.FirstOrDefaultAsync(n => n.MeetingId == meeting.Id && n.AuthorEmployeeId == me, token);
            if (note is null)
            {
                note = OneOnOnePrivateNote.Create(series.TenantId, meeting.Id, me);
                Db.OneOnOnePrivateNotes.Add(note);
            }
            note.Set(command.Request.Text, command.Request.ExpectedRevision);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or OneOnOneNotesConflictException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }

    internal static async Task<bool> SuccessorCompletedAsync(PerformanceDbContext db, OneOnOneMeeting meeting, CancellationToken token)
        => meeting.NextMeetingId is Guid next
            && await db.OneOnOneMeetings.AsNoTracking().AnyAsync(m => m.Id == next && m.State == OneOnOneMeetingState.Completed, token);
}

public sealed class AddActionHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer,
    IPerformanceNotifications notifications)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<AddActionCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(AddActionCommand command, CancellationToken token)
    {
        var series = await SeriesAsync(command.SeriesId, command.Viewer, tracked: true, token);
        if (series is null) return NotFound(command.SeriesId);
        if (series.Actions.Any(a => a.Id == command.Request.Id)) return await ProjectAsync(series.Id, command.Viewer, token);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        var upcoming = await Db.OneOnOneMeetings.AsNoTracking()
            .FirstOrDefaultAsync(m => m.SeriesId == series.Id && m.State == OneOnOneMeetingState.Upcoming, token);
        if (upcoming is null) return SeriesEnded();
        var me = command.Viewer.EmployeeId;
        try
        {
            var item = series.AddAction(command.Request.Id, command.Request.Text, command.Request.OwnerEmployeeId, command.Request.DueDate,
                upcoming.Id, me, out var added);
            if (added)
                notifications.EnqueueConversation(series.TenantId, PerformanceNotificationKind.OneOnOneActionAssigned, item.OwnerEmployeeId, me,
                    "OneOnOneSeries", series.Id, item.Id,
                    PerformanceNotificationTemplates.ForOneOnOneActionAssigned(NameOf(series, me), item.Text, series.Id, item.Id));
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

public sealed class EditActionHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<EditActionCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(EditActionCommand command, CancellationToken token)
    {
        var series = await SeriesAsync(command.SeriesId, command.Viewer, tracked: true, token);
        if (series is null) return NotFound(command.SeriesId);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        var action = series.Actions.FirstOrDefault(a => a.Id == command.ActionId);
        if (action is null) return Fail(PerformanceErrors.NotFound("OneOnOneAction", command.ActionId));
        if (action.CreatedByEmployeeId != command.Viewer.EmployeeId)
            return Fail(PerformanceErrors.Forbidden(PerformanceErrors.Codes.OneOnOneForbidden, "Only the person who added an action item edits it."));
        try { series.EditAction(action.Id, command.Request.Text, command.Request.OwnerEmployeeId, command.Request.DueDate); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}

public sealed class SetActionDoneHandler(PerformanceDbContext db, ICoreWorkforceClient workforce, PerformanceViewer viewer)
    : OneOnOneHandlerBase(db, workforce, viewer), ICommandHandler<SetActionDoneCommand, Result<OneOnOneSeriesDto>>
{
    public async Task<Result<OneOnOneSeriesDto>> Handle(SetActionDoneCommand command, CancellationToken token)
    {
        var series = await SeriesAsync(command.SeriesId, command.Viewer, tracked: true, token);
        if (series is null) return NotFound(command.SeriesId);
        if (await GuardWriteAsync(series, command.Viewer, token) is { } refused) return refused;
        var upcoming = await Db.OneOnOneMeetings.AsNoTracking()
            .FirstOrDefaultAsync(m => m.SeriesId == series.Id && m.State == OneOnOneMeetingState.Upcoming, token);
        if (upcoming is null) return SeriesEnded();
        try { series.SetActionDone(command.ActionId, command.Done, upcoming.Id, PerformanceClock.UtcNow); }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or KeyNotFoundException) { return Invalid(ex); }
        return await SaveAsync(series.Id, command.Viewer, token);
    }
}
