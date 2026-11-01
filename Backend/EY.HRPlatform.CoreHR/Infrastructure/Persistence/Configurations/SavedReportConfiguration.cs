using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class SavedReportConfiguration : IEntityTypeConfiguration<SavedReport>
{
    public void Configure(EntityTypeBuilder<SavedReport> builder)
    {
        builder.ToTable("SavedReports");
        builder.HasKey(report => report.Id);
        builder.Property(report => report.Name).HasMaxLength(120).IsRequired();
        builder.Property(report => report.DefinitionJson).IsRequired();
        builder.HasIndex(report => new { report.TenantId, report.OwnerId });
        builder.HasMany(report => report.Shares).WithOne().HasForeignKey(share => share.ReportId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class ReportShareConfiguration : IEntityTypeConfiguration<ReportShare>
{
    public void Configure(EntityTypeBuilder<ReportShare> builder)
    {
        builder.ToTable("ReportShares");
        builder.HasKey(share => new { share.ReportId, share.RoleId });
    }
}
