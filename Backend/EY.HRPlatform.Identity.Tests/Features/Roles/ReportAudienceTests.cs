using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;

namespace EY.HRPlatform.Identity.Tests.Features.Roles;

public sealed class ReportAudienceTests
{
    private sealed class Authorizer : IInternalServiceRequestAuthorizer
    {
        public bool Allowed { get; set; }
        public Task<bool> AuthorizeAsync(HttpRequest request, CancellationToken cancellationToken) => Task.FromResult(Allowed);
    }
    [Theory]
    [InlineData(RoleLevels.See, RoleReaches.Team, PermissionScopes.DirectReports)]
    [InlineData(RoleLevels.See, RoleReaches.Everyone, PermissionScopes.Tenant)]
    [InlineData(RoleLevels.Build, RoleReaches.Team, PermissionScopes.DirectReports)]
    [InlineData(RoleLevels.Build, RoleReaches.Everyone, PermissionScopes.Tenant)]
    public void Reports_round_trip_their_level_and_reach(string level, string reach, string scope)
    {
        var grants = RoleAreas.Compose([new("reports", level, reach)], []);
        Assert.Contains(grants, g => g.PermissionKey == CorePermissions.OverviewView && g.Scope == scope);
        Assert.Equal(level == RoleLevels.Build, grants.Any(g => g.PermissionKey == CorePermissions.ReportsBuild));
        Assert.Equal(new RoleAreaCell("reports", level, reach), RoleAreas.Read(grants).Single(c => c.AreaId == "reports"));
    }

    [Fact]
    public async Task Report_audiences_require_a_signature_and_never_return_another_tenants_roles()
    {
        await using var db = TestDbContextFactory.CreateWithoutTenant(Guid.NewGuid().ToString());
        var tenant = Guid.NewGuid(); var other = Guid.NewGuid(); var user = Guid.NewGuid();
        var own = AccessProfile.Create(tenant, "Managers", null, AccessProfileTypes.Custom, false);
        var foreign = AccessProfile.Create(other, "Foreign", null, AccessProfileTypes.Custom, false);
        db.AccessProfiles.AddRange(own, foreign);
        db.UserAccessProfiles.Add(UserAccessProfile.Create(tenant, user, own.Id, Guid.NewGuid()));
        await db.SaveChangesAsync();
        var authorizer = new Authorizer();
        var controller = new InternalRolesController(authorizer, new RoleRecomputeQueue(), db)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        controller.Request.Headers["X-Tenant-Id"] = tenant.ToString();
        var request = new InternalRolesController.ReportRoleRequest(tenant, user);
        Assert.IsType<UnauthorizedResult>(await controller.ReportAudience(request, default));
        authorizer.Allowed = true;
        Assert.IsType<BadRequestResult>(await controller.ReportAudience(request with { TenantId = other }, default));
        var ok = Assert.IsType<OkObjectResult>(await controller.ReportAudience(request, default));
        var json = JsonSerializer.Serialize(ok.Value);
        Assert.Contains("Managers", json); Assert.Contains("\"Held\":true", json); Assert.DoesNotContain("Foreign", json);
        var notHeld = Assert.IsType<OkObjectResult>(await controller.ReportAudience(request with { UserId = Guid.NewGuid() }, default));
        Assert.DoesNotContain("\"Held\":true", JsonSerializer.Serialize(notHeld.Value));
    }
}
