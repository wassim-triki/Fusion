using System.Text;
using System.Text.Json.Serialization;
using EY.HRPlatform.Performance.Extensions;
using EY.HRPlatform.Performance.Infrastructure.Persistence;
using EY.HRPlatform.Performance.Middleware;
using EY.HRPlatform.SharedKernel.Auth;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((ctx, cfg) => cfg.ReadFrom.Configuration(ctx.Configuration));

// Performance now hosts the Cycle & Goals product. It keeps the same security boundary the
// foundation established: JWT + the Performance module entitlement (deny-by-default fallback)
// + gateway-only binding + internal-service body buffering.
var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Jwt:Secret is not configured.");

builder.Services.AddControllers()
    .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
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
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.Zero
        };
    });

builder.Services.AddModuleEntitlementAuthorization();
builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, PerformanceAuthorizationResultHandler>();
builder.Services.AddAuthorization(options =>
{
    var performancePolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .AddRequirements(new ModuleEntitlementRequirement(ModuleEntitlements.Performance))
        .Build();
    options.DefaultPolicy = performancePolicy;
    options.FallbackPolicy = performancePolicy;
});

builder.Services.AddPerformanceMultitenancy();
builder.Services.AddPerformanceApplication(builder.Configuration, builder.Environment);
builder.Services.AddPerformancePersistence(builder.Configuration);

// Customer traffic reaches this service only through the Gateway, which is where withdrawn
// tenant access is enforced per request. Refuse to start somewhere it could be reached around that.
GatewayOnlyBindingGuard.Verify(
    "Performance",
    builder.Configuration["Urls"] ?? builder.Configuration["ASPNETCORE_URLS"],
    builder.Configuration);

var app = builder.Build();

if (builder.Configuration.GetValue<bool>("Database:AutoMigrate"))
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<PerformanceDbContext>();
    await dbContext.Database.MigrateAsync();
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger(c => c.RouteTemplate = "api/performance/swagger/{documentName}/swagger.json");
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("v1/swagger.json", "Performance API v1");
        c.RoutePrefix = "api/performance/swagger";
    });
}

app.UseSerilogRequestLogging();

// Before routing and model binding: signatures on internal routes are body-bound, and a
// request stream can only be read once.
app.UseInternalServiceBodyBuffering();

app.UseAuthentication();
app.UseMiddleware<EY.HRPlatform.SharedKernel.Auth.ReadOnlyViewMiddleware>(); // seeing Fusion as someone is read-only
// Development-only simulated request time; refused elsewhere (performance-demo-clock).
app.UseMiddleware<DemoClockMiddleware>();
app.UseAuthorization();
// Entitlement checks use signed claims. Deny missing customer authority before tenant resolution.
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseRateLimiter();

app.MapControllers();
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false }).AllowAnonymous();
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") }).AllowAnonymous();

app.Run();

/// <summary>Exposed so integration tests can host this boundary.</summary>
public partial class Program;
