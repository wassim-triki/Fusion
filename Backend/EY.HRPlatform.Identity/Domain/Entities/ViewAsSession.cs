using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.Identity.Domain.Entities;

/// <summary>
/// An administrator seeing Fusion as someone in their company (D-25): read-only, for a short while, recorded. The
/// token it hands out is the person's own authority and works only while this row is open, unexpired, and its
/// viewer is still an administrator.
/// </summary>
public class ViewAsSession : ITenantEntity
{
    /// <summary>How long one view lasts before Fusion brings the administrator back.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);

    public Guid Id { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid ViewerUserId { get; private set; }

    public Guid ViewerMembershipId { get; private set; }

    public Guid TargetUserId { get; private set; }

    public Guid TargetMembershipId { get; private set; }

    public DateTime StartedAt { get; private set; }

    public DateTime ExpiresAt { get; private set; }

    public DateTime? EndedAt { get; private set; }

    private ViewAsSession() { }

    public static ViewAsSession Start(
        Guid tenantId, Guid viewerUserId, Guid viewerMembershipId, Guid targetUserId, Guid targetMembershipId, DateTime now)
        => new()
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            ViewerUserId = viewerUserId,
            ViewerMembershipId = viewerMembershipId,
            TargetUserId = targetUserId,
            TargetMembershipId = targetMembershipId,
            StartedAt = now,
            ExpiresAt = now + Lifetime,
        };

    public void End(DateTime now) => EndedAt ??= now;
}
