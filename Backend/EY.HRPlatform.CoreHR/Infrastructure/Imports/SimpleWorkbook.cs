using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;

namespace EY.HRPlatform.CoreHR.Infrastructure.Imports;

public sealed record SimpleSheet(string Name, IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<string?>> Rows);

/// <summary>A plain workbook: one sheet per entry, a bold frozen header row, text cells. The import reads it back.</summary>
public static class SimpleWorkbook
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public static byte[] Build(IReadOnlyList<SimpleSheet> sheets)
    {
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, autoSave: true))
        {
            var workbookPart = document.AddWorkbookPart();
            workbookPart.Workbook = new Workbook();
            workbookPart.AddNewPart<WorkbookStylesPart>().Stylesheet = new Stylesheet(
                new Fonts(new Font(), new Font(new Bold())),
                new Fills(new Fill(new PatternFill { PatternType = PatternValues.None }), new Fill(new PatternFill { PatternType = PatternValues.Gray125 })),
                new Borders(new Border()),
                new CellStyleFormats(new CellFormat()),
                new CellFormats(new CellFormat(), new CellFormat { FontId = 1, ApplyFont = true }));
            var list = workbookPart.Workbook.AppendChild(new Sheets());
            for (var i = 0; i < sheets.Count; i++)
            {
                var sheet = sheets[i];
                var part = workbookPart.AddNewPart<WorksheetPart>();
                var data = new SheetData();
                data.Append(RowOf(1, sheet.Headers.Select(header => (string?)header).ToList(), 1));
                for (var r = 0; r < sheet.Rows.Count; r++) data.Append(RowOf(r + 2, sheet.Rows[r], 0));
                part.Worksheet = new Worksheet(
                    new SheetViews(new SheetView(new Pane { VerticalSplit = 1D, TopLeftCell = "A2", ActivePane = PaneValues.BottomLeft, State = PaneStateValues.Frozen }) { WorkbookViewId = 0 }),
                    new Columns(sheet.Headers.Select((_, c) => new Column { Min = (uint)(c + 1), Max = (uint)(c + 1), Width = 22, CustomWidth = true })),
                    data);
                list.Append(new Sheet { Id = workbookPart.GetIdOfPart(part), SheetId = (uint)(i + 1), Name = sheet.Name });
            }
            workbookPart.Workbook.Save();
        }
        return stream.ToArray();
    }

    private static Row RowOf(int index, IReadOnlyList<string?> values, uint style)
    {
        var row = new Row { RowIndex = (uint)index };
        for (var c = 0; c < values.Count; c++)
            row.Append(new Cell
            {
                CellReference = $"{ColumnName(c + 1)}{index}",
                DataType = CellValues.InlineString,
                InlineString = new InlineString(new Text(values[c] ?? string.Empty)),
                StyleIndex = style,
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
