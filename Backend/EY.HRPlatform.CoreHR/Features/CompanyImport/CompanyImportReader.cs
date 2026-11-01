using EY.HRPlatform.CoreHR.Infrastructure.Imports;

namespace EY.HRPlatform.CoreHR.Features.CompanyImport;

/// <summary>A sheet of a dropped file as Fusion read it, before it joins an import.</summary>
public sealed record CompanyImportReadSheet(
    string SheetName, CompanyImportKind Kind, IReadOnlyList<CompanyImportColumnReading> Readings,
    IReadOnlyList<IReadOnlyList<string?>> Rows);

/// <summary>A dropped file as read; Problem says why Fusion couldn't use it at all (then it has no sheets).</summary>
public sealed record CompanyImportReadFile(
    string FileName, string Format, string Sha256, long ByteLength, IReadOnlyList<CompanyImportReadSheet> Sheets, string? Problem = null);

/// <summary>
/// Reads one dropped file: every usable sheet, recognised by what its headers hold, each column read by the rules
/// and, for headers the rules don't know, by the AI within its budget. A step opens only once this is done (D-23).
/// </summary>
public sealed class CompanyImportReader(ISafeTabularSourceReader reader, ICompanyImportAi ai)
{
    public async Task<CompanyImportReadFile> ReadAsync(Stream stream, string fileName, string? contentType, CancellationToken cancellationToken)
    {
        TabularSourceInspection inspection;
        try { inspection = await reader.InspectAsync(stream, fileName, contentType, null, cancellationToken); }
        catch (TabularSourceException exception) { return Unusable(fileName, Problem(exception.Code)); }

        var sheets = new List<CompanyImportReadSheet>();
        foreach (var sheet in inspection.UsableSheets)
        {
            var headers = sheet.Table.Columns.Select(column => column.Label).ToList();
            var kind = CompanyImportFields.Recognise(headers);
            var readings = kind == CompanyImportKind.Unknown
                ? ReadByRules(CompanyImportKind.People, sheet.Table, out _)
                : await ReadAsync(kind, sheet.Table, cancellationToken);
            sheets.Add(new CompanyImportReadSheet(sheet.Name, kind, readings, sheet.Table.Rows));
        }
        if (sheets.Count == 0) return Unusable(inspection.FileName, "empty");
        return new CompanyImportReadFile(inspection.FileName, inspection.Format, inspection.Sha256, inspection.ByteLength, sheets);
    }

    /// <summary>What's wrong with a file, in one of the few ways the person can act on.</summary>
    public static string Problem(string code) => code switch
    {
        "UnsupportedFormat" or "SignatureMismatch" => "format",
        "Empty" or "NoUsableTable" => "empty",
        "FileTooLarge" or "RowLimitExceeded" or "ColumnLimitExceeded" or "TextLimitExceeded" or "CellLimitExceeded" => "tooBig",
        _ => "unreadable",
    };

    private static CompanyImportReadFile Unusable(string fileName, string problem)
    {
        var name = Path.GetFileName(fileName.Trim());
        return new(name.Length is > 0 and <= 255 ? name : "file", string.Empty, string.Empty, 0, [], problem);
    }

    private async Task<IReadOnlyList<CompanyImportColumnReading>> ReadAsync(CompanyImportKind kind, TabularSourceTable table, CancellationToken cancellationToken)
    {
        var readings = ReadByRules(kind, table, out var unknown).ToList();
        if (unknown.Count == 0) return readings;
        var taken = readings.Where(reading => reading.Field is not null).Select(reading => reading.Field!).ToHashSet(StringComparer.Ordinal);
        var columns = unknown.Select(index => Evidence(index, readings[index].Header ?? string.Empty, table)).ToList();
        var answers = await ai.ReadColumnsAsync(kind, columns, taken, cancellationToken);
        foreach (var (index, field) in answers)
            if (field == CompanyImportFields.Out || taken.Add(field))
                readings[index] = readings[index] with { Field = field, Origin = CompanyImportReadingOrigin.Ai };
        return readings;
    }

    /// <summary>The rules' reading. A field goes to one column only: the fullest; empty columns take none.</summary>
    public static IReadOnlyList<CompanyImportColumnReading> ReadByRules(CompanyImportKind kind, TabularSourceTable table, out List<int> unknown)
    {
        var readings = new List<CompanyImportColumnReading>();
        unknown = [];
        foreach (var column in table.Columns)
        {
            var filled = table.Rows.Count(row => !string.IsNullOrWhiteSpace(Cell(row, column.Index)));
            if (filled == 0)
            {
                readings.Add(new(column.Index, column.Label, null, CompanyImportReadingOrigin.Empty));
                continue;
            }
            var read = CompanyImportFields.Read(kind, column.Label);
            if (read is null)
            {
                readings.Add(new(column.Index, column.Label, null, CompanyImportReadingOrigin.Unknown));
                unknown.Add(column.Index);
            }
            else readings.Add(new(column.Index, column.Label, read.Value.Field, read.Value.Origin));
        }
        // Strong readings win a field over weak ones, then the fuller column.
        var shared = readings.Where(reading => reading.Field is not null and not CompanyImportFields.Out)
            .GroupBy(reading => reading.Field).Where(group => group.Count() > 1).Select(group => group.ToList()).ToList();
        foreach (var group in shared)
        {
            var keep = group.OrderBy(reading => reading.Origin == CompanyImportReadingOrigin.Rules ? 0 : 1)
                .ThenByDescending(reading => table.Rows.Count(row => !string.IsNullOrWhiteSpace(Cell(row, reading.Index)))).First();
            foreach (var other in group.Where(reading => reading != keep))
            {
                var at = readings.IndexOf(other);
                readings[at] = other with { Field = null, Origin = CompanyImportReadingOrigin.Unknown };
                unknown.Add(other.Index);
            }
        }
        return readings;
    }

    private static CompanyImportAiColumn Evidence(int index, string header, TabularSourceTable table)
    {
        var values = table.Rows.Select(row => Cell(row, index)).Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!.Trim()).ToList();
        var fill = table.Rows.Count == 0 ? 0 : (double)values.Count / table.Rows.Count;
        var distinct = values.Count == 0 ? 0 : (double)values.Distinct(StringComparer.OrdinalIgnoreCase).Count() / values.Count;
        var shapes = values.Select(CompanyImportAi.Shape).Distinct(StringComparer.Ordinal).Take(4).ToList();
        return new CompanyImportAiColumn(index, header, fill, distinct, shapes);
    }

    public static string? Cell(IReadOnlyList<string?> row, int index) => index < row.Count ? row[index] : null;
}
