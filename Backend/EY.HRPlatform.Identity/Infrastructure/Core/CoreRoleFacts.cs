using System.Net.Http.Json;
using EY.HRPlatform.SharedKernel.Security;

namespace EY.HRPlatform.Identity.Infrastructure.Core;

/// <summary>
/// What a role's holders look at for one person today, from Core HR: their unit and every unit above it, their
/// job and place, and how many people report to them.
/// </summary>
public sealed record CoreRoleFact(
    Guid EmployeeId,
    IReadOnlyList<Guid> UnitChain,
    Guid? JobId,
    Guid? PlaceId,
    int DirectReports);

/// <summary>The rule values Core HR confirms belong to the tenant; departments are units of the Department type.</summary>
public sealed record CoreRoleTargets(
    IReadOnlyList<Guid> Departments,
    IReadOnlyList<Guid> Units,
    IReadOnlyList<Guid> Jobs,
    IReadOnlyList<Guid> Places);

public interface ICoreRoleFacts
{
    /// <summary>Facts for every active person of the tenant, as of today.</summary>
    Task<IReadOnlyList<CoreRoleFact>> GetFactsAsync(Guid tenantId, CancellationToken cancellationToken);

    /// <summary>Of the given ids, the ones that are the tenant's departments, units, jobs and places.</summary>
    Task<CoreRoleTargets> ResolveTargetsAsync(Guid tenantId, IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken);
}

public sealed class CoreRoleFacts(HttpClient httpClient, IInternalServiceRequestSigner signer) : ICoreRoleFacts
{
    private const string FactsPath = "internal/corehr/role-facts";
    private const string TargetsPath = "internal/corehr/role-facts/targets";

    public async Task<IReadOnlyList<CoreRoleFact>> GetFactsAsync(Guid tenantId, CancellationToken cancellationToken)
        => await SendAsync<List<CoreRoleFact>>(FactsPath, new { }, tenantId, cancellationToken) ?? [];

    public async Task<CoreRoleTargets> ResolveTargetsAsync(Guid tenantId, IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken)
        => ids.Count == 0
            ? new CoreRoleTargets([], [], [], [])
            : await SendAsync<CoreRoleTargets>(TargetsPath, new { Ids = ids.Distinct().ToList() }, tenantId, cancellationToken)
                ?? new CoreRoleTargets([], [], [], []);

    private async Task<T?> SendAsync<T>(string path, object body, Guid tenantId, CancellationToken cancellationToken)
    {
        // Sign against an absolute URI so the signed path keeps its leading slash.
        var requestUri = httpClient.BaseAddress is not null
            ? new Uri(httpClient.BaseAddress, path)
            : new Uri(path, UriKind.Relative);
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantId.ToString());
        await signer.SignAsync(request, cancellationToken);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken);
    }
}
