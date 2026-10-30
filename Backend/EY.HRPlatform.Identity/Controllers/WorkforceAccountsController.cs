using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Branding;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Features.WorkforceAccess;
using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.Identity.Models.WorkforceAccounts;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

/// <summary>
/// The Workforce account provisioning boundary. This controller is reached only by a
/// signed internal caller (CoreHR), never by a browser: CoreHR has already resolved the
/// canonical Employee, tenant ownership, and work email from its own authority, and
/// passes them over the HMAC-authenticated channel. That is what stops a browser from
/// forging Employee ID/email/name facts on the mutation path — the tenant comes from the
/// trusted <c>X-Tenant-Id</c> header and the acting user from <c>X-Acting-User-Id</c>,
/// both meaningful only because the request carried a valid internal signature. Customer
/// permission enforcement (<c>core.access.view/manage@Tenant</c>) stays at CoreHR's
/// browser-facing workforce boundary.
/// </summary>
[ApiController]
[Route("internal/identity/workforce-accounts")]
[AllowAnonymous]
[ApiExplorerSettings(IgnoreApi = true)]
public sealed class WorkforceAccountsController(
    AppIdentityDbContext dbContext,
    IAccessProfileService accessProfileService,
    IConfiguration configuration,
    ITenantContinuityCommandExecutor continuity,
    IInternalServiceRequestAuthorizer internalAuthorizer,
    IWorkforceInvitationEmailSender workforceInvitationEmailSender) : ControllerBase
{
    private const string TenantHeader = "X-Tenant-Id";
    private const string ActingUserHeader = "X-Acting-User-Id";

    private const string StateUnprovisioned = "Unprovisioned";
    private const string StateInvitePending = "InvitePending";
    private const string StateInviteExpired = "InviteExpired";
    private const string StateInviteRevoked = "InviteRevoked";
    private const string StateInviteAccepted = "InviteAccepted";
    private const string StateActive = "Active";
    private const string StateInactive = "Inactive";
    private const string StateConflict = "Conflict";

    private const string OutcomeCreated = "Created";
    private const string OutcomePending = "Pending";
    private const string OutcomeActive = "Active";
    private const string OutcomeInactive = "Inactive";
    private const string OutcomeConflict = "Conflict";

    [HttpGet("summary")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountSummaryDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountSummaryDto>), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ApiResponse<WorkforceAccountSummaryDto>>> GetSummary(
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<WorkforceAccountSummaryDto>.Failure(tenantError));

        var now = DateTime.UtcNow;
        // Read the workforce Employee identity from the authoritative membership binding,
        // never the retired ApplicationUser.EmployeeId scalar (cutover, task 5.6).
        var userSnapshots = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .Where(m => m.TenantId == tenantId
                && m.Status == TenantMembershipStatus.Active
                && m.EmployeeId.HasValue)
            .Select(m => new
            {
                EmployeeId = m.EmployeeId!.Value,
                m.User!.IsActive,
            })
            .ToListAsync(cancellationToken);

        var userEmployeeIds = userSnapshots
            .Select(user => user.EmployeeId)
            .ToHashSet();

        var latestInvites = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .Where(invite => invite.TenantId == tenantId && invite.EmployeeId.HasValue)
            .Select(invite => new
            {
                EmployeeId = invite.EmployeeId!.Value,
                invite.IsUsed,
                invite.IsRevoked,
                invite.ExpiresAt,
                invite.CreatedAt,
            })
            .ToListAsync(cancellationToken);

        var latestInviteByEmployeeId = latestInvites
            .Where(invite => !userEmployeeIds.Contains(invite.EmployeeId))
            .GroupBy(invite => invite.EmployeeId)
            .Select(group => group
                .OrderByDescending(invite => invite.CreatedAt)
                .First())
            .ToList();

        var activeAccountCount = userSnapshots.Count(user => user.IsActive);
        var inactiveAccountCount = userSnapshots.Count(user => !user.IsActive);
        var pendingInviteCount = latestInviteByEmployeeId.Count(invite =>
            !invite.IsUsed &&
            !invite.IsRevoked &&
            invite.ExpiresAt > now);
        var acceptedInviteCount = latestInviteByEmployeeId.Count(invite => invite.IsUsed);
        var expiredInviteCount = latestInviteByEmployeeId.Count(invite =>
            !invite.IsUsed &&
            !invite.IsRevoked &&
            invite.ExpiresAt <= now);
        var revokedInviteCount = latestInviteByEmployeeId.Count(invite =>
            !invite.IsUsed &&
            invite.IsRevoked);

        var response = new WorkforceAccountSummaryDto
        {
            ActiveAccountCount = activeAccountCount,
            InactiveAccountCount = inactiveAccountCount,
            PendingInviteCount = pendingInviteCount,
            AcceptedInviteCount = acceptedInviteCount,
            ExpiredInviteCount = expiredInviteCount,
            RevokedInviteCount = revokedInviteCount,
            TrackedEmployeeCount = activeAccountCount
                + inactiveAccountCount
                + pendingInviteCount
                + acceptedInviteCount
                + expiredInviteCount
                + revokedInviteCount,
            AttentionQueueCount = inactiveAccountCount
                + acceptedInviteCount
                + expiredInviteCount
                + revokedInviteCount,
        };

        return Ok(ApiResponse<WorkforceAccountSummaryDto>.Success(response));
    }

    [HttpPost("statuses")]
    [ProducesResponseType(typeof(ApiResponse<List<WorkforceAccountStatusDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<List<WorkforceAccountStatusDto>>), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ApiResponse<List<WorkforceAccountStatusDto>>>> GetStatuses(
        [FromBody] WorkforceAccountStatusesRequest request,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<List<WorkforceAccountStatusDto>>.Failure(tenantError));

        var validationError = ValidateSubjects(request.Subjects);
        if (validationError is not null)
            return BadRequest(ApiResponse<List<WorkforceAccountStatusDto>>.Failure(validationError));

        var statuses = await ResolveStatusesAsync(
            tenantId,
            DistinctSubjects(request.Subjects).ToList(),
            cancellationToken);

        return Ok(ApiResponse<List<WorkforceAccountStatusDto>>.Success(statuses));
    }

    [HttpPost("bulk-provision")]
    [ProducesResponseType(typeof(ApiResponse<List<WorkforceAccountBulkProvisionResultDto>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<List<WorkforceAccountBulkProvisionResultDto>>), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ApiResponse<List<WorkforceAccountBulkProvisionResultDto>>>> BulkProvision(
        [FromBody] WorkforceAccountBulkProvisionRequest request,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<List<WorkforceAccountBulkProvisionResultDto>>.Failure(tenantError));

        var validationError = ValidateSubjects(request.Items);
        if (validationError is not null)
            return BadRequest(ApiResponse<List<WorkforceAccountBulkProvisionResultDto>>.Failure(validationError));

        var items = DistinctSubjects(request.Items).ToList();
        var statuses = await ResolveStatusesAsync(tenantId, items, cancellationToken);
        var statusesByEmployeeId = statuses.ToDictionary(status => status.EmployeeId);
        var baselineProfiles = await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(profile => profile.TenantId == tenantId
                && (profile.InternalKey == AccessProfileTemplates.Employee.InternalKey
                    || profile.InternalKey == AccessProfileTemplates.Manager.InternalKey))
            .Select(profile => new BulkBaselineProfile(
                profile.Id,
                profile.InternalKey!,
                profile.Name,
                profile.Type,
                profile.IsSystemProtected))
            .ToDictionaryAsync(profile => profile.InternalKey, cancellationToken);

        var results = new WorkforceAccountBulkProvisionResultDto?[items.Count];
        var invitationsToCreate = new List<BulkInvitationCreation>();
        for (var index = 0; index < items.Count; index++)
        {
            var item = items[index];
            var baselineProfile = string.Equals(item.Baseline, "Manager", StringComparison.OrdinalIgnoreCase)
                ? baselineProfiles.GetValueOrDefault(AccessProfileTemplates.Manager.InternalKey)
                : string.Equals(item.Baseline, "Employee", StringComparison.OrdinalIgnoreCase)
                    ? baselineProfiles.GetValueOrDefault(AccessProfileTemplates.Employee.InternalKey)
                    : null;
            var accessProfileId = item.AccessProfileId is { } explicitId && explicitId != Guid.Empty
                ? explicitId
                : baselineProfile?.Id ?? Guid.Empty;

            var status = statusesByEmployeeId[item.EmployeeId];
            if (accessProfileId == Guid.Empty)
            {
                results[index] = BuildBulkResult(
                    item.EmployeeId,
                    OutcomeConflict,
                    "Access profile or a recognised baseline is required.",
                    status);
                continue;
            }

            // New/revoked invitations are the dominant large-cohort path. Persisting and
            // delivering them as one prepared set avoids hundreds of repeated tenant/profile
            // reads and SaveChanges calls. Explicit custom-profile requests keep the existing
            // single-item path because their compatibility role must be resolved from grants.
            if (baselineProfile is not null
                && status.ProvisioningState is StateUnprovisioned or StateInviteRevoked)
            {
                invitationsToCreate.Add(new BulkInvitationCreation(index, item, baselineProfile));
                continue;
            }

            try
            {
                results[index] = await ProvisionInviteAsync(
                    tenantId,
                    item,
                    accessProfileId,
                    cancellationToken,
                    status);
            }
            catch
            {
                // Per-person independence is part of the bulk contract. A collision or
                // delivery failure for one canonical Employee must not discard the
                // outcomes already committed for the rest of the reviewed population.
                results[index] = BuildBulkResult(
                    item.EmployeeId,
                    OutcomeConflict,
                    "The invitation could not be processed.",
                    status);
            }
        }

        if (invitationsToCreate.Count > 0)
        {
            try
            {
                var created = await CreateInvitesBatchAsync(tenantId, invitationsToCreate, cancellationToken);
                foreach (var (index, result) in created)
                    results[index] = result;
            }
            catch (DbUpdateException)
            {
                // A concurrent identity change can invalidate one item between the status
                // read and insert. The relational batch is atomic, so clear the failed unit
                // and fall back to independent re-resolution rather than losing the receipt.
                dbContext.ChangeTracker.Clear();
                foreach (var creation in invitationsToCreate)
                {
                    try
                    {
                        results[creation.Index] = await ProvisionInviteAsync(
                            tenantId,
                            creation.Item,
                            creation.Profile.Id,
                            cancellationToken);
                    }
                    catch
                    {
                        results[creation.Index] = BuildBulkResult(
                            creation.Item.EmployeeId,
                            OutcomeConflict,
                            "The invitation could not be processed.",
                            statusesByEmployeeId[creation.Item.EmployeeId]);
                    }
                }
            }
        }

        return Ok(ApiResponse<List<WorkforceAccountBulkProvisionResultDto>>.Success(
            results.Select(result => result!).ToList()));
    }

    [HttpPost("{employeeId:guid}/invite")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ApiResponse<WorkforceAccountStatusDto>>> ProvisionInvite(
        Guid employeeId,
        [FromBody] ProvisionWorkforceAccountInviteRequest request,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure(tenantError));

        var subject = new WorkforceAccountProvisionItemDto
        {
            EmployeeId = employeeId,
            Email = request.Email,
            FirstName = request.FirstName,
            LastName = request.LastName,
            AccessProfileId = request.AccessProfileId,
        };

        var validationError = ValidateSubject(subject);
        if (validationError is not null)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure(validationError));

        if (request.AccessProfileId == Guid.Empty)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("Access profile is required."));

        var result = await ProvisionInviteAsync(tenantId, subject, request.AccessProfileId, cancellationToken);
        return Ok(ApiResponse<WorkforceAccountStatusDto>.Success(result.Account));
    }

    [HttpPost("{employeeId:guid}/resend")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<WorkforceAccountStatusDto>>> ResendInvite(
        Guid employeeId,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure(tenantError));

        var invite = await FindLatestInviteByEmployeeAsync(tenantId, employeeId, cancellationToken);
        if (invite is null)
            return NotFound(ApiResponse<WorkforceAccountStatusDto>.Failure("Invitation not found."));

        if (invite.IsUsed)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("Cannot resend an accepted invitation."));

        if (invite.IsRevoked)
        {
            var inviteProfileIds = await ResolveInviteProfileIdsAsync(invite, cancellationToken);
            if (inviteProfileIds.Count == 0)
                return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("This invitation no longer has a valid access profile."));

            invite = await CreateInviteAsync(
                tenantId,
                new WorkforceAccountSubjectDto
                {
                    EmployeeId = employeeId,
                    Email = invite.Email,
                    FirstName = invite.FirstName,
                    LastName = invite.LastName
                },
                inviteProfileIds[0],
                cancellationToken);
        }
        else
        {
            invite.ExtendExpiry();
            await DeliverInviteAsync(invite, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId, GetActingUserId(), actorName: string.Empty, actorRole: "Workforce",
            WorkforceAccessAuditActions.InvitationResent,
            WorkforceAccessAuditActions.ResourceTypeWorkforceInvitation,
            invite.Id.ToString(),
            "Workforce invitation resent with a fresh credential.",
            beforeJson: null, afterJson: null, correlationId: employeeId.ToString()));
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ApiResponse<WorkforceAccountStatusDto>.Success(await BuildInviteStatusAsync(employeeId, invite, cancellationToken)));
    }

    [HttpPost("{employeeId:guid}/withdraw")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<WorkforceAccountStatusDto>>> WithdrawInvite(
        Guid employeeId, CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure(tenantError));

        var invite = await FindLatestInviteByEmployeeAsync(tenantId, employeeId, cancellationToken);
        if (invite is null)
            return NotFound(ApiResponse<WorkforceAccountStatusDto>.Failure("Invitation not found."));

        if (invite.IsUsed)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("Cannot withdraw an accepted invitation."));

        // Revoke retires the credential so the outstanding link stops resolving; the row
        // stays for the append-only history. Re-inviting later mints a fresh credential.
        if (!invite.IsRevoked)
        {
            invite.Revoke();
        }

        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId, GetActingUserId(), actorName: string.Empty, actorRole: "Workforce",
            WorkforceAccessAuditActions.InvitationWithdrawn,
            WorkforceAccessAuditActions.ResourceTypeWorkforceInvitation,
            invite.Id.ToString(),
            "Workforce invitation withdrawn.",
            beforeJson: null, afterJson: null, correlationId: employeeId.ToString()));
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ApiResponse<WorkforceAccountStatusDto>.Success(await BuildInviteStatusAsync(employeeId, invite, cancellationToken)));
    }

    [HttpGet("{employeeId:guid}/access-audit")]
    [ProducesResponseType(typeof(ApiResponse<List<WorkforceAccessAuditLineDto>>), StatusCodes.Status200OK)]
    public async Task<ActionResult<ApiResponse<List<WorkforceAccessAuditLineDto>>>> GetAccessAudit(
        Guid employeeId, CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<List<WorkforceAccessAuditLineDto>>.Failure(tenantError));

        // Workforce audit events carry correlationId = employeeId, so the whole per-person
        // history reads back with one indexed filter — invitation, activation, and binding.
        var key = employeeId.ToString();
        var lines = await dbContext.AccessAuditEvents
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.CorrelationId == key)
            .OrderByDescending(e => e.OccurredAt)
            .Take(8)
            .Select(e => new WorkforceAccessAuditLineDto(
                e.Action, e.ActorName, e.ActorRole, e.OccurredAt, e.Summary))
            .ToListAsync(cancellationToken);

        return Ok(ApiResponse<List<WorkforceAccessAuditLineDto>>.Success(lines));
    }

    [HttpPut("{employeeId:guid}/invite-profiles")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<WorkforceAccountStatusDto>>> UpdateInviteProfiles(
        Guid employeeId,
        [FromBody] SetPendingInviteAccessProfilesRequest request,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure(tenantError));

        var accessProfileIds = request.AccessProfileIds
            .Where(profileId => profileId != Guid.Empty)
            .Distinct()
            .ToList();

        if (accessProfileIds.Count == 0)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("At least one access profile is required."));

        var invite = await FindLatestInviteByEmployeeAsync(tenantId, employeeId, cancellationToken);
        if (invite is null)
            return NotFound(ApiResponse<WorkforceAccountStatusDto>.Failure("Invitation not found."));

        if (invite.IsUsed)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("Cannot change access profiles for an accepted invitation."));

        if (invite.IsRevoked)
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure("Cannot change access profiles for a revoked invitation."));

        await accessProfileService.SetInviteAccessProfilesAsync(tenantId, invite.Id, accessProfileIds, cancellationToken);
        invite.UpdateRole(await ResolveCompatibilityRoleAsync(tenantId, accessProfileIds, cancellationToken));
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ApiResponse<WorkforceAccountStatusDto>.Success(await BuildInviteStatusAsync(employeeId, invite, cancellationToken)));
    }

    [HttpPost("{employeeId:guid}/reactivate")]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse<WorkforceAccountStatusDto>), StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ApiResponse<WorkforceAccountStatusDto>>> Reactivate(
        Guid employeeId,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse<WorkforceAccountStatusDto>.Failure(tenantError));

        var user = await FindUserByEmployeeAsync(tenantId, employeeId, cancellationToken);
        if (user is null)
            return NotFound(ApiResponse<WorkforceAccountStatusDto>.Failure("Account not found."));

        // Runs inside the tenant continuity boundary like every other command
        // that can change whether this tenant has a usable administrator.
        // Reactivation cannot remove one, but routing it here keeps the access
        // revision bump and the audit in the same transaction as the change.
        var reactivated = await continuity.ExecuteAsync<bool>(
            tenantId,
            (GetActingUserId() ?? Guid.Empty),
            async context =>
            {
                var account = await context.Db.Users.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(item => item.Id == user.Id, cancellationToken);

                if (account is null)
                {
                    return ContinuityResult<bool>.Refused(ContinuityFailure.NotFound);
                }

                account.IsActive = true;
                await InvalidateMembershipAsync(context, account.Id, cancellationToken);
                return ContinuityResult<bool>.Ok(true);
            },
            cancellationToken);

        if (!reactivated.Succeeded)
        {
            return NotFound(ApiResponse<WorkforceAccountStatusDto>.Failure("Account not found."));
        }

        dbContext.ChangeTracker.Clear();
        user = await FindUserByEmployeeAsync(tenantId, employeeId, cancellationToken);

        if (user is null)
        {
            return NotFound(ApiResponse<WorkforceAccountStatusDto>.Failure("Account not found."));
        }

        return Ok(ApiResponse<WorkforceAccountStatusDto>.Success(await BuildUserStatusAsync(employeeId, user, cancellationToken)));
    }

    [HttpDelete("{employeeId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Deactivate(
        Guid employeeId,
        CancellationToken cancellationToken)
    {
        if (!await internalAuthorizer.AuthorizeAsync(Request, cancellationToken))
            return Unauthorized();

        if (!TryGetTenantId(out var tenantId, out var tenantError))
            return BadRequest(ApiResponse.Failure(tenantError));

        var user = await FindUserByEmployeeAsync(tenantId, employeeId, cancellationToken);
        if (user is null)
            return NotFound(ApiResponse.Failure("Account not found."));

        // Disabling a global account can make a Tenant Administrator unusable,
        // so this passes through the continuity boundary. If this account is the
        // tenant's last usable administrator the command is refused — a workforce
        // route must not be a way around the invariant.
        var deactivated = await continuity.ExecuteAsync<bool>(
            tenantId,
            (GetActingUserId() ?? Guid.Empty),
            async context =>
            {
                var account = await context.Db.Users.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(item => item.Id == user.Id, cancellationToken);

                if (account is null)
                {
                    return ContinuityResult<bool>.Refused(ContinuityFailure.NotFound);
                }

                account.IsActive = false;
                await InvalidateMembershipAsync(context, account.Id, cancellationToken);
                return ContinuityResult<bool>.Ok(true);
            },
            cancellationToken);

        if (deactivated.Failure == ContinuityFailure.FinalAdministrator)
        {
            return Conflict(ApiResponse.Failure(
                "This account belongs to the tenant's only usable Tenant Administrator. "
                + "Invite or restore another administrator first."));
        }

        if (!deactivated.Succeeded)
        {
            return NotFound(ApiResponse.Failure("Account not found."));
        }

        return NoContent();
    }

    /// <summary>
    /// Marks this account's tenant access as no longer current, so a token
    /// issued before the change stops being honoured on the very next request.
    /// </summary>
    private static async Task InvalidateMembershipAsync(
        TenantContinuityContext context, Guid userId, CancellationToken cancellationToken)
    {
        var membership = await context.Db.TenantMemberships.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.UserId == userId
                && item.TenantId == context.TenantId, cancellationToken);

        if (membership is not null)
        {
            context.InvalidateTenantAccess(membership);
        }
    }

    private async Task<WorkforceAccountBulkProvisionResultDto> ProvisionInviteAsync(
        Guid tenantId,
        WorkforceAccountSubjectDto subject,
        Guid accessProfileId,
        CancellationToken cancellationToken,
        WorkforceAccountStatusDto? resolvedStatus = null)
    {
        var status = resolvedStatus ?? await ResolveStatusAsync(tenantId, subject, cancellationToken);

        switch (status.ProvisioningState)
        {
            case StateUnprovisioned:
            case StateInviteRevoked:
            {
                var invite = await CreateInviteAsync(tenantId, subject, accessProfileId, cancellationToken);
                var account = await BuildInviteStatusAsync(subject.EmployeeId, invite, cancellationToken);
                return BuildBulkResult(subject.EmployeeId, OutcomeCreated, "Invitation created.", account);
            }

            case StateInviteExpired:
            {
                var invite = await FindLatestInviteByEmployeeAsync(tenantId, subject.EmployeeId, cancellationToken);
                if (invite is null)
                {
                    invite = await CreateInviteAsync(tenantId, subject, accessProfileId, cancellationToken);
                }
                else
                {
                    invite.ExtendExpiry();
                    await accessProfileService.SetInviteAccessProfilesAsync(tenantId, invite.Id, [accessProfileId], cancellationToken);
                    invite.UpdateRole(await ResolveCompatibilityRoleAsync(tenantId, [accessProfileId], cancellationToken));
                    await DeliverInviteAsync(invite, cancellationToken);
                    await dbContext.SaveChangesAsync(cancellationToken);
                }

                var account = await BuildInviteStatusAsync(subject.EmployeeId, invite, cancellationToken);
                return BuildBulkResult(subject.EmployeeId, OutcomeCreated, "Invitation refreshed.", account);
            }

            case StateInvitePending:
                return BuildBulkResult(subject.EmployeeId, OutcomePending, "Invitation is already pending.", status);
            case StateActive:
                return BuildBulkResult(subject.EmployeeId, OutcomeActive, "Account is already active.", status);
            case StateInactive:
                return BuildBulkResult(subject.EmployeeId, OutcomeInactive, "Account is inactive.", status);
            default:
                return BuildBulkResult(subject.EmployeeId, OutcomeConflict, status.Conflict?.Message ?? "Access conflict.", status);
        }
    }

    private async Task<WorkforceAccountStatusDto> ResolveStatusAsync(
        Guid tenantId,
        WorkforceAccountSubjectDto subject,
        CancellationToken cancellationToken)
        => (await ResolveStatusesAsync(tenantId, [subject], cancellationToken))[0];

    /// <summary>
    /// Resolves a roster scope from a bounded set of queries. The previous implementation
    /// ran up to four account/invitation lookups per person, which made a 420-person
    /// selection preview execute well over a thousand serial database commands. This
    /// keeps the exact Employee/email conflict semantics while assembling the result from
    /// tenant-scoped sets in memory.
    /// </summary>
    private async Task<List<WorkforceAccountStatusDto>> ResolveStatusesAsync(
        Guid tenantId,
        IReadOnlyCollection<WorkforceAccountSubjectDto> subjects,
        CancellationToken cancellationToken)
    {
        if (subjects.Count == 0)
            return [];

        var subjectList = subjects.ToList();
        var employeeIds = subjectList.Select(subject => subject.EmployeeId).Distinct().ToArray();
        var normalizedEmails = subjectList
            .Select(subject => NormalizeEmail(subject.Email))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var normalizedEmailsUpper = normalizedEmails
            .Select(email => email.ToUpperInvariant())
            .ToArray();

        var userSnapshots = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(membership => membership.TenantId == tenantId
                && membership.Status == TenantMembershipStatus.Active
                && (membership.EmployeeId.HasValue && employeeIds.Contains(membership.EmployeeId.Value)
                    || membership.User!.NormalizedEmail != null
                        && normalizedEmailsUpper.Contains(membership.User.NormalizedEmail)))
            .Select(membership => new ActiveUserSnapshot(
                membership.Id,
                membership.UserId,
                membership.EmployeeId,
                membership.User!.Email ?? string.Empty,
                membership.User.NormalizedEmail,
                membership.User.FullName,
                membership.User.IsActive,
                membership.User.LastLoginAt))
            .ToListAsync(cancellationToken);

        var invites = await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invite => invite.TenantId == tenantId
                && (invite.EmployeeId.HasValue && employeeIds.Contains(invite.EmployeeId.Value)
                    || normalizedEmails.Contains(invite.Email)))
            .OrderByDescending(invite => invite.CreatedAt)
            .ToListAsync(cancellationToken);

        var userStatuses = await BuildUserStatusesAsync(tenantId, userSnapshots, cancellationToken);
        var inviteStatuses = await BuildInviteStatusesAsync(invites, cancellationToken);
        var usersByEmployee = userSnapshots
            .Where(user => user.EmployeeId.HasValue)
            .GroupBy(user => user.EmployeeId!.Value)
            .ToDictionary(group => group.Key, group => group.First());
        var usersByEmail = userSnapshots
            .Where(user => !string.IsNullOrWhiteSpace(user.NormalizedEmail))
            .GroupBy(user => user.NormalizedEmail!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var invitesByEmployee = invites
            .Where(invite => invite.EmployeeId.HasValue)
            .GroupBy(invite => invite.EmployeeId!.Value)
            .ToDictionary(group => group.Key, group => group.First());
        var invitesByEmail = invites
            .GroupBy(invite => invite.Email, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        return subjectList.Select(subject =>
        {
            var normalizedEmail = NormalizeEmail(subject.Email);
            var normalizedEmailUpper = normalizedEmail.ToUpperInvariant();

            if (usersByEmployee.TryGetValue(subject.EmployeeId, out var userByEmployee))
            {
                return !string.Equals(userByEmployee.NormalizedEmail, normalizedEmailUpper, StringComparison.Ordinal)
                    ? BuildConflictStatus(subject, "EmployeeEmailMismatch", "This employee is linked to a different account email.", "Review the employee email or deactivate the linked account first.")
                    : CopyStatusForEmployee(userStatuses[userByEmployee.UserId], subject.EmployeeId);
            }

            if (usersByEmail.TryGetValue(normalizedEmailUpper, out var userByEmail))
            {
                return userByEmail.EmployeeId.HasValue && userByEmail.EmployeeId.Value != subject.EmployeeId
                    ? BuildConflictStatus(subject, "EmployeeEmailMismatch", "This email is already linked to a different employee.", "Review duplicate employee records before inviting.")
                    : BuildConflictStatus(
                        subject,
                        "MatchingAccountRequiresExplicitLink",
                        "A Fusion account in this organization uses this email but is not linked to this employee.",
                        "Review the account and link it through an explicit access action.");
            }

            if (invitesByEmployee.TryGetValue(subject.EmployeeId, out var inviteByEmployee))
            {
                return !string.Equals(inviteByEmployee.Email, normalizedEmail, StringComparison.OrdinalIgnoreCase)
                    ? BuildConflictStatus(subject, "EmployeeEmailMismatch", "This employee has an invitation for a different email.", "Revoke the old invitation before sending a new one.")
                    : CopyStatusForEmployee(inviteStatuses[inviteByEmployee.Id], subject.EmployeeId);
            }

            if (invitesByEmail.TryGetValue(normalizedEmail, out var inviteByEmail))
            {
                return inviteByEmail.EmployeeId.HasValue && inviteByEmail.EmployeeId.Value != subject.EmployeeId
                    ? BuildConflictStatus(subject, "EmployeeEmailMismatch", "This email already has an invitation for a different employee.", "Review duplicate employee records before inviting.")
                    : BuildConflictStatus(
                        subject,
                        "MatchingInvitationRequiresExplicitLink",
                        "An invitation in this organization uses this email but is not linked to this employee.",
                        "Review the invitation and link it through an explicit access action.");
            }

            return BuildUnprovisionedStatus(subject);
        }).ToList();
    }

    private async Task<Dictionary<Guid, WorkforceAccountStatusDto>> BuildUserStatusesAsync(
        Guid tenantId,
        IReadOnlyCollection<ActiveUserSnapshot> users,
        CancellationToken cancellationToken)
    {
        if (users.Count == 0)
            return [];

        var membershipIds = users.Select(user => user.MembershipId).Distinct().ToArray();
        var profileRows = await dbContext.UserAccessProfiles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => membershipIds.Contains(assignment.TenantMembershipId))
            .Join(
                dbContext.AccessProfiles.IgnoreQueryFilters(),
                assignment => assignment.AccessProfileId,
                profile => profile.Id,
                (assignment, profile) => new UserProfileRow(
                    assignment.UserId,
                    profile.Id,
                    profile.Name,
                    profile.Type,
                    profile.IsSystemProtected))
            .ToListAsync(cancellationToken);
        var profilesByUserId = profileRows
            .GroupBy(profile => profile.UserId)
            .ToDictionary(
                group => group.Key,
                group => group
                    .Select(profile => new AccessProfileAssignmentSummaryDto
                    {
                        Id = profile.ProfileId,
                        Name = profile.Name,
                        Type = profile.Type,
                        IsSystemProtected = profile.IsSystemProtected,
                    })
                    .OrderBy(profile => profile.Name)
                    .ToList());

        // Compatibility role is display-only on this contract. It remains derived from
        // effective profile grants, loaded once for the whole roster scope.
        var profileIds = profileRows.Select(profile => profile.ProfileId).Distinct().ToArray();
        var grants = profileIds.Length == 0
            ? []
            : await dbContext.AccessProfileGrants
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(grant => grant.TenantId == tenantId && profileIds.Contains(grant.AccessProfileId))
                .Select(grant => new ProfileGrantRow(grant.AccessProfileId, grant.PermissionKey, grant.Scope))
                .ToListAsync(cancellationToken);
        var grantsByProfileId = grants
            .GroupBy(grant => grant.ProfileId)
            .ToDictionary(group => group.Key, group => group.ToList());
        var profileIdsByUserId = profileRows
            .GroupBy(profile => profile.UserId)
            .ToDictionary(group => group.Key, group => group.Select(profile => profile.ProfileId).Distinct().ToList());

        return users
            .GroupBy(user => user.UserId)
            .Select(group => group.First())
            .ToDictionary(
                user => user.UserId,
                user =>
                {
                    var effectiveGrants = profileIdsByUserId.GetValueOrDefault(user.UserId, [])
                        .SelectMany(profileId => grantsByProfileId.GetValueOrDefault(profileId, []))
                        .Select(grant => new EffectivePermissionGrant(grant.PermissionKey, grant.Scope))
                        .ToList();
                    return new WorkforceAccountStatusDto
                    {
                        EmployeeId = user.EmployeeId ?? Guid.Empty,
                        Email = user.Email,
                        FullName = user.FullName,
                        Role = accessProfileService.ResolveCompatibilityRole(effectiveGrants),
                        AccessProfiles = profilesByUserId.GetValueOrDefault(user.UserId, []),
                        ProvisioningState = user.IsActive ? StateActive : StateInactive,
                        UserId = user.UserId,
                        IsActive = user.IsActive,
                        LastLoginAt = user.LastLoginAt,
                    };
                });
    }

    private async Task<Dictionary<Guid, WorkforceAccountStatusDto>> BuildInviteStatusesAsync(
        IReadOnlyCollection<InviteToken> invites,
        CancellationToken cancellationToken)
    {
        if (invites.Count == 0)
            return [];

        var inviteIds = invites.Select(invite => invite.Id).Distinct().ToArray();
        var profileRows = await dbContext.InviteAccessProfiles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(assignment => inviteIds.Contains(assignment.InviteTokenId))
            .Join(
                dbContext.AccessProfiles.IgnoreQueryFilters(),
                assignment => assignment.AccessProfileId,
                profile => profile.Id,
                (assignment, profile) => new InviteProfileRow(
                    assignment.InviteTokenId,
                    profile.Id,
                    profile.Name,
                    profile.Type,
                    profile.IsSystemProtected))
            .ToListAsync(cancellationToken);
        var profilesByInviteId = profileRows
            .GroupBy(profile => profile.InviteId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(profile => new AccessProfileAssignmentSummaryDto
                    {
                        Id = profile.ProfileId,
                        Name = profile.Name,
                        Type = profile.Type,
                        IsSystemProtected = profile.IsSystemProtected,
                    })
                    .OrderBy(profile => profile.Name)
                    .ToList());

        return invites.ToDictionary(
            invite => invite.Id,
            invite => BuildInviteStatus(
                invite.EmployeeId ?? Guid.Empty,
                invite,
                profilesByInviteId.GetValueOrDefault(invite.Id, [])));
    }

    private static WorkforceAccountStatusDto CopyStatusForEmployee(
        WorkforceAccountStatusDto source,
        Guid employeeId)
        => new()
        {
            EmployeeId = employeeId,
            Email = source.Email,
            FullName = source.FullName,
            Role = source.Role,
            AccessProfiles = source.AccessProfiles,
            ProvisioningState = source.ProvisioningState,
            UserId = source.UserId,
            IsActive = source.IsActive,
            LastLoginAt = source.LastLoginAt,
            InviteId = source.InviteId,
            InviteCreatedAt = source.InviteCreatedAt,
            InviteExpiresAt = source.InviteExpiresAt,
            InviteLink = source.InviteLink,
            DeliveryStatus = source.DeliveryStatus,
            DeliveryMessage = source.DeliveryMessage,
            DeliveryRecordedAt = source.DeliveryRecordedAt,
            Conflict = source.Conflict,
        };

    private async Task<InviteToken> CreateInviteAsync(
        Guid tenantId,
        WorkforceAccountSubjectDto subject,
        Guid accessProfileId,
        CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(current => current.Id == tenantId && current.IsActive && !current.IsArchived, cancellationToken);
        if (tenant is null)
            throw new InvalidOperationException("Tenant not found or inactive.");

        var selectedProfile = await accessProfileService.GetProfileAsync(tenantId, accessProfileId, cancellationToken)
            ?? throw new InvalidOperationException("Access profile not found.");

        var compatibilityRole = accessProfileService.ResolveCompatibilityRole(
            selectedProfile.Grants
                .Select(grant => new EffectivePermissionGrant(grant.PermissionKey, grant.Scope))
                .ToList());

        var currentUserId = (GetActingUserId() ?? Guid.Empty);
        var invite = InviteToken.CreateWorkforce(
            NormalizeEmail(subject.Email),
            tenantId,
            compatibilityRole,
            currentUserId,
            subject.FirstName,
            subject.LastName,
            subject.EmployeeId);

        // Hash-only credential: only the selector and digest are stored. The raw secret
        // exists just long enough to build the delivery link and is never persisted, so
        // no reusable workforce secret survives at rest and no status read can leak one.
        var credential = IssueRotatedCredential(invite);

        dbContext.InviteTokens.Add(invite);

        // Durable, append-only record that this workforce invitation was issued, carrying
        // the actor, the target Employee, and the reviewed baseline profile.
        dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId,
            GetActingUserId(),
            actorName: string.Empty,
            actorRole: "Workforce",
            WorkforceAccessAuditActions.InvitationIssued,
            WorkforceAccessAuditActions.ResourceTypeWorkforceInvitation,
            invite.Id.ToString(),
            $"Workforce invitation issued for {selectedProfile.Name} access.",
            beforeJson: null,
            afterJson: null,
            correlationId: subject.EmployeeId.ToString()));

        await dbContext.SaveChangesAsync(cancellationToken);
        await accessProfileService.SetInviteAccessProfilesAsync(tenantId, invite.Id, [selectedProfile.Id], cancellationToken);
        await DeliverInviteAsync(invite, tenant.Name, credential.RawValue, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        return invite;
    }

    private async Task<IReadOnlyList<(int Index, WorkforceAccountBulkProvisionResultDto Result)>> CreateInvitesBatchAsync(
        Guid tenantId,
        IReadOnlyCollection<BulkInvitationCreation> creations,
        CancellationToken cancellationToken)
    {
        var tenantName = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId && tenant.IsActive && !tenant.IsArchived)
            .Select(tenant => tenant.Name)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new InvalidOperationException("Tenant not found or inactive.");
        var branding = await CompanyBrandReader.ForInvitationAsync(dbContext, tenantId, cancellationToken);
        var actorId = GetActingUserId();
        var prepared = new List<PreparedBulkInvitation>(creations.Count);

        foreach (var creation in creations)
        {
            var role = creation.Profile.InternalKey == AccessProfileTemplates.Manager.InternalKey
                ? PlatformRole.Manager
                : PlatformRole.Employee;
            var invite = InviteToken.CreateWorkforce(
                NormalizeEmail(creation.Item.Email),
                tenantId,
                role,
                actorId ?? Guid.Empty,
                creation.Item.FirstName,
                creation.Item.LastName,
                creation.Item.EmployeeId);
            var credential = IssueRotatedCredential(invite);

            dbContext.InviteTokens.Add(invite);
            dbContext.InviteAccessProfiles.Add(InviteAccessProfile.Create(
                tenantId,
                invite.Id,
                creation.Profile.Id));
            dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
                tenantId,
                actorId,
                actorName: string.Empty,
                actorRole: "Workforce",
                WorkforceAccessAuditActions.InvitationIssued,
                WorkforceAccessAuditActions.ResourceTypeWorkforceInvitation,
                invite.Id.ToString(),
                $"Workforce invitation issued for {creation.Profile.Name} access.",
                beforeJson: null,
                afterJson: null,
                correlationId: creation.Item.EmployeeId.ToString()));

            prepared.Add(new PreparedBulkInvitation(creation, invite, credential.RawValue));
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        using var deliveryGate = new SemaphoreSlim(initialCount: 8);
        var deliveryTasks = prepared.Select(async item =>
        {
            await deliveryGate.WaitAsync(cancellationToken);
            try
            {
                return await workforceInvitationEmailSender.SendInviteAsync(
                    new WorkforceInvitationEmailMessage(
                        item.Invite.Id,
                        item.Invite.TenantId,
                        tenantName,
                        item.Invite.EmployeeId,
                        item.Invite.Email,
                        BuildFullName(item.Invite.FirstName, item.Invite.LastName),
                        BuildInviteLink(item.RawCredential),
                        item.Invite.ExpiresAt,
                        [item.Creation.Profile.Name],
                        branding),
                    cancellationToken);
            }
            finally
            {
                deliveryGate.Release();
            }
        }).ToArray();
        var deliveries = await Task.WhenAll(deliveryTasks);

        for (var index = 0; index < prepared.Count; index++)
        {
            prepared[index].Invite.RecordDelivery(
                deliveries[index].Status,
                deliveries[index].Message,
                deliveries[index].RecordedAt);
        }
        await dbContext.SaveChangesAsync(cancellationToken);

        return prepared.Select(item =>
        {
            var profile = item.Creation.Profile;
            var account = BuildInviteStatus(
                item.Creation.Item.EmployeeId,
                item.Invite,
                [new AccessProfileAssignmentSummaryDto
                {
                    Id = profile.Id,
                    Name = profile.Name,
                    Type = profile.Type,
                    IsSystemProtected = profile.IsSystemProtected,
                }]);
            return (
                item.Creation.Index,
                BuildBulkResult(
                    item.Creation.Item.EmployeeId,
                    OutcomeCreated,
                    "Invitation created.",
                    account));
        }).ToList();
    }

    /// <summary>
    /// Issues or rotates the invitation's selector/secret credential. Rotating replaces the
    /// selector, so a previously delivered link stops resolving the moment this commits —
    /// which is what makes a resend or refresh invalidate the old link rather than extend it.
    /// </summary>
    private static BootstrapCredential IssueRotatedCredential(InviteToken invite)
    {
        var credential = BootstrapCredential.Issue();
        invite.IssueCredential(credential.Selector, BootstrapCredential.Digest(credential.Secret));
        return credential;
    }

    private async Task<ApplicationUser?> FindUserByEmployeeAsync(
        Guid tenantId,
        Guid employeeId,
        CancellationToken cancellationToken)
        => await dbContext.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.TenantMemberships.Any(m =>
                m.TenantId == tenantId
                && m.Status == TenantMembershipStatus.Active
                && m.EmployeeId == employeeId), cancellationToken);

    private async Task<InviteToken?> FindLatestInviteByEmployeeAsync(
        Guid tenantId,
        Guid employeeId,
        CancellationToken cancellationToken)
        => await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(invite => invite.TenantId == tenantId && invite.EmployeeId == employeeId)
            .OrderByDescending(invite => invite.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<InviteToken?> FindLatestInviteAsync(
        Guid tenantId,
        WorkforceAccountSubjectDto subject,
        CancellationToken cancellationToken)
    {
        var normalizedEmail = NormalizeEmail(subject.Email);
        return await dbContext.InviteTokens
            .IgnoreQueryFilters()
            .Where(invite => invite.TenantId == tenantId && (invite.EmployeeId == subject.EmployeeId || invite.Email == normalizedEmail))
            .OrderByDescending(invite => invite.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<WorkforceAccountStatusDto> BuildUserStatusAsync(Guid employeeId, ApplicationUser user, CancellationToken cancellationToken)
    {
        var accessProfiles = (await accessProfileService.GetAssignedProfilesAsync(user, cancellationToken)).ToList();
        var effectivePermissions = await accessProfileService.GetEffectivePermissionsAsync(user, cancellationToken);
        return new WorkforceAccountStatusDto
        {
            EmployeeId = employeeId,
            Email = user.Email ?? string.Empty,
            FullName = user.FullName,
            Role = accessProfileService.ResolveCompatibilityRole(effectivePermissions),
            AccessProfiles = accessProfiles,
            ProvisioningState = user.IsActive ? StateActive : StateInactive,
            UserId = user.Id,
            IsActive = user.IsActive,
            LastLoginAt = user.LastLoginAt
        };
    }

    private async Task<WorkforceAccountStatusDto> BuildInviteStatusAsync(Guid employeeId, InviteToken invite, CancellationToken cancellationToken)
    {
        var accessProfiles = (await accessProfileService.GetInviteAccessProfilesAsync(invite.Id, cancellationToken)).ToList();
        return BuildInviteStatus(employeeId, invite, accessProfiles);
    }

    private static WorkforceAccountStatusDto BuildInviteStatus(
        Guid employeeId,
        InviteToken invite,
        List<AccessProfileAssignmentSummaryDto> accessProfiles)
    {
        var state = invite.IsRevoked
            ? StateInviteRevoked
            : invite.IsUsed
                ? StateInviteAccepted
                : invite.IsExpired
                    ? StateInviteExpired
                    : StateInvitePending;

        return new WorkforceAccountStatusDto
        {
            EmployeeId = employeeId,
            Email = invite.Email,
            FullName = BuildFullName(invite.FirstName, invite.LastName),
            Role = invite.Role,
            AccessProfiles = accessProfiles,
            ProvisioningState = state,
            InviteId = invite.Id,
            InviteCreatedAt = invite.CreatedAt,
            InviteExpiresAt = invite.ExpiresAt,
            // The activation link is never exposed through a status read: the raw secret is
            // not stored, and surfacing it would defeat the hash-only credential. The link
            // reaches the recipient only through delivery (or Development capture).
            InviteLink = null,
            DeliveryStatus = invite.DeliveryStatus,
            DeliveryMessage = invite.DeliveryMessage,
            DeliveryRecordedAt = invite.DeliveryRecordedAt
        };
    }

    private static WorkforceAccountStatusDto BuildUnprovisionedStatus(WorkforceAccountSubjectDto subject)
        => new()
        {
            EmployeeId = subject.EmployeeId,
            Email = NormalizeEmail(subject.Email),
            FullName = BuildFullName(subject.FirstName, subject.LastName),
            Role = PlatformRole.Employee,
            AccessProfiles = [],
            ProvisioningState = StateUnprovisioned
        };

    private static WorkforceAccountStatusDto BuildConflictStatus(
        WorkforceAccountSubjectDto subject,
        string kind,
        string message,
        string suggestedAction)
        => new()
        {
            EmployeeId = subject.EmployeeId,
            Email = NormalizeEmail(subject.Email),
            FullName = BuildFullName(subject.FirstName, subject.LastName),
            Role = PlatformRole.Employee,
            AccessProfiles = [],
            ProvisioningState = StateConflict,
            Conflict = new WorkforceAccountConflictDto
            {
                Kind = kind,
                Message = message,
                Blocking = true,
                SuggestedAction = suggestedAction
            }
        };

    private static WorkforceAccountBulkProvisionResultDto BuildBulkResult(
        Guid employeeId,
        string outcome,
        string message,
        WorkforceAccountStatusDto account)
        => new()
        {
            EmployeeId = employeeId,
            Outcome = outcome,
            Message = message,
            Account = account
        };

    private string BuildInviteLink(string rawCredential)
        => InvitationLinkBuilder.Build(configuration, rawCredential);

    // Resend/refresh of an existing invitation: rotate the credential (invalidating the old
    // link), then deliver the new one. The raw secret lives only for this call.
    private async Task DeliverInviteAsync(
        InviteToken invite,
        CancellationToken cancellationToken)
    {
        var tenantName = await dbContext.Tenants
            .IgnoreQueryFilters()
            .Where(tenant => tenant.Id == invite.TenantId)
            .Select(tenant => tenant.Name)
            .FirstOrDefaultAsync(cancellationToken)
            ?? "your organization";

        var credential = IssueRotatedCredential(invite);
        await DeliverInviteAsync(invite, tenantName, credential.RawValue, cancellationToken);
    }

    private async Task DeliverInviteAsync(
        InviteToken invite,
        string tenantName,
        string rawCredential,
        CancellationToken cancellationToken)
    {
        var accessProfiles = await accessProfileService.GetInviteAccessProfilesAsync(invite.Id, cancellationToken);
        var branding = await CompanyBrandReader.ForInvitationAsync(dbContext, invite.TenantId, cancellationToken);
        var delivery = await workforceInvitationEmailSender.SendInviteAsync(
            new WorkforceInvitationEmailMessage(
                invite.Id,
                invite.TenantId,
                tenantName,
                invite.EmployeeId,
                invite.Email,
                BuildFullName(invite.FirstName, invite.LastName),
                BuildInviteLink(rawCredential),
                invite.ExpiresAt,
                accessProfiles.Select(profile => profile.Name).ToList(),
                branding),
            cancellationToken);

        invite.RecordDelivery(delivery.Status, delivery.Message, delivery.RecordedAt);
    }

    // The tenant is whatever the trusted CoreHR caller resolved and signed for; there is
    // no JWT on this internal channel, so a browser cannot substitute a different tenant.
    private bool TryGetTenantId(out Guid tenantId, out string error)
    {
        var headerValue = Request.Headers[TenantHeader].FirstOrDefault();
        if (!Guid.TryParse(headerValue, out var resolvedTenantId) || resolvedTenantId == Guid.Empty)
        {
            tenantId = Guid.Empty;
            error = "A resolved tenant is required.";
            return false;
        }

        tenantId = resolvedTenantId;
        error = string.Empty;
        return true;
    }

    // The acting user is carried for audit attribution only. It is meaningful because the
    // request passed HMAC authorization; it never confers authority on its own. An absent
    // or unparseable value records the change against no specific user rather than failing.
    private Guid? GetActingUserId()
        => Guid.TryParse(Request.Headers[ActingUserHeader].FirstOrDefault(), out var actingUserId)
            && actingUserId != Guid.Empty
            ? actingUserId
            : null;

    /// <summary>
    /// Resolves a reviewed workforce baseline ("Employee"/"Manager") to the seeded
    /// access profile for the tenant, using the same canonical InternalKey mapping as
    /// <see cref="EY.HRPlatform.Identity.Features.WorkforceAccess.WorkforceBaselineService"/>.
    /// Returns null for an unrecognised baseline so the caller fails closed.
    /// </summary>
    private async Task<Guid?> ResolveBaselineProfileIdAsync(
        Guid tenantId, string? baseline, CancellationToken cancellationToken)
    {
        var internalKey = string.Equals(baseline, "Manager", StringComparison.OrdinalIgnoreCase)
            ? AccessProfileTemplates.Manager.InternalKey
            : string.Equals(baseline, "Employee", StringComparison.OrdinalIgnoreCase)
                ? AccessProfileTemplates.Employee.InternalKey
                : null;

        if (internalKey is null)
            return null;

        return await dbContext.AccessProfiles
            .IgnoreQueryFilters()
            .Where(profile => profile.TenantId == tenantId && profile.InternalKey == internalKey)
            .Select(profile => (Guid?)profile.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static string? ValidateSubjects<TSubject>(IEnumerable<TSubject>? subjects)
        where TSubject : WorkforceAccountSubjectDto
    {
        if (subjects is null)
            return "At least one workforce account subject is required.";

        foreach (var subject in subjects)
        {
            var error = ValidateSubject(subject);
            if (error is not null)
                return error;
        }

        return null;
    }

    private static string? ValidateSubject(WorkforceAccountSubjectDto subject)
    {
        if (subject.EmployeeId == Guid.Empty)
            return "Employee ID is required.";

        if (string.IsNullOrWhiteSpace(subject.Email))
            return "Email is required.";

        return null;
    }

    private static IEnumerable<TSubject> DistinctSubjects<TSubject>(IEnumerable<TSubject> subjects)
        where TSubject : WorkforceAccountSubjectDto
        => subjects
            .GroupBy(subject => subject.EmployeeId)
            .Select(group => group.Last());

    private static string NormalizeEmail(string email)
        => email.Trim().ToLowerInvariant();

    private async Task<List<Guid>> ResolveInviteProfileIdsAsync(InviteToken invite, CancellationToken cancellationToken)
        => await dbContext.InviteAccessProfiles
            .IgnoreQueryFilters()
            .Where(assignment => assignment.InviteTokenId == invite.Id)
            .Select(assignment => assignment.AccessProfileId)
            .ToListAsync(cancellationToken);

    private async Task<string> ResolveCompatibilityRoleAsync(
        Guid tenantId,
        IReadOnlyCollection<Guid> accessProfileIds,
        CancellationToken cancellationToken)
    {
        var profiles = new List<AccessProfileSummaryDto>();
        foreach (var accessProfileId in accessProfileIds)
        {
            var profile = await accessProfileService.GetProfileAsync(tenantId, accessProfileId, cancellationToken)
                ?? throw new InvalidOperationException("Access profile not found.");
            profiles.Add(profile);
        }

        return accessProfileService.ResolveCompatibilityRole(
            profiles
                .SelectMany(profile => profile.Grants)
                .Select(grant => new EffectivePermissionGrant(grant.PermissionKey, grant.Scope))
                .ToList());
    }

    private static string? BuildFullName(string? firstName, string? lastName)
    {
        var fullName = $"{firstName} {lastName}".Trim();
        return string.IsNullOrWhiteSpace(fullName) ? null : fullName;
    }

    private sealed record ActiveUserSnapshot(
        Guid MembershipId,
        Guid UserId,
        Guid? EmployeeId,
        string Email,
        string? NormalizedEmail,
        string FullName,
        bool IsActive,
        DateTime? LastLoginAt);

    private sealed record UserProfileRow(
        Guid UserId,
        Guid ProfileId,
        string Name,
        string Type,
        bool IsSystemProtected);

    private sealed record ProfileGrantRow(Guid ProfileId, string PermissionKey, string Scope);

    private sealed record InviteProfileRow(
        Guid InviteId,
        Guid ProfileId,
        string Name,
        string Type,
        bool IsSystemProtected);

    private sealed record BulkBaselineProfile(
        Guid Id,
        string InternalKey,
        string Name,
        string Type,
        bool IsSystemProtected);

    private sealed record BulkInvitationCreation(
        int Index,
        WorkforceAccountProvisionItemDto Item,
        BulkBaselineProfile Profile);

    private sealed record PreparedBulkInvitation(
        BulkInvitationCreation Creation,
        InviteToken Invite,
        string RawCredential);
}
