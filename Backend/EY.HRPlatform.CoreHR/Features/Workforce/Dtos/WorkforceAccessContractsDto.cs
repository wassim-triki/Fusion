namespace EY.HRPlatform.CoreHR.Features.Workforce.Dtos;

/// <summary>
/// Browser-facing Workforce Access boundary contract (Chunk A, task 2.9).
///
/// These are the fully server-resolved projections the customer-facing CoreHR
/// orchestration returns to the browser. CoreHR owns the canonical Employee facts and
/// obtains the non-disclosing account-state outcome from Identity over the signed
/// internal contract (<c>internal/identity/workforce-access/candidates</c>), then joins
/// them here. The browser therefore never joins untrusted Identity and CoreHR facts
/// itself, and a command never carries a forgeable Employee identity fact — only an
/// Employee reference, the reviewed baseline choice, and an optimistic-concurrency
/// token. CoreHR re-resolves the canonical subject and Identity rechecks state at
/// commit; a previously returned candidate is guidance, never authority.
///
/// The account-state vocabulary mirrors Identity's
/// <c>WorkforceAccountCandidateOutcome</c> exactly and is carried as a stable string,
/// matching the established roster projection pattern. Account or tenant identifiers
/// from another workspace are never returned.
/// </summary>
public static class WorkforceAccountStates
{
    public const string NewAccount = "NewAccount";
    public const string ExistingAccountReadyToLink = "ExistingAccountReadyToLink";
    public const string Active = "Active";
    public const string BindingConflict = "BindingConflict";
    public const string SuspendedAccountReadyToReactivate = "SuspendedAccountReadyToReactivate";
    public const string ExistingAccountReadyToJoinTenant = "ExistingAccountReadyToJoinTenant";
    public const string AccountUnavailable = "AccountUnavailable";
}

/// <summary>The reviewed workforce baseline slot decided per person.</summary>
public static class WorkforceBaselineChoices
{
    public const string Employee = "Employee";
    public const string Manager = "Manager";
}

/// <summary>
/// One fully-resolved single-person workforce-access candidate. Canonical Employee
/// facts joined with the non-disclosing account-state outcome and the reviewed baseline
/// recommendation. <see cref="AccountEmail"/> is populated only for same-tenant
/// outcomes; another workspace's account identity is never returned.
/// </summary>
public sealed record WorkforceAccessCandidateDto(
    Guid EmployeeId,
    string StableEmployeeKey,
    string? EmployeeNumber,
    string DisplayName,
    string FullName,
    string? WorkEmail,
    string? JobTitle,
    string EmploymentStatus,
    bool IsActive,
    WorkforceOrgAssignmentDto? OrgUnit,
    WorkforceManagerSummaryDto? Manager,
    int DirectReportCount,
    string AccountState,
    string AccountStateLabel,
    string? AccountEmail,
    string RecommendedBaseline,
    IReadOnlyList<string> AvailableActions,
    string? BlockedReason,
    uint Version,
    bool IsAdministrator = false,
    IReadOnlyList<string>? AdditionalAccess = null,
    // Access revision of the bound same-tenant membership, when one exists. The
    // optimistic-concurrency token a correction command echoes back so a stale review
    // is refused. Null when there is no bound membership (e.g. no account yet).
    int? AccountRevision = null);

/// <summary>Request to resolve access candidates for an explicitly selected cohort.</summary>
public sealed record WorkforceAccessCandidatesRequest(
    IReadOnlyList<Guid> EmployeeIds);

/// <summary>
/// The explicit confirmation an existing-account mutation presents before commit. It
/// names the canonical Employee, the account email, the tenant participation outcome,
/// and the reviewed baseline. The server re-resolves at commit; this is not a lock.
/// </summary>
public sealed record WorkforceAccessConfirmationDto(
    Guid EmployeeId,
    string EmployeeDisplayName,
    string? AccountEmail,
    string AccountState,
    string ParticipationOutcome,
    string BaselineChoice,
    uint ExpectedVersion);

/// <summary>
/// Trusted browser-to-CoreHR command carrying only the Employee reference, reviewed
/// baseline, and concurrency token — never a forgeable Employee identity fact.
/// </summary>
public sealed record WorkforceAccessCommand(
    Guid EmployeeId,
    string Baseline,
    uint ExpectedVersion);

/// <summary>
/// Focused single-person correction command. Carries the current and target Employee
/// references, reviewed baseline, required reason, and concurrency token. No account
/// deletion and no bulk correction is expressible.
/// </summary>
public sealed record WorkforceAccessCorrectionCommand(
    Guid EmployeeId,
    Guid TargetEmployeeId,
    string Baseline,
    string Reason,
    uint ExpectedVersion);

/// <summary>
/// Typed per-command outcome. Stale/Conflict/Unavailable/Blocked are non-disclosing
/// fail-closed results — the client re-fetches the candidate rather than joining facts.
/// </summary>
public sealed record WorkforceAccessCommandResultDto(
    Guid EmployeeId,
    string Outcome,
    string? AccountState,
    string Message,
    uint? Version);

/// <summary>
/// One moment of the person's account story on Person › Access › History (B-231). <c>Kind</c>: Invited, SentAgain,
/// Delivered, NotDelivered, Withdrawn, Accepted, SignedIn (the last sign-in; only the latest is kept), RoleGiven or
/// RoleRemoved (B-314: <c>RoleName</c>, and <c>ByRule</c> when a rule rather than someone did it).
/// </summary>
public sealed record WorkforceAccountHistoryEventDto(
    string Kind,
    DateTime OccurredAt,
    string? ActorName,
    string? Email,
    DateTime? ValidUntil,
    string? RoleName,
    bool ByRule);

/// <summary>One reviewed line in a bulk Activation Plan: an Employee reference and the
/// reviewed Employee/Manager baseline. No forgeable Employee identity fact is carried.</summary>
public sealed record WorkforceAccessBulkItem(
    Guid EmployeeId,
    string Baseline);

/// <summary>An explicitly selected cohort to activate. CoreHR re-resolves every subject
/// and commits each independently; a failure on one never rolls back the others.</summary>
public sealed record WorkforceAccessBulkRequest(
    IReadOnlyList<WorkforceAccessBulkItem> Items);

/// <summary>One person's independent bulk outcome, preserved whether or not others fail.</summary>
public sealed record WorkforceAccessBulkResultItemDto(
    Guid EmployeeId,
    string DisplayName,
    string Outcome,
    string? AccountState,
    string Message);

/// <summary>Stable bulk receipt: every person's independent outcome plus grouped tallies.</summary>
public sealed record WorkforceAccessBulkResultDto(
    IReadOnlyList<WorkforceAccessBulkResultItemDto> Items,
    int Invited,
    int Linked,
    int Reactivated,
    int AlreadyActive,
    int Blocked,
    int Failed);
