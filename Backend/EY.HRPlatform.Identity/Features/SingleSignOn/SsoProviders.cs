using System.Text.RegularExpressions;
using EY.HRPlatform.Identity.Domain.Entities;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace EY.HRPlatform.Identity.Features.SingleSignOn;

public static class SsoProviderKeys
{
    public const string Microsoft = "microsoft";
    public const string Google = "google";
    public const string Company = "company";

    public static bool IsFusionWide(string key) => key is Microsoft or Google;
}

/// <summary>Which rules decide whether the email a provider returns can be trusted (B-191 D6).</summary>
public enum SsoTrustProfile
{
    FusionMicrosoft,
    Google,
    CompanyEntra,
    CompanyOidc,
}

/// <summary>
/// One provider as Fusion talks to it. <see cref="ExpectedIssuer"/> may carry <c>{tenantid}</c> for Microsoft's
/// multi-tenant endpoint, where the issuer names the person's own directory.
/// </summary>
public sealed record SsoProvider(
    string Key,
    Guid? ConnectionId,
    Guid? TenantId,
    string Label,
    string Authority,
    string ExpectedIssuer,
    string ClientId,
    string ClientSecret,
    SsoTrustProfile Profile,
    string? EntraTenantId)
{
    public string CallbackPath => Key == SsoProviderKeys.Company
        ? $"/api/identity/sso/callback/c/{ConnectionId}"
        : $"/api/identity/sso/callback/{Key}";

    public string MetadataAddress => $"{Authority.TrimEnd('/')}/.well-known/openid-configuration";

    /// <summary>Whether <paramref name="issuer"/> is the one this provider promised, given the token's directory.</summary>
    public bool IssuerMatches(string issuer, string? tenantIdClaim)
    {
        if (ExpectedIssuer.Contains("{tenantid}", StringComparison.Ordinal))
        {
            return !string.IsNullOrEmpty(tenantIdClaim)
                   && Guid.TryParse(tenantIdClaim, out _)
                   && string.Equals(issuer, ExpectedIssuer.Replace("{tenantid}", tenantIdClaim, StringComparison.Ordinal), StringComparison.Ordinal);
        }

        if (string.Equals(issuer, ExpectedIssuer, StringComparison.Ordinal))
            return true;

        // Google's tokens may name it with or without the scheme.
        return Profile == SsoTrustProfile.Google && issuer == "accounts.google.com"
               && ExpectedIssuer == "https://accounts.google.com";
    }
}

/// <summary>Builds providers from configuration and a company's connection; the only place a secret is decrypted.</summary>
public sealed class SsoProviderCatalog(SsoOptions options, IDataProtectionProvider dataProtection)
{
    public const string ClientSecretPurpose = "Fusion.Identity.Sso.ClientSecret.v1";

    public SsoProvider? Fusion(string key)
    {
        if (!options.Enabled) return null;
        return key switch
        {
            SsoProviderKeys.Microsoft when options.Microsoft.IsConfigured => new SsoProvider(
                SsoProviderKeys.Microsoft, null, null, "Microsoft", options.Microsoft.Authority,
                MicrosoftIssuerTemplate(options.Microsoft.Authority), options.Microsoft.ClientId,
                options.Microsoft.ClientSecret, SsoTrustProfile.FusionMicrosoft, null),
            SsoProviderKeys.Google when options.Google.IsConfigured => new SsoProvider(
                SsoProviderKeys.Google, null, null, "Google", options.Google.Authority,
                options.Google.Authority.TrimEnd('/'), options.Google.ClientId, options.Google.ClientSecret,
                SsoTrustProfile.Google, null),
            _ => null,
        };
    }

    public bool IsAvailable(string key) => Fusion(key) is not null;

    public SsoProvider? Company(SsoConnection connection)
    {
        if (!options.Enabled) return null;
        return new SsoProvider(
            SsoProviderKeys.Company, connection.Id, connection.TenantId, connection.DisplayName,
            connection.Issuer, connection.Issuer, connection.ClientId, UnprotectSecret(connection),
            connection.Kind == SsoConnectionKind.MicrosoftEntra ? SsoTrustProfile.CompanyEntra : SsoTrustProfile.CompanyOidc,
            connection.EntraTenantId);
    }

