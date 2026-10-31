using System.Text;
using EY.HRPlatform.Gateway.Middleware;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Increase Kestrel limit to handle large file uploads proxied to downstream services
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 524_288_000; // 500 MB
});
var jwtSecret = builder.Configuration["Jwt:Secret"];
if (string.IsNullOrEmpty(jwtSecret))
    throw new InvalidOperationException("Jwt:Secret is not configured. Set it via environment variable or appsettings.");

// Load YARP reverse proxy config from appsettings.json
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

// JWT validation — same secret as Identity service
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddAuthorization();

// The Gateway asks Identity whether an authenticated customer token still carries
// tenant authority. It signs those calls with the same rotating-HMAC scheme the
// other internal service-to-service calls already use.
var internalServiceAuthentication = builder.Configuration
    .GetSection(InternalServiceAuthenticationOptions.SectionName)
    .Get<InternalServiceAuthenticationOptions>() ?? new InternalServiceAuthenticationOptions();
// Validated at startup rather than discovered per request. The authority check
// fails closed, so a missing signing key would take down every authenticated
// customer request with an opaque "authority unavailable" — a configuration
// mistake presenting as a total outage. Refusing to start says what is wrong.
if (string.IsNullOrWhiteSpace(internalServiceAuthentication.CallerName)
    || string.IsNullOrWhiteSpace(internalServiceAuthentication.ActiveKeyId)
    || !internalServiceAuthentication.Keys.TryGetValue(
        internalServiceAuthentication.ActiveKeyId, out var activeKey)
    || string.IsNullOrWhiteSpace(activeKey))
{
    throw new InvalidOperationException(
        $"{InternalServiceAuthenticationOptions.SectionName} must configure CallerName, ActiveKeyId, "
        + "and the matching signing key. The Gateway validates tenant access with Identity on every "
        + "authenticated customer request and denies the request when it cannot, so without this "
        + "configuration no customer request can succeed.");
}

builder.Services.AddSingleton<IInternalServiceRequestSigner>(
    _ => new InternalServiceRequestSigner(internalServiceAuthentication));

builder.Services.AddHttpClient("identity-authority", client =>
{
    // Short: this call sits on the hot path of every authenticated customer
    // request, and a slow answer must fail closed quickly rather than hold the
    // request open.
    client.Timeout = TimeSpan.FromSeconds(5);
});

// CORS — allow Next.js frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://localhost:3000", "http://localhost:3001", "http://localhost:3002")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// Health checks
builder.Services.AddHealthChecks();

var app = builder.Build();

// Health endpoint (before auth middleware)
app.MapHealthChecks("/health").AllowAnonymous();

// Middleware pipeline (ORDER MATTERS!)
app.UseCors("AllowFrontend");
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseAuthentication();
app.UseMiddleware<EY.HRPlatform.SharedKernel.Auth.ReadOnlyViewMiddleware>(); // seeing Fusion as someone is read-only

// After authentication so the token's claims are available, and before the proxy
// so a request that lost its authority never reaches a downstream service.
app.UseMiddleware<TenantAuthorityGateMiddleware>();

app.UseAuthorization();
app.MapReverseProxy();

app.Run();