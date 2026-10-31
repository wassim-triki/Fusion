using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Extensions;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Middleware;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using EY.HRPlatform.SharedKernel.Security;

var builder = WebApplication.CreateBuilder(args);

// Register all services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddMultitenancy();
builder.Services.AddIdentityServices(builder.Configuration);

// CORS — allow Next.js frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        var allowedOrigins = builder.Configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>();

        policy.WithOrigins(allowedOrigins ?? new[] { "http://localhost:3000" })
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// Health checks
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppIdentityDbContext>();

var app = builder.Build();

// Apply database migrations and seed data on startup
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<AppIdentityDbContext>();
    // Migrations require a relational provider (e.g. Npgsql). Use EnsureCreated for
    // in-memory/test configurations so local startup does not fail.
    if (!dbContext.Database.IsRelational())
        await dbContext.Database.EnsureCreatedAsync();
    else
        await dbContext.Database.MigrateAsync();

    var roleManager = scope.ServiceProvider
        .GetRequiredService<RoleManager<IdentityRole<Guid>>>();
    var userManager = scope.ServiceProvider
        .GetRequiredService<UserManager<ApplicationUser>>();
    
    await IdentitySeeder.SeedAsync(dbContext, roleManager, userManager);

    if (app.Environment.IsDevelopment())
        await DevelopmentPlatformAdminBootstrap.SeedIfConfiguredAsync(
            dbContext, userManager, builder.Configuration);

    // Runs after profile seeding, when both the pre-canonical and the canonical
    // administrator definitions exist, so the permission broadening the migration
    // applied is reviewable instead of silent.
    await new TenantAdministratorGrantDeltaReport(
            dbContext,
            scope.ServiceProvider.GetRequiredService<ILogger<TenantAdministratorGrantDeltaReport>>())
        .ReportAsync();
}

// Middleware pipeline (ORDER MATTERS!)
if (app.Environment.IsDevelopment() || app.Environment.IsEnvironment("Docker"))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Health endpoint
app.MapHealthChecks("/health").AllowAnonymous();

// Before routing and model binding: the signature on internal routes is
// body-bound, and a request stream can only be read once.
app.UseInternalServiceBodyBuffering();

app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseMiddleware<EY.HRPlatform.SharedKernel.Auth.ReadOnlyViewMiddleware>(); // seeing Fusion as someone is read-only
app.UseMiddleware<TenantAuthorityRevisionMiddleware>();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseAuthorization();
app.MapControllers();

app.Run();
