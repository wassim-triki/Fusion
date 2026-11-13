using EY.HRPlatform.Performance.Domain.Population;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class PopulationDefinitionConfiguration : IEntityTypeConfiguration<PopulationDefinition>
{
    public void Configure(EntityTypeBuilder<PopulationDefinition> builder)
    {
        builder.ToTable("PopulationDefinitions");
        builder.HasKey(definition => definition.Id);
        builder.Property(definition => definition.Version).IsRowVersion();

        builder.Property(definition => definition.Mode).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Ignore(definition => definition.Rules);

        // One population definition per Cycle.
        builder.HasIndex(definition => definition.CycleId).IsUnique();
        builder.HasIndex(definition => definition.TenantId);

        // The selection rule's parts are tenant-scoped child records of the definition. They are
        // modeled as owned-by-composition relationships (cascade delete) rather than EF-owned
        // collections so the aggregate reconciles cleanly across providers.
        builder.HasMany(definition => definition.OrgUnitSelections)
            .WithOne()
            .HasForeignKey(selection => selection.PopulationDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(definition => definition.Inclusions)
            .WithOne()
            .HasForeignKey(inclusion => inclusion.PopulationDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(definition => definition.Exclusions)
            .WithOne()
            .HasForeignKey(exclusion => exclusion.PopulationDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(definition => definition.OrgUnitSelections).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(definition => definition.Inclusions).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(definition => definition.Exclusions).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class PopulationOrgUnitSelectionConfiguration : IEntityTypeConfiguration<PopulationOrgUnitSelection>
{
    public void Configure(EntityTypeBuilder<PopulationOrgUnitSelection> builder)
    {
        builder.ToTable("PopulationOrgUnitSelections");
        builder.HasKey(item => item.Id);
        builder.HasIndex(item => item.PopulationDefinitionId);
        builder.HasIndex(item => new { item.PopulationDefinitionId, item.OrgUnitId }).IsUnique();
    }
}

public sealed class PopulationInclusionConfiguration : IEntityTypeConfiguration<PopulationInclusion>
{
    public void Configure(EntityTypeBuilder<PopulationInclusion> builder)
    {
        builder.ToTable("PopulationInclusions");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Reason).HasMaxLength(500);
        builder.HasIndex(item => new { item.PopulationDefinitionId, item.EmployeeId }).IsUnique();
    }
}

public sealed class PopulationExclusionConfiguration : IEntityTypeConfiguration<PopulationExclusion>
{
    public void Configure(EntityTypeBuilder<PopulationExclusion> builder)
    {
        builder.ToTable("PopulationExclusions");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Reason).IsRequired().HasMaxLength(500);
        builder.HasIndex(item => new { item.PopulationDefinitionId, item.EmployeeId }).IsUnique();
    }
}
