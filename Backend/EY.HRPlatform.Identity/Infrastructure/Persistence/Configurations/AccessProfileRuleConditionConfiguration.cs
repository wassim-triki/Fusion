using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public sealed class AccessProfileRuleConditionConfiguration : IEntityTypeConfiguration<AccessProfileRuleCondition>
{
    public void Configure(EntityTypeBuilder<AccessProfileRuleCondition> builder)
    {
        builder.ToTable("AccessProfileRuleConditions");

        builder.HasKey(condition => new { condition.AccessProfileId, condition.Kind, condition.TargetId });

        builder.Property(condition => condition.Kind)
            .HasMaxLength(16)
            .IsRequired();

        builder.HasIndex(condition => condition.TenantId);
    }
}
