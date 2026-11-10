using EY.HRPlatform.Performance.Domain.Objectives;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class ObjectiveConfiguration : IEntityTypeConfiguration<Objective>
{
    public void Configure(EntityTypeBuilder<Objective> builder)
    {
        builder.ToTable("Objectives");
        builder.HasKey(objective => objective.Id);
        builder.Property(objective => objective.Version).IsRowVersion();

        builder.Property(objective => objective.Title).IsRequired().HasMaxLength(300);
        builder.Property(objective => objective.Description).HasMaxLength(2000);
        builder.Property(objective => objective.OrgUnitName).HasMaxLength(300);
        builder.Property(objective => objective.OwnershipScope).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(objective => objective.State).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(objective => objective.ProgressSource).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(objective => objective.PlanWeight).HasColumnType("numeric(6,2)");
        builder.Property(objective => objective.CurrentPercentage).HasColumnType("numeric(9,4)");
        builder.Property(objective => objective.CurrentActual).HasColumnType("numeric(18,4)");
        builder.Property(objective => objective.CurrentStatus).HasConversion<string>().HasMaxLength(20);

        builder.HasIndex(objective => objective.TenantId);
        builder.HasIndex(objective => objective.CycleId);
        builder.HasIndex(objective => objective.ParentObjectiveId);
        builder.HasIndex(objective => objective.EmployeePlanId);

        // Direct measurement is an optional owned value: present when the progress source is Direct,
        // absent (null Method column signals absence) when the objective is Calculated.
        builder.OwnsOne(objective => objective.Measurement, measurement =>
        {
            measurement.Property(item => item.Method).HasConversion<string>().HasMaxLength(30);
            measurement.Property(item => item.Unit).HasMaxLength(60);
            measurement.Ignore(item => item.Direction);
            measurement.Property(item => item.Baseline).HasColumnType("numeric(18,4)");
            measurement.Property(item => item.Target).HasColumnType("numeric(18,4)");

            measurement.OwnsMany(item => item.Milestones, milestone =>
            {
                milestone.ToTable("ObjectiveMilestones");
                milestone.HasKey(item => item.Id);
                // Ids are assigned in the domain. Without this, a rebuilt measurement's new milestones look
                // like existing rows (key already set) and save as UPDATEs that hit nothing.
                milestone.Property(item => item.Id).ValueGeneratedNever();
                milestone.WithOwner().HasForeignKey(nameof(ObjectiveMilestone.ObjectiveId));
                milestone.Property(item => item.Title).IsRequired().HasMaxLength(300);
                milestone.Property(item => item.Weight).HasColumnType("numeric(6,2)").IsRequired();
                milestone.HasIndex(item => item.ObjectiveId);
            });
        });
        builder.Navigation(objective => objective.Measurement).IsRequired(false);

        // Configured contribution set for a calculated organizational objective.
        builder.HasMany(objective => objective.ContributionLinks)
            .WithOne()
            .HasForeignKey(link => link.ObjectiveId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(objective => objective.ContributionLinks).AutoInclude(false);
    }
}

public sealed class ContributionLinkConfiguration : IEntityTypeConfiguration<ContributionLink>
{
    public void Configure(EntityTypeBuilder<ContributionLink> builder)
    {
        builder.ToTable("ObjectiveContributionLinks");
        builder.HasKey(link => link.Id);
        builder.Property(link => link.Weight).HasColumnType("numeric(6,2)").IsRequired();
        builder.HasIndex(link => link.ObjectiveId);
        builder.HasIndex(link => new { link.ObjectiveId, link.ChildObjectiveId }).IsUnique();
    }
}
