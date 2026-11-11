using EY.HRPlatform.Performance.Domain.Reviews;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence.Configurations;

public sealed class ReviewItemResponseConfiguration : IEntityTypeConfiguration<ReviewItemResponse>
{
    public void Configure(EntityTypeBuilder<ReviewItemResponse> builder)
    {
        builder.ToTable("ReviewItemResponses");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Kind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(item => item.SelfReflection).HasMaxLength(4000);
        builder.Property(item => item.SelfComment).HasMaxLength(2000);
        builder.Property(item => item.ManagerAssessment).HasMaxLength(4000);
        builder.Property(item => item.SelfGrade).HasPrecision(3, 2);
        builder.Property(item => item.ManagerGrade).HasPrecision(3, 2);
        builder.Property(item => item.SelfGradeReason).HasMaxLength(ReviewItemResponse.MaxGradeReason);
        builder.Property(item => item.ManagerGradeReason).HasMaxLength(ReviewItemResponse.MaxGradeReason);
        builder.HasIndex(item => item.TenantId);
        builder.HasIndex(item => new { item.TenantId, item.ReviewId, item.Kind, item.ItemId }).IsUnique();
        builder.HasOne<PerformanceReview>().WithMany(review => review.ItemResponses)
            .HasForeignKey(item => item.ReviewId).OnDelete(DeleteBehavior.Cascade);
    }
}
