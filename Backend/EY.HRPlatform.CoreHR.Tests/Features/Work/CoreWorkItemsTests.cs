using System.Security.Claims;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Setup;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Work;
using EY.HRPlatform.CoreHR.Features.Workforce.Dtos;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EY.HRPlatform.CoreHR.Tests.Features.Work;

/// <summary>corehr-work-items: unfinished setup and missing Fusion access, by permission, from the caller's tenant.</summary>
public sealed class CoreWorkItemsTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private static CoreHRReadinessDto Readiness(bool organizationReady, int activeEmployees = 5, int withoutAssignment = 0)
        => new(organizationReady && activeEmployees > 0 && withoutAssignment == 0,
            new OrganizationReadinessDto(organizationReady, organizationReady ? null : "NoPermanentRoot", organizationReady, null, null, organizationReady),
            new CoreHRWorkforceReadinessDto(activeEmployees, withoutAssignment, 0, 0, 0, false));

    private static WorkforceAccessRosterSummaryDto Access(int notInvited, int needsReview = 0)
        => new(20, notInvited, 0, 20 - notInvited - needsReview, needsReview, 0);

    [Fact]
    public void An_unready_organization_is_one_item_opening_the_organization()
    {
        var item = Assert.Single(CoreWorkItems.Compose(TenantId, Readiness(organizationReady: false), null));
        Assert.Equal($"core:setup-organization:{TenantId}", item.Id);
        Assert.Equal("core", item.Module);
        Assert.Equal("/core/organization", item.Href);
        Assert.Equal("/core/organization", item.Section);
    }

    [Fact]
    public void An_unready_workforce_states_its_first_gap()
    {
        var item = Assert.Single(CoreWorkItems.Compose(TenantId, Readiness(true, withoutAssignment: 3), null));
        Assert.Equal("setup-workforce", item.Kind);
        Assert.Equal("3 people without a current assignment", item.Context);
        Assert.Equal("/core/people", item.Href);
        Assert.Equal("/core/people", item.Section);
    }

    [Fact]
    public void Everything_ready_and_everyone_invited_gives_no_items()
        => Assert.Empty(CoreWorkItems.Compose(TenantId, Readiness(true), Access(0)));

    [Fact]
    public void Workers_without_access_and_needing_review_are_counted_items()
    {
        var items = CoreWorkItems.Compose(TenantId, null, Access(12, needsReview: 1));
        Assert.Equal(["12 people don't have Fusion access yet", "1 person needs an access review"], items.Select(i => i.Title));
        Assert.All(items, item => Assert.Equal("/core/people?view=not-signed-in", item.Href));
        Assert.All(items, item => Assert.Equal("/core/people?view=not-signed-in", item.Section));
    }

    // ── Controller: permissions and tenant ──────────────────────────────────

    private static ClaimsPrincipal Caller(Guid tenantId, params (string Key, string Scope)[] grants)
    {
        var claims = new List<Claim> { new(CustomClaimTypes.TenantId, tenantId.ToString()) };
        claims.AddRange(grants.Select(g => new Claim(CustomClaimTypes.CorePermission, CorePermissionClaimValue.Encode(g.Key, g.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    private sealed class StubReadiness(CoreHRReadinessDto value) : ICoreHRReadinessService
    {
        public bool Called { get; private set; }
        public Task<CoreHRReadinessDto> GetAsync(CancellationToken cancellationToken)
        {
            Called = true;
            return Task.FromResult(value);
        }
    }

    private sealed class NoAccounts : IWorkforceAccountStatusReader
    {
        public Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
            IReadOnlyCollection<WorkforceAccountSubjectDto> subjects, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>>(new Dictionary<Guid, WorkforceAccountStatusDto>());
    }

    private sealed class NoProvisioning : IWorkforceBulkProvisioner
    {
        public Task<WorkforceBulkProvisionResponse> BulkProvisionAsync(List<WorkforceBulkProvisionSubject> subjects,
            Guid accessProfileId, CancellationToken cancellationToken, string? baseline = null)
            => throw new NotSupportedException();
    }

    private static async Task<(WorkController Controller, StubReadiness Readiness)> ControllerAsync(ClaimsPrincipal caller, Guid tenantId)
    {
        var dbName = Guid.NewGuid().ToString();
        await using (var seed = TestDbContextFactory.CreateWithoutTenant(dbName))
        {
            // Two people in the caller's tenant without accounts, and three in another tenant.
            foreach (var (tenant, count) in new[] { (tenantId, 2), (Guid.NewGuid(), 3) })
                for (var i = 0; i < count; i++)
                    seed.Employees.Add(Employee.Create(tenant, "Person", $"{i}", $"p{i}.{tenant:N}@example.com", DateTime.UtcNow,
                        jobTitle: "Analyst", employeeNumber: $"E-{tenant:N}-{i}"));
            await seed.SaveChangesAsync();
        }
        var tenantContext = TestTenantContext.WithTenant(tenantId);
        var context = TestDbContextFactory.Create(tenantContext, dbName);
        var workforce = new WorkforceContractService(context, tenantContext, new TenantSettingsReadService(context),
            new NoAccounts(), new NoProvisioning(), new WorkforceCanonicalResolver(context));
        var readiness = new StubReadiness(Readiness(organizationReady: false));
        var controller = new WorkController(readiness, workforce, new CoreAccessPolicyService())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = caller } },
        };
        return (controller, readiness);
    }

    private static IReadOnlyList<FusionWorkItemDto> Items(ActionResult<ApiResponse<IReadOnlyList<FusionWorkItemDto>>> result)
        => Assert.IsType<ApiResponse<IReadOnlyList<FusionWorkItemDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Fact]
    public async Task A_setup_administrator_with_an_unready_organization_gets_the_setup_item()
    {
        var (controller, _) = await ControllerAsync(Caller(TenantId, (CorePermissions.SetupView, PermissionScopes.Tenant)), TenantId);
        var item = Assert.Single(Items(await controller.Get(default)));
        Assert.Equal("setup-organization", item.Kind);
    }

    [Fact]
    public async Task An_employee_without_administration_rights_gets_an_empty_list()
    {
        var (controller, readiness) = await ControllerAsync(Caller(TenantId, (CorePermissions.ProfileSelfView, PermissionScopes.Self)), TenantId);
        Assert.Empty(Items(await controller.Get(default)));
        Assert.False(readiness.Called);
    }

    [Fact]
    public async Task Access_counts_come_only_from_the_callers_tenant()
    {
        var (controller, _) = await ControllerAsync(Caller(TenantId, (CorePermissions.AccessView, PermissionScopes.Tenant)), TenantId);
        var item = Assert.Single(Items(await controller.Get(default)));
        Assert.Equal("2 people don't have Fusion access yet", item.Title);
        Assert.Equal($"core:access-not-invited:{TenantId}", item.Id);
    }
}
