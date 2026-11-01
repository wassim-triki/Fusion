using System.Text.Json;
using System.Text.Json.Serialization;
using EY.HRPlatform.CoreHR.Infrastructure.Imports;
using EY.HRPlatform.SharedKernel.Domain;
using EY.HRPlatform.SharedKernel.Multitenancy;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

public enum CompanyImportStatus { Open, BringingIn, BroughtIn, Discarded }

/// <summary>
/// One import of the company (D-22): any number of files, read together, brought in once. The decisions are the
/// person's answers and fixes; everything else is derived again from the files on every read and at bring-in.
/// </summary>
public sealed class CompanyImportSession : BaseEntity, ITenantEntity
{
    private readonly List<CompanyImportSource> sources = [];

    private CompanyImportSession() { }

    public Guid TenantId { get; private set; }
    public uint Version { get; private set; }
    public CompanyImportStatus Status { get; private set; }
    /// <summary>The company's name as the person's Fusion shows it: the top of the chart when the files don't name one.</summary>
    public string CompanyName { get; private set; } = string.Empty;
    public Guid StartedByUserId { get; private set; }
    public string StartedByDisplayName { get; private set; } = string.Empty;
    public string DecisionsJson { get; private set; } = "{}";
    /// <summary>The fingerprint of the proposal the person asked to bring in; the worker brings in only that.</summary>
    public string? RequestedFingerprint { get; private set; }
    public Guid? BringInByUserId { get; private set; }
    public string? BringInByDisplayName { get; private set; }
    public DateTime? BringInRequestedAt { get; private set; }
    public DateTime? LockedAt { get; private set; }
    public string? LockedBy { get; private set; }
    /// <summary>Why the last bring-in didn't happen, in words for the person. Nothing was written.</summary>
    public string? LastFailure { get; private set; }
    public DateTime? BroughtInAt { get; private set; }
    public string? ResultJson { get; private set; }
    public string? ProvenanceJson { get; private set; }
    public IReadOnlyList<CompanyImportSource> Sources => sources;

    public static CompanyImportSession Start(Guid tenantId, string? companyName, ImportActor actor)
    {
        if (tenantId == Guid.Empty) throw new ArgumentException("Tenant is required.", nameof(tenantId));
        var who = actor.Normalize();
        var name = Domain.Entities.CatalogName.Clean(companyName);
        return new CompanyImportSession
        {
            TenantId = tenantId,
            CompanyName = name.Length is > 0 and <= 150 ? name : "Company",
            Status = CompanyImportStatus.Open,
            StartedByUserId = who.UserId,
            StartedByDisplayName = who.DisplayName,
            CreatedBy = who.DisplayName,
        };
    }

    public CompanyImportDecisions Decisions
        => CompanyImportJson.Read<CompanyImportDecisions>(DecisionsJson) is { } read
            ? new(read.Columns ?? [], read.Answers ?? [], read.Fixes ?? [])
            : CompanyImportDecisions.Empty;

    public void AddSource(CompanyImportSource source)
    {
        EnsureOpen();
        sources.Add(source);
        Touch();
    }

    public void RemoveFile(Guid fileId)
    {
        EnsureOpen();
        sources.RemoveAll(source => source.FileId == fileId);
        // Answers about a file that is gone no longer mean anything.
        SetDecisions(Decisions.WithoutFile(fileId));
    }

    public void SetDecisions(CompanyImportDecisions decisions)
    {
        EnsureOpen();
        DecisionsJson = CompanyImportJson.Write(decisions);
        LastFailure = null;
        Touch();
    }

    public void RequestBringIn(string fingerprint, ImportActor actor)
    {
        EnsureOpen();
        var who = actor.Normalize();
        Status = CompanyImportStatus.BringingIn;
        RequestedFingerprint = fingerprint;
        BringInByUserId = who.UserId;
        BringInByDisplayName = who.DisplayName;
        BringInRequestedAt = DateTime.UtcNow;
        LockedAt = null;
        LockedBy = null;
        LastFailure = null;
        Touch();
    }

    public void Lock(string instance)
    {
        LockedAt = DateTime.UtcNow;
        LockedBy = instance;
    }

    /// <summary>Nothing was written: the import opens again where the person left it, with the reason.</summary>
    public void FailBringIn(string reason)
    {
        if (Status != CompanyImportStatus.BringingIn) return;
        Status = CompanyImportStatus.Open;
        LastFailure = reason;
        LockedAt = null;
        LockedBy = null;
        Touch();
    }

