using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>
/// Changes and approvals (B-179): a request writes nothing until approved, approval applies it on its date, and the
/// server keeps who may propose, approve, decline and withdraw, whatever the UI offers.
/// </summary>
public sealed partial class TemporalWorkforceMaintenanceRelationalTests
{
    private static ChangeActor AminaProposes(Fixture ctx) => new("u-amina", ctx.AminaId, "Amina Mansour", false, true, false);
    private static ChangeActor YoussefProposes(Fixture ctx) => new("u-youssef", ctx.YoussefId, "Youssef Ben Ali", false, true, false);
    private static readonly ChangeActor Hr = new("u-hr", null, "Hana Rekik", true, false, true);

    [RelationalDatabaseFact]
    public Task A_promotion_proposed_by_the_manager_waits_writes_nothing_and_applies_on_its_date_once_hr_approves()
        => WithDatabaseAsync(async (db, ctx, other) =>
        {
            var approvers = new Approvers(new PermissionHolder(Guid.NewGuid(), ctx.YoussefId, "Youssef Ben Ali", "y@example.test"));
            var requests = Requests(db, ctx, approvers);
            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Job], "test", null, default);
            var before = await RowsAsync(db, ctx.KarimId);
            var date = Today.AddDays(30);
            var promotion = db.ChangeReasons(ctx.Tenant.TenantId, "Promotion");

