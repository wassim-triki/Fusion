using EY.HRPlatform.CoreHR.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence.Configurations;

public class EmployeeConfiguration : IEntityTypeConfiguration<Employee>
{
    public void Configure(EntityTypeBuilder<Employee> builder)
    {
        builder.ToTable("Employees");
        builder.HasKey(e => e.Id);

        // Map Version property to PostgreSQL xmin system column for optimistic concurrency.
        // xmin is automatically updated by PostgreSQL on every row modification.
        builder.Property(e => e.Version).IsRowVersion();

        builder.Property(e => e.TenantId).IsRequired();
        builder.Property(e => e.EmployeeNumber).HasMaxLength(64).IsRequired();

        builder.Property(e => e.StableEmployeeKey).HasMaxLength(64).IsRequired();

        builder.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
        builder.Property(e => e.LastName).HasMaxLength(100).IsRequired();
        builder.Property(e => e.PreferredName).HasMaxLength(100);

        // Email is normalised (trimmed + lowercased) at the domain boundary.
        // The unique index therefore operates on a consistent value without
        // a DB-level value converter.
        builder.Property(e => e.Email).HasMaxLength(256);
        builder.Property(e => e.Phone).HasMaxLength(50);

        builder.Property(e => e.Department).HasMaxLength(100);

        // Personal details (B-127): the person and HR see them; a branch manager sees only the mobile.
        builder.Property(e => e.PersonalEmail).HasMaxLength(256);
        builder.Property(e => e.HomeStreet).HasMaxLength(200);
        builder.Property(e => e.HomeCity).HasMaxLength(100);
        builder.Property(e => e.HomePostalCode).HasMaxLength(20);
        builder.Property(e => e.HomeCountry).HasMaxLength(100);
        builder.Property(e => e.PhotoKey).HasMaxLength(200);
        builder.Property(e => e.About).HasMaxLength(Employee.MaxAboutLength);
        builder.HasMany(e => e.EmergencyContacts)
            .WithOne()
            .HasForeignKey(contact => contact.EmployeeId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(e => e.EmergencyContacts).UsePropertyAccessMode(PropertyAccessMode.Field);

        // Audit fields inherited from BaseEntity
        builder.Property(e => e.CreatedBy).HasMaxLength(256);
        builder.Property(e => e.UpdatedBy).HasMaxLength(256);

        // Tenant-ready indexes (enforcement added in Feature 1.3).
        // The unique composite satisfies US-1.3.2 at the schema level now.
        builder.HasIndex(e => e.TenantId)
            .HasDatabaseName("IX_Employees_TenantId");

        builder.HasIndex(e => new { e.TenantId, e.StableEmployeeKey })
            .IsUnique()
            .HasDatabaseName("IX_Employees_TenantId_StableEmployeeKey");

        builder.HasIndex(e => new { e.TenantId, e.EmployeeNumber })
            .IsUnique()
            .HasDatabaseName("IX_Employees_TenantId_EmployeeNumber");

        // FullName is a computed property — not persisted.
        builder.Ignore(e => e.FullName);
        builder.Ignore(e => e.DisplayName);

        // DomainEvents from AggregateRoot must be explicitly ignored;
        // EF would otherwise attempt to map the public collection.
        builder.Ignore(e => e.DomainEvents);
    }
}

public sealed class EmergencyContactConfiguration : IEntityTypeConfiguration<EmergencyContact>
{
    public void Configure(EntityTypeBuilder<EmergencyContact> builder)
    {
        builder.ToTable("EmergencyContacts");
        builder.HasKey(contact => contact.Id);
        // Ids are set in the domain and the contacts reach EF through the employee's collection, so a set key must
        // still mean "new" (a generated key that is already set would be taken for an existing row).
        builder.Property(contact => contact.Id).ValueGeneratedNever();
        builder.Property(contact => contact.TenantId).IsRequired();
        builder.Property(contact => contact.Name).HasMaxLength(200).IsRequired();
        builder.Property(contact => contact.Relationship).HasMaxLength(60);
        builder.Property(contact => contact.Phone).HasMaxLength(50).IsRequired();
        builder.Property(contact => contact.CreatedBy).HasMaxLength(256);
        builder.Property(contact => contact.UpdatedBy).HasMaxLength(256);
        builder.HasIndex(contact => new { contact.EmployeeId, contact.Position })
            .HasDatabaseName("IX_EmergencyContacts_EmployeeId_Position");
    }
}
