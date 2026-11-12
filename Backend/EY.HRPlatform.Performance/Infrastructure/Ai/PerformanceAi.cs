using EY.HRPlatform.SharedKernel.Ai;

namespace EY.HRPlatform.Performance.Infrastructure.Ai;

/// <summary>
/// Performance's AI configuration (<c>Performance:Ai</c>). The key falls back to <c>GROQ_API_KEY</c>,
/// the variable Core HR already uses, so one key serves the whole stack. No key means AI is hidden.
/// </summary>
public sealed class PerformanceAiOptions
{
    public const string SectionName = "Performance:Ai";

    public bool Enabled { get; set; } = true;
    public string Provider { get; set; } = GroqEndpoint.Provider;
    public string Model { get; set; } = GroqEndpoint.DefaultModel;
    public string Endpoint { get; set; } = GroqEndpoint.DefaultUrl;
    /// <summary>Hard limit for one call; the author is waiting. Clamped to 3–10 seconds.</summary>
    public int TimeoutSeconds { get; set; } = 10;
    public string? ApiKey { get; set; }

    public bool IsConfigured => Enabled && !string.IsNullOrWhiteSpace(ApiKey);
    public TimeSpan Timeout => TimeSpan.FromSeconds(Math.Clamp(TimeoutSeconds, 3, 10));

    public static PerformanceAiOptions From(IConfiguration configuration)
    {
        var options = configuration.GetSection(SectionName).Get<PerformanceAiOptions>() ?? new PerformanceAiOptions();
        if (string.IsNullOrWhiteSpace(options.ApiKey)) options.ApiKey = configuration["GROQ_API_KEY"];
        options.Validate();
        return options;
    }

    public void Validate()
    {
        if (!string.Equals(Provider, GroqEndpoint.Provider, StringComparison.Ordinal))
            throw new InvalidOperationException("Performance:Ai:Provider must be Groq.");
        if (string.IsNullOrWhiteSpace(Model))
            throw new InvalidOperationException("Performance:Ai:Model is required.");
        if (!GroqEndpoint.IsAllowed(Endpoint))
            throw new InvalidOperationException("Performance:Ai:Endpoint must use api.groq.com over HTTPS or a loopback development URL.");
        if (TimeoutSeconds is < 1 or > 60)
            throw new InvalidOperationException("Performance:Ai:TimeoutSeconds must be between 1 and 60.");
    }
}

/// <summary>One Performance feature's structured request; the provider adds credentials, model and limits.</summary>
public sealed record PerformanceAiRequest(string Instructions, object Input, string SchemaName, object Schema, int? MaxCompletionTokens = null);

/// <summary>
/// The only way Performance reaches an AI model. Callers ask <see cref="IsAvailable"/> before offering
/// AI, and treat any <see cref="AiProviderException"/> as "AI is not here right now".
/// </summary>
public interface IPerformanceAiProvider
{
    string ProviderName { get; }
    string Model { get; }
    bool IsAvailable { get; }
    Task<AiStructuredResult> CompleteAsync(PerformanceAiRequest request, CancellationToken cancellationToken);

    /// <summary>The answer arrived but the feature could not read it: counts toward resting AI like any invalid output.</summary>
    void ReportUnusableAnswer();

    /// <summary>
    /// Sends one request nobody waits for, so the provider compiles its schema and the connection is
    /// open before the first person asks. Never throws and never changes AI availability.
    /// </summary>
    Task WarmUpAsync(PerformanceAiRequest request, CancellationToken cancellationToken);
}

/// <summary>
/// Groq through the shared transport with a hard timeout, low reasoning effort and a small token
/// budget. No retries: the person is waiting, and <see cref="AiAvailability"/> rests AI after
/// repeated trouble instead. Network and timeout failures are classified here; the transport only
/// classifies what the provider answered.
/// </summary>
public sealed class PerformanceAiProvider(HttpClient httpClient, PerformanceAiOptions options, AiAvailability availability)
    : IPerformanceAiProvider
{
    private const int MaxCompletionTokens = 700;
    private static readonly TimeSpan WarmUpBudget = TimeSpan.FromSeconds(30);
    private const double Temperature = 0.2;

    private static readonly AiSafeMessages Messages = new(
        "Suggestions are busy right now.",
        "Suggestions are not available.",
        "Suggestions are unavailable right now.",
        "Suggestions are not available with the current configuration.",
        "Suggestions could not be read.");

    public string ProviderName => options.Provider;
    public string Model => options.Model;
    public bool IsAvailable => availability.IsAvailable;

    public void ReportUnusableAnswer() => availability.RecordFailure(AiFailureCategory.InvalidOutput);

    public async Task WarmUpAsync(PerformanceAiRequest request, CancellationToken cancellationToken)
    {
        if (!options.IsConfigured) return;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(WarmUpBudget);
        try
        {
            await GroqStructuredTransport.CompleteAsync(httpClient, Request(request), timeout.Token, Messages);
        }
        catch (Exception exception) when (exception is AiProviderException or OperationCanceledException or HttpRequestException)
        {
            // A failed warm-up only means the first person pays the cold start.
        }
    }

    public async Task<AiStructuredResult> CompleteAsync(PerformanceAiRequest request, CancellationToken cancellationToken)
    {
        if (!options.IsConfigured)
            throw new AiProviderException(AiFailureCategory.NotConfigured, Messages.Rejected);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(options.Timeout);
        try
        {
            var result = await GroqStructuredTransport.CompleteAsync(httpClient, Request(request), timeout.Token, Messages);
            availability.RecordSuccess();
            return result;
        }
        catch (AiProviderException exception)
        {
            availability.RecordFailure(exception.Category, exception.RetryAfter);
            throw;
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            availability.RecordFailure(AiFailureCategory.Timeout);
            throw new AiProviderException(AiFailureCategory.Timeout, Messages.Unavailable, innerException: exception);
        }
        catch (OperationCanceledException exception)
        {
            throw new AiProviderException(AiFailureCategory.Interrupted, Messages.Unavailable, innerException: exception);
        }
        catch (HttpRequestException exception)
        {
            availability.RecordFailure(AiFailureCategory.ProviderUnavailable);
            throw new AiProviderException(AiFailureCategory.ProviderUnavailable, Messages.Unavailable, innerException: exception);
        }
    }

    private GroqStructuredRequest Request(PerformanceAiRequest request) => new(
        options.ApiKey!,
        options.Model,
        request.Instructions,
        request.Input,
        request.SchemaName,
        request.Schema,
        request.MaxCompletionTokens ?? MaxCompletionTokens,
        "low",
        Temperature);
}
