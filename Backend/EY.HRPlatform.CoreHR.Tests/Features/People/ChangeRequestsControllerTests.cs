using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>Changes and approvals refuse at the endpoint, before anything is read, whoever lacks the role key (B-179).</summary>
public sealed class ChangeRequestsControllerTests
{
    private static readonly (string, string) Manager = (CorePermissions.TeamView, PermissionScopes.DirectReports);
    private static readonly (string, string) Proposer = (CorePermissions.ChangePropose, PermissionScopes.DirectReports);
    private static readonly (string, string) Employee = (CorePermissions.EmployeeView, PermissionScopes.Self);
    private static readonly ProposeChangeRequest Body = new(new JobChangeRequest(DateTime.UtcNow.Date.AddDays(5), JobId: Guid.NewGuid()));

    [Fact]
    public async Task Without_propose_or_people_rights_nobody_drafts_or_proposes()
    {
        foreach (var caller in new[] { Caller(Employee), Caller(Manager), Caller() })
        {
            var controller = Controller(caller);
            Assert.IsType<ForbidResult>(await controller.Propose("CDG-1", Body, default));
            Assert.IsType<ForbidResult>(await controller.Draft("CDG-1", new DraftChangeRequest("Promote her"), default));
        }
    }

    [Fact]
    public async Task Only_approvers_approve_or_decline_and_only_settings_managers_change_which_types_wait()
    {
        foreach (var caller in new[] { Caller(Employee), Caller(Manager, Proposer), Caller((CorePermissions.EmployeeManage, PermissionScopes.Tenant)) })
        {
            var controller = Controller(caller);
            Assert.IsType<ForbidResult>(await controller.Approve(Guid.NewGuid(), default));
            Assert.IsType<ForbidResult>(await controller.Decline(Guid.NewGuid(), new DeclineChangeRequestBody("No"), default));
            Assert.IsType<ForbidResult>(await controller.UpdateApprovals(new UpdateChangeApprovalsRequest(["job"]), default));
        }
        Assert.True(new CoreAccessPolicyService().CanApproveChanges(Caller((CorePermissions.ChangeApprove, PermissionScopes.Tenant))));
    }

    private static ClaimsPrincipal Caller(params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim>
        {
            new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()),
            new(CustomClaimTypes.EmployeeId, Guid.NewGuid().ToString()),
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
        };
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    // The services are never reached: each call here is refused first.
    private static ChangeRequestsController Controller(ClaimsPrincipal caller)
        => new(null!, null!, new CoreAccessPolicyService(), null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        };
}
