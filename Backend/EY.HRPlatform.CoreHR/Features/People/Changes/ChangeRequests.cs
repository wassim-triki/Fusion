using System.Data;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Results;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace EY.HRPlatform.CoreHR.Features.People.Changes;

// --- Who is acting ----------------------------------------------------------------------------------

/// <summary>
/// The caller as the change flow sees them, read from their claims by the controller and never from a request value.
/// </summary>
/// <param name="ManagesPeople">HR (<c>core.employee.manage</c>): their changes apply at once.</param>
/// <param name="Proposes">Proposes changes for their direct reports (<c>core.change.propose</c>).</param>
/// <param name="Approves">Approves changes (<c>core.change.approve</c> for everyone).</param>
public sealed record ChangeActor(string UserId, Guid? EmployeeId, string Name, bool ManagesPeople, bool Proposes, bool Approves)
{
    public string Audit => $"{UserId}|{Name}";
}

// --- Contracts --------------------------------------------------------------------------------------

/// <summary>A job change or an end of employment, as described and drafted; exactly one part is set.</summary>
public sealed record ProposeChangeRequest(
    JobChangeRequest? Job = null,
    EndEmploymentChangeRequest? End = null,
    string? Description = null);

public sealed record DeclineChangeRequestBody(string? Reason);

public sealed record ChangeRequestPerson(Guid EmployeeId, string EmployeeKey, string DisplayName, string? JobTitle, string? Unit);

public sealed record ChangeRequestActorRef(Guid? EmployeeId, string DisplayName);

public sealed record ChangeRequestAddress(PeopleHomeAddressDto From, PeopleHomeAddressDto To);

public sealed record ChangeRequestDto(
    Guid Id,
    WorkforceChangeRequestKind Kind,
    WorkforceChangeRequestStatus Status,
    ChangeRequestPerson Person,
    ChangeRequestActorRef RequestedBy,
    DateTime RequestedAt,
    DateOnly EffectiveDate,
    IReadOnlyList<string> Types,
    string? Description,
    string? Note,
    Guid? ReasonId,
    string? Reason,
    WorkforceChangeDetails? Change,
    ChangeRequestAddress? Address,
    ChangeRequestActorRef? DecidedBy,
    DateTime? DecidedAt,
    string? DeclineReason,
    Guid? AppliedChangeId,
    bool CanDecide,
    bool CanWithdraw,
    /// <summary>Pending, but no longer approvable: the person changed since it was asked, or its date passed.</summary>
    string? Stale);

/// <summary>What proposing did: the change applied (no approval needed) or the request now waiting.</summary>
public sealed record ProposeChangeResultDto(WorkforceChangeDto? Change, ChangeRequestDto? Request);

public sealed record ChangeApprovalTypeDto(string Type, bool Required);

/// <summary>Settings › Changes and approvals: which types wait for approval, and who approves.</summary>
public sealed record ChangeApprovalSettingsDto(IReadOnlyList<ChangeApprovalTypeDto> Types, IReadOnlyList<ChangeRequestActorRef> Approvers, bool CanManage);

public sealed record UpdateChangeApprovalsRequest(IReadOnlyList<string> Required);

// --- Approvers ------------------------------------------------------------------------------------

/// <summary>Who holds Approve changes, asked of Identity (Core HR only reads the caller's own token).</summary>
public interface IChangeApproverDirectory
{
    Task<IReadOnlyList<PermissionHolder>> GetApproversAsync(CancellationToken cancellationToken);
}

public sealed class ChangeApproverDirectory(HttpClient httpClient, IInternalServiceRequestSigner signer, ITenantContext tenant)
    : IChangeApproverDirectory
{
    public async Task<IReadOnlyList<PermissionHolder>> GetApproversAsync(CancellationToken cancellationToken)
    {
        if (!tenant.IsResolved) return [];
        var uri = new Uri(httpClient.BaseAddress!, "internal/identity/access/permission-holders");
        using var request = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = JsonContent.Create(new PermissionHoldersRequest(tenant.TenantId, CorePermissions.ChangeApprove, PermissionScopes.Tenant)),
        };
        await signer.SignAsync(request, cancellationToken);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<List<PermissionHolder>>(cancellationToken) ?? [];
    }
}

// --- The flow -------------------------------------------------------------------------------------

