"use client";

import { useTranslations } from "next-intl";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@repo/ds";
import { cn } from "@repo/ds/lib/utils";
import { PEOPLE_FIELDS, UNIT_FIELDS, type CompanyImportDto, type CompanyImportField, type CompanyImportSheetDto, type ReadColumnDto } from "@repo/api";
import { AlertTriangle, Check } from "lucide-react";
import type { useImportChange } from "../api/use-company-import";
import { AiMark, useFieldLabel } from "./import-parts";

/**
 * The person's spreadsheet with Fusion's reading labelled over each column (D-22): sure readings ticked, the AI's
 * marked with a sparkle, half-recognised ones asked, left-out columns faded. Every label opens the meanings to pick.
 */
export function SheetView({ data, fileId, sheet, change }: { data: CompanyImportDto; fileId: string; sheet: CompanyImportSheetDto; change: ReturnType<typeof useImportChange> }) {
  const t = useTranslations("companyImport.sheet");
  const label = useFieldLabel();
  const fields = sheet.kind === "Units" ? UNIT_FIELDS : PEOPLE_FIELDS;
  const columns = sheet.columns;
  const faded = (column: ReadColumnDto) => column.state === "out" || column.state === "empty";
  const more = sheet.count - sheet.preview.length;

  const choose = (column: ReadColumnDto, field: CompanyImportField | null) =>
    void change.run("column", (api, version) => api.setColumn(data.id, version, { fileId, sheet: sheet.name, index: column.index, field }));

  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full min-w-max border-separate border-spacing-0 type-meta">
        <thead>
          <tr>
            <th className="w-9" />
            {columns.map((column) => (
              <th key={column.index} className={cn("h-[3.25rem] min-w-32 px-1.5 text-start align-middle font-normal", column.state === "ask" && "bg-warning/[0.07]")}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild disabled={change.pending !== null}>
                    <button type="button" className={chipClass(column)} aria-label={t("change", { header: column.header ?? "" })}>
                      <ChipBody column={column} label={label} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                    <DropdownMenuLabel>{t("what", { header: column.header ?? "" })}</DropdownMenuLabel>
                    {fields.map((field) => (
                      <DropdownMenuItem key={field} onSelect={() => choose(column, field)}>
                        {column.field === field ? <Check className="size-4" aria-hidden /> : <span className="size-4" />}
                        {label(field)}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => choose(column, "out")}>
                      {column.field === null && column.state === "out" ? <Check className="size-4" aria-hidden /> : <span className="size-4" />}
                      {t("leaveOut")}
                    </DropdownMenuItem>
                    {column.state === "person" ? <DropdownMenuItem onSelect={() => choose(column, null)}><span className="size-4" />{t("fusionsReading")}</DropdownMenuItem> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
            ))}
          </tr>
          <tr>
            <th className="h-[1.875rem] w-9 border-b border-border bg-inlay" />
            {columns.map((column) => (
              <th key={column.index} className={cn("h-[1.875rem] border-b border-s border-border bg-inlay px-2.5 text-start type-code font-normal text-muted-foreground", faded(column) && "opacity-50")}>
                {column.header ?? t("noHeader")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.preview.map((row) => (
            <tr key={row.row} className={row.me ? "bg-primary-tint" : undefined}>
              <td className="h-[2.125rem] w-9 border-b border-border text-center tabular-nums text-muted-foreground">{row.row}</td>
              {columns.map((column) => (
                <td key={column.index} className={cn("h-[2.125rem] max-w-56 truncate border-b border-s border-border px-2.5 text-foreground", faded(column) && "text-muted-foreground opacity-50", column.state === "ask" && "bg-warning/[0.07]")}>
                  {row.cells[column.index] || <span className="text-muted-foreground">—</span>}
                </td>
              ))}
            </tr>
          ))}
          {more > 0 ? (
            <tr>
              <td className="h-[2.125rem] w-9 text-center text-muted-foreground">…</td>
              <td colSpan={columns.length} className="px-2.5 text-muted-foreground">{t(`more.${sheet.kind === "Units" ? "Units" : "People"}`, { count: more })}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function chipClass(column: ReadColumnDto) {
  return cn(
    "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-control border px-2 py-1 text-start type-meta-strong transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    column.state === "ask" && "border-warning/60 text-warning",
    (column.state === "out" || column.state === "empty") && "border-dashed bg-transparent font-normal text-muted-foreground",
    !["ask", "out", "empty"].includes(column.state) && "border-border bg-inlay text-foreground",
  );
}

function ChipBody({ column, label }: { column: ReadColumnDto; label: (field: string) => string }) {
  const t = useTranslations("companyImport.sheet");
  if (column.state === "ask")
    return (
      <>
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{t("ask", { field: label(column.lean ?? "out") })}</span>
      </>
    );
  if (column.state === "out") return <span>{t("leftOut")}</span>;
  if (column.state === "empty") return <span>{t("empty")}</span>;
  if (column.state === "ai")
    return (
      <>
        <span className="truncate">{label(column.field ?? "out")}</span>
        <AiMark hint={t("aiRead", { header: column.header ?? "", field: label(column.field ?? "out").toLowerCase() })} />
      </>
    );
  return (
    <>
      <Check className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{label(column.field ?? "out")}</span>
    </>
  );
}
