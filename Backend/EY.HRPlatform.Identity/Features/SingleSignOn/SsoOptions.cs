namespace EY.HRPlatform.Identity.Features.SingleSignOn;

/// <summary>Fusion-wide Microsoft or Google application credentials.</summary>
public sealed record SsoFusionApp(string Authority, string ClientId, string ClientSecret)
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}

/// <summary>
/// Single sign-on configuration (B-191). The public origin is where browsers reach Fusion; every redirect address and
/// landing page is built from it, never from a request. In Development and Testing the Fusion-wide providers and the
/// Entra authority point at the built-in test provider unless real credentials are set.
/// </summary>
public sealed class SsoOptions
{
    public const string SectionName = "Sso";
    public const string MicrosoftConsumerTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";

    /// <summary>Null when not configured outside Development and Testing: single sign-on is then off.</summary>
    public string? PublicOrigin { get; init; }

    public bool IsLocal { get; init; }
    public SsoFusionApp Microsoft { get; init; } = new("", "", "");
    public SsoFusionApp Google { get; init; } = new("", "", "");

    /// <summary>Company Entra authorities are <c>{EntraBase}/{directory}/v2.0</c>.</summary>
    public string EntraBase { get; init; } = "https://login.microsoftonline.com";

    public string? TestProviderSecret { get; init; }
    public int RateLimitPerMinute { get; init; } = 30;

    public bool Enabled => !string.IsNullOrWhiteSpace(PublicOrigin);

    /// <summary>The only address a local test provider may live at.</summary>
    public string? TestProviderPrefix => IsLocal && Enabled ? $"{PublicOrigin}/api/identity/dev-oidc/" : null;

    public bool SecureCookies => PublicOrigin?.StartsWith("https://", StringComparison.OrdinalIgnoreCase) == true;

    public static SsoOptions From(IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection(SectionName);
        var isLocal = environment.IsDevelopment() || environment.IsEnvironment("Testing");
        var origin = section["PublicOrigin"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(origin) && isLocal)
            origin = "http://localhost:3000";

        var testSecret = isLocal ? section["TestProvider:ClientSecret"] : null;
        var devBase = $"{origin}/api/identity/dev-oidc";

        SsoFusionApp App(string key, string realAuthority, string devAuthority)
        {
            var clientId = section[$"{key}:ClientId"] ?? "";
            var clientSecret = section[$"{key}:ClientSecret"] ?? "";
            if (!string.IsNullOrWhiteSpace(clientId))
                return new SsoFusionApp(section[$"{key}:Authority"] ?? realAuthority, clientId, clientSecret);
            return isLocal && !string.IsNullOrWhiteSpace(testSecret)
                ? new SsoFusionApp(devAuthority, $"fusion-local-{key.ToLowerInvariant()}", testSecret)
                : new SsoFusionApp(realAuthority, "", "");
        }

        var microsoft = App("Microsoft", "https://login.microsoftonline.com/organizations/v2.0", $"{devBase}/microsoft/organizations/v2.0");
        var google = App("Google", "https://accounts.google.com", $"{devBase}/google");
        var entraBase = section["EntraBase"]
            ?? (isLocal && string.IsNullOrWhiteSpace(section["Microsoft:ClientId"]) ? $"{devBase}/microsoft" : "https://login.microsoftonline.com");

        return new SsoOptions
        {
            PublicOrigin = string.IsNullOrWhiteSpace(origin) ? null : origin,
            IsLocal = isLocal,
            Microsoft = microsoft,
            Google = google,
            EntraBase = entraBase.TrimEnd('/'),
            TestProviderSecret = testSecret,
            RateLimitPerMinute = section.GetValue("RateLimitPerMinute", 30),
        };
    }
}
