using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Goals;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>The monthly reminder to update goals: only for goals a month quiet, once a month, never for a draft plan.</summary>
public sealed class GoalUpdateReminderTests
{
    [Fact]
    public async Task A_month_quiet_plan_is_reminded_once_a_month_and_a_draft_never()
    {
        var store = TestStore.ForNewTenant();
        var tenant = store.TenantId;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var start = today.AddMonths(-2);
        Guid nour = Guid.NewGuid(), sami = Guid.NewGuid(), karim = Guid.NewGuid();
        await using (var db = store.NewContext())
        {
            var cycle = PerformanceCycle.CreateDraft(tenant, "FY2027", start, today.AddMonths(10), start.AddDays(14)).Activated();
            EmployeePlan Plan(Guid who, string name, bool approve)
            {
                var participant = Participant.Create(tenant, cycle.Id, who, name, null, null, "Platform", karim, "Karim Haddad", false, start);
                var plan = EmployeePlan.Create(tenant, cycle.Id, participant.Id, who, name, "Platform", karim, "Karim Haddad");
                var goal = Objective.CreateEmployee(tenant, cycle.Id, plan.Id, who, "Ship the gateway", null, null,
                    start, today.AddMonths(10), ObjectiveMeasurement.ManualPercentage(), 100m, null, null, start, today.AddMonths(10));
                if (approve)
                {
                    plan.Submit(who, new PlanSubmissionFacts(1, true, 100m, true, false, PlanAlignmentPolicy.Optional));
                    plan.Approve(karim);
                }
                db.AddRange(participant, plan, goal);
                return plan;
            }
            db.Add(cycle);
            Plan(nour, "Nour Trabelsi", approve: true);
            Plan(sami, "Sami Kefi", approve: false);
            await db.SaveChangesAsync();
        }

        var sendDay = today;
        // Today the goal is fresh: nothing to remind.
        await using (var db = store.NewContext())
            Assert.Equal(0, await GoalUpdateReminderScanner.ScanTenantAsync(db, new PerformanceNotifications(db), DateTime.UtcNow, sendDay, CancellationToken.None));

        // A month on, Nour's approved plan is quiet; Sami's draft isn't reminded.
        var later = DateTime.UtcNow.AddDays(31);
        await using (var db = store.NewContext())
            Assert.Equal(1, await GoalUpdateReminderScanner.ScanTenantAsync(db, new PerformanceNotifications(db), later, sendDay, CancellationToken.None));
        await using (var db = store.NewContext())
            Assert.Equal(0, await GoalUpdateReminderScanner.ScanTenantAsync(db, new PerformanceNotifications(db), later, sendDay, CancellationToken.None));

        await using var check = store.NewContext();
        var reminder = Assert.Single(await check.Notifications.Where(n => n.Kind == PerformanceNotificationKind.GoalUpdateReminder).ToListAsync());
        Assert.Equal(nour, reminder.RecipientEmployeeId);
        Assert.StartsWith("/performance/goals?cycle=", reminder.Href);
    }
}
