using System.Globalization;
using System.Text;
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using EY.HRPlatform.CoreHR.Domain.Entities;
using EY.HRPlatform.CoreHR.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EY.HRPlatform.CoreHR.Features.People;

public enum PeopleExportFormat
{
    Csv,
    Xlsx
}

public sealed record PeopleExportFile(byte[] Bytes, string ContentType, string FileName);

/// <summary>
/// People as filtered, in a file (D-13). The rows come from the same query as the table, so the file holds exactly
/// who the viewer sees; sign-in only when they may see Fusion access.
/// </summary>
public sealed class PeopleExport(CoreHRDbContext dbContext)
{
    public async Task<PeopleExportFile> BuildAsync(
        IReadOnlyList<PeopleRowDto> rows, bool includeSignIn, PeopleExportFormat format, CancellationToken cancellationToken)
    {
        var fields = await dbContext.EmployeeFieldDefinitions.AsNoTracking()
            .Where(item => item.IsActive && item.Visible && item.SourceKey == null && item.Type != EmployeeFieldType.Section)
            .OrderBy(item => item.Area).ThenBy(item => item.SortOrder)
            .ToListAsync(cancellationToken);
        var keys = rows.Select(row => row.EmployeeKey).ToList();
        var ids = await dbContext.Employees.AsNoTracking()
            .Where(employee => keys.Contains(employee.StableEmployeeKey))
            .ToDictionaryAsync(employee => employee.StableEmployeeKey, employee => employee.Id, cancellationToken);
        var fieldIds = fields.Select(item => item.Id).ToList();
        var employeeIds = ids.Values.ToList();
        var values = fieldIds.Count == 0
            ? []
            : await dbContext.EmployeeFieldValues.AsNoTracking()
                .Where(item => fieldIds.Contains(item.FieldId) && employeeIds.Contains(item.EmployeeId))
                .ToDictionaryAsync(item => (item.EmployeeId, item.FieldId), item => item.ValueJson, cancellationToken);

        var headers = new List<string>
        {
            "Name", "Employee number", "Work email", "Job", "Unit", "Place", "Manager", "First day", "Last day", "Status",
        };
        if (includeSignIn) headers.Add("Sign-in");
        headers.AddRange(fields.Select(field => field.Label));

        var table = rows.Select(row =>
        {
            var cells = new List<string>
            {
                row.DisplayName,
                row.EmployeeNumber,
                row.WorkEmail ?? "",
                row.Work?.JobTitle ?? "",
                row.Work?.OrganizationName ?? "",
                row.Work?.Location ?? "",
                row.PrimaryManager?.DisplayName ?? "",
                Day(row.EmploymentStart),
                Day(row.EmploymentEnd),
                Status(row.EmploymentState),
            };
            if (includeSignIn) cells.Add(SignIn(row.SignIn));
            foreach (var field in fields)
                cells.Add(ids.TryGetValue(row.EmployeeKey, out var id) && values.TryGetValue((id, field.Id), out var json) ? Value(json) : "");
            return cells;
        }).ToList();

        var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        return format == PeopleExportFormat.Xlsx
            ? new PeopleExportFile(Xlsx(headers, table),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"People {stamp}.xlsx")
            : new PeopleExportFile(Csv(headers, table), "text/csv; charset=utf-8", $"People {stamp}.csv");
    }

    private static string Day(DateTime? value) => value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "";

    private static string Status(PeopleEmploymentState state) => state switch
    {
        PeopleEmploymentState.Scheduled => "Starting",
        PeopleEmploymentState.Former => "Left",
        PeopleEmploymentState.Incomplete => "Incomplete",
        _ => "Active",
    };

    private static string SignIn(PeopleSignInDto? signIn) => signIn?.State switch
    {
        PeopleSignInState.SignsIn => "Signs in",
        PeopleSignInState.Invited => "Invited",
        PeopleSignInState.Expired => "Invitation expired",
        PeopleSignInState.NoEmail => "No work email",
        PeopleSignInState.Suspended => "Suspended",
        PeopleSignInState.NotInvited => "Not invited",
        _ => "",
    };