/// <summary>
/// Changes that wait for approval (D-15, D-16). Proposing stages the change in a transaction that is rolled back, so a
/// request is checked by exactly the rules that apply it and records what it would do; it is written only on approval,
/// by the same staging, and only while the person is as they were when asked. HR's own changes, and changes of a type
/// the company doesn't ask approval for, apply at once.
/// </summary>
public sealed class ChangeRequestService(
    CoreHRDbContext db,
    ITenantContext tenant,
    WorkforceChangeService changes,
    WorkforceChangeReader reader,
    IChangeApproverDirectory approvers)
{
    public const string ForbiddenCode = "ChangeRequest.Forbidden";
    public const string ConflictCode = "ChangeRequest.Conflict";
    public const string RequestsPath = "/core/changes";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    // --- Settings ---------------------------------------------------------------------------------

    public async Task<HashSet<string>> RequiredTypesAsync(CancellationToken cancellationToken)
        => (await db.ChangeApprovalRules.AsNoTracking().Select(rule => rule.Type).ToListAsync(cancellationToken)).ToHashSet(StringComparer.Ordinal);

    public async Task<ChangeApprovalSettingsDto> SettingsAsync(Guid? viewerEmployeeId, bool canManage, CancellationToken cancellationToken)
    {
        var required = await RequiredTypesAsync(cancellationToken);
        return new ChangeApprovalSettingsDto(
            ChangeApprovalTypes.All.Select(type => new ChangeApprovalTypeDto(type, required.Contains(type))).ToList(),
            await ApproverRefsAsync(cancellationToken),
            canManage);
    }

    public async Task<Result<ChangeApprovalSettingsDto>> UpdateSettingsAsync(
        IReadOnlyList<string> required, string actor, Guid? viewerEmployeeId, CancellationToken cancellationToken)
    {
        if (required.Any(type => !ChangeApprovalTypes.IsKnown(type)))
            return Result.Failure<ChangeApprovalSettingsDto>(Error.Validation("ChangeApproval.UnknownType", "Choose change types from the list."));
        var wanted = required.ToHashSet(StringComparer.Ordinal);
        var rules = await db.ChangeApprovalRules.ToListAsync(cancellationToken);
        db.ChangeApprovalRules.RemoveRange(rules.Where(rule => !wanted.Contains(rule.Type)));
        foreach (var type in wanted.Where(type => rules.All(rule => rule.Type != type)))
            db.ChangeApprovalRules.Add(ChangeApprovalRule.For(tenant.TenantId, type, actor));
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(await SettingsAsync(viewerEmployeeId, true, cancellationToken));
    }

    // --- Proposing --------------------------------------------------------------------------------

    /// <summary>The person a caller may draft a change for: anyone for HR, their direct reports for a proposer.</summary>
    public async Task<Result<Employee>> SubjectForAsync(string employeeKey, ChangeActor actor, CancellationToken cancellationToken)
    {
        var subject = await ChangeSupport.FindEmployeeAsync(db, employeeKey, cancellationToken);
        if (subject is null)
            return ChangeSupport.NotFound<Employee>();
        var refused = await MayProposeAsync(subject, actor, cancellationToken);
        return refused is null ? Result.Success(subject) : Result.Failure<Employee>(refused);
    }

    public async Task<Result<ProposeChangeResultDto>> ProposeAsync(
        string employeeKey, ProposeChangeRequest body, ChangeActor actor, CancellationToken cancellationToken)
    {
        if ((body.Job is null) == (body.End is null))
            return Fail<ProposeChangeResultDto>("ChangeRequest.OnePart", "Describe one change: a new job or a last day.");
        var subject = await ChangeSupport.FindEmployeeAsync(db, employeeKey, cancellationToken);
        if (subject is null)
            return ChangeSupport.NotFound<ProposeChangeResultDto>();
        var refused = await MayProposeAsync(subject, actor, cancellationToken);
        if (refused is not null)
            return Result.Failure<ProposeChangeResultDto>(refused);

        Task<Result<WorkforceChange>> Stage(Employee person, string audit) => body.Job is { } job
            ? changes.StageJobChangeAsync(person, job, audit, canManageEmployees: true, cancellationToken)
            : changes.StageEndEmploymentAsync(person, body.End!, audit, cancellationToken);

        // HR's own changes apply at once.
        if (actor.ManagesPeople)
            return await ApplyNowAsync(() => Stage(subject, actor.Audit), cancellationToken);

        var kind = body.Job is not null ? WorkforceChangeKind.JobChange : WorkforceChangeKind.EndEmployment;
        var date = body.Job is { } asked ? DateOnly.FromDateTime(asked.EffectiveDate) : DateOnly.FromDateTime(body.End!.LastDay);
        var basis = await BasisAsync(subject.Id, date, cancellationToken);

        // The same rules that apply it, rolled back: what it would do, or why it can't be done.
        var dryRun = await DryRunAsync(() => Stage(subject, actor.Audit), cancellationToken);
        if (dryRun.IsFailure)
            return Result.Failure<ProposeChangeResultDto>(dryRun.Error);
        var details = WorkforceChangeService.ReadDetails(dryRun.Value);

        var required = await RequiredTypesAsync(cancellationToken);
        // A manager never ends someone's employment alone: their last day always waits for approval.
        var types = kind == WorkforceChangeKind.EndEmployment
            ? [ChangeApprovalTypes.Leaving]
            : details.ApprovalTypes(kind).Where(required.Contains).ToList();
        subject = (await ChangeSupport.FindEmployeeAsync(db, employeeKey, cancellationToken))!;
        if (types.Count == 0)
            return await ApplyNowAsync(() => Stage(subject, actor.Audit), cancellationToken);

        if (await db.WorkforceChangeRequests.AnyAsync(item => item.SubjectEmployeeId == subject.Id
                && item.Status == WorkforceChangeRequestStatus.Pending && item.Kind != WorkforceChangeRequestKind.HomeAddress, cancellationToken))
            return Result.Failure<ProposeChangeResultDto>(new Error(ConflictCode,
                $"A change for {subject.DisplayName} is already waiting for approval. Withdraw it first, or wait for the answer."));

        var reason = details.ReasonId is { } reasonId && details.Reason is { } label ? (reasonId, label) : ((Guid, string)?)null;
        var note = body.Job?.Note ?? body.End?.Note;
        var request = WorkforceChangeRequest.Ask(
            tenant.TenantId, subject.Id,
            kind == WorkforceChangeKind.JobChange ? WorkforceChangeRequestKind.JobChange : WorkforceChangeRequestKind.EndEmployment,
            date, types,
            body.Job is { } payloadJob ? JsonSerializer.Serialize(payloadJob, Json) : JsonSerializer.Serialize(body.End, Json),
            JsonSerializer.Serialize(details, Json), basis, body.Description, note, reason,
            actor.UserId, actor.EmployeeId, actor.Name);
        db.WorkforceChangeRequests.Add(request);
        await TellApproversAsync(request, subject, details, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success(new ProposeChangeResultDto(null, await ProjectAsync(request, actor, cancellationToken)));
    }

    /// <summary>
    /// A person's own new home address, when the company wants HR to approve it: recorded as a request instead of being
    /// saved. Staged on the caller's unit of work; the caller saves.
    /// </summary>
    public async Task<Result<WorkforceChangeRequest>> StageAddressRequestAsync(
        Employee subject, HomeAddress address, ChangeActor actor, CancellationToken cancellationToken)
    {
        if (await db.WorkforceChangeRequests.AnyAsync(item => item.SubjectEmployeeId == subject.Id
                && item.Status == WorkforceChangeRequestStatus.Pending && item.Kind == WorkforceChangeRequestKind.HomeAddress, cancellationToken))
            return Result.Failure<WorkforceChangeRequest>(new Error(ConflictCode,
                "Your earlier address is still with HR. Withdraw it first."));
        var from = subject.CurrentHomeAddress;
        var request = WorkforceChangeRequest.Ask(
            tenant.TenantId, subject.Id, WorkforceChangeRequestKind.HomeAddress, Today, [ChangeApprovalTypes.HomeAddress],
            JsonSerializer.Serialize(Dto(address), Json),
            JsonSerializer.Serialize(new ChangeRequestAddress(Dto(from), Dto(address)), Json),
            AddressBasis(from), null, null, null, actor.UserId, actor.EmployeeId, actor.Name);
        db.WorkforceChangeRequests.Add(request);
        await TellApproversAsync(request, subject, null, cancellationToken);
        return Result.Success(request);
    }

    // --- Deciding ---------------------------------------------------------------------------------

    public async Task<Result<ChangeRequestDto>> ApproveAsync(Guid requestId, ChangeActor actor, CancellationToken cancellationToken)
    {
        var request = await db.WorkforceChangeRequests.FirstOrDefaultAsync(item => item.Id == requestId, cancellationToken);
        if (request is null || !CanSee(request, actor))
            return ChangeSupport.NotFound<ChangeRequestDto>();
        var refused = MayDecide(request, actor);
        if (refused is not null)
            return Result.Failure<ChangeRequestDto>(refused);
        var stale = await StaleAsync(request, cancellationToken);
        if (stale is not null)
            return Result.Failure<ChangeRequestDto>(new Error(ConflictCode, stale));

        var subject = await db.Employees.FirstAsync(item => item.Id == request.SubjectEmployeeId, cancellationToken);
        var requester = $"{request.RequestedByUserId}|{request.RequestedByName}";
        var relational = db.Database.IsRelational();
        await using IDbContextTransaction? transaction = relational
            ? await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        try
        {
            Guid? appliedChangeId = null;
            if (request.Kind == WorkforceChangeRequestKind.HomeAddress)
            {
                var address = JsonSerializer.Deserialize<PeopleHomeAddressDto>(request.PayloadJson, Json)!;
                subject.ReplaceHomeAddress(new HomeAddress(address.Street, address.City, address.PostalCode, address.Country));
                db.WorkforceAuditEntries.Add(WorkforceAuditEntry.Record(tenant.TenantId, "Employee", subject.Id,
                    WorkforceAuditAction.PersonalDetailsUpdated, WorkforceSourceType.Manual, actor.Audit,
                    changeDetails: $"Home address, asked by {request.RequestedByName}"));
            }
            else
            {
                // The change is the requester's, made with the approver's yes.
                var staged = request.Kind == WorkforceChangeRequestKind.JobChange
                    ? await changes.StageJobChangeAsync(subject, JsonSerializer.Deserialize<JobChangeRequest>(request.PayloadJson, Json)!,
                        requester, canManageEmployees: true, cancellationToken)
                    : await changes.StageEndEmploymentAsync(subject, JsonSerializer.Deserialize<EndEmploymentChangeRequest>(request.PayloadJson, Json)!,
                        requester, cancellationToken);
                if (staged.IsFailure)
                {
                    if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
                    db.ChangeTracker.Clear();
                    return Result.Failure<ChangeRequestDto>(staged.Error);
                }
                await db.SaveChangesAsync(cancellationToken);
                appliedChangeId = staged.Value.Id;
            }

            request.Approve(actor.UserId, actor.EmployeeId, actor.Name, appliedChangeId);
            TellRequester(request, subject, actor, CoreNotificationKind.ChangeApproved);
            await db.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            return Result.Failure<ChangeRequestDto>(new Error(ConflictCode, "Someone answered this request just now. Reload to see it."));
        }
        catch
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            throw;
        }
        return Result.Success(await ProjectAsync(request, actor, cancellationToken));
    }

    public async Task<Result<ChangeRequestDto>> DeclineAsync(Guid requestId, string? reason, ChangeActor actor, CancellationToken cancellationToken)
    {
        var request = await db.WorkforceChangeRequests.FirstOrDefaultAsync(item => item.Id == requestId, cancellationToken);
        if (request is null || !CanSee(request, actor))
            return ChangeSupport.NotFound<ChangeRequestDto>();
        var refused = MayDecide(request, actor);
        if (refused is not null)
            return Result.Failure<ChangeRequestDto>(refused);
        if (string.IsNullOrWhiteSpace(reason))
            return Fail<ChangeRequestDto>("ChangeRequest.ReasonRequired", "Say why, so they know what to change.");

        request.Decline(actor.UserId, actor.EmployeeId, actor.Name, reason);
        var subject = await db.Employees.AsNoTracking().FirstAsync(item => item.Id == request.SubjectEmployeeId, cancellationToken);
        TellRequester(request, subject, actor, CoreNotificationKind.ChangeDeclined);
        return await SaveDecisionAsync(request, actor, cancellationToken);
    }

    public async Task<Result<ChangeRequestDto>> WithdrawAsync(Guid requestId, ChangeActor actor, CancellationToken cancellationToken)
    {
        var request = await db.WorkforceChangeRequests.FirstOrDefaultAsync(item => item.Id == requestId, cancellationToken);
        if (request is null || !CanSee(request, actor))
            return ChangeSupport.NotFound<ChangeRequestDto>();
        if (request.RequestedByUserId != actor.UserId)
            return Result.Failure<ChangeRequestDto>(new Error(ForbiddenCode, "Only whoever asked can withdraw a request."));
        if (request.Status != WorkforceChangeRequestStatus.Pending)
            return Result.Failure<ChangeRequestDto>(new Error(ConflictCode, "This request was already answered."));
        request.Withdraw(actor.UserId);
        return await SaveDecisionAsync(request, actor, cancellationToken);
    }

    // --- Reading ----------------------------------------------------------------------------------

    /// <param name="pending">True: waiting; false: answered or withdrawn in the last 90 days.</param>
    public async Task<IReadOnlyList<ChangeRequestDto>> ListAsync(
        ChangeActor actor, bool pending, string? employeeKey, CancellationToken cancellationToken)
    {
        var query = Visible(db.WorkforceChangeRequests.AsNoTracking(), actor);
        if (employeeKey is not null)
        {
            var subject = await ChangeSupport.FindEmployeeAsync(db, employeeKey, cancellationToken);
            if (subject is null) return [];
            query = query.Where(item => item.SubjectEmployeeId == subject.Id);
        }
        var since = DateTime.UtcNow.AddDays(-90);
        query = pending
            ? query.Where(item => item.Status == WorkforceChangeRequestStatus.Pending)
            : query.Where(item => item.Status != WorkforceChangeRequestStatus.Pending && item.DecidedAt >= since);
        var rows = await (pending ? query.OrderBy(item => item.CreatedAt) : query.OrderByDescending(item => item.DecidedAt))
            .Take(100).ToListAsync(cancellationToken);
        return await ProjectAsync(rows, actor, cancellationToken);
    }

    public async Task<Result<ChangeRequestDto>> GetAsync(Guid requestId, ChangeActor actor, CancellationToken cancellationToken)
    {
        var request = await db.WorkforceChangeRequests.AsNoTracking().FirstOrDefaultAsync(item => item.Id == requestId, cancellationToken);
        return request is null || !CanSee(request, actor)
            ? ChangeSupport.NotFound<ChangeRequestDto>()
            : Result.Success(await ProjectAsync(request, actor, cancellationToken));
    }

    /// <summary>What an approver can answer now: not their own requests, not about themselves.</summary>
    public async Task<IReadOnlyList<ChangeRequestDto>> ToDecideAsync(ChangeActor actor, CancellationToken cancellationToken)
    {
        if (!actor.Approves) return [];
        var rows = await db.WorkforceChangeRequests.AsNoTracking()
            .Where(item => item.Status == WorkforceChangeRequestStatus.Pending && item.RequestedByUserId != actor.UserId
                && (actor.EmployeeId == null || item.SubjectEmployeeId != actor.EmployeeId))
            .OrderBy(item => item.CreatedAt).Take(50).ToListAsync(cancellationToken);
        return await ProjectAsync(rows, actor, cancellationToken);
    }

    public async Task<IReadOnlyList<ChangeRequestActorRef>> ApproverRefsAsync(CancellationToken cancellationToken)
    {
        try
        {
            return (await approvers.GetApproversAsync(cancellationToken))
                .Select(holder => new ChangeRequestActorRef(holder.EmployeeId, holder.DisplayName))
                .OrderBy(holder => holder.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return [];
        }
    }

    // --- Rules ------------------------------------------------------------------------------------

    private async Task<Error?> MayProposeAsync(Employee subject, ChangeActor actor, CancellationToken cancellationToken)
    {
        if (actor.ManagesPeople) return null;
        if (!actor.Proposes || actor.EmployeeId is not { } proposerId)
            return new Error(ForbiddenCode, "You can't propose changes.");
        if (subject.Id == proposerId)
            return new Error(ForbiddenCode, "You can't propose a change to your own job. Ask your manager or HR.");
        var at = WorkforceChangeService.At(Today);
        var reportsToProposer = await db.ManagerRelationships.AsNoTracking().AnyAsync(line => line.SubjectEmployeeId == subject.Id
            && line.ManagerEmployeeId == proposerId && line.Type == ReportingRelationshipType.PrimaryManager
            && line.EffectiveFrom <= at && (line.EffectiveTo == null || at < line.EffectiveTo), cancellationToken);
        return reportsToProposer ? null : new Error(ForbiddenCode, $"You can propose changes for your team. {subject.DisplayName} isn't on it.");
    }

    private static Error? MayDecide(WorkforceChangeRequest request, ChangeActor actor)
    {
        if (!actor.Approves)
            return new Error(ForbiddenCode, "You can't approve changes.");
        if (request.RequestedByUserId == actor.UserId)
            return new Error(ForbiddenCode, "You can't answer your own request. Withdraw it instead.");
        if (actor.EmployeeId is { } own && request.SubjectEmployeeId == own)
            return new Error(ForbiddenCode, "Someone else answers a change about you.");
        if (request.Status != WorkforceChangeRequestStatus.Pending)
            return new Error(ConflictCode, "This request was already answered.");
        return null;
    }

    /// <summary>Approvers see every request; anyone else only what they asked.</summary>
    private static IQueryable<WorkforceChangeRequest> Visible(IQueryable<WorkforceChangeRequest> query, ChangeActor actor)
        => actor.Approves ? query : query.Where(item => item.RequestedByUserId == actor.UserId);

    private static bool CanSee(WorkforceChangeRequest request, ChangeActor actor)
        => actor.Approves || request.RequestedByUserId == actor.UserId;

    /// <summary>Why a pending request can no longer be approved as asked, or null.</summary>
    private async Task<string?> StaleAsync(WorkforceChangeRequest request, CancellationToken cancellationToken)
    {
        if (request.Status != WorkforceChangeRequestStatus.Pending) return null;
        var name = await db.Employees.AsNoTracking().Where(item => item.Id == request.SubjectEmployeeId)
            .Select(item => item.FirstName).FirstOrDefaultAsync(cancellationToken) ?? "This person";
        if (request.Kind == WorkforceChangeRequestKind.HomeAddress)
        {
            var current = await db.Employees.AsNoTracking().Where(item => item.Id == request.SubjectEmployeeId)
                .Select(item => new HomeAddress(item.HomeStreet, item.HomeCity, item.HomePostalCode, item.HomeCountry))
                .FirstAsync(cancellationToken);
            return AddressBasis(current) == request.Basis ? null : $"{name}'s address changed since this was asked. Decline it and ask again.";
        }
        if (request.EffectiveDate < Today)
            return $"This was asked for {request.EffectiveDate.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}, which has passed. Decline it and ask for a new date.";
        return await BasisAsync(request.SubjectEmployeeId, request.EffectiveDate, cancellationToken) == request.Basis
            ? null
            : $"{name}'s job or manager changed since this was asked. Decline it and ask again.";
    }

    /// <summary>The person's job, line and employment on the date, and their latest coming change: what a draft was made against.</summary>
    private async Task<string> BasisAsync(Guid employeeId, DateOnly date, CancellationToken cancellationToken)
    {
        var at = WorkforceChangeService.At(date);
        var today = Today;
        var assignment = await db.WorkAssignments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && item.IsPrimary && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => (Guid?)item.Id).FirstOrDefaultAsync(cancellationToken);
        var line = await db.ManagerRelationships.AsNoTracking()
            .Where(item => item.SubjectEmployeeId == employeeId && item.Type == ReportingRelationshipType.PrimaryManager
                && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => (Guid?)item.Id).FirstOrDefaultAsync(cancellationToken);
        var employment = await db.Employments.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => new { item.Id, item.EffectiveTo }).FirstOrDefaultAsync(cancellationToken);
        var latest = await db.WorkforceChanges.AsNoTracking()
            .Where(item => item.EmployeeId == employeeId && !item.IsCancelled && item.EffectiveDate >= today)
            .OrderByDescending(item => item.EffectiveDate).ThenByDescending(item => item.CreatedAt)
            .Select(item => (Guid?)item.Id).FirstOrDefaultAsync(cancellationToken);
        return $"{assignment:N}|{line:N}|{employment?.Id:N}:{employment?.EffectiveTo:yyyyMMdd}|{latest:N}";
    }

    private static string AddressBasis(HomeAddress address)
        => string.Join("\u001f", address.Street, address.City, address.PostalCode, address.Country);

    private static PeopleHomeAddressDto Dto(HomeAddress address) => new(address.Street, address.City, address.PostalCode, address.Country);

    // --- Staging ----------------------------------------------------------------------------------

    private async Task<Result<WorkforceChange>> DryRunAsync(Func<Task<Result<WorkforceChange>>> stage, CancellationToken cancellationToken)
    {
        var relational = db.Database.IsRelational();
        await using IDbContextTransaction? transaction = relational
            ? await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;
        try
        {
            var result = await stage();
            if (result.IsSuccess && relational)
                await db.SaveChangesAsync(cancellationToken);
            return result;
        }
        finally
        {
            if (transaction is not null) await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
        }
    }

    private async Task<Result<ProposeChangeResultDto>> ApplyNowAsync(Func<Task<Result<WorkforceChange>>> stage, CancellationToken cancellationToken)
    {
        var result = await ChangeSupport.RunAsync(db, [stage], cancellationToken);
        return result.IsFailure
            ? Result.Failure<ProposeChangeResultDto>(result.Error)
            : Result.Success(new ProposeChangeResultDto(await reader.ProjectAsync(result.Value, cancellationToken), null));
    }

    private async Task<Result<ChangeRequestDto>> SaveDecisionAsync(WorkforceChangeRequest request, ChangeActor actor, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return Result.Failure<ChangeRequestDto>(new Error(ConflictCode, "Someone answered this request just now. Reload to see it."));
        }
        return Result.Success(await ProjectAsync(request, actor, cancellationToken));
    }

    // --- Telling people ---------------------------------------------------------------------------

    /// <summary>Approvers hear a request is waiting; if Identity can't say who they are, Home still shows it.</summary>
    private async Task TellApproversAsync(WorkforceChangeRequest request, Employee subject, WorkforceChangeDetails? details, CancellationToken cancellationToken)
    {
        IReadOnlyList<PermissionHolder> holders;
        try
        {
            holders = await approvers.GetApproversAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return;
        }
        var text = Words(request, subject, details, request.RequestedByName);
        var now = DateTime.UtcNow;
        foreach (var holder in holders)
        {
            if (holder.EmployeeId is not { } recipient || recipient == request.RequestedByEmployeeId || recipient == subject.Id
                || holder.UserId.ToString() == request.RequestedByUserId)
                continue;
            db.Notifications.Add(CoreNotification.For(tenant.TenantId, recipient, CoreNotificationKind.ChangeRequested, request.Id,
                text with { ActorEmployeeId = request.RequestedByEmployeeId }, now));
        }
    }

    private void TellRequester(WorkforceChangeRequest request, Employee subject, ChangeActor actor, CoreNotificationKind kind)
    {
        if (request.RequestedByEmployeeId is not { } recipient || recipient == actor.EmployeeId) return;
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["actor"] = actor.Name,
            ["name"] = subject.DisplayName,
            ["date"] = request.EffectiveDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        };
        if (request.DeclineReason is { } why) values["reason"] = why;
        var address = request.Kind == WorkforceChangeRequestKind.HomeAddress;
        var title = $"{kind}{(address ? ".address" : "")}";
        var context = kind == CoreNotificationKind.ChangeDeclined ? "ChangeDeclined.context" : address ? null : "ChangeApproved.context";
        db.Notifications.Add(CoreNotification.For(tenant.TenantId, recipient, kind, request.Id,
            new CoreNotificationMessage(title, context, values, actor.Name, $"{RequestsPath}?request={request.Id}", actor.EmployeeId),
            DateTime.UtcNow));
    }

    /// <summary>A request's headline as catalogue keys: what it is about, who asked and from when.</summary>
    internal static CoreNotificationMessage Words(WorkforceChangeRequest request, Employee subject, WorkforceChangeDetails? details, string actorName)
    {
        var (title, context, values) = Headline(request.Kind, subject.DisplayName, actorName, request.EffectiveDate, details, request.Reason);
        return new CoreNotificationMessage(title, context, values, actorName, $"{RequestsPath}?request={request.Id}");
    }

    /// <summary>The title and context keys of a request, with their values; shared by notifications and Home.</summary>
    internal static (string Title, string Context, Dictionary<string, string> Values) Headline(
        WorkforceChangeRequestKind kind, string name, string actorName, DateOnly effectiveDate, WorkforceChangeDetails? details, string? reason)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["name"] = name,
            ["actor"] = actorName,
            ["date"] = (kind == WorkforceChangeRequestKind.EndEmployment ? details?.LastDay ?? effectiveDate : effectiveDate)
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        };
        string what;
        if (kind == WorkforceChangeRequestKind.HomeAddress) what = "address";
        else if (kind == WorkforceChangeRequestKind.EndEmployment) what = "leaving";
        else if (details is { TitleChanged: true } or { UnitChanged: true })
        {
            what = "job";
            values["summary"] = string.Join(" · ", new[] { details.TitleChanged ? details.TitleTo : null, details.UnitChanged ? details.UnitTo : null }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        }
        else if (details is { ManagerChanged: true })
        {
            what = details.ManagerTo is null ? "noManager" : "manager";
            if (details.ManagerTo is { } to) values["manager"] = to.DisplayName;
        }
        else
        {
            what = "place";
            values["summary"] = details?.LocationTo ?? "";
        }
        if (reason is not null) values["reason"] = reason;
        var context = what == "address" ? "Request.context.address" : reason is null ? "Request.context" : "Request.context.reason";
        return ($"Request.{what}", context, values);
    }

    // --- Projection -------------------------------------------------------------------------------

    private async Task<ChangeRequestDto> ProjectAsync(WorkforceChangeRequest request, ChangeActor actor, CancellationToken cancellationToken)
        => (await ProjectAsync([request], actor, cancellationToken))[0];

    private async Task<IReadOnlyList<ChangeRequestDto>> ProjectAsync(
        IReadOnlyList<WorkforceChangeRequest> requests, ChangeActor actor, CancellationToken cancellationToken)
    {
        if (requests.Count == 0) return [];
        var ids = requests.Select(item => item.SubjectEmployeeId).Distinct().ToList();
        var at = WorkforceChangeService.At(Today);
        var people = await db.Employees.AsNoTracking().Where(item => ids.Contains(item.Id)).ToDictionaryAsync(item => item.Id, cancellationToken);
        var work = await db.WorkAssignments.AsNoTracking()
            .Where(item => ids.Contains(item.EmployeeId) && item.IsPrimary && item.EffectiveFrom <= at && (item.EffectiveTo == null || at < item.EffectiveTo))
            .Select(item => new { item.EmployeeId, item.JobTitle, item.OrgUnitId })
            .ToListAsync(cancellationToken);
        var unitIds = work.Select(item => item.OrgUnitId).Distinct().ToList();
        var units = await db.OrgUnits.AsNoTracking().Where(item => unitIds.Contains(item.Id))
            .Select(item => new { item.Id, item.Name }).ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);

        var result = new List<ChangeRequestDto>(requests.Count);
        foreach (var request in requests)
        {
            var person = people.GetValueOrDefault(request.SubjectEmployeeId);
            var job = work.FirstOrDefault(item => item.EmployeeId == request.SubjectEmployeeId);
            var pending = request.Status == WorkforceChangeRequestStatus.Pending;
            var canDecide = pending && MayDecide(request, actor) is null;
            result.Add(new ChangeRequestDto(
                request.Id, request.Kind, request.Status,
                new ChangeRequestPerson(request.SubjectEmployeeId, person?.StableEmployeeKey ?? "", person?.DisplayName ?? "",
                    job?.JobTitle, job is null ? null : units.GetValueOrDefault(job.OrgUnitId)),
                new ChangeRequestActorRef(request.RequestedByEmployeeId, request.RequestedByName),
                request.CreatedAt, request.EffectiveDate, request.TypeList, request.Description, request.Note, request.ReasonId, request.Reason,
                request.Kind == WorkforceChangeRequestKind.HomeAddress ? null : JsonSerializer.Deserialize<WorkforceChangeDetails>(request.PreviewJson, Json),
                request.Kind == WorkforceChangeRequestKind.HomeAddress ? JsonSerializer.Deserialize<ChangeRequestAddress>(request.PreviewJson, Json) : null,
                request.DecidedByName is null ? null : new ChangeRequestActorRef(request.DecidedByEmployeeId, request.DecidedByName),
                request.DecidedAt, request.DeclineReason, request.AppliedChangeId,
                canDecide,
                pending && request.RequestedByUserId == actor.UserId,
                pending ? await StaleAsync(request, cancellationToken) : null));
        }
        return result;
    }

    private static Result<T> Fail<T>(string code, string message) => Result.Failure<T>(Error.Validation(code, message));
}
