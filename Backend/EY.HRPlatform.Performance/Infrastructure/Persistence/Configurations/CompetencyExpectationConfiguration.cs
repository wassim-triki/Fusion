using EY.HRPlatform.Performance.Domain.Settings;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class CompetencyExpectationConfiguration : IEntityTypeConfiguration<CompetencyExpectation>
{
    public void Configure(EntityTypeBuilder<CompetencyExpectation> builder)
    {
        builder.ToTable("CompetencyExpectations");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Version).IsRowVersion();
        builder.Property(item => item.Text).HasMaxLength(CompetencyExpectation.MaxTextLength).IsRequired();
        builder.Property(item => item.Source).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.HasOne<Competency>().WithMany().HasForeignKey(item => item.CompetencyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(item => new { item.TenantId, item.CompetencyId, item.FamilyId, item.LevelId }).IsUnique();
        builder.HasIndex(item => new { item.TenantId, item.FamilyId });
    }
}
