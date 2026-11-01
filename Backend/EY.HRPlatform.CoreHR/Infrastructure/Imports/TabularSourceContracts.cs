namespace EY.HRPlatform.CoreHR.Infrastructure.Imports;

// Domain-neutral safe tabular source model. This layer knows nothing about people, units or business
// validation; the import reads what columns mean on top of it.

public sealed record TabularSourceColumn(int Index, string? Label);

public sealed record TabularSourceTable(
    IReadOnlyList<TabularSourceColumn> Columns,
    IReadOnlyList<IReadOnlyList<string?>> Rows);

public sealed record TabularSourceSheet(
    string Name,
    string Range,
    TabularSourceTable Table,
    int RowCount,
    int ColumnCount);

/// <summary>
/// Technical inspection of a safely-read tabular source. <see cref="SelectedSheet"/>
/// is non-null when the reader could select a single usable sheet (CSV, a single-sheet
/// workbook, or an explicit selection). When it is null the caller must choose one of
/// <see cref="UsableSheets"/>. All usable sheets are surfaced so a domain adapter can
/// apply its own selection heuristics (for example native-template recognition) without
/// the reader needing any domain knowledge.
/// </summary>
public sealed record TabularSourceInspection(
    string FileName,
    string Format,
    string ContentType,
    string Sha256,
    long ByteLength,
    IReadOnlyList<TabularSourceSheet> UsableSheets,
    TabularSourceSheet? SelectedSheet,
    byte[] RawBytes);

/// <summary>
/// Raised when a source cannot be read safely. Carries a stable machine code, a
/// user-safe message, and an HTTP status so each domain can map it to its own
/// domain-specific source error without duplicating the safety mechanics.
/// </summary>
public sealed class TabularSourceException(
    string code,
    string safeMessage,
    int statusCode = StatusCodes.Status422UnprocessableEntity) : Exception(safeMessage)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}

public interface ISafeTabularSourceReader
{
    Task<TabularSourceInspection> InspectAsync(
        Stream stream,
        string fileName,
        string? contentType,
        string? selectedSheetName,
        CancellationToken cancellationToken);
}
