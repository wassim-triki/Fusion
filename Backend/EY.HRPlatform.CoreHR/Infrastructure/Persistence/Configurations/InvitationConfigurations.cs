using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class InvitationScheduleConfiguration : IEntityTypeConfiguration<InvitationSchedule>
{
    public void Configure(EntityTypeBuilder<InvitationSchedule> builder)
    {
        builder.ToTable("InvitationSchedules");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Audience).HasConversion<string>().HasMaxLength(20);
        builder.Property(item => item.EmployeeIdsJson).HasColumnType("jsonb");
        builder.Property(item => item.CreatedBy).HasMaxLength(256);
        builder.Property(item => item.UpdatedBy).HasMaxLength(256);
        builder.Ignore(item => item.EmployeeIds);
        builder.Ignore(item => item.IsPending);
        builder.HasIndex(item => new { item.TenantId, item.SendAt });
    }
}

public sealed class InvitationAutoSendConfiguration : IEntityTypeConfiguration<InvitationAutoSend>
{
    public void Configure(EntityTypeBuilder<InvitationAutoSend> builder)
    {
        builder.ToTable("InvitationAutoSends");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Kind).HasConversion<string>().HasMaxLength(20);
        builder.HasIndex(item => new { item.TenantId, item.Kind, item.Reference }).IsUnique();
        builder.HasOne<Employee>().WithMany().HasForeignKey(item => item.EmployeeId).OnDelete(DeleteBehavior.Cascade);
    }
}
