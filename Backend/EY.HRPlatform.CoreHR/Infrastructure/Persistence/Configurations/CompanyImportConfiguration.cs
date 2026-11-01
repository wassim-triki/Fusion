using EY.HRPlatform.CoreHR.Features.CompanyImport;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class CompanyImportSessionConfiguration : IEntityTypeConfiguration<CompanyImportSession>
{
    public void Configure(EntityTypeBuilder<CompanyImportSession> builder)
    {
        builder.ToTable("CompanyImportSessions");
        builder.HasKey(session => session.Id);
        builder.Property(session => session.Version).IsRowVersion();
        builder.Ignore(session => session.Decisions);
        builder.Property(session => session.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(session => session.CompanyName).HasMaxLength(150).IsRequired();
        builder.Property(session => session.StartedByDisplayName).HasMaxLength(256).IsRequired();
        builder.Property(session => session.DecisionsJson).HasColumnType("jsonb").IsRequired();
        builder.Property(session => session.RequestedFingerprint).HasMaxLength(64);
        builder.Property(session => session.BringInByDisplayName).HasMaxLength(256);
        builder.Property(session => session.LockedBy).HasMaxLength(32);
        builder.Property(session => session.LastFailure).HasMaxLength(32);
        builder.Property(session => session.ResultJson).HasColumnType("jsonb");
        builder.Property(session => session.ProvenanceJson).HasColumnType("jsonb");
        builder.Property(session => session.PlanJson).HasColumnType("jsonb");
        builder.Property(session => session.RunJson).HasColumnType("jsonb");
        builder.Property(session => session.CreatedBy).HasMaxLength(256);
        builder.Property(session => session.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(session => new { session.TenantId, session.Status });
        builder.HasMany(session => session.Sources).WithOne().HasForeignKey(source => source.SessionId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(session => session.Sources).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class CompanyImportSourceConfiguration : IEntityTypeConfiguration<CompanyImportSource>
{
    public void Configure(EntityTypeBuilder<CompanyImportSource> builder)
    {
        builder.ToTable("CompanyImportSources");
        builder.HasKey(source => source.Id);
        builder.Ignore(source => source.Readings);
        builder.Ignore(source => source.Rows);
        builder.Property(source => source.FileName).HasMaxLength(255).IsRequired();
        builder.Property(source => source.Format).HasMaxLength(16).IsRequired();
        builder.Property(source => source.Sha256).HasMaxLength(64).IsRequired();
        builder.Property(source => source.SheetName).HasMaxLength(64).IsRequired();
        builder.Property(source => source.Kind).HasConversion<string>().HasMaxLength(16).IsRequired();
        builder.Property(source => source.ReadingsJson).HasColumnType("jsonb").IsRequired();
        builder.Property(source => source.CellsJson).HasColumnType("jsonb");
        builder.Property(source => source.Problem).HasMaxLength(16);
        builder.Property(source => source.CreatedBy).HasMaxLength(256);
        builder.Property(source => source.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(source => new { source.TenantId, source.SessionId });
    }
}
