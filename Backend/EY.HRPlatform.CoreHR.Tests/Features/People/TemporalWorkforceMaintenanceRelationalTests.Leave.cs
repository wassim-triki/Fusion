using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.OrgChart;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.CoreHR.Tests.Features.Organization;
using EY.HRPlatform.CoreHR.Tests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>
/// On leave (B-229): leave is a change of its own that writes no rows, follows the company's approval rules, never
/// orders the person's other changes, and shows wherever the person does, its type only to HR, the manager and the person.
/// </summary>
public sealed partial class TemporalWorkforceMaintenanceRelationalTests
{
    [RelationalDatabaseFact]
    public Task Hr_sets_leave_at_once_it_shows_on_the_person_and_stands_apart_from_their_other_changes()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            await requests.UpdateSettingsAsync(ChangeApprovalTypes.All, "test", null, default);
            var annual = LeaveType(db, ctx.Tenant.TenantId, "Annual leave");
            var monday = NextMonday(Today.AddDays(14));
            var friday = monday.AddDays(11);

            var set = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(annual, monday, friday)), Hr, default);
            Assert.True(set.IsSuccess, set.IsFailure ? set.Error.Message : null);
            var leave = set.Value.Change!;
            var back = DateOnly.FromDateTime(friday.AddDays(3));
            Assert.Equal((WorkforceChangeKind.Leave, "Annual leave", DateOnly.FromDateTime(friday), back, true, true),
                (leave.Kind, leave.Details.LeaveType, leave.LastDay, leave.Back, leave.CanCancel, leave.CanEdit));

            // HR sees the type; a colleague sees only that Karim is away; Karim sees his own.
            var hr = (await ProfileAsync(db, ctx, ctx.KarimKey)).Leave!;
            Assert.Equal(("Annual leave", DateOnly.FromDateTime(monday), back, false), (hr.Type, hr.From, hr.Back, hr.Now));
            Assert.Null((await AsColleagueAsync(db, ctx, ctx.KarimKey, ctx.YoussefId)).Leave!.Type);
            Assert.Equal("Annual leave", (await AsColleagueAsync(db, ctx, ctx.KarimKey, ctx.KarimId)).Leave!.Type);
            Assert.Contains((await ProfileAsync(db, ctx, ctx.KarimKey)).ComingUp, item => item.Id == leave.Id);

            // The chart on a date shows who is away that day: coming today, away on its first day, back after it.
            var settings = new Mock<ITenantSettingsReadService>();
            settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new TenantSettingsDto());
            async Task<PersonLeaveDto?> OnChart(DateTime day) => (await new OrgChartQueryHandler(db, settings.Object)
                .Handle(new OrgChartQuery(DateOnly.FromDateTime(day), OrgChartScopes.Tenant, null, HrAudience: true), default))
                .Value.People.Single(p => p.EmployeeKey == ctx.KarimKey).Leave;
            Assert.False((await OnChart(Today))!.Now);
            Assert.Equal((true, (string?)null), ((await OnChart(monday))!.Now, (await OnChart(monday))!.Type));
            Assert.Null(await OnChart(friday.AddDays(1)));

            // It neither waits for nor blocks a job change, before or after it.
            await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(Today.AddDays(3), JobId: db.JobId(ctx.Tenant.TenantId, "Lead")));
            await JobAsync(db, ctx, ctx.KarimKey, new JobChangeRequest(friday.AddDays(30), JobId: db.JobId(ctx.Tenant.TenantId, "Principal")));

            // Overlapping leave is refused; open-ended leave runs on with no return day.
            Assert.Equal("Leave.Overlaps", (await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(annual, friday, null)), Hr, default)).Error.Code);
            Assert.Equal("Leave.UnknownType", (await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(db.ChangeReasons(ctx.Tenant.TenantId, "Promotion"), friday.AddDays(10))), Hr, default)).Error.Code);

            // HR changes it in place, then cancels it before it starts (a later job change doesn't stop it); a reporting admin can do neither.
            var edit = new EditWorkforceChangeCommandHandler(db, Service(db, ctx), new WorkforceChangeReader(db));
            var revision = new EditChangeRequest(Leave: new LeaveChangeRequest(annual, monday, null));
            Assert.Equal(WorkforceChangeService.ForbiddenCode,
                (await edit.Handle(new EditWorkforceChangeCommand(leave.Id, revision, Actor, false), default)).Error.Code);
            var revised = await edit.Handle(new EditWorkforceChangeCommand(leave.Id, revision, Actor, true), default);
            Assert.True(revised.IsSuccess, revised.IsFailure ? revised.Error.Message : null);
            Assert.Equal((leave.Id, (DateOnly?)null, (DateOnly?)null), (revised.Value.Id, revised.Value.LastDay, revised.Value.Back));
            Assert.Equal(WorkforceChangeService.ForbiddenCode, (await CancelAsync(db, ctx, leave.Id, canManageEmployees: false)).Error.Code);
            Assert.True((await CancelAsync(db, ctx, leave.Id)).IsSuccess);
            db.ChangeTracker.Clear();
            Assert.Null((await ProfileAsync(db, ctx, ctx.KarimKey)).Leave);
        });

    [RelationalDatabaseFact]
    public Task Leave_started_today_ends_early_shows_in_the_snapshot_and_stays_inside_its_tenant()
        => WithDatabaseAsync(async (db, ctx, other) =>
        {
            var requests = Requests(db, ctx);
            var sick = LeaveType(db, ctx.Tenant.TenantId, "Sick leave");
            var now = (await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(sick, Today)), Hr, default)).Value.Change!;
            Assert.Null(now.Back);

            // Performance reads it through the snapshot, without the type.
            var snapshot = (await new InternalWorkforceSnapshotService(db).ResolveEmployeesAsync(Today, [ctx.KarimId], default)).Single();
            Assert.Equal((true, (string?)null), (snapshot.Leave!.Now, snapshot.Leave.Type));

            // Started: its first day stays and it can't be cancelled, only ended.
            var edit = new EditWorkforceChangeCommandHandler(db, Service(db, ctx), new WorkforceChangeReader(db));
            Assert.Equal("Leave.Started", (await edit.Handle(new EditWorkforceChangeCommand(now.Id,
                new EditChangeRequest(Leave: new LeaveChangeRequest(sick, Today.AddDays(1))), Actor, true), default)).Error.Code);
            var ended = await edit.Handle(new EditWorkforceChangeCommand(now.Id,
                new EditChangeRequest(Leave: new LeaveChangeRequest(sick, Today, Today)), Actor, true), default);
            Assert.True(ended.IsSuccess, ended.IsFailure ? ended.Error.Message : null);
            Assert.Equal(DateOnly.FromDateTime(Today), ended.Value.LastDay);

            // Another tenant finds neither the person nor the leave.
            var otherRequests = Requests(other.Db, other);
            Assert.Equal("Change.NotFound", (await otherRequests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(sick, Today.AddDays(5))), Hr, default)).Error.Code);
            Assert.Equal("Change.NotFound", (await new EditWorkforceChangeCommandHandler(other.Db, Service(other.Db, other), new WorkforceChangeReader(other.Db))
                .Handle(new EditWorkforceChangeCommand(now.Id, new EditChangeRequest(Leave: new LeaveChangeRequest(sick, Today, Today)), Actor, true), default)).Error.Code);
            Assert.Equal("Change.NotFound", (await CancelAsync(other.Db, other, now.Id)).Error.Code);
            Assert.Empty(await new InternalWorkforceSnapshotService(other.Db).ResolveEmployeesAsync(Today, [ctx.KarimId], default));
        });

    [RelationalDatabaseFact]
    public Task A_managers_leave_for_their_report_follows_the_approval_rules_and_nobody_else_proposes_it()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            var annual = LeaveType(db, ctx.Tenant.TenantId, "Annual leave");
            var body = new ProposeChangeRequest(Leave: new LeaveChangeRequest(annual, Today.AddDays(20), Today.AddDays(24)));

            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ProposeAsync(ctx.KarimKey, body, YoussefProposes(ctx), default)).Error.Code);
            Assert.Equal(ChangeRequestService.ForbiddenCode, (await requests.ProposeAsync(ctx.KarimKey, body,
                AminaProposes(ctx) with { Proposes = false }, default)).Error.Code);

            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Leave], "test", null, default);
            var waits = await requests.ProposeAsync(ctx.KarimKey, body, AminaProposes(ctx), default);
            Assert.True(waits.IsSuccess, waits.IsFailure ? waits.Error.Message : null);
            Assert.Equal((WorkforceChangeRequestKind.Leave, "Annual leave"), (waits.Value.Request!.Kind, waits.Value.Request.Change!.LeaveType));
            Assert.Null((await ProfileAsync(db, ctx, ctx.KarimKey)).Leave);
            var approved = await requests.ApproveAsync(waits.Value.Request.Id, Hr, default);
            Assert.True(approved.IsSuccess, approved.IsFailure ? approved.Error.Message : null);
            Assert.Equal(DateOnly.FromDateTime(Today.AddDays(20)), (await ProfileAsync(db, ctx, ctx.KarimKey)).Leave!.From);

            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Job], "test", null, default);
            var applies = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(annual, Today.AddDays(40), Today.AddDays(41))), AminaProposes(ctx), default);
            Assert.NotNull(applies.Value.Change);
        });

    [RelationalDatabaseFact]
    public Task The_manager_hears_when_leave_is_set_changed_ended_or_cancelled_with_its_type_and_nobody_else_does()
        => WithDatabaseAsync(async (db, ctx, other) =>
        {
            var requests = Requests(db, ctx);
            var annual = LeaveType(db, ctx.Tenant.TenantId, "Annual leave");
            var monday = NextMonday(Today.AddDays(14));
            var leave = (await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(annual, monday, monday.AddDays(4))), Hr, default)).Value.Change!;

            // Amina, Karim's manager, hears it with the type; Karim and everyone else don't; another tenant sees nothing.
            var row = Assert.Single(await db.Notifications.AsNoTracking().ToListAsync());
            Assert.Equal((ctx.AminaId, CoreNotificationKind.TeamLeave, leave.Id), (row.RecipientEmployeeId, row.Kind, row.ChangeId));
            var feed = Feed(db, ctx.Tenant.TenantId);
            var item = Assert.Single((await feed.PageAsync(ctx.AminaId, null, null, "en", default)).Items);
            var day = (DateTime date) => date.ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture);
            Assert.Equal(($"Karim Zayed is on leave from {day(monday)}", $"Annual leave · back {day(monday.AddDays(7))}", "/core/team"),
                (item.Title, item.Context, item.Href));
            Assert.Empty((await feed.PageAsync(ctx.KarimId, null, null, "en", default)).Items);
            Assert.Equal(0, await other.Db.Notifications.CountAsync());

            // HR changes it, then cancels it: one more each, the cancellation answering once.
            var edit = new EditWorkforceChangeCommandHandler(db, Service(db, ctx), new WorkforceChangeReader(db));
            Assert.True((await edit.Handle(new EditWorkforceChangeCommand(leave.Id,
                new EditChangeRequest(Leave: new LeaveChangeRequest(annual, monday, null)), Actor, true), default)).IsSuccess);
            Assert.True((await CancelAsync(db, ctx, leave.Id)).IsSuccess);
            var titles = (await feed.PageAsync(ctx.AminaId, null, null, "en", default)).Items.Select(entry => entry.Title).ToList();
            Assert.Equal(3, titles.Count);
            Assert.Contains($"Karim Zayed's leave from {day(monday)} changed", titles);
            Assert.Contains($"Karim Zayed's leave from {day(monday)} was cancelled", titles);

            // Leave that started ends early.
            var sick = LeaveType(db, ctx.Tenant.TenantId, "Sick leave");
            var now = (await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(sick, Today, Today.AddDays(5))), Hr, default)).Value.Change!;
            Assert.True((await edit.Handle(new EditWorkforceChangeCommand(now.Id,
                new EditChangeRequest(Leave: new LeaveChangeRequest(sick, Today, Today)), Actor, true), default)).IsSuccess);
            Assert.Equal(["TeamLeave.now", "TeamLeave.endedEarly"], await db.Notifications.AsNoTracking()
                .Where(entry => entry.ChangeId == now.Id).OrderBy(entry => entry.OccurredAt).Select(entry => entry.TitleKey).ToListAsync());
            Assert.Equal(0, await other.Db.Notifications.CountAsync());
        });

    [RelationalDatabaseFact]
    public Task Ended_leave_stays_in_history_with_its_type_and_working_days_while_leave_now_does_not()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var annual = LeaveType(db, ctx.Tenant.TenantId, "Annual leave");
            var from = DateOnly.FromDateTime(NextMonday(Today.AddDays(-30)));
            var until = from.AddDays(11); // Two weeks, Monday to the second Friday: 10 working days.
            db.WorkforceChanges.Add(WorkforceChange.Create(ctx.Tenant.TenantId, ctx.KarimId, WorkforceChangeKind.Leave, from, null,
                System.Text.Json.JsonSerializer.Serialize(new WorkforceChangeDetails(LeaveTypeId: annual, LeaveType: "Annual leave", LeaveUntil: until),
                    WorkforceChangeRecorder.Json), "test", [], until));
            await db.SaveChangesAsync();
            Assert.True((await Requests(db, ctx).ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(
                Leave: new LeaveChangeRequest(annual, Today, Today.AddDays(3))), Hr, default)).IsSuccess);

            var history = (await new PeopleTimelineComposer(db).ComposeAsync(ctx.KarimId, ctx.KarimKey, default)).Timeline;
            var ended = Assert.Single(history, item => item.Kind == PeopleChangeKind.Leave);
            Assert.Equal(new PeopleTimelineLeaveDto("Annual leave", from, until, 10), ended.Leave);
        });

    [RelationalDatabaseFact]
    public Task A_manager_whose_leave_request_is_approved_isnt_told_about_it_again()
        => WithDatabaseAsync(async (db, ctx, _) =>
        {
            var requests = Requests(db, ctx);
            await requests.UpdateSettingsAsync([ChangeApprovalTypes.Leave], "test", null, default);
            var waits = await requests.ProposeAsync(ctx.KarimKey, new ProposeChangeRequest(Leave: new LeaveChangeRequest(
                LeaveType(db, ctx.Tenant.TenantId, "Annual leave"), Today.AddDays(20), Today.AddDays(24))), AminaProposes(ctx), default);
            Assert.True((await requests.ApproveAsync(waits.Value.Request!.Id, Hr, default)).IsSuccess);
            Assert.DoesNotContain(await db.Notifications.AsNoTracking().ToListAsync(), item => item.Kind == CoreNotificationKind.TeamLeave);
        });

    private static Guid LeaveType(CoreHRDbContext db, Guid tenantId, string label)
    {
        var value = CompanyListValue.Create(tenantId, CompanyList.LeaveTypes, label, $"leave-{Guid.NewGuid():N}"[..20], 0, "test");
        db.CompanyListValues.Add(value);
        db.SaveChanges();
        return value.Id;
    }

    private static DateTime NextMonday(DateTime from)
    {
        var day = from;
        while (day.DayOfWeek != DayOfWeek.Monday) day = day.AddDays(1);
        return day;
    }

    private static async Task<PeopleProfileDto> AsColleagueAsync(CoreHRDbContext db, Fixture ctx, string employeeKey, Guid viewerId)
    {
        var result = await new PeopleProfileQueryHandler(db, ctx.Organization, new WorkforceChangeReader(db))
            .Handle(new PeopleProfileQuery(employeeKey, null, EmployeeReadAudience.Employee, ViewerEmployeeId: viewerId), default);
        if (result.IsFailure) throw new InvalidOperationException(result.Error.Message);
        return result.Value;
    }
}
