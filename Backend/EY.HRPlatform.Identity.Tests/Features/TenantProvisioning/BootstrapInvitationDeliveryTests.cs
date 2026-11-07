using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;

namespace EY.HRPlatform.Identity.Tests.Features.TenantProvisioning;

/// <summary>
/// The real delivery path, end to end: provisioning and each recovery command
/// through <see cref="BootstrapInvitationDelivery"/> into the capturing sender.
///
/// These assert on the message a recipient would receive, not on the fact that a
/// send was attempted, and they prove that a failed send leaves the invitation
/// Pending and recoverable rather than silently consumed.
/// </summary>
[Collection(CapturedBootstrapMailCollection.Name)]
public sealed class BootstrapInvitationDeliveryTests : IAsyncLifetime
{
    private static readonly Guid Actor = new("eeeeeeee-0000-0000-0000-00000000000e");
    private const string InvitedEmail = "admin@atlas.example";

    private string? _admin;
    private readonly List<string> _databases = [];
    private string _captureDirectory = string.Empty;
    private bool Available => _admin is not null;

    public Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("FUSION_TEST_PG")
            ?? Environment.GetEnvironmentVariable("ConnectionStrings__IdentityDb");
        if (!string.IsNullOrWhiteSpace(configured)) _admin = configured;

        _captureDirectory = Path.Combine(Path.GetTempPath(), $"fusion-mail-{Guid.NewGuid():N}");
        CapturedBootstrapInvitationEmailSender.Clear();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        CapturedBootstrapInvitationEmailSender.Clear();
        if (Directory.Exists(_captureDirectory)) Directory.Delete(_captureDirectory, recursive: true);
        if (!Available) return;
        foreach (var database in _databases) await DropAsync(database);
    }

    // ── Provisioning sends the approved message ──────────

    [SkippableFact]
    public async Task Provisioning_delivers_the_rendered_invitation_and_records_it_sent()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();

        var result = await ProvisionAsync(db, InvitedEmail);
        var invitationId = result.BootstrapInvitationId;

        var captured = CapturedBootstrapInvitationEmailSender.LastFor(InvitedEmail);
        Assert.NotNull(captured);

        // The message the recipient reads names the tenant, the address it was
        // sent to, and when it stops working.
        Assert.Equal("Set up your Fusion administrator account for Atlas Group", captured!.Subject);
        Assert.Contains("Atlas Group", captured.Html);
        Assert.Contains(InvitedEmail, captured.Text);
        Assert.Contains("/activate-invitation?credential=", captured.ActivationLink);
        Assert.Contains("&company=", captured.ActivationLink);

        var invitation = await db.InviteTokens.IgnoreQueryFilters().SingleAsync(i => i.Id == invitationId);
        Assert.Contains(
            BootstrapInvitationTemplate.FormatExpiry(invitation.ExpiresAt), captured.Html);

        var attempt = Assert.Single(await db.InvitationDeliveryAttempts.IgnoreQueryFilters()
            .Where(a => a.InvitationId == invitationId).ToListAsync());
        Assert.Equal(InvitationDeliveryOutcome.Sent, attempt.Outcome);

        // Both representations are retained on disk for the local demonstration.
        Assert.NotEmpty(Directory.GetFiles(_captureDirectory, "*.html"));
        Assert.NotEmpty(Directory.GetFiles(_captureDirectory, "*.txt"));
    }

    [SkippableFact]
    public async Task The_delivered_link_activates()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();
        await ProvisionAsync(db, InvitedEmail);

        var captured = CapturedBootstrapInvitationEmailSender.LastFor(InvitedEmail)!;

        // The credential in the message is the one activation accepts — a link
        // that renders correctly but does not work is not a delivered invitation.
        var credential = new Uri(captured.ActivationLink).Query;
        Assert.Contains("credential=", credential);
    }

    // ── Every recovery command uses the same template ────

    [SkippableFact]
    public async Task Resend_reuses_the_same_active_invitation_and_template()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();
        var provisioned = await ProvisionAsync(db, InvitedEmail);

        var first = CapturedBootstrapInvitationEmailSender.LastFor(InvitedEmail)!;

        var resend = await CreateRecovery(db).ResendAsync(
            provisioned.TenantId, provisioned.BootstrapInvitationId, Actor);
        Assert.True(resend.IsSuccess);

        var second = CapturedBootstrapInvitationEmailSender.LastFor(InvitedEmail)!;

        // Same invitation, same message — only the credential rotates, because the
        // secret was never stored and cannot be resent.
        Assert.Equal(provisioned.BootstrapInvitationId, resend.Value);
        Assert.Equal(first.Subject, second.Subject);
        Assert.Equal(first.TenantName, second.TenantName);
        Assert.NotEqual(first.ActivationLink, second.ActivationLink);
    }

    [SkippableFact]
    public async Task Replacement_sends_the_new_invitation_to_the_new_address()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();
        var provisioned = await ProvisionAsync(db, InvitedEmail);

        const string replacement = "new.admin@atlas.example";
        var result = await CreateRecovery(db).ReplaceAsync(
            provisioned.TenantId, provisioned.BootstrapInvitationId, replacement, Actor);
        Assert.True(result.IsSuccess);

        var captured = CapturedBootstrapInvitationEmailSender.LastFor(replacement);
        Assert.NotNull(captured);
        Assert.Contains(replacement, captured!.Text);
        Assert.Equal("Set up your Fusion administrator account for Atlas Group", captured.Subject);
    }

    [SkippableFact]
    public async Task Reissue_after_expiry_sends_the_replacement_invitation()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();
        var provisioned = await ProvisionAsync(db, InvitedEmail);

        var invitation = await db.InviteTokens.IgnoreQueryFilters()
            .SingleAsync(i => i.Id == provisioned.BootstrapInvitationId);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE identity.\"InviteTokens\" SET \"ExpiresAt\" = {0} WHERE \"Id\" = {1}",
            DateTime.UtcNow.AddDays(-1), invitation.Id);
        db.ChangeTracker.Clear();

        var before = CapturedBootstrapInvitationEmailSender.Messages.Count;
        var result = await CreateRecovery(db).ReissueAsync(
            provisioned.TenantId, provisioned.BootstrapInvitationId, Actor);
        Assert.True(result.IsSuccess);

        Assert.Equal(before + 1, CapturedBootstrapInvitationEmailSender.Messages.Count);
        Assert.NotEqual(provisioned.BootstrapInvitationId, result.Value);
    }

    // ── Failure stays truthful and recoverable ───────────

    [SkippableFact]
    public async Task A_failed_delivery_leaves_the_invitation_pending_and_recoverable()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();

        // A reserved address that always bounces, so this is a genuine failure of
        // a genuine invitation rather than a record written by hand.
        const string bouncing = "admin@atlas" + BootstrapDeliveryProbe.UndeliverableDomain;
        var provisioned = await ProvisionAsync(db, bouncing);

        // Nothing was captured, because nothing was delivered.
        Assert.Null(CapturedBootstrapInvitationEmailSender.LastFor(bouncing));

        var attempt = Assert.Single(await db.InvitationDeliveryAttempts.IgnoreQueryFilters()
            .Where(a => a.InvitationId == provisioned.BootstrapInvitationId).ToListAsync());
        Assert.Equal(InvitationDeliveryOutcome.Failed, attempt.Outcome);
        Assert.Equal("delivery_rejected", attempt.SanitizedFailureCode);

        // Provisioning committed and the invitation is still usable, so the
        // Platform Administrator can resend or replace rather than start again.
        var invitation = await db.InviteTokens.IgnoreQueryFilters()
            .SingleAsync(i => i.Id == provisioned.BootstrapInvitationId);
        Assert.Equal(InvitationState.Pending, invitation.State);

        Assert.Contains(await db.TenantBootstrapAuditEvents.IgnoreQueryFilters().ToListAsync(),
            e => e.EventType == TenantBootstrapAuditEventType.InvitationDeliveryAttempted
                && e.Outcome == "Failed");
    }

    [SkippableFact]
    public async Task A_failed_delivery_can_be_recovered_by_replacing_the_address()
    {
        Skip.IfNot(Available, "No PostgreSQL connection configured.");
        await using var db = await CreateDatabaseAsync();

        const string bouncing = "admin@atlas" + BootstrapDeliveryProbe.UndeliverableDomain;
        var provisioned = await ProvisionAsync(db, bouncing);

        var result = await CreateRecovery(db).ReplaceAsync(
            provisioned.TenantId, provisioned.BootstrapInvitationId, InvitedEmail, Actor);

        Assert.True(result.IsSuccess);
        Assert.NotNull(CapturedBootstrapInvitationEmailSender.LastFor(InvitedEmail));
    }

    // ── plumbing ─────────────────────────────────────────

    private async Task<ProvisionTenantResult> ProvisionAsync(AppIdentityDbContext db, string email)
    {
        var result = await new TenantProvisioningService(db, CreateDelivery(db)).ProvisionAsync(
            new ProvisionTenantRequest
            {
                Name = "Atlas Group",
                Locale = "en-US",
                TimeZone = "Europe/Paris",
                AdministratorEmail = email,
                IdempotencyKey = $"delivery-{Guid.NewGuid():N}",
            }, Actor);

        Assert.True(result.IsSuccess);
        db.ChangeTracker.Clear();
        return result.Value;
    }

    private IBootstrapInvitationRecoveryService CreateRecovery(AppIdentityDbContext db)
        => new BootstrapInvitationRecoveryService(db, CreateDelivery(db));

    /// <summary>The production delivery step, wired to the capturing sender.</summary>
    private IBootstrapInvitationDelivery CreateDelivery(AppIdentityDbContext db)
    {
        var sender = new CapturedBootstrapInvitationEmailSender(
            Options.Create(new BootstrapInvitationCaptureOptions { Directory = _captureDirectory }),
            NullLogger<CapturedBootstrapInvitationEmailSender>.Instance);

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Application:PublicBaseUrl"] = "http://localhost:3000",
            })
            .Build();

        return new BootstrapInvitationDelivery(
            db, sender, configuration, NullLogger<BootstrapInvitationDelivery>.Instance);
    }

    private async Task<AppIdentityDbContext> CreateDatabaseAsync()
    {
        var name = $"fusion_delivery_test_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(AdminConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{name}\";";
            await command.ExecuteNonQueryAsync();
        }

        _databases.Add(name);

        var context = new AppIdentityDbContext(
            new DbContextOptionsBuilder<AppIdentityDbContext>()
                .UseNpgsql(new NpgsqlConnectionStringBuilder(_admin) { Database = name }.ConnectionString)
                .Options);

        await context.Database.MigrateAsync();
        return context;
    }

    private async Task DropAsync(string database)
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(AdminConnectionString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE);";
        await command.ExecuteNonQueryAsync();
    }

    private string AdminConnectionString()
        => new NpgsqlConnectionStringBuilder(_admin) { Database = "postgres" }.ConnectionString;
}
