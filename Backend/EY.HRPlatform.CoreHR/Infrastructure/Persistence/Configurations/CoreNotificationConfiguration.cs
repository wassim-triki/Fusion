using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class CoreNotificationConfiguration : IEntityTypeConfiguration<CoreNotification>
{
    public void Configure(EntityTypeBuilder<CoreNotification> builder)
    {
        builder.ToTable("CoreNotifications");
        builder.HasKey(notification => notification.Id);
        builder.Property(notification => notification.TenantId).IsRequired();
        builder.Property(notification => notification.RecipientEmployeeId).IsRequired();
        builder.Property(notification => notification.Kind).HasConversion<string>().HasMaxLength(30).IsRequired();
        builder.Property(notification => notification.TitleKey).HasMaxLength(100).IsRequired();
        builder.Property(notification => notification.ContextKey).HasMaxLength(100);
        builder.Property(notification => notification.ValuesJson).HasColumnType("jsonb").IsRequired();
        builder.Property(notification => notification.ActorName).HasMaxLength(256);
        builder.Property(notification => notification.Href).HasMaxLength(500).IsRequired();
        builder.Property(notification => notification.DedupeKey).HasMaxLength(200).IsRequired();
        builder.Property(notification => notification.EmailSkippedReason).HasMaxLength(100);
        builder.Property(notification => notification.EmailLastError).HasMaxLength(200);
        builder.Ignore(notification => notification.Values);
        builder.Ignore(notification => notification.EmailPending);
        builder.HasIndex(notification => new { notification.TenantId, notification.DedupeKey }).IsUnique()
            .HasDatabaseName("IX_CoreNotifications_TenantId_DedupeKey");
        builder.HasIndex(notification => new { notification.TenantId, notification.RecipientEmployeeId, notification.OccurredAt })
            .HasDatabaseName("IX_CoreNotifications_Recipient_OccurredAt");
        builder.HasIndex(notification => notification.EmailNextAttemptAt)
            .HasFilter("\"EmailSentAt\" IS NULL AND \"EmailSkippedReason\" IS NULL")
            .HasDatabaseName("IX_CoreNotifications_EmailPending");
    }
}

public sealed class CoreNotificationPreferenceConfiguration : IEntityTypeConfiguration<CoreNotificationPreference>
{
    public void Configure(EntityTypeBuilder<CoreNotificationPreference> builder)
    {
        builder.ToTable("CoreNotificationPreferences");
        builder.HasKey(preference => preference.Id);
        builder.Property(preference => preference.TenantId).IsRequired();
        builder.Property(preference => preference.RecipientEmployeeId).IsRequired();
        builder.Property(preference => preference.EmailOff).IsRequired();
        builder.Property(preference => preference.EmailOn).IsRequired();
        builder.Property(preference => preference.Version).IsConcurrencyToken();
        builder.HasIndex(preference => new { preference.TenantId, preference.RecipientEmployeeId }).IsUnique()
            .HasDatabaseName("IX_CoreNotificationPreferences_TenantId_Recipient");
    }
}

public sealed class CoreNotificationDefaultsConfiguration : IEntityTypeConfiguration<CoreNotificationDefaults>
{
    public void Configure(EntityTypeBuilder<CoreNotificationDefaults> builder)
    {
        builder.ToTable("CoreNotificationDefaults");
        builder.HasKey(defaults => defaults.Id);
        builder.Property(defaults => defaults.TenantId).IsRequired();
        builder.Property(defaults => defaults.Required).IsRequired();
        builder.Property(defaults => defaults.Off).IsRequired();
        builder.Property(defaults => defaults.Version).IsConcurrencyToken();
        // One row per tenant.
        builder.HasIndex(defaults => defaults.TenantId).IsUnique();
    }
}
