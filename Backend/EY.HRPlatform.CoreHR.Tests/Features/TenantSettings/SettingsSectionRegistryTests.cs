using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Controllers;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Commands.UpdateTenantSettings;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Queries.GetTenantSettings;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Moq;

namespace EY.HRPlatform.CoreHR.Tests.Features.TenantSettings;

/// <summary>
/// Core HR in Fusion Settings (B-071): the six sections per caller with their last change, the field policy every
/// member reads, the name lock, and the removed brand colour and overview.
/// </summary>
public class SettingsSectionRegistryTests
{
    private static readonly Guid TenantA = Guid.NewGuid();

    [Fact]
    public void An_HR_partner_with_field_view_only_sees_employee_fields_and_lists_as_view()
    {
        var sections = Registry(TenantA).GetVisibleSections(Principal((CorePermissions.SettingsPeopleDataView, PermissionScopes.Tenant)));

        Assert.Equal([CoreSettingsSectionIds.EmployeeFields, CoreSettingsSectionIds.Lists, CoreSettingsSectionIds.Approvals], sections.Select(section => section.Id));
        Assert.All(sections, section => Assert.Equal(FusionSettingsSectionDto.View, section.Access));
        Assert.Equal("/core/settings/employee-fields", sections[0].Path);
        Assert.Equal("/core/settings/lists", sections[1].Path);
    }

    [Fact]
    public void An_employee_and_a_platform_administrator_get_no_sections()
    {
        Assert.Empty(Registry(TenantA).GetVisibleSections(Principal((CorePermissions.ProfileSelfView, PermissionScopes.Self))));
        Assert.Empty(Registry(TenantA).GetVisibleSections(Principal([PlatformRole.PlatformAdmin])));
    }

    [Fact]
    public void Legacy_settings_manage_lists_every_section_in_order()
    {
        var sections = Registry(TenantA).GetVisibleSections(Principal(
            (CorePermissions.SettingsManage, PermissionScopes.Tenant),
            (CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant)));

        Assert.Equal(["brand", "details", "employee-fields", "lists", "roles", "approvals", "invitations", "notifications", "change-history"], sections.Select(section => section.Id));
        Assert.Equal(["Brand", "Details", "Employee fields", "Lists", "Roles", "Changes and approvals", "Invitations", "Notifications", "Change history"], sections.Select(section => section.Label));
        Assert.Equal([1, 2, 3, 4, 5, 6, 7, 8, 9], sections.Select(section => section.Order));
        Assert.Equal(FusionSettingsSectionDto.Manage, sections[0].Access);
        Assert.Equal(FusionSettingsSectionDto.View, sections[1].Access);
        Assert.All(sections.Skip(2).Take(6), section => Assert.Equal(FusionSettingsSectionDto.Manage, section.Access));
        Assert.Equal(FusionSettingsSectionDto.View, sections[8].Access);
    }

