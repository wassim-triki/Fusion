using System.Net.Http.Json;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;

namespace EY.HRPlatform.Performance.Infrastructure.Core;

/// <summary>
/// Reads Core workforce/organization truth through the signed internal snapshot contract.
/// All three population resolution modes go through here: all-active-as-of (mode A),
/// by-scope (mode B), and resolve-by-ids (named). Every call is HMAC-signed and carries the
/// current tenant via <c>X-Tenant-Id</c>.
/// </summary>
public interface ICoreWorkforceClient
{
    Task<IReadOnlyList<WorkforceOrgUnitContext>> ResolveOrgUnitsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<WorkforceSnapshot>> GetAllActiveAsOfAsync(DateTime asOf, CancellationToken cancellationToken);

    Task<IReadOnlyList<WorkforceSnapshot>> GetByScopeAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<WorkforceSnapshot>> ResolveAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> employeeIds,
        CancellationToken cancellationToken);

    /// <summary>Active employees whose primary manager as of the date is one of the listed managers.</summary>
    Task<IReadOnlyList<WorkforceSnapshot>> GetDirectReportsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> managerEmployeeIds,
        CancellationToken cancellationToken);

    /// <summary>Active employees whose name contains the term, at most <paramref name="limit"/> (Core caps it at 20).</summary>
    Task<IReadOnlyList<WorkforceSnapshot>> SearchAsync(
        DateTime asOf,
        string term,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>The company's job families and levels, and which levels each family's jobs use.</summary>
    Task<JobCatalogue> GetJobCatalogueAsync(CancellationToken cancellationToken);
}

public sealed class CoreWorkforceClient(
    HttpClient httpClient,
    IInternalServiceRequestSigner signer,
    ITenantContext tenantContext) : ICoreWorkforceClient
{
    private const string BasePath = "internal/corehr/workforce/snapshots";

    public Task<IReadOnlyList<WorkforceOrgUnitContext>> ResolveOrgUnitsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        CancellationToken cancellationToken)
    {
        if (orgUnitIds.Count == 0)
            return Task.FromResult<IReadOnlyList<WorkforceOrgUnitContext>>([]);

        return PostAsync<WorkforceOrgUnitResolveRequest, WorkforceOrgUnitContext>(
            $"{BasePath}/org-units/resolve",
            new WorkforceOrgUnitResolveRequest(asOf, orgUnitIds.ToList()),
            cancellationToken);
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> GetAllActiveAsOfAsync(DateTime asOf, CancellationToken cancellationToken)
        => PostAsync($"{BasePath}/all-active", new WorkforceAllActiveRequest(asOf), cancellationToken);

    public Task<IReadOnlyList<WorkforceSnapshot>> GetByScopeAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> orgUnitIds,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        if (orgUnitIds.Count == 0)
            return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>([]);

        return PostAsync(
            $"{BasePath}/by-scope",
            new WorkforceByScopeRequest(asOf, orgUnitIds.ToList(), includeDescendants),
            cancellationToken);
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> ResolveAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> employeeIds,
        CancellationToken cancellationToken)
    {
        if (employeeIds.Count == 0)
            return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>([]);

        return PostAsync(
            $"{BasePath}/resolve",
            new WorkforceResolveRequest(asOf, employeeIds.ToList()),
            cancellationToken);
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> GetDirectReportsAsync(
        DateTime asOf,
        IReadOnlyCollection<Guid> managerEmployeeIds,
        CancellationToken cancellationToken)
    {
        if (managerEmployeeIds.Count == 0)
            return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>([]);

        return PostAsync(
            $"{BasePath}/direct-reports",
            new WorkforceDirectReportsRequest(asOf, managerEmployeeIds.ToList()),
            cancellationToken);
    }

    public Task<IReadOnlyList<WorkforceSnapshot>> SearchAsync(
        DateTime asOf,
        string term,
        int limit,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(term) || term.Trim().Length < 2)
            return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>([]);

        return PostAsync(
            $"{BasePath}/search",
            new WorkforceSearchRequest(asOf, term.Trim(), limit),
            cancellationToken);
    }

    public async Task<JobCatalogue> GetJobCatalogueAsync(CancellationToken cancellationToken)
    {
        using var response = await SendAsync($"{BasePath}/job-catalogue", new { }, cancellationToken);
        return await response.Content.ReadFromJsonAsync<JobCatalogue>(cancellationToken: cancellationToken) ?? new JobCatalogue([], [], []);
    }

    private Task<IReadOnlyList<WorkforceSnapshot>> PostAsync<TRequest>(
        string path,
        TRequest body,
        CancellationToken cancellationToken)
        => PostAsync<TRequest, WorkforceSnapshot>(path, body, cancellationToken);

    private async Task<IReadOnlyList<TResponse>> PostAsync<TRequest, TResponse>(
        string path,
        TRequest body,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(path, body, cancellationToken);
        var snapshots = await response.Content.ReadFromJsonAsync<List<TResponse>>(cancellationToken: cancellationToken);
        return snapshots ?? [];
    }

    private async Task<HttpResponseMessage> SendAsync<TRequest>(string path, TRequest body, CancellationToken cancellationToken)
    {
        if (!tenantContext.IsResolved)
            throw new InvalidOperationException("A resolved tenant context is required to read Core workforce truth.");

        // Sign against an absolute URI so the signed path carries its leading slash and matches
        // the server's request path exactly; signing a relative URI would drop the slash and
        // fail HMAC verification.
        var requestUri = httpClient.BaseAddress is not null ? new Uri(httpClient.BaseAddress, path) : new Uri(path, UriKind.Relative);
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantContext.TenantId.ToString());

        await signer.SignAsync(request, cancellationToken);

        var response = await httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            throw new HttpRequestException($"Core HR answered {(int)response.StatusCode}.", null, response.StatusCode);
        }
        return response;
    }
}
