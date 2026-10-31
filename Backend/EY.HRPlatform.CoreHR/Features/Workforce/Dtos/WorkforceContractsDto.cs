using EY.HRPlatform.CoreHR.Models.Responses;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Dtos;

public sealed record WorkforceManagerSummaryDto(
    Guid EmployeeId,
    string DisplayName,
    string? Email,
    bool IsActive);

public sealed record WorkforceOrgAssignmentDto(
    Guid OrgUnitId,
    string StableOrgUnitKey,
    string Name,
    string Type,
    string? ParentStableOrgUnitKey,
    string Path,
    int Level,
    bool IsActive);

public sealed record WorkforceDataQualityDto(
    string State,
    bool HasEmployeeStateIssues,
    bool HasOperationalBlockers,
    IReadOnlyList<string> IssueCodes);

public sealed record WorkforceEmployeeSummaryDto(
    Guid EmployeeId,
    string StableEmployeeKey,
    string EmployeeNumber,
    string FirstName,
    string LastName,
    string? PreferredName,
    string DisplayName,
    string FullName,
    string? WorkEmail,
    string? JobTitle,
    DateTime HireDate,
    string EmploymentStatus,
    bool IsActive,
    WorkforceOrgAssignmentDto? OrgUnit,
    WorkforceManagerSummaryDto? Manager,
    int DirectReportCount,
    WorkforceDataQualityDto DataQuality,
    uint Version);

public sealed record WorkforceAccessProfileSummaryDto(
    Guid Id,
    string Name);

public sealed record WorkforceAccessSubjectSummaryDto(
    Guid EmployeeId,
    string StableEmployeeKey,
    string EmployeeNumber,
    string FirstName,
    string LastName,
    string? PreferredName,
    string DisplayName,
    string? WorkEmail,
    string? JobTitle,
    string? OrgUnitName,
    string? WorkLocation,
    string EmploymentStatus,
    bool IsActive,
    int DirectReportCount,
    string AccessState,
    string AccessStateLabel,
    string? AccessStateDetail,
    IReadOnlyList<WorkforceAccessProfileSummaryDto> AccessProfiles,
    string InvitationLabel,
    string LastActivityLabel,
    DateTime? LastActivityAt,
    string? DeliveryState,
    string? ReviewReason,
    string ProvisioningState,
    Guid? UserId);

public sealed record WorkforceAccessRosterSummaryDto(
    int TotalCount,
    int NotInvitedCount,
    int InvitePendingCount,
    int ActiveAccountCount,
    int NeedsReviewCount,
    int SuspendedCount);

public sealed record WorkforceManagerScopeDto(
    string ScopeType,
    Guid ManagerEmployeeId,
    int DirectReportCount,
    bool IncludesIndirectReports);

public sealed record WorkforceCurrentUserContextDto(
    Guid UserId,
    Guid TenantId,
    Guid? EmployeeId,
    WorkforceEmployeeSummaryDto? Employee,
    WorkforceManagerScopeDto? ManagerScope,
    bool IsWorkforceLinked,
    // Active headcount of the caller's OWN current org unit (the unit itself, not descendants),
    // for self-orientation ("the organization I'm acting for"). Own-unit count only — no roster
    // visibility is exposed. Null when the caller has no current org-unit assignment.
    int? OrgUnitMemberCount = null);

public sealed record WorkforceEmployeeResolveRequest(
    IReadOnlyList<Guid> EmployeeIds);

public sealed record WorkforceEmployeesByScopeRequest(
    IReadOnlyList<Guid> OrgUnitIds,
    bool IncludeDescendants = true,
    bool IncludeInactive = false);

public sealed record InternalWorkforceEmployeeSnapshotDto(
    Guid EmployeeId,
    string StableEmployeeKey,
    string FullName,
    string DisplayName,
    string? WorkEmail,
    string? JobTitle,
    bool IsActive,
    InternalWorkforceOrgSnapshotDto? OrgUnit,
    InternalWorkforceManagerSnapshotDto? Manager,
    DateOnly? EmploymentStart = null);

public sealed record InternalWorkforceOrgSnapshotDto(
    Guid OrgUnitId,
    string Name);

public sealed record InternalWorkforceManagerSnapshotDto(
    Guid EmployeeId,
    string DisplayName,
    bool IsActive);

