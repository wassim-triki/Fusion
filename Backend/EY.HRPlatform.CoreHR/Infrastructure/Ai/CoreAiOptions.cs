using EY.HRPlatform.SharedKernel.Ai;

namespace EY.HRPlatform.CoreHR.Infrastructure.Ai;

/// <summary>
/// Core HR's AI: the import's column reading and the change drafter. One pinned Groq model; without a key or when
/// disabled, both work on their rules alone. The key comes from <c>Ai:ApiKey</c> or <c>GROQ_API_KEY</c>.
/// </summary>
public sealed class CoreAiOptions
{
    public const string SectionName = "Ai";

    public bool Enabled { get; set; } = true;
    public string Model { get; set; } = GroqEndpoint.DefaultModel;
    public string Endpoint { get; set; } = GroqEndpoint.DefaultUrl;
    /// <summary>How long the import waits for the AI while a file is read, retries included.</summary>
    public int ImportBudgetSeconds { get; set; } = 15;
    public string? ApiKey { get; set; }

    public bool IsConfigured => Enabled && !string.IsNullOrWhiteSpace(ApiKey);

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(Model)) throw new InvalidOperationException("Ai:Model is required.");
        if (!GroqEndpoint.IsAllowed(Endpoint))
            throw new InvalidOperationException("Ai:Endpoint must use api.groq.com over HTTPS or a loopback development URL.");
        if (ImportBudgetSeconds is < 1 or > 60) throw new InvalidOperationException("Ai:ImportBudgetSeconds must be 1 to 60.");
    }
}
