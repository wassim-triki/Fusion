using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.Search;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.Search;

/// <summary>B-211: the top bar's Core HR read needs the directory's right and takes the viewer from the token.</summary>
public sealed class SearchControllerTests
{
    private static ClaimsPrincipal Caller(Guid? employeeId, params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim> { new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()), new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()) };
        if (employeeId is { } employee) claims.Add(new(CustomClaimTypes.EmployeeId, employee.ToString()));
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private static (SearchController Controller, Mock<ISender> Sender) Controller(ClaimsPrincipal caller, string audience = OrgChartAudiences.Everyone)
    {
        var settings = new Mock<ITenantSettingsReadService>();
        settings.Setup(s => s.GetCurrentAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TenantSettingsDto { OrgChart = new OrgChartSettings(audience) });
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<CoreSearchQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new CoreSearchDto([], 0, [], [], [], [])));
        return (new SearchController(sender.Object, new CoreAccessPolicyService(), settings.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        }, sender);
    }

    [Fact]
    public async Task Search_is_for_people_who_may_browse_the_directory_and_jobs_only_for_HR()
    {
        var aicha = Guid.NewGuid();
        var (employee, employeeSender) = Controller(Caller(aicha, (CorePermissions.EmployeeView, PermissionScopes.Self)));
        Assert.IsType<OkObjectResult>(await employee.Search("mariam", default));
        employeeSender.Verify(s => s.Send(It.Is<CoreSearchQuery>(q => q.ViewerEmployeeId == aicha && !q.Hr && q.Text == "mariam"), It.IsAny<CancellationToken>()), Times.Once);

        var (hr, hrSender) = Controller(Caller(Guid.NewGuid(), (CorePermissions.EmployeeView, PermissionScopes.Tenant)));
        Assert.IsType<OkObjectResult>(await hr.Search(null, default));
        hrSender.Verify(s => s.Send(It.Is<CoreSearchQuery>(q => q.Hr && q.Text == ""), It.IsAny<CancellationToken>()), Times.Once);

        // Access administration alone doesn't read people.
        var (nobody, nobodySender) = Controller(Caller(null, (CorePermissions.AccessManage, PermissionScopes.Tenant)));
        Assert.IsType<ForbidResult>(await nobody.Search("a", default));
        nobodySender.VerifyNoOtherCalls();
    }

    private static async Task<bool> OffersChartAsync(string audience, params (string Key, string Scope)[] grants)
    {
        var (controller, _) = Controller(Caller(Guid.NewGuid(), grants), audience);
        var ok = Assert.IsType<OkObjectResult>(await controller.Search("a", default));
        return Assert.IsType<ApiResponse<CoreSearchDto>>(ok.Value).Data!.OrgChart;
    }

    [Fact]
    public async Task Show_on_org_chart_is_offered_only_where_the_chart_would_open()
    {
        (string, string) self = (CorePermissions.EmployeeView, PermissionScopes.Self);
        (string, string) chart = (CorePermissions.OrgChartView, PermissionScopes.Tenant);
        (string, string) team = (CorePermissions.TeamView, PermissionScopes.DirectReports);
        Assert.True(await OffersChartAsync(OrgChartAudiences.Everyone, self, chart));
        Assert.False(await OffersChartAsync(OrgChartAudiences.Everyone, self));
        Assert.False(await OffersChartAsync(OrgChartAudiences.ManagersAndHr, self, chart));
        Assert.True(await OffersChartAsync(OrgChartAudiences.ManagersAndHr, self, chart, team));
    }
}
