using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class WorkAssignmentConfiguration : IEntityTypeConfiguration<WorkAssignment>
{
    public void Configure(EntityTypeBuilder<WorkAssignment> builder)
    {
        builder.ToTable("WorkAssignments");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.TenantId).IsRequired();
        builder.Property(x => x.EmploymentId).IsRequired();
        builder.Property(x => x.EmployeeId).IsRequired();
        builder.Property(x => x.OrgUnitId).IsRequired();

        builder.Property(x => x.JobTitle).HasMaxLength(150).IsRequired();
        builder.Property(x => x.WorkLocation).HasMaxLength(100);
        builder.Property(x => x.IsPrimary).IsRequired();

        builder.Property(x => x.EffectiveFrom).IsRequired();
        builder.Property(x => x.EffectiveTo);

        builder.Property(x => x.Source)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(x => x.SourceReference).HasMaxLength(256);

        builder.Property(x => x.CreatedBy).HasMaxLength(256);
        builder.Property(x => x.UpdatedBy).HasMaxLength(256);

        builder.HasIndex(x => new { x.TenantId, x.EmployeeId })
            .HasDatabaseName("IX_WorkAssignments_TenantId_EmployeeId");
        builder.HasIndex(x => new { x.TenantId, x.EmploymentId })
            .HasDatabaseName("IX_WorkAssignments_TenantId_EmploymentId");
        builder.HasIndex(x => new { x.TenantId, x.OrgUnitId })
            .HasDatabaseName("IX_WorkAssignments_TenantId_OrgUnitId");

        // At most one active primary work assignment per employee (primary + open-ended).
        builder.HasIndex(x => new { x.TenantId, x.EmployeeId })
            .IsUnique()
            .HasFilter("\"IsPrimary\" = TRUE AND \"EffectiveTo\" IS NULL")
            .HasDatabaseName("UX_WorkAssignments_TenantId_EmployeeId_ActivePrimary");

        builder.HasOne<Employment>()
            .WithMany()
            .HasForeignKey(x => x.EmploymentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Employee>()
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<OrgUnit>()
            .WithMany()
            .HasForeignKey(x => x.OrgUnitId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Job>()
            .WithMany()
            .HasForeignKey(x => x.JobId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Place>()
            .WithMany()
            .HasForeignKey(x => x.PlaceId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Ignore(x => x.Interval);
        builder.Ignore(x => x.DomainEvents);
    }
}