    public void CompleteBringIn(string resultJson, string provenanceJson)
    {
        if (Status != CompanyImportStatus.BringingIn) throw new InvalidOperationException("Only an import being brought in can complete.");
        Status = CompanyImportStatus.BroughtIn;
        BroughtInAt = DateTime.UtcNow;
        ResultJson = resultJson;
        ProvenanceJson = provenanceJson;
        LockedAt = null;
        LockedBy = null;
        foreach (var source in sources) source.PurgeCells();
        Touch();
    }

    public bool Discard()
    {
        if (Status is not CompanyImportStatus.Open) return false;
        Status = CompanyImportStatus.Discarded;
        foreach (var source in sources) source.PurgeCells();
        Touch();
        return true;
    }

    private void EnsureOpen()
    {
        if (Status != CompanyImportStatus.Open) throw new CompanyImportException("ImportClosed", "This import can't be changed any more.", 409);
    }

    private void Touch() => UpdatedAt = DateTime.UtcNow;
}

/// <summary>
/// One sheet of one dropped file, with what Fusion read in it. A workbook gives one source per sheet; sheets that hold
/// neither people nor units are kept without their cells so the person sees they were left out.
/// </summary>
public sealed class CompanyImportSource : BaseEntity, ITenantEntity
{
    private CompanyImportSource() { }

    public Guid TenantId { get; private set; }
    public Guid SessionId { get; private set; }
    /// <summary>Groups the sheets of one dropped file.</summary>
    public Guid FileId { get; private set; }
    public string FileName { get; private set; } = string.Empty;
    public string Format { get; private set; } = string.Empty;
    public string Sha256 { get; private set; } = string.Empty;
    public long ByteLength { get; private set; }
    public int Order { get; private set; }
    public string SheetName { get; private set; } = string.Empty;
    public CompanyImportKind Kind { get; private set; }
    public int RowCount { get; private set; }
    public string ReadingsJson { get; private set; } = "[]";
    public string? CellsJson { get; private set; }
    public DateTime? CellsPurgedAt { get; private set; }

    public static CompanyImportSource Create(
        Guid tenantId, Guid sessionId, Guid fileId, string fileName, string format, string sha256, long byteLength, int order,
        string sheetName, CompanyImportKind kind, IReadOnlyList<CompanyImportColumnReading> readings,
        IReadOnlyList<IReadOnlyList<string?>>? rows, int rowCount)
        => new()
        {
            TenantId = tenantId,
            SessionId = sessionId,
            FileId = fileId,
            FileName = fileName,
            Format = format,
            Sha256 = sha256,
            ByteLength = byteLength,
            Order = order,
            SheetName = sheetName,
            Kind = kind,
            RowCount = rowCount,
            ReadingsJson = CompanyImportJson.Write(readings),
            CellsJson = rows is null ? null : CompanyImportJson.Write(rows),
        };

    public IReadOnlyList<CompanyImportColumnReading> Readings
        => CompanyImportJson.Read<List<CompanyImportColumnReading>>(ReadingsJson) ?? [];

    public IReadOnlyList<IReadOnlyList<string?>> Rows
        => CompanyImportJson.Read<List<List<string?>>>(CellsJson)?.Select(row => (IReadOnlyList<string?>)row).ToList() ?? [];

    public void PurgeCells()
    {
        if (CellsJson is null) return;
        CellsJson = null;
        CellsPurgedAt = DateTime.UtcNow;
        UpdatedAt = CellsPurgedAt;
    }
}

/// <summary>A column as Fusion read it: the field (or null), how Fusion came to it, and a masked sample for the AI.</summary>
public sealed record CompanyImportColumnReading(int Index, string? Header, string? Field, CompanyImportReadingOrigin Origin);

/// <summary>The person's answers and fixes, the only state an import keeps besides its files.</summary>
public sealed record CompanyImportDecisions(
    Dictionary<string, string> Columns,
    Dictionary<string, string> Answers,
    List<CompanyImportFix> Fixes)
{
    public static CompanyImportDecisions Empty => new([], [], []);

    public static string ColumnKey(Guid fileId, string sheet, int index) => $"{fileId:N}|{sheet}|{index}";

    public CompanyImportDecisions WithoutFile(Guid fileId)
    {
        var prefix = $"{fileId:N}|";
        return new(
            Columns.Where(item => !item.Key.StartsWith(prefix, StringComparison.Ordinal)).ToDictionary(),
            [],
            [.. Fixes]);
    }
}

/// <summary>A fix the person said in words: one field of one person, recorded beside what the file said.</summary>
public sealed record CompanyImportFix(string Id, string PersonKey, string Field, string Value, string Text);

public sealed class CompanyImportException(string code, string message, int status = 422) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

internal static class CompanyImportJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);

    public static T? Read<T>(string? json) => string.IsNullOrWhiteSpace(json) ? default : JsonSerializer.Deserialize<T>(json, Options);
}
