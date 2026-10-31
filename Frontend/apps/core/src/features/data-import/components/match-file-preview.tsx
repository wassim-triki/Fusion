"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@repo/ds";

const ROW_LIMITS = [5, 10, 25] as const;

export type PreviewColumn = { key: string; label: string; nowrap?: boolean; strong?: boolean };
export type PreviewRow = { key: string | number; cells: React.ReactNode[] };

/** The file's first rows read through the current mapping, so the administrator sees what the matches mean. */
export function ImportFilePreview({
  columns,
  totalRows,
  buildRows,
  initialLimit = 5,
}: {
  columns: PreviewColumn[];
  totalRows: number;
  buildRows: (limit: number) => PreviewRow[];
  initialLimit?: number;
}) {
  const t = useTranslations("dataImport");
  const [limit, setLimit] = useState<number>(initialLimit);
  const rows = useMemo(() => buildRows(limit), [buildRows, limit]);
  const limits = ROW_LIMITS.filter((option, index) => index === 0 || totalRows > ROW_LIMITS[index - 1]!);

  return (
    <section aria-labelledby="match-preview-title" className="rounded-surface bg-card p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <FileSpreadsheet className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 id="match-preview-title" className="type-panel-title font-semibold text-foreground">
              {t("preview.title")}
            </h2>
            <p className="type-meta text-muted-foreground">{t("preview.description")}</p>
          </div>
        </div>
        {limits.length > 1 ? (
          <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
            <SelectTrigger aria-label={t("preview.rows")} className="shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {limits.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {t("preview.first", { count: option })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </header>

      <div className="mt-4 overflow-x-auto rounded-control border border-border">
        <table className="w-full min-w-[24rem] border-collapse text-start">
          <thead className="bg-inlay">
            <tr className="type-eyebrow text-muted-foreground">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="type-meta">
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                {row.cells.map((cell, index) => (
                  <td
                    key={columns[index]?.key ?? index}
                    className={cn(
                      "px-3 py-1.5 text-foreground",
                      columns[index]?.nowrap && "whitespace-nowrap",
                      columns[index]?.strong && "font-medium"
                    )}
                  >
                    {cell ?? <PreviewMissing />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PreviewMissing() {
  const t = useTranslations("dataImport");
  return (
    <span className="text-muted-foreground" aria-label={t("preview.none")}>
      —
    </span>
  );
}

/** A source term that has no Fusion meaning yet, shown as the file wrote it. */
export function PreviewUnmatched({ value }: { value: string }) {
  const t = useTranslations("dataImport");
  return (
    <span title={t("preview.unmatched")} className="inline-flex items-center gap-1.5 text-primary-foreground dark:text-primary">
      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
      {value}
      <span className="sr-only">{t("preview.unmatchedSr")}</span>
    </span>
  );
}
