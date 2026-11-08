using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class InviteTokenConfiguration : IEntityTypeConfiguration<InviteToken>
{
    public void Configure(EntityTypeBuilder<InviteToken> builder)
    {
        builder.ToTable("InviteTokens");

        builder.HasKey(i => i.Id);

        // Recovery serializes concurrent transitions with a row lock rather than a
        // version column; see BootstrapInvitationRecoveryService. That keeps the
        // schema unchanged, since a stored version would add a column purely to
        // coordinate two administrators pressing a button at the same moment.

        // Alternate key so the provisioning receipt can bind its bootstrap
        // invitation through a tenant-safe composite foreign key.
        builder.HasAlternateKey(i => new { i.Id, i.TenantId })
            .HasName("AK_InviteTokens_Id_TenantId");

        // Legacy workforce credential. Organization-bootstrap invitations store
        // NULL here and carry a selector plus digest instead, so no bootstrap
        // secret is ever held at rest.
        builder.Property(i => i.Token)
            .HasMaxLength(64); // 32 bytes base64url ≈ 43 chars, allow headroom

        builder.Property(i => i.Purpose)
            .HasConversion<string>()
            .HasMaxLength(48)
            .IsRequired();

        builder.Property(i => i.CredentialSelector)
            .HasMaxLength(64);

        builder.Property(i => i.CredentialDigest)
            .HasMaxLength(128);

        builder.Property(i => i.Email)
            .HasMaxLength(256)
            .IsRequired();

        builder.Property(i => i.Role)
            .HasMaxLength(50)
            .IsRequired();

        builder.Property(i => i.FirstName)
            .HasMaxLength(100);

        builder.Property(i => i.LastName)
            .HasMaxLength(100);

        builder.Property(i => i.DeliveryStatus)
            .HasMaxLength(32);

        builder.Property(i => i.DeliveryMessage)
            .HasMaxLength(512);

        builder.Property(i => i.DeliveryRecordedAt);

        builder.Property(i => i.IsRevoked)
            .IsRequired()
            .HasDefaultValue(false);

        // Unique index on the legacy workforce token, filtered so the many
        // bootstrap invitations with NULL tokens do not collide.
        builder.HasIndex(i => i.Token)
            .IsUnique()
            .HasFilter("\"Token\" IS NOT NULL");

        // Bootstrap credential lookup handle. Unique so a selector resolves to at
        // most one invitation; the selector alone proves nothing.
        builder.HasIndex(i => i.CredentialSelector)
            .IsUnique()
            .HasFilter("\"CredentialSelector\" IS NOT NULL")
            .HasDatabaseName("IX_InviteTokens_CredentialSelector");

        builder.HasIndex(i => new { i.TenantId, i.Purpose })
            .HasDatabaseName("IX_InviteTokens_TenantId_Purpose");

        // At most one live organization-bootstrap invitation per tenant.
        //
        // The filter cannot test expiry, because expiry is a moving target and a
        // partial index predicate must be immutable. An Expired invitation
        // therefore still occupies this slot, which makes the invariant explicit
        // for recovery: reissuing after expiry or revocation must mark the
        // predecessor Superseded in the same transaction as it creates the
        // replacement, rather than leaving two live rows for one tenant.
        //
        // Declared through the named overload, as are the other filtered indexes
        // over these same columns. EF keys an index by its property set, so the
        // expression form would silently collapse them into one and quietly drop
        // whichever was declared first.
        builder.HasIndex([nameof(InviteToken.TenantId)], "IX_InviteTokens_TenantId_BootstrapPending")
            .IsUnique()
            .HasFilter(
                $"\"Purpose\" = '{nameof(Domain.Enums.InvitationPurpose.OrganizationBootstrap)}' "
                + "AND \"AcceptedAt\" IS NULL AND \"IsRevoked\" = false AND \"SupersededAt\" IS NULL");

        builder.HasOne<InviteToken>()
            .WithMany()
            .HasForeignKey(i => i.PredecessorInvitationId)
            .OnDelete(DeleteBehavior.Restrict);

        // Index for listing invites by tenant
        builder.HasIndex([nameof(InviteToken.TenantId)], "IX_InviteTokens_TenantId");

        builder.HasIndex(
            [nameof(InviteToken.TenantId), nameof(InviteToken.EmployeeId)],
            "IX_InviteTokens_TenantId_EmployeeId");

        // Filtered unique index to prevent duplicate pending invites per {TenantId, Email}.
        // Active invites = not accepted, not revoked. Scoped to workforce purpose so
        // bootstrap lineage (replace and reissue) is governed only by the bootstrap
        // index below and the two schemes cannot block each other.
        builder.HasIndex(
                [nameof(InviteToken.TenantId), nameof(InviteToken.Email)],
                "IX_InviteTokens_TenantId_Email_Pending")
            .IsUnique()
            .HasFilter(
                $"\"Purpose\" = '{nameof(Domain.Enums.InvitationPurpose.WorkforceAccount)}' "
                + "AND \"AcceptedAt\" IS NULL AND \"IsRevoked\" = false");

        // At most one pending recovery per tenant, whatever the address. A second
        // recovery while one is in flight would put two people on a path to the
        // same tenant's administration.
        builder.HasIndex([nameof(InviteToken.TenantId)], "IX_InviteTokens_TenantId_RecoveryPending")
            .IsUnique()
            .HasFilter(
                $"\"Purpose\" = '{nameof(Domain.Enums.InvitationPurpose.TenantAdministratorRecovery)}' "
                + "AND \"AcceptedAt\" IS NULL AND \"IsRevoked\" = false AND \"SupersededAt\" IS NULL");

        builder.HasIndex(
                [nameof(InviteToken.TenantId), nameof(InviteToken.EmployeeId)],
                "IX_InviteTokens_TenantId_EmployeeId_Pending")
            .IsUnique()
            .HasFilter("\"EmployeeId\" IS NOT NULL AND \"AcceptedAt\" IS NULL AND \"IsRevoked\" = false");

        // Foreign key to Tenant
        builder.HasOne(i => i.Tenant)
            .WithMany()
            .HasForeignKey(i => i.TenantId)
            .OnDelete(DeleteBehavior.Restrict)
            .IsRequired();
    }
}
