namespace EY.HRPlatform.SharedKernel.Api;

// The cross-module attention contract (D-29, D-30), mirrored by `@repo/api` fusion-attention.ts.
// Each module serves its own items at `GET /api/{module}/work`, composing display text in English.

/// <summary>The person a work item concerns, when it isn't the viewer.</summary>
public sealed record FusionWorkSubjectDto(string DisplayName);

/// <summary>One step of the path a work item belongs to. <paramref name="State"/> is `done`, `current` or `upcoming`.</summary>
public sealed record FusionWorkStepDto(string Label, string? Detail, string State)
{
    public const string Done = "done";
    public const string Current = "current";
    public const string Upcoming = "upcoming";
}

/// <summary>
/// Something the person must do. Derived from the module's current state, so it disappears as soon as
/// the work is done. <paramref name="Id"/> is stable (`{module}:{kind}:{resourceId}`) and
/// <paramref name="Href"/> is the absolute in-app path where the work is done. <paramref name="Section"/> is the
/// module navigation path the item is counted under in the Fusion sidebar (e.g. `/performance/team`).
/// <paramref name="Steps"/> is the path the work belongs to, so the home can show where it stands.
/// <paramref name="ActionLabel"/> names what the work's button does ("Review plan", "Record progress"); the home falls
/// back to "Open" when a module doesn't say. <paramref name="WaitingSince"/> is the UTC instant since which another person
/// has been blocked until the viewer acts (a submitted plan, a peer request); null when nobody waits on it.
/// </summary>
public sealed record FusionWorkItemDto(
    string Id,
    string Module,
    string Kind,
    string Title,
    string? Context,
    DateOnly? DueOn,
    string Href,
    FusionWorkSubjectDto? Subject = null,
    string? Section = null,
    IReadOnlyList<FusionWorkStepDto>? Steps = null,
    string? ActionLabel = null,
    DateTime? WaitingSince = null,
    FusionWorkDecisionDto? Decision = null);

/// <summary>
/// A yes or no the home can give in place (B-179): paths below the module's gateway prefix for approving and declining;
/// declining sends <c>{ "reason": "…" }</c>, which is required.
/// </summary>
public sealed record FusionWorkDecisionDto(string ApprovePath, string DeclinePath);

/// <summary>
/// Something dated that isn't work (a 1:1, a deadline, a cycle's end), served at `GET /api/{module}/upcoming`.
/// <paramref name="At"/> is the UTC instant when the moment has a time. <paramref name="Covers"/> names the work-item
/// kinds this moment summarizes for its date, so the home doesn't list those items a second time.
/// </summary>
public sealed record FusionUpcomingDto(
    string Id,
    string Module,
    string Kind,
    string Title,
    string? Context,
    DateOnly Date,
    DateTime? At,
    string Href,
    IReadOnlyList<string>? Covers = null);

/// <summary>
/// Something that happened for the person, served at `GET /api/{module}/notifications` (`@repo/api` FusionNotification).
/// Title and context are worded in the reader's language. <paramref name="Badge"/> is the kind's family (praise, feedback,
/// meeting, action, plan, review, reminder, team), so the bell marks it without knowing a module's kinds.
/// </summary>
public sealed record FusionNotificationDto(string Id, string Module, string Kind, string Title, string? Context,
    string? ActorName, Guid? ActorEmployeeId, string Badge, DateTime OccurredAt, string Href, DateTime? ReadAt);

public sealed record FusionNotificationPageDto(IReadOnlyList<FusionNotificationDto> Items, int UnreadCount, string? NextCursor);
public sealed record MarkNotificationsReadRequest(IReadOnlyList<Guid>? Ids, bool? All);
public sealed record MarkNotificationsReadResultDto(int UnreadCount);