    /// <summary>The issuer a company's Entra directory signs with.</summary>
    public string EntraIssuer(string directory) => $"{options.EntraBase}/{directory.ToLowerInvariant()}/v2.0";

    public string RedirectUri(SsoProvider provider) => $"{options.PublicOrigin}{provider.CallbackPath}";

    public string RedirectUriForConnection(Guid connectionId) => $"{options.PublicOrigin}/api/identity/sso/callback/c/{connectionId}";

    public string ProtectSecret(Guid tenantId, string secret) => SecretProtector(tenantId).Protect(secret);

    private string UnprotectSecret(SsoConnection connection)
    {
        try
        {
            return SecretProtector(connection.TenantId).Unprotect(connection.ProtectedClientSecret);
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            // Ciphertext from another company (or a lost key ring) never decrypts; the provider then refuses the
            // exchange and the administrator replaces the secret.
            return string.Empty;
        }
    }

    private IDataProtector SecretProtector(Guid tenantId)
        => dataProtection.CreateProtector(ClientSecretPurpose).CreateProtector(tenantId.ToString("N"));

    private static string MicrosoftIssuerTemplate(string authority)
        => Regex.Replace(authority.TrimEnd('/'), "/[^/]+/v2\\.0$", "/{tenantid}/v2.0");
}

public sealed class SsoValidationException(string message) : Exception(message);

public sealed record SsoTokenAnswer(string? IdToken, string? Error, string? ErrorDescription, int Status);

/// <summary>
/// The code flow's three provider calls: discovery (with its keys), the token exchange and ID token validation.
/// Discovery is cached for an hour per address and refetched once when a token names a key Fusion hasn't seen.
/// </summary>
public sealed class SsoOidcClient(SsoBackchannel backchannel, IMemoryCache cache)
{
    public static readonly string[] AllowedAlgorithms = [SecurityAlgorithms.RsaSha256, SecurityAlgorithms.EcdsaSha256];
    public static readonly TimeSpan ClockSkew = TimeSpan.FromMinutes(2);

    public async Task<OpenIdConnectConfiguration> DiscoverAsync(
        SsoProvider provider, CancellationToken cancellationToken, bool refresh = false)
    {
        var key = $"sso:discovery:{provider.MetadataAddress}";
        if (!refresh && cache.TryGetValue(key, out OpenIdConnectConfiguration? cached) && cached is not null)
            return cached;

        OpenIdConnectConfiguration configuration;
        try
        {
            configuration = OpenIdConnectConfiguration.Create(await backchannel.GetAsync(provider.MetadataAddress, cancellationToken));
        }
        catch (ArgumentException)
        {
            throw new SsoBackchannelException($"{Host(provider.Authority)} didn't answer with sign-in settings.");
        }

        // RFC 8414: the document must name the issuer Fusion was told to expect.
        if (!string.Equals(configuration.Issuer, provider.ExpectedIssuer, StringComparison.Ordinal))
            throw new SsoBackchannelException($"{Host(provider.Authority)} says its issuer is {configuration.Issuer}, not {provider.ExpectedIssuer}.");
        if (string.IsNullOrEmpty(configuration.AuthorizationEndpoint) || string.IsNullOrEmpty(configuration.TokenEndpoint)
            || string.IsNullOrEmpty(configuration.JwksUri))
            throw new SsoBackchannelException($"{Host(provider.Authority)}'s sign-in settings are incomplete.");

        // The browser is sent to the authorization endpoint, so the document (which whoever runs the issuer writes)
        // must not name a script or another scheme there: https, or the local test provider's own address.
        if (!backchannel.IsAllowedAddress(configuration.AuthorizationEndpoint))
            throw new SsoBackchannelException($"{Host(provider.Authority)}'s sign-in address must start with https://.");

        var keys = new JsonWebKeySet(await backchannel.GetAsync(configuration.JwksUri, cancellationToken));
        configuration.JsonWebKeySet = keys;
        foreach (var signingKey in keys.GetSigningKeys())
            configuration.SigningKeys.Add(signingKey);

        cache.Set(key, configuration, TimeSpan.FromHours(1));
        return configuration;
    }

