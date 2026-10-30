using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class EmploymentConfiguration : IEntityTypeConfiguration<Employment>
{
    public void Configure(EntityTypeBuilder<Employment> builder)
    {
        builder.ToTable("Employments");
        builder.HasKey(x => x.Id);

        builder.Property(x => x.TenantId).IsRequired();
        builder.Property(x => x.EmployeeId).IsRequired();
        builder.Property(x => x.EffectiveFrom).IsRequired();
        builder.Property(x => x.EffectiveTo);

        builder.Property(x => x.Status)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(x => x.EmploymentType).HasMaxLength(CompanyListValue.MaxLabelLength);
        builder.HasOne<CompanyListValue>()
            .WithMany()
            .HasForeignKey(x => x.EmploymentTypeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.Source)
            .HasConversion<string>()
            .HasMaxLength(20)
            .IsRequired();
        builder.Property(x => x.SourceReference).HasMaxLength(256);

        builder.Property(x => x.CreatedBy).HasMaxLength(256);
        builder.Property(x => x.UpdatedBy).HasMaxLength(256);

        builder.HasIndex(x => new { x.TenantId, x.EmployeeId })
            .HasDatabaseName("IX_Employments_TenantId_EmployeeId");

        // At most one active employment per employee (active = open-ended + Active status).
        builder.HasIndex(x => new { x.TenantId, x.EmployeeId })
            .IsUnique()
            .HasFilter("\"EffectiveTo\" IS NULL AND \"Status\" = 'Active'")
            .HasDatabaseName("UX_Employments_TenantId_EmployeeId_Active");

        builder.HasOne<Employee>()
            .WithMany()
            .HasForeignKey(x => x.EmployeeId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Ignore(x => x.Interval);
        builder.Ignore(x => x.IsActive);
        builder.Ignore(x => x.DomainEvents);
    }
}
