using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Domain.Enums;
using EY.HRPlatform.Identity.Features.SingleSignOn;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Controllers;

public sealed record SetFusionProvidersRequest(bool AllowMicrosoft, bool AllowGoogle);

public sealed record SaveSsoConnectionRequest(
    string Kind,
    string DisplayName,
    string? Issuer,
    string? EntraTenantId,
    string ClientId,
    string? ClientSecret,
    string? Password,
    bool Sso);

public sealed record SsoConfirmationRequest(string? Password, bool Sso);

public sealed record AddSsoDomainRequest(string Domain);

public sealed record SetSsoRequirementRequest(bool On, string? Password, bool Sso);

public sealed record SsoConnectionDto(
    Guid Id,
    string Kind,
    string DisplayName,
    string Issuer,
    string? EntraTenantId,
    string ClientId,
    DateTime SecretSetAt,
    string Status,
    DateTime? LastTestAt,
    string? LastTestOutcome,
    string? LastTestEmail,
    string? LastTestMessage,
    DateTime? RequiredAt,
    string? RequiredByName,
    int? RequiredEndedSessions,
    DateTime? LastSignInAt);

public sealed record SsoDomainDto(string Domain, DateTime? ProvedAt);

public sealed record SsoAdministratorDto(Guid UserId, string Name, bool HasPassword);

public sealed record SsoYouDto(bool HasPassword, bool IsAdministrator, IReadOnlyList<string> ConfirmWith, DateTime? ConnectionLinkUsedAt);

public sealed record SsoRequirementChecksDto(bool Tested, bool DomainProved, bool FreshOwnLink, bool AdministratorWithPassword);

public sealed record SsoSettingsDto(
    bool CanManage,
    bool AllowMicrosoft,
    bool AllowGoogle,
    bool MicrosoftAvailable,
    bool GoogleAvailable,
    string RedirectUri,
    SsoConnectionDto? Connection,
    IReadOnlyList<SsoDomainDto> Domains,
    IReadOnlyList<SsoAdministratorDto> Administrators,
    SsoYouDto You,
    SsoRequirementChecksDto Checks);

public sealed record SsoLinkDto(Guid Id, string Provider, string Label, string Email, DateTime LinkedAt, DateTime LastUsedAt);

