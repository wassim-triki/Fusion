using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Features.OneOnOnes;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>D-12: a series ends with its reporting line even when nobody touches it.</summary>
public sealed class OneOnOneReconciliationTests
{
    [Fact]
    public async Task A_series_whose_report_moved_ends_and_an_intact_one_is_untouched()
    {
        var store = TestStore.ForNewTenant();
        var workforce = new FakeCoreWorkforceClient();
        var karim = workforce.Add("Karim Haddad").EmployeeId;
        var leila = workforce.Add("Leila Baccouche").EmployeeId;
        var nour = workforce.Add("Nour Trabelsi", managerId: karim).EmployeeId;
        var sami = workforce.Add("Sami Kefi", managerId: karim).EmployeeId;
        var now = DateTime.UtcNow;
        Guid moved, intact;
        await using (var db = store.NewContext())
        {
            var (a, aMeeting) = OneOnOneSeries.Start(store.TenantId, karim, nour, OneOnOneCadence.Weekly, karim, now.AddHours(2), now);
            var (b, bMeeting) = OneOnOneSeries.Start(store.TenantId, karim, sami, OneOnOneCadence.Weekly, karim, now.AddHours(2), now);
            db.AddRange(a, aMeeting, b, bMeeting);
            await db.SaveChangesAsync();
            (moved, intact) = (a.Id, b.Id);
        }
        var nourNow = workforce.ById[nour];
        workforce.ById[nour] = nourNow with { Manager = new WorkforceManagerSnapshot(leila, "Leila Baccouche", true) };

        await using (var db = store.NewContext())
            Assert.Equal(1, await OneOnOneReconciler.ReconcileTenantAsync(db, workforce, now, CancellationToken.None));

        await using var check = store.NewContext();
        var ended = await check.OneOnOneSeries.SingleAsync(s => s.Id == moved);
        Assert.Equal(OneOnOneEndReason.ReportingLineEnded, ended.EndReason);
        Assert.Equal(OneOnOneMeetingState.NotHeld, (await check.OneOnOneMeetings.SingleAsync(m => m.SeriesId == moved)).State);
        Assert.Null((await check.OneOnOneSeries.SingleAsync(s => s.Id == intact)).EndedAt);
        Assert.Equal(OneOnOneMeetingState.Upcoming, (await check.OneOnOneMeetings.SingleAsync(m => m.SeriesId == intact)).State);
        Assert.Single(await check.AuditEntries.Where(e => e.Action == PerformanceAuditActions.OneOnOneEnded).ToListAsync());
        // Both people's calendars drop the meeting that won't happen.
        var cancelled = await check.OutboxMessages.Where(m => m.Kind == Domain.Notifications.PerformanceNotificationKind.OneOnOneInvite).ToListAsync();
        Assert.Equal(new[] { karim, nour }.OrderBy(x => x), cancelled.Select(m => m.RecipientEmployeeId).OrderBy(x => x));

        // A second pass finds nothing more to end.
        await using var again = store.NewContext();
        Assert.Equal(0, await OneOnOneReconciler.ReconcileTenantAsync(again, workforce, now, CancellationToken.None));
    }

    [Fact]
    public void An_invite_is_a_request_a_cancellation_cancels_and_long_lines_fold()
    {
        var meetingId = Guid.NewGuid();
        var at = new DateTime(2026, 11, 10, 10, 0, 0, DateTimeKind.Utc);
        var e = new CalendarEvent(meetingId, at, at.AddMinutes(30), "1:1 with Aicha Bouazizi, Engineering; A Core",
            "http://localhost:3000/performance/one-on-ones/" + new string('a', 80), 3, false);
        var invite = ICalendar.Invite(e, "fusion@example.test");
        Assert.Contains("METHOD:REQUEST\r\n", invite);
        Assert.Contains($"UID:{meetingId:N}@fusion-performance", invite);
        Assert.Contains("DTSTART:20261110T100000Z", invite);
        Assert.Contains("DTEND:20261110T103000Z", invite);
        Assert.Contains("SUMMARY:1:1 with Aicha Bouazizi\\, Engineering\\; A Core", invite);
        Assert.All(invite.Split("\r\n"), line => Assert.True(System.Text.Encoding.UTF8.GetByteCount(line) <= 75, line));
        var cancel = ICalendar.Invite(e with { Cancelled = true, Sequence = 4 }, "fusion@example.test");
        Assert.Contains("METHOD:CANCEL", cancel);
        Assert.Contains("STATUS:CANCELLED", cancel);
        Assert.DoesNotContain("BEGIN:VEVENT", ICalendar.Feed("Fusion 1:1s", [e with { Cancelled = true }]));
    }
}
