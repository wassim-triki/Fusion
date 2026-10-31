using System.Text;
using System.Text.Json.Serialization;
using EY.HRPlatform.CoreHR.Extensions;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Middleware;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Constants;
using EY.HRPlatform.SharedKernel.Multitenancy;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using OpenTelemetry.Metrics;
using Serilog;
using EY.HRPlatform.SharedKernel.Security;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((ctx, cfg) => cfg.ReadFrom.Configuration(ctx.Configuration));

var jwtSecret = builder.Configuration["Jwt:Secret"];
if (string.IsNullOrEmpty(jwtSecret))
    throw new InvalidOperationException("Jwt:Secret is not configured. Set it via environment variable or appsettings.");

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

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

// Every authenticated Core HR endpoint requires the tenant's Core HR entitlement
// on top of its own permission checks. The fallback policy applies it to
// protected endpoints by default, so a new endpoint cannot forget it; endpoints
// marked [AllowAnonymous] (health, internal service calls) are unaffected.
builder.Services.AddModuleEntitlementAuthorization();
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .AddRequirements(new ModuleEntitlementRequirement(ModuleEntitlements.CoreHR))
        .Build();
});
builder.Services.AddMultitenancy();
builder.Services.AddCoreHRApplication(builder.Configuration);
builder.Services.AddCoreHRPersistence(builder.Configuration);

builder.Services.AddOpenTelemetry()
    .WithMetrics(metrics =>
    {
        metrics.AddAspNetCoreInstrumentation();
        metrics.AddPrometheusExporter();
    });

// Customer traffic reaches this service only through the Gateway, which is where
// withdrawn tenant access is enforced per request. Refuse to start somewhere it
// could be reached around that.
GatewayOnlyBindingGuard.Verify(
    "Core HR",
    builder.Configuration["Urls"] ?? builder.Configuration["ASPNETCORE_URLS"],
    builder.Configuration);

var app = builder.Build();

if (builder.Configuration.GetValue<bool>("Database:AutoMigrate"))
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<CoreHRDbContext>();
    await dbContext.Database.MigrateAsync();
    
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger(c => c.RouteTemplate = "api/corehr/swagger/{documentName}/swagger.json");
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("v1/swagger.json", "CoreHR API v1");
        c.RoutePrefix = "api/corehr/swagger";
    });
}

app.UseMiddleware<GlobalExceptionHandlerMiddleware>();
app.UseSerilogRequestLogging(options =>
{
    options.EnrichDiagnosticContext = (diagnosticContext, httpContext) =>
    {
        var correlationId = httpContext.Request.Headers["X-Correlation-Id"].FirstOrDefault()
            ?? httpContext.TraceIdentifier;
        diagnosticContext.Set("CorrelationId", correlationId);
        diagnosticContext.Set("UserId", httpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value);

        var tenantContext = httpContext.RequestServices.GetService<ITenantContext>();
        diagnosticContext.Set("TenantId", tenantContext?.TenantIdOrDefault?.ToString());
    };
});

// Before routing and model binding: signatures on internal routes are
// body-bound, and a request stream can only be read once.
app.UseInternalServiceBodyBuffering();

app.UseAuthentication();
app.UseMiddleware<EY.HRPlatform.SharedKernel.Auth.ReadOnlyViewMiddleware>(); // seeing Fusion as someone is read-only
app.UseMiddleware<TenantResolutionMiddleware>(); // after auth (claims populated), resolves tenant from claim/header
app.UseMiddleware<LogContextEnrichmentMiddleware>(); // enriches logs with correlation/user/tenant
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();
app.MapPrometheusScrapingEndpoint("/metrics").AllowAnonymous();

app.Run();
