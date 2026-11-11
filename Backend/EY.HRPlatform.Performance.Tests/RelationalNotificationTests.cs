using EY.HRPlatform.Performance.Domain.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Core;
using EY.HRPlatform.Performance.Infrastructure.Identity;
using EY.HRPlatform.Performance.Infrastructure.Notifications;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Infrastructure.Persistence.Interceptors;
using EY.HRPlatform.Performance.Tests.TestHelpers;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace EY.HRPlatform.Performance.Tests;

public sealed class RelationalNotificationTests
{
    [RelationalDatabaseFact]
    public async Task Claim_skips_locked_rows_and_database_dedupe_prevents_repeated_enqueue()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        var firstMessage = NotificationTests.Message(tenant, Guid.NewGuid());
        try
        {
            await RelationalTests.CreateDatabaseAsync(baseConnection, name);
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                await db.Database.MigrateAsync();
                db.OutboxMessages.AddRange(firstMessage, NotificationTests.Message(tenant, Guid.NewGuid()));
                await db.SaveChangesAsync();
            }
            await using (var one = RelationalTests.CreateDb(connection, Guid.NewGuid()))
            await using (var two = RelationalTests.CreateDb(connection, Guid.NewGuid()))
            {
                // Unresolved/other-tenant query scopes see nothing except this explicit claim boundary.
                Assert.Empty(await one.OutboxMessages.ToListAsync());
                await using var txOne = await one.Database.BeginTransactionAsync();
                await using var txTwo = await two.Database.BeginTransactionAsync();
                var first = await PerformanceOutboxClaim.NextAsync(one, DateTime.UtcNow, default);
                var second = await PerformanceOutboxClaim.NextAsync(two, DateTime.UtcNow, default);
                Assert.NotNull(first); Assert.NotNull(second);
                Assert.NotEqual(first.Id, second.Id);
                await using var three = RelationalTests.CreateDb(connection, Guid.NewGuid());
                await using var txThree = await three.Database.BeginTransactionAsync();
                Assert.Null(await PerformanceOutboxClaim.NextAsync(three, DateTime.UtcNow, default));
            }
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                var duplicate = NotificationTests.Message(tenant, firstMessage.RecipientEmployeeId);
                db.OutboxMessages.Add(duplicate);
                db.Entry(duplicate).Property(m => m.DedupeKey).CurrentValue = firstMessage.DedupeKey;
                await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            }
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                Assert.Equal(2, await db.OutboxMessages.CountAsync());
                var migrations = db.Database.GetMigrations().ToArray();
                var migrator = db.GetService<IMigrator>();
                var notificationIndex = Array.FindIndex(migrations, m => m.EndsWith("_RecordPerformanceNotifications"));
                await migrator.MigrateAsync(migrations[notificationIndex - 1]);
                await migrator.MigrateAsync();
                Assert.Empty(await db.OutboxMessages.ToListAsync());
            }
        }
        finally { await RelationalTests.DropDatabaseAsync(baseConnection, name); }
    }

    [RelationalDatabaseFact]
    public async Task A_batch_opens_a_distinct_tenant_scope_for_each_recipient_and_sends_only_once()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var tenantA = Guid.NewGuid(); var tenantB = Guid.NewGuid();
        var recipient = Guid.NewGuid();
        var resolvedTenants = new List<Guid>();
        var sender = new CapturingNotificationSender();
        try
        {
            await RelationalTests.CreateDatabaseAsync(baseConnection, name);
            foreach (var tenant in new[] { tenantA, tenantB })
            {
                await using var db = RelationalTests.CreateDb(connection, tenant);
                await db.Database.MigrateAsync();
                var message = NotificationTests.Message(tenant, recipient);
                db.OutboxMessages.Add(message);
                db.Notifications.Add(NotificationTests.InAppFor(message));
                await db.SaveChangesAsync();
            }
            var services = new ServiceCollection();
            services.AddScoped<TenantContext>();
            services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
            services.AddDbContext<PerformanceDbContext>((sp, options) => options.UseNpgsql(connection)
                .AddInterceptors(new TenantSaveChangesInterceptor(sp.GetRequiredService<ITenantContext>())));
            services.AddScoped<ICoreWorkforceClient>(sp => new TenantCheckingWorkforceClient(sp.GetRequiredService<ITenantContext>(), resolvedTenants));
            services.AddSingleton<IPerformanceNotificationSender>(sender);
            services.AddSingleton<INotificationAudienceClient>(new FakeNotificationAudienceClient());
            services.Configure<PerformanceNotificationOptions>(o => { o.Enabled = true; o.ShellBaseUrl = "http://localhost:3000"; });
            services.AddScoped<PerformanceNotificationDispatcher>();
            await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
            using var worker = new PerformanceBackgroundWorker(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<PerformanceBackgroundWorker>.Instance, new EY.HRPlatform.Performance.Infrastructure.Evidence.EvidenceUploadSweeper(provider.GetRequiredService<IServiceScopeFactory>()),
                new EY.HRPlatform.Performance.Features.Notifications.PerformanceNotificationRetention(provider.GetRequiredService<IServiceScopeFactory>()),
                new EY.HRPlatform.Performance.Features.OneOnOnes.OneOnOneReconciler(provider.GetRequiredService<IServiceScopeFactory>()),
                new EY.HRPlatform.Performance.Features.Reviews.ReviewReminderScanner(provider.GetRequiredService<IServiceScopeFactory>()),
                new EY.HRPlatform.Performance.Features.Goals.GoalUpdateReminderScanner(provider.GetRequiredService<IServiceScopeFactory>()));
            await worker.ProcessBatchAsync(default);
            await worker.ProcessBatchAsync(default);
            Assert.Equal(new[] { tenantA, tenantB }.Order(), resolvedTenants.Order());
            Assert.Equal(new[] { tenantA, tenantB }.Select(tenant => $"{tenant:N}@tenant.test").Order(),
                sender.Delivered.Select(delivery => delivery.Email).Order());
            foreach (var tenant in new[] { tenantA, tenantB })
            {
                await using var db = RelationalTests.CreateDb(connection, tenant);
                var message = Assert.Single(await db.OutboxMessages.ToListAsync());
                Assert.NotNull(message.DispatchedAt);
                Assert.Equal(1, message.Attempts);
            }
        }
        finally { await RelationalTests.DropDatabaseAsync(baseConnection, name); }
    }

    /// <summary>
    /// Delivery is at least once: if the process stops after the mail server accepted a message but before
    /// the dispatch is committed, the message is sent again with the same identity rather than lost.
    /// </summary>
    [RelationalDatabaseFact]
    public async Task A_crash_after_the_mail_server_accepts_resends_the_same_message_and_never_loses_it()
    {
        var baseConnection = Environment.GetEnvironmentVariable("FUSION_PERFORMANCE_RELATIONAL_TEST_CONNECTION")!;
        var name = $"fusion_perf_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(baseConnection) { Database = name, Pooling = false }.ConnectionString;
        var tenant = Guid.NewGuid();
        var resolvedTenants = new List<Guid>();
        using var crash = new CancellationTokenSource();
        var sender = new CrashAfterAcceptSender(crash);
        try
        {
            await RelationalTests.CreateDatabaseAsync(baseConnection, name);
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                await db.Database.MigrateAsync();
                var message = NotificationTests.Message(tenant, Guid.NewGuid());
                db.OutboxMessages.Add(message);
                db.Notifications.Add(NotificationTests.InAppFor(message));
                await db.SaveChangesAsync();
            }
            var services = new ServiceCollection();
            services.AddScoped<TenantContext>();
            services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
            services.AddDbContext<PerformanceDbContext>((sp, options) => options.UseNpgsql(connection)
                .AddInterceptors(new TenantSaveChangesInterceptor(sp.GetRequiredService<ITenantContext>())));
            services.AddScoped<ICoreWorkforceClient>(sp => new TenantCheckingWorkforceClient(sp.GetRequiredService<ITenantContext>(), resolvedTenants));
            services.AddSingleton<IPerformanceNotificationSender>(sender);
            services.AddSingleton<INotificationAudienceClient>(new FakeNotificationAudienceClient());
            services.Configure<PerformanceNotificationOptions>(o => { o.Enabled = true; o.ShellBaseUrl = "http://localhost:3000"; });
            services.AddScoped<PerformanceNotificationDispatcher>();
            await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
            var scopes = provider.GetRequiredService<IServiceScopeFactory>();
            using var worker = new PerformanceBackgroundWorker(scopes, NullLogger<PerformanceBackgroundWorker>.Instance,
                new EY.HRPlatform.Performance.Infrastructure.Evidence.EvidenceUploadSweeper(scopes),
                new EY.HRPlatform.Performance.Features.Notifications.PerformanceNotificationRetention(scopes),
                new EY.HRPlatform.Performance.Features.OneOnOnes.OneOnOneReconciler(scopes), new EY.HRPlatform.Performance.Features.Reviews.ReviewReminderScanner(scopes),
                new EY.HRPlatform.Performance.Features.Goals.GoalUpdateReminderScanner(scopes));

            // The server accepts, then the worker stops before its bookkeeping commits.
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => worker.ProcessBatchAsync(crash.Token));
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                var pending = Assert.Single(await db.OutboxMessages.ToListAsync());
                Assert.Null(pending.DispatchedAt);
                Assert.Equal(0, pending.Attempts);
            }

            await worker.ProcessBatchAsync(default);
            Assert.Equal(2, sender.Accepted.Count);
            Assert.Single(sender.Accepted.Distinct());
            await using (var db = RelationalTests.CreateDb(connection, tenant))
            {
                var message = Assert.Single(await db.OutboxMessages.ToListAsync());
                Assert.Equal(sender.Accepted[0], message.Id);
                Assert.NotNull(message.DispatchedAt);
                Assert.Equal(1, message.Attempts);
            }
            // Once recorded, it is never sent again.
            await worker.ProcessBatchAsync(default);
            Assert.Equal(2, sender.Accepted.Count);
        }
        finally { await RelationalTests.DropDatabaseAsync(baseConnection, name); }
    }

    private sealed class CrashAfterAcceptSender(CancellationTokenSource crash) : IPerformanceNotificationSender
    {
        public List<Guid> Accepted { get; } = [];
        public Task SendAsync(FusionOutgoingEmail email, CancellationToken cancellationToken)
        {
            Accepted.Add(Guid.ParseExact(email.MessageId[1..33], "N"));
            if (Accepted.Count == 1)
            {
                crash.Cancel();
                throw new OperationCanceledException(crash.Token);
            }
            return Task.CompletedTask;
        }
    }

    private sealed class TenantCheckingWorkforceClient(ITenantContext tenant, List<Guid> resolvedTenants) : ICoreWorkforceClient
    {
        public Task<IReadOnlyList<WorkforceSnapshot>> ResolveAsync(DateTime asOf, IReadOnlyCollection<Guid> employeeIds, CancellationToken cancellationToken)
        {
            resolvedTenants.Add(tenant.TenantId);
            return Task.FromResult<IReadOnlyList<WorkforceSnapshot>>([new(employeeIds.Single(), "employee", "Employee", "Employee",
                $"{tenant.TenantId:N}@tenant.test", null, true, null, null)]);
        }
        public Task<IReadOnlyList<WorkforceOrgUnitContext>> ResolveOrgUnitsAsync(DateTime asOf, IReadOnlyCollection<Guid> orgUnitIds, CancellationToken cancellationToken)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<WorkforceSnapshot>> GetAllActiveAsOfAsync(DateTime asOf, CancellationToken cancellationToken)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<WorkforceSnapshot>> GetByScopeAsync(DateTime asOf, IReadOnlyCollection<Guid> orgUnitIds, bool includeDescendants, CancellationToken cancellationToken)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<WorkforceSnapshot>> GetDirectReportsAsync(DateTime asOf, IReadOnlyCollection<Guid> managerEmployeeIds, CancellationToken cancellationToken)
            => Task.FromResult<IReadOnlyList<WorkforceSnapshot>>([]);
        public Task<IReadOnlyList<WorkforceSnapshot>> SearchAsync(DateTime asOf, string term, int limit, CancellationToken cancellationToken)
            => throw new NotSupportedException();
    }
}
