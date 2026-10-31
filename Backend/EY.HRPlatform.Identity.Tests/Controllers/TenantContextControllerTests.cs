using Microsoft.AspNetCore.Http;
using EY.HRPlatform.SharedKernel.Auth;
using System.Security.Claims;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.TenantContext.Dtos;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Identity.Tests.Controllers;

/// <summary>fusion-navigation: any signed-in member reads their own tenant's name for the sidebar's brand line.</summary>
public class TenantContextControllerTests
{
    private static async Task<(TenantContextController Controller, Guid Own)> ArrangeAsync()
    {
        var db = Guid.NewGuid().ToString();
        var own = Tenant.Create("Carthage Digital Group");
        await using (var seed = TestDbContextFactory.CreateWithoutTenant(db))
        {
            seed.Tenants.Add(own);
            seed.Tenants.Add(Tenant.Create("Another Company"));
            await seed.SaveChangesAsync();
        }
        var tenant = TestTenantContext.WithTenant(own.Id);
        return (new TenantContextController(tenant, TestDbContextFactory.Create(tenant, db)), own.Id);
    }

    [Fact]
    public async Task The_summary_names_the_callers_own_tenant()
    {
        var (controller, own) = await ArrangeAsync();
        var body = Assert.IsType<ApiResponse<TenantSummaryDto>>(
            Assert.IsType<OkObjectResult>((await controller.GetTenantSummary(CancellationToken.None)).Result).Value);
        Assert.Equal(own, body.Data!.TenantId);
        Assert.Equal("Carthage Digital Group", body.Data.Name);
    }

    [Fact]
    public void Any_signed_in_member_may_read_the_summary_while_organization_status_stays_administrative()
    {
        var type = typeof(TenantContextController);
        Assert.All(type.GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>(),
            attribute => Assert.Null(attribute.Roles));
        Assert.Empty(type.GetMethod(nameof(TenantContextController.GetTenantSummary))!
            .GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Where(a => a.Roles is not null));
        // Token roles retired (B-178): organization status reads the roles model instead (see below).
        Assert.Empty(type.GetMethod(nameof(TenantContextController.GetOrganizationStatus))!
            .GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Where(a => a.Roles is not null));
        // The tenant is never a request value: the summary takes no parameter that could name another.
        Assert.Empty(type.GetMethod(nameof(TenantContextController.GetTenantSummary))!.GetParameters()
            .Where(p => p.ParameterType != typeof(CancellationToken)));
    }

    [Fact]
    public async Task Organization_status_stays_with_the_people_who_run_the_company()
    {
        var (controller, own) = await ArrangeAsync();
        controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(CustomClaimTypes.TenantId, own.ToString())], "test")),
        } };
        var member = await controller.GetOrganizationStatus(CancellationToken.None);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(member.Result).StatusCode);

        controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(CustomClaimTypes.TenantId, own.ToString()),
            new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(CorePermissions.OverviewView, PermissionScopes.Tenant)),
        ], "test"));
        Assert.IsType<OkObjectResult>((await controller.GetOrganizationStatus(CancellationToken.None)).Result);
    }
}
