using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Models.Responses;
using EY.HRPlatform.SharedKernel.Auth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.Identity.Features.SingleSignOn;

public static class SsoInvitationKinds
{
    public const string Workforce = "workforce";
    public const string Administrator = "administrator";
    public const string Bootstrap = "bootstrap";

    public static bool IsKnown(string? kind) => kind is Workforce or Administrator or Bootstrap;
}

public sealed record SsoInvitationReference(string Kind, string Credential);

public sealed record StartSsoFlowRequest(
    string Purpose,
    string Provider,
    string? Email = null,
    SsoInvitationReference? Invitation = null,
    string? ReturnTo = null);

public sealed record SsoFlowStart(string? AuthorizeUrl, string? Binding, int Status = 200, string? Code = null, string? Message = null)
{
    public static SsoFlowStart Refused(int status, string code, string message) => new(null, null, status, code, message);
}

/// <summary>What the starting page collects once: a session, or a typed refusal with what it needs to explain it.</summary>
public sealed record SsoResult(AuthResponse? Session, SsoRefusalDto? Refusal);

public sealed record SsoRefusalDto(string Code, string? Provider, string? Company, string? Email);

/// <summary>
/// Runs the authorization code flow for every purpose (B-191 D1–D7, D12): sign-in, accepting an invitation, an
/// administrator's test of the company connection, and confirming a sensitive change. After the provider's answer is
/// validated, the usual session factory mints Fusion's own token pair, so the gateway, revisions, refresh and
/// view-as are unchanged.
/// </summary>
public sealed class SsoFlowService(
    AppIdentityDbContext dbContext,
    SsoOptions options,
    SsoProviderCatalog catalog,
    SsoOidcClient oidc,
    SsoPolicy policy,
    IDataProtectionProvider dataProtection,
    IAuthSessionFactory sessions,
    IWorkforceInvitationAcceptanceService workforceAcceptance,
    IAdministrativeInvitationAcceptanceService administrativeAcceptance,
    IAdministratorInvitationService administratorInvitations,
    IBootstrapActivationService bootstrapActivation,
    ILogger<SsoFlowService> logger)
{
    public const string CookieName = "fusion_sso";
    public const string CookiePath = "/api/identity/sso";
    public const string FlowPurpose = "Fusion.Identity.Sso.Flow.v1";

    // ── Start ────────────────────────────────────────────

    public async Task<SsoFlowStart> StartAsync(StartSsoFlowRequest request, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        if (!options.Enabled)
            return SsoFlowStart.Refused(404, SsoRefusals.ProviderOff, "Single sign-on isn't available here.");
        if (!Enum.TryParse<SsoFlowPurpose>(request.Purpose, ignoreCase: true, out var purpose) || !Enum.IsDefined(purpose))
            return SsoFlowStart.Refused(400, "invalid", "Say what the sign-in is for.");

        var authenticated = user.Identity?.IsAuthenticated == true;
        Guid? actorUserId = null;
        if (purpose is SsoFlowPurpose.Test or SsoFlowPurpose.Confirm)
        {
            if (!authenticated)
                return SsoFlowStart.Refused(401, "unauthenticated", "Sign in first.");
            actorUserId = user.GetUserId();
        }

        var email = SsoTrust.Normalize(request.Email);
        SsoProvider? provider;
        string? invitationKind = null;
        string? invitationCredential = null;

        switch (purpose)
        {
            case SsoFlowPurpose.SignIn:
                provider = await SignInProviderAsync(request.Provider, email, cancellationToken);
                break;

            case SsoFlowPurpose.Invitation:
                if (request.Invitation is null || !SsoInvitationKinds.IsKnown(request.Invitation.Kind)
                    || string.IsNullOrWhiteSpace(request.Invitation.Credential))
                    return SsoFlowStart.Refused(400, "invalid", "This invitation link isn't complete.");
                var invitation = await InspectInvitationAsync(request.Invitation, cancellationToken);
                if (invitation is null)
                    return await AddressTakenAsync(request.Invitation, cancellationToken)
                        ? SsoFlowStart.Refused(409, SsoRefusals.ExistingAccount, "This address already has a Fusion account.")
                        : SsoFlowStart.Refused(409, SsoRefusals.InvitationClosed, "This invitation can't be used any more.");
                var ways = await policy.WaysInForInvitationAsync(
                    invitation.Value.TenantId, invitation.Value.Email, request.Invitation.Kind != SsoInvitationKinds.Workforce, cancellationToken);
                if (ways.Providers.All(way => way.Key != request.Provider))
                    return SsoFlowStart.Refused(409, ways.Providers.Any(way => way.Key == SsoProviderKeys.Company)
                        ? SsoRefusals.CompanyRequires : SsoRefusals.ProviderOff, "That way in isn't available for this invitation.");
                provider = request.Provider == SsoProviderKeys.Company
                    ? await CompanyProviderAsync(invitation.Value.TenantId, cancellationToken)
                    : catalog.Fusion(request.Provider);
                invitationKind = request.Invitation.Kind;
                invitationCredential = request.Invitation.Credential;
                email = invitation.Value.Email;
                break;

            case SsoFlowPurpose.Test:
            {
                var tenantId = user.GetTenantId();
                if (tenantId is null || !await policy.IsUsableAdministratorAsync(tenantId.Value, actorUserId!.Value, cancellationToken))
                    return SsoFlowStart.Refused(403, "permission-denied", "Only administrators can test the company's provider.");
                provider = await CompanyProviderAsync(tenantId.Value, cancellationToken);
                email = null;
                break;
            }

            default: // Confirm
            {
                provider = await ConfirmProviderAsync(actorUserId!.Value, request.Provider, user.GetTenantId(), cancellationToken);
                if (provider is null)
                    return SsoFlowStart.Refused(409, "no-link", "You don't sign in with that provider.");
                email = null;
                break;
            }
        }

        if (provider is null)
            return SsoFlowStart.Refused(409, SsoRefusals.ProviderOff, "That way in isn't available.");

        Microsoft.IdentityModel.Protocols.OpenIdConnect.OpenIdConnectConfiguration configuration;
        try
        {
            configuration = await oidc.DiscoverAsync(provider, cancellationToken);
        }
        catch (SsoBackchannelException exception)
        {
            if (purpose == SsoFlowPurpose.Test)
                await RecordTestAsync(provider.ConnectionId!.Value, actorUserId!.Value, false, null, exception.Message, cancellationToken);
            logger.LogWarning("Single sign-on discovery failed for {Provider}: {Reason}", provider.Key, exception.Message);
            return SsoFlowStart.Refused(502, SsoRefusals.ProviderFailed, exception.Message);
        }

        var now = DateTime.UtcNow;
        await PurgeAsync(now, cancellationToken);

        var binding = Random(32);
        var bindingHash = Hash(binding);
        var state = Random(32);
        var nonce = Random(32);
        var verifier = Random(32);
        var protector = FlowProtector(bindingHash);
        var returnTo = SafeReturnTo(request.ReturnTo);

        dbContext.SsoFlows.Add(SsoFlow.Start(
            bindingHash, purpose, provider.Key, provider.ConnectionId, provider.ExpectedIssuer, state, nonce,
            protector.Protect(verifier), invitationKind,
            invitationCredential is null ? null : protector.Protect(invitationCredential),
            actorUserId, email, returnTo, now));
        await dbContext.SaveChangesAsync(cancellationToken);

        var authorizeUrl = SsoOidcClient.AuthorizeUrl(
            configuration, provider, catalog.RedirectUri(provider), state, nonce, Challenge(verifier), email,
            forceLogin: purpose == SsoFlowPurpose.Confirm);
        return new SsoFlowStart(authorizeUrl, binding);
    }

    // ── Callback ─────────────────────────────────────────

    /// <summary>Validates the provider's return, does the flow's work and answers where to send the browser.</summary>
    public async Task<string> CallbackAsync(
        string pathProvider, Guid? pathConnectionId, IReadOnlyDictionary<string, string?> query, string? binding,
        CancellationToken cancellationToken)
    {
        var landing = $"{options.PublicOrigin}/auth/sso/complete";
        if (string.IsNullOrEmpty(binding)) return landing;

        var flow = await dbContext.SsoFlows.FirstOrDefaultAsync(item => item.BindingHash == Hash(binding), cancellationToken);
        if (flow is null) return landing;
        landing = LandingFor(flow, succeeded: false);
        if (flow.CompletedAt is not null) return landing; // a second callback does nothing

        var now = DateTime.UtcNow;
        if (!FixedEquals(query.GetValueOrDefault("state"), flow.State))
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);
        if (flow.IsExpired(now))
            return await RefuseAsync(flow, SsoRefusals.Expired, null, null, cancellationToken);

        // Mix-up defence: each provider answers on its own path, and only for flows started with it.
        if (pathProvider != flow.Provider || pathConnectionId != flow.ConnectionId)
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);

        var provider = flow.Provider == SsoProviderKeys.Company
            ? await CompanyProviderByIdAsync(flow.ConnectionId, cancellationToken)
            : catalog.Fusion(flow.Provider);
        if (provider is null || provider.ExpectedIssuer != flow.ExpectedIssuer)
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);

        if (query.GetValueOrDefault("error") is { Length: > 0 } providerError)
        {
            var description = query.GetValueOrDefault("error_description");
            return await FailAsync(flow, provider, $"{provider.Label} answered: {Trim(description ?? providerError)}", cancellationToken);
        }

        // RFC 9207: when the provider names itself, it must be the one this flow went to.
        if (query.GetValueOrDefault("iss") is { Length: > 0 } issuerParameter && !IssuerParameterMatches(provider, issuerParameter))
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);

        var code = query.GetValueOrDefault("code");
        if (string.IsNullOrEmpty(code))
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);

        SsoIdentity identity;
        try
        {
            var configuration = await oidc.DiscoverAsync(provider, cancellationToken);
            var verifier = FlowProtector(flow.BindingHash).Unprotect(flow.ProtectedCodeVerifier);
            var answer = await oidc.ExchangeAsync(configuration, provider, code, verifier, catalog.RedirectUri(provider), cancellationToken);
            if (answer.IdToken is null)
            {
                var message = answer.Error is "invalid_client" or "unauthorized_client"
                    ? provider.Profile == SsoTrustProfile.CompanyEntra
                        ? $"{provider.Label} refused the client secret. Check it in Entra ID › Certificates & secrets, then test again."
                        : $"{provider.Label} refused the client secret. Check it with your provider, then test again."
                    : $"{provider.Label} answered: {Trim(answer.ErrorDescription ?? answer.Error ?? $"status {answer.Status}")}";
                return await FailAsync(flow, provider, message, cancellationToken);
            }

            var token = await oidc.ValidateAsync(provider, answer.IdToken, flow.Nonce, cancellationToken);
            identity = SsoTrust.Evaluate(provider, token);
        }
        catch (Exception exception) when (exception is SsoBackchannelException or SsoValidationException or CryptographicException)
        {
            logger.LogWarning("Single sign-on callback failed for {Provider}: {Reason}", provider.Key, exception.Message);
            return await FailAsync(flow, provider, exception.Message, cancellationToken);
        }

        return flow.Purpose switch
        {
            SsoFlowPurpose.SignIn => await SignInAsync(flow, provider, identity, cancellationToken),
            SsoFlowPurpose.Invitation => await AcceptInvitationAsync(flow, provider, identity, cancellationToken),
            SsoFlowPurpose.Test => await CompleteTestAsync(flow, provider, identity, cancellationToken),
            _ => await ConfirmAsync(flow, identity, cancellationToken),
        };
    }

    // ── Result ───────────────────────────────────────────

    /// <summary>Hands the outcome of a sign-in or invitation flow to the browser that started it, once.</summary>
    public async Task<SsoResult?> CollectAsync(string? binding, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(binding)) return null;
        var flow = await dbContext.SsoFlows.FirstOrDefaultAsync(item => item.BindingHash == Hash(binding), cancellationToken);
        if (flow is null || flow.CompletedAt is null || flow.ConsumedAt is not null
            || flow.Purpose is not (SsoFlowPurpose.SignIn or SsoFlowPurpose.Invitation))
            return null;

        flow.Consume(DateTime.UtcNow);
        await dbContext.SaveChangesAsync(cancellationToken);

        if (flow.ResultUserId is { } userId)
        {
            var account = await dbContext.Users.IgnoreQueryFilters().FirstOrDefaultAsync(item => item.Id == userId, cancellationToken);
            if (account is null || !account.IsActive) return null;
            return new SsoResult(await sessions.CreateAsync(account, flow.ResultMethod ?? SessionMethods.ForProvider(flow.Provider), cancellationToken), null);
        }

        var detail = flow.ResultJson is null ? null : JsonSerializer.Deserialize<SsoRefusalDto>(flow.ResultJson, JsonOptions);
        return new SsoResult(null, new SsoRefusalDto(flow.ResultCode ?? SsoRefusals.ProviderFailed, flow.Provider, detail?.Company, detail?.Email));
    }

    // ── Purposes ─────────────────────────────────────────

    private async Task<string> SignInAsync(SsoFlow flow, SsoProvider provider, SsoIdentity identity, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var link = await FindLinkAsync(identity, cancellationToken);
        ApplicationUser? account;
        if (link is not null)
        {
            account = await dbContext.Users.IgnoreQueryFilters().FirstOrDefaultAsync(item => item.Id == link.UserId, cancellationToken);
        }
        else
        {
            if (identity.TrustedEmail is null)
                return await RefuseAsync(flow, identity.TrustRefusal ?? SsoRefusals.EmailNotVerified, identity.SeenEmail, null, cancellationToken);
            var normalized = identity.TrustedEmail.ToUpperInvariant();
            account = await dbContext.Users.IgnoreQueryFilters().FirstOrDefaultAsync(item => item.NormalizedEmail == normalized, cancellationToken);
            if (account is null)
            {
                logger.LogInformation("Single sign-on found no account for an address at {Domain}", SsoTrust.DomainOf(identity.TrustedEmail));
                return await RefuseAsync(flow, SsoRefusals.NoAccount, identity.TrustedEmail, null, cancellationToken);
            }

            var linkedElsewhere = await dbContext.ExternalLogins.AnyAsync(item => item.UserId == account.Id
                && item.Provider == identity.Provider && item.ConnectionId == identity.ConnectionId, cancellationToken);
            if (linkedElsewhere)
                return await RefuseAsync(flow, SsoRefusals.LinkedToSomeoneElse, identity.TrustedEmail, null, cancellationToken, account.Id);
        }

        if (account is null || !account.IsActive)
            return await RefuseAsync(flow, SsoRefusals.AccessPaused, identity.SeenEmail, null, cancellationToken);
        if (await policy.IsOperatorAsync(account.Id, cancellationToken))
            return await RefuseAsync(flow, SsoRefusals.Operator, account.Email, null, cancellationToken);

        var membership = await policy.ActiveMembershipAsync(account.Id, cancellationToken);
        if (membership is null)
            return await RefuseAsync(flow, SsoRefusals.AccessPaused, account.Email, null, cancellationToken);

        var tenant = membership.Tenant!;
        var accountDomain = SsoPolicy.DomainOfEmail(account.Email);
        var claim = await policy.ProvedClaimAsync(accountDomain, cancellationToken);
        if (provider.Key == SsoProviderKeys.Company)
        {
            // A company's provider vouches only for its own members, in the domains it proved.
            if (provider.TenantId != tenant.Id || claim is null || claim.TenantId != tenant.Id)
                return await RefuseAsync(flow, SsoRefusals.NoAccount, identity.TrustedEmail ?? account.Email, null, cancellationToken);
        }
        else
        {
            var allowed = provider.Key == SsoProviderKeys.Microsoft ? tenant.AllowMicrosoftSignIn : tenant.AllowGoogleSignIn;
            if (claim is not null && claim.TenantId == tenant.Id && claim.Connection.IsRequired)
                return await RefuseAsync(flow, SsoRefusals.CompanyRequires, account.Email, claim.Connection.DisplayName, cancellationToken, account.Id, tenant.Id);
            if (!allowed)
                return await RefuseAsync(flow, SsoRefusals.ProviderOff, account.Email, tenant.Name, cancellationToken, account.Id, tenant.Id);
        }

        if (link is null)
        {
            link = ExternalLogin.Create(account.Id, identity.Provider, identity.ConnectionId, identity.Issuer, identity.Subject, identity.TrustedEmail!, now);
            dbContext.ExternalLogins.Add(link);
            Audit(tenant.Id, account.Id, SsoAuditActions.LinkCreated, link.Id.ToString(),
                $"{account.FullName} linked their {provider.Label} sign-in.", new { provider = provider.Key });
        }

        link.Use(now);
        account.LastLoginAt = now;
        flow.Succeed(account.Id, SessionMethods.ForProvider(provider.Key), now);
        Audit(tenant.Id, account.Id, SsoAuditActions.SignIn, membership.Id.ToString(),
            $"{account.FullName} signed in with {provider.Label}.", new { provider = provider.Key });
        await dbContext.SaveChangesAsync(cancellationToken);
        return LandingFor(flow, true);
    }

    private async Task<string> AcceptInvitationAsync(SsoFlow flow, SsoProvider provider, SsoIdentity identity, CancellationToken cancellationToken)
    {
        var reference = new SsoInvitationReference(
            flow.InvitationKind!, FlowProtector(flow.BindingHash).Unprotect(flow.ProtectedInvitationCredential!));
        var invitation = await InspectInvitationAsync(reference, cancellationToken);
        if (invitation is null)
            return await RefuseAsync(flow, SsoRefusals.InvitationClosed, identity.SeenEmail, null, cancellationToken);

        if (identity.TrustedEmail is null)
            return await RefuseAsync(flow, identity.TrustRefusal ?? SsoRefusals.EmailNotVerified, identity.SeenEmail, null, cancellationToken);

        // Holding the link is the proof of invitation; the provider must sign in exactly the invited address.
        if (!string.Equals(identity.TrustedEmail, invitation.Value.Email, StringComparison.OrdinalIgnoreCase))
            return await RefuseAsync(flow, SsoRefusals.InvitationMismatch, identity.TrustedEmail, null, cancellationToken);

        var ways = await policy.WaysInForInvitationAsync(
            invitation.Value.TenantId, invitation.Value.Email, reference.Kind != SsoInvitationKinds.Workforce, cancellationToken);
        if (ways.Providers.All(way => way.Key != provider.Key)
            || (provider.Key == SsoProviderKeys.Company && provider.TenantId != invitation.Value.TenantId))
            return await RefuseAsync(flow, ways.Providers.Any(way => way.Key == SsoProviderKeys.Company)
                ? SsoRefusals.CompanyRequires : SsoRefusals.ProviderOff, identity.TrustedEmail, null, cancellationToken);

        if (await FindLinkAsync(identity, cancellationToken) is not null)
            return await RefuseAsync(flow, SsoRefusals.ExistingAccount, identity.TrustedEmail, null, cancellationToken);

        var external = new ExternalLoginGrant(identity.Provider, identity.ConnectionId, identity.Issuer, identity.Subject, identity.TrustedEmail);
        var (first, last) = Names(identity);
        Guid? accountId;
        string? refusal;
        switch (reference.Kind)
        {
            case SsoInvitationKinds.Workforce:
            {
                var result = await workforceAcceptance.AcceptAsync(
                    new WorkforceAcceptanceRequest(reference.Credential, null, null, null, string.Empty, external), cancellationToken);
                accountId = result.AccountId;
                refusal = result.Outcome switch
                {
                    WorkforceAcceptanceOutcome.Accepted => null,
                    WorkforceAcceptanceOutcome.ExistingAccountConflict => SsoRefusals.ExistingAccount,
                    _ => SsoRefusals.InvitationClosed,
                };
                break;
            }
            case SsoInvitationKinds.Administrator:
            {
                var result = await administrativeAcceptance.AcceptAsync(new AdministrativeAcceptanceRequest
                {
                    Credential = reference.Credential,
                    Email = invitation.Value.Email,
                    FirstName = invitation.Value.FirstName ?? first,
                    LastName = invitation.Value.LastName ?? last,
                    External = external,
                }, cancellationToken);
                accountId = result.AccountId;
                refusal = result.Outcome switch
                {
                    AdministrativeAcceptanceOutcome.Accepted => null,
                    AdministrativeAcceptanceOutcome.ExistingAccountConflict => SsoRefusals.ExistingAccount,
                    _ => SsoRefusals.InvitationClosed,
                };
                break;
            }
            default:
            {
                var result = await bootstrapActivation.ActivateAsync(new BootstrapActivationRequest
                {
                    Credential = reference.Credential,
                    Email = invitation.Value.Email,
                    FirstName = invitation.Value.FirstName ?? first,
                    LastName = invitation.Value.LastName ?? last,
                    External = external,
                }, cancellationToken);
                accountId = result.AccountId;
                refusal = result.Outcome switch
                {
                    BootstrapActivationOutcome.Activated => null,
                    BootstrapActivationOutcome.ExistingAccountConflict => SsoRefusals.ExistingAccount,
                    _ => SsoRefusals.InvitationClosed,
                };
                break;
            }
        }

        dbContext.ChangeTracker.Clear();
        var fresh = await dbContext.SsoFlows.FirstAsync(item => item.Id == flow.Id, cancellationToken);
        if (refusal is not null || accountId is null)
            return await RefuseAsync(fresh, refusal ?? SsoRefusals.InvitationClosed, identity.TrustedEmail, null, cancellationToken);

        fresh.Succeed(accountId.Value, SessionMethods.ForProvider(provider.Key), DateTime.UtcNow);
        Audit(invitation.Value.TenantId, accountId, SsoAuditActions.InvitationAccepted, accountId.ToString(),
            $"Invitation accepted with {provider.Label}.", new { provider = provider.Key, kind = reference.Kind });
        await dbContext.SaveChangesAsync(cancellationToken);
        return LandingFor(fresh, true);
    }

    private async Task<string> CompleteTestAsync(SsoFlow flow, SsoProvider provider, SsoIdentity identity, CancellationToken cancellationToken)
    {
        var actorId = flow.ActorUserId!.Value;
        var connection = await dbContext.SsoConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == flow.ConnectionId, cancellationToken);
        if (connection is null || !await policy.IsUsableAdministratorAsync(connection.TenantId, actorId, cancellationToken))
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);

        var now = DateTime.UtcNow;
        if (identity.TrustedEmail is null)
        {
            await RecordTestAsync(connection.Id, actorId, false, identity.SeenEmail,
                $"{provider.Label} didn't return a verified address.", cancellationToken);
            return await RefuseAsync(flow, identity.TrustRefusal ?? SsoRefusals.EmailNotVerified, identity.SeenEmail, null, cancellationToken);
        }

        connection.RecordTest(true, identity.TrustedEmail, null, actorId, now);
        Audit(connection.TenantId, actorId, SsoAuditActions.ConnectionTested, connection.Id.ToString(),
            $"Test sign-in through {connection.DisplayName} succeeded as {identity.TrustedEmail}.", new { outcome = "succeeded" });

        // The address it returned proves its domain, when the company listed it and nobody else proved it.
        var domain = SsoPolicy.DomainOfEmail(identity.TrustedEmail);
        var listed = await dbContext.SsoDomains.IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.TenantId == connection.TenantId && item.Domain == domain, cancellationToken);
        var provedNow = false;
        if (listed is not null && !listed.IsProved
            && !await dbContext.SsoDomains.IgnoreQueryFilters().AnyAsync(item => item.Domain == domain && item.ProvedAt != null, cancellationToken))
        {
            listed.Prove(actorId, now);
            provedNow = true;
            Audit(connection.TenantId, actorId, SsoAuditActions.DomainProved, listed.Domain,
                $"{listed.Domain} proved by a test sign-in.", new { domain = listed.Domain });
        }

        // The administrator who tested as themselves is linked, which is what lets them require it.
        var actor = await dbContext.Users.IgnoreQueryFilters().FirstAsync(item => item.Id == actorId, cancellationToken);
        var link = await FindLinkAsync(identity, cancellationToken);
        if (link is null && string.Equals(actor.Email, identity.TrustedEmail, StringComparison.OrdinalIgnoreCase)
            && !await dbContext.ExternalLogins.AnyAsync(item => item.UserId == actorId && item.Provider == SsoProviderKeys.Company
                && item.ConnectionId == connection.Id, cancellationToken))
        {
            link = ExternalLogin.Create(actorId, identity.Provider, identity.ConnectionId, identity.Issuer, identity.Subject, identity.TrustedEmail, now);
            dbContext.ExternalLogins.Add(link);
            Audit(connection.TenantId, actorId, SsoAuditActions.LinkCreated, link.Id.ToString(),
                $"{actor.FullName} linked their {connection.DisplayName} sign-in.", new { provider = SsoProviderKeys.Company });
        }

        if (link is not null && link.UserId == actorId)
            link.Use(now);

        flow.Succeed(actorId, null, now);
        await dbContext.SaveChangesAsync(cancellationToken);

        if (provedNow && connection.IsRequired)
        {
            var ended = await policy.EndPasswordSessionsAsync(connection.TenantId, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Proving a domain while required ended {Count} password sessions", ended);
        }

        return LandingFor(flow, true);
    }

    private async Task<string> ConfirmAsync(SsoFlow flow, SsoIdentity identity, CancellationToken cancellationToken)
    {
        var link = await FindLinkAsync(identity, cancellationToken);
        var fresh = identity.AuthTime is { } authTime && authTime.UtcDateTime >= flow.CreatedAt - SsoOidcClient.ClockSkew;
        if (link is null || link.UserId != flow.ActorUserId || !fresh)
            return await RefuseAsync(flow, SsoRefusals.ProviderFailed, identity.SeenEmail, null, cancellationToken);

        var now = DateTime.UtcNow;
        link.Use(now);
        flow.Succeed(link.UserId, null, now);
        await dbContext.SaveChangesAsync(cancellationToken);
        return LandingFor(flow, true);
    }

    // ── plumbing ─────────────────────────────────────────

    private async Task<SsoProvider?> SignInProviderAsync(string key, string? email, CancellationToken cancellationToken)
    {
        if (key != SsoProviderKeys.Company) return catalog.Fusion(key);
        var claim = await policy.ProvedClaimAsync(SsoPolicy.DomainOfEmail(email), cancellationToken);
        return claim is null || claim.Connection.Status != SsoConnectionStatus.Tested ? null : catalog.Company(claim.Connection);
    }

    private async Task<SsoProvider?> CompanyProviderAsync(Guid tenantId, CancellationToken cancellationToken)
    {
        var connection = await dbContext.SsoConnections.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.TenantId == tenantId, cancellationToken);
        return connection is null ? null : catalog.Company(connection);
    }

    private async Task<SsoProvider?> CompanyProviderByIdAsync(Guid? connectionId, CancellationToken cancellationToken)
    {
        var connection = await dbContext.SsoConnections.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == connectionId, cancellationToken);
        return connection is null ? null : catalog.Company(connection);
    }

    private async Task<SsoProvider?> ConfirmProviderAsync(Guid userId, string key, Guid? tenantId, CancellationToken cancellationToken)
    {
        if (key == SsoProviderKeys.Company)
        {
            if (tenantId is null) return null;
            var provider = await CompanyProviderAsync(tenantId.Value, cancellationToken);
            return provider is not null && await dbContext.ExternalLogins.AnyAsync(item => item.UserId == userId
                && item.Provider == SsoProviderKeys.Company && item.ConnectionId == provider.ConnectionId, cancellationToken)
                ? provider
                : null;
        }

        return await dbContext.ExternalLogins.AnyAsync(item => item.UserId == userId && item.Provider == key, cancellationToken)
            ? catalog.Fusion(key)
            : null;
    }

    private Task<ExternalLogin?> FindLinkAsync(SsoIdentity identity, CancellationToken cancellationToken)
        => dbContext.ExternalLogins.FirstOrDefaultAsync(item => item.Provider == identity.Provider
            && item.ConnectionId == identity.ConnectionId && item.Issuer == identity.Issuer && item.Subject == identity.Subject,
            cancellationToken);

    private readonly record struct InvitedAddress(Guid TenantId, string Email, string? FirstName, string? LastName);

    /// <summary>The invitation behind a credential, when it can still be accepted.</summary>
    private async Task<InvitedAddress?> InspectInvitationAsync(SsoInvitationReference reference, CancellationToken cancellationToken)
    {
        switch (reference.Kind)
        {
            case SsoInvitationKinds.Workforce:
            {
                var invite = await WorkforceInvitations.ResolveAsync(dbContext, reference.Credential, cancellationToken);
                return invite is null || invite.IsRevoked || invite.IsUsed || invite.IsExpired
                    ? null
                    : new InvitedAddress(invite.TenantId, invite.Email, invite.FirstName, invite.LastName);
            }
            case SsoInvitationKinds.Administrator:
            {
                var entry = await administratorInvitations.InspectAsync(reference.Credential, cancellationToken);
                if (entry.State != AdministrativeInvitationEntryState.AccountCreation || entry.InvitedEmail is null) return null;
                var tenantId = await TenantOfCredentialAsync(reference.Credential, cancellationToken);
                return tenantId is null ? null : new InvitedAddress(tenantId.Value, entry.InvitedEmail, entry.FirstName, entry.LastName);
            }
            default:
            {
                var entry = await bootstrapActivation.InspectAsync(reference.Credential, cancellationToken);
                if (entry.State != BootstrapEntryState.AccountCreation || entry.InvitedEmail is null) return null;
                var tenantId = await TenantOfCredentialAsync(reference.Credential, cancellationToken);
                return tenantId is null ? null : new InvitedAddress(tenantId.Value, entry.InvitedEmail, entry.FirstName, entry.LastName);
            }
        }
    }

    /// <summary>Whether the invitation stopped because its address already belongs to an account.</summary>
    private async Task<bool> AddressTakenAsync(SsoInvitationReference reference, CancellationToken cancellationToken)
    {
        string? email = null;
        if (reference.Kind == SsoInvitationKinds.Workforce)
        {
            var invite = await WorkforceInvitations.ResolveAsync(dbContext, reference.Credential, cancellationToken);
            if (invite is not null && !invite.IsUsed && !invite.IsRevoked && !invite.IsExpired) email = invite.Email;
        }
        else if (BootstrapCredential.TryParse(reference.Credential, out var selector, out var secret))
        {
            var invite = await dbContext.InviteTokens.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(item => item.CredentialSelector == selector, cancellationToken);
            if (invite is not null && invite.State == Domain.Enums.InvitationState.Pending
                && invite.MatchesCredentialDigest(BootstrapCredential.Digest(secret)))
                email = invite.Email;
        }

        if (email is null) return false;
        var normalized = email.ToUpperInvariant();
        return await dbContext.Users.IgnoreQueryFilters().AnyAsync(item => item.NormalizedEmail == normalized, cancellationToken);
    }

    private async Task<Guid?> TenantOfCredentialAsync(string credential, CancellationToken cancellationToken)
    {
        if (!BootstrapCredential.TryParse(credential, out var selector, out _)) return null;
        return await dbContext.InviteTokens.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.CredentialSelector == selector)
            .Select(item => (Guid?)item.TenantId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<string> FailAsync(SsoFlow flow, SsoProvider provider, string message, CancellationToken cancellationToken)
    {
        if (flow.Purpose == SsoFlowPurpose.Test && provider.ConnectionId is { } connectionId)
            await RecordTestAsync(connectionId, flow.ActorUserId!.Value, false, null, message, cancellationToken);
        return await RefuseAsync(flow, SsoRefusals.ProviderFailed, null, null, cancellationToken);
    }

    private async Task RecordTestAsync(Guid connectionId, Guid actorId, bool succeeded, string? email, string message, CancellationToken cancellationToken)
    {
        var connection = await dbContext.SsoConnections.IgnoreQueryFilters().FirstOrDefaultAsync(item => item.Id == connectionId, cancellationToken);
        if (connection is null) return;
        connection.RecordTest(succeeded, email, Trim(message), actorId, DateTime.UtcNow);
        Audit(connection.TenantId, actorId, SsoAuditActions.ConnectionTested, connection.Id.ToString(),
            $"Test sign-in through {connection.DisplayName} failed.", new { outcome = "failed" });
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<string> RefuseAsync(
        SsoFlow flow, string code, string? email, string? company, CancellationToken cancellationToken,
        Guid? accountId = null, Guid? tenantId = null)
    {
        flow.Refuse(code, JsonSerializer.Serialize(new SsoRefusalDto(code, flow.Provider, company, email), JsonOptions), DateTime.UtcNow);
        if (flow.Purpose == SsoFlowPurpose.SignIn && accountId is not null)
        {
            var refusedTenant = tenantId ?? (await policy.ActiveMembershipAsync(accountId.Value, cancellationToken))?.TenantId;
            if (refusedTenant is not null)
                Audit(refusedTenant.Value, accountId, SsoAuditActions.SignInRefused, accountId.ToString(),
                    $"Sign-in with {flow.Provider} refused ({code}).", new { provider = flow.Provider, code });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return LandingFor(flow, false);
    }

    private void Audit(Guid tenantId, Guid? actorId, string action, string? resourceId, string summary, object? after)
        => dbContext.AccessAuditEvents.Add(AccessAuditEvent.Create(
            tenantId, actorId, string.Empty, string.Empty, action, SsoAuditActions.ResourceType, resourceId, summary,
            null, after is null ? null : JsonSerializer.Serialize(after, JsonOptions), null));

    private string LandingFor(SsoFlow flow, bool succeeded) => flow.Purpose switch
    {
        SsoFlowPurpose.Test => $"{options.PublicOrigin}/core/settings/sign-in?sso=tested",
        SsoFlowPurpose.Confirm => $"{options.PublicOrigin}{QueryHelpers.AddQueryString(flow.ReturnTo, "confirmed", succeeded ? "sso" : "failed")}",
        _ => $"{options.PublicOrigin}/auth/sso/complete",
    };

    private bool IssuerParameterMatches(SsoProvider provider, string issuer)
    {
        if (!provider.ExpectedIssuer.Contains("{tenantid}", StringComparison.Ordinal))
            return provider.IssuerMatches(issuer, null);
        var prefix = provider.ExpectedIssuer[..provider.ExpectedIssuer.IndexOf("{tenantid}", StringComparison.Ordinal)];
        return issuer.StartsWith(prefix, StringComparison.Ordinal)
               && provider.IssuerMatches(issuer, issuer[prefix.Length..].Split('/')[0]);
    }

    private async Task PurgeAsync(DateTime now, CancellationToken cancellationToken)
    {
        var cutoff = now.AddDays(-1);
        if (dbContext.Database.IsRelational())
        {
            await dbContext.SsoFlows.Where(item => item.ExpiresAt < cutoff).ExecuteDeleteAsync(cancellationToken);
            return;
        }

        dbContext.SsoFlows.RemoveRange(await dbContext.SsoFlows.Where(item => item.ExpiresAt < cutoff).ToListAsync(cancellationToken));
    }

    private IDataProtector FlowProtector(string bindingHash)
        => dataProtection.CreateProtector(FlowPurpose).CreateProtector(bindingHash);

    private static (string First, string Last) Names(SsoIdentity identity)
    {
        if (!string.IsNullOrWhiteSpace(identity.GivenName) && !string.IsNullOrWhiteSpace(identity.FamilyName))
            return (identity.GivenName.Trim(), identity.FamilyName.Trim());
        var parts = (identity.Name ?? string.Empty).Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2) return (parts[0], parts[1]);
        var local = identity.TrustedEmail?.Split('@')[0] ?? "Fusion";
        return (parts.Length == 1 ? parts[0] : local, parts.Length == 1 ? parts[0] : local);
    }

    public static string SafeReturnTo(string? returnTo)
    {
        if (string.IsNullOrWhiteSpace(returnTo) || returnTo.Length > 500) return "/";
        var value = returnTo.Trim();
        return value.StartsWith('/') && !value.StartsWith("//", StringComparison.Ordinal)
               && !value.StartsWith("/\\", StringComparison.Ordinal) && !value.Contains('\r') && !value.Contains('\n')
            ? value
            : "/";
    }

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static string Random(int bytes) => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(bytes));

    private static string Challenge(string verifier) => WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    private static bool FixedEquals(string? presented, string expected)
        => presented is not null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(presented), Encoding.UTF8.GetBytes(expected));

    private static string Trim(string value) => value.Length <= 300 ? value : value[..300];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
}

/// <summary>A provider identity an invitation is accepted with, linked in the same transaction as the account.</summary>
public sealed record ExternalLoginGrant(string Provider, Guid? ConnectionId, string Issuer, string Subject, string Email);
