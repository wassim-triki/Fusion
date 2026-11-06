using EY.HRPlatform.Identity.Domain.Enums;

namespace EY.HRPlatform.Identity.Features.TenantProvisioning;

/// <summary>
/// One module this service will actually provision.
/// </summary>
public sealed record ProvisionableModuleDto
{
    /// <summary>The stable identifier the provisioning request carries.</summary>
    public string Module { get; init; } = string.Empty;

    /// <summary>
    /// True when the platform grants it with the tenant regardless of the
    /// request. Core HR is the workforce truth every other module reads, so it
    /// is included rather than chosen.
    /// </summary>
    public bool Mandatory { get; init; }
}

/// <summary>
/// What provisioning accepts, stated by the service that enforces it.
///
/// Publishing the accepted set lets the workspace derive availability from the
/// authority rather than restating the rule as frontend text that could quietly
/// fall out of step: a module absent here is one the request would be refused for.
/// </summary>
public static class ProvisionableModuleCatalogue
{
    /// <summary>Granted with every tenant, whatever the request asked for.</summary>
    public const TenantModule Mandatory = TenantModule.CoreHR;

    public static IReadOnlyList<ProvisionableModuleDto> All { get; } =
        Enum.GetValues<TenantModule>()
            .Select(module => new ProvisionableModuleDto
            {
                Module = module.ToString(),
                Mandatory = module == Mandatory,
            })
            .OrderByDescending(entry => entry.Mandatory)
            .ThenBy(entry => entry.Module, StringComparer.Ordinal)
            .ToList();
}
