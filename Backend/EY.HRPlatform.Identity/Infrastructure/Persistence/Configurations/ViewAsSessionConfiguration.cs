using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class ViewAsSessionConfiguration : IEntityTypeConfiguration<ViewAsSession>
{
    public void Configure(EntityTypeBuilder<ViewAsSession> builder)
    {
        builder.ToTable("ViewAsSessions");

        builder.HasKey(session => session.Id);

        builder.HasIndex(session => new { session.TenantId, session.ViewerUserId });

        // Both ends are memberships of the session's own tenant, by the same composite key the assignments use, so a
        // view across companies can't be stored.
        builder.HasOne<TenantMembership>()
            .WithMany()
            .HasForeignKey(session => new { session.ViewerMembershipId, session.ViewerUserId, session.TenantId })
            .HasPrincipalKey(membership => new { membership.Id, membership.UserId, membership.TenantId })
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<TenantMembership>()
            .WithMany()
            .HasForeignKey(session => new { session.TargetMembershipId, session.TargetUserId, session.TenantId })
            .HasPrincipalKey(membership => new { membership.Id, membership.UserId, membership.TenantId })
            .OnDelete(DeleteBehavior.Cascade);
    }
}
