using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class AccessProfileConfiguration : IEntityTypeConfiguration<AccessProfile>
{
    public void Configure(EntityTypeBuilder<AccessProfile> builder)
    {
        builder.ToTable("AccessProfiles");

        builder.HasKey(profile => profile.Id);

        // Alternate key so assignments can reference a profile through a
        // tenant-safe composite foreign key. Without it a membership in one tenant
        // could be assigned a profile belonging to another.
        builder.HasAlternateKey(profile => new { profile.Id, profile.TenantId })
            .HasName("AK_AccessProfiles_Id_TenantId");
        builder.Property(profile => profile.Version).IsRowVersion();

        builder.Property(profile => profile.Name)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(profile => profile.NormalizedName)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(profile => profile.Description)
            .HasMaxLength(280);

        builder.Property(profile => profile.Type)
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(profile => profile.IsSystemProtected)
            .IsRequired();

        builder.Property(profile => profile.HolderKind)
            .HasMaxLength(16)
            .HasDefaultValue(AccessProfileHolderKinds.Chosen)
            .IsRequired();

        builder.HasIndex(profile => new { profile.TenantId, profile.NormalizedName })
            .IsUnique()
            .HasDatabaseName("IX_AccessProfiles_TenantId_NormalizedName");

        builder.HasIndex(profile => profile.TenantId);

        builder.HasMany(profile => profile.Grants)
            .WithOne(grant => grant.AccessProfile)
            .HasForeignKey(grant => grant.AccessProfileId)
            .OnDelete(DeleteBehavior.Cascade);

        // Tenant-safe and non-cascading: an assignment cannot reference a profile
        // owned by another tenant, and deleting a profile must not silently erase
        // the assignment history that records who held it.
        builder.HasMany(profile => profile.UserAssignments)
            .WithOne(assignment => assignment.AccessProfile)
            .HasForeignKey(assignment => new
            {
                assignment.AccessProfileId,
                assignment.TenantId,
            })
            .HasPrincipalKey(profile => new
            {
                profile.Id,
                profile.TenantId,
            })
            .OnDelete(DeleteBehavior.Restrict);

        // Tenant-safe: a rule can only hang off a role of its own tenant.
        builder.HasMany(profile => profile.RuleConditions)
            .WithOne()
            .HasForeignKey(condition => new { condition.AccessProfileId, condition.TenantId })
            .HasPrincipalKey(profile => new { profile.Id, profile.TenantId })
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(profile => profile.InviteAssignments)
            .WithOne(assignment => assignment.AccessProfile)
            .HasForeignKey(assignment => assignment.AccessProfileId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
