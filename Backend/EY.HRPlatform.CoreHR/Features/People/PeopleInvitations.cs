using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Multitenancy;
using MediatR;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

public sealed record ScheduledInvitationDto(Guid Id, InvitationAudience Audience, DateTime SendAt, int People, string? ScheduledBy);

/// <summary>
/// What the invite sheet offers (D-11): how many people each choice reaches today, who waits for their first day,
/// and what is already planned.
/// </summary>
public sealed record InvitationPlanDto(
    int NotSignedIn,
    int Managers,
    /// <summary>Not signed in and without a work email: no invitation can reach them.</summary>
    int NoEmail,
    /// <summary>Joiners whose invitation waits for their first day (only while the company has that on).</summary>
    int JoinersOnFirstDay,
    IReadOnlyList<ScheduledInvitationDto> Scheduled);

public sealed record SendInvitationsRequest(InvitationAudience Audience, IReadOnlyList<Guid>? EmployeeIds, DateTime? SendAt);

public sealed record SendInvitationsResultDto(
    /// <summary>Set when the invitations were planned rather than sent.</summary>
    ScheduledInvitationDto? Scheduled,
    int Invited,
    int Linked,
    int AlreadyActive,
    int NotSent);

/// <summary>
/// Invitations as a plan: now, at a moment, on a joiner's first day, and one reminder. Audiences resolve in the
/// company's own scope and always to people who don't sign in yet; the person asking was authorized at the endpoint.
/// </summary>
public sealed class PeopleInvitations(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    ISender sender,
    IWorkforceContractService workforce,
    WorkforceInvitationSender invitationSender,
    IWorkforceAccountStatusReader accountStatuses,
    IWorkforceAccessIdentityClient accessClient,
    ITenantSettingsReadService settings,
    TimeProvider? clock = null)
{
    private DateTime Now => (clock ?? TimeProvider.System).GetUtcNow().UtcDateTime;

    public async Task<InvitationPlanDto> PlanAsync(CancellationToken cancellationToken)
    {
        var audience = await AudienceAsync(cancellationToken);
        var scheduled = await dbContext.InvitationSchedules.AsNoTracking()
            .Where(item => item.SentAt == null && item.CanceledAt == null)
            .OrderBy(item => item.SendAt)
            .ToListAsync(cancellationToken);
        return new InvitationPlanDto(
            audience.Sendable.Count,
            audience.Sendable.Count(item => item.DirectReportCount > 0),
            audience.NoEmail,
            audience.JoinersOnFirstDay,
            scheduled.Select(item => ToDto(item, audience)).ToList());
    }

    public async Task<SendInvitationsResultDto> SendAsync(
        SendInvitationsRequest request, IReadOnlyList<WorkforceEmployeeSummaryDto>? chosen, string? actor, CancellationToken cancellationToken)
    {
        if (request.SendAt is { } sendAt)
        {
            var schedule = InvitationSchedule.Plan(
                tenantContext.TenantId, request.Audience, chosen?.Select(item => item.EmployeeId).ToList() ?? [], sendAt, Now, actor);
            dbContext.InvitationSchedules.Add(schedule);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new SendInvitationsResultDto(ToDto(schedule, await AudienceAsync(cancellationToken)), 0, 0, 0, 0);
        }

        var people = request.Audience == InvitationAudience.Chosen
            ? chosen ?? []
            : await ResolveAudienceAsync(request.Audience, [], cancellationToken);
        if (request.Audience == InvitationAudience.Chosen && people.Count == 0)
            throw new ArgumentException("Choose at least one person.");
        var sent = await invitationSender.SendAsync(people, null, cancellationToken);
        return new SendInvitationsResultDto(null, sent.Invited, sent.Linked + sent.Reactivated, sent.AlreadyActive, sent.Blocked + sent.Failed);
    }

    public async Task<bool> CancelAsync(Guid scheduleId, string? actor, CancellationToken cancellationToken)
    {
        var schedule = await dbContext.InvitationSchedules.SingleOrDefaultAsync(item => item.Id == scheduleId, cancellationToken);
        if (schedule is null || !schedule.IsPending) return false;
        schedule.Cancel(Now, actor);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>Sends this tenant's plans that are due. Each is marked sent first, so a crash never sends twice.</summary>
    public async Task<int> SendDueAsync(CancellationToken cancellationToken)
    {
        var now = Now;
        var due = await dbContext.InvitationSchedules
            .Where(item => item.SentAt == null && item.CanceledAt == null && item.SendAt <= now)
            .OrderBy(item => item.SendAt)
            .ToListAsync(cancellationToken);
        foreach (var schedule in due)
        {
            schedule.MarkSending(now);
            await dbContext.SaveChangesAsync(cancellationToken);
            var people = await ResolveAudienceAsync(schedule.Audience, schedule.EmployeeIds, cancellationToken);
            var sent = await invitationSender.SendAsync(people, null, cancellationToken);
            schedule.Record(sent.Invited + sent.Linked + sent.Reactivated, sent.Blocked + sent.Failed);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        return due.Count;
    }

    /// <summary>Joiners' first-day invitations and the one reminder per invitation, as the company has them set.</summary>
    public async Task RunAutomaticAsync(CancellationToken cancellationToken)
    {
        var provisioning = (await settings.GetCurrentAsync(cancellationToken)).Provisioning;
        if (provisioning.InviteJoinersOnFirstDay) await InviteJoinersAsync(cancellationToken);
        if (provisioning.RemindAfterDays > 0) await RemindAsync(provisioning.RemindAfterDays, cancellationToken);
    }

    private async Task InviteJoinersAsync(CancellationToken cancellationToken)
    {
        var now = Now;
        var today = now.Date;
        // Two days back, so a day the service was down still reaches its joiners.
        var from = today.AddDays(-2);
        var employments = await dbContext.Employments.AsNoTracking()
            .Where(item => item.EffectiveFrom >= from && item.EffectiveFrom <= today && (item.EffectiveTo == null || item.EffectiveTo > today))
            .Select(item => new { item.Id, item.EmployeeId })
            .ToListAsync(cancellationToken);
        if (employments.Count == 0) return;
        var employmentIds = employments.Select(item => item.Id).ToList();
        var done = await dbContext.InvitationAutoSends.AsNoTracking()
            .Where(item => item.Kind == InvitationAutoSendKind.FirstDay && employmentIds.Contains(item.Reference))
            .Select(item => item.Reference)
            .ToListAsync(cancellationToken);
        var waiting = employments.Where(item => !done.Contains(item.Id)).ToList();
        if (waiting.Count == 0) return;

        var people = await workforce.ResolveEmployeesForCompanyAsync(waiting.Select(item => item.EmployeeId).Distinct().ToList(), cancellationToken);
        var statuses = await StatusesAsync(people, cancellationToken);
        // Only people never invited: someone HR withdrew or who already signs in is left alone.
        var fresh = people.Where(person => !string.IsNullOrWhiteSpace(person.WorkEmail)
            && statuses.GetValueOrDefault(person.EmployeeId)?.ProvisioningState is null or "Unprovisioned").ToList();
        var sent = fresh.Count == 0 ? null : await invitationSender.SendAsync(fresh, null, cancellationToken);
        var reached = sent?.Items.Where(item => item.Outcome is "Invited" or "Linked" or "Reactivated" or "AlreadyActive" or "AlreadyPending")
            .Select(item => item.EmployeeId).ToHashSet() ?? [];
        foreach (var employment in waiting)
        {
            var person = people.FirstOrDefault(item => item.EmployeeId == employment.EmployeeId);
            // People who didn't need one are recorded too, so they aren't looked at again.
            if (person is null || reached.Contains(person.EmployeeId) || !fresh.Contains(person))
                dbContext.InvitationAutoSends.Add(InvitationAutoSend.Record(
                    tenantContext.TenantId, employment.EmployeeId, InvitationAutoSendKind.FirstDay, employment.Id, now));
        }
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task RemindAsync(int afterDays, CancellationToken cancellationToken)
    {
        var now = Now;
        var listed = await sender.Send(new PeopleQuery(View: PeopleView.Everyone, Unpaged: true), cancellationToken);
        var keys = listed.Value.Items.Where(row => row.WorkEmail is not null).Select(row => row.EmployeeKey).ToList();
        var employees = await dbContext.Employees.AsNoTracking()
            .Where(item => keys.Contains(item.StableEmployeeKey) && item.Email != null)
            .Select(item => new WorkforceAccountSubjectDto(item.Id, item.Email!, item.FirstName, item.LastName))
            .ToListAsync(cancellationToken);
        if (employees.Count == 0) return;
        var statuses = await accountStatuses.GetStatusesAsync(employees, cancellationToken);
        var dueBefore = now.AddDays(-afterDays);
        var pending = statuses.Values
            .Where(item => item.ProvisioningState == "InvitePending" && item.InviteId is not null && item.InviteCreatedAt <= dueBefore)
            .ToList();
        if (pending.Count == 0) return;
        var inviteIds = pending.Select(item => item.InviteId!.Value).ToList();
        var reminded = await dbContext.InvitationAutoSends.AsNoTracking()
            .Where(item => item.Kind == InvitationAutoSendKind.Reminder && inviteIds.Contains(item.Reference))
            .Select(item => item.Reference)
            .ToListAsync(cancellationToken);
        foreach (var invite in pending.Where(item => !reminded.Contains(item.InviteId!.Value)))
        {
            if (!await accessClient.ResendInviteAsync(invite.EmployeeId, cancellationToken)) continue;
            dbContext.InvitationAutoSends.Add(InvitationAutoSend.Record(
                tenantContext.TenantId, invite.EmployeeId, InvitationAutoSendKind.Reminder, invite.InviteId!.Value, now));
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed record Audience(List<WorkforceEmployeeSummaryDto> Sendable, int NoEmail, int JoinersOnFirstDay);

    /// <summary>Today's and future people who don't sign in; joiners wait for their first day when the company says so.</summary>
    private async Task<Audience> AudienceAsync(CancellationToken cancellationToken)
    {
        var firstDay = (await settings.GetCurrentAsync(cancellationToken)).Provisioning.InviteJoinersOnFirstDay;
        var listed = await sender.Send(new PeopleQuery(View: PeopleView.NotSignedIn, Unpaged: true, IncludeSignIn: true), cancellationToken);
        var rows = listed.Value.Items;
        var joiners = firstDay ? rows.Count(row => row.EmploymentState == PeopleEmploymentState.Scheduled) : 0;
        var open = rows.Where(row => !(firstDay && row.EmploymentState == PeopleEmploymentState.Scheduled)).ToList();
        var noEmail = open.Count(row => row.SignIn?.State == PeopleSignInState.NoEmail);
        var keys = open.Where(row => row.SignIn?.State != PeopleSignInState.NoEmail).Select(row => row.EmployeeKey).ToList();
        var ids = await dbContext.Employees.AsNoTracking()
            .Where(item => keys.Contains(item.StableEmployeeKey))
            .Select(item => item.Id)
            .ToListAsync(cancellationToken);
        var people = await workforce.ResolveEmployeesForCompanyAsync(ids, cancellationToken);
        return new Audience(people.ToList(), noEmail, joiners);
    }

    private async Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> ResolveAudienceAsync(
        InvitationAudience audience, IReadOnlyList<Guid> chosen, CancellationToken cancellationToken)
    {
        if (audience == InvitationAudience.Chosen)
            return await workforce.ResolveEmployeesForCompanyAsync(chosen, cancellationToken);
        var sendable = (await AudienceAsync(cancellationToken)).Sendable;
        return audience == InvitationAudience.Managers ? sendable.Where(item => item.DirectReportCount > 0).ToList() : sendable;
    }

    private async Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> StatusesAsync(
        IReadOnlyList<WorkforceEmployeeSummaryDto> people, CancellationToken cancellationToken)
        => await accountStatuses.GetStatusesAsync(
            people.Where(item => !string.IsNullOrWhiteSpace(item.WorkEmail))
                .Select(item => new WorkforceAccountSubjectDto(item.EmployeeId, item.WorkEmail!, item.FirstName, item.LastName))
                .ToList(),
            cancellationToken);

    private static ScheduledInvitationDto ToDto(InvitationSchedule schedule, Audience audience)
        => new(schedule.Id, schedule.Audience, schedule.SendAt, schedule.Audience switch
        {
            InvitationAudience.Chosen => schedule.EmployeeIds.Count,
            InvitationAudience.Managers => audience.Sendable.Count(item => item.DirectReportCount > 0),
            _ => audience.Sendable.Count,
        }, schedule.CreatedBy);
}

/// <summary>Each minute: due planned invitations. Each hour: joiners' first-day invitations and reminders.</summary>
public sealed class PeopleInvitationsWorker(IServiceScopeFactory scopes, ILogger<PeopleInvitationsWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var lastAutomatic = DateTime.MinValue;
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try
            {
                var automatic = DateTime.UtcNow - lastAutomatic >= TimeSpan.FromHours(1);
                await RunAsync(automatic, stoppingToken);
                if (automatic) lastAutomatic = DateTime.UtcNow;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Sending planned invitations failed.");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunAsync(bool automatic, CancellationToken stoppingToken)
    {
        List<Guid> tenants;
        await using (var discovery = scopes.CreateAsyncScope())
        {
            var db = discovery.ServiceProvider.GetRequiredService<CoreHRDbContext>();
            if (!db.Database.IsRelational()) return;
            var now = DateTime.UtcNow;
            // Discovery reads tenant identifiers only; every read and write after it is tenant-filtered.
            tenants = automatic
                ? await db.Employees.IgnoreQueryFilters().Select(item => item.TenantId).Distinct().ToListAsync(stoppingToken)
                : await db.InvitationSchedules.IgnoreQueryFilters()
                    .Where(item => item.SentAt == null && item.CanceledAt == null && item.SendAt <= now)
                    .Select(item => item.TenantId).Distinct().ToListAsync(stoppingToken);
        }
        foreach (var tenantId in tenants)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(tenantId);
                var invitations = scope.ServiceProvider.GetRequiredService<PeopleInvitations>();
                var sent = await invitations.SendDueAsync(stoppingToken);
                if (sent > 0) logger.LogInformation("Sent {Count} planned invitation batches for tenant {TenantId}.", sent, tenantId);
                if (automatic) await invitations.RunAutomaticAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Invitations failed for tenant {TenantId}.", tenantId);
            }
        }
    }
}