/// <summary>
/// Settings › Sign-in › Single sign-on (B-191). Anyone who can see the company's sign-in settings reads it; every change
/// needs a usable administrator of the company in the token, and the company is only ever the token's.
/// </summary>
[ApiController]
[Authorize]
[Route("api/identity/sso")]
public sealed class SsoSettingsController(
    AppIdentityDbContext dbContext,
    ITenantContext tenantContext,
    SsoPolicy policy,
    SsoProviderCatalog catalog,
    SsoOidcClient oidc,
    SsoStepUp stepUp) : ControllerBase
{
    public static readonly TimeSpan FreshLink = TimeSpan.FromMinutes(15);

    [HttpGet("settings")]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: false, cancellationToken);
        if (refusal is not null) return refusal;
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    [HttpPut("settings/providers")]
    public async Task<IActionResult> SetProviders([FromBody] SetFusionProvidersRequest request, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        var tenant = await dbContext.Tenants.IgnoreQueryFilters().FirstAsync(item => item.Id == tenantId, cancellationToken);
        var before = new { microsoft = tenant.AllowMicrosoftSignIn, google = tenant.AllowGoogleSignIn };
        tenant.SetFusionSignIn(request.AllowMicrosoft, request.AllowGoogle);
        Audit(tenantId, SsoAuditActions.ProvidersChanged, null, "Changed who can sign in with Microsoft and Google.",
            before, new { microsoft = request.AllowMicrosoft, google = request.AllowGoogle });
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    [HttpPut("settings/connection")]
    public async Task<IActionResult> SaveConnection([FromBody] SaveSsoConnectionRequest request, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        if (!Enum.TryParse<SsoConnectionKind>(request.Kind, ignoreCase: true, out var kind) || !Enum.IsDefined(kind))
            return Problem(400, "invalid", "Choose Microsoft Entra ID or another OpenID Connect provider.");
        var displayName = request.DisplayName?.Trim() ?? string.Empty;
        var clientId = request.ClientId?.Trim() ?? string.Empty;
        if (displayName.Length is 0 or > SsoConnection.DisplayNameMaxLength)
            return Problem(400, "invalid", "Give the button a name of up to 60 characters.");
        if (clientId.Length is 0 or > SsoConnection.ClientIdMaxLength)
            return Problem(400, "invalid", "Enter the application (client) ID.");

        string issuer;
        string? directory = null;
        if (kind == SsoConnectionKind.MicrosoftEntra)
        {
            if (!Guid.TryParse(request.EntraTenantId?.Trim(), out var directoryId))
                return Problem(400, "invalid", "Enter the directory (tenant) ID from Entra ID.");
            directory = directoryId.ToString();
            issuer = catalog.EntraIssuer(directory);
        }
        else
        {
            issuer = request.Issuer?.Trim().TrimEnd('/') ?? string.Empty;
            if (issuer.Length is 0 or > SsoConnection.IssuerMaxLength || !Uri.TryCreate(issuer, UriKind.Absolute, out _))
                return Problem(400, "invalid", "Enter the issuer address.");
        }

        var connection = await dbContext.SsoConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        var secret = request.ClientSecret?.Trim();
        if (connection is null && string.IsNullOrEmpty(secret))
            return Problem(400, "invalid", "Enter the client secret.");
        if (connection is not null && connection.IsRequired && connection.ChangesIdentity(kind, issuer, directory, clientId))
            return Problem(409, "requirement-on", "Turn the requirement off to change the directory or the application.");
        // The stored secret only ever goes to the provider it was entered for: a new issuer or application needs it
        // typed again, so changing the address can't send the old secret somewhere else.
        if (connection is not null && string.IsNullOrEmpty(secret) && connection.ChangesIdentity(kind, issuer, directory, clientId))
            return Problem(400, "secret-required", "Enter the client secret again for the new provider settings.");

        var confirmed = await ConfirmAsync(new StepUpProof(request.Password, request.Sso), cancellationToken);
        if (confirmed is not null) return confirmed;

        // Fusion checks it can read the provider's sign-in settings before saving.
        var probe = new SsoProvider(SsoProviderKeys.Company, SsoConnection.IdFor(tenantId), tenantId, displayName, issuer, issuer,
            clientId, secret ?? string.Empty, kind == SsoConnectionKind.MicrosoftEntra ? SsoTrustProfile.CompanyEntra : SsoTrustProfile.CompanyOidc,
            directory);
        try
        {
            await oidc.DiscoverAsync(probe, cancellationToken, refresh: true);
        }
        catch (SsoBackchannelException exception)
        {
            return Problem(400, "issuer-unreadable", exception.Message);
        }

        var now = DateTime.UtcNow;
        var actorId = User.GetUserId();
        if (connection is null)
        {
            connection = SsoConnection.Create(tenantId, kind, displayName, issuer, directory, clientId,
                catalog.ProtectSecret(tenantId, secret!), actorId, now);
            dbContext.SsoConnections.Add(connection);
            Audit(tenantId, SsoAuditActions.ConnectionSaved, connection.Id.ToString(), $"Connected {displayName}.", null,
                new { kind = kind.ToString(), issuer, clientId });
        }
        else
        {
            var before = new { kind = connection.Kind.ToString(), connection.Issuer, connection.ClientId, connection.DisplayName };
            connection.Update(kind, displayName, issuer, directory, clientId, actorId, now);
            Audit(tenantId, SsoAuditActions.ConnectionSaved, connection.Id.ToString(), $"Changed {displayName}.", before,
                new { kind = kind.ToString(), issuer, clientId, displayName });
            if (!string.IsNullOrEmpty(secret))
            {
                connection.ReplaceSecret(catalog.ProtectSecret(tenantId, secret), actorId, now);
                Audit(tenantId, SsoAuditActions.SecretReplaced, connection.Id.ToString(), $"Replaced {displayName}'s client secret.", null, null);
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    [HttpDelete("settings/connection")]
    public async Task<IActionResult> RemoveConnection([FromBody] SsoConfirmationRequest? request, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        var connection = await dbContext.SsoConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        if (connection is null) return Problem(404, "not-found", "There's no provider connected.");
        if (connection.IsRequired) return Problem(409, "requirement-on", "Turn the requirement off first.");

        var confirmed = await ConfirmAsync(new StepUpProof(request?.Password, request?.Sso == true), cancellationToken);
        if (confirmed is not null) return confirmed;

        dbContext.ExternalLogins.RemoveRange(await dbContext.ExternalLogins.Where(item => item.ConnectionId == connection.Id).ToListAsync(cancellationToken));
        dbContext.SsoDomains.RemoveRange(await dbContext.SsoDomains.IgnoreQueryFilters().Where(item => item.ConnectionId == connection.Id).ToListAsync(cancellationToken));
        dbContext.SsoConnections.Remove(connection);
        Audit(tenantId, SsoAuditActions.ConnectionRemoved, connection.Id.ToString(), $"Removed {connection.DisplayName}.", null, null);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    [HttpPost("settings/domains")]
    public async Task<IActionResult> AddDomain([FromBody] AddSsoDomainRequest request, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        var connection = await dbContext.SsoConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        if (connection is null) return Problem(409, "no-connection", "Connect your company's provider first.");

        var domain = SsoPolicy.NormalizeDomain(request.Domain);
        if (domain is null) return Problem(400, "invalid", "Enter a domain like example.com.");
        if (SsoPolicy.IsPublicMailDomain(domain))
            return Problem(400, "public-domain", $"{domain} is a public mail service; anyone can have an address there.");
        if (await dbContext.SsoDomains.IgnoreQueryFilters().AnyAsync(item => item.TenantId == tenantId && item.Domain == domain, cancellationToken))
            return Problem(409, "duplicate", $"{domain} is already listed.");
        if (await dbContext.SsoDomains.IgnoreQueryFilters().AnyAsync(item => item.Domain == domain && item.ProvedAt != null, cancellationToken))
            return Problem(409, "domain-taken", $"Another company has already proved {domain}.");

        dbContext.SsoDomains.Add(SsoDomain.Create(tenantId, connection.Id, domain, User.GetUserId(), DateTime.UtcNow));
        Audit(tenantId, SsoAuditActions.DomainAdded, domain, $"Added {domain}.", null, new { domain });
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    [HttpDelete("settings/domains/{domain}")]
    public async Task<IActionResult> RemoveDomain(string domain, [FromBody] SsoConfirmationRequest? request, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        var normalized = SsoPolicy.NormalizeDomain(domain);
        var row = await dbContext.SsoDomains.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId && item.Domain == normalized, cancellationToken);
        if (row is null) return Problem(404, "not-found", "That domain isn't listed.");

        if (row.IsProved)
        {
            var connection = await dbContext.SsoConnections.IgnoreQueryFilters().FirstAsync(item => item.Id == row.ConnectionId, cancellationToken);
            var otherProved = await dbContext.SsoDomains.IgnoreQueryFilters()
                .AnyAsync(item => item.TenantId == tenantId && item.Id != row.Id && item.ProvedAt != null, cancellationToken);
            if (connection.IsRequired && !otherProved)
                return Problem(409, "requirement-on", "This is the last proved domain; turn the requirement off first.");

            var confirmed = await ConfirmAsync(new StepUpProof(request?.Password, request?.Sso == true), cancellationToken);
            if (confirmed is not null) return confirmed;
        }

        dbContext.SsoDomains.Remove(row);
        Audit(tenantId, SsoAuditActions.DomainRemoved, row.Domain, $"Removed {row.Domain}.", new { domain = row.Domain, proved = row.IsProved }, null);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    /// <summary>
    /// Turns the requirement on (B-191 D10, D11) when the connection is tested, a domain is proved, the caller signed in
    /// with it in the last 15 minutes and an administrator keeps a password; password sessions it now covers end in the
    /// same transaction. Turning it off asks the caller to confirm it's them.
    /// </summary>
    [HttpPost("settings/requirement")]
    public async Task<IActionResult> SetRequirement([FromBody] SetSsoRequirementRequest request, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        var relational = dbContext.Database.IsRelational();
        await using var transaction = relational ? await dbContext.Database.BeginTransactionAsync(cancellationToken) : null;
        if (relational)
        {
            await dbContext.Database.ExecuteSqlRawAsync(
                "SELECT 1 FROM identity.\"Tenants\" WHERE \"Id\" = {0} FOR UPDATE", [tenantId], cancellationToken);
        }

        var connection = await dbContext.SsoConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        if (connection is null) return Problem(409, "no-connection", "Connect your company's provider first.");

        if (!request.On)
        {
            if (!connection.IsRequired) return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
            var confirmed = await ConfirmAsync(new StepUpProof(request.Password, request.Sso), cancellationToken);
            if (confirmed is not null) return confirmed;
            connection.StopRequiring();
            Audit(tenantId, SsoAuditActions.RequirementOff, connection.Id.ToString(), $"Stopped requiring {connection.DisplayName}.", null, null);
            await dbContext.SaveChangesAsync(cancellationToken);
            if (transaction is not null) await transaction.CommitAsync(cancellationToken);
            return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
        }

        if (connection.IsRequired) return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
        var checks = await ChecksAsync(tenantId, connection, User.GetUserId(), cancellationToken);
        if (!checks.Tested || !checks.DomainProved || !checks.FreshOwnLink || !checks.AdministratorWithPassword)
            return Problem(409, "requirement-not-ready", "Not everything the requirement needs is in place yet.");

        var ended = await policy.EndPasswordSessionsAsync(tenantId, cancellationToken);
        connection.Require(User.GetUserId(), DateTime.UtcNow, ended);
        Audit(tenantId, SsoAuditActions.RequirementOn, connection.Id.ToString(),
            $"Started requiring {connection.DisplayName}; {ended} password sessions ended.", null, new { endedSessions = ended });
        await dbContext.SaveChangesAsync(cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        return Ok(ApiResponse<SsoSettingsDto>.Success(await ReadAsync(tenantId, cancellationToken)));
    }

    /// <summary>How a person in this company signs in; for its administrators, or for the person themselves.</summary>
    [HttpGet("links")]
    public async Task<IActionResult> Links([FromQuery] Guid userId, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantIdOrDefault;
        if (tenantId is null || tenantId == Guid.Empty) return Problem(403, "tenant-context-invalid", "A company is required.");
        var self = userId == User.GetUserId();
        if (!self && !await policy.IsUsableAdministratorAsync(tenantId.Value, User.GetUserId(), cancellationToken))
            return Problem(403, "permission-denied", "Only administrators can see how someone signs in.");
        if (!await IsMemberAsync(tenantId.Value, userId, cancellationToken))
            return Problem(404, "not-found", "That person isn't in this company.");

        var connection = await dbContext.SsoConnections.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        var links = await dbContext.ExternalLogins.AsNoTracking()
            .Where(item => item.UserId == userId)
            .OrderBy(item => item.LinkedAt)
            .ToListAsync(cancellationToken);
        return Ok(ApiResponse<List<SsoLinkDto>>.Success(links
            .Select(item => new SsoLinkDto(item.Id, item.Provider, Label(item.Provider, connection), item.EmailAtLink, item.LinkedAt, item.LastUsedAt))
            .ToList()));
    }

    /// <summary>Removes a person's provider link, for a mailbox that changed hands. The company's usable administrators only.</summary>
    [HttpDelete("links/{linkId:guid}")]
    public async Task<IActionResult> RemoveLink(Guid linkId, CancellationToken cancellationToken)
    {
        var (tenantId, refusal) = await ResolveAsync(write: true, cancellationToken);
        if (refusal is not null) return refusal;

        var link = await dbContext.ExternalLogins.FirstOrDefaultAsync(item => item.Id == linkId, cancellationToken);
        if (link is null || !await IsMemberAsync(tenantId, link.UserId, cancellationToken))
            return Problem(404, "not-found", "That link doesn't exist.");

        dbContext.ExternalLogins.Remove(link);
        Audit(tenantId, SsoAuditActions.LinkRemoved, link.Id.ToString(), $"Removed a {link.Provider} sign-in link.",
            new { provider = link.Provider, userId = link.UserId }, null);
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ApiResponse<object>.Success(new { removed = linkId }));
    }

    // ── plumbing ─────────────────────────────────────────

    private async Task<SsoSettingsDto> ReadAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var actorId = User.GetUserId();
        var tenant = await dbContext.Tenants.IgnoreQueryFilters().AsNoTracking().FirstAsync(item => item.Id == tenantId, cancellationToken);
        var connection = await dbContext.SsoConnections.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        var domains = await dbContext.SsoDomains.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == tenantId)
            .OrderBy(item => item.Domain)
            .Select(item => new SsoDomainDto(item.Domain, item.ProvedAt))
            .ToListAsync(cancellationToken);
        var administrators = await UsableTenantAdministrator.ForTenant(dbContext, tenantId).AsNoTracking()
            .Select(assignment => new SsoAdministratorDto(
                assignment.UserId, (assignment.User!.FirstName + " " + assignment.User!.LastName).Trim(), assignment.User!.PasswordHash != null))
            .ToListAsync(cancellationToken);
        var actor = await dbContext.Users.IgnoreQueryFilters().AsNoTracking().FirstAsync(item => item.Id == actorId, cancellationToken);
        var actorLinks = await dbContext.ExternalLogins.AsNoTracking().Where(item => item.UserId == actorId).ToListAsync(cancellationToken);

        SsoConnectionDto? connectionDto = null;
        if (connection is not null)
        {
            var requiredBy = connection.RequiredByUserId is { } requiredById
                ? await dbContext.Users.IgnoreQueryFilters().AsNoTracking().Where(item => item.Id == requiredById)
                    .Select(item => (item.FirstName + " " + item.LastName).Trim()).FirstOrDefaultAsync(cancellationToken)
                : null;
            var lastSignIn = await dbContext.ExternalLogins.AsNoTracking()
                .Where(item => item.ConnectionId == connection.Id)
                .MaxAsync(item => (DateTime?)item.LastUsedAt, cancellationToken);
            connectionDto = new SsoConnectionDto(
                connection.Id, connection.Kind.ToString(), connection.DisplayName, connection.Issuer, connection.EntraTenantId,
                connection.ClientId, connection.SecretSetAt, connection.Status.ToString(), connection.LastTestAt,
                connection.LastTestOutcome, connection.LastTestEmail, connection.LastTestMessage, connection.RequiredAt,
                requiredBy, connection.RequiredEndedSessions, lastSignIn);
        }

        var confirmWith = actorLinks
            .Where(item => item.Provider != SsoProviderKeys.Company || item.ConnectionId == connection?.Id)
            .Select(item => item.Provider)
            .Where(key => key == SsoProviderKeys.Company || catalog.IsAvailable(key))
            .Distinct()
            .ToList();

        var checks = connection is null
            ? new SsoRequirementChecksDto(false, false, false, administrators.Any(item => item.HasPassword))
            : await ChecksAsync(tenantId, connection, actorId, cancellationToken);

        return new SsoSettingsDto(
            CanManage: administrators.Any(item => item.UserId == actorId) && !ReadOnlyViewMiddleware.IsViewing(User),
            AllowMicrosoft: tenant.AllowMicrosoftSignIn,
            AllowGoogle: tenant.AllowGoogleSignIn,
            MicrosoftAvailable: catalog.IsAvailable(SsoProviderKeys.Microsoft),
            GoogleAvailable: catalog.IsAvailable(SsoProviderKeys.Google),
            RedirectUri: catalog.RedirectUriForConnection(SsoConnection.IdFor(tenantId)),
            Connection: connectionDto,
            Domains: domains,
            Administrators: administrators,
            You: new SsoYouDto(
                actor.PasswordHash != null,
                administrators.Any(item => item.UserId == actorId),
                confirmWith,
                actorLinks.FirstOrDefault(item => item.ConnectionId == connection?.Id && connection is not null)?.LastUsedAt),
            Checks: checks);
    }

    private async Task<SsoRequirementChecksDto> ChecksAsync(Guid tenantId, SsoConnection connection, Guid actorId, CancellationToken cancellationToken)
    {
        var since = DateTime.UtcNow - FreshLink;
        return new SsoRequirementChecksDto(
            Tested: connection.Status == SsoConnectionStatus.Tested,
            DomainProved: await dbContext.SsoDomains.IgnoreQueryFilters().AnyAsync(item => item.TenantId == tenantId && item.ProvedAt != null, cancellationToken),
            FreshOwnLink: await dbContext.ExternalLogins.AnyAsync(item => item.UserId == actorId && item.ConnectionId == connection.Id
                && item.LastUsedAt >= since, cancellationToken),
            AdministratorWithPassword: await UsableTenantAdministrator.ForTenant(dbContext, tenantId)
                .AnyAsync(assignment => assignment.User!.PasswordHash != null, cancellationToken));
    }

    /// <summary>
    /// The company comes from the token only. Reading needs the sign-in settings view (or an administrator); every
    /// write needs a usable administrator of this company.
    /// </summary>
    private async Task<(Guid TenantId, IActionResult? Refusal)> ResolveAsync(bool write, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantIdOrDefault;
        if (tenantId is null || tenantId == Guid.Empty)
            return (Guid.Empty, Problem(403, "tenant-context-invalid", "A company is required."));

        var administrator = await policy.IsUsableAdministratorAsync(tenantId.Value, User.GetUserId(), cancellationToken);
        if (write && !administrator)
            return (tenantId.Value, Problem(403, "permission-denied", "Only administrators can change single sign-on."));
        if (!write && !administrator
            && !User.HasCorePermission(CorePermissions.SettingsProvisioningView, PermissionScopes.Tenant)
            && !User.HasCorePermission(CorePermissions.SettingsProvisioningManage, PermissionScopes.Tenant))
            return (tenantId.Value, Problem(403, "permission-denied", "You can't see sign-in settings."));

        return (tenantId.Value, null);
    }

    private async Task<IActionResult?> ConfirmAsync(StepUpProof proof, CancellationToken cancellationToken)
    {
        var actorId = User.GetUserId();
        var actor = await dbContext.Users.IgnoreQueryFilters().FirstOrDefaultAsync(item => item.Id == actorId, cancellationToken);
        if (actor is null) return Problem(403, "permission-denied", "You can't do that.");
        var outcome = await stepUp.VerifyAsync(actor, proof, cancellationToken);
        if (outcome == StepUpOutcome.Confirmed) return null;
        var (status, code, message) = SsoStepUp.Refusal(outcome);
        return Problem(status, code, message);
    }

    private Task<bool> IsMemberAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken)
        => dbContext.TenantMemberships.IgnoreQueryFilters()
            .AnyAsync(item => item.TenantId == tenantId && item.UserId == userId && item.Status == TenantMembershipStatus.Active, cancellationToken);

    private static string Label(string provider, SsoConnection? connection) => provider switch
    {
        SsoProviderKeys.Microsoft => "Microsoft",
        SsoProviderKeys.Google => "Google",
        _ => connection?.DisplayName ?? "Company provider",
    };

    private void Audit(Guid tenantId, string action, string? resourceId, string summary, object? before, object? after)
        => dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId, User.GetUserId(), User.GetFullName(), string.Empty, action, SsoAuditActions.ResourceType, resourceId, summary,
            before is null ? null : JsonSerializer.Serialize(before, JsonOptions),
            after is null ? null : JsonSerializer.Serialize(after, JsonOptions),
            HttpContext.TraceIdentifier));

    private ObjectResult Problem(int status, string code, string message)
        => StatusCode(status, ApiResponse<object>.Failure(message, new { code }));

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}
