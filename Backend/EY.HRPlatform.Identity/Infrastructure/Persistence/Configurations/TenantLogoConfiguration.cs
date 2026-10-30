using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class TenantLogoConfiguration : IEntityTypeConfiguration<TenantLogo>
{
    public void Configure(EntityTypeBuilder<TenantLogo> builder)
    {
        builder.ToTable("TenantLogos");

        builder.HasKey(logo => logo.TenantId);

        builder.Property(logo => logo.Content).IsRequired();

        builder.Property(logo => logo.Version)
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(logo => logo.UpdatedAt).IsRequired();

        builder.HasOne<Tenant>()
            .WithOne()
            .HasForeignKey<TenantLogo>(logo => logo.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
