using System.Net;
using System.Net.Http.Json;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

/// <summary>The re-resolved account-state outcome for one workforce subject, as Identity sees it now.</summary>
public sealed record WorkforceAccessCandidateResult(
    string AccountState,
    Guid? UserId,
    Guid? MembershipId,
    string? AccountEmail,
    bool IsAdministrator = false,
    IReadOnlyList<string>? AdditionalAccess = null,
    int? AccessRevision = null);

/// <summary>One CoreHR-resolved Employee reference sent through the signed candidate boundary.</summary>
public sealed record WorkforceAccessCandidateSubject(
    Guid EmployeeId,
    string? NormalizedWorkEmail);

/// <summary>The typed outcome of a single-person workforce mutation.</summary>
public sealed record WorkforceAccessMutationOutcomeResult(
    string Outcome,
    string AccountState,
    Guid? MembershipId,
    int? AccessRevision,
    string Message);

/// <summary>One moment of a person's account story as Identity tells it (B-231).</summary>
public sealed record WorkforceAccountHistoryEvent(
    string Kind, DateTime OccurredAt, string? ActorName, string? Email, DateTime? ValidUntil);

/// <summary>The newest change to the tenant's roles in Identity's access audit (B-107).</summary>
public sealed record IdentityRoleChange(DateTime OccurredAt, string ActorName);

public interface IWorkforceAccessIdentityClient
{
    Task<IReadOnlyList<Features.Reports.ReportRoleDto>> ReportRolesAsync(Guid userId, CancellationToken cancellationToken);
    Task<IReadOnlyDictionary<Guid, WorkforceAccessCandidateResult>> ResolveCandidatesAsync(
        IReadOnlyCollection<WorkforceAccessCandidateSubject> subjects,
        CancellationToken cancellationToken);

    Task<WorkforceAccessCandidateResult> ResolveCandidateAsync(
        Guid employeeId, string? normalizedWorkEmail, CancellationToken cancellationToken);

    Task<WorkforceAccessMutationOutcomeResult> MutateAsync(
        Guid employeeId, string? normalizedWorkEmail, string action, string baseline, CancellationToken cancellationToken);

    /// <summary>
    /// Corrects one account's Employee binding: the membership currently bound to
    /// <paramref name="sourceEmployeeId"/> is rebound onto <paramref name="targetEmployeeId"/>.
    /// Both Employees are canonically resolved by CoreHR before this call; Identity rechecks
    /// under the tenant lock and returns a typed, non-disclosing outcome.
    /// </summary>
    Task<WorkforceAccessMutationOutcomeResult> CorrectAsync(
        Guid sourceEmployeeId, Guid targetEmployeeId, string baseline, string reason,
        int expectedRevision, CancellationToken cancellationToken);

    /// <summary>Rotates the pending invitation credential and re-delivers.</summary>
    Task<bool> ResendInviteAsync(Guid employeeId, CancellationToken cancellationToken);

    /// <summary>Revokes the pending invitation so the outstanding link stops resolving.</summary>
    Task<bool> WithdrawInviteAsync(Guid employeeId, CancellationToken cancellationToken);

    /// <summary>The Employee's account story, newest first: invitations, deliveries, acceptance, last sign-in.</summary>
    Task<IReadOnlyList<WorkforceAccountHistoryEvent>> GetHistoryAsync(Guid employeeId, CancellationToken cancellationToken);

    /// <summary>The newest role created, edited or deleted in the tenant; null when none, or when Identity can't answer.</summary>
    Task<IdentityRoleChange?> GetLatestRoleChangeAsync(CancellationToken cancellationToken);

    /// <summary>Suspends the workforce account (deactivate), preserving membership/binding/profiles.</summary>
    Task<(bool Ok, string Message)> SuspendAccountAsync(Guid employeeId, CancellationToken cancellationToken);

    /// <summary>Restores a suspended workforce account.</summary>
    Task<(bool Ok, string Message)> RestoreAccountAsync(Guid employeeId, CancellationToken cancellationToken);
}

