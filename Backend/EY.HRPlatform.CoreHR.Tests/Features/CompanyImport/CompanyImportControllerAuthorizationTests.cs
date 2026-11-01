using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Xunit;

namespace EY.HRPlatform.CoreHR.Tests.Features.CompanyImport;

/// <summary>Bringing a company in makes units and people: the import needs both permissions, or nothing answers.</summary>
public sealed class CompanyImportControllerAuthorizationTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task Without_both_permissions_every_call_is_forbidden(bool organization, bool people)
    {
        var access = new Mock<ICoreAccessPolicyService>();
        access.Setup(policy => policy.CanManageOrganization(It.IsAny<ClaimsPrincipal>())).Returns(organization);
        access.Setup(policy => policy.CanImportEmployees(It.IsAny<ClaimsPrincipal>())).Returns(people);
        var controller = new CompanyImportController(null!, access.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity("test")) } },
        };
        var id = Guid.NewGuid();

        Assert.IsType<ForbidResult>((await controller.Active(default)).Result);
        Assert.IsType<ForbidResult>((await controller.Earlier(default)).Result);
        Assert.IsType<ForbidResult>(controller.Template());
        Assert.IsType<ForbidResult>(await controller.Get(id, default));
        Assert.IsType<ForbidResult>(await controller.Start([], null, default));
        Assert.IsType<ForbidResult>(await controller.Answer(id, "\"1\"", new("k", "v"), default));
        Assert.IsType<ForbidResult>(await controller.Say(id, new("Rim reports to Nour"), default));
        Assert.IsType<ForbidResult>(await controller.BringIn(id, "\"1\"", new("f"), default));
        Assert.IsType<ForbidResult>(await controller.Discard(id, "\"1\"", default));
    }
}
