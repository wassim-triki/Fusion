using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;

public class SsoConnectionConfiguration : IEntityTypeConfiguration<SsoConnection>
{
    public void Configure(EntityTypeBuilder<SsoConnection> builder)
    {
        builder.ToTable("SsoConnections");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Id).ValueGeneratedNever();

        // One connection per company.
        builder.HasIndex(item => item.TenantId).IsUnique();
        builder.HasOne<Tenant>().WithMany().HasForeignKey(item => item.TenantId).OnDelete(DeleteBehavior.Cascade);

        builder.Property(item => item.Kind).HasConversion<string>().HasMaxLength(32);
        builder.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
        builder.Property(item => item.DisplayName).HasMaxLength(SsoConnection.DisplayNameMaxLength).IsRequired();
        builder.Property(item => item.Issuer).HasMaxLength(SsoConnection.IssuerMaxLength).IsRequired();
        builder.Property(item => item.EntraTenantId).HasMaxLength(64);
        builder.Property(item => item.ClientId).HasMaxLength(SsoConnection.ClientIdMaxLength).IsRequired();
        builder.Property(item => item.ProtectedClientSecret).HasMaxLength(4000).IsRequired();
        builder.Property(item => item.LastTestOutcome).HasMaxLength(16);
        builder.Property(item => item.LastTestEmail).HasMaxLength(256);
        builder.Property(item => item.LastTestMessage).HasMaxLength(500);
        builder.Property(item => item.Version).IsRowVersion();
    }
}

public class SsoDomainConfiguration : IEntityTypeConfiguration<SsoDomain>
{
    public void Configure(EntityTypeBuilder<SsoDomain> builder)
    {
        builder.ToTable("SsoDomains");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Domain).HasMaxLength(SsoDomain.DomainMaxLength).IsRequired();
        builder.HasIndex(item => new { item.TenantId, item.Domain }).IsUnique();

        // A domain can be proved by one company only; an unproved claim blocks nobody.
        builder.HasIndex(item => item.Domain)
            .IsUnique()
            .HasFilter("\"ProvedAt\" IS NOT NULL")
            .HasDatabaseName("IX_SsoDomains_Domain_ProvedUnique");

        builder.HasOne<SsoConnection>().WithMany().HasForeignKey(item => item.ConnectionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ExternalLoginConfiguration : IEntityTypeConfiguration<ExternalLogin>
{
    public void Configure(EntityTypeBuilder<ExternalLogin> builder)
    {
        builder.ToTable("ExternalLogins");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.Provider).HasMaxLength(16).IsRequired();
        builder.Property(item => item.Issuer).HasMaxLength(SsoConnection.IssuerMaxLength).IsRequired();
        builder.Property(item => item.Subject).HasMaxLength(256).IsRequired();
        builder.Property(item => item.EmailAtLink).HasMaxLength(256).IsRequired();

        // One identity links one account; an account has at most one link per provider (and company connection).
        builder.HasIndex(item => new { item.Provider, item.ConnectionId, item.Issuer, item.Subject })
            .IsUnique()
            .AreNullsDistinct(false);
        builder.HasIndex(item => new { item.UserId, item.Provider, item.ConnectionId })
            .IsUnique()
            .AreNullsDistinct(false);

        builder.HasOne(item => item.User).WithMany().HasForeignKey(item => item.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<SsoConnection>().WithMany().HasForeignKey(item => item.ConnectionId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class SsoFlowConfiguration : IEntityTypeConfiguration<SsoFlow>
{
    public void Configure(EntityTypeBuilder<SsoFlow> builder)
    {
        builder.ToTable("SsoFlows");
        builder.HasKey(item => item.Id);
        builder.Property(item => item.BindingHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(item => item.BindingHash).IsUnique();
        builder.HasIndex(item => item.ExpiresAt);
        builder.HasIndex(item => new { item.ActorUserId, item.Purpose });
        builder.Property(item => item.Purpose).HasConversion<string>().HasMaxLength(16);
        builder.Property(item => item.Provider).HasMaxLength(16).IsRequired();
        builder.Property(item => item.ExpectedIssuer).HasMaxLength(SsoConnection.IssuerMaxLength).IsRequired();
        builder.Property(item => item.State).HasMaxLength(64).IsRequired();
        builder.Property(item => item.Nonce).HasMaxLength(64).IsRequired();
        builder.Property(item => item.ProtectedCodeVerifier).HasMaxLength(1000).IsRequired();
        builder.Property(item => item.InvitationKind).HasMaxLength(16);
        builder.Property(item => item.ProtectedInvitationCredential).HasMaxLength(2000);
        builder.Property(item => item.LoginHint).HasMaxLength(256);
        builder.Property(item => item.ReturnTo).HasMaxLength(500).IsRequired();
        builder.Property(item => item.ResultCode).HasMaxLength(48);
        builder.Property(item => item.ResultJson).HasMaxLength(2000);
        builder.Property(item => item.ResultMethod).HasMaxLength(64);
    }
}
