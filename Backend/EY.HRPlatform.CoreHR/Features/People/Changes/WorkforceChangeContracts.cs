using System.ComponentModel.DataAnnotations;
using EY.HRPlatform.CoreHR.Domain.Entities;

namespace EY.HRPlatform.CoreHR.Features.People.Changes;

// --- Requests -------------------------------------------------------------------------------------

/// <summary>
/// A change of job: any mix of manager, unit, job and place on one date. A null part stays as it is;
/// <paramref name="RemoveManager"/> leaves the person without a manager, by choice, and
/// <paramref name="RemovePlace"/> leaves them without a place.
/// </summary>
public sealed record JobChangeRequest(
    DateTime EffectiveDate,
    Guid? ManagerEmployeeId = null,
    bool RemoveManager = false,
    TeamOutcomeRequest? Team = null,
    Guid? OrgUnitId = null,
    Guid? JobId = null,
    Guid? PlaceId = null,
    bool RemovePlace = false,
    [MaxLength(1000)] string? Note = null);

/// <summary>What happens to the person's direct reports: they go along (default) or stay, reporting to someone.</summary>
public sealed record TeamOutcomeRequest(bool Stays, Guid? ManagerEmployeeId = null);

/// <summary>
/// The last day of employment. Each report goes to their entry's manager (null = no manager, by choice) or, when
/// not listed, to the leaver's manager.
/// </summary>
public sealed record EndEmploymentChangeRequest(
    DateTime LastDay,
    IReadOnlyList<ReportReassignmentRequest>? Reports = null,
    [MaxLength(1000)] string? Note = null);

public sealed record ReportReassignmentRequest(Guid EmployeeId, Guid? ManagerEmployeeId);

/// <summary>Starts employment again for a former employee (rehire).</summary>
public sealed record JoinChangeRequest(
    DateTime StartDate,
    Guid OrgUnitId,
    Guid JobId,
    Guid? PlaceId = null,
    Guid? ManagerEmployeeId = null,
    Guid? EmploymentTypeId = null,
    [MaxLength(1000)] string? Note = null);

/// <summary>Replaces a scheduled change with a new one of the same kind; exactly one part is set.</summary>
public sealed record EditChangeRequest(
    JobChangeRequest? Job = null,
    EndEmploymentChangeRequest? End = null,
    JoinChangeRequest? Join = null);

// --- Read model -----------------------------------------------------------------------------------

public sealed record ChangePersonRef(Guid EmployeeId, string EmployeeKey, string DisplayName);

public sealed record ReassignedReport(ChangePersonRef Person, ChangePersonRef? Manager);

public sealed record EndedDottedLine(ChangePersonRef Person, ChangePersonRef Manager);

/// <summary>
/// What a change did, captured when it was made: the before → after of the person's place (only changed parts
/// set on the "to" side) and its ripple. It is the record's own account, so it stays true after later changes:
/// a job renamed in the catalogue later keeps the name it had here. The ids let an edit start from the same picks.
/// </summary>
public sealed record WorkforceChangeDetails(
    ChangePersonRef? ManagerFrom = null,
    ChangePersonRef? ManagerTo = null,
    bool ManagerChanged = false,
    Guid? UnitFromId = null,
    string? UnitFrom = null,
    Guid? UnitToId = null,
    string? UnitTo = null,
    string? TitleFrom = null,
    string? TitleTo = null,
    string? LocationFrom = null,
    string? LocationTo = null,
    bool UnitChanged = false,
    bool TitleChanged = false,
    bool LocationChanged = false,
    /// <summary>"Along" or "Stays" when the person had reports; null otherwise.</summary>
    string? TeamOutcome = null,
    int TeamCount = 0,
    ChangePersonRef? TeamManager = null,
    IReadOnlyList<ReassignedReport>? Reassigned = null,
    IReadOnlyList<EndedDottedLine>? DottedLinesEnded = null,
    DateOnly? LastDay = null,
    bool IsHire = false,
    string? EmploymentType = null,
    Guid? JobFromId = null,
    Guid? JobToId = null,
    Guid? PlaceFromId = null,
    Guid? PlaceToId = null,
    Guid? EmploymentTypeId = null)
{
    /// <summary>A change a reporting admin may make: it touches only who the person (and their team) report to.</summary>
    public bool IsReportingOnly => !UnitChanged && !TitleChanged && !LocationChanged;
}

public sealed record WorkforceChangeDto(
    Guid Id,
    WorkforceChangeKind Kind,
    DateOnly EffectiveDate,
    WorkforceChangeStatus Status,
    bool CanCancel,
    bool CanEdit,
    ChangePersonRef Person,
    string? CreatedBy,
    DateTime CreatedAt,
    string? Note,
    WorkforceChangeDetails Details);

/// <summary>A report of someone ending employment and what happens to them.</summary>
/// <param name="Outcome">"Reassign" (needs a manager from the day after), "LeavesFirst" or "MovesFirst".</param>
public sealed record EndEmploymentReportDto(
    ChangePersonRef Person,
    string? JobTitle,
    int DirectReportCount,
    string Outcome,
    DateOnly? OutcomeDate);

public sealed record EndEmploymentChangePreviewDto(
    DateOnly LastDay,
    ChangePersonRef? DefaultManager,
    IReadOnlyList<EndEmploymentReportDto> Reports,
    IReadOnlyList<EndedDottedLine> DottedLinesEnding);
