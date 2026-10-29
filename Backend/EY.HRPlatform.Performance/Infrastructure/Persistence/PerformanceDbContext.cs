using EY.HRPlatform.Performance.Domain.Conversations;
using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Domain.Audit;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Development;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Plans;
using EY.HRPlatform.Performance.Domain.Population;
using EY.HRPlatform.Performance.Domain.Progress;
using EY.HRPlatform.Performance.Domain.Calibration;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Performance.Infrastructure.Persistence;

/// <summary>
/// The Performance module's own persistence context. Schema <c>performance</c>, fail-closed
/// per-entity tenant query filter, UTC datetime conversion. Owns the Cycle &amp; Goals domain
/// and consumes Core workforce/organization truth only through the internal snapshot contract.
/// </summary>
public sealed class PerformanceDbContext : DbContext
{
    private readonly ITenantContext? _tenantContext;

    public PerformanceDbContext(DbContextOptions<PerformanceDbContext> options, ITenantContext tenantContext)
        : base(options)
    {
        _tenantContext = tenantContext;
    }

    /// <summary>Design-time constructor for EF migrations tooling.</summary>
    public PerformanceDbContext(DbContextOptions<PerformanceDbContext> options)
        : base(options)
    {
        _tenantContext = null;
    }

    private Guid CurrentTenantId => _tenantContext?.TenantIdOrDefault ?? Guid.Empty;

    public DbSet<PerformanceOutboxMessage> OutboxMessages => Set<PerformanceOutboxMessage>();
    public DbSet<PerformanceNotification> Notifications => Set<PerformanceNotification>();
    public DbSet<PerformanceAuditEntry> AuditEntries => Set<PerformanceAuditEntry>();
    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();
    public DbSet<NotificationDefaults> NotificationDefaults => Set<NotificationDefaults>();

