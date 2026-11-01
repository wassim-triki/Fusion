using System.Text.Json.Serialization;

namespace EY.HRPlatform.CoreHR.Infrastructure.Imports.Semantic;

// The vocabulary of one closed classification call: questions with the exact targets Fusion allows, answered by a
// target or an abstention. What a question means and how an answer is used stay with the caller.

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ImportSemanticFailureCategory
{
    NotConfigured,
    Unauthorized,
    ProviderRejected,
    Timeout,
    RateLimited,
    ProviderUnavailable,
    InvalidOutput,
    Interrupted,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum ImportSemanticDisposition
{
    Suggest,
    Abstain,
}

public sealed record ImportSemanticTarget(string Key, string Label);

/// <summary>One unresolved semantic question and the exact targets Fusion allows as its answer.</summary>
public sealed record ImportSemanticIssue(
    string Key,
    string Kind,
    int? SourceColumnIndex,
    string? SourceLabel,
    IReadOnlyList<ImportSemanticTarget> AllowedTargets);

/// <summary>One answer per question: a target from the allowed list, or an explicit abstention.</summary>
public sealed record ImportSemanticAnswer(
    string QuestionKey,
    ImportSemanticDisposition Disposition,
    string? TargetKey);

public sealed record ImportSemanticProviderResult(
    IReadOnlyList<ImportSemanticAnswer> Answers,
    int? InputTokens,
    int? OutputTokens,
    string? ResponseId = null,
    string? SystemFingerprint = null);

public sealed class ImportSemanticProviderException(
    ImportSemanticFailureCategory category,
    string safeMessage,
    DateTime? retryAfter = null,
    Exception? innerException = null) : Exception(safeMessage, innerException)
{
    public ImportSemanticFailureCategory Category { get; } = category;
    public DateTime? RetryAfter { get; } = retryAfter;
}
