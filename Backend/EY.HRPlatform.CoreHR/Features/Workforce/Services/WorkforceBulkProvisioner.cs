using System.Net.Http.Json;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;

namespace EY.HRPlatform.CoreHR.Features.Workforce.Services;

public sealed record WorkforceBulkProvisionSubject(
    Guid EmployeeId,
    string Email,
    string? FirstName,
    string? LastName,
    string? Baseline = null);

public sealed record WorkforceBulkProvisionResultItem(
    Guid EmployeeId,
    string Outcome,
    string Message);

public sealed record WorkforceBulkProvisionResponse(
    List<WorkforceBulkProvisionResultItem> Items);

public interface IWorkforceBulkProvisioner
{
    Task<WorkforceBulkProvisionResponse> BulkProvisionAsync(
        List<WorkforceBulkProvisionSubject> subjects,
        Guid accessProfileId,
        CancellationToken cancellationToken,
        string? baseline = null);
}

// Drives Identity bulk provisioning over the signed internal channel. Subjects are
// CoreHR-resolved canonical Employees; the browser JWT is never forwarded. The acting
// user is carried for audit attribution and is trusted only because the request is
// HMAC-signed.
public sealed class WorkforceBulkProvisioner(
    HttpClient httpClient,
    IHttpContextAccessor httpContextAccessor,
    ITenantContext tenantContext,
    IInternalServiceRequestSigner signer) : IWorkforceBulkProvisioner
{
    private const string BulkProvisionPath = "internal/identity/workforce-accounts/bulk-provision";

    public async Task<WorkforceBulkProvisionResponse> BulkProvisionAsync(
        List<WorkforceBulkProvisionSubject> subjects,
        Guid accessProfileId,
        CancellationToken cancellationToken,
        string? baseline = null)
    {
        if (subjects.Count == 0)
        {
            return new WorkforceBulkProvisionResponse([]);
        }

        // Tenant from the authenticated claims (via the tenant-resolution middleware),
        // never a browser-supplied header; passed to Identity as the trusted X-Tenant-Id.
        if (tenantContext.TenantIdOrDefault is not { } resolvedTenantId || resolvedTenantId == Guid.Empty)
            throw new InvalidOperationException("A resolved tenant is required for bulk provision.");

        var tenantHeader = resolvedTenantId.ToString();

        var requestBody = new
        {
            Items = subjects.Select(s => new
            {
                s.EmployeeId,
                s.Email,
                s.FirstName,
                s.LastName,
                AccessProfileId = accessProfileId == Guid.Empty ? (Guid?)null : accessProfileId,
                Baseline = s.Baseline ?? baseline
            }).ToList()
        };

        // Sign against an absolute URI so the signed path matches the server request path.
        var requestUri = httpClient.BaseAddress is not null
            ? new Uri(httpClient.BaseAddress, BulkProvisionPath)
            : new Uri(BulkProvisionPath, UriKind.Relative);

        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
        {
            Content = JsonContent.Create(requestBody),
        };
        request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantHeader);

        // A scheduled send has no acting person; Core HR records who scheduled it.
        var actingUserId = httpContextAccessor.HttpContext?.User.GetUserId() ?? Guid.Empty;
        if (actingUserId != Guid.Empty)
            request.Headers.TryAddWithoutValidation("X-Acting-User-Id", actingUserId.ToString());

        await signer.SignAsync(request, cancellationToken);

        using var response = await httpClient.SendAsync(request, cancellationToken);

        ApiResponse<List<WorkforceBulkProvisionResultItemInternal>>? envelope = null;
        try
        {
            envelope = await response.Content.ReadFromJsonAsync<ApiResponse<List<WorkforceBulkProvisionResultItemInternal>>>(
                cancellationToken: cancellationToken);
        }
        catch
        {
            envelope = null;
        }

        if (!response.IsSuccessStatusCode || envelope?.IsSuccess != true || envelope.Data is null)
        {
            var message = envelope?.Errors.FirstOrDefault() ?? "Bulk provision request failed.";
            throw new InvalidOperationException(message);
        }

        var items = envelope.Data
            .Select(i => new WorkforceBulkProvisionResultItem(i.EmployeeId, i.Outcome, i.Message))
            .ToList();

        return new WorkforceBulkProvisionResponse(items);
    }

    private sealed record WorkforceBulkProvisionResultItemInternal(
        Guid EmployeeId,
        string Outcome,
        string Message);
}
