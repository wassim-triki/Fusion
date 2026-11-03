using System.Reflection;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Models.WorkforceAccounts;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;

namespace EY.HRPlatform.Identity.Tests.Controllers;

/// <summary>
/// The workforce-account boundary is HMAC-internal, not JWT-authorized. A browser must
/// have no way to reach it and forge Employee facts, so the guard is the internal
/// signature checked at runtime — not the ambient authorization pipeline. These tests
/// pin that posture and prove an unsigned caller is rejected.
/// </summary>
public class WorkforceAccountsControllerAuthorizationTests
{
    [Fact]
    public void Controller_is_internal_signature_gated_not_jwt_authorized()
    {
        var type = typeof(WorkforceAccountsController);

        // No JWT authorization attribute: the ambient policy is deliberately not the
        // guard here. The runtime HMAC check is (proven below).
        Assert.Null(type.GetCustomAttribute<AuthorizeAttribute>(inherit: false));
        Assert.NotNull(type.GetCustomAttribute<AllowAnonymousAttribute>(inherit: false));

        // And it is off the public browser surface, under the internal route prefix.
        var route = type.GetCustomAttribute<RouteAttribute>(inherit: false);
        Assert.NotNull(route);
        Assert.StartsWith("internal/", route!.Template);
        Assert.DoesNotContain("api/corehr", route.Template);
    }

    [Fact]
    public async Task An_unsigned_caller_is_rejected()
    {
        // A real authorizer, and a request that carries no internal signature — exactly
        // what a browser hitting the boundary directly would send.
        var authorizer = new InternalServiceRequestAuthorizer(
            new MemoryCache(new MemoryCacheOptions()),
            new InternalServiceAuthenticationOptions
            {
                AllowedCallers = ["corehr"],
                Keys = { ["dev-1"] = "unit-test-internal-hmac-key-at-least-32-characters" },
            });

        var controller = new WorkforceAccountsController(
            dbContext: null!,
            accessProfileService: null!,
            configuration: null!,
            continuity: null!,
            internalAuthorizer: authorizer,
            workforceInvitationEmailSender: null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        controller.HttpContext.Request.Headers["X-Tenant-Id"] = Guid.NewGuid().ToString();

        var result = await controller.GetStatuses(
            new WorkforceAccountStatusesRequest { Subjects = [] }, CancellationToken.None);

        Assert.IsType<UnauthorizedResult>(result.Result);

        var withdrawal = await controller.WithdrawInvite(Guid.NewGuid(), CancellationToken.None);
        Assert.IsType<UnauthorizedResult>(withdrawal.Result);
    }

    [Theory]
    [InlineData(nameof(WorkforceAccountsController.GetSummary))]
    [InlineData(nameof(WorkforceAccountsController.GetStatuses))]
    [InlineData(nameof(WorkforceAccountsController.BulkProvision))]
    [InlineData(nameof(WorkforceAccountsController.ProvisionInvite))]
    [InlineData(nameof(WorkforceAccountsController.ResendInvite))]
    [InlineData(nameof(WorkforceAccountsController.Reactivate))]
    [InlineData(nameof(WorkforceAccountsController.Deactivate))]
    public void Endpoints_do_not_declare_method_role_attributes(string methodName)
    {
        var method = typeof(WorkforceAccountsController).GetMethod(methodName)
            ?? throw new InvalidOperationException($"Could not find WorkforceAccountsController.{methodName}.");

        var authorize = method.GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.True(authorize is null || string.IsNullOrWhiteSpace(authorize.Roles));
    }
}