/// <summary>
/// The CoreHR half of the trusted workforce-access contract. CoreHR has already resolved
/// the canonical Employee, tenant ownership, and normalized work email; it sends those over
/// the HMAC-signed internal channel so Identity trusts the caller rather than a forwarded
/// JWT. Candidate reads are non-authoritative previews; the mutate call re-resolves and
/// rechecks in Identity before committing. The tenant comes from the authenticated claims
/// (never a browser header) and the acting user is carried for audit attribution only.
/// </summary>
public sealed class WorkforceAccessIdentityClient(
    HttpClient httpClient,
    ITenantContext tenantContext,
    IHttpContextAccessor httpContextAccessor,
    IInternalServiceRequestSigner signer) : IWorkforceAccessIdentityClient
{
    private const string CandidatesPath = "internal/identity/workforce-access/candidates";
    public async Task<IReadOnlyList<Features.Reports.ReportRoleDto>> ReportRolesAsync(Guid userId, CancellationToken cancellationToken)
        => await SendAsync<List<Features.Reports.ReportRoleDto>>("internal/identity/roles/report-audience",
            new { TenantId = ResolvedTenantId(), UserId = userId }, ResolvedTenantId(), cancellationToken)
            ?? throw new InvalidOperationException("Identity returned no report audience.");
    private const string MutatePath = "internal/identity/workforce-access/mutate";
    private const string CorrectPath = "internal/identity/workforce-access/correct";

    // Mirrors Identity's WorkforceAccountCandidateOutcome ordinal values; the internal
    // endpoint serializes the outcome as its numeric enum value.
    private static readonly string[] OutcomeNames =
    [
        "NewAccount", "ExistingAccountReadyToLink", "Active", "BindingConflict",
        "SuspendedAccountReadyToReactivate", "ExistingAccountReadyToJoinTenant", "AccountUnavailable",
    ];

    public async Task<WorkforceAccessCandidateResult> ResolveCandidateAsync(
        Guid employeeId, string? normalizedWorkEmail, CancellationToken cancellationToken)
    {
        var candidates = await ResolveCandidatesAsync(
            [new WorkforceAccessCandidateSubject(employeeId, normalizedWorkEmail)], cancellationToken);
        return candidates.TryGetValue(employeeId, out var candidate)
            ? candidate
            : throw new InvalidOperationException("Identity returned no candidate for the workforce subject.");
    }

    public async Task<IReadOnlyDictionary<Guid, WorkforceAccessCandidateResult>> ResolveCandidatesAsync(
        IReadOnlyCollection<WorkforceAccessCandidateSubject> subjects,
        CancellationToken cancellationToken)
    {
        if (subjects.Count == 0)
        {
            return new Dictionary<Guid, WorkforceAccessCandidateResult>();
        }

        var tenantId = ResolvedTenantId();
        var body = new
        {
            TenantId = tenantId,
            Subjects = subjects.Select(subject => new
            {
                subject.EmployeeId,
                subject.NormalizedWorkEmail,
            }).ToArray(),
        };

        var candidates = await SendAsync<List<CandidateDto>>(CandidatesPath, body, tenantId, cancellationToken)
            ?? throw new InvalidOperationException("Identity returned no candidates for the workforce subjects.");

        return candidates.ToDictionary(
            candidate => candidate.EmployeeId,
            candidate => new WorkforceAccessCandidateResult(
                OutcomeName(candidate.Outcome), candidate.UserId, candidate.MembershipId, candidate.AccountEmail,
                candidate.IsAdministrator, candidate.AdditionalAccess, candidate.AccessRevision));
    }

    public async Task<WorkforceAccessMutationOutcomeResult> MutateAsync(
        Guid employeeId, string? normalizedWorkEmail, string action, string baseline, CancellationToken cancellationToken)
    {
        var tenantId = ResolvedTenantId();
        var actingUserId = httpContextAccessor.HttpContext?.User.GetUserId();
        var body = new
        {
            TenantId = tenantId,
            EmployeeId = employeeId,
            NormalizedWorkEmail = normalizedWorkEmail,
            Action = action,
            Baseline = baseline,
            ActingUserId = actingUserId == Guid.Empty ? (Guid?)null : actingUserId,
            ActorName = string.Empty,
            ActorRole = "Workforce",
            CorrelationId = (string?)null,
        };

        var result = await SendAsync<MutationDto>(MutatePath, body, tenantId, cancellationToken)
            ?? throw new InvalidOperationException("Identity returned no result for the workforce mutation.");

        return new WorkforceAccessMutationOutcomeResult(
            result.Outcome, result.AccountState, result.MembershipId, result.AccessRevision, result.Message);
    }

    public async Task<WorkforceAccessMutationOutcomeResult> CorrectAsync(
        Guid sourceEmployeeId, Guid targetEmployeeId, string baseline, string reason,
        int expectedRevision, CancellationToken cancellationToken)
    {
        var tenantId = ResolvedTenantId();
        var actingUserId = httpContextAccessor.HttpContext?.User.GetUserId();
        var body = new
        {
            TenantId = tenantId,
            SourceEmployeeId = sourceEmployeeId,
            TargetEmployeeId = targetEmployeeId,
            Baseline = baseline,
            Reason = reason,
            ExpectedRevision = expectedRevision,
            ActingUserId = actingUserId == Guid.Empty ? (Guid?)null : actingUserId,
            ActorName = string.Empty,
            ActorRole = "Workforce",
            CorrelationId = (string?)null,
        };

        var result = await SendAsync<MutationDto>(CorrectPath, body, tenantId, cancellationToken)
            ?? throw new InvalidOperationException("Identity returned no result for the workforce correction.");

        return new WorkforceAccessMutationOutcomeResult(
            result.Outcome, result.AccountState, result.MembershipId, result.AccessRevision, result.Message);
    }

    private const string AccountsBase = "internal/identity/workforce-accounts";

    public async Task<bool> ResendInviteAsync(Guid employeeId, CancellationToken cancellationToken)
        => await SendAccountsAsync(HttpMethod.Post, $"{AccountsBase}/{employeeId}/resend", cancellationToken);

    public async Task<bool> WithdrawInviteAsync(Guid employeeId, CancellationToken cancellationToken)
        => await SendAccountsAsync(HttpMethod.Post, $"{AccountsBase}/{employeeId}/withdraw", cancellationToken);

    public async Task<IReadOnlyList<WorkforceAccountHistoryEvent>> GetHistoryAsync(
        Guid employeeId, CancellationToken cancellationToken)
    {
        var tenantId = ResolvedTenantId();
        using var response = await SendSignedAsync(
            HttpMethod.Get, $"{AccountsBase}/{employeeId}/history", null, tenantId, cancellationToken);
        response.EnsureSuccessStatusCode();
        var envelope = await response.Content.ReadFromJsonAsync<HistoryEnvelope>(cancellationToken: cancellationToken);
        return envelope?.Data ?? [];
    }

    public async Task<IdentityRoleChange?> GetLatestRoleChangeAsync(CancellationToken cancellationToken)
    {
        using var response = await SendSignedAsync(
            HttpMethod.Get, "internal/identity/access-audit/roles/latest", null, ResolvedTenantId(), cancellationToken);
        if (!response.IsSuccessStatusCode)
            return null;
        var envelope = await response.Content.ReadFromJsonAsync<RoleChangeEnvelope>(cancellationToken: cancellationToken);
        return envelope?.Data;
    }

    public async Task<(bool Ok, string Message)> SuspendAccountAsync(Guid employeeId, CancellationToken cancellationToken)
        => await SendAccountsWithMessageAsync(HttpMethod.Delete, $"{AccountsBase}/{employeeId}", cancellationToken);

    public async Task<(bool Ok, string Message)> RestoreAccountAsync(Guid employeeId, CancellationToken cancellationToken)
        => await SendAccountsWithMessageAsync(HttpMethod.Post, $"{AccountsBase}/{employeeId}/reactivate", cancellationToken);

    private async Task<bool> SendAccountsAsync(HttpMethod method, string path, CancellationToken cancellationToken)
    {
        var tenantId = ResolvedTenantId();
        using var response = await SendSignedAsync(method, path, new { }, tenantId, cancellationToken);
        return response.IsSuccessStatusCode;
    }

    private async Task<(bool Ok, string Message)> SendAccountsWithMessageAsync(
        HttpMethod method, string path, CancellationToken cancellationToken)
    {
        var tenantId = ResolvedTenantId();
        using var response = await SendSignedAsync(
            method, path, method == HttpMethod.Delete ? null : new { }, tenantId, cancellationToken);
        if (response.IsSuccessStatusCode)
            return (true, string.Empty);
        // Surface the continuity refusal (e.g. last usable administrator) without disclosure.
        var envelope = await response.Content.ReadFromJsonAsync<FailureEnvelope>(cancellationToken: cancellationToken).ConfigureAwait(false);
        return (false, envelope?.Errors?.FirstOrDefault() ?? "This could not be completed.");
    }

    private async Task<HttpResponseMessage> SendSignedAsync(
        HttpMethod method, string path, object? body, Guid tenantId, CancellationToken cancellationToken)
    {
        var requestUri = httpClient.BaseAddress is not null
            ? new Uri(httpClient.BaseAddress, path)
            : new Uri(path, UriKind.Relative);

        var request = new HttpRequestMessage(method, requestUri);
        if (body is not null)
            request.Content = JsonContent.Create(body);
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId.ToString());
        var actingUserId = httpContextAccessor.HttpContext?.User.GetUserId();
        if (actingUserId is { } acting && acting != Guid.Empty)
            request.Headers.TryAddWithoutValidation("X-Acting-User-Id", acting.ToString());
        await signer.SignAsync(request, cancellationToken);
        return await httpClient.SendAsync(request, cancellationToken);
    }

    private Guid ResolvedTenantId()
        => tenantContext.TenantIdOrDefault is { } id && id != Guid.Empty
            ? id
            : throw new InvalidOperationException("A resolved tenant is required for workforce access.");

    private async Task<T?> SendAsync<T>(string path, object body, Guid tenantId, CancellationToken cancellationToken)
    {
        // Sign against an absolute URI so the signed path matches the server request path.
        var requestUri = httpClient.BaseAddress is not null
            ? new Uri(httpClient.BaseAddress, path)
            : new Uri(path, UriKind.Relative);

        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId.ToString());

        var actingUserId = httpContextAccessor.HttpContext?.User.GetUserId();
        if (actingUserId is { } acting && acting != Guid.Empty)
            request.Headers.TryAddWithoutValidation("X-Acting-User-Id", acting.ToString());

        await signer.SignAsync(request, cancellationToken);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new InvalidOperationException("The workforce-access internal call was not authorized.");

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken);
    }

    private static string OutcomeName(int outcome)
        => outcome >= 0 && outcome < OutcomeNames.Length ? OutcomeNames[outcome] : "AccountUnavailable";

    private sealed record CandidateDto(
        Guid EmployeeId, int Outcome, Guid? UserId, Guid? MembershipId, string? AccountEmail,
        bool IsAdministrator = false, IReadOnlyList<string>? AdditionalAccess = null, int? AccessRevision = null);

    private sealed record MutationDto(string Outcome, string AccountState, Guid? MembershipId, int? AccessRevision, string Message);

    private sealed record HistoryEnvelope(List<WorkforceAccountHistoryEvent> Data);

    private sealed record RoleChangeEnvelope(IdentityRoleChange? Data);

    private sealed record FailureEnvelope(List<string>? Errors);
}
