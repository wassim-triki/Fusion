using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class OpenRoleConfiguration : IEntityTypeConfiguration<OpenRole>
{
    public void Configure(EntityTypeBuilder<OpenRole> builder)
    {
        builder.ToTable("OpenRoles");
        builder.HasKey(role => role.Id);
        builder.Property(role => role.TenantId).IsRequired();
        builder.Property(role => role.JobTitle).HasMaxLength(OpenRole.MaxJobTitleLength).IsRequired();
        builder.Property(role => role.PlaceName).HasMaxLength(Place.MaxNameLength);
        builder.Property(role => role.ManagerEmployeeId).IsRequired();
        builder.Property(role => role.OrgUnitId).IsRequired();
        builder.Property(role => role.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(role => role.CreatedBy).HasMaxLength(256);
        builder.Property(role => role.UpdatedBy).HasMaxLength(256);
        builder.Ignore(role => role.IsActive);
        builder.HasIndex(role => new { role.TenantId, role.Status })
            .HasDatabaseName("IX_OpenRoles_TenantId_Status");
        builder.HasIndex(role => role.ManagerEmployeeId)
            .HasDatabaseName("IX_OpenRoles_ManagerEmployeeId");
        builder.HasOne<Employee>()
            .WithMany()
            .HasForeignKey(role => role.ManagerEmployeeId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<OrgUnit>()
            .WithMany()
            .HasForeignKey(role => role.OrgUnitId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Job>().WithMany().HasForeignKey(role => role.JobId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Place>().WithMany().HasForeignKey(role => role.PlaceId).OnDelete(DeleteBehavior.Restrict);
    }
}
