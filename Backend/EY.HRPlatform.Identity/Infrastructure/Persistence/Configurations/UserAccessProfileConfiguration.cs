using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class UserAccessProfileConfiguration : IEntityTypeConfiguration<UserAccessProfile>
{
    public void Configure(EntityTypeBuilder<UserAccessProfile> builder)
    {
        builder.ToTable("UserAccessProfiles");

        builder.HasKey(assignment => new { assignment.UserId, assignment.AccessProfileId });

        builder.Property(assignment => assignment.TenantMembershipId)
            .IsRequired();

        // Rows that predate holders were all chosen; the migration backfills that (no model default:
        // EF would skip writing an explicit false).
        builder.Ignore(assignment => assignment.IsHeld);

        builder.HasIndex(assignment => assignment.TenantId);
        builder.HasIndex(assignment => assignment.AccessProfileId);

        // One assignment of a given profile per membership.
        builder.HasIndex(assignment => new { assignment.TenantMembershipId, assignment.AccessProfileId })
            .IsUnique()
            .HasDatabaseName("IX_UserAccessProfiles_TenantMembershipId_AccessProfileId");

        // Restrict, not Cascade: deleting an account must never silently erase
        // membership-bound access history.
        builder.HasOne(assignment => assignment.User)
            .WithMany(user => user.AccessProfileAssignments)
            .HasForeignKey(assignment => assignment.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        // The profile relationship is configured from AccessProfileConfiguration,
        // which owns the AccessProfile -> UserAssignments navigation. Declaring it
        // again here would create a second, weaker foreign key alongside it.

        // Composite foreign key against the membership alternate key. An
        // assignment whose account or tenant disagrees with its membership cannot
        // be stored, so cross-tenant access is impossible by construction rather
        // than by convention.
        builder.HasOne(assignment => assignment.TenantMembership)
            .WithMany(membership => membership.AccessProfileAssignments)
            .HasForeignKey(assignment => new
            {
                assignment.TenantMembershipId,
                assignment.UserId,
                assignment.TenantId,
            })
            .HasPrincipalKey(membership => new
            {
                membership.Id,
                membership.UserId,
                membership.TenantId,
            })
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired();
    }
}