    public static string AuthorizeUrl(
        OpenIdConnectConfiguration configuration, SsoProvider provider, string redirectUri, string state, string nonce,
        string codeChallenge, string? loginHint, bool forceLogin)
    {
        var query = new Dictionary<string, string?>
        {
            ["client_id"] = provider.ClientId,
            ["response_type"] = "code",
            ["response_mode"] = "query",
            ["redirect_uri"] = redirectUri,
            ["scope"] = "openid email profile",
            ["state"] = state,
            ["nonce"] = nonce,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
            ["login_hint"] = string.IsNullOrWhiteSpace(loginHint) ? null : loginHint,
            ["prompt"] = forceLogin ? "login" : null,
            ["max_age"] = forceLogin ? "0" : null,
        };
        return Microsoft.AspNetCore.WebUtilities.QueryHelpers.AddQueryString(configuration.AuthorizationEndpoint, query);
    }

    public async Task<SsoTokenAnswer> ExchangeAsync(
        OpenIdConnectConfiguration configuration, SsoProvider provider, string code, string codeVerifier,
        string redirectUri, CancellationToken cancellationToken)
    {
        var answer = await backchannel.PostFormAsync(configuration.TokenEndpoint, new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["client_id"] = provider.ClientId,
            ["client_secret"] = provider.ClientSecret,
            ["code_verifier"] = codeVerifier,
        }, cancellationToken);

        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(answer.Body);
            var root = document.RootElement;
            string? Read(string name) => root.TryGetProperty(name, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String
                ? value.GetString()
                : null;
            return new SsoTokenAnswer(
                answer.Status is >= 200 and < 300 ? Read("id_token") : null,
                Read("error"), Read("error_description"), answer.Status);
        }
        catch (System.Text.Json.JsonException)
        {
            return new SsoTokenAnswer(null, "invalid_response", null, answer.Status);
        }
    }

    public async Task<JsonWebToken> ValidateAsync(
        SsoProvider provider, string idToken, string nonce, CancellationToken cancellationToken)
    {
        var configuration = await DiscoverAsync(provider, cancellationToken);
        var result = await ValidateWithAsync(configuration, provider, idToken);

        // A key Fusion hasn't seen yet usually means the provider rotated its keys.
        if (!result.IsValid && result.Exception is SecurityTokenSignatureKeyNotFoundException)
        {
            configuration = await DiscoverAsync(provider, cancellationToken, refresh: true);
            result = await ValidateWithAsync(configuration, provider, idToken);
        }

        if (!result.IsValid || result.SecurityToken is not JsonWebToken token)
            throw new SsoValidationException("The provider's answer didn't validate.");

        if (!token.TryGetPayloadValue<string>("nonce", out var tokenNonce)
            || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(tokenNonce), System.Text.Encoding.UTF8.GetBytes(nonce)))
            throw new SsoValidationException("The provider's answer belongs to another sign-in.");

        if (!token.TryGetPayloadValue<long>("iat", out _))
            throw new SsoValidationException("The provider's answer has no issue time.");

        var audiences = token.Audiences.ToList();
        var hasAzp = token.TryGetPayloadValue<string>("azp", out var azp);
        if ((audiences.Count > 1 && !hasAzp) || (hasAzp && azp != provider.ClientId))
            throw new SsoValidationException("The provider's answer was issued to another application.");

        return token;
    }

    private static Task<TokenValidationResult> ValidateWithAsync(
        OpenIdConnectConfiguration configuration, SsoProvider provider, string idToken)
        => new JsonWebTokenHandler().ValidateTokenAsync(idToken, new TokenValidationParameters
        {
            ValidAudience = provider.ClientId,
            ValidateAudience = true,
            ValidateIssuer = true,
            IssuerValidator = (issuer, token, _) =>
            {
                var tid = token is JsonWebToken jwt && jwt.TryGetPayloadValue<string>("tid", out var value) ? value : null;
                return provider.IssuerMatches(issuer, tid)
                    ? issuer
                    : throw new SecurityTokenInvalidIssuerException("Unexpected issuer.");
            },
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = configuration.SigningKeys,
            TryAllIssuerSigningKeys = true,
            ValidAlgorithms = AllowedAlgorithms,
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ValidateLifetime = true,
            ClockSkew = ClockSkew,
        });

    private static string Host(string url) => Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : url;
}

