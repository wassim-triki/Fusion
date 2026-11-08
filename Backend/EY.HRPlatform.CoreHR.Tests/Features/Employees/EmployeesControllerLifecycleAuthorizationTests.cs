using EY.HRPlatform.CoreHR.Tests.TestSupport;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using EY.HRPlatform.CoreHR.Exceptions;
using EY.HRPlatform.CoreHR.Features.Employees.Dtos;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.People;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Results;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Tests.Features.Employees;

/// <summary>
/// Deny-by-default authorization for the dotted-line actions.
/// </summary>
public class EmployeesControllerLifecycleAuthorizationTests
{
    private static readonly DateTime EffectiveDate = new(2025, 6, 1, 0, 0, 0, DateTimeKind.Utc);

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
