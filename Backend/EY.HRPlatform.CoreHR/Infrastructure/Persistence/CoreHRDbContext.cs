using EY.HRPlatform.CoreHR.Infrastructure.Imports.Semantic;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Features.Employees.Import;
using EY.HRPlatform.CoreHR.Features.OrganizationImport;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Persistence;
using Microsoft.EntityFrameworkCore;


namespace EY.HRPlatform.CoreHR.Infrastructure.Persistence;

public class CoreHRDbContext : DbContext
{
    private readonly ITenantContext? _tenantContext;

    /// <summary>
    /// Runtime constructor with tenant context for production use.
    /// </summary>
    public CoreHRDbContext(DbContextOptions<CoreHRDbContext> options, ITenantContext tenantContext)
        : base(options)
    {
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// Design-time constructor for EF migrations tooling.
    /// </summary>
    public CoreHRDbContext(DbContextOptions<CoreHRDbContext> options)
        : base(options)
    {
        _tenantContext = null;
    }

    /// <summary>
    /// Current tenant ID used for query filters. Returns Empty when no tenant resolved
    /// (design-time or unauthenticated), resulting in fail-closed query behavior.
    /// </summary>
    private Guid CurrentTenantId => _tenantContext?.TenantIdOrDefault ?? Guid.Empty;

    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<EmergencyContact> EmergencyContacts => Set<EmergencyContact>();

    // Canonical workforce model (Employee -> Employment -> WorkAssignment -> ManagerRelationship).
    public DbSet<Employment> Employments => Set<Employment>();
    public DbSet<WorkAssignment> WorkAssignments => Set<WorkAssignment>();
    public DbSet<ManagerRelationship> ManagerRelationships => Set<ManagerRelationship>();
    public DbSet<WorkforceAuditEntry> WorkforceAuditEntries => Set<WorkforceAuditEntry>();
    public DbSet<EmployeeNumberAllocator> EmployeeNumberAllocators => Set<EmployeeNumberAllocator>();
    public DbSet<WorkEmailOccupancy> WorkEmailOccupancies => Set<WorkEmailOccupancy>();

    public DbSet<TenantSettings> TenantSettings => Set<TenantSettings>();
    public DbSet<OrgUnit> OrgUnits => Set<OrgUnit>();
    public DbSet<OrgUnitEffectiveState> OrgUnitEffectiveStates => Set<OrgUnitEffectiveState>();
    public DbSet<OrganizationChange> OrganizationChanges => Set<OrganizationChange>();
    public DbSet<WorkforceChange> WorkforceChanges => Set<WorkforceChange>();
    public DbSet<WorkforceChangeEffect> WorkforceChangeEffects => Set<WorkforceChangeEffect>();
    public DbSet<WorkforceChangeRequest> WorkforceChangeRequests => Set<WorkforceChangeRequest>();
    public DbSet<ChangeApprovalRule> ChangeApprovalRules => Set<ChangeApprovalRule>();
    public DbSet<CoreNotification> Notifications => Set<CoreNotification>();
    public DbSet<CoreNotificationPreference> NotificationPreferences => Set<CoreNotificationPreference>();
    public DbSet<CoreNotificationDefaults> NotificationDefaults => Set<CoreNotificationDefaults>();
    public DbSet<OpenRole> OpenRoles => Set<OpenRole>();
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<Place> Places => Set<Place>();
    public DbSet<CompanyListValue> CompanyListValues => Set<CompanyListValue>();
    public DbSet<CompanyListSeed> CompanyListSeeds => Set<CompanyListSeed>();
    public DbSet<OrganizationalUnitType> OrganizationalUnitTypes => Set<OrganizationalUnitType>();
    public DbSet<OrgUnitCodeReservation> OrgUnitCodeReservations => Set<OrgUnitCodeReservation>();
    public DbSet<SettingsAuditEvent> SettingsAuditEvents => Set<SettingsAuditEvent>();
    public DbSet<OrganizationImportSession> OrganizationImportSessions => Set<OrganizationImportSession>();
    public DbSet<OrganizationImportSource> OrganizationImportSources => Set<OrganizationImportSource>();
    public DbSet<OrganizationImportSemanticAttempt> OrganizationImportSemanticAttempts => Set<OrganizationImportSemanticAttempt>();
    public DbSet<ImportSemanticConsent> ImportSemanticConsents => Set<ImportSemanticConsent>();
    public DbSet<WorkforceImportSession> WorkforceImportSessions => Set<WorkforceImportSession>();
    public DbSet<WorkforceImportSource> WorkforceImportSources => Set<WorkforceImportSource>();
    public DbSet<WorkforceImportRow> WorkforceImportRows => Set<WorkforceImportRow>();
    public DbSet<WorkforceImportSemanticAttempt> WorkforceImportSemanticAttempts => Set<WorkforceImportSemanticAttempt>();
    public DbSet<WorkforceImportApplyOperation> WorkforceImportApplyOperations => Set<WorkforceImportApplyOperation>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>()
            .HaveConversion<UtcDateTimeConverter>();

        configurationBuilder.Properties<DateTime?>()
            .HaveConversion<UtcNullableDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasDefaultSchema("corehr");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(CoreHRDbContext).Assembly);

