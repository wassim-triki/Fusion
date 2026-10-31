using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class EmploymentTypePeriodConfiguration : IEntityTypeConfiguration<EmploymentTypePeriod>
{
    public void Configure(EntityTypeBuilder<EmploymentTypePeriod> builder)
    {
        builder.ToTable("EmploymentTypePeriods");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.EmploymentType).HasMaxLength(CompanyListValue.MaxLabelLength);
        builder.Property(item => item.CreatedBy).HasMaxLength(256);
        builder.Property(item => item.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(item => new { item.TenantId, item.EmployeeId, item.EffectiveFrom }).IsUnique();
        builder.HasIndex(item => new { item.TenantId, item.EmployeeId })
            .IsUnique().HasFilter("\"EffectiveTo\" IS NULL");
        builder.HasOne<Employee>().WithMany().HasForeignKey(item => item.EmployeeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Employment>().WithMany().HasForeignKey(item => item.EmploymentId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<CompanyListValue>().WithMany().HasForeignKey(item => item.EmploymentTypeId).OnDelete(DeleteBehavior.Restrict);
    }
}
