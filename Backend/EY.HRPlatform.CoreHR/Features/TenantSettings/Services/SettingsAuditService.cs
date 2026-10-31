using System.Security.Claims;
using System.Text.Json;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Dtos;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.TenantSettings.Services;

public interface ISettingsAuditService
{
    Task RecordAsync(
        string sectionId,
        string action,
        string resourceType,
        string? resourceId,
        string summary,
        object? before,
        object? after,
        ClaimsPrincipal actor,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<SettingsAuditEventDto>> GetRecentAsync(int take, CancellationToken cancellationToken);
}

public sealed class SettingsAuditService(
    CoreHRDbContext dbContext,
    ITenantContext tenantContext,
    IHttpContextAccessor httpContextAccessor) : ISettingsAuditService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public async Task RecordAsync(
        string sectionId,
        string action,
        string resourceType,
        string? resourceId,
        string summary,
        object? before,
        object? after,
        ClaimsPrincipal actor,
        CancellationToken cancellationToken)
    {
        var auditEvent = SettingsAuditEvent.Create(
            tenantContext.TenantId,
            TryGetUserId(actor),
            GetActorName(actor),
            GetActorRole(actor),
            sectionId,
            action,
            resourceType,
            resourceId,
            summary,
            SerializeOrNull(before),
            SerializeOrNull(after),
            httpContextAccessor.HttpContext?.Request.Headers["X-Correlation-Id"].FirstOrDefault()
                ?? httpContextAccessor.HttpContext?.TraceIdentifier);

        dbContext.SettingsAuditEvents.Add(auditEvent);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<SettingsAuditEventDto>> GetRecentAsync(int take, CancellationToken cancellationToken)
    {
        var pageSize = Math.Clamp(take, 1, 100);
        return await dbContext.SettingsAuditEvents
            .AsNoTracking()
            .OrderByDescending(auditEvent => auditEvent.OccurredAt)
            .Take(pageSize)
            .Select(auditEvent => new SettingsAuditEventDto(
                auditEvent.Id,
                auditEvent.OccurredAt,
                auditEvent.ActorName,
                auditEvent.ActorRole,
                auditEvent.SectionId,
                auditEvent.Action,
                auditEvent.ResourceType,
                auditEvent.ResourceId,
                auditEvent.Summary,
                auditEvent.BeforeJson,
                auditEvent.AfterJson,
                auditEvent.CorrelationId))
            .ToListAsync(cancellationToken);
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

    // The actor's token role retired (B-178); the record keeps a plain kind from the roles model.
    private static string GetActorRole(ClaimsPrincipal actor)
        => actor.HasCorePermission(CorePermissions.AccessAssignmentsManage, PermissionScopes.Tenant)
            ? TenantAdministratorAuthority.DisplayName
            : "Member";
}
