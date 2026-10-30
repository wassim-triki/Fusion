using EY.HRPlatform.CoreHR.Tests.TestSupport;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Features.OrgChart;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Results;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>
/// Relational proofs for people changes against real PostgreSQL: a change is one record over the effective-dated
/// rows it wrote (job change, end of employment, join), with its ripple on the team; cancel and edit restore rows
/// exactly; a person's changes apply in order; and the rules the server keeps whatever the UI offers.
/// </summary>
public sealed partial class TemporalWorkforceMaintenanceRelationalTests
{
    private const string Actor = "test|Workforce Administrator";
    private static readonly DateTime Today = DateTime.UtcNow.Date;
    private static readonly DateTime Since = new(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [RelationalDatabaseFact]
    public Task A_job_change_moves_unit_title_and_manager_on_one_date_and_cancel_restores_every_row()
        => WithDatabaseAsync(async (db, ctx, other) =>
        {
            var future = Today.AddDays(30);
            var before = await RowsAsync(db, ctx.KarimId);

            var change = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(
                future, ManagerEmployeeId: ctx.YoussefId, OrgUnitId: ctx.CustomerSuccessId, JobId: db.JobId(ctx.Tenant.TenantId, "Senior Consultant")));
            Assert.Equal(WorkforceChangeKind.JobChange, change.Kind);
            Assert.Equal(WorkforceChangeStatus.Scheduled, change.Status);
            Assert.True(change.CanCancel && change.CanEdit);
            Assert.Equal(("Amina Mansour", "Youssef Ben Ali"), (change.Details.ManagerFrom!.DisplayName, change.Details.ManagerTo!.DisplayName));
            Assert.Equal(("AI Automation", "Customer Success"), (change.Details.UnitFrom, change.Details.UnitTo));
            Assert.Equal(("Consultant Senior", "Senior Consultant"), (change.Details.TitleFrom, change.Details.TitleTo));
            Assert.False(change.Details.LocationChanged);

            // Today is unchanged and shows the change as coming; the date resolves all of it.
            var today = await ProfileAsync(db, ctx, ctx.KarimKey);
            Assert.Equal(("Consultant Senior", ctx.AminaKey), (today.Work!.JobTitle, today.PrimaryManager!.EmployeeKey));
            Assert.Equal([change.Id], today.ComingUp.Select(item => item.Id));
            var onDate = await ProfileAsync(db, ctx, ctx.KarimKey, future);
            Assert.Equal(("Senior Consultant", "Customer Success", ctx.YoussefKey),
                (onDate.Work!.JobTitle, onDate.Work.OrganizationName, onDate.PrimaryManager!.EmployeeKey));

            // Another tenant can't see or cancel it.
            Assert.Equal("Change.NotFound", (await CancelAsync(other.Db, other, change.Id)).Error.Code);

            Assert.True((await CancelAsync(db, ctx, change.Id)).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.Equal(before, await RowsAsync(db, ctx.KarimId));
            Assert.Empty((await ProfileAsync(db, ctx, ctx.KarimKey)).ComingUp);
            Assert.True((await db.WorkforceChanges.SingleAsync(item => item.Id == change.Id)).IsCancelled);
            Assert.Equal("Change.AlreadyCancelled", (await CancelAsync(db, ctx, change.Id)).Error.Code);
        });

    [RelationalDatabaseFact]
    public Task A_manager_reads_coming_changes_and_employment_dates_only_in_their_own_branch()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var future = Today.AddDays(30);
            var change = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(future, JobId: db.JobId(ctx.Tenant.TenantId, "Senior Consultant")));
            async Task<PeopleProfileDto> AsManager(Guid managerId, DateTime? asOf = null)
                => (await new PeopleProfileQueryHandler(db, ctx.Organization, new WorkforceChangeReader(db))
                    .Handle(new PeopleProfileQuery(ctx.KarimKey, asOf, EmployeeReadAudience.Manager, managerId), default)).Value;

            // Amina manages Karim: she sees what is coming, his dates and the chart on a later date.
            var own = await AsManager(ctx.AminaId, future);
            Assert.True(own.IsAsOf);
            Assert.Equal([change.Id], (await AsManager(ctx.AminaId)).ComingUp.Select(item => item.Id));
            Assert.NotNull((await AsManager(ctx.AminaId)).Employment.Start);

