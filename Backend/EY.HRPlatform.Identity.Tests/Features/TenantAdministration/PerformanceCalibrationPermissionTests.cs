using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Identity.Tests.Features.TenantAdministration;

public sealed class PerformanceCalibrationPermissionTests
{
    [Fact]
    public void Calibration_is_tenant_scoped_and_included_in_the_performance_catalogue()
    {
        var definition = Assert.Single(PerformancePermissionCatalog.Definitions,
            item => item.Key == PerformancePermissions.ReviewCalibrate);

        Assert.Equal([PermissionScopes.Tenant], definition.AllowedScopes);
        Assert.Contains(PerformancePermissions.ReviewCalibrate, PerformancePermissions.All);
    }

    [Fact]
    public void Calibration_is_seeded_to_HR_only_among_the_standard_roles()
    {
        var profiles = AccessProfileTemplates.ComposeSeeded(performanceEnabled: true)
            .ToDictionary(profile => profile.InternalKey);

        AssertCalibrationGrant(profiles["hr-admin"]);
        AssertNoCalibrationGrant(profiles["employee"]);
        AssertNoCalibrationGrant(profiles["manager"]);
    }

    [Fact]
    public void Tenant_administrator_receives_calibration_only_when_performance_is_enabled()
    {
        var disabled = AccessProfileTemplates.BuildTenantAdministrator([]).Grants;
        var enabled = AccessProfileTemplates.BuildTenantAdministrator([PermissionModuleKeys.Performance]).Grants;

        Assert.DoesNotContain(disabled, grant => grant.PermissionKey == PerformancePermissions.ReviewCalibrate);
        Assert.Contains(enabled, grant => grant.PermissionKey == PerformancePermissions.ReviewCalibrate
            && grant.Scope == PermissionScopes.Tenant);
    }

    private static void AssertCalibrationGrant(SeededAccessProfileTemplate profile)
        => Assert.Contains(profile.Grants, grant => grant.PermissionKey == PerformancePermissions.ReviewCalibrate
            && grant.Scope == PermissionScopes.Tenant);

    private static void AssertNoCalibrationGrant(SeededAccessProfileTemplate profile)
        => Assert.DoesNotContain(profile.Grants, grant => grant.PermissionKey == PerformancePermissions.ReviewCalibrate);
}
