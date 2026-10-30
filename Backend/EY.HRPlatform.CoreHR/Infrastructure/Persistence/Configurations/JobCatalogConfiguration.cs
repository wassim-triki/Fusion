using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class JobConfiguration : IEntityTypeConfiguration<Job>
{
    public void Configure(EntityTypeBuilder<Job> builder)
    {
        builder.ToTable("Jobs");
        builder.HasKey(job => job.Id);
        builder.Property(job => job.TenantId).IsRequired();
        builder.Property(job => job.Title).HasMaxLength(Job.MaxTitleLength).IsRequired();
        builder.Property(job => job.NormalizedTitle).HasMaxLength(Job.MaxTitleLength).IsRequired();
        builder.Property(job => job.CreatedBy).HasMaxLength(256);
        builder.Property(job => job.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(job => new { job.TenantId, job.NormalizedTitle })
            .IsUnique()
            .HasDatabaseName("UX_Jobs_TenantId_NormalizedTitle");
        builder.HasOne<CompanyListValue>().WithMany().HasForeignKey(job => job.FamilyId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<CompanyListValue>().WithMany().HasForeignKey(job => job.LevelId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PlaceConfiguration : IEntityTypeConfiguration<Place>
{
    public void Configure(EntityTypeBuilder<Place> builder)
    {
        builder.ToTable("Places");
        builder.HasKey(place => place.Id);
        builder.Property(place => place.TenantId).IsRequired();
        builder.Property(place => place.Name).HasMaxLength(Place.MaxNameLength).IsRequired();
        builder.Property(place => place.NormalizedName).HasMaxLength(Place.MaxNameLength).IsRequired();
        builder.Property(place => place.City).HasMaxLength(Place.MaxDetailLength);
        builder.Property(place => place.Country).HasMaxLength(Place.MaxDetailLength);
        builder.Property(place => place.CreatedBy).HasMaxLength(256);
        builder.Property(place => place.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(place => new { place.TenantId, place.NormalizedName })
            .IsUnique()
            .HasDatabaseName("UX_Places_TenantId_NormalizedName");
    }
}

public sealed class CompanyListValueConfiguration : IEntityTypeConfiguration<CompanyListValue>
{
    public void Configure(EntityTypeBuilder<CompanyListValue> builder)
    {
        builder.ToTable("CompanyListValues");
        builder.HasKey(value => value.Id);
        builder.Property(value => value.TenantId).IsRequired();
        builder.Property(value => value.List).HasConversion<string>().HasMaxLength(30).IsRequired();
        builder.Property(value => value.Key).HasMaxLength(CompanyListValue.MaxKeyLength).IsRequired();
        builder.Property(value => value.Label).HasMaxLength(CompanyListValue.MaxLabelLength).IsRequired();
        builder.Property(value => value.NormalizedLabel).HasMaxLength(CompanyListValue.MaxLabelLength).IsRequired();
        builder.Property(value => value.CreatedBy).HasMaxLength(256);
        builder.Property(value => value.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(value => new { value.TenantId, value.List, value.Key })
            .IsUnique()
            .HasDatabaseName("UX_CompanyListValues_TenantId_List_Key");
        builder.HasIndex(value => new { value.TenantId, value.List, value.NormalizedLabel })
            .IsUnique()
            .HasDatabaseName("UX_CompanyListValues_TenantId_List_NormalizedLabel");
    }
}

public sealed class CompanyListSeedConfiguration : IEntityTypeConfiguration<CompanyListSeed>
{
    public void Configure(EntityTypeBuilder<CompanyListSeed> builder)
    {
        builder.ToTable("CompanyListSeeds");
        builder.HasKey(seed => seed.TenantId);
    }
}
