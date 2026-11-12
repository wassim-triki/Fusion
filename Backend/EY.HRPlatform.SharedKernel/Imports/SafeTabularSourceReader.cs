using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using CsvHelper;
using CsvHelper.Configuration;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Microsoft.AspNetCore.Http;

namespace EY.HRPlatform.SharedKernel.Imports;

/// <summary>
/// Domain-neutral safe reader for CSV/XLSX tabular sources. Bounded read,
/// signature/extension consistency, strict UTF-8 CSV decoding, OpenXML read,
/// zip-bomb/package-entry limits, macro/OLE/embed/external-link rejection,
/// formula non-execution, visible-sheet enumeration, row/column/cell limits,
/// SHA-256, and a retained-text bound. Returns only technical tabular data.
/// The safety mechanics here are extracted from the proven Organization Import
/// source inspection and must remain behavior-equivalent for that consumer.
/// </summary>
public sealed class SafeTabularSourceReader : ISafeTabularSourceReader
{
    public const int MaxFileBytes = 10 * 1024 * 1024;
    private const int MaxRows = 10_000;
    private const int MaxColumns = 256;
    private const int MaxCellCharacters = 32_767;
    private const int MaxRetainedTextBytes = 25 * 1024 * 1024;
    private const int MaxPackageEntries = 1_024;
    private const long MaxExpandedBytes = 100L * 1024 * 1024;
    private const long MaxEntryBytes = 50L * 1024 * 1024;
    private const double MaxCompressionRatio = 100d;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public async Task<TabularSourceInspection> InspectAsync(
        Stream stream,
        string fileName,
        string? contentType,
        string? selectedSheetName,
        CancellationToken cancellationToken)
    {
        var safeName = SanitizeFileName(fileName);
        var extension = Path.GetExtension(safeName).ToLowerInvariant();
        if (extension is not (".csv" or ".xlsx"))
            throw Rejected("UnsupportedFormat", "Choose a CSV or XLSX file.");

        var bytes = await ReadBoundedAsync(stream, cancellationToken);
        if (bytes.Length == 0) throw Rejected("Empty", "The selected file is empty.");
        var sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes));

        try
        {
            return extension == ".csv"
                ? InspectCsv(bytes, safeName, contentType, sha256)
                : InspectWorkbook(bytes, safeName, contentType, sha256, selectedSheetName);
        }
        catch (TabularSourceException)
        {
            throw;
        }
        catch (OpenXmlPackageException)
        {
            throw Rejected("Unreadable", "Fusion could not read this workbook.");
        }
        catch (InvalidDataException)
        {
            throw Rejected("Unreadable", "Fusion could not read this file.");
        }
        catch (CsvHelperException)
        {
            throw Rejected("Unreadable", "Fusion could not read this CSV.");
        }
        catch (DecoderFallbackException)
        {
            throw Rejected("Unreadable", "Fusion could not read this CSV as UTF-8 text.");
        }
    }

    private static TabularSourceInspection InspectCsv(
        byte[] bytes,
        string fileName,
        string? contentType,
        string sha256)
    {
        if (LooksLikeZip(bytes) || LooksLikeCompoundFile(bytes))
            throw Rejected("SignatureMismatch", "The file contents do not match its CSV extension.");

        var text = StrictUtf8.GetString(bytes);
        using var reader = new StringReader(text);
        var configuration = new CsvConfiguration(CultureInfo.InvariantCulture)
        {
            DetectDelimiter = true,
            DetectDelimiterValues = [",", ";", "\t"],
            BadDataFound = _ => throw Rejected("Unreadable", "Fusion could not read this CSV."),
            MissingFieldFound = null,
            TrimOptions = TrimOptions.None,
        };
        using var csv = new CsvReader(reader, configuration);
        var records = new List<(int RowNumber, IReadOnlyList<string?> Cells)>();
        var rowNumber = 0;
        while (csv.Read())
        {
            rowNumber++;
            var cells = (csv.Parser.Record ?? []).Select(NormalizeCell).ToArray();
            if (cells.Length > MaxColumns) throw Rejected("ColumnLimitExceeded", "The file has more than 256 columns.");
            if (cells.Any(value => value is not null)) records.Add((rowNumber, cells));
            if (records.Count > MaxRows + 1) throw Rejected("RowLimitExceeded", "The file has more than 10,000 data rows.");
        }

        var table = BuildTable(records);
        EnsureRetainedTextBound(table);
        var sheet = new TabularSourceSheet(
            "CSV",
            $"A{records[0].RowNumber}:{ColumnName(table.Columns.Count)}{records[^1].RowNumber}",
            table,
            table.Rows.Count,
            table.Columns.Count);
        return new TabularSourceInspection(
            fileName,
            "csv",
            NormalizeContentType(contentType, "text/csv"),
            sha256,
            bytes.LongLength,
            [sheet],
            sheet,
            bytes);
    }

    private static TabularSourceInspection InspectWorkbook(
        byte[] bytes,
        string fileName,
        string? contentType,
        string sha256,
        string? selectedSheetName)
    {
        if (LooksLikeCompoundFile(bytes))
            throw Rejected("PasswordProtected", "Password-protected workbooks are not supported.");
        if (!LooksLikeZip(bytes))
            throw Rejected("SignatureMismatch", "The file contents do not match its XLSX extension.");

        PreflightPackage(bytes);
        using var stream = new MemoryStream(bytes, writable: false);
        using var document = SpreadsheetDocument.Open(stream, false, new OpenSettings { AutoSave = false });
        var workbookPart = document.WorkbookPart ?? throw Rejected("Unreadable", "Fusion could not read this workbook.");
        var workbook = workbookPart.Workbook ?? throw Rejected("Unreadable", "Fusion could not read this workbook.");
        RejectUnsafeRelationships(workbookPart);
        var sharedStrings = ReadSharedStrings(workbookPart.SharedStringTablePart);
        var dateStyles = LoadDateStyleIndices(workbookPart.WorkbookStylesPart);
        var candidates = new List<TabularSourceSheet>();

        var sheets = workbook.Sheets?.Elements<Sheet>() ?? Enumerable.Empty<Sheet>();
        foreach (var sheet in sheets)
        {
            if (sheet.State?.Value == SheetStateValues.Hidden || sheet.State?.Value == SheetStateValues.VeryHidden) continue;
            if (sheet.Id?.Value is not string relationshipId || string.IsNullOrWhiteSpace(sheet.Name?.Value)) continue;
            if (workbookPart.GetPartById(relationshipId) is not WorksheetPart worksheetPart) continue;
            var inspected = ReadWorksheet(worksheetPart, sharedStrings, dateStyles);
            if (inspected is not null)
            {
                candidates.Add(new TabularSourceSheet(
                    sheet.Name!.Value!,
                    inspected.Value.Range,
                    inspected.Value.Table,
                    inspected.Value.Table.Rows.Count,
                    inspected.Value.Table.Columns.Count));
            }
        }

        if (candidates.Count == 0) throw Rejected("NoUsableTable", "The workbook does not contain a usable visible table.");

        TabularSourceSheet? selected;
        if (selectedSheetName is not null)
        {
            selected = candidates.FirstOrDefault(candidate => candidate.Name.Equals(selectedSheetName, StringComparison.Ordinal));
            if (selected is null) throw Rejected("InvalidSheetSelection", "Choose one of the available worksheets.");
        }
        else
        {
            // A single usable sheet is selected automatically. When several remain, the
            // reader defers selection to the caller (SelectedSheet is null) rather than
            // guessing — a domain adapter may still recognize a native template among the
            // surfaced candidates.
            selected = candidates.Count == 1 ? candidates[0] : null;
        }

        if (selected is not null) EnsureRetainedTextBound(selected.Table);

        return new TabularSourceInspection(
            fileName,
            "xlsx",
            NormalizeContentType(contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            sha256,
            bytes.LongLength,
            candidates,
            selected,
            bytes);
    }

    private static (TabularSourceTable Table, string Range)? ReadWorksheet(
        WorksheetPart worksheetPart,
        IReadOnlyList<string> sharedStrings,
        IReadOnlySet<int> dateStyles)
    {
        var records = new List<(int RowNumber, IReadOnlyList<string?> Cells)>();
        using var reader = OpenXmlReader.Create(worksheetPart);
        while (reader.Read())
        {
            if (reader.ElementType != typeof(Row) || !reader.IsStartElement) continue;
            if (reader.LoadCurrentElement() is not Row row) continue;
            var rowNumber = checked((int)(row.RowIndex?.Value ?? (uint)(records.Count + 1)));
            var cells = new List<string?>();
            var fallbackColumn = 0;
            foreach (var cell in row.Elements<Cell>())
            {
                var index = CellColumnIndex(cell.CellReference?.Value) ?? fallbackColumn;
                if (index >= MaxColumns) throw Rejected("ColumnLimitExceeded", "The file has more than 256 columns.");
                while (cells.Count <= index) cells.Add(null);
                cells[index] = ReadCell(cell, sharedStrings, dateStyles);
                fallbackColumn = index + 1;
            }

            while (cells.Count > 0 && cells[^1] is null) cells.RemoveAt(cells.Count - 1);
            if (cells.Any(value => value is not null)) records.Add((rowNumber, cells));
            if (records.Count > MaxRows + 1) throw Rejected("RowLimitExceeded", "The file has more than 10,000 data rows.");
        }

        if (records.Count < 2) return null;
        TabularSourceTable table;
        try { table = BuildTable(records); }
        catch (TabularSourceException exception) when (exception.Code is "Empty" or "NoUsableTable") { return null; }
        return (table, $"A{records[0].RowNumber}:{ColumnName(table.Columns.Count)}{records[^1].RowNumber}");
    }

    private static TabularSourceTable BuildTable(IReadOnlyList<(int RowNumber, IReadOnlyList<string?> Cells)> records)
    {
        if (records.Count < 2) throw Rejected("Empty", "The file needs a label row and at least one data row.");
        var width = records.Max(record => record.Cells.Count);
        if (width == 0 || !records[0].Cells.Any(value => !string.IsNullOrWhiteSpace(value)))
            throw Rejected("NoUsableTable", "The source label row needs at least one label.");
        if (width > MaxColumns) throw Rejected("ColumnLimitExceeded", "The file has more than 256 columns.");
        var columns = Enumerable.Range(0, width)
            .Select(index => new TabularSourceColumn(index, index < records[0].Cells.Count ? records[0].Cells[index] : null))
            .ToList();
        var rows = records.Skip(1).Select(record =>
            (IReadOnlyList<string?>)Enumerable.Range(0, width)
                .Select(index => index < record.Cells.Count ? record.Cells[index] : null)
                .ToList()).ToList();
        if (rows.Count > MaxRows) throw Rejected("RowLimitExceeded", "The file has more than 10,000 data rows.");
        return new TabularSourceTable(columns, rows);
    }

    private static string? ReadCell(Cell cell, IReadOnlyList<string> sharedStrings, IReadOnlySet<int> dateStyles)
    {
        string? raw;
        if (cell.CellFormula is not null)
        {
            var formula = cell.CellFormula.Text;
            if (formula.Contains('|') && formula.Contains('!'))
                throw Rejected("UnsafeWorkbookContent", "The workbook contains unsupported active or external content.");
            raw = ConvertNumericCell(cell, cell.CellValue?.Text, dateStyles);
        }
        else if (cell.DataType?.Value == CellValues.SharedString)
        {
            raw = int.TryParse(cell.CellValue?.Text, out var index) && index >= 0 && index < sharedStrings.Count
                ? sharedStrings[index]
                : null;
        }
        else if (cell.DataType?.Value == CellValues.InlineString)
        {
            raw = cell.InlineString?.InnerText;
        }
        else if (cell.DataType?.Value == CellValues.Boolean)
        {
            raw = cell.CellValue?.Text == "1" ? "TRUE" : cell.CellValue?.Text == "0" ? "FALSE" : null;
        }
        else
        {
            // A number cell with no explicit DataType. If its style is a date format, apply
            // workbook date semantics and surface an unambiguous ISO date so interpretation never
            // sees a raw serial. Non-date numbers and text (leading zeroes preserved) pass through.
            raw = ConvertNumericCell(cell, cell.CellValue?.Text, dateStyles);
        }
        return NormalizeCell(raw);
    }

    private static string? ConvertNumericCell(Cell cell, string? value, IReadOnlySet<int> dateStyles)
    {
        if (value is null) return null;
        var styleIndex = cell.StyleIndex is not null ? checked((int)cell.StyleIndex.Value) : 0;
        if (!dateStyles.Contains(styleIndex)) return value;
        if (!double.TryParse(value, System.Globalization.NumberStyles.Any, CultureInfo.InvariantCulture, out var serial)) return value;
        // Excel serial dates are day counts from 1899-12-30 (accounting for the 1900 leap bug).
        try { return DateTime.FromOADate(serial).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
        catch (ArgumentException) { return value; }
    }

    private static IReadOnlySet<int> LoadDateStyleIndices(WorkbookStylesPart? stylesPart)
    {
        var dateStyles = new HashSet<int>();
        var cellFormats = stylesPart?.Stylesheet?.CellFormats;
        if (cellFormats is null) return dateStyles;

        // Map custom number-format ids to their format code so we can detect date tokens.
        var customFormats = new Dictionary<uint, string>();
        if (stylesPart!.Stylesheet.NumberingFormats is { } numberingFormats)
            foreach (var format in numberingFormats.Elements<NumberingFormat>())
                if (format.NumberFormatId?.Value is uint id && format.FormatCode?.Value is string code)
                    customFormats[id] = code;

        var styleIndex = 0;
        foreach (var cellFormat in cellFormats.Elements<CellFormat>())
        {
            var numberFormatId = cellFormat.NumberFormatId?.Value ?? 0;
            if (IsDateNumberFormat(numberFormatId, customFormats)) dateStyles.Add(styleIndex);
            styleIndex++;
        }
        return dateStyles;
    }

    private static bool IsDateNumberFormat(uint numberFormatId, IReadOnlyDictionary<uint, string> customFormats)
    {
        // Built-in date/datetime formats (excluding pure time formats 18-21, 45-47).
        if (numberFormatId is 14 or 15 or 16 or 17 or 22) return true;
        if (customFormats.TryGetValue(numberFormatId, out var code))
        {
            var lower = code.ToLowerInvariant();
            // Day or year token indicates a calendar date (avoid matching bare "m" minutes-only).
            return lower.Contains('d') || lower.Contains('y');
        }
        return false;
    }

    private static IReadOnlyList<string> ReadSharedStrings(SharedStringTablePart? part)
    {
        if (part is null) return [];
        var values = new List<string>();
        using var reader = OpenXmlReader.Create(part);
        while (reader.Read())
        {
            if (reader.ElementType == typeof(SharedStringItem) && reader.IsStartElement)
            {
                if (reader.LoadCurrentElement() is SharedStringItem item) values.Add(item.InnerText);
            }
        }
        return values;
    }

    private static void PreflightPackage(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false);
        if (archive.Entries.Count > MaxPackageEntries) throw Rejected("PackageLimitExceeded", "The workbook package is too complex.");
        long expanded = 0;
        foreach (var entry in archive.Entries)
        {
            expanded = checked(expanded + entry.Length);
            if (entry.Length > MaxEntryBytes || expanded > MaxExpandedBytes)
                throw Rejected("PackageLimitExceeded", "The expanded workbook is too large.");
            if (entry.Length > 0 && (entry.CompressedLength == 0 || entry.Length / (double)entry.CompressedLength > MaxCompressionRatio))
                throw Rejected("PackageLimitExceeded", "The workbook compression ratio is unsafe.");
            var name = entry.FullName.Replace('\\', '/').ToLowerInvariant();
            if (name.Contains("vbaproject") || name.Contains("/embeddings/") || name.Contains("/oleobjects/")
                || name.Contains("externallinks") || name.Contains("connections"))
                throw Rejected("UnsafeWorkbookContent", "The workbook contains unsupported active or external content.");
            if (name.EndsWith(".rels", StringComparison.Ordinal))
            {
                using var relReader = new StreamReader(entry.Open(), Encoding.UTF8, true, 1024, leaveOpen: false);
                var relationships = relReader.ReadToEnd();
                if (relationships.Contains("TargetMode=\"External\"", StringComparison.OrdinalIgnoreCase))
                    throw Rejected("UnsafeWorkbookContent", "The workbook contains unsupported active or external content.");
            }
        }
    }

    private static void RejectUnsafeRelationships(WorkbookPart workbookPart)
    {
        if (workbookPart.ExternalRelationships.Any() || workbookPart.HyperlinkRelationships.Any(relationship => relationship.IsExternal))
            throw Rejected("UnsafeWorkbookContent", "The workbook contains unsupported active or external content.");
        foreach (var part in workbookPart.Parts.Select(item => item.OpenXmlPart))
            if (part.ExternalRelationships.Any())
                throw Rejected("UnsafeWorkbookContent", "The workbook contains unsupported active or external content.");
    }

    private static async Task<byte[]> ReadBoundedAsync(Stream source, CancellationToken cancellationToken)
    {
        await using var target = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellationToken);
            if (read == 0) break;
            if (target.Length + read > MaxFileBytes)
                throw new TabularSourceException("FileTooLarge", "Choose a file smaller than 10 MB.", StatusCodes.Status413PayloadTooLarge);
            await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        return target.ToArray();
    }

    private static void EnsureRetainedTextBound(TabularSourceTable table)
    {
        long size = 0;
        foreach (var value in table.Columns.Select(column => column.Label).Concat(table.Rows.SelectMany(row => row)))
        {
            if (value is null) continue;
            size += Encoding.UTF8.GetByteCount(value);
            if (size > MaxRetainedTextBytes) throw Rejected("TextLimitExceeded", "The file contains too much source text.");
        }
    }

    private static string? NormalizeCell(string? value)
    {
        if (value is null) return null;
        if (value.Length > MaxCellCharacters) throw Rejected("CellLimitExceeded", "A cell exceeds the 32,767 character limit.");
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static string SanitizeFileName(string fileName)
    {
        var safe = Path.GetFileName(fileName).Trim();
        safe = new string(safe.Where(character => !char.IsControl(character)).ToArray());
        if (string.IsNullOrWhiteSpace(safe)) safe = "tabular-source";
        return safe[..Math.Min(safe.Length, 255)];
    }

    private static string NormalizeContentType(string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim()[..Math.Min(value.Trim().Length, 128)];

    private static bool LooksLikeZip(byte[] bytes)
        => bytes.Length >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B
            && bytes[2] is 0x03 or 0x05 or 0x07 && bytes[3] is 0x04 or 0x06 or 0x08;

    private static bool LooksLikeCompoundFile(byte[] bytes)
        => bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 });

    private static int? CellColumnIndex(string? reference)
    {
        if (string.IsNullOrWhiteSpace(reference)) return null;
        var value = 0;
        var consumed = false;
        foreach (var character in reference)
        {
            if (!char.IsLetter(character)) break;
            consumed = true;
            value = checked(value * 26 + char.ToUpperInvariant(character) - 'A' + 1);
        }
        return consumed ? value - 1 : null;
    }

    private static string ColumnName(int count)
    {
        var value = count;
        var result = string.Empty;
        while (value > 0)
        {
            value--;
            result = (char)('A' + value % 26) + result;
            value /= 26;
        }
        return result;
    }

    private static TabularSourceException Rejected(string code, string message)
        => new(code, message);
}
