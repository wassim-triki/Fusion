"use client";

import type { RowData } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "../icons";
import { useTranslations } from "next-intl";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { cn } from "../lib/utils";
import type { DataTableModel } from "./use-data-table";

type PageSlot = number | "gap-start" | "gap-end";

/**
 * Page buttons to show for `current` (0-based) of `count` pages: every page up to seven, otherwise the
 * first, the last, and the run around the current one, so the row never changes width as you page.
 */
export function getPageWindow(current: number, count: number): PageSlot[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  if (current <= 3) return [0, 1, 2, 3, 4, "gap-end", count - 1];
  if (current >= count - 4)
    return [
      0,
      "gap-start",
      count - 5,
      count - 4,
      count - 3,
      count - 2,
      count - 1,
    ];
  return [
    0,
    "gap-start",
    current - 1,
    current,
    current + 1,
    "gap-end",
    count - 1,
  ];
}

const DEFAULT_PAGE_SIZES = [5, 10, 25, 50];

/**
 * The table footer. Its anatomy is fixed so every Fusion table ends the same way: the range on the left,
 * then rows per page and the pager on the right. Controls stay in place and disable rather than
 * disappear, so the footer never changes shape between tables or as filters change.
 */
export function DataTablePagination<TData extends RowData>({
  model,
  noun,
  pageSizes = DEFAULT_PAGE_SIZES,
  className,
}: {
  model: DataTableModel<TData>;
  /** Singular and plural for the range line: "1–10 of 23 people". */
  noun?: [string, string];
  /** Rows-per-page choices; the table's own page size is always included. */
  pageSizes?: number[];
  className?: string;
}) {
  const t = useTranslations("ds.table");
  const { table } = model;
  const [one, many] = noun ?? [t("row"), t("rows")];
  const total = table.getRowCount();
  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = Math.max(1, table.getPageCount());
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const sizes = Array.from(new Set([...pageSizes, pageSize])).sort(
    (a, b) => a - b
  );

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2",
        className
      )}
    >
      <p className="text-sm tabular-nums text-muted-foreground">
        {t.rich("range", {
          from,
          to,
          total,
          noun: total === 1 ? one : many,
          strong: (chunks) => <span className="text-foreground">{chunks}</span>,
        })}
      </p>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{t("rowsPerPage")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("rowsPerPage")}
              className="tabular-nums"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {sizes.map((size) => (
                <SelectItem
                  key={size}
                  value={String(size)}
                  className="tabular-nums"
                >
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <nav aria-label={t("pagination")} className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("previousPage")}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft aria-hidden />
          </Button>
          {/* Narrow screens keep only the position; the numbered window returns from sm up. */}
          <span className="px-2 text-sm tabular-nums text-muted-foreground sm:hidden">
            <span className="font-medium text-primary-ink">{pageIndex + 1}</span> /{" "}
            {pageCount}
          </span>
          {getPageWindow(pageIndex, pageCount).map((slot) =>
            typeof slot === "number" ? (
              <Button
                key={slot}
                variant="ghost"
                size="icon-sm"
                aria-label={t("page", { page: slot + 1 })}
                aria-current={slot === pageIndex ? "page" : undefined}
                onClick={() => table.setPageIndex(slot)}
                className={cn(
                  "hidden tabular-nums sm:inline-flex",
                  slot === pageIndex &&
                    "bg-primary-tint font-semibold text-primary-ink hover:bg-primary-tint hover:text-primary-ink"
                )}
              >
                {slot + 1}
              </Button>
            ) : (
              <span
                key={slot}
                aria-hidden
                className="hidden w-7 text-center text-sm text-muted-foreground sm:inline"
              >
                …
              </span>
            )
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("nextPage")}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      </div>
    </div>
  );
}
