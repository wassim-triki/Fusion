using System.Net.Http.Json;
using EY.HRPlatform.SharedKernel.Api;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;

namespace EY.HRPlatform.CoreHR.Features.Employees.Services;

public sealed record WorkforceAccountSubjectDto(
    Guid EmployeeId,
    string Email,
    string? FirstName,
    string? LastName);

public sealed record WorkforceAccountStatusesRequestDto(
    List<WorkforceAccountSubjectDto> Subjects);

public sealed record WorkforceAccountAccessProfileDto(
    Guid Id,
    string Name,
    string Type,
    bool IsSystemProtected);

public sealed record WorkforceAccountConflictDto(
    string Kind,
    string Message,
    bool Blocking,
    string? SuggestedAction);

public sealed record WorkforceAccountStatusDto(
    Guid EmployeeId,
    string Email,
    string? FullName,
    string Role,
    IReadOnlyList<WorkforceAccountAccessProfileDto> AccessProfiles,
    string ProvisioningState,
    Guid? UserId,
    bool? IsActive,
    DateTime? LastLoginAt,
    Guid? InviteId,
    DateTime? InviteCreatedAt,
    DateTime? InviteExpiresAt,
    string? InviteLink,
    string? DeliveryStatus,
    string? DeliveryMessage,
    DateTime? DeliveryRecordedAt,
    WorkforceAccountConflictDto? Conflict,
    /// <summary>How the person signs in: password, microsoft, google, company (B-191).</summary>
    IReadOnlyList<string>? SignInMethods = null);

public interface IWorkforceAccountStatusReader
{
    Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
        IReadOnlyCollection<WorkforceAccountSubjectDto> subjects,
        CancellationToken cancellationToken);
}

// Resolves workforce-account state from Identity over the signed internal channel.
// The Employee subjects are CoreHR-resolved canonical facts, never browser input, and
// the request is HMAC-signed so Identity trusts the caller rather than a forwarded JWT.
public sealed class IdentityWorkforceAccountStatusReader(
    HttpClient httpClient,
    ITenantContext tenantContext,
    IInternalServiceRequestSigner signer) : IWorkforceAccountStatusReader
{
    private const int BatchSize = 200;
    private const string StatusesPath = "internal/identity/workforce-accounts/statuses";

    public async Task<IReadOnlyDictionary<Guid, WorkforceAccountStatusDto>> GetStatusesAsync(
        IReadOnlyCollection<WorkforceAccountSubjectDto> subjects,
        CancellationToken cancellationToken)
    {
        if (subjects.Count == 0)
        {
            return new Dictionary<Guid, WorkforceAccountStatusDto>();
        }

        // The tenant is the one established from the caller's authenticated claims by the
        // tenant-resolution middleware — never a browser-supplied header. CoreHR passes it
        // to Identity as the trusted X-Tenant-Id on the signed internal request.
        if (tenantContext.TenantIdOrDefault is not { } tenantId || tenantId == Guid.Empty)
            throw new InvalidOperationException("A resolved tenant is required for workforce account status resolution.");

        var tenantHeader = tenantId.ToString();
        var statuses = new Dictionary<Guid, WorkforceAccountStatusDto>();

        foreach (var chunk in subjects.Chunk(BatchSize))
        {
            // Sign against an absolute URI so the signed path keeps its leading slash and
            // matches the server request path exactly during HMAC verification.
            var requestUri = httpClient.BaseAddress is not null
                ? new Uri(httpClient.BaseAddress, StatusesPath)
                : new Uri(StatusesPath, UriKind.Relative);

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUri)
            {
                Content = JsonContent.Create(new WorkforceAccountStatusesRequestDto(chunk.ToList())),
            };
            request.Headers.TryAddWithoutValidation("X-Tenant-Id", tenantHeader);

            await signer.SignAsync(request, cancellationToken);

            using var response = await httpClient.SendAsync(request, cancellationToken);

            ApiResponse<List<WorkforceAccountStatusDto>>? envelope = null;
            try
            {
                envelope = await response.Content.ReadFromJsonAsync<ApiResponse<List<WorkforceAccountStatusDto>>>(
                    cancellationToken: cancellationToken);
            }
            catch
            {
                envelope = null;
            }

            if (!response.IsSuccessStatusCode || envelope?.IsSuccess != true || envelope.Data is null)
            {
                var message = envelope?.Errors.FirstOrDefault() ?? "Unable to resolve workforce account status from Identity.";
                throw new InvalidOperationException(message);
            }

            foreach (var status in envelope.Data)
            {
                statuses[status.EmployeeId] = status;
            }
        }

        return statuses;
    }
}
