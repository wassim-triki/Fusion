using System.Reflection;
using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Models.Responses;
using EY.HRPlatform.SharedKernel.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Tests.Features.Workforce;

public class WorkforceControllerAuthorizationTests
{
    [Fact]
    public void Controller_RequiresAuthenticatedUserAtClassLevel()
    {
        var authorize = typeof(WorkforceController)
            .GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.NotNull(authorize);
        Assert.Null(authorize!.Roles);
    }

    [Theory]
    [InlineData(nameof(WorkforceController.GetCurrentContext))]
    [InlineData(nameof(WorkforceController.GetEmployee))]
    [InlineData(nameof(WorkforceController.SearchAccessSubjects))]
    [InlineData(nameof(WorkforceController.GetAccessSubjectSelectionPreview))]
    [InlineData(nameof(WorkforceController.GetAccessCandidates))]
    [InlineData(nameof(WorkforceController.GetAccessRosterSummary))]
    [InlineData(nameof(WorkforceController.GetPublishedOrgUnits))]
    [InlineData(nameof(WorkforceController.BulkInvite))]
    public void PermissionControlledEndpoints_DoNotDeclareMethodRoleAttributes(string methodName)
    {
        var method = typeof(WorkforceController).GetMethod(methodName);
        var authorize = method?.GetCustomAttribute<AuthorizeAttribute>(inherit: false);

        Assert.NotNull(method);
        Assert.True(authorize is null || string.IsNullOrWhiteSpace(authorize.Roles));
    }

    [Fact]
    public async Task BulkInvite_WithViewOnlyAccess_ReturnsForbid()
    {
        var service = new StubWorkforceContractService();
        var controller = CreateController(service, canViewAccess: true, canManageAccess: false);

        var result = await controller.BulkInvite(CreateBulkInviteRequest(), CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
        Assert.False(service.BulkInviteCalled);
    }

    [Fact]
    public async Task BulkInvite_WithManageAccess_CallsService()
    {
        var service = new StubWorkforceContractService();
        var controller = CreateController(service, canViewAccess: true, canManageAccess: true);

        var result = await controller.BulkInvite(CreateBulkInviteRequest(), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.IsType<ApiResponse<WorkforceBulkInviteResponseDto>>(ok.Value);
        Assert.True(service.BulkInviteCalled);
    }

    [Fact]
    public async Task AccessSubjectSelectionPreview_WithViewOnlyAccess_ReturnsForbid()
    {
        var service = new StubWorkforceContractService();
        var controller = CreateController(service, canViewAccess: true, canManageAccess: false);

        var result = await controller.GetAccessSubjectSelectionPreview(
            search: null,
            access: null,
            profileId: null,
            employeeStatus: null,
            deliveryState: null,
            employeeKey: null,
            baseline: null,
            cohort: null,
            orgUnitId: null,
            organizationScope: null,
            CancellationToken.None);

        Assert.IsType<ForbidResult>(result);
        Assert.False(service.AccessSubjectSelectionPreviewCalled);
    }

    [Fact]
    public async Task AccessSubjectSelectionPreview_WithManageAccess_CallsService()
    {
        var service = new StubWorkforceContractService();
        var controller = CreateController(service, canViewAccess: true, canManageAccess: true);

        var result = await controller.GetAccessSubjectSelectionPreview(
            search: null,
            access: null,
            profileId: null,
            employeeStatus: null,
            deliveryState: null,
            employeeKey: null,
            baseline: null,
            cohort: null,
            orgUnitId: null,
            organizationScope: null,
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.IsType<ApiResponse<IReadOnlyList<WorkforceAccessSubjectSummaryDto>>>(ok.Value);
        Assert.True(service.AccessSubjectSelectionPreviewCalled);
    }

    private static WorkforceController CreateController(
        StubWorkforceContractService service,
        bool canViewAccess,
        bool canManageAccess)
    {
        var controller = new WorkforceController(
            service,
            new StubCoreAccessPolicyService(canViewAccess, canManageAccess),
            new StubWorkforceAccessIdentityClient(),
            new StubWorkforceBulkProvisioner(),
            new WorkforceInvitationSender(new StubWorkforceAccessIdentityClient(), new StubWorkforceBulkProvisioner()))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity("TestAuth")),
                },
            },
        };

