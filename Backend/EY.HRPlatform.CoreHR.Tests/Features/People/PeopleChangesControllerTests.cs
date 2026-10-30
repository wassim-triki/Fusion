using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.People.Changes;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.People;

/// <summary>Who may make, cancel and read people changes, decided at the endpoint before anything is sent.</summary>
public sealed class PeopleChangesControllerTests
{
    private static readonly (string, string) Hr = (CorePermissions.EmployeeView, PermissionScopes.Tenant);
    private static readonly (string, string) PeopleAdmin = (CorePermissions.EmployeeManage, PermissionScopes.Tenant);
    private static readonly (string, string) ReportingAdmin = (CorePermissions.ReportingManage, PermissionScopes.Tenant);
    private static readonly (string, string) Manager = (CorePermissions.TeamView, PermissionScopes.DirectReports);
    private static readonly (string, string) Self = (CorePermissions.EmployeeView, PermissionScopes.Self);
    private static readonly JobChangeRequest Job = new(DateTime.UtcNow.Date.AddDays(3), ManagerEmployeeId: Guid.NewGuid());

    [Fact]
    public async Task A_reporting_admin_may_change_lines_but_not_end_or_start_employment()
    {
        var (controller, sender) = Controller(Caller(Guid.NewGuid(), ReportingAdmin));

        Assert.IsType<OkObjectResult>(await controller.ChangeJob("CDG-1", Job, default));
        sender.Verify(s => s.Send(It.Is<JobChangeCommand>(c => !c.CanManageEmployees), It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsType<NoContentResult>(await controller.CancelChange(Guid.NewGuid(), default));
        sender.Verify(s => s.Send(It.Is<CancelWorkforceChangeCommand>(c => !c.CanManageEmployees), It.IsAny<CancellationToken>()), Times.Once);

        Assert.IsType<ForbidResult>(await controller.EndEmploymentChange("CDG-1", new EndEmploymentChangeRequest(DateTime.UtcNow), default));
        Assert.IsType<ForbidResult>(await controller.PreviewEndEmploymentChange("CDG-1", DateOnly.FromDateTime(DateTime.UtcNow), default));
        Assert.IsType<ForbidResult>(await controller.JoinChange("CDG-1", new JoinChangeRequest(DateTime.UtcNow, Guid.NewGuid(), Guid.NewGuid()), default));

        // B-137: the manager picker answers them too.
        Assert.IsType<OkObjectResult>(await controller.GetManagerOptions(DateTime.UtcNow, null, null, Guid.NewGuid(), 30, default));
    }

    [Fact]
    public async Task A_refusal_for_a_job_fact_comes_back_as_forbidden()
    {
        var (controller, sender) = Controller(Caller(Guid.NewGuid(), ReportingAdmin));
        sender.Setup(s => s.Send(It.IsAny<JobChangeCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<WorkforceChangeDto>(new Error(WorkforceChangeService.ForbiddenCode, "No.")));
        var result = Assert.IsType<ObjectResult>(await controller.ChangeJob("CDG-1", Job with { JobId = Guid.NewGuid() }, default));
        Assert.Equal(StatusCodes.Status403Forbidden, result.StatusCode);
    }

    [Fact]
    public async Task Without_people_or_reporting_rights_nothing_can_be_changed()
    {
        foreach (var caller in new[] { Caller(Guid.NewGuid(), Self), Caller(Guid.NewGuid(), Manager), Caller(Guid.NewGuid(), Hr) })
        {
            var (controller, sender) = Controller(caller);
            Assert.IsType<ForbidResult>(await controller.ChangeJob("CDG-1", Job, default));
            Assert.IsType<ForbidResult>(await controller.CancelChange(Guid.NewGuid(), default));
            Assert.IsType<ForbidResult>(await controller.EditChange(Guid.NewGuid(), new EditChangeRequest(Job: Job), default));
            Assert.IsType<ForbidResult>(await controller.EndEmploymentChange("CDG-1", new EndEmploymentChangeRequest(DateTime.UtcNow), default));
            Assert.IsType<ForbidResult>(await controller.GetManagerOptions(DateTime.UtcNow, null, null, null, 30, default));
            sender.VerifyNoOtherCalls();
        }
    }

    [Fact]
    public async Task People_admins_make_every_kind_of_change()
    {
        var (controller, sender) = Controller(Caller(Guid.NewGuid(), PeopleAdmin));
        Assert.IsType<OkObjectResult>(await controller.ChangeJob("CDG-1", Job, default));
        sender.Verify(s => s.Send(It.Is<JobChangeCommand>(c => c.CanManageEmployees), It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsType<OkObjectResult>(await controller.EndEmploymentChange("CDG-1", new EndEmploymentChangeRequest(DateTime.UtcNow), default));
        Assert.IsType<OkObjectResult>(await controller.JoinChange("CDG-1", new JoinChangeRequest(DateTime.UtcNow, Guid.NewGuid(), Guid.NewGuid()), default));
    }

    [Fact]
    public async Task Managers_read_coming_changes_and_history_for_their_branch_only()
    {
        var managerId = Guid.NewGuid();
        var (manager, managerSender) = Controller(Caller(managerId, Manager));
        Assert.IsType<OkObjectResult>(await manager.GetUpcomingChanges(default));
        managerSender.Verify(s => s.Send(It.Is<UpcomingWorkforceChangesQuery>(q => q.BranchOfEmployeeId == managerId), It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsType<OkObjectResult>(await manager.GetPeopleTimeline("CDG-1", default));
        managerSender.Verify(s => s.Send(It.Is<PeopleTimelineQuery>(q => q.BranchOfEmployeeId == managerId), It.IsAny<CancellationToken>()), Times.Once);

        var (hr, hrSender) = Controller(Caller(Guid.NewGuid(), Hr));
        Assert.IsType<OkObjectResult>(await hr.GetUpcomingChanges(default));
        hrSender.Verify(s => s.Send(It.Is<UpcomingWorkforceChangesQuery>(q => q.BranchOfEmployeeId == null), It.IsAny<CancellationToken>()), Times.Once);
        Assert.IsType<OkObjectResult>(await hr.GetPeopleTimeline("CDG-1", default));
        hrSender.Verify(s => s.Send(It.Is<PeopleTimelineQuery>(q => q.BranchOfEmployeeId == null), It.IsAny<CancellationToken>()), Times.Once);

        var (colleague, colleagueSender) = Controller(Caller(Guid.NewGuid(), Self));
        Assert.IsType<ForbidResult>(await colleague.GetUpcomingChanges(default));
        Assert.IsType<ForbidResult>(await colleague.GetPeopleTimeline("CDG-1", default));
        colleagueSender.VerifyNoOtherCalls();
    }

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

    private static (EmployeesController Controller, Mock<ISender> Sender) Controller(ClaimsPrincipal caller)
    {
        var sender = new Mock<ISender>();
        var change = Result.Success(new WorkforceChangeDto(
            Guid.NewGuid(), EY.HRPlatform.CoreHR.Domain.Entities.WorkforceChangeKind.JobChange, DateOnly.FromDateTime(DateTime.UtcNow),
            EY.HRPlatform.CoreHR.Domain.Entities.WorkforceChangeStatus.Scheduled, true, true, new ChangePersonRef(Guid.NewGuid(), "K", "N"),
            null, DateTime.UtcNow, null, new WorkforceChangeDetails()));
        sender.Setup(s => s.Send(It.IsAny<JobChangeCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(change);
        sender.Setup(s => s.Send(It.IsAny<EndEmploymentChangeCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(change);
        sender.Setup(s => s.Send(It.IsAny<JoinChangeCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(change);
        sender.Setup(s => s.Send(It.IsAny<CancelWorkforceChangeCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Success(true));
        sender.Setup(s => s.Send(It.IsAny<UpcomingWorkforceChangesQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<WorkforceChangeDto>>([]));
        sender.Setup(s => s.Send(It.IsAny<PeopleTimelineQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new PeopleTimelineDto([], [])));
        sender.Setup(s => s.Send(It.IsAny<ManagerOptionsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<ManagerOptionDto>>([]));
        return (new EmployeesController(sender.Object, new CoreAccessPolicyService())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        }, sender);
    }
}
