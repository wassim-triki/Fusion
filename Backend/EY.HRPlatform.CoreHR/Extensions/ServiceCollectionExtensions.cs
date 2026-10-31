using EY.HRPlatform.SharedKernel.Ai;
using EY.HRPlatform.CoreHR.Features.Notifications;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.CoreHR.Infrastructure.Notifications;
using EY.HRPlatform.SharedKernel.Notifications;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence.Interceptors;
using EY.HRPlatform.CoreHR.Features.Employees.Services;
using EY.HRPlatform.CoreHR.Features.Employees.Import.Services;
using EY.HRPlatform.CoreHR.Features.Organization;
using EY.HRPlatform.CoreHR.Features.OrganizationImport;
using EY.HRPlatform.CoreHR.Features.TenantSettings.Services;
using EY.HRPlatform.CoreHR.Features.Security;
using EY.HRPlatform.CoreHR.Features.Workforce.Services;
using EY.HRPlatform.SharedKernel.Multitenancy;
using EY.HRPlatform.SharedKernel.Security;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddCoreHRApplication(this IServiceCollection services, IConfiguration configuration)
    {
        // Register MediatR - scans this assembly for all command/query handlers
        services.AddMediatR(cfg => cfg.RegisterServicesFromAssemblyContaining<Program>());
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

        services.AddHttpClient<IWorkforceAccountStatusReader, IdentityWorkforceAccountStatusReader>(client =>
        {
            var baseUrl = configuration["ServiceUrls:IdentityApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                throw new InvalidOperationException(
                    "ServiceUrls:IdentityApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            }

            client.BaseAddress = new Uri(EnsureTrailingSlash(baseUrl));
        });

        services.AddScoped<IEmployeeDetailsReadModelService, EmployeeDetailsReadModelService>();
        services.AddScoped<ICoreAccessPolicyService, CoreAccessPolicyService>();
        services.AddScoped<ITenantSettingsReadService, TenantSettingsReadService>();
        services.AddScoped<ISettingsSectionRegistry, SettingsSectionRegistry>();
        services.AddScoped<ISettingsAuditService, SettingsAuditService>();
        services.AddScoped<Features.Catalog.CompanyListService>();
        services.AddScoped<Features.Catalog.JobCatalogService>();
        services.AddScoped<IWorkforceContractService, WorkforceContractService>();
        services.AddScoped<IInternalWorkforceSnapshotService, InternalWorkforceSnapshotService>();
        services.AddScoped<IApplicabilityOptionsService, ApplicabilityOptionsService>();
        services.AddScoped<WorkforceResolutionScope>();
        services.AddScoped<IWorkforceCanonicalResolver, WorkforceCanonicalResolver>();
        services.AddScoped<IWorkforceMutationService, WorkforceMutationService>();
        services.AddScoped<Features.People.Changes.WorkforceChangeService>();

        // Team and job change notifications (B-155): staged with each change, emailed by the worker in the person's language.
        services.Configure<CoreNotificationOptions>(configuration.GetSection("Notifications"));
        services.AddScoped<Features.Notifications.CoreChangeNotifications>();
        services.AddScoped<Features.Notifications.CoreNotificationFeed>();
        services.AddScoped<Features.Notifications.CoreNotificationDefaultsService>();
        services.AddScoped<ICoreNotificationSender, SmtpCoreNotificationSender>();
        services.AddScoped<CoreNotificationDispatcher>();
        services.AddHostedService<CoreNotificationWorker>();

        // Rule-held roles (B-177): Identity reads role facts here and hears when they change.
        services.AddScoped<Features.Security.IRoleFactsService, Features.Security.RoleFactsService>();
        services.AddSingleton<Features.Security.RoleFactsSignals>();
        services.AddSingleton<Features.Security.RoleFactsChangeInterceptor>();
        services.AddHttpClient(Features.Security.RoleFactsNotifier.ClientName, client => client.Timeout = TimeSpan.FromSeconds(10));
        services.AddHostedService<Features.Security.RoleFactsNotifier>();
        services.AddHttpClient<ICoreNotificationAudienceClient, CoreNotificationAudienceClient>(client =>
        {
            var baseUrl = configuration["ServiceUrls:IdentityApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
                throw new InvalidOperationException(
                    "ServiceUrls:IdentityApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            client.Timeout = TimeSpan.FromSeconds(10);
            client.BaseAddress = new Uri(EnsureTrailingSlash(baseUrl));
        });
        services.AddScoped<Features.People.Changes.WorkforceChangeReader>();
        services.AddScoped<Features.People.Changes.ChangeRequestService>();
        services.AddScoped<Features.People.Changes.WorkforceChangeBackfill>();
        services.AddHostedService<Features.People.Changes.WorkforceChangeBackfillService>();
        services.AddScoped<EY.HRPlatform.CoreHR.Features.People.PeopleTimelineComposer>();

        // Profile photos are stored like Performance evidence: on disk outside Production, where a private object store
        // is still to be chosen (B-053) and uploads are refused until it is.
        var photoRoot = configuration["Photos:LocalRootPath"];
        if (string.IsNullOrWhiteSpace(photoRoot))
            photoRoot = Path.Combine(AppContext.BaseDirectory, "photo-store");
        services.AddScoped<Infrastructure.Photos.IEmployeePhotoStore>(sp =>
            sp.GetRequiredService<IHostEnvironment>().IsProduction()
                ? new Infrastructure.Photos.UnconfiguredEmployeePhotoStore()
                : new Infrastructure.Photos.LocalEmployeePhotoStore(sp.GetRequiredService<ITenantContext>(), photoRoot));

        services.AddScoped<IEmployeeNumberAllocator, EmployeeNumberAllocatorService>();
        services.AddScoped<IWorkEmailOccupancyService, WorkEmailOccupancyService>();
        services.AddScoped<IOrganizationService, OrganizationService>();
        services.AddSingleton<ISafeTabularSourceReader, SafeTabularSourceReader>();
        services.AddSingleton<WorkforceImportSourceAdapter>();
        services.AddSingleton<WorkforceImportInterpreter>();
        services.AddSingleton<WorkforceImportResolver>();
        services.AddSingleton<IWorkforceImportTemplateService, WorkforceImportTemplateService>();
        services.AddSingleton<WorkforceImportSemanticContextBuilder>();
        var workforceSemantic = configuration
            .GetSection(WorkforceImportSemanticAssistanceOptions.SectionName)
            .Get<WorkforceImportSemanticAssistanceOptions>() ?? new WorkforceImportSemanticAssistanceOptions();
        workforceSemantic.ApiKey = string.IsNullOrWhiteSpace(workforceSemantic.ApiKey)
            ? configuration["GROQ_API_KEY"]
            : workforceSemantic.ApiKey;
        services.AddSingleton(workforceSemantic);
        services.AddHttpClient<IWorkforceImportSemanticProvider, GroqWorkforceImportSemanticProvider>(client =>
        {
            client.BaseAddress = new Uri(EnsureTrailingSlash(workforceSemantic.BaseUrl));
            client.Timeout = TimeSpan.FromSeconds(Math.Clamp(workforceSemantic.TimeoutSeconds, 5, 60));
        }).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        services.AddScoped<WorkforceImportSnapshotLoader>();
        services.AddScoped<WorkforceImportReviewService>();
        services.AddScoped<WorkforceImportDerivation>();
        services.AddScoped<EY.HRPlatform.CoreHR.Features.Setup.ICoreHRReadinessService, EY.HRPlatform.CoreHR.Features.Setup.CoreHRReadinessService>();
        services.AddScoped<WorkforceImportSemanticAssistanceService>();
        services.AddScoped<WorkforceImportApplyOrchestrator>();
        services.AddScoped<WorkforceImportApplyOperationService>();
        services.AddSingleton<IWorkforceImportApplyProcessor, WorkforceImportApplyProcessor>();
        services.AddHostedService<WorkforceImportApplyBackgroundService>();
        services.AddScoped<IWorkforceImportSessionService, WorkforceImportSessionService>();
        services.AddScoped<IOrganizationImportSourceInspectionService, OrganizationImportSourceInspectionService>();
        services.AddScoped<IOrganizationImportWorkbookService, OrganizationImportWorkbookService>();
        services.AddScoped<IOrganizationImportService, OrganizationImportService>();
        services.AddScoped<IOrganizationImportMappingService, OrganizationImportMappingService>();
        services.AddScoped<IOrganizationImportMatchReadinessService, OrganizationImportMatchReadinessService>();
        services.AddScoped<IOrganizationImportValidator, OrganizationImportValidator>();
        services.AddScoped<IOrganizationImportInterpreter, OrganizationImportInterpreter>();
        services.AddScoped<IOrganizationImportPublisher, OrganizationImportPublisher>();
        var semanticAssistance = configuration
            .GetSection(OrganizationImportSemanticAssistanceOptions.SectionName)
            .Get<OrganizationImportSemanticAssistanceOptions>() ?? new OrganizationImportSemanticAssistanceOptions();
        semanticAssistance.ApiKey = string.IsNullOrWhiteSpace(semanticAssistance.ApiKey)
            ? configuration["GROQ_API_KEY"]
            : semanticAssistance.ApiKey;
        ValidateSemanticAssistance(semanticAssistance);
        services.AddSingleton(semanticAssistance);
        services.AddScoped<IOrganizationImportSemanticContextBuilder, OrganizationImportSemanticContextBuilder>();
        services.AddScoped<IOrganizationImportSemanticAssistanceService, OrganizationImportSemanticAssistanceService>();
        services.AddHttpClient<IOrganizationImportSemanticProvider, GroqOrganizationImportSemanticProvider>(client =>
        {
            client.BaseAddress = new Uri(EnsureTrailingSlash(semanticAssistance.Endpoint));
            client.Timeout = Timeout.InfiniteTimeSpan;
        }).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });

        services.AddHttpClient<Features.People.Changes.ChangeDrafter>(client =>
        {
            client.BaseAddress = new Uri(EnsureTrailingSlash(semanticAssistance.Endpoint));
            client.Timeout = TimeSpan.FromSeconds(15);
        }).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });

        services.AddHttpClient<Features.People.Changes.IChangeApproverDirectory, Features.People.Changes.ChangeApproverDirectory>(client =>
        {
            var baseUrl = configuration["ServiceUrls:IdentityApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
                throw new InvalidOperationException(
                    "ServiceUrls:IdentityApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            client.BaseAddress = new Uri(EnsureTrailingSlash(baseUrl));
            client.Timeout = TimeSpan.FromSeconds(5);
        });

        services.AddHttpClient<IWorkforceBulkProvisioner, WorkforceBulkProvisioner>(client =>
        {
            var baseUrl = configuration["ServiceUrls:IdentityApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                throw new InvalidOperationException(
                    "ServiceUrls:IdentityApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            }

            client.BaseAddress = new Uri(EnsureTrailingSlash(baseUrl));
        });

        services.AddHttpClient<IWorkforceAccessIdentityClient, WorkforceAccessIdentityClient>(client =>
        {
            var baseUrl = configuration["ServiceUrls:IdentityApiBaseUrl"];
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                throw new InvalidOperationException(
                    "ServiceUrls:IdentityApiBaseUrl is not configured. Set it via environment variable or appsettings.");
            }

            client.BaseAddress = new Uri(EnsureTrailingSlash(baseUrl));
        });

        return services;
    }

    private static string EnsureTrailingSlash(string url)
        => url.EndsWith('/') ? url : $"{url}/";

    private static void ValidateSemanticAssistance(OrganizationImportSemanticAssistanceOptions options)
    {
        if (!string.Equals(options.Provider, OrganizationImportSemanticAssistanceOptions.DefaultProvider, StringComparison.Ordinal))
            throw new InvalidOperationException("OrganizationImport:SemanticAssistance:Provider must be Groq.");
        if (string.IsNullOrWhiteSpace(options.Model))
            throw new InvalidOperationException("OrganizationImport:SemanticAssistance:Model is required.");
        if (!GroqEndpoint.IsAllowed(options.Endpoint))
            throw new InvalidOperationException("OrganizationImport:SemanticAssistance:Endpoint must use api.groq.com over HTTPS or a loopback development URL.");
        if (options.TimeoutSeconds is < 1 or > 60
            || options.UploadBudgetSeconds is < 1 or > 60
            || options.InteractiveBudgetSeconds is < 1 or > 90
            || options.MaxRetries is < 0 or > 2
            || options.MaxFields is < 1 or > 32
            || options.MaxValuesPerField is < 1 or > 5
            || options.MaxTotalValues is < 1 or > 64
            || options.MaxValueCharacters is < 16 or > 120
            || options.MaxPayloadBytes is < 4096 or > 20480)
            throw new InvalidOperationException("OrganizationImport:SemanticAssistance contains an invalid non-secret limit.");
    }

    public static IServiceCollection AddMultitenancy(this IServiceCollection services)
    {
        // TenantContext is scoped - one instance per request
        // Register concrete type first, then interface pointing to same instance
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());

        // Interceptor validates tenant context on SaveChanges
        services.AddScoped<TenantSaveChangesInterceptor>();

        return services;
    }

    public static IServiceCollection AddCoreHRPersistence(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("CoreHRDb");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException("ConnectionStrings:CoreHRDb is not configured. Set it via environment variable or appsettings.");

        // The live nudge (B-155): a new or read notification tells its recipient's open tabs to refetch.
        services.AddFeedNudges(CoreNotificationFeed.Channel, connectionString);

        services.AddDbContext<CoreHRDbContext>((sp, options) =>
        {
            options.UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "corehr"));

            // Add tenant validation interceptor (requires multitenancy services via AddMultitenancy())
            var tenantInterceptor = sp.GetService<TenantSaveChangesInterceptor>();
            if (tenantInterceptor is null)
            {
                throw new InvalidOperationException(
                    "TenantSaveChangesInterceptor is not registered. Ensure AddMultitenancy() is called to register multitenancy services.");
            }
            options.AddInterceptors(
                tenantInterceptor,
                sp.GetRequiredService<FeedNudgeInterceptor>(),
                sp.GetRequiredService<Features.Security.RoleFactsChangeInterceptor>());
        });

        services.AddHealthChecks()
            .AddDbContextCheck<CoreHRDbContext>(
                name: "corehr-db",
                tags: ["ready"]);

        return services;
    }
}
