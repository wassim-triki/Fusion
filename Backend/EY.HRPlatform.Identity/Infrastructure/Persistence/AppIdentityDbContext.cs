using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Infrastructure.Persistence.Configurations;
using EY.HRPlatform.SharedKernel.Localization;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;


namespace EY.HRPlatform.Identity.Infrastructure.Persistence;

public class AppIdentityDbContext : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>
{
    private readonly ITenantContext? _tenantContext;

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantLogo> TenantLogos => Set<TenantLogo>();
    public DbSet<InviteToken> InviteTokens => Set<InviteToken>();
    public DbSet<AccessProfile> AccessProfiles => Set<AccessProfile>();
    public DbSet<AccessProfileGrant> AccessProfileGrants => Set<AccessProfileGrant>();
    public DbSet<AccessProfileRuleCondition> AccessProfileRuleConditions => Set<AccessProfileRuleCondition>();
    public DbSet<UserAccessProfile> UserAccessProfiles => Set<UserAccessProfile>();
    public DbSet<UserAccessProfileOrgUnitScope> UserAccessProfileOrgUnitScopes => Set<UserAccessProfileOrgUnitScope>();
    public DbSet<InviteAccessProfile> InviteAccessProfiles => Set<InviteAccessProfile>();
    public DbSet<AccessAuditEvent> AccessAuditEvents => Set<AccessAuditEvent>();
    public DbSet<TenantMembership> TenantMemberships => Set<TenantMembership>();
    public DbSet<TenantAdministratorAssignment> TenantAdministratorAssignments => Set<TenantAdministratorAssignment>();
    public DbSet<TenantModuleEntitlement> TenantModuleEntitlements => Set<TenantModuleEntitlement>();
    public DbSet<TenantProvisioningReceipt> TenantProvisioningReceipts => Set<TenantProvisioningReceipt>();
    public DbSet<InvitationDeliveryAttempt> InvitationDeliveryAttempts => Set<InvitationDeliveryAttempt>();
    public DbSet<TenantBootstrapAuditEvent> TenantBootstrapAuditEvents => Set<TenantBootstrapAuditEvent>();