        return controller;
    }

    private static WorkforceBulkInviteRequest CreateBulkInviteRequest()
        => new(
            Search: null,
            Access: null,
            ProfileId: null,
            EmployeeStatus: null,
            DeliveryState: null,
            EmployeeKey: null,
            SpecificEmployeeIds: [],
            AccessProfileId: Guid.NewGuid());

    private sealed class StubCoreAccessPolicyService(
        bool canViewAccess,
        bool canManageAccess) : ICoreAccessPolicyService
    {
        public bool CanViewOverview(ClaimsPrincipal user) => false;
        public bool CanViewSetup(ClaimsPrincipal user) => false;
        public bool CanManageSetup(ClaimsPrincipal user) => false;
        public bool CanPublishStructure(ClaimsPrincipal user) => false;
        public bool CanViewStructure(ClaimsPrincipal user) => false;
        public bool CanManageStructure(ClaimsPrincipal user) => false;
        public bool CanViewSettings(ClaimsPrincipal user) => false;
        public bool CanManageSettings(ClaimsPrincipal user) => false;
        public bool CanViewOrganizationSettings(ClaimsPrincipal user) => false;
        public bool CanManageOrganizationSettings(ClaimsPrincipal user) => false;
        public bool CanViewPeopleDataSettings(ClaimsPrincipal user) => false;
        public bool CanManagePeopleDataSettings(ClaimsPrincipal user) => false;
        public bool CanViewStructureSettings(ClaimsPrincipal user) => false;
        public bool CanManageStructureSettings(ClaimsPrincipal user) => false;
        public bool CanViewProvisioningSettings(ClaimsPrincipal user) => false;
        public bool CanManageProvisioningSettings(ClaimsPrincipal user) => false;
        public bool CanViewGovernanceSettings(ClaimsPrincipal user) => false;
        public bool CanViewAccessProfiles(ClaimsPrincipal user) => false;
        public bool CanManageAccessProfiles(ClaimsPrincipal user) => false;
        public string? GetOrgChartScope(ClaimsPrincipal user) => null;
        public bool CanViewAccess(ClaimsPrincipal user) => canViewAccess;
        public bool CanManageAccess(ClaimsPrincipal user) => canManageAccess;
        public bool CanViewTenantEmployees(ClaimsPrincipal user) => false;
        public bool CanManageEmployees(ClaimsPrincipal user) => false;
        public bool CanImportEmployees(ClaimsPrincipal user) => false;
        public bool CanManageReporting(ClaimsPrincipal user) => false;
        public bool CanViewOwnProfile(ClaimsPrincipal user) => false;
        public bool CanUpdateOwnProfile(ClaimsPrincipal user) => false;
        public bool CanViewTeam(ClaimsPrincipal user) => false;
        public EmployeeReadAudience GetEmployeeReadAudience(ClaimsPrincipal user) => EmployeeReadAudience.Employee;
        public string? GetEmployeeViewScope(ClaimsPrincipal user) => null;
    }

    private sealed class StubWorkforceContractService : IWorkforceContractService
    {
        public bool BulkInviteCalled { get; private set; }
        public bool AccessSubjectSelectionPreviewCalled { get; private set; }

        public Task<WorkforceBulkInviteResponseDto> BulkInviteAsync(
            WorkforceBulkInviteRequest request,
            ClaimsPrincipal user,
            CancellationToken cancellationToken)
        {
            BulkInviteCalled = true;
            return Task.FromResult(new WorkforceBulkInviteResponseDto([], 0, 0, 0, 0, 0));
        }

        public Task<IReadOnlyList<WorkforceAccessSubjectSummaryDto>> GetAccessSubjectSelectionPreviewAsync(
            string? search,
            string? access,
            Guid? profileId,
            string? employeeStatus,
            string? deliveryState,
            string? employeeKey,
            string? baseline,
            Guid? cohort,
            Guid? orgUnitId,
            bool includeDescendants,
            CancellationToken cancellationToken)
        {
            AccessSubjectSelectionPreviewCalled = true;
            return Task.FromResult<IReadOnlyList<WorkforceAccessSubjectSummaryDto>>([]);
        }

        public Task<WorkforceCurrentUserContextDto> GetCurrentUserContextAsync(ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<WorkforceEmployeeSummaryDto?> GetEmployeeAsync(Guid employeeId, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> ResolveEmployeesAsync(IReadOnlyCollection<Guid> employeeIds, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> ResolveEmployeesForCompanyAsync(IReadOnlyCollection<Guid> employeeIds, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<PagedResponse<WorkforceEmployeeSummaryDto>> SearchEmployeesAsync(string? search, int page, int pageSize, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetEmployeesByScopeAsync(IReadOnlyCollection<Guid> orgUnitIds, bool includeDescendants, bool includeInactive, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<PagedResponse<WorkforceAccessSubjectSummaryDto>> SearchAccessSubjectsAsync(string? search, string? access, Guid? profileId, string? employeeStatus, string? deliveryState, string? employeeKey, string? baseline, Guid? cohort, Guid? orgUnitId, bool includeDescendants, int page, int pageSize, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<WorkforceAccessRosterSummaryDto> GetAccessRosterSummaryAsync(CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetTeamAsync(Guid employeeId, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetDownlineAsync(Guid employeeId, int maxDepth, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetManagerChainAsync(Guid employeeId, ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceOrgUnitSummaryDto>> GetPublishedOrgUnitsAsync(bool includeInactive, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<WorkforceOrgUnitTreeDto> GetPublishedOrgUnitTreeAsync(Guid? rootId, int maxDepth, bool includeInactive, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<WorkforceOrgUnitDetailDto?> GetOrgUnitDetailAsync(Guid orgUnitId, CancellationToken cancellationToken) => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceEmployeeSummaryDto>> GetOrgUnitMembersAsync(Guid orgUnitId, bool includeDescendants, System.Security.Claims.ClaimsPrincipal user, CancellationToken cancellationToken) => throw new NotImplementedException();
    }

    private sealed class StubWorkforceAccessIdentityClient : IWorkforceAccessIdentityClient
    {
        public Task<IReadOnlyList<EY.HRPlatform.CoreHR.Features.Reports.ReportRoleDto>> ReportRolesAsync(Guid userId, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<EY.HRPlatform.CoreHR.Features.Reports.ReportRoleDto>>([]);
        public Task<IReadOnlyDictionary<Guid, WorkforceAccessCandidateResult>> ResolveCandidatesAsync(
            IReadOnlyCollection<WorkforceAccessCandidateSubject> subjects,
            CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<WorkforceAccessCandidateResult> ResolveCandidateAsync(Guid employeeId, string? normalizedWorkEmail, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<WorkforceAccessMutationOutcomeResult> MutateAsync(Guid employeeId, string? normalizedWorkEmail, string action, string baseline, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<WorkforceAccessMutationOutcomeResult> CorrectAsync(Guid sourceEmployeeId, Guid targetEmployeeId, string baseline, string reason, int expectedRevision, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<bool> ResendInviteAsync(Guid employeeId, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<bool> WithdrawInviteAsync(Guid employeeId, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<IReadOnlyList<WorkforceAccessAuditLine>> GetAuditAsync(Guid employeeId, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<IdentityRoleChange?> GetLatestRoleChangeAsync(CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<(bool Ok, string Message)> SuspendAccountAsync(Guid employeeId, CancellationToken cancellationToken)
            => throw new NotImplementedException();
        public Task<(bool Ok, string Message)> RestoreAccountAsync(Guid employeeId, CancellationToken cancellationToken)
            => throw new NotImplementedException();
    }

    private sealed class StubWorkforceBulkProvisioner : IWorkforceBulkProvisioner
    {
        public Task<WorkforceBulkProvisionResponse> BulkProvisionAsync(
            List<WorkforceBulkProvisionSubject> subjects,
            Guid accessProfileId,
            CancellationToken cancellationToken,
            string? baseline = null)
            => throw new NotImplementedException();
    }
}