            var proposed = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                new JobChangeRequest(date, JobId: SavedJob(db, ctx, "Senior Consultant"), ReasonId: promotion, Note: "Leads the bot team."),
                Description: "Promote Karim to Senior Consultant"), AminaProposes(ctx), default);
            Assert.True(proposed.IsSuccess, proposed.IsFailure ? proposed.Error.Message : null);
            Assert.Null(proposed.Value.Change);
            var request = proposed.Value.Request!;
            Assert.Equal((WorkforceChangeRequestStatus.Pending, "Promotion", "Senior Consultant"), (request.Status, request.Reason, request.Change!.TitleTo));
            Assert.Equal([ChangeApprovalTypes.Job], request.Types);
            Assert.False(request.CanDecide);
            Assert.True(request.CanWithdraw);

            // Nothing is written to Karim until it's approved; the approver hears it's waiting.
            db.ChangeTracker.Clear();
            Assert.Equal(before, await RowsAsync(db, ctx.KarimId));
            Assert.Empty((await ProfileAsync(db, ctx, ctx.KarimKey)).ComingUp);
            Assert.Equal(ctx.YoussefId, (await db.Notifications.SingleAsync(item => item.Kind == CoreNotificationKind.ChangeRequested)).RecipientEmployeeId);

            // Another tenant's approver can't see or answer it; the proposer sees only their own.
            Assert.Equal("Change.NotFound", (await Requests(other.Db, other, approvers).ApproveAsync(request.Id, Hr, default)).Error.Code);
            Assert.Single(await requests.ListAsync(AminaProposes(ctx), true, null, default));
            Assert.Empty(await requests.ListAsync(YoussefProposes(ctx), true, null, default));
            Assert.Single(await requests.ToDecideAsync(Hr, default));

            var approved = await requests.ApproveAsync(request.Id, Hr, default);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            Assert.Equal(WorkforceChangeRequestStatus.Approved, approved.Value.Status);
            var change = await db.WorkforceChanges.AsNoTracking().SingleAsync(item => item.Id == approved.Value.AppliedChangeId);
            Assert.Equal(("u-amina|Amina Mansour", DateOnly.FromDateTime(date)), (change.CreatedBy, change.EffectiveDate));
            Assert.Equal("Promotion", WorkforceChangeService.ReadDetails(change).Reason);

            // Applied on its date: today unchanged, the date shows the new job.
            Assert.Equal("Consultant Senior", (await ProfileAsync(db, ctx, ctx.KarimKey)).Work!.JobTitle);
            Assert.Equal("Senior Consultant", (await ProfileAsync(db, ctx, ctx.KarimKey, date)).Work!.JobTitle);
            Assert.True(await db.Notifications.AnyAsync(item => item.Kind == CoreNotificationKind.ChangeApproved && item.RecipientEmployeeId == ctx.AminaId));
            Assert.Equal(ChangeRequestService.ConflictCode, (await requests.ApproveAsync(request.Id, Hr, default)).Error.Code);
            Assert.Empty(await requests.ToDecideAsync(Hr, default));
        });

    [RelationalDatabaseFact]
    public Task Without_approval_for_its_type_a_proposal_applies_at_once_and_hr_always_applies_at_once()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Leaving], "test", null, default);
            var job = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                new JobChangeRequest(Today.AddDays(10), JobId: SavedJob(db, ctx, "Lead Consultant"))), AminaProposes(ctx), default);
            Assert.True(job.IsSuccess, job.IsFailure ? job.Error.Message : null);
            Assert.NotNull(job.Value.Change);
            Assert.Null(job.Value.Request);

            // A manager's last day for someone waits, whatever the settings say.
            await requests.UpdateSettingsAsync([], "test", null, default);
            var leaving = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                End: new EndEmploymentChangeRequest(Today.AddDays(40))), AminaProposes(ctx), default);
            Assert.True(leaving.IsSuccess, leaving.IsFailure ? leaving.Error.Message : null);
            Assert.Equal([ChangeApprovalTypes.Leaving], leaving.Value.Request!.Types);
            Assert.True((await requests.WithdrawAsync(leaving.Value.Request.Id, AminaProposes(ctx), default)).IsSuccess);

            await requests.UpdateSettingsAsync(ChangeApprovalTypes.All, "test", null, default);
            var hr = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                new JobChangeRequest(Today.AddDays(20), ManagerEmployeeId: ctx.YoussefId)), Hr, default);
            Assert.True(hr.IsSuccess, hr.IsFailure ? hr.Error.Message : null);
            Assert.NotNull(hr.Value.Change);
            Assert.DoesNotContain(await db.WorkforceChangeRequests.ToListAsync(), item => item.Status == WorkforceChangeRequestStatus.Pending);
        });

    [RelationalDatabaseFact]
    public Task Only_the_manager_proposes_never_for_themselves_and_nobody_answers_their_own_request()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Job, ChangeApprovalTypes.Manager], "test", null, default);
            var body = new ProposeChangeRequest(new JobChangeRequest(Today.AddDays(30), JobId: SavedJob(db, ctx, "Senior Consultant")));

            // Not the manager, themselves, or without the right.
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ProposeAsync(ctx.KarimKey, body, YoussefProposes(ctx), default)).Error.Code);
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ProposeAsync(ctx.AminaKey, body, AminaProposes(ctx), default)).Error.Code);
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ProposeAsync(ctx.KarimKey, body,
                AminaProposes(ctx) with { Proposes = false }, default)).Error.Code);
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.SubjectForAsync(ctx.KarimKey, YoussefProposes(ctx), default)).Error.Code);

            var request = (await requests.ProposeAsync(ctx.KarimKey, body, AminaProposes(ctx), default)).Value.Request!;
            Assert.Equal(ChangeRequestService.ConflictCode, (await requests.ProposeAsync(ctx.KarimKey, body, AminaProposes(ctx), default)).Error.Code);

            // Self-approval: the requester holding Approve, or the person the change is about.
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ApproveAsync(request.Id, AminaProposes(ctx) with { Approves = true }, default)).Error.Code);
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ApproveAsync(request.Id,
                new ChangeActor("u-karim", ctx.KarimId, "Karim Zayed", false, false, true), default)).Error.Code);
            // Without Approve, someone else's request doesn't even exist for them.
            Assert.Equal("Change.NotFound", (await requests.ApproveAsync(request.Id, Hr with { Approves = false }, default)).Error.Code);
            Assert.Equal("Change.NotFound", (await requests.DeclineAsync(request.Id, "No", Hr with { Approves = false }, default)).Error.Code);

            // A no needs a reason; only the asker withdraws.
            Assert.Equal("ChangeRequest.ReasonRequired", (await requests.DeclineAsync(request.Id, "  ", Hr, default)).Error.Code);
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.WithdrawAsync(request.Id, Hr, default)).Error.Code);
            Assert.Equal("Change.NotFound", (await requests.WithdrawAsync(request.Id, YoussefProposes(ctx), default)).Error.Code);
            var withdrawn = await requests.WithdrawAsync(request.Id, AminaProposes(ctx), default);
            Assert.Equal(WorkforceChangeRequestStatus.Withdrawn, withdrawn.Value.Status);
            Assert.Equal(ChangeRequestService.ConflictCode, (await requests.DeclineAsync(request.Id, "Too late", Hr, default)).Error.Code);

            var again = (await requests.ProposeAsync(ctx.KarimKey, body, AminaProposes(ctx), default)).Value.Request!;
            var declined = await requests.DeclineAsync(again.Id, "Next cycle, after the review.", Hr, default);
            Assert.Equal((WorkforceChangeRequestStatus.Declined, "Next cycle, after the review."), (declined.Value.Status, declined.Value.DeclineReason));
            Assert.True(await db.Notifications.AnyAsync(item => item.Kind == CoreNotificationKind.ChangeDeclined && item.RecipientEmployeeId == ctx.AminaId));
            Assert.Null(declined.Value.AppliedChangeId);
        });

    [RelationalDatabaseFact]
    public Task A_stale_draft_is_refused_when_the_person_changed_since_it_was_asked()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Job], "test", null, default);
            var request = (await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                new JobChangeRequest(Today.AddDays(30), JobId: SavedJob(db, ctx, "Senior Consultant"))), AminaProposes(ctx), default)).Value.Request!;

            // HR moves Karim to Youssef meanwhile: the draft was made against a manager he no longer has on that date.
            await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today.AddDays(5), ManagerEmployeeId: ctx.YoussefId));
            var listed = Assert.Single(await requests.ListAsync(Hr, true, null, default));
            Assert.NotNull(listed.Stale);
            var refused = await requests.ApproveAsync(request.Id, Hr, default);
            Assert.Equal(ChangeRequestService.ConflictCode, refused.Error.Code);
            Assert.Contains("changed since", refused.Error.Message);
            Assert.Equal(WorkforceChangeRequestStatus.Pending, (await db.WorkforceChangeRequests.AsNoTracking().SingleAsync()).Status);
            Assert.True((await requests.DeclineAsync(request.Id, "Karim moved team; ask again.", Hr, default)).IsSuccess);
        });

    [RelationalDatabaseFact]
    public Task A_persons_own_new_address_waits_for_hr_and_applies_when_approved()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            await requests.UpdateSettingsAsync([ChangeApprovalTypes.HomeAddress], "test", null, default);
            var self = new PeopleViewer(ctx.KarimId, false, false, false, true);
            var current = await new PeoplePersonalQueryHandler(db).Handle(new PeoplePersonalQuery(ctx.KarimKey, self), default);
            var saved = await new UpdatePeoplePersonalCommandHandler(db, ctx.Tenant, null, requests).Handle(new UpdatePeoplePersonalCommand(
                ctx.KarimKey, self, current.Value.Version,
                new UpdatePersonalRequest(null, "+216 20 000 000", null, new PeopleHomeAddressDto("12 Rue Ibn Khaldoun", "Ariana", "2080", "Tunisia"), null, []),
                $"{KarimUser:D}|Karim Zayed"), default);
            Assert.True(saved.IsSuccess, saved.IsFailure ? saved.Error.Message : null);
            Assert.Equal("+216 20 000 000", saved.Value.Mobile);
            Assert.Null(saved.Value.HomeAddress!.Street);
            Assert.Equal("12 Rue Ibn Khaldoun", saved.Value.PendingHomeAddress!.Address.Street);

            var karim = new ChangeActor(KarimUser.ToString(), ctx.KarimId, "Karim Zayed", false, false, false);
            var request = Assert.Single(await requests.ListAsync(karim, true, null, default));
            Assert.True(request.CanWithdraw);
            var approved = await requests.ApproveAsync(request.Id, Hr, default);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            db.ChangeTracker.Clear();
            var after = await new PeoplePersonalQueryHandler(db).Handle(new PeoplePersonalQuery(ctx.KarimKey, self), default);
            Assert.Equal("12 Rue Ibn Khaldoun", after.Value.HomeAddress!.Street);
            Assert.Null(after.Value.PendingHomeAddress);
        });

    private static readonly Guid KarimUser = Guid.NewGuid();

    /// <summary>A job saved before proposing: the dry run rolls back and clears whatever was only added.</summary>
    private static Guid SavedJob(CoreHRDbContext db, Fixture ctx, string title)
    {
        var id = db.JobId(ctx.Tenant.TenantId, title);
        db.SaveChanges();
        return id;
    }

    private static ChangeRequestService Requests(CoreHRDbContext db, Fixture ctx, IChangeApproverDirectory? approvers = null)
        => new(db, ctx.Tenant, Service(db, ctx), new WorkforceChangeReader(db), approvers ?? new Approvers());

    private sealed class Approvers(params PermissionHolder[] holders) : IChangeApproverDirectory
    {
        public Task<IReadOnlyList<PermissionHolder>> GetApproversAsync(CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<PermissionHolder>>(holders);
    }
}
