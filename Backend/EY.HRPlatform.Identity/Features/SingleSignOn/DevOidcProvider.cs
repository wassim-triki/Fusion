using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace EY.HRPlatform.Identity.Features.SingleSignOn;

/// <summary>
/// A made-up OpenID Connect provider for Development and Testing only (B-191 D16), mapped nowhere else. It mirrors
/// the real shapes: Microsoft (<c>microsoft/{directory}/v2.0</c>, with <c>organizations</c> as the multi-tenant
/// endpoint), Google and a generic company provider. It signs with an in-memory key and accepts only the configured
/// test secret, so a wrong secret fails the way a real provider's does.
/// </summary>
public static class DevOidcProvider
{
    public const string BasePath = "/api/identity/dev-oidc";
    private static readonly RsaSecurityKey SigningKey = new(RSA.Create(2048)) { KeyId = "fusion-local-1" };

    private sealed record Grant(string Shape, string Issuer, string ClientId, string RedirectUri, string Challenge, Dictionary<string, object> Claims);

    public static void Map(WebApplication app)
    {
        app.MapGet($"{BasePath}/keys", () =>
        {
            var jwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(SigningKey.Rsa.ExportParameters(false)) { KeyId = SigningKey.KeyId });
            jwk.Use = "sig";
            jwk.Alg = SecurityAlgorithms.RsaSha256;
            return Results.Json(new { keys = new[] { new { kty = jwk.Kty, use = jwk.Use, alg = jwk.Alg, kid = jwk.Kid, n = jwk.N, e = jwk.E } } });
        }).AllowAnonymous();

