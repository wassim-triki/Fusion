using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.ChangeEmployeeManager;
using EY.HRPlatform.CoreHR.Features.Employees.Commands.RehireEmployee;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Models.Requests;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

/// <summary>
/// Deny-by-default authorization and tenant-scoping coverage for the terminate, rehire, and
/// change-manager lifecycle actions (Section 5.5).
/// </summary>
public class EmployeesControllerLifecycleAuthorizationTests
{
    private static readonly DateTime EffectiveDate = new(2025, 6, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Rehire_WithoutManageEmployees_ReturnsForbid()
    {
        var sender = new RecordingSender();
        var controller = CreateController(sender, new StubAccessPolicy(canManageEmployees: false, canManageReporting: true));

        var result = await controller.Rehire(
            Guid.NewGuid(),
            new RehireEmployeeRequest(EffectiveDate, Guid.NewGuid(), Guid.NewGuid()),
            "\"3\"",
            CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
        Assert.Null(sender.LastRequest);
    }

    [Fact]
    public async Task Rehire_WithManageEmployees_SendsCommand()
    {
        var sender = new RecordingSender();
        var controller = CreateController(sender, new StubAccessPolicy(canManageEmployees: true, canManageReporting: false));
        var employeeId = Guid.NewGuid();

        var result = await controller.Rehire(
            employeeId,
            new RehireEmployeeRequest(EffectiveDate, Guid.NewGuid(), Guid.NewGuid()),
            "\"3\"",
            CancellationToken.None);

        Assert.IsNotType<ForbidResult>(result);
        var command = Assert.IsType<RehireEmployeeCommand>(sender.LastRequest);
        Assert.Equal(employeeId, command.EmployeeId);
        Assert.Equal((uint)3, command.ExpectedVersion);
    }

    [Fact]
    public async Task ChangeManager_WithoutAnyManagePermission_ReturnsForbid()
    {
        var sender = new RecordingSender();
        var controller = CreateController(sender, new StubAccessPolicy(canManageEmployees: false, canManageReporting: false));

        var result = await controller.ChangeManager(
            Guid.NewGuid(),
            new ChangeEmployeeManagerRequest(Guid.NewGuid(), EffectiveDate),
            "\"3\"",
            CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
        Assert.Null(sender.LastRequest);
    }

    [Fact]
    public async Task ChangeManager_WithReportingManagePermission_SendsCommand()
    {
        var sender = new RecordingSender();
        var controller = CreateController(sender, new StubAccessPolicy(canManageEmployees: false, canManageReporting: true));
        var employeeId = Guid.NewGuid();
        var managerId = Guid.NewGuid();

        var result = await controller.ChangeManager(
            employeeId,
            new ChangeEmployeeManagerRequest(managerId, EffectiveDate),
            "\"3\"",
            CancellationToken.None);

        Assert.IsNotType<ForbidResult>(result);
        var command = Assert.IsType<ChangeEmployeeManagerCommand>(sender.LastRequest);
        Assert.Equal(employeeId, command.EmployeeId);
        Assert.Equal(managerId, command.ManagerId);
    }

    [Fact]
    public async Task DottedLines_WithoutAnyManagePermission_ReturnForbid()
    {
        var sender = new RecordingSender();
        var controller = CreateController(sender, new StubAccessPolicy(canManageEmployees: false, canManageReporting: false));
        var request = new DottedLineRequest(EffectiveDate, Guid.NewGuid());

        Assert.IsType<ForbidResult>(await controller.AddDottedLine("CDG-001", request, CancellationToken.None));
        Assert.IsType<ForbidResult>(await controller.EndDottedLine("CDG-001", request, CancellationToken.None));
        Assert.Null(sender.LastRequest);
    }

    [Fact]
    public async Task DottedLines_WithReportingManagePermission_SendCommands()
    {
        var sender = new RecordingSender();
        var controller = CreateController(sender, new StubAccessPolicy(canManageEmployees: false, canManageReporting: true));
        var managerId = Guid.NewGuid();
        var request = new DottedLineRequest(EffectiveDate, managerId);

        Assert.IsNotType<ForbidResult>(await controller.AddDottedLine("CDG-001", request, CancellationToken.None));
        var add = Assert.IsType<DottedLineCommand>(sender.LastRequest);
        Assert.Equal(("CDG-001", managerId, false), (add.EmployeeKey, add.ManagerEmployeeId, add.End));

        Assert.IsNotType<ForbidResult>(await controller.EndDottedLine("CDG-001", request, CancellationToken.None));
        Assert.True(Assert.IsType<DottedLineCommand>(sender.LastRequest).End);
    }

    [Fact]
    public async Task Rehire_ForEmployeeInAnotherTenant_IsNotFound()
    {
        var (dbName, employee, version) = await SeedTerminatedEmployeeAsync();
        var otherTenant = TestTenantContext.WithTenant(Guid.NewGuid());

        await using var context = TestDbContextFactory.Create(otherTenant, dbName);
        var handler = new RehireEmployeeCommandHandler(
            context,
            otherTenant,
            new WorkforceMutationService(context, otherTenant, new WorkforceCanonicalResolver(context)),
            new EmployeeDetailsReadModelService(context, new WorkforceCanonicalResolver(context), new StubTenantSettingsReader()));

        await Assert.ThrowsAsync<EntityNotFoundException>(() => handler.Handle(
            new RehireEmployeeCommand(employee.Id, version, EffectiveDate, Guid.NewGuid(), Guid.NewGuid()),
            CancellationToken.None));
    }

    [Fact]
    public async Task ChangeManager_ForEmployeeInAnotherTenant_IsNotFound()
    {
        var (dbName, employee, version) = await SeedTerminatedEmployeeAsync();
        var otherTenant = TestTenantContext.WithTenant(Guid.NewGuid());

        await using var context = TestDbContextFactory.Create(otherTenant, dbName);
        var handler = new ChangeEmployeeManagerCommandHandler(
            context,
            otherTenant,
            new WorkforceMutationService(context, otherTenant, new WorkforceCanonicalResolver(context)),
            new EmployeeDetailsReadModelService(context, new WorkforceCanonicalResolver(context), new StubTenantSettingsReader()));

        await Assert.ThrowsAsync<EntityNotFoundException>(() => handler.Handle(
            new ChangeEmployeeManagerCommand(employee.Id, version, Guid.NewGuid(), EffectiveDate),
            CancellationToken.None));
    }

    private static async Task<(string DbName, Employee Employee, uint Version)> SeedTerminatedEmployeeAsync()
    {
        var tenantId = Guid.NewGuid();
        var dbName = Guid.NewGuid().ToString();
        var hire = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        await using var seed = TestDbContextFactory.CreateWithoutTenant(dbName);
        var employee = Employee.Create(tenantId, "Jane", "Roe", "jane@example.com", hire, employeeNumber: TestEmployeeNumbers.Next());
        seed.Employees.Add(employee);
        await seed.SaveChangesAsync();

        return (dbName, employee, employee.Version);
    }

    private static EmployeesController CreateController(ISender sender, ICoreAccessPolicyService accessPolicy)
        => new(sender, accessPolicy)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())
                    ],
                    "TestAuth"))
                }
            }
        };

    private sealed class StubTenantSettingsReader : EY.HRPlatform.CoreHR.Features.TenantSettings.Services.ITenantSettingsReadService
    {
        public Task<EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos.TenantSettingsDto> GetCurrentAsync(CancellationToken cancellationToken)
            => Task.FromResult(EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos.TenantSettingsDto.Defaults);
    }

    private sealed class StubAccessPolicy(bool canManageEmployees, bool canManageReporting) : ICoreAccessPolicyService
    {
        public bool CanViewOverview(ClaimsPrincipal user) => true;
        public bool CanViewSetup(ClaimsPrincipal user) => true;
        public bool CanManageSetup(ClaimsPrincipal user) => true;
        public bool CanPublishStructure(ClaimsPrincipal user) => true;
        public bool CanViewStructure(ClaimsPrincipal user) => true;
        public bool CanManageStructure(ClaimsPrincipal user) => true;
        public bool CanViewSettings(ClaimsPrincipal user) => true;
        public bool CanManageSettings(ClaimsPrincipal user) => true;
        public bool CanViewOrganizationSettings(ClaimsPrincipal user) => true;
        public bool CanManageOrganizationSettings(ClaimsPrincipal user) => true;
        public bool CanViewPeopleDataSettings(ClaimsPrincipal user) => true;
        public bool CanManagePeopleDataSettings(ClaimsPrincipal user) => true;
        public bool CanViewStructureSettings(ClaimsPrincipal user) => true;
        public bool CanManageStructureSettings(ClaimsPrincipal user) => true;
        public bool CanViewProvisioningSettings(ClaimsPrincipal user) => true;
        public bool CanManageProvisioningSettings(ClaimsPrincipal user) => true;
        public bool CanViewGovernanceSettings(ClaimsPrincipal user) => true;
        public bool CanViewAccessProfiles(ClaimsPrincipal user) => true;
        public bool CanManageAccessProfiles(ClaimsPrincipal user) => true;
        public string? GetOrgChartScope(ClaimsPrincipal user) => PermissionScopes.Tenant;
        public bool CanViewAccess(ClaimsPrincipal user) => true;
        public bool CanManageAccess(ClaimsPrincipal user) => true;
        public bool CanViewTenantEmployees(ClaimsPrincipal user) => true;
        public bool CanManageEmployees(ClaimsPrincipal user) => canManageEmployees;
        public bool CanImportEmployees(ClaimsPrincipal user) => true;
        public bool CanManageReporting(ClaimsPrincipal user) => canManageReporting;
        public bool CanViewOwnProfile(ClaimsPrincipal user) => true;
        public bool CanUpdateOwnProfile(ClaimsPrincipal user) => true;
        public bool CanViewTeam(ClaimsPrincipal user) => true;
        public EmployeeReadAudience GetEmployeeReadAudience(ClaimsPrincipal user) => EmployeeReadAudience.HrAdmin;
        public string? GetEmployeeViewScope(ClaimsPrincipal user) => PermissionScopes.Tenant;
    }

    private sealed class RecordingSender : ISender
    {
        public object? LastRequest { get; private set; }

        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            LastRequest = request;

            if (typeof(TResponse) == typeof(Result<MaintenanceResultDto>))
            {
                return Task.FromResult((TResponse)(object)Result.Failure<MaintenanceResultDto>(
                    Error.Validation("Test.Stub", "Stubbed failure after authorization passed.")));
            }

            if (typeof(TResponse) == typeof(Result<EmployeeDetailsDto>))
            {
                return Task.FromResult((TResponse)(object)Result.Failure<EmployeeDetailsDto>(
                    Error.Validation("Test.Stub", "Stubbed failure after authorization passed.")));
            }

            throw new NotSupportedException($"Unsupported response type: {typeof(TResponse).Name}");
        }

        public Task<object?> Send(object request, CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            return Task.FromResult<object?>(null);
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default)
            where TRequest : IRequest
        {
            LastRequest = request;
            return Task.CompletedTask;
        }

        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }
}
