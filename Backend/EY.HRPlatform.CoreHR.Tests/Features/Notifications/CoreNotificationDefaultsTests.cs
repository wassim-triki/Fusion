using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Notifications;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.Notifications;

/// <summary>The company's email mode for Core HR groups (B-002 N7): who may read and change it, and what people then see.</summary>
public class CoreNotificationDefaultsTests
{
    private const string Group = CoreNotificationPreference.TeamAndJobChanges;
    private static readonly Guid TenantA = Guid.NewGuid();

    [Fact]
    public async Task Only_organization_settings_holders_read_it_and_only_managers_change_it()
    {
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA));
        var employee = Principal((CorePermissions.ProfileSelfView, PermissionScopes.Self));
        var viewer = Principal((CorePermissions.SettingsOrganizationView, PermissionScopes.Tenant));
        var manager = Principal((CorePermissions.SettingsOrganizationManage, PermissionScopes.Tenant));
        var request = new UpdateNotificationDefaultsRequest(0, new Dictionary<string, string> { [Group] = NotificationEmailModes.Off });

        Assert.IsType<ForbidResult>(await Controller(db, employee).GetNotificationDefaults(Service(db, TenantA), default));
        Assert.IsType<ForbidResult>(await Controller(db, employee).UpdateNotificationDefaults(request, Service(db, TenantA), default));
        Assert.IsType<OkObjectResult>(await Controller(db, viewer).GetNotificationDefaults(Service(db, TenantA), default));
        Assert.IsType<ForbidResult>(await Controller(db, viewer).UpdateNotificationDefaults(request, Service(db, TenantA), default));
        Assert.Empty(await db.NotificationDefaults.ToListAsync());

        var saved = Assert.IsType<OkObjectResult>(await Controller(db, manager).UpdateNotificationDefaults(request, Service(db, TenantA), default));
        Assert.Equal(NotificationEmailModes.Off, Assert.IsType<ApiResponse<NotificationDefaultsDto>>(saved.Value).Data!.Groups[0].Mode);
        Assert.Equal(SettingsSectionIdsNotifications, Assert.Single(await db.SettingsAuditEvents.ToListAsync()).SectionId);
    }

    [Fact]
    public async Task Unknown_groups_and_modes_and_stale_saves_are_refused_and_each_tenant_keeps_its_own()
    {
        var database = Guid.NewGuid().ToString();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA), database);
        var service = Service(db, TenantA);
        var user = Principal((CorePermissions.SettingsOrganizationManage, PermissionScopes.Tenant));

        Assert.Equal(PreferencesRefusal.Invalid, (await service.UpdateAsync(
            new UpdateNotificationDefaultsRequest(0, new Dictionary<string, string> { ["plans-and-goals"] = NotificationEmailModes.Off }), user, default)).Refusal);
        Assert.Equal(PreferencesRefusal.Invalid, (await service.UpdateAsync(
            new UpdateNotificationDefaultsRequest(0, new Dictionary<string, string> { [Group] = "sometimes" }), user, default)).Refusal);
        Assert.Equal(PreferencesRefusal.Changed, (await service.UpdateAsync(
            new UpdateNotificationDefaultsRequest(3, new Dictionary<string, string> { [Group] = NotificationEmailModes.Off }), user, default)).Refusal);

        var saved = await service.UpdateAsync(
            new UpdateNotificationDefaultsRequest(0, new Dictionary<string, string> { [Group] = NotificationEmailModes.Required }), user, default);
        Assert.Equal((PreferencesRefusal.None, 1u), (saved.Refusal, saved.Value!.Version));
        Assert.Equal(PreferencesRefusal.Changed, (await service.UpdateAsync(
            new UpdateNotificationDefaultsRequest(0, new Dictionary<string, string> { [Group] = NotificationEmailModes.On }), user, default)).Refusal);

        var tenantB = Guid.NewGuid();
        await using var other = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), database);
        var theirs = await Service(other, tenantB).GetAsync(default);
        Assert.Equal((NotificationEmailModes.On, NotificationEmailModes.On, 0u), (theirs.Groups[0].Mode, theirs.Groups[0].FusionDefault, theirs.Version));
    }

    [Fact]
    public async Task People_see_what_the_company_requires_and_choose_against_its_mode()
    {
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA));
        var user = Principal((CorePermissions.SettingsOrganizationManage, PermissionScopes.Tenant));
        var feed = Feed(db);
        var karim = Guid.NewGuid();

        await Service(db, TenantA).UpdateAsync(
            new UpdateNotificationDefaultsRequest(0, new Dictionary<string, string> { [Group] = NotificationEmailModes.Required }), user, default);
        var required = (await feed.PreferencesAsync(karim, false, default)).Groups[0];
        Assert.Equal((true, true), (required.Email, required.Locked));
        Assert.Equal(PreferencesRefusal.Invalid, (await feed.UpdatePreferencesAsync(karim, false,
            new UpdateNotificationPreferencesRequest(0, [Group]), default)).Refusal);
        var token = UnsubscribeToken.Issue(new UnsubscribeClaim(TenantA, karim, Group), UnsubscribeKey);
        Assert.False(await Feed(db).UnsubscribeAsync(token, default));

        await Service(db, TenantA).UpdateAsync(
            new UpdateNotificationDefaultsRequest(1, new Dictionary<string, string> { [Group] = NotificationEmailModes.Off }), user, default);
        var off = (await feed.PreferencesAsync(karim, false, default)).Groups[0];
        Assert.Equal((false, false), (off.Email, off.Locked));
        var turnedOn = await feed.UpdatePreferencesAsync(karim, false, new UpdateNotificationPreferencesRequest(0, []), default);
        Assert.True(turnedOn.Value!.Groups[0].Email);
        Assert.Equal([Group], (await db.NotificationPreferences.SingleAsync()).EmailOn);
    }

    [Fact]
    public void A_required_group_has_no_unsubscribe_and_says_it_cant_be_turned_off()
    {
        var required = CoreNotificationDefaults.For(TenantA);
        required.Set(new Dictionary<string, NotificationEmailMode> { [Group] = NotificationEmailMode.Required });
        var notification = CoreNotification.For(TenantA, Guid.NewGuid(), CoreNotificationKind.ManagerChanged, Guid.NewGuid(),
            new CoreNotificationMessage("ManagerChanged", null, new Dictionary<string, string> { ["manager"] = "Hana", ["date"] = "2026-12-01" },
                "Amira", "/core/profile"), DateTime.UtcNow);

        Assert.NotNull(CoreNotificationRenderer.UnsubscribeUrl(notification, "http://localhost:3000", UnsubscribeKey));
        Assert.Null(CoreNotificationRenderer.UnsubscribeUrl(notification, "http://localhost:3000", UnsubscribeKey, required));
    }

    private const string SettingsSectionIdsNotifications = "notifications";
    private const string UnsubscribeKey = "test-unsubscribe-key-of-at-least-32-characters";

    private static CoreNotificationDefaultsService Service(CoreHRDbContext db, Guid tenantId)
        => new(db, TestTenantContext.WithTenant(tenantId), new SettingsAuditService(db, TestTenantContext.WithTenant(tenantId), new HttpContextAccessor()));

    private static CoreNotificationFeed Feed(CoreHRDbContext db)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(TenantA);
        return new CoreNotificationFeed(db, tenant, Microsoft.Extensions.Options.Options.Create(
            new CoreNotificationOptions { Enabled = true, ShellBaseUrl = "http://localhost:3000", UnsubscribeKey = UnsubscribeKey }));
    }

    private static TenantSettingsController Controller(CoreHRDbContext db, ClaimsPrincipal user)
        => new(Mock.Of<ISender>(), new CoreAccessPolicyService(), Mock.Of<ISettingsSectionRegistry>(), Mock.Of<ISettingsAuditService>(),
            TestTenantContext.WithTenant(TenantA))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } },
        };

    private static ClaimsPrincipal Principal(params (string PermissionKey, string Scope)[] grants)
        => new(new ClaimsIdentity(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission,
            CorePermissionClaimValue.Encode(grant.PermissionKey, grant.Scope))), "Test"));
}
