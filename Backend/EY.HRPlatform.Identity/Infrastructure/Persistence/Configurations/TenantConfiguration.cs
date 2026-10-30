using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class TenantConfiguration : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> builder)
    {
        builder.ToTable("Tenants");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Name)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(t => t.Slug)
            .HasMaxLength(100)
            .IsRequired();

        builder.HasIndex(t => t.Slug)
            .IsUnique()
            .HasDatabaseName("IX_Tenants_Slug");

        builder.Property(t => t.IsActive)
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(t => t.IsArchived)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(t => t.InternalNotes)
            .HasMaxLength(4000);

        builder.Property(t => t.AdministratorActivationStatus)
            .HasConversion<string>()
            .HasMaxLength(48)
            .IsRequired();

        builder.Property(t => t.Locale)
            .HasMaxLength(Tenant.LocaleMaxLength)
            .IsRequired()
            .HasDefaultValue(Tenant.DefaultLocale);

        builder.Property(t => t.TimeZone)
            .HasMaxLength(Tenant.TimeZoneMaxLength)
            .IsRequired()
            .HasDefaultValue(Tenant.DefaultTimeZone);

        builder.Property(t => t.Industry)
            .HasMaxLength(Tenant.IndustryMaxLength);

        builder.Property(t => t.BrandColor)
            .HasMaxLength(7);

        builder.Property(t => t.LogoVersion)
            .HasMaxLength(32);

        builder.HasIndex(t => t.AdministratorActivationStatus);

        builder.HasIndex(t => t.IsActive);
        builder.HasIndex(t => t.IsArchived);
        builder.HasIndex(t => t.Name)
            .IsUnique()
            .HasDatabaseName("IX_Tenants_Name_Active")
            .HasFilter("\"IsArchived\" = false");
    }
}
