using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.AccessProfiles;

public interface IAccessAuditService
{
    Task RecordAsync(
        Guid tenantId,
        string action,
        string resourceType,
        string? resourceId,
        string summary,
        object? before,
        object? after,
        ClaimsPrincipal actor,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<AccessAuditEventDto>> GetRecentAsync(Guid tenantId, int take, CancellationToken cancellationToken);
}

public sealed class AccessAuditService(
    AppIdentityDbContext dbContext,
    IHttpContextAccessor httpContextAccessor) : IAccessAuditService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task RecordAsync(
        Guid tenantId,
        string action,
        string resourceType,
        string? resourceId,
        string summary,
        object? before,
        object? after,
        ClaimsPrincipal actor,
        CancellationToken cancellationToken)
    {
        var auditEvent = AccessAuditEvent.Create(
            tenantId,
            TryGetUserId(actor),
            GetActorName(actor),
            GetActorRole(actor),
            action,
            resourceType,
            resourceId,
            summary,
            SerializeOrNull(before),
            SerializeOrNull(after),
            httpContextAccessor.HttpContext?.Request.Headers["X-Correlation-Id"].FirstOrDefault()
                ?? httpContextAccessor.HttpContext?.TraceIdentifier);

        dbContext.AccessAuditEvents.Add(auditEvent);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AccessAuditEventDto>> GetRecentAsync(
        Guid tenantId,
        int take,
        CancellationToken cancellationToken)
    {
        var pageSize = Math.Clamp(take, 1, 100);
        var events = await dbContext.AccessAuditEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(auditEvent => auditEvent.TenantId == tenantId)
            .OrderByDescending(auditEvent => auditEvent.OccurredAt)
            .Take(pageSize)
            .Select(auditEvent => new
            {
                Event = auditEvent,
                // Administrator commands record the actor by id only; name them here.
                Named = auditEvent.ActorName == AccessAuditEvent.UnresolvedActor && auditEvent.ActorUserId != null
                    ? dbContext.Users.IgnoreQueryFilters()
                        .Where(user => user.Id == auditEvent.ActorUserId)
                        .Select(user => user.FirstName + " " + user.LastName)
                        .FirstOrDefault()
                    : null,
            })
            .ToListAsync(cancellationToken);

        return events
            .Select(item => (auditEvent: item.Event, name: item.Named))
            .Select(item => new AccessAuditEventDto(
                item.auditEvent.Id,
                item.auditEvent.OccurredAt,
                string.IsNullOrWhiteSpace(item.name) ? item.auditEvent.ActorName : item.name.Trim(),
                item.auditEvent.ActorRole,
                item.auditEvent.Action,
                item.auditEvent.ResourceType,
                item.auditEvent.ResourceId,
                item.auditEvent.Summary,
                item.auditEvent.BeforeJson,
                item.auditEvent.AfterJson,
                item.auditEvent.CorrelationId))
            .ToList();
    }

    private static string? SerializeOrNull(object? value)
        => value is null ? null : JsonSerializer.Serialize(value, JsonOptions);

    private static Guid? TryGetUserId(ClaimsPrincipal actor)
    {
        var claim = actor.FindFirst(ClaimTypes.NameIdentifier);
        return claim is not null && Guid.TryParse(claim.Value, out var userId)
            ? userId
            : null;
    }

    private static string GetActorName(ClaimsPrincipal actor)
        => actor.FindFirst(CustomClaimTypes.FullName)?.Value
            ?? actor.FindFirst(ClaimTypes.Email)?.Value
            ?? "Unknown";

    private static string GetActorRole(ClaimsPrincipal actor)
        => actor.HasCorePermission(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant)
            ? TenantAdministratorAuthority.DisplayName
            : "Member";
}
