using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public sealed class ChecklistTemplateTaskConfiguration : IEntityTypeConfiguration<ChecklistTemplateTask>
{
    public void Configure(EntityTypeBuilder<ChecklistTemplateTask> builder)
    {
        builder.ToTable("ChecklistTemplateTasks");
        builder.HasKey(task => task.Id);
        builder.Property(task => task.Title).HasMaxLength(ChecklistTemplateTask.MaxTitleLength).IsRequired();
        builder.Property(task => task.Kind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(task => task.Owner).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(task => task.CreatedBy).HasMaxLength(256);
        builder.Property(task => task.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(task => new { task.TenantId, task.Kind, task.SortOrder });
    }
}

public sealed class ChecklistConfiguration : IEntityTypeConfiguration<Checklist>
{
    public void Configure(EntityTypeBuilder<Checklist> builder)
    {
        builder.ToTable("Checklists");
        builder.HasKey(checklist => checklist.Id);
        builder.Property(checklist => checklist.Kind).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(checklist => checklist.CreatedBy).HasMaxLength(256);
        builder.Property(checklist => checklist.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(checklist => new { checklist.TenantId, checklist.EmployeeId });
        builder.HasIndex(checklist => checklist.WorkforceChangeId);
        builder.HasIndex(checklist => checklist.ManagerEmployeeId);
        builder.HasOne<Employee>().WithMany().HasForeignKey(checklist => checklist.EmployeeId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(checklist => checklist.Tasks).WithOne().HasForeignKey(task => task.ChecklistId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class ChecklistTaskConfiguration : IEntityTypeConfiguration<ChecklistTask>
{
    public void Configure(EntityTypeBuilder<ChecklistTask> builder)
    {
        builder.ToTable("ChecklistTasks");
        builder.HasKey(task => task.Id);
        builder.Property(task => task.Title).HasMaxLength(ChecklistTemplateTask.MaxTitleLength).IsRequired();
        builder.Property(task => task.Owner).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(task => task.DoneByName).HasMaxLength(256);
        builder.Property(task => task.CreatedBy).HasMaxLength(256);
        builder.Property(task => task.UpdatedBy).HasMaxLength(256);
        builder.Ignore(task => task.IsDone);
        builder.HasIndex(task => new { task.TenantId, task.DueDate });
    }
}
