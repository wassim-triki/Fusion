using System.Security.Claims;
using EY.HRPlatform.Identity.Controllers;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Roles;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.Identity.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.Identity.Tests.Controllers;

/// <summary>Who may read and change roles (B-177): reading for the access readers, changing only for the roles area.</summary>
public class CoreAccessControllerPermissionTests
{
    [Fact]
    public async Task GetProfiles_WithAccessViewPermission_ReturnsOk()
    {
        var controller = CreateController((CorePermissions.AccessView, PermissionScopes.Tenant));

        var result = await controller.GetProfiles(CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetRoles_WithAccessViewPermission_ReturnsOk()
    {
        var controller = CreateController((CorePermissions.AccessView, PermissionScopes.Tenant));

        var result = await controller.GetRoles(CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetRoles_WithoutAnyAccessPermission_ReturnsForbid()
    {
        var controller = CreateController((CorePermissions.EmployeeView, PermissionScopes.Tenant));

        Assert.IsType<ForbidResult>((await controller.GetRoles(CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await controller.GetRole(Guid.NewGuid(), CancellationToken.None)).Result);
    }

    [Theory]
    [InlineData(CorePermissions.AccessManage)]
    [InlineData(CorePermissions.AccessProfilesView)]
    [InlineData(CorePermissions.EmployeeManage)]
    [InlineData(CorePermissions.AccessAssignmentsManage)]
    public async Task Changing_roles_needs_the_roles_area(string permission)
    {
        var controller = CreateController((permission, PermissionScopes.Tenant));

        Assert.IsType<ForbidResult>((await controller.CreateRole(new CreateRoleRequest("Recruiters", null), CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await controller.SaveRole(Guid.NewGuid(), SaveRequest(), "\"1\"", CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>(await controller.DeleteRole(Guid.NewGuid(), CancellationToken.None));
        Assert.IsType<ForbidResult>((await controller.GetCandidates(null, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task CreateRole_WithAccessProfilesManagePermission_ReturnsCreated()
    {
        var controller = CreateController((CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant));

        var result = await controller.CreateRole(new CreateRoleRequest("Recruiters", null), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
    }

    [Fact]
    public async Task SaveRole_without_a_version_is_a_conflict()
    {
        var controller = CreateController((CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant));

        var result = await controller.SaveRole(Guid.NewGuid(), SaveRequest(), null, CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
    }

    [Fact]
    public async Task Changing_roles_is_refused_to_a_platform_operator()
    {
        var controller = CreateController(roles: [PlatformRole.PlatformAdmin]);

        Assert.IsType<ForbidResult>((await controller.CreateRole(new CreateRoleRequest("Recruiters", null), CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await controller.SaveRole(Guid.NewGuid(), SaveRequest(), "\"1\"", CancellationToken.None)).Result);
    }

    [Fact]
    public async Task A_person_reads_their_own_roles_but_not_someone_elses()
    {
        var employeeId = Guid.NewGuid();
        var controller = CreateController(roles: null, employeeId: employeeId, (CorePermissions.ProfileSelfView, PermissionScopes.Self));

        Assert.IsType<OkObjectResult>((await controller.GetPersonRoles(employeeId, CancellationToken.None)).Result);
        Assert.IsType<ForbidResult>((await controller.GetPersonRoles(Guid.NewGuid(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Without_a_tenant_nothing_is_read_or_changed()
    {
        var controller = CreateController(
            roles: null, employeeId: null, tenant: TestTenantContext.Unresolved(),
            (CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant));

        Assert.IsType<BadRequestObjectResult>((await controller.GetRoles(CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.SaveRole(Guid.NewGuid(), SaveRequest(), "\"1\"", CancellationToken.None)).Result);
    }

    private static SaveRoleRequest SaveRequest()
        => new("Recruiters", null, [], AccessProfileHolderKinds.Chosen, [], []);

    private static CoreAccessController CreateController(params (string PermissionKey, string Scope)[] grants)
        => CreateController(null, null, null, grants);

    private static CoreAccessController CreateController(IEnumerable<string>? roles = null, params (string PermissionKey, string Scope)[] grants)
        => CreateController(roles, null, null, grants);

    private static CoreAccessController CreateController(
        IEnumerable<string>? roles,
        Guid? employeeId,
        params (string PermissionKey, string Scope)[] grants)
        => CreateController(roles, employeeId, null, grants);

    private static CoreAccessController CreateController(
        IEnumerable<string>? roles,
        Guid? employeeId,
        ITenantContext? tenant,
        params (string PermissionKey, string Scope)[] grants)
        => new(
            new StubAccessProfileService(),
            new StubAccessAuditService(),
            new StubRoleService(),
            tenant ?? TestTenantContext.WithTenant(Guid.NewGuid()),
            new SilentRoleMail())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()),
                        new Claim(ClaimTypes.Email, "controller.test@example.com"),
                        .. employeeId is { } id ? [new Claim(CustomClaimTypes.EmployeeId, id.ToString())] : Array.Empty<Claim>(),
                        .. (roles ?? []).Select(role => new Claim(ClaimTypes.Role, role)),
                        .. grants.Select(grant => new Claim(
                            CustomClaimTypes.CorePermission,
                            CorePermissionClaimValue.Encode(grant.PermissionKey, grant.Scope))),
                    ], "TestAuth"))
                }
            }
        };

    private sealed class StubAccessProfileService : IAccessProfileService
    {
        public Task EnsureSeedDataAsync(CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task EnsureTenantAccessProfilesAsync(Guid tenantId, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task<IReadOnlyList<AccessProfileSummaryDto>> GetProfilesAsync(Guid tenantId, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<AccessProfileSummaryDto>>([
                new AccessProfileSummaryDto
                {
                    Id = Guid.NewGuid(),
                    Name = "Employees",
                    Type = AccessProfileTypes.SystemSeeded,
                    IsSystemProtected = false,
                }
            ]);

        public Task<AccessProfileSummaryDto?> GetProfileAsync(Guid tenantId, Guid profileId, CancellationToken cancellationToken = default)
            => Task.FromResult<AccessProfileSummaryDto?>(new AccessProfileSummaryDto { Id = profileId, Name = "Employees" });

        public Task<CurrentUserAccessDto> GetCurrentUserAccessAsync(ApplicationUser user, CancellationToken cancellationToken = default)
            => Task.FromResult(new CurrentUserAccessDto());

        public Task<IReadOnlyList<AccessProfileAssignmentSummaryDto>> GetAssignedProfilesAsync(ApplicationUser user, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<AccessProfileAssignmentSummaryDto>>([]);

        public Task<IReadOnlyList<EffectivePermissionGrant>> GetEffectivePermissionsAsync(ApplicationUser user, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<EffectivePermissionGrant>>([]);

        public Task<IReadOnlyList<PermissionHolder>> GetPermissionHoldersAsync(Guid tenantId, string permissionKey, string scope, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<PermissionHolder>>([]);

        public Task SetInviteAccessProfilesAsync(Guid tenantId, Guid inviteId, IReadOnlyCollection<Guid> accessProfileIds, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task<IReadOnlyList<AccessProfileAssignmentSummaryDto>> GetInviteAccessProfilesAsync(Guid inviteId, CancellationToken cancellationToken = default)
            => Task.FromResult<IReadOnlyList<AccessProfileAssignmentSummaryDto>>([]);

        public Task ApplyInviteProfilesAsync(InviteToken invite, ApplicationUser user, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task SyncCompatibilityRolesAsync(ApplicationUser user, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public string ResolveCompatibilityRole(IReadOnlyCollection<EffectivePermissionGrant> grants)
            => PlatformRole.Employee;
    }

    private sealed class StubRoleService : IRoleService
    {
        private static RoleDetailDto Detail(Guid id, string name)
            => new(new RoleSummaryDto(id, name, null, false, false, false, AccessProfileHolderKinds.Chosen, [], 0, [], [], 1, null), [], []);

        public Task<RolesOverviewDto> GetOverviewAsync(Guid tenantId, CancellationToken cancellationToken)
            => Task.FromResult(new RolesOverviewDto([], [], null));

        public Task<RoleDetailDto> GetRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken)
            => Task.FromResult(Detail(roleId, "Role"));

        public Task<RoleDetailDto> CreateRoleAsync(Guid tenantId, CreateRoleRequest request, CancellationToken cancellationToken)
            => Task.FromResult(Detail(Guid.NewGuid(), request.Name));

        public Task<RoleDetailDto> SaveRoleAsync(Guid tenantId, Guid roleId, uint expectedVersion, SaveRoleRequest request, CancellationToken cancellationToken)
            => Task.FromResult(Detail(roleId, request.Name));

        public Task DeleteRoleAsync(Guid tenantId, Guid roleId, CancellationToken cancellationToken)
            => Task.CompletedTask;

        public Task<IReadOnlyList<PersonRoleDto>?> GetPersonRolesAsync(Guid tenantId, Guid employeeId, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<PersonRoleDto>?>([]);

        public Task<IReadOnlyList<RoleCandidateDto>> FindCandidatesAsync(Guid tenantId, string? search, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<RoleCandidateDto>>([]);
    }

    private sealed class StubAccessAuditService : IAccessAuditService
    {
        public Task RecordAsync(
            Guid tenantId,
            string action,
            string resourceType,
            string? resourceId,
            string summary,
            object? before,
            object? after,
            ClaimsPrincipal actor,
            CancellationToken cancellationToken)
            => Task.CompletedTask;

        public Task<IReadOnlyList<AccessAuditEventDto>> GetRecentAsync(
            Guid tenantId,
            int take,
            CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<AccessAuditEventDto>>([]);
    }

    private sealed class SilentRoleMail : EY.HRPlatform.Identity.Features.Notifications.IAdministratorRoleMail
    {
        public Task SendAsync(EY.HRPlatform.Identity.Features.Notifications.AdministratorRoleChange change, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task SendProfileChangesAsync(Guid tenantId, Guid actorUserId,
            IReadOnlyList<(Guid UserId, IReadOnlyCollection<Guid> Before, IReadOnlyCollection<Guid> After)> people,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