    private static string Value(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            return root.ValueKind switch
            {
                JsonValueKind.String => root.GetString() ?? "",
                JsonValueKind.Array => string.Join(", ", root.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())),
                JsonValueKind.Object => string.Join(", ", root.EnumerateObject()
                    .Where(item => item.Value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.Value.GetString()))
                    .Select(item => item.Value.GetString())),
                JsonValueKind.Null or JsonValueKind.Undefined => "",
                _ => root.ToString(),
            };
        }
        catch (JsonException)
        {
            return "";
        }
    }

    /// <summary>A cell that starts like a formula is written as text, so opening the file never runs it.</summary>
    internal static string Defused(string value)
        => value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + value : value;

    internal static byte[] Csv(IReadOnlyList<string> headers, IReadOnlyList<List<string>> rows)
    {
        var builder = new StringBuilder();
        void Line(IEnumerable<string> cells)
            => builder.Append(string.Join(",", cells.Select(cell => $"\"{Defused(cell).Replace("\"", "\"\"")}\""))).Append("\r\n");
        Line(headers);
        foreach (var row in rows) Line(row);
        // The byte-order mark lets Excel read accents and Arabic correctly.
        return Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(builder.ToString())).ToArray();
    }

    internal static byte[] Xlsx(IReadOnlyList<string> headers, IReadOnlyList<List<string>> rows)
    {
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, autoSave: true))
        {
            var workbookPart = document.AddWorkbookPart();
            workbookPart.Workbook = new Workbook();
            var stylesPart = workbookPart.AddNewPart<WorkbookStylesPart>();
            stylesPart.Stylesheet = new Stylesheet(
                new Fonts(new Font(), new Font(new Bold())),
                new Fills(new Fill(new PatternFill { PatternType = PatternValues.None }), new Fill(new PatternFill { PatternType = PatternValues.Gray125 })),
                new Borders(new Border()),
                new CellStyleFormats(new CellFormat()),
                new CellFormats(new CellFormat(), new CellFormat { FontId = 1, ApplyFont = true }));

            var data = new SheetData();
            data.Append(Row(1, headers, styleIndex: 1));
            for (var index = 0; index < rows.Count; index++)
                data.Append(Row((uint)index + 2, rows[index], styleIndex: 0));

            var worksheetPart = workbookPart.AddNewPart<WorksheetPart>();
            worksheetPart.Worksheet = new Worksheet(
                new SheetViews(new SheetView(
                    new Pane { VerticalSplit = 1D, TopLeftCell = "A2", ActivePane = PaneValues.BottomLeft, State = PaneStateValues.Frozen })
                { WorkbookViewId = 0 }),
                new Columns(Enumerable.Range(1, headers.Count)
                    .Select(index => new Column { Min = (uint)index, Max = (uint)index, Width = index == 1 ? 26 : 20, CustomWidth = true })),
                data);
            workbookPart.Workbook.AppendChild(new Sheets()).Append(new Sheet
            {
                Id = workbookPart.GetIdOfPart(worksheetPart),
                SheetId = 1,
                Name = "People",
            });
            workbookPart.Workbook.Save();
        }
        return stream.ToArray();
    }

    // Inline strings are never evaluated as formulas, so xlsx cells need no defusing.
    private static Row Row(uint index, IReadOnlyList<string> cells, uint styleIndex)
    {
        var row = new Row { RowIndex = index };
        for (var column = 0; column < cells.Count; column++)
            row.Append(new Cell
            {
                CellReference = $"{ColumnName(column + 1)}{index}",
                DataType = CellValues.InlineString,
                InlineString = new InlineString(new Text(cells[column])),
                StyleIndex = styleIndex,
            });
        return row;
    }

    private static string ColumnName(int column)
    {
        var result = string.Empty;
        while (column > 0)
        {
            column--;
            result = (char)('A' + column % 26) + result;
            column /= 26;
        }
        return result;
    }
}