        // Global tenant filter: all Employee queries automatically scoped to current tenant.
        // When CurrentTenantId is Empty (design-time/no context), queries return no results.
        modelBuilder.Entity<Employee>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);

        modelBuilder.Entity<EmergencyContact>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<Employment>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkAssignment>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<ManagerRelationship>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceAuditEntry>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<EmployeeNumberAllocator>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkEmailOccupancy>()
            .HasQueryFilter(x => CurrentTenantId != Guid.Empty && x.TenantId == CurrentTenantId);

        modelBuilder.Entity<TenantSettings>()
            .HasQueryFilter(ts => CurrentTenantId != Guid.Empty && ts.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrgUnit>()
            .HasQueryFilter(o => CurrentTenantId != Guid.Empty && o.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrgUnitEffectiveState>()
            .HasQueryFilter(state => CurrentTenantId != Guid.Empty && state.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrganizationChange>()
            .HasQueryFilter(change => CurrentTenantId != Guid.Empty && change.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceChange>()
            .HasQueryFilter(change => CurrentTenantId != Guid.Empty && change.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceChangeEffect>()
            .HasQueryFilter(effect => CurrentTenantId != Guid.Empty && effect.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceChangeRequest>()
            .HasQueryFilter(request => CurrentTenantId != Guid.Empty && request.TenantId == CurrentTenantId);

        modelBuilder.Entity<ChangeApprovalRule>()
            .HasQueryFilter(rule => CurrentTenantId != Guid.Empty && rule.TenantId == CurrentTenantId);

        modelBuilder.Entity<CoreNotification>()
            .HasQueryFilter(notification => CurrentTenantId != Guid.Empty && notification.TenantId == CurrentTenantId);

        modelBuilder.Entity<CoreNotificationPreference>()
            .HasQueryFilter(preference => CurrentTenantId != Guid.Empty && preference.TenantId == CurrentTenantId);
        modelBuilder.Entity<CoreNotificationDefaults>()
            .HasQueryFilter(defaults => CurrentTenantId != Guid.Empty && defaults.TenantId == CurrentTenantId);

        modelBuilder.Entity<OpenRole>()
            .HasQueryFilter(role => CurrentTenantId != Guid.Empty && role.TenantId == CurrentTenantId);

        modelBuilder.Entity<Job>()
            .HasQueryFilter(job => CurrentTenantId != Guid.Empty && job.TenantId == CurrentTenantId);

        modelBuilder.Entity<Place>()
            .HasQueryFilter(place => CurrentTenantId != Guid.Empty && place.TenantId == CurrentTenantId);

        modelBuilder.Entity<CompanyListValue>()
            .HasQueryFilter(value => CurrentTenantId != Guid.Empty && value.TenantId == CurrentTenantId);

        modelBuilder.Entity<CompanyListSeed>()
            .HasQueryFilter(seed => CurrentTenantId != Guid.Empty && seed.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrgUnitCodeReservation>()
            .HasQueryFilter(reservation => CurrentTenantId != Guid.Empty && reservation.TenantId == CurrentTenantId);

        modelBuilder.Entity<SettingsAuditEvent>()
            .HasQueryFilter(auditEvent => CurrentTenantId != Guid.Empty && auditEvent.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrganizationImportSession>()
            .HasQueryFilter(session => CurrentTenantId != Guid.Empty && session.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrganizationImportSource>()
            .HasQueryFilter(source => CurrentTenantId != Guid.Empty && source.TenantId == CurrentTenantId);

        modelBuilder.Entity<OrganizationImportSemanticAttempt>()
            .HasQueryFilter(attempt => CurrentTenantId != Guid.Empty && attempt.TenantId == CurrentTenantId);

        modelBuilder.Entity<ImportSemanticConsent>()
            .HasQueryFilter(consent => CurrentTenantId != Guid.Empty && consent.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceImportSession>()
            .HasQueryFilter(session => CurrentTenantId != Guid.Empty && session.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceImportSource>()
            .HasQueryFilter(source => CurrentTenantId != Guid.Empty && source.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceImportRow>()
            .HasQueryFilter(row => CurrentTenantId != Guid.Empty && row.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceImportSemanticAttempt>()
            .HasQueryFilter(attempt => CurrentTenantId != Guid.Empty && attempt.TenantId == CurrentTenantId);

        modelBuilder.Entity<WorkforceImportApplyOperation>()
            .HasQueryFilter(op => CurrentTenantId != Guid.Empty && op.TenantId == CurrentTenantId);
    }
}
