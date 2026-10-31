using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class EmployeeDocumentConfiguration : IEntityTypeConfiguration<EmployeeDocument>
{
    public void Configure(EntityTypeBuilder<EmployeeDocument> builder)
    {
        builder.ToTable("EmployeeDocuments");
        builder.HasKey(document => document.Id);
        builder.Property(document => document.TenantId).IsRequired();
        builder.Property(document => document.Name).HasMaxLength(EmployeeDocument.MaxNameLength).IsRequired();
        builder.Property(document => document.ContentType).HasMaxLength(100).IsRequired();
        builder.Property(document => document.StorageKey).HasMaxLength(200).IsRequired();
        builder.Property(document => document.AddedByName).HasMaxLength(256).IsRequired();
        builder.HasIndex(document => new { document.TenantId, document.EmployeeId });
        builder.HasOne<Employee>().WithMany().HasForeignKey(document => document.EmployeeId).OnDelete(DeleteBehavior.Cascade);
    }
}