    public DbSet<PerformanceCycle> Cycles => Set<PerformanceCycle>();
    public DbSet<CycleSettings> CycleSettings => Set<CycleSettings>();
    public DbSet<RatingScale> RatingScales => Set<RatingScale>();
    public DbSet<RatingScaleVersion> RatingScaleVersions => Set<RatingScaleVersion>();
    public DbSet<Competency> Competencies => Set<Competency>();
    public DbSet<PopulationDefinition> PopulationDefinitions => Set<PopulationDefinition>();
    public DbSet<Participant> Participants => Set<Participant>();
    public DbSet<Objective> Objectives => Set<Objective>();
    public DbSet<ContributionLink> ContributionLinks => Set<ContributionLink>();
    public DbSet<EmployeePlan> EmployeePlans => Set<EmployeePlan>();
    public DbSet<PlanDecision> PlanDecisions => Set<PlanDecision>();
    public DbSet<PlanChangeRequest> PlanChangeRequests => Set<PlanChangeRequest>();
    public DbSet<DevelopmentPlan> DevelopmentPlans => Set<DevelopmentPlan>();
    public DbSet<DevelopmentGoal> DevelopmentGoals => Set<DevelopmentGoal>();
    public DbSet<ProgressUpdate> ProgressUpdates => Set<ProgressUpdate>();
    public DbSet<ProgressMilestoneChange> ProgressMilestoneChanges => Set<ProgressMilestoneChange>();
    public DbSet<EvidenceUpload> EvidenceUploads => Set<EvidenceUpload>();
    public DbSet<EvidenceItem> EvidenceItems => Set<EvidenceItem>();
    public DbSet<ReviewRound> ReviewRounds => Set<ReviewRound>();
    public DbSet<ReviewRoundSubject> ReviewRoundSubjects => Set<ReviewRoundSubject>();
    public DbSet<PerformanceReview> PerformanceReviews => Set<PerformanceReview>();
    public DbSet<ReviewItemResponse> ReviewItemResponses => Set<ReviewItemResponse>();
    public DbSet<ReviewQuestion> ReviewQuestions => Set<ReviewQuestion>();
    public DbSet<ReviewRoundQuestion> ReviewRoundQuestions => Set<ReviewRoundQuestion>();
    public DbSet<ReviewQuestionSnapshot> ReviewQuestionSnapshots => Set<ReviewQuestionSnapshot>();
    public DbSet<ReviewQuestionAnswer> ReviewQuestionAnswers => Set<ReviewQuestionAnswer>();
    public DbSet<PeerNomination> PeerNominations => Set<PeerNomination>();
    public DbSet<PeerRequest> PeerRequests => Set<PeerRequest>();
    public DbSet<PeerAnswer> PeerAnswers => Set<PeerAnswer>();
    public DbSet<ReviewDueDateMove> ReviewDueDateMoves => Set<ReviewDueDateMove>();
    public DbSet<UpdateRequest> UpdateRequests => Set<UpdateRequest>();
    public DbSet<CalibrationSession> CalibrationSessions => Set<CalibrationSession>();
    public DbSet<CalibrationFacilitator> CalibrationFacilitators => Set<CalibrationFacilitator>();
    public DbSet<CalibrationSubject> CalibrationSubjects => Set<CalibrationSubject>();
    public DbSet<CalibrationAdjustment> CalibrationAdjustments => Set<CalibrationAdjustment>();
    public DbSet<OneOnOneSeries> OneOnOneSeries => Set<OneOnOneSeries>();
    public DbSet<OneOnOneActionItem> OneOnOneActionItems => Set<OneOnOneActionItem>();
    public DbSet<OneOnOneMeeting> OneOnOneMeetings => Set<OneOnOneMeeting>();
    public DbSet<OneOnOneAgendaItem> OneOnOneAgendaItems => Set<OneOnOneAgendaItem>();
    public DbSet<OneOnOnePrivateNote> OneOnOnePrivateNotes => Set<OneOnOnePrivateNote>();
    public DbSet<Feedback> Feedback => Set<Feedback>();
    public DbSet<FeedbackRequest> FeedbackRequests => Set<FeedbackRequest>();
    public DbSet<FeedbackRequestInvitee> FeedbackRequestInvitees => Set<FeedbackRequestInvitee>();
    public DbSet<Praise> Praise => Set<Praise>();
    public DbSet<PraiseRecipient> PraiseRecipients => Set<PraiseRecipient>();
    public DbSet<PraiseReaction> PraiseReactions => Set<PraiseReaction>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        configurationBuilder.Properties<DateTime?>().HaveConversion<UtcNullableDateTimeConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasDefaultSchema("performance");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PerformanceDbContext).Assembly);

        modelBuilder.Entity<PerformanceOutboxMessage>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PerformanceNotification>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PerformanceAuditEntry>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<NotificationPreference>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<NotificationDefaults>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);

        // Fail-closed tenant filter on every root: an unresolved tenant returns no rows.
        modelBuilder.Entity<PerformanceCycle>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ActivationSnapshot>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<CycleSettings>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<RatingScale>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<RatingScaleVersion>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<Competency>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PopulationDefinition>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PopulationOrgUnitSelection>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PopulationInclusion>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PopulationExclusion>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<Participant>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<Objective>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ContributionLink>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<EmployeePlan>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PlanDecision>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ProgressUpdate>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ProgressMilestoneChange>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PlanChangeRequest>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<DevelopmentPlan>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<DevelopmentGoal>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<EvidenceUpload>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<EvidenceItem>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewRound>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewRoundSubject>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PerformanceReview>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewItemResponse>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewQuestion>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewRoundQuestion>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewQuestionSnapshot>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewQuestionAnswer>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PeerNomination>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PeerRequest>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PeerAnswer>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<ReviewDueDateMove>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<UpdateRequest>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<CalibrationSession>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<CalibrationFacilitator>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<CalibrationSubject>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<CalibrationAdjustment>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<OneOnOneSeries>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<OneOnOneActionItem>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<OneOnOneMeeting>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<OneOnOneAgendaItem>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<OneOnOnePrivateNote>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<Feedback>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<FeedbackRequest>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<FeedbackRequestInvitee>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<Praise>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PraiseRecipient>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
        modelBuilder.Entity<PraiseReaction>()
            .HasQueryFilter(e => CurrentTenantId != Guid.Empty && e.TenantId == CurrentTenantId);
    }
}
