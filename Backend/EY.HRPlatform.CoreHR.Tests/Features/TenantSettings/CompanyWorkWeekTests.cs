using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Commands.UpdateTenantSettings;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.TenantSettings;

public class CompanyWorkWeekTests
{
    [Theory]
    [InlineData(new int[] {})] [InlineData(new[] { 0 })] [InlineData(new[] { 8 })] [InlineData(new[] { 1, 1 })]
    public async Task Working_days_must_be_a_nonempty_set_of_ISO_weekdays(int[] days)
    {
        var tenant = TestTenantContext.WithTenant(Guid.NewGuid()); await using var db = TestDbContextFactory.Create(tenant);
        await Assert.ThrowsAsync<ArgumentException>(() => new UpdateTenantSettingsCommandHandler(db, tenant).Handle(new(null, null, null, WorkingDays: days), default));
    }

    [Fact]
    public async Task Defaults_round_trip_partial_save_and_concurrency_keep_other_company_settings()
    {
        Assert.Equal([1, 2, 3, 4, 5], TenantSettingsMerger.Merge(null).WorkingDays);
        var tenant = TestTenantContext.WithTenant(Guid.NewGuid()); await using var db = TestDbContextFactory.Create(tenant);
        var handler = new UpdateTenantSettingsCommandHandler(db, tenant);
        var saved = (await handler.Handle(new(null, null, null, Provisioning: new(null, null, null, null, 5, false), WorkingDays: [7, 1, 3]), default)).Value;
        Assert.Equal([1, 3, 7], saved.WorkingDays);
        await Assert.ThrowsAsync<ConcurrencyException>(() => handler.Handle(new(null, null, null, WorkingDays: [6]), default));
        saved = (await handler.Handle(new(saved.Version, null, null, SelfService: new(false, null)), default)).Value;
        Assert.Equal([1, 3, 7], saved.WorkingDays); Assert.Equal(5, saved.Provisioning.RemindAfterDays); Assert.False(saved.Provisioning.InviteJoinersOnFirstDay);
        saved = (await handler.Handle(new(saved.Version, null, null, WorkingDays: [1]), default)).Value;
        Assert.Equal([1], saved.WorkingDays); Assert.False(saved.SelfService.CanEditPreferredName);
    }

    [Fact]
    public async Task Work_week_is_tenant_scoped_and_settings_writes_require_company_management()
    {
        var database = Guid.NewGuid().ToString(); var tenantA = TestTenantContext.WithTenant(Guid.NewGuid()); var tenantB = TestTenantContext.WithTenant(Guid.NewGuid());
        await using var dbB = TestDbContextFactory.Create(tenantB, database);
        await new UpdateTenantSettingsCommandHandler(dbB, tenantB).Handle(new(null, null, null, WorkingDays: [7]), default);
        await using var dbA = TestDbContextFactory.Create(tenantA, database);
        var policy = new Mock<ICoreAccessPolicyService>();
        var sender = new Mock<MediatR.ISender>();
        sender.Setup(s => s.Send(It.IsAny<EY.HRPlatform.CoreHR.Features.TenantSettings.Queries.GetTenantSettings.GetTenantSettingsQuery>(), It.IsAny<CancellationToken>())).ReturnsAsync(TenantSettingsMerger.Merge(null));
        TenantSettingsController Controller(EY.HRPlatform.SharedKernel.Multitenancy.ITenantContext tenant) => new(sender.Object, policy.Object, null!, null!, tenant) { ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([], "test")) } } };
        var controller = Controller(tenantA);
        var read = await controller.GetWorkWeek(default);
        Assert.Equal([1, 2, 3, 4, 5], Assert.IsType<ApiResponse<CompanyWorkWeekDto>>(Assert.IsType<OkObjectResult>(read).Value).Data!.WorkingDays);
        Assert.IsType<ForbidResult>(await controller.PatchOrganization(new(null, [1]), null, default));
        policy.Setup(p => p.CanManageSettings(It.IsAny<ClaimsPrincipal>())).Returns(true);
        Assert.IsType<ForbidResult>(await controller.Patch(new(null, null, null, null, WorkingDays: [1]), null, default));
        Assert.IsType<ForbidResult>(await Controller(TestTenantContext.Unresolved()).GetWorkWeek(default));
        var own = await new TenantSettingsReadService(dbA).GetCurrentAsync(default);
        Assert.Equal([1, 2, 3, 4, 5], own.WorkingDays);
    }
}
