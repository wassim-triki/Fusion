using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>Who may list, export, browse and invite (B-182), decided at the endpoint before anything is read or sent.</summary>
public sealed class PeopleDirectoryInvitationsControllerTests
{
    private static readonly (string, string) Hr = (CorePermissions.EmployeeView, PermissionScopes.Tenant);
    private static readonly (string, string) AccessView = (CorePermissions.AccessView, PermissionScopes.Tenant);
    private static readonly (string, string) AccessManage = (CorePermissions.AccessManage, PermissionScopes.Tenant);
    private static readonly (string, string) Manager = (CorePermissions.TeamView, PermissionScopes.DirectReports);
    private static readonly (string, string) Self = (CorePermissions.EmployeeView, PermissionScopes.Self);

    [Fact]
    public async Task Sign_in_reaches_the_list_only_for_people_who_may_see_access()
    {
        var (hr, hrSender) = Employees(Caller(Hr));
        Assert.IsType<OkObjectResult>(await hr.GetPeople(null, null, null, view: PeopleView.NotSignedIn));
        hrSender.Verify(s => s.Send(It.Is<PeopleQuery>(q => !q.IncludeSignIn && q.View == PeopleView.NotSignedIn), It.IsAny<CancellationToken>()), Times.Once);

        var (admin, adminSender) = Employees(Caller(Hr, AccessView));
        Assert.IsType<OkObjectResult>(await admin.GetPeople(null, null, null));
        adminSender.Verify(s => s.Send(It.Is<PeopleQuery>(q => q.IncludeSignIn), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Only_people_who_read_everyone_list_or_export_but_any_worker_browses_the_directory()
    {
        foreach (var caller in new[] { Caller(Self), Caller(Manager), Caller(AccessManage) })
        {
            var (controller, sender) = Employees(caller);
            Assert.IsType<ForbidResult>(await controller.GetPeople(null, null, null));
            Assert.IsType<ForbidResult>(await controller.ExportPeople(new PeopleExport(null!)));
            sender.VerifyNoOtherCalls();
        }

        var self = Guid.NewGuid();
        var (colleague, colleagueSender) = Employees(Caller(self, Self));
        Assert.IsType<OkObjectResult>(await colleague.GetPeopleDirectory(default));
        colleagueSender.Verify(s => s.Send(It.Is<PeopleDirectoryQuery>(q => q.ViewerEmployeeId == self), It.IsAny<CancellationToken>()), Times.Once);

        var (nobody, nobodySender) = Employees(Caller());
        Assert.IsType<ForbidResult>(await nobody.GetPeopleDirectory(default));
        nobodySender.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Invitations_need_access_rights_to_read_and_to_send_or_cancel()
    {
        foreach (var caller in new[] { Caller(Hr), Caller(Self), Caller(Manager) })
        {
            var controller = Invitations(caller);
            Assert.IsType<ForbidResult>(await controller.GetPlan(default));
            Assert.IsType<ForbidResult>(await controller.Send(new SendInvitationsRequest(InvitationAudience.NotSignedIn, null, null), default));
            Assert.IsType<ForbidResult>(await controller.Cancel(Guid.NewGuid(), default));
        }

        var viewer = Invitations(Caller(AccessView));
        Assert.IsType<ForbidResult>(await viewer.Send(new SendInvitationsRequest(InvitationAudience.NotSignedIn, null, null), default));
        Assert.IsType<ForbidResult>(await viewer.Cancel(Guid.NewGuid(), default));

        var manager = Invitations(Caller(AccessManage));
        Assert.IsType<BadRequestObjectResult>(await manager.Send(new SendInvitationsRequest((InvitationAudience)42, null, null), default));
        // Chosen people the caller can't see resolve to nobody, so nothing is sent.
        Assert.IsType<BadRequestObjectResult>(await manager.Send(new SendInvitationsRequest(InvitationAudience.Chosen, [Guid.NewGuid()], null), default));
    }

    private static ClaimsPrincipal Caller(params (string Key, string Scope)[] grants) => Caller(Guid.NewGuid(), grants);

    private static ClaimsPrincipal Caller(Guid employeeId, params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim>
        {
            new(CustomClaimTypes.TenantId, Guid.NewGuid().ToString()),
            new(CustomClaimTypes.EmployeeId, employeeId.ToString()),
            new(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
        };
        claims.AddRange(grants.Select(grant => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(grant.Key, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private static (EmployeesController Controller, Mock<ISender> Sender) Employees(ClaimsPrincipal caller)
    {
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<PeopleQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PeoplePageDto([], 0, 1, 25, 0)));
        sender.Setup(s => s.Send(It.IsAny<PeopleDirectoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PeopleDirectoryDto(null, [])));
        var controller = new EmployeesController(sender.Object, new CoreAccessPolicyService())
        {
            ControllerContext = new ControllerContext { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = caller } },
        };
        return (controller, sender);
    }

    private static PeopleInvitationsController Invitations(ClaimsPrincipal caller)
    {
        var workforce = new Mock<IWorkforceContractService>();
        workforce.Setup(w => w.ResolveEmployeesAsync(It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<ClaimsPrincipal>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        // Every collaborator is strict: a call that got past the check would throw.
        var invitations = new PeopleInvitations(null!, new TestTenantContext(Guid.NewGuid()), Mock.Of<ISender>(MockBehavior.Strict), workforce.Object,
            new WorkforceInvitationSender(Mock.Of<IWorkforceAccessIdentityClient>(MockBehavior.Strict), Mock.Of<IWorkforceBulkProvisioner>(MockBehavior.Strict)),
            Mock.Of<IWorkforceAccountStatusReader>(MockBehavior.Strict), Mock.Of<IWorkforceAccessIdentityClient>(MockBehavior.Strict),
            Mock.Of<ITenantSettingsReadService>(MockBehavior.Strict));
        return new PeopleInvitationsController(invitations, workforce.Object, new CoreAccessPolicyService())
        {
            ControllerContext = new ControllerContext { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = caller } },
        };
    }
}
