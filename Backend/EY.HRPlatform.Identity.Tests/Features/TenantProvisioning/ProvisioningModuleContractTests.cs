using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;

namespace EY.HRPlatform.Identity.Tests.Features.TenantProvisioning;

/// <summary>
/// Every projection reports modules by name, so a request must be able to name
/// them too. When the request bound only numeric values, a caller echoing back
/// what it had just been shown was rejected as a malformed body.
/// </summary>
public sealed class ProvisioningModuleContractTests
{
    /// <summary>
    /// Matches how the API actually reads a request body; the library default is
    /// case-sensitive and would bind nothing from a camelCase payload.
    /// </summary>
    private static readonly JsonSerializerOptions RequestOptions =
        new(JsonSerializerDefaults.Web);

    private static ProvisionTenantRequest Deserialize(string modulesJson)
        => JsonSerializer.Deserialize<ProvisionTenantRequest>($$"""
            {
              "name": "Atlas Group",
              "locale": "en-US",
              "timeZone": "Europe/Paris",
              "modules": {{modulesJson}},
              "administratorEmail": "admin@atlas.example",
              "idempotencyKey": "key-1"
            }
            """, RequestOptions)!;

    [Fact]
    public void Modules_are_accepted_by_name()
    {
        var request = Deserialize("""["Performance"]""");

        Assert.Equal([TenantModule.Performance], request.Modules);
    }

    [Fact]
    public void Module_names_are_case_insensitive()
        => Assert.Equal(
            [TenantModule.Performance],
            Deserialize("""["performance"]""").Modules);

    [Fact]
    public void An_omitted_module_list_entitles_only_the_mandatory_module()
    {
        var request = Deserialize("[]");

        Assert.Empty(request.Modules);
        Assert.Equal([TenantModule.CoreHR], request.NormalizedModules());
    }

    [Fact]
    public void Core_HR_cannot_be_deselected_by_omission()
        => Assert.Contains(
            TenantModule.CoreHR,
            Deserialize("""["Performance"]""").NormalizedModules());

    [Fact]
    public void A_module_that_cannot_be_entitled_is_refused()
    {
        // Onboarding was replaced by joining checklists and isn't an entitlement.
        var exception = Record.Exception(() => Deserialize("""["Onboarding"]"""));

        Assert.IsType<JsonException>(exception);
    }

    [Fact]
    public void A_numeric_module_is_refused()
    {
        // Names are the contract; accepting ordinals too would let a caller
        // depend on enum numbering that is free to change.
        var exception = Record.Exception(() => Deserialize("[1]"));

        Assert.IsType<JsonException>(exception);
    }

    [Fact]
    public void Named_and_normalized_modules_produce_a_stable_fingerprint()
    {
        var lowercase = Deserialize("""["performance"]""");
        var uppercase = Deserialize("""["Performance"]""");

        Assert.Equal(lowercase.ComputeFingerprint(), uppercase.ComputeFingerprint());
    }

    [Fact]
    public void Catalogue_publishes_exactly_what_provisioning_accepts()
    {
        var published = ProvisionableModuleCatalogue.All
            .Select(entry => entry.Module)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        var accepted = Enum.GetNames<TenantModule>()
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        // A module the workspace could offer but the request would refuse — or
        // one it accepts but never shows — is the drift this contract prevents.
        Assert.Equal(accepted, published);
    }

    [Fact]
    public void Catalogue_marks_Core_HR_as_the_module_granted_regardless_of_the_request()
    {
        var mandatory = ProvisionableModuleCatalogue.All.Where(entry => entry.Mandatory).ToList();

        var only = Assert.Single(mandatory);
        Assert.Equal(nameof(TenantModule.CoreHR), only.Module);

        // The flag has to agree with what provisioning actually does, not merely
        // with what the catalogue claims.
        var request = new ProvisionTenantRequest { Modules = [] };
        Assert.Contains(TenantModule.CoreHR, request.NormalizedModules());
    }

    [Fact]
    public void Catalogue_leads_with_the_mandatory_module()
    {
        // The included module reads first in the grid, so the ordering is part
        // of the contract rather than an accident of enum declaration.
        Assert.True(ProvisionableModuleCatalogue.All[0].Mandatory);
    }
}