            // Youssef manages others, and a manager without an employee record has no branch: both read Karim
            // as a colleague.
            foreach (var outsider in new[] { ctx.YoussefId, Guid.Empty })
            {
                var colleague = await AsManager(outsider, future);
                Assert.Empty(colleague.ComingUp);
                Assert.False(colleague.IsAsOf);
                Assert.Null(colleague.Employment.Start);
                Assert.Null(colleague.Employment.EmploymentType);
            }
        });

    [RelationalDatabaseFact]
    public Task A_change_for_today_applies_now_and_can_be_undone_the_same_day()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var before = await RowsAsync(db, ctx.KarimId);
            var change = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today, JobId: db.JobId(ctx.Tenant.TenantId, "Lead Consultant"), RemovePlace: true));
            Assert.Equal(WorkforceChangeStatus.InEffect, change.Status);
            Assert.True(change.CanCancel);
            var now = await ProfileAsync(db, ctx, ctx.KarimKey);
            Assert.Equal(("Lead Consultant", (string?)null), (now.Work!.JobTitle, now.Work.Location));
            // The People list still finds his manager: the line belongs to Karim, not to the assignment he left.
            var listed = await new PeopleQueryHandler(db, ctx.Tenant).Handle(new PeopleQuery(Q: "karim"), default);
            Assert.Equal(ctx.AminaKey, Assert.Single(listed.Value.Items).PrimaryManager?.EmployeeKey);

            Assert.True((await CancelAsync(db, ctx, change.Id)).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.Equal(before, await RowsAsync(db, ctx.KarimId));
            Assert.Equal("Consultant Senior", (await ProfileAsync(db, ctx, ctx.KarimKey)).Work!.JobTitle);
        });

    [RelationalDatabaseFact]
    public Task The_server_refuses_empty_past_cyclic_and_out_of_order_changes()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            Assert.Equal("Change.NothingChanges", (await TryJobAsync(db, ctx, ctx.KarimKey,
                new JobChangeRequest(Today.AddDays(5), ManagerEmployeeId: ctx.AminaId, JobId: db.JobId(ctx.Tenant.TenantId, "Consultant Senior")))).Error.Code);
            Assert.Equal("Change.PastDate", (await TryJobAsync(db, ctx, ctx.KarimKey,
                new JobChangeRequest(Today.AddDays(-1), JobId: db.JobId(ctx.Tenant.TenantId, "Backdated")))).Error.Code);
            Assert.Equal("Manager.Cycle", (await TryJobAsync(db, ctx, ctx.AminaKey,
                new JobChangeRequest(Today.AddDays(5), ManagerEmployeeId: ctx.KarimId))).Error.Code);

            // A person's changes apply in order: nothing before the last scheduled one (no overlapping lines).
            var first = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today.AddDays(30), ManagerEmployeeId: ctx.YoussefId));
            Assert.Equal("Change.BeforeScheduled", (await TryJobAsync(db, ctx, ctx.KarimKey,
                new JobChangeRequest(Today.AddDays(10), JobId: db.JobId(ctx.Tenant.TenantId, "Earlier")))).Error.Code);
            var second = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today.AddDays(40), JobId: db.JobId(ctx.Tenant.TenantId, "Later")));
            Assert.Equal(1, await db.ManagerRelationships.CountAsync(item => item.SubjectEmployeeId == ctx.KarimId
                && item.Type == ReportingRelationshipType.PrimaryManager && item.EffectiveTo == null));

            // Only the latest can be cancelled.
            Assert.Equal("Change.NotLatestConflict", (await CancelAsync(db, ctx, first.Id)).Error.Code);
            Assert.True((await CancelAsync(db, ctx, second.Id)).IsSuccess);
            Assert.True((await CancelAsync(db, ctx, first.Id)).IsSuccess);

            // A reporting admin changes the line, never the job.
            var service = Service(db, ctx);
            var forbidden = await new JobChangeCommandHandler(db, service, new WorkforceChangeReader(db)).Handle(
                new JobChangeCommand(ctx.KarimKey, new JobChangeRequest(Today.AddDays(5), JobId: db.JobId(ctx.Tenant.TenantId, "Nope")), Actor, CanManageEmployees: false), default);
            Assert.Equal(WorkforceChangeService.ForbiddenCode, forbidden.Error.Code);
            var reportingOnly = await new JobChangeCommandHandler(db, service, new WorkforceChangeReader(db)).Handle(
                new JobChangeCommand(ctx.KarimKey, new JobChangeRequest(Today.AddDays(5), ManagerEmployeeId: ctx.YoussefId), Actor, CanManageEmployees: false), default);
            Assert.True(reportingOnly.IsSuccess, reportingOnly.IsFailure ? reportingOnly.Error.Message : null);
            Assert.True((await CancelAsync(db, ctx, reportingOnly.Value.Id, canManageEmployees: false)).IsSuccess);
        });

    [RelationalDatabaseFact]
    public Task Moving_a_manager_takes_the_team_along_or_leaves_it_with_a_named_manager()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var date = Today.AddDays(30);
            var along = await JobAsync(db, ctx, ctx.AminaKey, new JobChangeRequest(date, ManagerEmployeeId: ctx.YoussefId));
            Assert.Equal(("Along", 1), (along.Details.TeamOutcome, along.Details.TeamCount));
            Assert.Equal(ctx.AminaKey, (await ProfileAsync(db, ctx, ctx.KarimKey, date)).PrimaryManager!.EmployeeKey);
            Assert.True((await CancelAsync(db, ctx, along.Id)).IsSuccess);

            // Staying needs someone to report to: Amina has no manager to default to.
            Assert.Equal("Change.TeamManagerRequired", (await TryJobAsync(db, ctx, ctx.AminaKey,
                new JobChangeRequest(date, ManagerEmployeeId: ctx.YoussefId, Team: new TeamOutcomeRequest(Stays: true)))).Error.Code);

            var karimBefore = await RowsAsync(db, ctx.KarimId);
            var stays = await JobAsync(db, ctx, ctx.AminaKey, new JobChangeRequest(
                date, ManagerEmployeeId: ctx.YoussefId, Team: new TeamOutcomeRequest(Stays: true, ctx.YoussefId)));
            Assert.Equal(("Stays", "Youssef Ben Ali"), (stays.Details.TeamOutcome, stays.Details.TeamManager!.DisplayName));
            Assert.Equal(ctx.YoussefKey, (await ProfileAsync(db, ctx, ctx.KarimKey, date)).PrimaryManager!.EmployeeKey);
            Assert.Equal(ctx.AminaKey, (await ProfileAsync(db, ctx, ctx.KarimKey)).PrimaryManager!.EmployeeKey);

            // The ripple is part of the change: Karim can't get a change before it, and cancel puts his line back.
            Assert.Equal("Change.BeforeScheduled", (await TryJobAsync(db, ctx, ctx.KarimKey,
                new JobChangeRequest(date.AddDays(-1), JobId: db.JobId(ctx.Tenant.TenantId, "Earlier")))).Error.Code);
            Assert.True((await CancelAsync(db, ctx, stays.Id)).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.Equal(karimBefore, await RowsAsync(db, ctx.KarimId));
        });

    [RelationalDatabaseFact]
    public Task Ending_employment_sends_each_report_somewhere_even_after_the_manager_changed_job()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            // Amina changes job first, so her current assignment is not the one Karim's line was made against.
            await JobAsync(db, ctx, ctx.AminaKey, new JobChangeRequest(Today.AddDays(5), JobId: db.JobId(ctx.Tenant.TenantId, "Customer Success VP")));
            var lastDay = DateOnly.FromDateTime(Today.AddDays(15));
            var service = Service(db, ctx);

            var preview = (await new EndEmploymentChangePreviewQueryHandler(db, service).Handle(
                new EndEmploymentChangePreviewQuery(ctx.AminaKey, lastDay), default)).Value;
            Assert.Null(preview.DefaultManager);
            Assert.Equal([(ctx.KarimKey, "Reassign")], preview.Reports.Select(item => (item.Person.EmployeeKey, item.Outcome)));

            // No default manager: each report needs one chosen, or "no manager" on purpose.
            Assert.Equal("Change.ReportsNeedManager", (await TryEndAsync(db, ctx, new EndEmploymentChangeRequest(At(lastDay)))).Error.Code);
            Assert.Equal("Change.ReportToLeaver", (await TryEndAsync(db, ctx,
                new EndEmploymentChangeRequest(At(lastDay), [new ReportReassignmentRequest(ctx.KarimId, ctx.AminaId)]))).Error.Code);

            var aminaBefore = await RowsAsync(db, ctx.AminaId);
            var karimBefore = await RowsAsync(db, ctx.KarimId);
            var end = await TryEndAsync(db, ctx,
                new EndEmploymentChangeRequest(At(lastDay), [new ReportReassignmentRequest(ctx.KarimId, ctx.YoussefId)], "Departure"));
            Assert.True(end.IsSuccess, end.IsFailure ? end.Error.Message : null);
            Assert.Equal(lastDay.AddDays(1), end.Value.EffectiveDate);
            Assert.Equal(lastDay, end.Value.Details.LastDay);
            Assert.Equal([("Karim Zayed", "Youssef Ben Ali")], end.Value.Details.Reassigned!.Select(item => (item.Person.DisplayName, item.Manager!.DisplayName)));

            Assert.Equal(PeopleEmploymentState.Active, (await ProfileAsync(db, ctx, ctx.AminaKey, At(lastDay))).Employment.State);
            Assert.NotEqual(PeopleEmploymentState.Active, (await ProfileAsync(db, ctx, ctx.AminaKey, At(lastDay).AddDays(1))).Employment.State);
            Assert.Equal(ctx.AminaKey, (await ProfileAsync(db, ctx, ctx.KarimKey, At(lastDay))).PrimaryManager!.EmployeeKey);
            Assert.Equal(ctx.YoussefKey, (await ProfileAsync(db, ctx, ctx.KarimKey, At(lastDay).AddDays(1))).PrimaryManager!.EmployeeKey);

            Assert.True((await CancelAsync(db, ctx, end.Value.Id)).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.Equal(aminaBefore, await RowsAsync(db, ctx.AminaId));
            Assert.Equal(karimBefore, await RowsAsync(db, ctx.KarimId));

            // "No manager" only by choice.
            var released = await TryEndAsync(db, ctx,
                new EndEmploymentChangeRequest(At(lastDay), [new ReportReassignmentRequest(ctx.KarimId, null)]));
            Assert.True(released.IsSuccess, released.IsFailure ? released.Error.Message : null);
            Assert.Null((await ProfileAsync(db, ctx, ctx.KarimKey, At(lastDay).AddDays(1))).PrimaryManager);
        });

    [RelationalDatabaseFact]
    public Task Hires_and_rehires_are_join_changes_and_a_scheduled_hire_can_be_cancelled()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var hire = await new HireEmployeeCommandHandler(db, ctx.Tenant, new EmployeeNumberAllocatorService(db, ctx.Tenant), ctx.Mutation, ctx.Organization).Handle(
                new HireEmployeeCommand(new HireEmployeeRequest("Skander", "Mejri", null, "skander.mejri@example.test", null, EmployeeNumberMode.Generated, null,
                    Today.AddDays(10), db.EmploymentType(ctx.Tenant.TenantId, "Full-time").Id, ctx.AiId, db.JobId(ctx.Tenant.TenantId, "Product Designer"), null, ctx.AminaId), Actor), default);
            Assert.True(hire.IsSuccess, hire.IsFailure ? hire.Error.Message : null);
            var upcoming = (await new UpcomingWorkforceChangesQueryHandler(db, new WorkforceChangeReader(db)).Handle(
                new UpcomingWorkforceChangesQuery(null), default)).Value;
            var join = Assert.Single(upcoming);
            Assert.Equal((WorkforceChangeKind.Join, true, false, "Amina Mansour"),
                (join.Kind, join.Details.IsHire, join.CanEdit, join.Details.ManagerTo!.DisplayName));

            // Amina's branch sees who joins it; Youssef's doesn't.
            Assert.Single((await new UpcomingWorkforceChangesQueryHandler(db, new WorkforceChangeReader(db)).Handle(
                new UpcomingWorkforceChangesQuery(ctx.AminaId), default)).Value);
            Assert.Empty((await new UpcomingWorkforceChangesQueryHandler(db, new WorkforceChangeReader(db)).Handle(
                new UpcomingWorkforceChangesQuery(ctx.YoussefId), default)).Value);

            // Cancelling deletes him, so not while Identity holds an invitation or account for him, nor while it can't say.
            foreach (var (state, code) in new[] { ("InvitePending", "Change.HireAccessConflict"), ("Active", "Change.HireAccessConflict"), ("down", "Change.AccessUnknown") })
            {
                var refused = await CancelAsync(db, ctx, join.Id, accounts: new Accounts(_ => state));
                Assert.Equal(code, refused.Error.Code);
                db.ChangeTracker.Clear();
                Assert.True(await db.Employees.AnyAsync(item => item.StableEmployeeKey == hire.Value.EmployeeKey));
            }

            Assert.True((await CancelAsync(db, ctx, join.Id, accounts: new Accounts(_ => "InviteRevoked"))).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.False(await db.Employees.AnyAsync(item => item.StableEmployeeKey == hire.Value.EmployeeKey));

            // Youssef leaves today and comes back later: a Join in the panel, keeping his worker id.
            var service = Service(db, ctx);
            var left = await new EndEmploymentChangeCommandHandler(db, service, new WorkforceChangeReader(db)).Handle(
                new EndEmploymentChangeCommand(ctx.YoussefKey, new EndEmploymentChangeRequest(Today), Actor), default);
            Assert.True(left.IsSuccess, left.IsFailure ? left.Error.Message : null);
            var rehire = await new JoinChangeCommandHandler(db, service, new WorkforceChangeReader(db)).Handle(
                new JoinChangeCommand(ctx.YoussefKey, new JoinChangeRequest(Today.AddDays(20), ctx.CustomerSuccessId, db.JobId(ctx.Tenant.TenantId, "Customer Growth Director"), null, ctx.AminaId), Actor), default);
            Assert.True(rehire.IsSuccess, rehire.IsFailure ? rehire.Error.Message : null);
            Assert.Equal(PeopleEmploymentState.Active, (await ProfileAsync(db, ctx, ctx.YoussefKey, Today.AddDays(20))).Employment.State);
            Assert.Equal("Change.BeforeScheduled", (await new JoinChangeCommandHandler(db, service, new WorkforceChangeReader(db)).Handle(
                new JoinChangeCommand(ctx.YoussefKey, new JoinChangeRequest(Today.AddDays(1), ctx.CustomerSuccessId, db.JobId(ctx.Tenant.TenantId, "Again")), Actor), default)).Error.Code);
        });

    [RelationalDatabaseFact]
    public Task Edit_replaces_a_scheduled_change_in_one_step_or_not_at_all()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var original = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today.AddDays(30), ManagerEmployeeId: ctx.YoussefId));
            var handler = new EditWorkforceChangeCommandHandler(db, Service(db, ctx), new WorkforceChangeReader(db));

            var failed = await handler.Handle(new EditWorkforceChangeCommand(
                original.Id, new EditChangeRequest(Job: new JobChangeRequest(Today.AddDays(-3), JobId: db.JobId(ctx.Tenant.TenantId, "Past"))), Actor, true), default);
            Assert.Equal("Change.PastDate", failed.Error.Code);
            db.ChangeTracker.Clear();
            Assert.False((await db.WorkforceChanges.SingleAsync(item => item.Id == original.Id)).IsCancelled);
            Assert.Equal(ctx.YoussefKey, (await ProfileAsync(db, ctx, ctx.KarimKey, Today.AddDays(30))).PrimaryManager!.EmployeeKey);

            Assert.Equal("Change.KindMismatch", (await handler.Handle(new EditWorkforceChangeCommand(
                original.Id, new EditChangeRequest(End: new EndEmploymentChangeRequest(Today.AddDays(40))), Actor, true), default)).Error.Code);

            var edited = await handler.Handle(new EditWorkforceChangeCommand(
                original.Id, new EditChangeRequest(Job: new JobChangeRequest(Today.AddDays(35), JobId: db.JobId(ctx.Tenant.TenantId, "Principal Consultant"))), Actor, true), default);
            Assert.True(edited.IsSuccess, edited.IsFailure ? edited.Error.Message : null);
            db.ChangeTracker.Clear();
            Assert.True((await db.WorkforceChanges.SingleAsync(item => item.Id == original.Id)).IsCancelled);
            Assert.Equal([edited.Value.Id], (await ProfileAsync(db, ctx, ctx.KarimKey)).ComingUp.Select(item => item.Id));
            var onDate = await ProfileAsync(db, ctx, ctx.KarimKey, Today.AddDays(35));
            Assert.Equal(("Principal Consultant", ctx.AminaKey), (onDate.Work!.JobTitle, onDate.PrimaryManager!.EmployeeKey));
        });

    [RelationalDatabaseFact]
    public Task History_and_coming_changes_stay_inside_a_managers_branch()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today.AddDays(30), JobId: db.JobId(ctx.Tenant.TenantId, "Senior Consultant")));
            var reader = new WorkforceChangeReader(db);
            Assert.Single((await new UpcomingWorkforceChangesQueryHandler(db, reader).Handle(new UpcomingWorkforceChangesQuery(ctx.AminaId), default)).Value);
            Assert.Empty((await new UpcomingWorkforceChangesQueryHandler(db, reader).Handle(new UpcomingWorkforceChangesQuery(ctx.YoussefId), default)).Value);

            var timeline = new PeopleTimelineQueryHandler(db, new PeopleTimelineComposer(db));
            Assert.True((await timeline.Handle(new PeopleTimelineQuery(ctx.KarimKey, ctx.AminaId), default)).IsSuccess);
            Assert.True((await timeline.Handle(new PeopleTimelineQuery(ctx.KarimKey, ctx.YoussefId), default)).IsFailure);
            Assert.True((await timeline.Handle(new PeopleTimelineQuery(ctx.AminaKey, ctx.AminaId), default)).IsFailure);
            Assert.True((await timeline.Handle(new PeopleTimelineQuery(ctx.KarimKey), default)).IsSuccess);
        });

    [RelationalDatabaseFact]
    public Task Scheduled_rows_from_before_change_records_are_adopted_and_can_be_cancelled()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            // Written the old way: rows only, no record.
            var later = Today.AddDays(30);
            var karimBefore = await RowsAsync(db, ctx.KarimId);
            Assert.True((await ctx.Mutation.ChangeManagerAsync(ctx.KarimId, new ChangeManagerInput(ctx.YoussefId, later), Actor, default)).IsSuccess);
            Assert.True((await ctx.Mutation.EndEmploymentReleasingReportsAsync(ctx.YoussefId, new EndEmploymentInput(later.AddDays(10)), Actor, default)).IsSuccess);
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();
            Assert.Empty((await ProfileAsync(db, ctx, ctx.KarimKey)).ComingUp);

            var backfill = new WorkforceChangeBackfill(db, ctx.Tenant, ctx.Organization);
            Assert.Equal(2, await backfill.RunForTenantAsync(default));
            db.ChangeTracker.Clear();
            Assert.Equal(0, await backfill.RunForTenantAsync(default));

            var move = Assert.Single((await ProfileAsync(db, ctx, ctx.KarimKey)).ComingUp);
            Assert.Equal((WorkforceChangeKind.JobChange, "Amina Mansour", "Youssef Ben Ali"),
                (move.Kind, move.Details.ManagerFrom!.DisplayName, move.Details.ManagerTo!.DisplayName));
            var end = Assert.Single((await ProfileAsync(db, ctx, ctx.YoussefKey)).ComingUp);
            Assert.Equal((WorkforceChangeKind.EndEmployment, DateOnly.FromDateTime(later.AddDays(10))), (end.Kind, end.Details.LastDay));
            Assert.Equal(["Karim Zayed"], end.Details.Reassigned!.Select(item => item.Person.DisplayName));

            // Cancelled in order, the rows come back as they were.
            Assert.True((await CancelAsync(db, ctx, end.Id)).IsSuccess);
            Assert.True((await CancelAsync(db, ctx, move.Id)).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.Equal(karimBefore, await RowsAsync(db, ctx.KarimId));
            Assert.Equal(PeopleEmploymentState.Active, (await ProfileAsync(db, ctx, ctx.YoussefKey, later.AddDays(20))).Employment.State);
        });

    [RelationalDatabaseFact]
    public Task Dotted_lines_are_effective_dated_beside_the_primary_chain_and_feed_the_org_chart()
        => WithDatabaseAsync(async (db, ctx, other) =>
        {
            var later = Today.AddDays(20);
            Task<Result<MaintenanceResultDto>> Dotted(Guid managerId, DateTime date, bool end = false)
                => new DottedLineCommandHandler(db, ctx.Mutation).Handle(new DottedLineCommand(ctx.KarimKey, date, managerId, end, Actor), default);

            // Karim (managed by Amina) gets a dotted line to Youssef from today.
            var added = await Dotted(ctx.YoussefId, Today);
            Assert.True(added.IsSuccess, added.IsFailure ? added.Error.Message : null);
            var dotted = Assert.Single((await ProfileAsync(db, ctx, ctx.KarimKey)).DottedLineManagers);
            Assert.Equal((ctx.YoussefKey, ctx.YoussefId, Today), (dotted.EmployeeKey, dotted.EmployeeId, dotted.Since));

            // Manager options find a person by their exact key (the org chart's prefill), and only in this tenant.
            var byKey = await new ManagerOptionsQueryHandler(db, ctx.Organization).Handle(new ManagerOptionsQuery(Today, ctx.YoussefKey, null), default);
            Assert.Equal([ctx.YoussefId], byKey.Value.Select(o => o.EmployeeId));
            var otherByKey = await new ManagerOptionsQueryHandler(other.Db, other.Organization).Handle(new ManagerOptionsQuery(Today, ctx.YoussefKey, null), default);
            Assert.Empty(otherByKey.Value);

            // For a person: not themselves, not their own branch, not their current manager.
            var forKarim = await new ManagerOptionsQueryHandler(db, ctx.Organization).Handle(new ManagerOptionsQuery(Today, null, null, 30, ctx.KarimId), default);
            Assert.Equal([ctx.YoussefId], forKarim.Value.Select(o => o.EmployeeId));
            var forAmina = await new ManagerOptionsQueryHandler(db, ctx.Organization).Handle(new ManagerOptionsQuery(Today, null, null, 30, ctx.AminaId), default);
            Assert.Equal([ctx.YoussefId], forAmina.Value.Select(o => o.EmployeeId));

            // Refused: the same dotted line twice, the primary manager, oneself, someone in another tenant.
            Assert.Equal("Manager.DottedLineExists", (await Dotted(ctx.YoussefId, later)).Error.Code);
            Assert.Equal("Manager.DottedLineIsPrimary", (await Dotted(ctx.AminaId, Today)).Error.Code);
            Assert.Equal("Manager.Self", (await Dotted(ctx.KarimId, Today)).Error.Code);
            Assert.Equal("Manager.NoManagerAssignment", (await Dotted(other.YoussefId, Today)).Error.Code);
            Assert.Equal("Manager.DottedLineNotFound", (await Dotted(ctx.AminaId, later, end: true)).Error.Code);

            var settings = new Mock<ITenantSettingsReadService>();
            settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
            var chart = (await new OrgChartQueryHandler(db, settings.Object)
                .Handle(new OrgChartQuery(DateOnly.FromDateTime(Today), OrgChartScopes.Tenant, null, HrAudience: true), default)).Value;
            Assert.Equal([ctx.YoussefKey], chart.People.Single(p => p.EmployeeKey == ctx.KarimKey).DottedLineManagerKeys);

            // Moving under the dotted-line manager ends that dotted line: they become the manager.
            var move = await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(later, ManagerEmployeeId: ctx.YoussefId));
            Assert.Equal([("Karim Zayed", "Youssef Ben Ali")], move.Details.DottedLinesEnded!.Select(item => (item.Person.DisplayName, item.Manager.DisplayName)));
            Assert.Single((await ProfileAsync(db, ctx, ctx.KarimKey)).DottedLineManagers);
            Assert.Empty((await ProfileAsync(db, ctx, ctx.KarimKey, later)).DottedLineManagers);
            var changes = (await new OrgChartChangesQueryHandler(db, settings.Object)
                .Handle(new OrgChartChangesQuery(DateOnly.FromDateTime(Today.AddDays(1)), DateOnly.FromDateTime(Today.AddDays(60))), default)).Value;
            Assert.Equal([(OrgChartChangeKinds.Move, DateOnly.FromDateTime(later), ctx.KarimKey, (string?)ctx.YoussefKey)],
                changes.Select(c => (c.Kind, c.Date, c.EmployeeKey, c.ManagerKey)));

            // After the move, Amina (the former manager) can be a dotted line; it ends with her employment.
            var toAmina = await Dotted(ctx.AminaId, later.AddDays(1));
            Assert.True(toAmina.IsSuccess, toAmina.IsFailure ? toAmina.Error.Message : null);
            var lastDay = DateOnly.FromDateTime(later.AddDays(9));
            var preview = (await new EndEmploymentChangePreviewQueryHandler(db, Service(db, ctx)).Handle(
                new EndEmploymentChangePreviewQuery(ctx.AminaKey, lastDay), default)).Value;
            Assert.Equal([("Karim Zayed", "MovesFirst")], preview.Reports.Select(item => (item.Person.DisplayName, item.Outcome)));
            Assert.Equal([("Karim Zayed", "Amina Mansour")], preview.DottedLinesEnding.Select(item => (item.Person.DisplayName, item.Manager.DisplayName)));
            var aminaLeaves = await TryEndAsync(db, ctx, new EndEmploymentChangeRequest(At(lastDay)));
            Assert.True(aminaLeaves.IsSuccess, aminaLeaves.IsFailure ? aminaLeaves.Error.Message : null);
            Assert.Single((await ProfileAsync(db, ctx, ctx.KarimKey, At(lastDay))).DottedLineManagers);
            Assert.Empty((await ProfileAsync(db, ctx, ctx.KarimKey, At(lastDay).AddDays(1))).DottedLineManagers);
        });

    // --- Fixture ----------------------------------------------------------------------------------

    private sealed record Fixture(
        CoreHRDbContext Db,
        EY.HRPlatform.SharedKernel.Multitenancy.ITenantContext Tenant,
        OrganizationService Organization,
        IWorkforceMutationService Mutation,
        Guid AiId, Guid CustomerSuccessId,
        Guid KarimId, string KarimKey,
        Guid AminaId, string AminaKey,
        Guid YoussefId, string YoussefKey);

    private static async Task WithDatabaseAsync(Func<CoreHRDbContext, Fixture, Fixture, Task> test)
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_COREHR_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_changes_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            var (tenantId, otherTenantId) = (Guid.NewGuid(), Guid.NewGuid());
            await using var db = CreateDb(connectionString, tenantId);
            await db.Database.MigrateAsync();
            await using var otherDb = CreateDb(connectionString, otherTenantId);
            var ctx = await SetUpAsync(db, tenantId);
            var other = await SetUpAsync(otherDb, otherTenantId);
            await test(db, ctx, other);
        }
        finally
        {
            await DropDatabaseAsync(baseConnection, databaseName);
        }
    }

    /// <summary>Amina and Youssef in Customer Success since 2020; Karim in AI Automation since 2021, reporting to Amina.</summary>
    private static async Task<Fixture> SetUpAsync(CoreHRDbContext db, Guid tenantId)
    {
        var tenant = TestTenantContext.WithTenant(tenantId);
        var organization = new OrganizationService(db, tenant);
        var start = DateOnly.FromDateTime(Since);
        var root = await organization.CreateRootAsync(new CreateOrganizationRootRequest("ASTERIA", "Asteria Group", start), default);
        var ai = await organization.CreateUnitAsync(
            new CreateOrganizationUnitRequest("AI", "AI Automation", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, start), default);
        var cs = await organization.CreateUnitAsync(
            new CreateOrganizationUnitRequest("CS", "Customer Success", OrganizationalUnitTypeCatalog.DepartmentId, root.Id, start), default);

        var mutation = new WorkforceMutationService(db, tenant, new WorkforceCanonicalResolver(db));
        async Task<(Guid Id, string Key)> Existing(string first, string last, Guid unit, string title, DateTime from, Guid? manager)
        {
            var result = await new AddExistingEmployeeCommandHandler(db, tenant, new EmployeeNumberAllocatorService(db, tenant), mutation, organization).Handle(
                new AddExistingEmployeeCommand(new AddExistingEmployeeRequest(
                    first, last, null, null, null, EmployeeNumberMode.Generated, null, from, from, db.EmploymentType(tenant.TenantId, "Full-time").Id, unit, db.JobId(tenant.TenantId, title), db.PlaceId(tenant.TenantId, "Tunis"), manager), Actor),
                default);
            if (result.IsFailure) throw new InvalidOperationException(result.Error.Message);
            return (await db.Employees.Where(e => e.StableEmployeeKey == result.Value.EmployeeKey).Select(e => e.Id).SingleAsync(), result.Value.EmployeeKey);
        }

        var amina = await Existing("Amina", "Mansour", cs.Id, "Customer Success Director", Since, null);
        var youssef = await Existing("Youssef", "Ben Ali", cs.Id, "Customer Growth Director", Since, null);
        var karim = await Existing("Karim", "Zayed", ai.Id, "Consultant Senior", Since.AddYears(1), amina.Id);
        db.ChangeTracker.Clear();

        return new Fixture(db, tenant, organization, mutation, ai.Id, cs.Id,
            karim.Id, karim.Key, amina.Id, amina.Key, youssef.Id, youssef.Key);
    }

    private static WorkforceChangeService Service(CoreHRDbContext db, Fixture ctx)
        => new(db, ctx.Tenant, ctx.Mutation, ctx.Organization, new WorkEmailOccupancyService(db, ctx.Tenant), new CoreChangeNotifications(db));

    private static Task<Result<WorkforceChangeDto>> TryJobAsync(CoreHRDbContext db, Fixture ctx, string key, JobChangeRequest request)
        => new JobChangeCommandHandler(db, Service(db, ctx), new WorkforceChangeReader(db))
            .Handle(new JobChangeCommand(key, request, Actor, CanManageEmployees: true), default);

    private static async Task<WorkforceChangeDto> JobAsync(CoreHRDbContext db, Fixture ctx, string key, JobChangeRequest request)
    {
        var result = await TryJobAsync(db, ctx, key, request);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    private static Task<Result<WorkforceChangeDto>> TryEndAsync(CoreHRDbContext db, Fixture ctx, EndEmploymentChangeRequest request)
        => new EndEmploymentChangeCommandHandler(db, Service(db, ctx), new WorkforceChangeReader(db))
            .Handle(new EndEmploymentChangeCommand(ctx.AminaKey, request, Actor), default);

    private static Task<Result<bool>> CancelAsync(
        CoreHRDbContext db, Fixture ctx, Guid changeId, bool canManageEmployees = true, IWorkforceAccountStatusReader? accounts = null)
        => new CancelWorkforceChangeCommandHandler(db, Service(db, ctx), accounts ?? new Accounts(_ => null))
            .Handle(new CancelWorkforceChangeCommand(changeId, Actor, canManageEmployees), default);

    /// <summary>Identity as the test needs it: a state per person, or a failure when the state is "down".</summary>
    private sealed class Accounts(Func<Guid, string?> stateOf) : IWorkforceAccountStatusReader
    {
        public Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
            IReadOnlyCollection<WorkforceAccountSubjectDto> subjects, CancellationToken cancellationToken)
        {
            if (subjects.Any(subject => stateOf(subject.EmployeeId) == "down"))
                throw new InvalidOperationException("Identity is unavailable.");
            IReadOnlyDictionary<Guid, WorkforceAccountStatusDto> found = subjects
                .Where(subject => stateOf(subject.EmployeeId) is not null)
                .ToDictionary(subject => subject.EmployeeId, subject => new WorkforceAccountStatusDto(
                    subject.EmployeeId, subject.Email, null, "Employee", [], stateOf(subject.EmployeeId)!, null, null, null,
                    null, null, null, null, null, null, null, null));
            return Task.FromResult(found);
        }
    }

    /// <summary>Every effective-dated row of a person, to prove cancel puts them back exactly.</summary>
    private static async Task<List<string>> RowsAsync(CoreHRDbContext db, Guid employeeId)
    {
        var employments = await db.Employments.AsNoTracking().Where(item => item.EmployeeId == employeeId)
            .Select(item => $"E {item.Id} {item.EffectiveFrom:O} {item.EffectiveTo:O} {item.Status}").ToListAsync();
        var assignments = await db.WorkAssignments.AsNoTracking().Where(item => item.EmployeeId == employeeId)
            .Select(item => $"W {item.Id} {item.EffectiveFrom:O} {item.EffectiveTo:O} {item.OrgUnitId} {item.JobTitle} {item.WorkLocation}").ToListAsync();
        var lines = await db.ManagerRelationships.AsNoTracking().Where(item => item.SubjectEmployeeId == employeeId || item.ManagerEmployeeId == employeeId)
            .Select(item => $"M {item.Id} {item.SubjectEmployeeId} {item.ManagerEmployeeId} {item.Type} {item.EffectiveFrom:O} {item.EffectiveTo:O}").ToListAsync();
        return [.. employments.Concat(assignments).Concat(lines).Order(StringComparer.Ordinal)];
    }

    private static DateTime At(DateOnly date) => DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

    private static async Task<PeopleProfileDto> ProfileAsync(CoreHRDbContext db, Fixture ctx, string employeeKey, DateTime? asOf = null)
    {
        var result = await new PeopleProfileQueryHandler(db, ctx.Organization, new WorkforceChangeReader(db))
            .Handle(new PeopleProfileQuery(employeeKey, asOf), default);
        if (result.IsFailure) throw new InvalidOperationException(result.Error.Message);
        return result.Value;
    }

    private static CoreHRDbContext CreateDb(string connectionString, Guid tenantId)
        => new(new DbContextOptionsBuilder<CoreHRDbContext>().UseNpgsql(connectionString).Options, TestTenantContext.WithTenant(tenantId));

    private static async Task CreateDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var adminConnection = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var adminConnection = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using (var terminate = new NpgsqlCommand(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @databaseName AND pid <> pg_backend_pid();", connection))
        {
            terminate.Parameters.AddWithValue("databaseName", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\"", connection);
        await drop.ExecuteNonQueryAsync();
    }
}
