using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class EmployeeFieldCatalogConfiguration : IEntityTypeConfiguration<EmployeeFieldCatalog>
{
    public void Configure(EntityTypeBuilder<EmployeeFieldCatalog> builder)
    {
        builder.ToTable("EmployeeFieldCatalogs");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Version).IsRowVersion();
        builder.HasIndex(item => item.TenantId).IsUnique();
    }
}

public sealed class EmployeeFieldDefinitionConfiguration : IEntityTypeConfiguration<EmployeeFieldDefinition>
{
    public void Configure(EntityTypeBuilder<EmployeeFieldDefinition> builder)
    {
        builder.ToTable("EmployeeFieldDefinitions");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Key).HasMaxLength(EmployeeFieldDefinition.MaxKeyLength);
        builder.Property(item => item.Label).HasMaxLength(EmployeeFieldDefinition.MaxLabelLength);
        builder.Property(item => item.SourceKey).HasMaxLength(80);
        builder.Property(item => item.GalleryKey).HasMaxLength(80);
        builder.HasIndex(item => new { item.TenantId, item.Key }).IsUnique();
        builder.HasIndex(item => new { item.TenantId, item.Area, item.SortOrder });
        builder.HasOne<EmployeeFieldCatalog>().WithMany().HasForeignKey(item => item.CatalogId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class EmployeeFieldValueConfiguration : IEntityTypeConfiguration<EmployeeFieldValue>
{
    public void Configure(EntityTypeBuilder<EmployeeFieldValue> builder)
    {
        builder.ToTable("EmployeeFieldValues");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.ValueJson).HasColumnType("jsonb");
        builder.HasIndex(item => new { item.TenantId, item.EmployeeId, item.FieldId }).IsUnique();
        builder.HasOne<Employee>().WithMany().HasForeignKey(item => item.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<EmployeeFieldDefinition>().WithMany().HasForeignKey(item => item.FieldId).OnDelete(DeleteBehavior.Cascade);
    }
}