    [Fact]
    public async Task Each_section_names_its_own_last_change_from_its_own_tenant()
    {
        var database = Guid.NewGuid().ToString();
        var tenantB = Guid.NewGuid();
        await using (var seedB = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), database))
        {
            seedB.SettingsAuditEvents.Add(Change(tenantB, SettingsSectionIds.Organization, "Borealis Admin", DateTime.UtcNow));
            await seedB.SaveChangesAsync();
        }
        await using (var seedA = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA), database))
        {
            seedA.SettingsAuditEvents.Add(Change(TenantA, SettingsSectionIds.PeopleData, "Someone Earlier", DateTime.UtcNow.AddDays(-2)));
            seedA.SettingsAuditEvents.Add(Change(TenantA, SettingsSectionIds.PeopleData, "Amira Khelifi", DateTime.UtcNow.AddMinutes(-1)));
            seedA.SettingsAuditEvents.Add(Change(TenantA, SettingsSectionIds.Provisioning, "Unknown", DateTime.UtcNow.AddDays(-1)));
            await seedA.SaveChangesAsync();
        }

        var sections = (await Registry(TenantA, database).GetSectionsAsync(
                Principal((CorePermissions.SettingsManage, PermissionScopes.Tenant)), CancellationToken.None))
            .ToDictionary(section => section.Id);

        Assert.Equal("Amira Khelifi", sections["employee-fields"].LastChange?.ActorName);
        Assert.Equal("Someone", sections["invitations"].LastChange?.ActorName);
        Assert.Null(sections["brand"].LastChange);
        Assert.Null(sections["change-history"].LastChange);
    }

    [Fact]
    public async Task Roles_names_the_last_role_change_from_identity()
    {
        var database = Guid.NewGuid().ToString();
        var identity = new Mock<IWorkforceAccessIdentityClient>();
        identity.Setup(client => client.GetLatestRoleChangeAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new IdentityRoleChange(DateTime.UtcNow.AddHours(-3), "Amira Khelifi"));

        var sections = (await Registry(TenantA, database, identity.Object).GetSectionsAsync(
                Principal((CorePermissions.SettingsManage, PermissionScopes.Tenant), (CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant)),
                CancellationToken.None))
            .ToDictionary(section => section.Id);

        Assert.Equal("Amira Khelifi", sections["roles"].LastChange?.ActorName);
        Assert.Null(sections["brand"].LastChange);
    }

    [Fact]
    public async Task Identity_being_down_leaves_roles_without_a_change_and_the_list_intact()
    {
        var identity = new Mock<IWorkforceAccessIdentityClient>();
        identity.Setup(client => client.GetLatestRoleChangeAsync(It.IsAny<CancellationToken>())).ThrowsAsync(new HttpRequestException());

        var sections = await Registry(TenantA, Guid.NewGuid().ToString(), identity.Object).GetSectionsAsync(
            Principal((CorePermissions.SettingsManage, PermissionScopes.Tenant), (CorePermissions.AccessProfilesManageV2, PermissionScopes.Tenant)),
            CancellationToken.None);

        Assert.Equal(9, sections.Count);
        Assert.Null(sections.Single(section => section.Id == "roles").LastChange);
    }

    [Fact]
    public async Task Identity_is_not_asked_when_the_caller_cannot_see_roles()
    {
        var identity = new Mock<IWorkforceAccessIdentityClient>(MockBehavior.Strict);

        var sections = await Registry(TenantA, Guid.NewGuid().ToString(), identity.Object).GetSectionsAsync(
            Principal((CorePermissions.SettingsPeopleDataView, PermissionScopes.Tenant)), CancellationToken.None);

        Assert.Equal(["employee-fields", "lists", "approvals"], sections.Select(section => section.Id));
        identity.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Every_member_reads_the_field_policy_and_nothing_else()
    {
        var database = Guid.NewGuid().ToString();
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA), database);
        var policy = new Mock<ICoreAccessPolicyService>(MockBehavior.Strict);
        var controller = Controller(db, policy.Object, TestTenantContext.WithTenant(TenantA),
            Principal((CorePermissions.ProfileSelfView, PermissionScopes.Self)));

        var result = Assert.IsType<OkObjectResult>(await controller.GetFieldVisibility(CancellationToken.None));
        var json = JsonSerializer.SerializeToElement(result.Value, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            .GetProperty("data");

        Assert.Equal(["fields", "selfService", "orgChart"], json.EnumerateObject().Select(property => property.Name));
        Assert.Equal(OrgChartAudiences.Everyone, json.GetProperty("orgChart").GetProperty("audience").GetString());
        var phone = json.GetProperty("fields").GetProperty("phone");
        Assert.True(phone.GetProperty("visibleToManager").GetBoolean());
        Assert.True(json.GetProperty("selfService").GetProperty("canEditPhone").GetBoolean());
        policy.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task The_field_policy_needs_a_tenant()
    {
        await using var db = TestDbContextFactory.Create(TestTenantContext.Unresolved());
        var controller = Controller(db, Mock.Of<ICoreAccessPolicyService>(), TestTenantContext.Unresolved(), Principal([PlatformRole.PlatformAdmin]));

        Assert.IsType<ForbidResult>(await controller.GetFieldVisibility(CancellationToken.None));
    }

    [Fact]
    public async Task The_field_policy_is_the_callers_tenant()
    {
        var database = Guid.NewGuid().ToString();
        var tenantB = Guid.NewGuid();
        await using (var dbB = TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantB), database))
        {
            await new UpdateTenantSettingsCommandHandler(dbB, TestTenantContext.WithTenant(tenantB)).Handle(new UpdateTenantSettingsCommand(
                null, new() { ["phone"] = new FieldConfigInput(null, null, null, false) }, null), CancellationToken.None);
        }

        await using var dbA = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA), database);
        var controller = Controller(dbA, Mock.Of<ICoreAccessPolicyService>(), TestTenantContext.WithTenant(TenantA),
            Principal((CorePermissions.ProfileSelfView, PermissionScopes.Self)));
        var result = Assert.IsType<OkObjectResult>(await controller.GetFieldVisibility(CancellationToken.None));
        var data = Assert.IsType<ApiResponse<FieldVisibilityDto>>(result.Value).Data!;
        Assert.True(data.Fields["phone"].VisibleToManager);
    }

    [Fact]
    public async Task The_org_chart_audience_is_one_of_two_is_kept_by_other_saves_and_every_member_reads_it()
    {
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA));
        var handler = new UpdateTenantSettingsCommandHandler(db, TestTenantContext.WithTenant(TenantA));
        await Assert.ThrowsAsync<ArgumentException>(() => handler.Handle(
            new UpdateTenantSettingsCommand(null, null, null, OrgChart: new OrgChartSettingsInput("Nobody")), CancellationToken.None));

        var saved = await handler.Handle(
            new UpdateTenantSettingsCommand(null, null, null, OrgChart: new OrgChartSettingsInput(OrgChartAudiences.ManagersAndHr)), CancellationToken.None);
        var phone = await handler.Handle(new UpdateTenantSettingsCommand(saved.Value.Version,
            new() { ["phone"] = new FieldConfigInput(null, null, null, false) }, null), CancellationToken.None);
        Assert.Equal(OrgChartAudiences.ManagersAndHr, phone.Value.OrgChart.Audience);

        var controller = Controller(db, Mock.Of<ICoreAccessPolicyService>(), TestTenantContext.WithTenant(TenantA),
            Principal((CorePermissions.ProfileSelfView, PermissionScopes.Self)));
        var result = Assert.IsType<OkObjectResult>(await controller.GetFieldVisibility(CancellationToken.None));
        Assert.Equal(OrgChartAudiences.ManagersAndHr, Assert.IsType<ApiResponse<FieldVisibilityDto>>(result.Value).Data!.OrgChart.Audience);
    }

    [Theory]
    [InlineData("firstName", false, null)]
    [InlineData("lastName", null, false)]
    public async Task First_and_last_name_stay_required_and_visible(string field, bool? required, bool? visibleToManager)
    {
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA));
        var handler = new UpdateTenantSettingsCommandHandler(db, TestTenantContext.WithTenant(TenantA));

        await Assert.ThrowsAsync<ArgumentException>(() => handler.Handle(new UpdateTenantSettingsCommand(
            null, new() { [field] = new FieldConfigInput(null, required, null, visibleToManager) }, null), CancellationToken.None));
    }

    [Fact]
    public async Task A_brand_colour_from_an_older_client_is_ignored_and_never_returned()
    {
        var request = JsonSerializer.Deserialize<UpdateOrganizationSettingsRequest>(
            """{"branding":{"logoUrl":null,"primaryColor":"#ff0000"}}""", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        await using var db = TestDbContextFactory.Create(TestTenantContext.WithTenant(TenantA));
        var result = await new UpdateTenantSettingsCommandHandler(db, TestTenantContext.WithTenant(TenantA)).Handle(
            new UpdateTenantSettingsCommand(null, null, request.Branding), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var stored = (await new GetTenantSettingsQueryHandler(db).Handle(new GetTenantSettingsQuery(), CancellationToken.None));
        var json = JsonSerializer.Serialize(stored, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("primaryColor", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ff0000", json, StringComparison.OrdinalIgnoreCase);

        // A colour stored before the change is never read back either.
        Assert.DoesNotContain("primaryColor", JsonSerializer.Serialize(
            TenantSettingsMerger.Merge("""{"branding":{"primaryColor":"#1a365d"}}""", 1),
            new JsonSerializerOptions(JsonSerializerDefaults.Web)), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_settings_overview_is_gone()
    {
        var routes = typeof(TenantSettingsController).GetMethods()
            .SelectMany(method => method.GetCustomAttributes<HttpMethodAttribute>())
            .Select(attribute => attribute.Template)
            .ToList();
        Assert.DoesNotContain("overview", routes);
        Assert.Contains("field-visibility", routes);
    }

    private static SettingsSectionRegistry Registry(Guid tenantId, string? database = null, IWorkforceAccessIdentityClient? identity = null)
        => new(new CoreAccessPolicyService(), TestDbContextFactory.Create(TestTenantContext.WithTenant(tenantId), database),
            identity ?? Mock.Of<IWorkforceAccessIdentityClient>());

    private static SettingsAuditEvent Change(Guid tenantId, string sectionId, string actor, DateTime at)
    {
        var change = SettingsAuditEvent.Create(tenantId, Guid.NewGuid(), actor, "HRAdmin", sectionId, $"settings.{sectionId}.updated",
            "TenantSettings", null, "Updated.", null, null, null);
        typeof(SettingsAuditEvent).GetProperty(nameof(SettingsAuditEvent.OccurredAt))!.SetValue(change, at);
        return change;
    }

    private static TenantSettingsController Controller(CoreHRDbContext db, ICoreAccessPolicyService policy, ITenantContext tenant, ClaimsPrincipal user)
    {
        var sender = new Mock<ISender>();
        sender.Setup(x => x.Send(It.IsAny<GetTenantSettingsQuery>(), It.IsAny<CancellationToken>()))
            .Returns((GetTenantSettingsQuery query, CancellationToken token) => new GetTenantSettingsQueryHandler(db).Handle(query, token));
        return new TenantSettingsController(sender.Object, policy, Mock.Of<ISettingsSectionRegistry>(), Mock.Of<ISettingsAuditService>(), tenant)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = user } },
        };
    }

    private static ClaimsPrincipal Principal(params (string PermissionKey, string Scope)[] grants) => Principal(null, grants);

    private static ClaimsPrincipal Principal(IEnumerable<string>? roles, params (string PermissionKey, string Scope)[] grants)
    {
        var claims = new List<Claim>();
        claims.AddRange((roles ?? []).Select(role => new Claim(ClaimTypes.Role, role)));
        claims.AddRange(grants.Select(grant => new Claim(
            CustomClaimTypes.CorePermission,
            CorePermissionClaimValue.Encode(grant.PermissionKey, grant.Scope))));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }
}
