using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class WorkforceChangeRequestConfiguration : IEntityTypeConfiguration<WorkforceChangeRequest>
{
    public void Configure(EntityTypeBuilder<WorkforceChangeRequest> builder)
    {
        builder.ToTable("WorkforceChangeRequests");
        builder.HasKey(request => request.Id);
        builder.Property(request => request.Version).IsRowVersion();
        builder.Property(request => request.TenantId).IsRequired();
        builder.Property(request => request.SubjectEmployeeId).IsRequired();
        builder.Property(request => request.Kind).HasConversion<string>().HasMaxLength(30).IsRequired();
        builder.Property(request => request.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(request => request.Types).HasMaxLength(100).IsRequired();
        builder.Property(request => request.PayloadJson).HasColumnType("jsonb").IsRequired();
        builder.Property(request => request.PreviewJson).HasColumnType("jsonb").IsRequired();
        builder.Property(request => request.Basis).HasMaxLength(400).IsRequired();
        builder.Property(request => request.Description).HasMaxLength(WorkforceChangeRequest.MaxDescriptionLength);
        builder.Property(request => request.Note).HasMaxLength(WorkforceChangeRequest.MaxNoteLength);
        builder.Property(request => request.Reason).HasMaxLength(CompanyListValue.MaxLabelLength);
        builder.Property(request => request.RequestedByUserId).HasMaxLength(64).IsRequired();
        builder.Property(request => request.RequestedByName).HasMaxLength(256).IsRequired();
        builder.Property(request => request.DecidedByUserId).HasMaxLength(64);
        builder.Property(request => request.DecidedByName).HasMaxLength(256);
        builder.Property(request => request.DeclineReason).HasMaxLength(WorkforceChangeRequest.MaxDeclineReasonLength);
        builder.Property(request => request.CreatedBy).HasMaxLength(256);
        builder.Property(request => request.UpdatedBy).HasMaxLength(256);
        builder.Ignore(request => request.TypeList);
        builder.HasIndex(request => new { request.TenantId, request.Status, request.CreatedAt })
            .HasDatabaseName("IX_WorkforceChangeRequests_TenantId_Status_CreatedAt");
        builder.HasIndex(request => new { request.SubjectEmployeeId, request.Status })
            .HasDatabaseName("IX_WorkforceChangeRequests_SubjectEmployeeId_Status");
        builder.HasOne<Employee>()
            .WithMany()
            .HasForeignKey(request => request.SubjectEmployeeId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class ChangeApprovalRuleConfiguration : IEntityTypeConfiguration<ChangeApprovalRule>
{
    public void Configure(EntityTypeBuilder<ChangeApprovalRule> builder)
    {
        builder.ToTable("ChangeApprovalRules");
        builder.HasKey(rule => rule.Id);
        builder.Property(rule => rule.TenantId).IsRequired();
        builder.Property(rule => rule.Type).HasMaxLength(30).IsRequired();
        builder.Property(rule => rule.CreatedBy).HasMaxLength(256);
        builder.Property(rule => rule.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(rule => new { rule.TenantId, rule.Type }).IsUnique()
            .HasDatabaseName("IX_ChangeApprovalRules_TenantId_Type");
    }
}
