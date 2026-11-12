using EY.HRPlatform.Performance.Domain.Cycles;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class PerformanceCycleConfiguration : IEntityTypeConfiguration<PerformanceCycle>
{
    public void Configure(EntityTypeBuilder<PerformanceCycle> builder)
    {
        builder.ToTable("PerformanceCycles");
        builder.HasKey(cycle => cycle.Id);
        builder.Property(cycle => cycle.Version).IsRowVersion();

        builder.Property(cycle => cycle.Name).IsRequired().HasMaxLength(200);
        builder.Property(cycle => cycle.Description).HasMaxLength(1000);
        builder.Property(cycle => cycle.State).HasConversion<string>().HasMaxLength(20).IsRequired();

        builder.HasIndex(cycle => cycle.TenantId);

        // One Active Cycle per tenant, enforced by the database: the slot is the TenantId
        // while Active and NULL otherwise, so a partial unique index rejects a second Active.
        builder.HasIndex(cycle => cycle.ActiveTenantSlot)
            .IsUnique()
            .HasFilter("\"ActiveTenantSlot\" IS NOT NULL");

        // The activation snapshot is a write-once composed child (one per Cycle), set when the
        // Cycle activates. Modeled as a related entity (not EF-owned) so it reconciles cleanly
        // when attached to an already-persisted Cycle.
        builder.HasOne(cycle => cycle.ActivationSnapshot)
            .WithOne()
            .HasForeignKey<ActivationSnapshot>(snapshot => snapshot.CycleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(cycle => cycle.ActivationSnapshot).UsePropertyAccessMode(PropertyAccessMode.Property);
    }
}

public sealed class ActivationSnapshotConfiguration : IEntityTypeConfiguration<ActivationSnapshot>
{
    public void Configure(EntityTypeBuilder<ActivationSnapshot> builder)
    {
        builder.ToTable("ActivationSnapshots");
        builder.HasKey(snapshot => snapshot.Id);
        builder.HasIndex(snapshot => snapshot.CycleId).IsUnique();
        builder.Property(snapshot => snapshot.CycleName).IsRequired().HasMaxLength(200);
        builder.Property(snapshot => snapshot.SettingsJson).HasColumnType("jsonb").IsRequired();
        builder.Property(snapshot => snapshot.PopulationRuleJson).HasColumnType("jsonb").IsRequired();
        builder.Property(snapshot => snapshot.RosterJson).HasColumnType("jsonb").IsRequired();
        builder.Property(snapshot => snapshot.StrategyJson).HasColumnType("jsonb").IsRequired();
    }
}