public sealed record InternalWorkforceEmployeeResolveRequest(
    DateTime AsOf,
    IReadOnlyList<Guid> EmployeeIds);

public sealed record InternalWorkforceEmployeesByScopeRequest(
    DateTime AsOf,
    IReadOnlyList<Guid> OrgUnitIds,
    bool IncludeDescendants = true,
    bool IncludeInactive = false);

public sealed record InternalWorkforceAllActiveRequest(
    DateTime AsOf,
    bool IncludeInactive = false);

/// <summary>The active direct reports, by primary manager, of each listed manager as of a date.</summary>
public sealed record InternalWorkforceDirectReportsRequest(
    DateTime AsOf,
    IReadOnlyList<Guid> ManagerEmployeeIds);

/// <summary>Active employees whose name contains the term, as of a date; at most <see cref="Limit"/> (capped at 20).</summary>
public sealed record InternalWorkforceSearchRequest(
    DateTime AsOf,
    string Term,
    int Limit = 20);

public sealed record InternalOrgUnitResolveRequest(
    DateTime AsOf,
    IReadOnlyList<Guid> OrgUnitIds);

/// <summary>
/// Effective-dated organizational context for an internal consumer. Ancestors are ordered
/// root-to-immediate-parent and deliberately use stable ids rather than display-name paths.
/// </summary>
public sealed record InternalOrgUnitSnapshotDto(
    Guid OrgUnitId,
    string Name,
    Guid? ParentOrgUnitId,
    bool IsActive,
    IReadOnlyList<Guid> AncestorOrgUnitIds);

public sealed record WorkforceOrgUnitSummaryDto(
    Guid Id,
    string StableKey,
    string Name,
    string Type,
    string? ParentStableKey,
    string Path,
    int Level,
    bool IsActive);

public sealed record WorkforceOrgUnitTreeNodeDto(
    Guid Id,
    string StableKey,
    string Name,
    string Type,
    string? ParentStableKey,
    string Path,
    int Level,
    bool IsActive,
    int MemberCount,
    int TotalMemberCount,
    IReadOnlyList<WorkforceOrgUnitTreeNodeDto> Children);

public sealed record WorkforceOrgUnitTreeDto(
    IReadOnlyList<WorkforceOrgUnitTreeNodeDto> Roots);

/// <summary>
/// Detailed org-unit projection returned by the workforce contract's org-unit-by-id read (D-16 seam #2).
/// Resolves the stable Organizational Unit identity without assigning structural ownership.
/// </summary>
public sealed record WorkforceOrgUnitDetailDto(
    Guid OrgUnitId,
    string StableOrgUnitKey,
    string Code,
    string Name,
    string Type,
    Guid? ParentId,
    bool IsActive);

public sealed record WorkforceEmployeeSearchResponseDto(
    PagedResponse<WorkforceEmployeeSummaryDto> Results);

public sealed record WorkforceAccessSubjectSearchResponseDto(
    PagedResponse<WorkforceAccessSubjectSummaryDto> Results);

public sealed record WorkforceBulkInviteRequest(
    string? Search,
    string? Access,
    Guid? ProfileId,
    string? EmployeeStatus,
    string? DeliveryState,
    string? EmployeeKey,
    IReadOnlyList<Guid>? SpecificEmployeeIds,
    Guid AccessProfileId);

public sealed record WorkforceBulkInviteResultItemDto(
    Guid EmployeeId,
    string DisplayName,
    string? Email,
    string Outcome,
    string Message);

public sealed record WorkforceBulkInviteResponseDto(
    IReadOnlyList<WorkforceBulkInviteResultItemDto> Items,
    int TotalRequested,
    int InvitedCount,
    int RefreshedCount,
    int AlreadyActiveCount,
    int SkippedCount);

public sealed record ApplicabilityOrgUnitDto(Guid Id, string Name, string Code, Guid? ParentId);

public sealed record ApplicabilityOptionsDto(
    IReadOnlyList<ApplicabilityOrgUnitDto> OrgUnits,
    IReadOnlyList<string> JobTitles,
    IReadOnlyList<string> WorkLocations,
    IReadOnlyList<string> EmploymentTypes);
