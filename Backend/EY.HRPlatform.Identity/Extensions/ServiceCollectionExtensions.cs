using System.Diagnostics;
using System.Text;
using EY.HRPlatform.Identity.Domain.Entities;
using EY.HRPlatform.Identity.Features.AccessProfiles;
using EY.HRPlatform.Identity.Features.Accounts;
using EY.HRPlatform.Identity.Features.Eligibility;
using EY.HRPlatform.Identity.Features.Membership;
using EY.HRPlatform.Identity.Features.Notifications;
using EY.HRPlatform.Identity.Features.TenantAdministration;
using EY.HRPlatform.Identity.Features.TenantProvisioning;
using EY.HRPlatform.Identity.Features.WorkforceAccounts;
using EY.HRPlatform.Identity.Infrastructure.Persistence;
using EY.HRPlatform.Identity.Infrastructure.Services;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace EY.HRPlatform.Identity.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddMultitenancy(this IServiceCollection services)
    {
        // TenantContext is scoped - one instance per request
        // Register concrete type first, then interface pointing to same instance
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());

        // Note: Unlike CoreHR, Identity does NOT wire TenantSaveChangesInterceptor in DI.
        // Identity inherently performs cross-tenant writes (PlatformAdmin creates orgs/invites/users
        // for other tenants, IdentitySeeder runs at startup with no request context).
        // Write authorization is enforced at the controller/service layer instead.
        // The interceptor class is kept for explicit opt-in in unit tests.

        return services;
    }

    public static IServiceCollection AddIdentityServices(
        this IServiceCollection services, IConfiguration configuration)
    {
        var jwtSecret = configuration["Jwt:Secret"];
        if (string.IsNullOrEmpty(jwtSecret))
            throw new InvalidOperationException("Jwt:Secret is not configured. Set it via environment variable or appsettings.");

        services.AddHttpContextAccessor();
        services.AddMemoryCache();
        var internalServiceAuthentication = configuration
            .GetSection(InternalServiceAuthenticationOptions.SectionName)
            .Get<InternalServiceAuthenticationOptions>() ?? new InternalServiceAuthenticationOptions();
        services.AddSingleton<IInternalServiceRequestAuthorizer>(sp => new InternalServiceRequestAuthorizer(
            sp.GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>(),
            internalServiceAuthentication));
        services.AddSingleton<IInternalServiceRequestSigner>(_ => new InternalServiceRequestSigner(
            internalServiceAuthentication));

        // Trusted CoreHR workforce read used by the binding backfill and workforce
        // access flows. CoreHR owns Employee existence and tenant ownership; Identity
        // never accepts those facts from a browser. The base URL is validated lazily
        // so environments that never resolve the directory (tests, control-plane-only)
        // are unaffected.
        services.AddHttpClient<Infrastructure.Core.ICoreWorkforceDirectory, Infrastructure.Core.CoreWorkforceDirectory>(client =>
        {
            var baseUrl = configuration["ServiceUrls:CoreHRApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                throw new InvalidOperationException(
                    "ServiceUrls:CoreHRApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            }

            client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : $"{baseUrl}/");
        });
        // Roles held by rule read Core HR's facts (unit chain, job, place, team) over the same signed channel.
        services.AddHttpClient<Infrastructure.Core.ICoreRoleFacts, Infrastructure.Core.CoreRoleFacts>(client =>
        {
            var baseUrl = configuration["ServiceUrls:CoreHRApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                throw new InvalidOperationException(
                    "ServiceUrls:CoreHRApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            }

            client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : $"{baseUrl}/");
            client.Timeout = TimeSpan.FromSeconds(30);
        });
        services.AddSingleton<Features.Roles.RoleRecomputeQueue>();
        services.AddScoped<Features.Roles.IRoleHolderService, Features.Roles.RoleHolderService>();
        services.AddScoped<Features.Roles.IRoleService, Features.Roles.RoleService>();
        services.AddHostedService<Features.Roles.RoleRecomputeWorker>();
        services.AddScoped<Features.WorkforceBinding.IWorkforceBindingBackfillService, Features.WorkforceBinding.WorkforceBindingBackfillService>();
        services.AddHostedService<Features.WorkforceBinding.WorkforceBindingBackfillStartupTask>();
        services.AddScoped<Features.WorkforceAccess.IWorkforceAccountCandidateResolver, Features.WorkforceAccess.WorkforceAccountCandidateResolver>();
        services.AddScoped<Features.WorkforceAccess.IWorkforceBaselineService, Features.WorkforceAccess.WorkforceBaselineService>();
        services.AddScoped<Features.WorkforceAccess.IWorkforceIdentityBindingService, Features.WorkforceAccess.WorkforceIdentityBindingService>();
        services.AddScoped<Features.WorkforceAccess.IWorkforceAccessMutationService, Features.WorkforceAccess.WorkforceAccessMutationService>();

        var databaseProvider = configuration["Database:Provider"] ?? "postgres";
        var inMemoryName = configuration["Database:InMemoryName"] ?? "identity_inmemory";

        // 1. Register database
        if (databaseProvider.Equals("inmemory", StringComparison.OrdinalIgnoreCase))
        {
            services.AddDbContext<AppIdentityDbContext>((sp, options) =>
            {
                options.UseInMemoryDatabase(inMemoryName);
            });
        }
        else
        {
            var connectionString = configuration.GetConnectionString("IdentityDb");
            if (string.IsNullOrEmpty(connectionString))
                throw new InvalidOperationException(
                    "ConnectionStrings:IdentityDb is not configured. Set it via environment variable or appsettings.");

            // PostgreSQL database
            services.AddDbContext<AppIdentityDbContext>((sp, options) =>
            {
                options.UseNpgsql(
                    connectionString,
                    npgsql => npgsql.MigrationsHistoryTable(
                        "__EFMigrationsHistory", "identity"));
            });
        }

        // 2. Register ASP.NET Core Identity
        services.AddIdentity<ApplicationUser, IdentityRole<Guid>>(options =>
        {
            AccountPasswordPolicy.Apply(options.Password);
            options.User.RequireUniqueEmail = true;
        })
            .AddEntityFrameworkStores<AppIdentityDbContext>()
            .AddPasswordValidator<LetterPasswordValidator>()
            .AddPasswordValidator<MaximumLengthPasswordValidator>()
            .AddDefaultTokenProviders();

        // 3. Register JWT authentication
        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = configuration["Jwt:Issuer"],
                    ValidAudience = configuration["Jwt:Audience"],
                    IssuerSigningKey = new SymmetricSecurityKey(
                        Encoding.UTF8.GetBytes(jwtSecret)),
                    ClockSkew = TimeSpan.Zero
                };
            });

        // 4. Register our custom services
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<IAuthSessionFactory, AuthSessionFactory>();
        services.AddScoped<ICustomerContextResolver, CustomerContextResolver>();
        services.AddScoped<ITenantProvisioningService, TenantProvisioningService>();
        services.AddScoped<IBootstrapInvitationRecoveryService, BootstrapInvitationRecoveryService>();
        services.AddScoped<ITenantLifecycleService, TenantLifecycleService>();
        services.AddScoped<ITenantProfileService, TenantProfileService>();
        services.AddScoped<ITenantProductService, TenantProductService>();
        services.AddScoped<ITenantDetailProjection, TenantDetailProjection>();
        services.AddScoped<ITenantOverviewProjection, TenantOverviewProjection>();
        services.AddScoped<ITenantActivityProjection, TenantActivityProjection>();
        services.AddScoped<IBootstrapActivationService, BootstrapActivationService>();
        services.AddScoped<IBootstrapInvitationDelivery, BootstrapInvitationDelivery>();

        // Tenant administration and access.
        services.AddScoped<ITenantContinuityCommandExecutor, TenantContinuityCommandExecutor>();
        services.AddScoped<ITenantAdministratorLifecycleService, TenantAdministratorLifecycleService>();
        services.AddScoped<IAdministratorInvitationService, AdministratorInvitationService>();
        services.AddScoped<IAdministrativeInvitationDelivery, AdministrativeInvitationDelivery>();
        services.AddScoped<IAdministrativeInvitationAcceptanceService, AdministrativeInvitationAcceptanceService>();
        services.AddScoped<ITenantAccessProjection, TenantAccessProjection>();
        services.AddScoped<ITenantContinuityHealthProjection, TenantContinuityHealthProjection>();
        services.AddScoped<IPlatformAdministratorRecoveryService, PlatformAdministratorRecoveryService>();
        // Local capture retains the rendered message and reports Sent without
        // sending, and the files it writes carry the bootstrap credential. That is
        // acceptable for local demonstration and nowhere else, so it is
        // Development-only. Outside Development, SMTP sends when configured, and an
        // unconfigured provider records a truthful Failed attempt rather than a
        // false success.
        services.Configure<BootstrapInvitationCaptureOptions>(
            configuration.GetSection(BootstrapInvitationCaptureOptions.SectionName));
        services.Configure<BootstrapInvitationEmailOptions>(
            configuration.GetSection(BootstrapInvitationEmailOptions.SectionName));

        var isDevelopment = string.Equals(
            configuration["ASPNETCORE_ENVIRONMENT"] ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
            "Development",
            StringComparison.OrdinalIgnoreCase);

        var smtpConfigured = configuration
            .GetSection(BootstrapInvitationEmailOptions.SectionName)
            .GetValue<bool>(nameof(BootstrapInvitationEmailOptions.Enabled));

        if (smtpConfigured)
        {
            services.AddScoped<IBootstrapInvitationEmailSender, SmtpBootstrapInvitationEmailSender>();
        }
        else if (isDevelopment)
        {
            services.AddScoped<IBootstrapInvitationEmailSender, CapturedBootstrapInvitationEmailSender>();
        }
        else
        {
            services.AddScoped<IBootstrapInvitationEmailSender, UnconfiguredBootstrapInvitationEmailSender>();
        }
        services.AddScoped<IAccessProfileService, AccessProfileService>();
        services.AddScoped<NotificationAudienceReader>();
        services.AddScoped<IAccountMailSender, SmtpAccountMailSender>();
        services.AddScoped<IAdministratorRoleMail, AdministratorRoleMail>();
        services.AddScoped<IEligibilityDecisionService, EligibilityDecisionService>();
        services.AddScoped<IAccessAuditService, AccessAuditService>();
        services.Configure<WorkforceInvitationEmailOptions>(
            configuration.GetSection("WorkforceInvitationEmail"));
        // Local development can opt into the same SMTP transport as bootstrap
        // invitations (Mailpit by default). Keep file capture as the safe fallback
        // when no Workforce SMTP transport is configured.
        var workforceSmtpConfigured = configuration
            .GetSection("WorkforceInvitationEmail")
            .GetValue<bool>(nameof(WorkforceInvitationEmailOptions.Enabled));

        if (workforceSmtpConfigured || !isDevelopment)
        {
            services.AddScoped<IWorkforceInvitationEmailSender, SmtpWorkforceInvitationEmailSender>();
        }
        else
        {
            services.AddScoped<IWorkforceInvitationEmailSender, CapturedWorkforceInvitationEmailSender>();
        }
        services.AddScoped<IWorkforceInvitationAcceptanceService, WorkforceInvitationAcceptanceService>();

        // 6. Training service client (service-to-service)
        // This integration is fire-and-forget only. When local config is blank,
        // keep Identity endpoints working and skip downstream provisioning.
        var trainingBaseUrl = configuration["Services:TrainingUrl"]?.Trim();
        var serviceApiKey = configuration["ServiceIntegration:ApiKey"]?.Trim();

        if (string.IsNullOrWhiteSpace(trainingBaseUrl) || string.IsNullOrWhiteSpace(serviceApiKey))
        {
            services.AddSingleton<ITrainingServiceClient, NoOpTrainingServiceClient>();
        }
        else
        {
            services.AddHttpClient<ITrainingServiceClient, HttpTrainingServiceClient>(client =>
            {
                client.BaseAddress = new Uri(trainingBaseUrl);
                client.DefaultRequestHeaders.Add("X-Service-Key", serviceApiKey);
                client.Timeout = TimeSpan.FromSeconds(5);
            });
        }

        return services;
    }
}


