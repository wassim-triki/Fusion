using System.Security.Claims;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.SharedKernel.Auth;

namespace EY.HRPlatform.Performance.Infrastructure.Audit;

public interface IPerformanceAudit
{
    void Record(Guid tenantId, string resourceType, Guid resourceId, Guid? cycleId, string action, object summary);
}

/// <summary>
/// Stages the entry in the command's context; never saves independently. Outside a request (the background worker, e.g.
/// a round opening on its day) the actor is Fusion itself.
/// </summary>
public sealed class PerformanceAudit(PerformanceDbContext db, IHttpContextAccessor accessor) : IPerformanceAudit
{
    public const string SystemActor = "fusion";

    public void Record(Guid tenantId, string resourceType, Guid resourceId, Guid? cycleId, string action, object summary)
    {
        var context = accessor.HttpContext;
        if (context is null)
        {
            db.AuditEntries.Add(PerformanceAuditEntry.Record(tenantId, resourceType, resourceId, cycleId, action, summary, SystemActor, null,
                $"background-{Guid.NewGuid():N}"));
            return;
        }
        var subject = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.User.FindFirstValue("sub");
        if (context.User.Identity?.IsAuthenticated != true || string.IsNullOrWhiteSpace(subject))
            throw new InvalidOperationException("An authenticated actor is required to audit this action.");
        var correlation = context.Request.Headers["X-Correlation-Id"].ToString();
        if (string.IsNullOrWhiteSpace(correlation)) correlation = context.TraceIdentifier;

        db.AuditEntries.Add(PerformanceAuditEntry.Record(tenantId, resourceType, resourceId, cycleId,
            action, summary, subject, context.User.GetEmployeeId(), correlation));
    }
}