/// <summary>Who the provider says signed in, and the address Fusion may trust for a first link or an invitation.</summary>
public sealed record SsoIdentity(
    string Provider,
    Guid? ConnectionId,
    string Issuer,
    string Subject,
    string? TrustedEmail,
    string? SeenEmail,
    string? TrustRefusal,
    DateTimeOffset? AuthTime,
    string? GivenName,
    string? FamilyName,
    string? Name);

/// <summary>Per-provider rules for which email to trust (B-191 D5, D6).</summary>
public static class SsoTrust
{
    public static SsoIdentity Evaluate(SsoProvider provider, JsonWebToken token)
    {
        string? Claim(string name) => token.TryGetClaim(name, out var claim) ? claim.Value : null;
        static bool IsTrue(string? value) => value is not null
            && (value.Equals("true", StringComparison.OrdinalIgnoreCase) || value == "1");

        var microsoft = provider.Profile is SsoTrustProfile.FusionMicrosoft or SsoTrustProfile.CompanyEntra;
        var subject = microsoft ? Claim("oid") : Claim("sub");
        if (string.IsNullOrWhiteSpace(subject))
            throw new SsoValidationException("The provider's answer doesn't say who signed in.");

        var email = Normalize(Claim("email"));
        string? trusted = null;
        string? refusal = null;
        switch (provider.Profile)
        {
            case SsoTrustProfile.Google:
                var hd = Claim("hd")?.Trim().ToLowerInvariant();
                if (email is null || !IsTrue(Claim("email_verified")))
                    refusal = SsoRefusals.EmailNotVerified;
                else if (email.EndsWith("@gmail.com", StringComparison.Ordinal) || (hd is not null && hd == DomainOf(email)))
                    trusted = email;
                else
                    refusal = SsoRefusals.EmailNotVerified;
                break;

            case SsoTrustProfile.FusionMicrosoft:
                var tid = Claim("tid");
                if (string.Equals(tid, SsoOptions.MicrosoftConsumerTenant, StringComparison.OrdinalIgnoreCase))
                    refusal = SsoRefusals.EmailNotVerified;
                else if (email is null || !IsTrue(Claim("xms_edov")))
                    refusal = SsoRefusals.EmailNotVerified;
                else
                    trusted = email;
                break;

            case SsoTrustProfile.CompanyEntra:
                var idp = Claim("idp");
                if (!string.Equals(Claim("tid"), provider.EntraTenantId, StringComparison.OrdinalIgnoreCase))
                    throw new SsoValidationException("The answer came from another directory.");
                email ??= Normalize(Claim("preferred_username"));
                if (idp is not null && idp != token.Issuer)
                    refusal = SsoRefusals.EmailNotVerified; // a guest from another directory vouches for nothing here
                else if (email is null)
                    refusal = SsoRefusals.EmailNotVerified;
                else
                    trusted = email;
                break;

            case SsoTrustProfile.CompanyOidc:
                var verified = Claim("email_verified");
                if (email is null || (verified is not null && !IsTrue(verified)))
                    refusal = SsoRefusals.EmailNotVerified;
                else if (token.Issuer is "https://accounts.google.com" or "accounts.google.com"
                         && Claim("hd")?.Trim().ToLowerInvariant() != DomainOf(email))
                    refusal = SsoRefusals.EmailNotVerified;
                else
                    trusted = email;
                break;
        }

        DateTimeOffset? authTime = long.TryParse(Claim("auth_time"), out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : null;

        return new SsoIdentity(
            provider.Key, provider.ConnectionId, token.Issuer, subject, trusted, email, refusal, authTime,
            Claim("given_name"), Claim("family_name"), Claim("name"));
    }

    public static string? Normalize(string? email)
    {
        var trimmed = email?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(trimmed) || !trimmed.Contains('@') ? null : trimmed;
    }

    public static string DomainOf(string email) => email[(email.LastIndexOf('@') + 1)..].ToLowerInvariant();
}