    /// <summary>
    /// Runtime constructor with tenant context for production use.
    /// </summary>
    public AppIdentityDbContext(DbContextOptions<AppIdentityDbContext> options, ITenantContext tenantContext)
        : base(options)
    {
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// Design-time constructor for EF migrations tooling and test seeding.
    /// </summary>
    public AppIdentityDbContext(DbContextOptions<AppIdentityDbContext> options)
        : base(options)
    {
        _tenantContext = null;
    }

    /// <summary>
    /// Current tenant ID used for query filters. Returns Empty when no tenant resolved
    /// (design-time, startup seeding, or unauthenticated), which disables filtering (fail-open).
    /// </summary>
    private Guid CurrentTenantId => _tenantContext?.TenantIdOrDefault ?? Guid.Empty;

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Ensure all DateTime properties are normalized to UTC before being sent to PostgreSQL
        configurationBuilder.Properties<DateTime>()
            .HaveConversion<UtcDateTimeConverter>();

        configurationBuilder.Properties<DateTime?>()
            .HaveConversion<UtcNullableDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // All identity tables go into the "identity" schema
        builder.HasDefaultSchema("identity");

        // ApplicationUser table configuration
        builder.Entity<ApplicationUser>(entity =>
        {
            entity.Property(u => u.FirstName)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(u => u.LastName)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(u => u.Department)
                .HasMaxLength(100);

            entity.Property(u => u.JobTitle)
                .HasMaxLength(100);

            entity.Property(u => u.PreferredLanguage)
                .HasMaxLength(FusionLanguages.MaxLength);

            // The account carries no tenant. Participation is expressed only by
            // TenantMembership, so there is no account-owned tenancy left to
            // index, constrain, or accidentally read as authority. The membership
            // relationship itself is configured once, in TenantMembershipConfiguration.

            // An account links to at most one workforce employee. This used to be
            // scoped by the account's tenant column; the employee reference is
            // already tenant-unique, so the constraint stands on its own.
            entity.HasIndex(u => u.EmployeeId)
                .IsUnique()
                .HasFilter("\"EmployeeId\" IS NOT NULL");
        });

        // RefreshToken table configuration
        builder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(rt => rt.Id);

            entity.Property(rt => rt.Token)
                .HasMaxLength(500)
                .IsRequired();

            entity.HasIndex(rt => rt.Token)
                .IsUnique();

            entity.HasIndex(rt => rt.UserId);
        });

        // Tenant table configuration
        builder.ApplyConfiguration(new TenantConfiguration());
        builder.ApplyConfiguration(new TenantLogoConfiguration());

        // InviteToken table configuration
        builder.ApplyConfiguration(new InviteTokenConfiguration());
        builder.ApplyConfiguration(new AccessProfileConfiguration());
        builder.ApplyConfiguration(new AccessProfileGrantConfiguration());
        builder.ApplyConfiguration(new AccessProfileRuleConditionConfiguration());
        builder.ApplyConfiguration(new UserAccessProfileConfiguration());
        builder.ApplyConfiguration(new UserAccessProfileOrgUnitScopeConfiguration());
        builder.ApplyConfiguration(new InviteAccessProfileConfiguration());
        builder.ApplyConfiguration(new TenantMembershipConfiguration());
        builder.ApplyConfiguration(new TenantAdministratorAssignmentConfiguration());
        builder.ApplyConfiguration(new TenantModuleEntitlementConfiguration());
        builder.ApplyConfiguration(new TenantProvisioningReceiptConfiguration());
        builder.ApplyConfiguration(new InvitationDeliveryAttemptConfiguration());
        builder.ApplyConfiguration(new TenantBootstrapAuditEventConfiguration());

        // Global tenant query filters: automatically scope queries to the current tenant.
        // When CurrentTenantId is Empty (design-time/startup/no context), filters are disabled (fail-open).
        // Use IgnoreQueryFilters() for cross-tenant operations (auth, platform admin, anonymous invites).
        // An account is visible in a tenant only through an Active membership.
        // Deactivating a membership therefore removes the account from that
        // tenant's queries without deleting anything.
        builder.Entity<ApplicationUser>()
            .HasQueryFilter(u => CurrentTenantId == Guid.Empty
                || u.TenantMemberships.Any(membership =>
                    membership.TenantId == CurrentTenantId
                    && membership.Status == TenantMembershipStatus.Active));

        builder.Entity<InviteToken>()
            .HasQueryFilter(i => CurrentTenantId == Guid.Empty || i.TenantId == CurrentTenantId);

        builder.Entity<AccessProfile>()
            .HasQueryFilter(profile => CurrentTenantId == Guid.Empty || profile.TenantId == CurrentTenantId);

        builder.Entity<AccessProfileGrant>()
            .HasQueryFilter(grant => CurrentTenantId == Guid.Empty || grant.TenantId == CurrentTenantId);

        builder.Entity<AccessProfileRuleCondition>()
            .HasQueryFilter(condition => CurrentTenantId == Guid.Empty || condition.TenantId == CurrentTenantId);

        builder.Entity<UserAccessProfile>()
            .HasQueryFilter(assignment => CurrentTenantId == Guid.Empty || assignment.TenantId == CurrentTenantId);

        builder.Entity<UserAccessProfileOrgUnitScope>()
            .HasQueryFilter(scope => CurrentTenantId == Guid.Empty || scope.TenantId == CurrentTenantId);

        builder.Entity<InviteAccessProfile>()
            .HasQueryFilter(assignment => CurrentTenantId == Guid.Empty || assignment.TenantId == CurrentTenantId);

        builder.Entity<AccessAuditEvent>()
            .HasQueryFilter(auditEvent => CurrentTenantId == Guid.Empty || auditEvent.TenantId == CurrentTenantId);

        builder.Entity<TenantMembership>()
            .HasQueryFilter(membership => CurrentTenantId == Guid.Empty || membership.TenantId == CurrentTenantId);

        builder.Entity<TenantAdministratorAssignment>()
            .HasQueryFilter(assignment => CurrentTenantId == Guid.Empty || assignment.TenantId == CurrentTenantId);

        builder.Entity<TenantModuleEntitlement>()
            .HasQueryFilter(entitlement => CurrentTenantId == Guid.Empty || entitlement.TenantId == CurrentTenantId);

        builder.Entity<TenantBootstrapAuditEvent>()
            .HasQueryFilter(auditEvent => CurrentTenantId == Guid.Empty || auditEvent.TenantId == CurrentTenantId);
    }
}
