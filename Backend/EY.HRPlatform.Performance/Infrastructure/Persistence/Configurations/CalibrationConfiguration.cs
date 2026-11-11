using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class CalibrationSessionConfiguration : IEntityTypeConfiguration<CalibrationSession>
{
    public void Configure(EntityTypeBuilder<CalibrationSession> builder)
    {
        builder.ToTable("CalibrationSessions");
        builder.HasKey(session => session.Id);
        builder.Property(session => session.Version).IsRowVersion();
        builder.Ignore(session => session.Bands);
        builder.HasIndex(session => session.TenantId);
        // One session per round, enforced by the database rather than request timing.
        builder.HasIndex(session => new { session.TenantId, session.ReviewRoundId }).IsUnique();
        builder.HasOne<ReviewRound>().WithMany().HasForeignKey(session => session.ReviewRoundId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class CalibrationSubjectConfiguration : IEntityTypeConfiguration<CalibrationSubject>
{
    public void Configure(EntityTypeBuilder<CalibrationSubject> builder)
    {
        builder.ToTable("CalibrationSubjects");
        builder.HasKey(subject => subject.Id);
        builder.Property(subject => subject.Version).IsRowVersion();
        builder.Property(subject => subject.Rationale).HasMaxLength(2000);
        builder.Ignore(subject => subject.CurrentRating);
        builder.Ignore(subject => subject.IsAdjusted);
        builder.Ignore(subject => subject.IsDecided);
        builder.HasIndex(subject => subject.TenantId);
        builder.HasIndex(subject => new { subject.SessionId, subject.ReviewId }).IsUnique();
        builder.HasOne<CalibrationSession>().WithMany().HasForeignKey(subject => subject.SessionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PerformanceReview>().WithMany().HasForeignKey(subject => subject.ReviewId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class CalibrationAdjustmentConfiguration : IEntityTypeConfiguration<CalibrationAdjustment>
{
    public void Configure(EntityTypeBuilder<CalibrationAdjustment> builder)
    {
        builder.ToTable("CalibrationAdjustments");
        builder.HasKey(adjustment => adjustment.Id);
        builder.Property(adjustment => adjustment.ActorDisplayName).IsRequired().HasMaxLength(300);
        builder.Property(adjustment => adjustment.Rationale).HasMaxLength(2000);
        builder.HasIndex(adjustment => adjustment.TenantId);
        builder.HasIndex(adjustment => new { adjustment.SubjectId, adjustment.At });
        builder.HasOne<CalibrationSubject>().WithMany().HasForeignKey(adjustment => adjustment.SubjectId).OnDelete(DeleteBehavior.Restrict);
    }
}
