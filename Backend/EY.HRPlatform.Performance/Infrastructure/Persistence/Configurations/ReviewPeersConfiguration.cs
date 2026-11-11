using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class ReviewQuestionConfiguration : IEntityTypeConfiguration<ReviewQuestion>
{
    public void Configure(EntityTypeBuilder<ReviewQuestion> builder)
    {
        builder.ToTable("ReviewQuestions");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Version).IsRowVersion();
        builder.Property(item => item.Text).HasMaxLength(ReviewQuestion.MaxLength).IsRequired();
        builder.Property(item => item.Audience).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(item => item.State).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.Audience, item.SortOrder });
    }
}

public sealed class ReviewRoundQuestionConfiguration : IEntityTypeConfiguration<ReviewRoundQuestion>
{
    public void Configure(EntityTypeBuilder<ReviewRoundQuestion> builder)
    {
        builder.ToTable("ReviewRoundQuestions");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Audience).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewRoundId, item.QuestionId }).IsUnique();
        builder.HasOne<ReviewRound>().WithMany(round => round.Questions).HasForeignKey(item => item.ReviewRoundId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ReviewQuestion>().WithMany().HasForeignKey(item => item.QuestionId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ReviewQuestionSnapshotConfiguration : IEntityTypeConfiguration<ReviewQuestionSnapshot>
{
    public void Configure(EntityTypeBuilder<ReviewQuestionSnapshot> builder)
    {
        builder.ToTable("ReviewQuestionSnapshots");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Audience).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(item => item.Text).HasMaxLength(ReviewQuestion.MaxLength).IsRequired();
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewRoundId, item.QuestionId }).IsUnique();
        builder.HasOne<ReviewRound>().WithMany().HasForeignKey(item => item.ReviewRoundId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class ReviewQuestionAnswerConfiguration : IEntityTypeConfiguration<ReviewQuestionAnswer>
{
    public void Configure(EntityTypeBuilder<ReviewQuestionAnswer> builder)
    {
        builder.ToTable("ReviewQuestionAnswers");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Author).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(item => item.Text).HasMaxLength(ReviewQuestionAnswer.MaxLength).IsRequired();
        builder.Property(item => item.CitationsJson).HasColumnType("jsonb");
        builder.Ignore(item => item.Citations);
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewId, item.QuestionSnapshotId, item.Author }).IsUnique();
        builder.HasOne<PerformanceReview>().WithMany(review => review.Answers).HasForeignKey(item => item.ReviewId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ReviewQuestionSnapshot>().WithMany().HasForeignKey(item => item.QuestionSnapshotId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PeerNominationConfiguration : IEntityTypeConfiguration<PeerNomination>
{
    public void Configure(EntityTypeBuilder<PeerNomination> builder)
    {
        builder.ToTable("PeerNominations");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.DisplayName).HasMaxLength(300).IsRequired();
        builder.Property(item => item.Source).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewId, item.EmployeeId }).IsUnique();
        builder.HasOne<PerformanceReview>().WithMany(review => review.PeerNominations).HasForeignKey(item => item.ReviewId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class PeerRequestConfiguration : IEntityTypeConfiguration<PeerRequest>
{
    public void Configure(EntityTypeBuilder<PeerRequest> builder)
    {
        builder.ToTable("PeerRequests");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Version).IsRowVersion();
        builder.Property(item => item.PeerDisplayName).HasMaxLength(300).IsRequired();
        builder.Property(item => item.SubjectDisplayName).HasMaxLength(300).IsRequired();
        builder.Property(item => item.State).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(item => item.DeclineNote).HasMaxLength(PeerRequest.MaxDeclineNote);
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewId, item.PeerEmployeeId }).IsUnique();
        builder.HasIndex(item => new { item.TenantId, item.PeerEmployeeId, item.State });
        builder.HasIndex(item => new { item.TenantId, item.ReviewRoundId, item.State });
        builder.HasOne<PerformanceReview>().WithMany().HasForeignKey(item => item.ReviewId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ReviewRound>().WithMany().HasForeignKey(item => item.ReviewRoundId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class PeerAnswerConfiguration : IEntityTypeConfiguration<PeerAnswer>
{
    public void Configure(EntityTypeBuilder<PeerAnswer> builder)
    {
        builder.ToTable("PeerAnswers");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Text).HasMaxLength(PeerRequest.MaxAnswerLength).IsRequired();
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.PeerRequestId, item.QuestionSnapshotId }).IsUnique();
        builder.HasOne<PeerRequest>().WithMany(request => request.Answers).HasForeignKey(item => item.PeerRequestId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ReviewQuestionSnapshot>().WithMany().HasForeignKey(item => item.QuestionSnapshotId).OnDelete(DeleteBehavior.Restrict);
    }
}

public sealed class ReviewDueDateMoveConfiguration : IEntityTypeConfiguration<ReviewDueDateMove>
{
    public void Configure(EntityTypeBuilder<ReviewDueDateMove> builder)
    {
        builder.ToTable("ReviewDueDateMoves");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Stage).HasConversion<string>().HasMaxLength(30).IsRequired();
        builder.Property(item => item.Reason).HasMaxLength(ReviewDueDateMove.MaxReason).IsRequired();
        builder.Property(item => item.ActorName).HasMaxLength(300).IsRequired();
        builder.Property(item => item.SubjectDisplayName).HasMaxLength(300);
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewRoundId, item.MovedAt });
        builder.HasOne<ReviewRound>().WithMany().HasForeignKey(item => item.ReviewRoundId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PerformanceReview>().WithMany().HasForeignKey(item => item.ReviewId).OnDelete(DeleteBehavior.Restrict);
    }
}
