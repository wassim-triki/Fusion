using Microsoft.EntityFrameworkCore.Infrastructure;
using EY.HRPlatform.Performance.Domain.Cycles;
using EY.HRPlatform.Performance.Domain.Objectives;
using EY.HRPlatform.Performance.Domain.Reviews;
using EY.HRPlatform.Performance.Domain.Settings;
using EY.HRPlatform.Performance.Features.Settings;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Infrastructure.Persistence.Interceptors;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace EY.HRPlatform.Performance.Tests;

/// <summary>
/// Opt-in relational coverage. Set FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION to a
/// disposable PostgreSQL connection string to exercise the real EF migrations, the partial
/// unique single-Active index, the fail-closed tenant filter, and the frozen jsonb snapshot.
/// </summary>
public sealed class RelationalTests
{
    private static readonly DateOnly Start = new(2026, 1, 1);
    private static readonly DateOnly End = new(2026, 12, 31);

    /// <summary>Every migration applies, rolls all the way back to an empty schema, and applies again.</summary>
    [RelationalDatabaseFact]
    public async Task Every_migration_rolls_back_to_empty_and_reapplies()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, Guid.NewGuid());
            var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            var all = db.Database.GetMigrations().ToArray();
            await migrator.MigrateAsync();
            Assert.Equal(all, await db.Database.GetAppliedMigrationsAsync());
            await migrator.MigrateAsync(Microsoft.EntityFrameworkCore.Migrations.Migration.InitialDatabase);
            Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
            Assert.Equal(0, await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.tables
                WHERE table_schema='performance' AND table_name <> '__EFMigrationsHistory'
                """).SingleAsync());
            await migrator.MigrateAsync();
            Assert.Equal(all, await db.Database.GetAppliedMigrationsAsync());
            Assert.False(db.Database.HasPendingModelChanges());
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Review_item_response_migration_creates_and_rolls_back_item_storage()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, Guid.NewGuid());
            var migrations = db.Database.GetMigrations().ToArray();
            var current = Array.FindIndex(migrations, migration => migration.EndsWith("_AddReviewItemResponses"));
            Assert.True(current > 0);
            var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(migrations[current]);
            Assert.Equal(1, await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.tables
                WHERE table_schema='performance' AND table_name='ReviewItemResponses'
                """).SingleAsync());
            Assert.Equal(1, await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.columns
                WHERE table_schema='performance' AND table_name='PerformanceReviews' AND column_name='ObjectiveRatingsEnabled'
                """).SingleAsync());

            await migrator.MigrateAsync(migrations[current - 1]);
            Assert.Equal(0, await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.tables
                WHERE table_schema='performance' AND table_name='ReviewItemResponses'
                """).SingleAsync());
            await migrator.MigrateAsync(migrations[current]);
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    /// <summary>An earlier single-milestone event reads as one check-in with one change, and rolls back.</summary>
    [RelationalDatabaseFact]
    public async Task Check_in_migration_moves_milestone_events_onto_their_change_list()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantId = Guid.NewGuid();
        var updateId = Guid.NewGuid();
        var milestoneId = Guid.NewGuid();
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, tenantId);
            var migrations = db.Database.GetMigrations().ToArray();
            var current = Array.FindIndex(migrations, m => m.EndsWith("_AddObjectiveStatusChangeRequestsAndDevelopment"));
            Assert.True(current > 0);
            var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(migrations[current - 1]);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO performance."ProgressUpdates"
                    ("Id", "ObjectiveId", "CycleId", "AuthorEmployeeId", "Kind", "MilestoneId", "IsCorrection", "RecordedAt", "CreatedAt", "TenantId")
                VALUES ({0}, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'MilestoneCompleted', {1}, false, now(), now(), {2})
                """, updateId, milestoneId, tenantId);

            await migrator.MigrateAsync(migrations[current]);
            db.ChangeTracker.Clear();
            var update = await db.ProgressUpdates.AsNoTracking().SingleAsync(u => u.Id == updateId);
            Assert.Equal(EY.HRPlatform.Performance.Domain.Progress.ProgressEventKind.MilestonesChanged, update.Kind);
            Assert.Null(update.Status);
            var change = Assert.Single(update.MilestoneChanges);
            Assert.Equal(milestoneId, change.MilestoneId);
            Assert.True(change.Completed);

            await migrator.MigrateAsync(migrations[current - 1]);
            Assert.Equal(milestoneId, await db.Database.SqlQueryRaw<Guid>("""
                SELECT "MilestoneId" AS "Value" FROM performance."ProgressUpdates"
                """).SingleAsync());
            Assert.Equal("MilestoneCompleted", await db.Database.SqlQueryRaw<string>("""
                SELECT "Kind" AS "Value" FROM performance."ProgressUpdates"
                """).SingleAsync());
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Competency_migration_enforces_one_case_insensitive_active_name_per_tenant()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantId = Guid.NewGuid();
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, tenantId);
            await db.Database.MigrateAsync();
            var original = Competency.Create(tenantId, "Develops others", "Builds team capability", []);
            db.Competencies.Add(original);
            await db.SaveChangesAsync();

            db.Competencies.Add(Competency.Create(tenantId, "DEVELOPS OTHERS", "Duplicate active name", []));
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            db.ChangeTracker.Clear();
            var persisted = await db.Competencies.SingleAsync();
            persisted.Archive();
            await db.SaveChangesAsync();
            db.Competencies.Add(Competency.Create(tenantId, "DEVELOPS OTHERS", "Archived name reused", []));
            await db.SaveChangesAsync();
            Assert.Equal(2, await db.Competencies.CountAsync());
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Review_round_migration_creates_partial_slot_and_rolls_back()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantId = Guid.NewGuid();
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, tenantId);
            var migrations = db.Database.GetMigrations().ToArray();
            var index = Array.FindIndex(migrations, m => m.EndsWith("_LaunchReviewRounds"));
            Assert.True(index > 0);
            var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            // Saved through the current model, so applied in full; the partial slot index still comes from LaunchReviewRounds.
            await migrator.MigrateAsync();

            var cycle = PerformanceCycle.CreateDraft(tenantId, "FY2026", Start, End, Start.AddDays(30)).Activated();
            var scale = RatingScale.CreateDefault(tenantId);
            var scaleVersion = scale.CreateNextVersion(RatingScaleDefaults.Levels);
            var first = ReviewRound.CreateDraft(tenantId, cycle, "Mid-year", Start, End, true, true, false);
            first.Launch("{}", scaleVersion.Id, DateTime.UtcNow);
            db.Cycles.Add(cycle);
            db.RatingScales.Add(scale);
            db.RatingScaleVersions.Add(scaleVersion);
            db.ReviewRounds.Add(first);
            await db.SaveChangesAsync();

            var second = ReviewRound.CreateDraft(tenantId, cycle, "Year-end", Start, End, true, true, false);
            second.Launch("{}", scaleVersion.Id, DateTime.UtcNow);
            db.ReviewRounds.Add(second);
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());

            var roundsIndex = Array.FindIndex(migrations, m => m.EndsWith("_AddReviewRounds"));
            Assert.True(roundsIndex > 0 && roundsIndex < index);
            await migrator.MigrateAsync(migrations[roundsIndex - 1]);
            Assert.Equal(0, await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.tables
                WHERE table_schema='performance' AND table_name IN ('ReviewRounds','ReviewRoundSubjects')
                """).SingleAsync());
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Review_assessment_migration_persists_owned_content_and_rejects_a_stale_save()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenantId = Guid.NewGuid();
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using (var db = CreateDb(connection, tenantId))
            {
                await db.Database.MigrateAsync();
                var cycle = PerformanceCycle.CreateDraft(tenantId, "FY2026", Start, End, Start.AddDays(30)).Activated();
                var participant = EY.HRPlatform.Performance.Domain.Population.Participant.Create(tenantId, cycle.Id,
                    Guid.NewGuid(), "Subject", null, null, null, Guid.NewGuid(), "Reviewer", false, Start);
                var round = ReviewRound.CreateDraft(tenantId, cycle, "Mid-year", Start, End, true, true, false);
                round.UpdateDraft(cycle, round.Name, round.PeriodStart, round.PeriodEnd, true, true, false,
                    Start.AddDays(100), Start.AddDays(200), "[]");
                var subject = EY.HRPlatform.Performance.Domain.Reviews.ReviewRoundSubject.Create(tenantId, round.Id,
                    participant, participant.ManagerEmployeeId, "Reviewer");
                var scale = RatingScale.CreateDefault(tenantId);
                var scaleVersion = scale.CreateNextVersion(RatingScaleDefaults.Levels);
                var review = PerformanceReview.Open(tenantId, round, subject, scaleVersion.Id,
                    System.Text.Json.JsonSerializer.Serialize(RatingScaleDefaults.Levels), DateTime.UtcNow);
                round.Launch("{}", scaleVersion.Id, DateTime.UtcNow);
                db.Cycles.Add(cycle);
                db.Participants.Add(participant);
                db.RatingScales.Add(scale);
                db.RatingScaleVersions.Add(scaleVersion);
                db.ReviewRounds.Add(round);
                db.ReviewRoundSubjects.Add(subject);
                db.PerformanceReviews.Add(review);
                await db.SaveChangesAsync();
            }

            await using var first = CreateDb(connection, tenantId);
            await using var stale = CreateDb(connection, tenantId);
            var reviewA = await first.PerformanceReviews.SingleAsync();
            var reviewB = await stale.PerformanceReviews.SingleAsync();
            reviewA.SaveSelfAssessment(reviewA.SubjectEmployeeId, "First saved draft", DateTime.UtcNow);
            await first.SaveChangesAsync();
            reviewB.SaveSelfAssessment(reviewB.SubjectEmployeeId, "Stale overwritten draft", DateTime.UtcNow);
            await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => stale.SaveChangesAsync());

            await using var verify = CreateDb(connection, tenantId);
            Assert.Equal("First saved draft", (await verify.PerformanceReviews.SingleAsync()).SelfAssessment.Summary);
            var migrations = verify.Database.GetMigrations().ToArray();
            var assessmentMigration = Array.FindIndex(migrations, migration => migration.EndsWith("_AddReviewAssessments"));
            Assert.True(assessmentMigration > 0);
            var migrator = verify.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(migrations[assessmentMigration - 1]);
            Assert.Equal(0, await verify.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.columns
                WHERE table_schema='performance' AND table_name='PerformanceReviews' AND column_name='SelfAssessmentSummary'
                """).SingleAsync());
            await migrator.MigrateAsync(migrations[assessmentMigration]);
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Rating_scale_migration_adds_review_defaults_and_rolls_back()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, Guid.NewGuid());
            var migrations = db.Database.GetMigrations().ToArray();
            var scaleIndex = Array.FindIndex(migrations, m => m.EndsWith("_AddRatingScale"));
            Assert.True(scaleIndex > 0);
            var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(migrations[scaleIndex - 1]);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO performance."CycleSettings" ("Id", "TenantId", "DefaultMeasurementMethod", "SuggestedObjectiveCountMin", "SuggestedObjectiveCountMax", "PlanningDeadlineOffsetDays", "PlanAlignmentPolicy", "CreatedAt")
                VALUES ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'NumericTarget', 3, 6, 30, 'AtLeastOneConnected', NOW());
                """);
            await migrator.MigrateAsync(migrations[scaleIndex]);
            Assert.True(await db.Database.SqlQueryRaw<bool>("SELECT \"DefaultSelfAssessmentEnabled\" AS \"Value\" FROM performance.\"CycleSettings\"").SingleAsync());
            Assert.True(await db.Database.SqlQueryRaw<bool>("SELECT \"DefaultObjectiveRatingsEnabled\" AS \"Value\" FROM performance.\"CycleSettings\"").SingleAsync());
            Assert.False(await db.Database.SqlQueryRaw<bool>("SELECT \"DefaultCalibrationEnabled\" AS \"Value\" FROM performance.\"CycleSettings\"").SingleAsync());
            await migrator.MigrateAsync(migrations[scaleIndex - 1]);
            Assert.Equal(0, await db.Database.SqlQueryRaw<int>("""
                SELECT count(*)::int AS "Value" FROM information_schema.tables
                WHERE table_schema='performance' AND table_name IN ('RatingScales','RatingScaleVersions')
                """).SingleAsync());
            await migrator.MigrateAsync(migrations[scaleIndex]);
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Alignment_policy_migration_preserves_both_legacy_choices_and_rolls_back()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using var db = CreateDb(connection, Guid.NewGuid());
            var migrations = db.Database.GetMigrations().ToArray();
            var alignmentIndex = Array.FindIndex(migrations, m => m.EndsWith("_ReplaceStandaloneToggleWithPlanAlignmentPolicy"));
            var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(migrations[alignmentIndex - 1]);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO performance."CycleSettings" ("Id", "TenantId", "DefaultMeasurementMethod", "SuggestedObjectiveCountMin", "SuggestedObjectiveCountMax", "PlanningDeadlineOffsetDays", "AllowStandaloneObjectives", "CreatedAt")
                VALUES ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'NumericTarget', 3, 6, 30, true, NOW()),
                       ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'NumericTarget', 3, 6, 30, false, NOW());
                """);
            await migrator.MigrateAsync(migrations[alignmentIndex]);
            var policies = await db.CycleSettings.IgnoreQueryFilters().OrderBy(x => x.Id).Select(x => x.PlanAlignmentPolicy).ToListAsync();
            Assert.Equal(new[] { EY.HRPlatform.Performance.Domain.Settings.PlanAlignmentPolicy.AtLeastOneConnected, EY.HRPlatform.Performance.Domain.Settings.PlanAlignmentPolicy.EveryObjectiveConnected }, policies);
            await migrator.MigrateAsync(migrations[alignmentIndex - 1]);
            var toggles = await db.Database.SqlQueryRaw<bool>("""
                SELECT "AllowStandaloneObjectives" AS "Value" FROM performance."CycleSettings" ORDER BY "Id"
                """).ToListAsync();
            Assert.Equal(new[] { true, false }, toggles);
            await migrator.MigrateAsync(migrations[alignmentIndex]);
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Single_active_index_and_tenant_isolation_hold_on_real_postgres()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connectionString = new NpgsqlConnectionStringBuilder(baseConnection)
        {
            Database = databaseName,
            Pooling = false,
        }.ConnectionString;

        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            var tenantA = Guid.NewGuid();
            var tenantB = Guid.NewGuid();

            await using (var db = CreateDb(connectionString, tenantA))
            {
                await db.Database.MigrateAsync();

                var first = PerformanceCycle.CreateDraft(tenantA, "FY2026", Start, End, Start.AddDays(30));
                first.Activate(Snapshot(tenantA, first.Id));
                db.Cycles.Add(first);
                await db.SaveChangesAsync();

                // A second Active Cycle in the same tenant violates the partial unique index.
                var second = PerformanceCycle.CreateDraft(tenantA, "FY2027", Start.AddYears(1), End.AddYears(1), Start.AddYears(1).AddDays(30));
                second.Activate(Snapshot(tenantA, second.Id));
                db.Cycles.Add(second);
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            }

            // The frozen snapshot round-trips through jsonb and stays put.
            await using (var db = CreateDb(connectionString, tenantA))
            {
                var active = await db.Cycles.Include(c => c.ActivationSnapshot).SingleAsync(c => c.State == CycleLifecycleState.Active);
                Assert.NotNull(active.ActivationSnapshot);
                Assert.Contains("\"role\"", active.ActivationSnapshot!.StrategyJson);
                Assert.Contains("ceo", active.ActivationSnapshot.StrategyJson);
            }

            // Organizational goals (Chunk B): a calculated objective persists with a null direct
            // measurement (optional owned in the same table) and a contribution link, proving the
            // new columns and tables round-trip on real PostgreSQL.
            await using (var db = CreateDb(connectionString, tenantA))
            {
                var cycle = await db.Cycles.FirstAsync(c => c.State == CycleLifecycleState.Active);
                var strategic = Objective.CreateStrategic(tenantA, cycle.Id, "Grow", null, Guid.NewGuid(),
                    cycle.StartDate, cycle.EndDate, ObjectiveMeasurement.ManualPercentage(), cycle.StartDate, cycle.EndDate);
                strategic.Publish();
                db.Objectives.Add(strategic);
                await db.SaveChangesAsync();

                var org = Objective.CreateOrganizational(tenantA, cycle.Id, Guid.NewGuid(), "Operations", "Reliability", null,
                    Guid.NewGuid(), strategic.Id, cycle.StartDate, cycle.EndDate, ObjectiveProgressSource.Calculated, null,
                    cycle.StartDate, cycle.EndDate, cycle.StartDate, cycle.EndDate);
                org.ConfigureContribution([(Guid.NewGuid(), 100m)]);
                db.Objectives.Add(org);
                await db.SaveChangesAsync();
            }

            await using (var db = CreateDb(connectionString, tenantA))
            {
                var org = await db.Objectives.Include(o => o.ContributionLinks)
                    .SingleAsync(o => o.OwnershipScope == ObjectiveOwnershipScope.OrgUnit);
                Assert.Equal(ObjectiveProgressSource.Calculated, org.ProgressSource);
                Assert.Null(org.Measurement);
                Assert.Single(org.ContributionLinks);
            }

            // Another tenant sees no cycles at all.
            await using (var db = CreateDb(connectionString, tenantB))
            {
                Assert.Empty(await db.Cycles.ToListAsync());
            }
        }
        finally
        {
            await DropDatabaseAsync(baseConnection, databaseName);
        }
    }

    [RelationalDatabaseFact]
    public async Task Xmin_moves_on_child_mutations_and_rejects_competing_writes()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        var employee = Guid.NewGuid();
        Guid cycleId, strategyId, milestoneId, teamId, calculatedId, planId, employeeObjectiveId;
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using (var db = CreateDb(connection, tenant))
            {
                await db.Database.MigrateAsync();
                var cycle = PerformanceCycle.CreateDraft(tenant, "FY2026", Start, End, Start.AddDays(30));
                cycle.Activate(Snapshot(tenant, cycle.Id));
                var strategy = Objective.CreateStrategic(tenant, cycle.Id, "Direction", null, employee, Start, End, ObjectiveMeasurement.ManualPercentage(), Start, End);
                strategy.Publish();
                var milestone = ObjectiveMilestone.Create(tenant, "Deliver", 100m, null);
                var team = Objective.CreateOrganizational(tenant, cycle.Id, Guid.NewGuid(), "Team", "Delivery", null, employee, strategy.Id, Start, End,
                    ObjectiveProgressSource.Direct, ObjectiveMeasurement.WeightedMilestones([milestone]), Start, End, Start, End);
                team.Publish();
                var calculated = Objective.CreateOrganizational(tenant, cycle.Id, Guid.NewGuid(), "Team", "Calculated", null, employee, strategy.Id, Start, End,
                    ObjectiveProgressSource.Calculated, null, Start, End, Start, End);
                calculated.Publish();
                var plan = EY.HRPlatform.Performance.Domain.Plans.EmployeePlan.Create(tenant, cycle.Id, Guid.NewGuid(), employee, "Employee", "Team", Guid.NewGuid(), "Manager");
                db.Cycles.Add(cycle);
                db.Objectives.AddRange(strategy, team, calculated);
                db.EmployeePlans.Add(plan);
                await db.SaveChangesAsync();
                cycleId = cycle.Id; strategyId = strategy.Id; milestoneId = milestone.Id; teamId = team.Id; calculatedId = calculated.Id; planId = plan.Id;
                Assert.NotEqual(0u, cycle.Version);
            }
            await using (var db = CreateDb(connection, tenant))
            {
                var team = await db.Objectives.Include(o => o.Measurement).SingleAsync(o => o.Id == teamId);
                var version = team.Version;
                team.ApplyMilestones([(milestoneId, true)]);
                await db.SaveChangesAsync();
                Assert.NotEqual(version, team.Version);
            }
            await using (var db = CreateDb(connection, tenant))
            {
                var parent = await db.Objectives.Include(o => o.ContributionLinks).SingleAsync(o => o.Id == calculatedId);
                var version = parent.Version;
                parent.ConfigureContribution([(teamId, 100m)]);
                foreach (var link in parent.ContributionLinks) db.Entry(link).State = EntityState.Added;
                await db.SaveChangesAsync();
                Assert.NotEqual(version, parent.Version);
            }
            var actor = new EY.HRPlatform.Performance.Features.Plans.PlanActorContext(employee, false, false);
            var workforce = new FakeCoreWorkforceClient();
            await using (var db = CreateDb(connection, tenant))
            {
                var version = (await db.EmployeePlans.SingleAsync(p => p.Id == planId)).Version;
                var request = new EY.HRPlatform.Performance.Models.AddPlanObjectiveRequest("Own outcome", null, strategyId, Start, End,
                    new(MeasurementMethod.ManualPercentage, null, null, null, null), 100m) { ExpectedVersion = version };
                var result = await new EY.HRPlatform.Performance.Features.Plans.AddPlanObjectiveHandler(db, workforce, TestTenantContext.WithTenant(tenant))
                    .Handle(new(cycleId, request, actor), default);
                Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
                Assert.NotEqual(version, result.Value.Version);
                employeeObjectiveId = Assert.Single(result.Value.Objectives).Id;
            }
            await using (var db = CreateDb(connection, tenant))
            {
                var version = (await db.EmployeePlans.SingleAsync(p => p.Id == planId)).Version;
                var result = await new EY.HRPlatform.Performance.Features.Plans.SubmitMyPlanHandler(db, workforce, TestTenantContext.WithTenant(tenant), new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db))
                    .Handle(new(cycleId, actor, version), default);
                Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
                Assert.NotEqual(version, result.Value.Version);
                Assert.Single(await db.PlanDecisions.ToListAsync());
            }
            await using (var first = CreateDb(connection, tenant))
            await using (var second = CreateDb(connection, tenant))
            {
                var one = await first.Objectives.SingleAsync(o => o.Id == employeeObjectiveId);
                var two = await second.Objectives.SingleAsync(o => o.Id == employeeObjectiveId);
                one.ApplyManualPercentage(10m);
                await first.SaveChangesAsync();
                two.ApplyManualPercentage(20m);
                await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => second.SaveChangesAsync());
            }
            await using (var db = CreateDb(connection, tenant))
            {
                Assert.Equal(10m, (await db.Objectives.SingleAsync(o => o.Id == employeeObjectiveId)).DerivedProgress);
                var migrations = db.Database.GetMigrations().ToList();
                var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
                await migrator.MigrateAsync(migrations[^2]);
                await migrator.MigrateAsync();
            }
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    [RelationalDatabaseFact]
    public async Task Failed_audit_insert_rolls_back_plan_approval_and_valid_audit_commits_atomically()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var databaseName = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = databaseName, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        var employee = Guid.NewGuid(); var manager = Guid.NewGuid();
        var workforce = new FakeCoreWorkforceClient();
        var cycle = PerformanceCycle.CreateDraft(tenant, "Audit", Start, End, Start.AddDays(30)).Activated();
        var participant = EY.HRPlatform.Performance.Domain.Population.Participant.Create(tenant, cycle.Id, employee,
            "Employee", null, null, null, manager, "Manager", false, Start);
        var plan = EY.HRPlatform.Performance.Domain.Plans.EmployeePlan.Create(tenant, cycle.Id, participant.Id, employee,
            "Employee", null, manager, "Manager");
        plan.Submit(employee, new EY.HRPlatform.Performance.Domain.Plans.PlanSubmissionFacts(1, true, 100m, true, false,
            EY.HRPlatform.Performance.Domain.Settings.PlanAlignmentPolicy.AtLeastOneConnected));
        try
        {
            await CreateDatabaseAsync(baseConnection, databaseName);
            await using (var db = CreateDb(connection, tenant))
            {
                await db.Database.MigrateAsync();
                db.Cycles.Add(cycle); db.Participants.Add(participant); db.EmployeePlans.Add(plan);
                await db.SaveChangesAsync();
            }
            await using (var db = CreateDb(connection, tenant))
            {
                var version = (await db.EmployeePlans.SingleAsync()).Version;
                var handler = new EY.HRPlatform.Performance.Features.Plans.ApprovePlanHandler(db, workforce,
                    TestTenantContext.WithTenant(tenant), new InvalidAuditInsert(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db));
                await Assert.ThrowsAsync<DbUpdateException>(() => handler.Handle(new(cycle.Id, plan.Id, new(manager, false, true), version), default));
            }
            await using (var db = CreateDb(connection, tenant))
            {
                Assert.Equal(EY.HRPlatform.Performance.Domain.Plans.PlanLifecycleState.Submitted, (await db.EmployeePlans.SingleAsync()).State);
                Assert.Single(await db.PlanDecisions.ToListAsync());
                Assert.Empty(await db.AuditEntries.ToListAsync());
                Assert.Empty(await db.OutboxMessages.ToListAsync());
                var handler = new EY.HRPlatform.Performance.Features.Plans.ApprovePlanHandler(db, workforce,
                    TestTenantContext.WithTenant(tenant), new TestPerformanceAudit(db), new EY.HRPlatform.Performance.Infrastructure.Notifications.PerformanceNotifications(db));
                var version = (await db.EmployeePlans.SingleAsync()).Version;
                var approval = await handler.Handle(new(cycle.Id, plan.Id, new(manager, false, true), version), default);
                Assert.True(approval.IsSuccess, approval.IsFailure ? approval.Error.Message : null);
            }
            await using (var db = CreateDb(connection, tenant))
            {
                Assert.Equal(EY.HRPlatform.Performance.Domain.Plans.PlanLifecycleState.Approved, (await db.EmployeePlans.SingleAsync()).State);
                Assert.Equal(2, await db.PlanDecisions.CountAsync());
                var entry = Assert.Single(await db.AuditEntries.ToListAsync());
                Assert.Equal(EY.HRPlatform.Performance.Domain.Audit.PerformanceAuditActions.PlanApproved, entry.Action);
                Assert.Contains("Submitted", entry.Summary);
                Assert.Contains("Approved", entry.Summary);
                Assert.Equal(plan.Id, entry.ResourceId);
                // jsonb round trip, tenant filter, and the migration's Down/Up path.
                await using var other = CreateDb(connection, Guid.NewGuid());
                Assert.Empty(await other.AuditEntries.ToListAsync());
                var migrations = db.Database.GetMigrations().ToArray();
                var migrator = db.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
                await migrator.MigrateAsync(migrations[^2]);
                await migrator.MigrateAsync();
            }
        }
        finally { await DropDatabaseAsync(baseConnection, databaseName); }
    }

    private sealed class InvalidAuditInsert(PerformanceDbContext db) : EY.HRPlatform.Performance.Infrastructure.Audit.IPerformanceAudit
    {
        public void Record(Guid tenantId, string resourceType, Guid resourceId, Guid? cycleId, string action, object summary)
        {
            new TestPerformanceAudit(db).Record(tenantId, resourceType, resourceId, cycleId, action, summary);
            // Force PostgreSQL's varchar constraint to fail inside the shared SaveChanges transaction.
            var entry = db.AuditEntries.Local.Single();
            db.Entry(entry).Property(e => e.Action).CurrentValue = new string('x', 101);
        }
    }

    private static ActivationSnapshot Snapshot(Guid tenant, Guid cycleId)
        => ActivationSnapshot.Capture(tenant, cycleId, "FY", Start, End, Start.AddDays(30), Start, 1, "{}", "{}", "[]", "[{\"role\":\"ceo\"}]");

    internal static PerformanceDbContext CreateDb(string connectionString, Guid tenantId,
        params Microsoft.EntityFrameworkCore.Diagnostics.IInterceptor[] extra)
    {
        var tenant = TestTenantContext.WithTenant(tenantId);
        return new PerformanceDbContext(
            new DbContextOptionsBuilder<PerformanceDbContext>()
                .UseNpgsql(connectionString)
                .AddInterceptors([new TenantSaveChangesInterceptor(tenant), new AuditAppendOnlyInterceptor(), new DemoClockStampInterceptor(), .. extra])
                .Options,
            tenant);
    }

    internal static async Task CreateDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
    }

    internal static async Task DropDatabaseAsync(string baseConnectionString, string databaseName)
    {
        var admin = new NpgsqlConnectionStringBuilder(baseConnectionString) { Database = "postgres", Pooling = false }.ConnectionString;
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using (var terminate = new NpgsqlCommand(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @databaseName AND pid <> pg_backend_pid();", connection))
        {
            terminate.Parameters.AddWithValue("databaseName", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }
        await using var drop = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{databaseName}\"", connection);
        await drop.ExecuteNonQueryAsync();
    }
}

[AttributeUsage(AttributeTargets.Method)]
internal sealed class RelationalDatabaseFactAttribute : FactAttribute
{
    public RelationalDatabaseFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")))
            Skip = "Set FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION to run PostgreSQL integration coverage.";
    }
}