        app.MapMethods($"{BasePath}/{{**path}}", ["GET", "POST"], HandleAsync).AllowAnonymous();
    }

    private static async Task<IResult> HandleAsync(HttpContext context, string path, SsoOptions options, IMemoryCache cache)
    {
        var origin = $"{options.PublicOrigin}{BasePath}";
        string shape, issuer, endpointBase, rest, directory = "";
        var segments = path.Split('/', 4);
        if (segments.Length >= 3 && segments[0] == "microsoft" && segments[2] == "v2.0")
        {
            shape = "microsoft";
            directory = segments[1];
            endpointBase = $"{origin}/microsoft/{directory}/v2.0";
            issuer = directory == "organizations" ? $"{origin}/microsoft/{{tenantid}}/v2.0" : endpointBase;
            rest = segments.Length == 4 ? segments[3] : "";
        }
        else if (segments.Length >= 2 && segments[0] is "google" or "company")
        {
            shape = segments[0];
            endpointBase = issuer = $"{origin}/{shape}";
            rest = string.Join('/', segments.Skip(1));
        }
        else
        {
            return Results.NotFound();
        }

        return (rest, context.Request.Method) switch
        {
            (".well-known/openid-configuration", "GET") => Results.Json(new Dictionary<string, object>
            {
                ["issuer"] = issuer,
                ["authorization_endpoint"] = $"{endpointBase}/authorize",
                ["token_endpoint"] = $"{endpointBase}/token",
                ["jwks_uri"] = $"{origin}/keys",
                ["response_types_supported"] = new[] { "code" },
                ["subject_types_supported"] = new[] { "public" },
                ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
                ["code_challenge_methods_supported"] = new[] { "S256" },
            }),
            ("authorize", "GET") => Form(context.Request.Query, shape, directory, endpointBase),
            ("authorize", "POST") => await AuthorizeAsync(context, shape, directory, issuer, options, cache),
            ("token", "POST") => await TokenAsync(context, options, cache),
            _ => Results.NotFound(),
        };
    }

    private static IResult Form(IQueryCollection query, string shape, string directory, string endpointBase)
    {
        string Q(string name) => WebUtility.HtmlEncode(query[name].ToString());
        var email = query["login_hint"].ToString();
        var hidden = string.Join("", new[] { "client_id", "redirect_uri", "state", "nonce", "code_challenge", "code_challenge_method", "response_type" }
            .Select(name => $"<input type=\"hidden\" name=\"{name}\" value=\"{Q(name)}\">"));
        var title = shape switch { "microsoft" => "Microsoft (test)", "google" => "Google (test)", _ => "Company provider (test)" };
        var extra = shape switch
        {
            "microsoft" => (directory == "organizations"
                    ? "<label>Directory (tenant) ID <input name=\"tid\" placeholder=\"derived from the domain\"></label>"
                    : "")
                + "<label><input type=\"checkbox\" name=\"xms_edov\" value=\"true\" checked> Domain owner verified the address</label>"
                + "<label><input type=\"checkbox\" name=\"guest\" value=\"true\"> Guest from another directory</label>",
            "google" => "<label><input type=\"checkbox\" name=\"email_verified\" value=\"true\" checked> Address verified</label>"
                + "<label><input type=\"checkbox\" name=\"workspace\" value=\"true\" checked> Workspace account (sends hd)</label>",
            _ => "<label><input type=\"checkbox\" name=\"email_verified\" value=\"true\" checked> Address verified</label>",
        };
        var html = $$"""
            <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>{{title}}</title><style>
            body{font:15px/1.5 system-ui,sans-serif;background:#18181b;color:#ececef;display:grid;place-items:center;min-height:100vh;margin:0}
            form{display:grid;gap:12px;width:min(420px,calc(100vw - 32px));background:#232327;padding:24px;border-radius:16px}
            input:not([type=checkbox]){width:100%;box-sizing:border-box;padding:9px 11px;border-radius:9px;border:1px solid #3f3f46;background:#18181b;color:inherit}
            label{display:grid;gap:4px} label:has(input[type=checkbox]){display:flex;gap:8px;align-items:center}
            button{padding:10px;border-radius:9px;border:0;background:#facc15;color:#1b1600;font-weight:600;cursor:pointer}
            p{margin:0;color:#a1a1aa;font-size:13px}</style></head><body>
            <form method="post" action="{{endpointBase}}/authorize">
            <h1 style="margin:0;font-size:20px">{{title}}</h1>
            <p>Development only. Pick a made-up person to sign in as.</p>
            {{hidden}}
            <label>Email <input name="email" value="{{WebUtility.HtmlEncode(email)}}" required></label>
            <label>First name <input name="given_name"></label>
            <label>Last name <input name="family_name"></label>
            {{extra}}
            <button type="submit">Sign in</button></form></body></html>
            """;
        return Results.Content(html, "text/html; charset=utf-8");
    }

    private static async Task<IResult> AuthorizeAsync(
        HttpContext context, string shape, string directory, string issuer, SsoOptions options, IMemoryCache cache)
    {
        var form = await context.Request.ReadFormAsync();
        string F(string name) => form[name].ToString().Trim();
        var redirectUri = F("redirect_uri");
        if (!redirectUri.StartsWith($"{options.PublicOrigin}/api/identity/sso/callback/", StringComparison.Ordinal))
            return Results.BadRequest("Unknown redirect address.");
        if (F("code_challenge_method") != "S256" || F("code_challenge").Length == 0)
            return Results.BadRequest("PKCE S256 is required.");

        var email = F("email").ToLowerInvariant();
        var domain = email.Contains('@') ? email[(email.IndexOf('@') + 1)..] : "example.test";
        var subject = F("sub") is { Length: > 0 } given ? given : Stable($"{shape}:{email}");
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var claims = new Dictionary<string, object>
        {
            ["email"] = email,
            ["auth_time"] = now,
        };
        if (F("given_name") is { Length: > 0 } first) claims["given_name"] = first;
        if (F("family_name") is { Length: > 0 } last) claims["family_name"] = last;

        if (shape == "microsoft")
        {
            var tid = directory != "organizations" ? directory : F("tid") is { Length: > 0 } t ? t : DirectoryFor(domain);
            issuer = issuer.Replace("{tenantid}", tid, StringComparison.Ordinal);
            claims["tid"] = tid;
            claims["oid"] = F("oid") is { Length: > 0 } oid ? oid : StableGuid($"oid:{tid}:{subject}");
            claims["sub"] = subject;
            claims["preferred_username"] = email;
            if (F("xms_edov") == "true") claims["xms_edov"] = true;
            if (F("guest") == "true") claims["idp"] = "https://sts.windows.net/guest-home/";
        }
        else
        {
            claims["sub"] = subject;
            claims["email_verified"] = F("email_verified") == "true";
            if (shape == "google" && F("workspace") == "true" && domain != "gmail.com") claims["hd"] = domain;
        }

        if (F("tamper") is { Length: > 0 } tamper) claims["__tamper"] = tamper;
        if (F("nonce") is { Length: > 0 } nonce) claims["nonce"] = nonce;

        var code = Stable(Guid.NewGuid().ToString()) + Stable(Guid.NewGuid().ToString());
        cache.Set($"dev-oidc:{code}", new Grant(shape, issuer, F("client_id"), redirectUri, F("code_challenge"), claims), TimeSpan.FromMinutes(2));

        var target = QueryHelpers.AddQueryString(redirectUri, new Dictionary<string, string?>
        {
            ["code"] = code,
            ["state"] = F("state"),
            ["iss"] = issuer,
        });
        return Results.Redirect(target);
    }

    private static async Task<IResult> TokenAsync(HttpContext context, SsoOptions options, IMemoryCache cache)
    {
        var form = await context.Request.ReadFormAsync();
        string F(string name) => form[name].ToString();
        if (string.IsNullOrEmpty(options.TestProviderSecret) || !Equal(F("client_secret"), options.TestProviderSecret))
            return Results.Json(new { error = "invalid_client", error_description = "The client secret is wrong." }, statusCode: 401);

        var key = $"dev-oidc:{F("code")}";
        if (!cache.TryGetValue(key, out Grant? grant) || grant is null)
            return Results.Json(new { error = "invalid_grant" }, statusCode: 400);
        cache.Remove(key);

        var challenge = WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(F("code_verifier"))));
        if (grant.ClientId != F("client_id") || grant.RedirectUri != F("redirect_uri") || !Equal(challenge, grant.Challenge))
            return Results.Json(new { error = "invalid_grant" }, statusCode: 400);

        var claims = new Dictionary<string, object>(grant.Claims);
        claims.Remove("__tamper", out var tamperValue);
        var tamper = tamperValue as string;
        var now = DateTime.UtcNow;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = tamper == "iss" ? "https://someone-else.example" : grant.Issuer,
            Audience = tamper == "aud" ? "another-application" : grant.ClientId,
            IssuedAt = now,
            NotBefore = tamper == "exp" ? now.AddHours(-2) : now,
            Expires = tamper == "exp" ? now.AddHours(-1) : now.AddMinutes(10),
            Claims = claims,
            SigningCredentials = tamper == "alg-hs256"
                ? new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.TestProviderSecret.PadRight(32, '0'))), SecurityAlgorithms.HmacSha256)
                : new SigningCredentials(SigningKey, SecurityAlgorithms.RsaSha256),
        };
        if (tamper == "nonce") claims["nonce"] = "another-sign-in";

        var handler = new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false };
        var idToken = tamper == "alg-none"
            ? UnsignedToken(descriptor)
            : handler.CreateToken(descriptor);
        return Results.Json(new { id_token = idToken, token_type = "Bearer", expires_in = 600 });
    }

    private static string UnsignedToken(SecurityTokenDescriptor descriptor)
    {
        var payload = new Dictionary<string, object>(descriptor.Claims!)
        {
            ["iss"] = descriptor.Issuer!,
            ["aud"] = descriptor.Audience!,
            ["iat"] = EpochTime.GetIntDate(descriptor.IssuedAt!.Value),
            ["exp"] = EpochTime.GetIntDate(descriptor.Expires!.Value),
        };
        static string Encode(object value) => WebEncoders.Base64UrlEncode(System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(value));
        return $"{Encode(new { alg = "none", typ = "JWT" })}.{Encode(payload)}.";
    }

    /// <summary>The same made-up directory for every address at a domain, so a company's people share one.</summary>
    public static string DirectoryFor(string domain) => StableGuid($"tid:{domain.ToLowerInvariant()}");

    private static string StableGuid(string value) => new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(value))[..16]).ToString();

    private static string Stable(string value) => WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.UTF8.GetBytes(value)))[..22];

    private static bool Equal(string a, string b)
        => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}
