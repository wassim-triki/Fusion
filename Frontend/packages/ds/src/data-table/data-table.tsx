"use client";

import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { Column, RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableFilters } from "./data-table-filters";
import { DataTableSearch } from "./data-table-toolbar";
import type { DataTableColumnMeta, DataTableFeatures } from "./features";
import type { DataTableModel } from "./use-data-table";

/*
 * One grid for every Fusion table. Toolbar, header, rows and footer share the same horizontal inset
 * (px-4), so the first column's text, the search field and the range line all start on one edge.
 * Heights are fixed per band — toolbar 56, header 40, rows 56, footer 48 — so tables line up with each
 * other no matter how much a cell holds.
 */
const INSET = "px-4";
const ALIGN_TEXT = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
} as const;
const ALIGN_FLEX = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
} as const;
// Spelled out so Tailwind sees every class.
const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;
const HIDE_COL_BELOW = {
  sm: "hidden sm:table-column",
  md: "hidden md:table-column",
  lg: "hidden lg:table-column",
  xl: "hidden xl:table-column",
} as const;

type AnyColumn<TData extends RowData> = Column<
  DataTableFeatures,
  TData,
  unknown
>;

function metaOf<TData extends RowData>(
  column: AnyColumn<TData>
): DataTableColumnMeta {
  return (column.columnDef.meta ?? {}) as DataTableColumnMeta;
}

export interface DataTableProps<TData extends RowData> {
  model: DataTableModel<TData>;
  isLoading?: boolean;
  skeletonRows?: number;
  /** Placeholder for the search field; the field only appears when the model has a `search` function. */
  searchPlaceholder?: string;
  /** Table-level actions (e.g. "Export"), pinned to the toolbar's end. */
  actions?: ReactNode;
  /** Shown in the body when there are no rows at all — distinct from "no matches". */
  emptyState?: ReactNode;
  /** A load failure, shown in the body in place of rows. Never presented as an empty set. */
  error?: ReactNode;
  /** The next result is loading behind the current rows: they stay, dimmed, instead of collapsing. */
  isRefreshing?: boolean;
  /** A transient message between the toolbar and the rows (e.g. a row action that failed). */
  notice?: ReactNode;
  noResults?: ReactNode;
  /** Singular and plural for the footer: "1–10 of 14 people". */
  noun?: [string, string];
  pageSizes?: number[];
  /** Makes rows open something. Clicks on links and buttons inside a row keep their own behaviour. */
  onRowClick?: (row: TData) => void;
  /** Which rows `onRowClick` applies to; all of them by default. */
  canClickRow?: (row: TData) => boolean;
  /** Below this width the table scrolls inside its frame instead of squeezing its columns. */
  minWidth?: string;
  /**
   * Rows arrive already ordered by group; a header band opens each run of rows sharing a group key.
   * Grouping is the data's order, never a client-side regrouping.
   */
  rowGroup?: (row: TData) => { key: string; label: ReactNode } | null | undefined;
  className?: string;
}

/**
 * A Fusion data table: one framed object with its toolbar (search, filter chips, actions), a sortable
 * header band, rows, and a footer with the range and pager. Every state — loading, empty, no matches —
 * renders inside the same frame, so the table never changes shape.
 */
export function DataTable<TData extends RowData>({
  model,
  isLoading = false,
  skeletonRows = 5,
  searchPlaceholder,
  actions,
  emptyState,
  error,
  isRefreshing = false,
  notice,
  noResults,
  noun,
  pageSizes,
  onRowClick,
  canClickRow,
  minWidth,
  rowGroup,
  className,
}: DataTableProps<TData>) {
  const t = useTranslations("ds.table");
  const { table } = model;
  const columns = table.getVisibleLeafColumns() as AnyColumn<TData>[];
  const rows = table.getRowModel().rows;
  const isEmpty =
    !isLoading && !error && model.totalCount === 0 && !model.isFiltered;
  const hideClass = (meta: DataTableColumnMeta) =>
    meta.hideBelow ? HIDE_BELOW[meta.hideBelow] : undefined;
  const hasToolbar =
    model.search.enabled || model.filters.fields.length > 0 || actions;

  const clickable = (row: TData) =>
    Boolean(onRowClick) && (canClickRow?.(row) ?? true);
  const activate = (row: TData) => (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    // Clicks from portals (a row menu's dialog) bubble through React but are not in the row.
    if (!event.currentTarget.contains(target)) return;
    // Links and buttons inside the row keep their own behaviour.
    if (target.closest("a, button, input, [role='menuitem']")) return;
    onRowClick?.(row);
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-surface bg-card",
        className
      )}
    >
      {hasToolbar && !isEmpty ? (
        <div
          className={cn(
            "flex min-h-14 flex-wrap items-center gap-2 border-b border-border py-2.5",
            INSET
          )}
        >
          {isLoading ? (
            <>
              <Skeleton className="h-8 w-full sm:w-64" />
              <Skeleton className="h-8 w-80 max-w-full" />
            </>
          ) : (
            <>
              {/* Search leads: it is the one control that works across every view and filter. */}
              {model.search.enabled ? (
                <DataTableSearch
                  model={model}
                  placeholder={searchPlaceholder}
                  className="sm:w-64"
                />
              ) : null}
              <DataTableFilters model={model} />
              {actions ? (
                <div className="ms-auto flex items-center gap-2">{actions}</div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {notice ? (
        <div className={cn("border-b border-border py-3", INSET)}>{notice}</div>
      ) : null}

      {isEmpty ? (
        <div className="px-6 py-16 text-center">
          {emptyState ?? (
            <p className="text-sm text-muted-foreground">Nothing here yet</p>
          )}
        </div>
      ) : (
        <div className="relative w-full overflow-x-auto">
          <table
            className="w-full caption-bottom text-sm"
            style={minWidth ? { minWidth } : undefined}
          >
            <colgroup>
              {columns.map((column) => (
                <col
                  key={column.id}
                  style={{ width: metaOf(column).width }}
                  className={
                    metaOf(column).hideBelow
                      ? HIDE_COL_BELOW[metaOf(column).hideBelow!]
                      : undefined
                  }
                />
              ))}
            </colgroup>
            <thead className="bg-inlay">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-border">
                  {group.headers.map((header) => {
                    const column = header.column as AnyColumn<TData>;
                    const meta = metaOf(column);
                    const align = meta.align ?? "start";
                    const sorted = column.getIsSorted();
                    const canSort = column.getCanSort();
                    return (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        scope="col"
                        aria-sort={
                          canSort
                            ? sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                        className={cn(
                          "h-10 whitespace-nowrap text-xs font-medium text-muted-foreground",
                          INSET,
                          ALIGN_TEXT[align],
                          hideClass(meta),
                          meta.headerClassName
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <DataTableColumnHeader column={column} align={align}>
                            <table.FlexRender header={header} />
                          </DataTableColumnHeader>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody
              aria-busy={isRefreshing || undefined}
              className={cn("transition-opacity", isRefreshing && "opacity-60")}
            >
              {isLoading ? (
                Array.from({ length: skeletonRows }, (_, r) => (
                  <tr
                    key={`skeleton-${r}`}
                    aria-hidden
                    className="border-b border-border last:border-0"
                  >
                    {columns.map((column) => {
                      const meta = metaOf(column);
                      return (
                        <td
                          key={column.id}
                          className={cn("h-14", INSET, hideClass(meta))}
                        >
                          <div
                            className={cn(
                              "flex items-center",
                              ALIGN_FLEX[meta.align ?? "start"]
                            )}
                          >
                            {meta.skeleton ?? (
                              <Skeleton className="h-4 w-2/3" />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-10">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-6 py-14 text-center"
                  >
                    <p className="text-sm text-muted-foreground">{noResults ?? t("noResults")}</p>
                    {model.isFiltered ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={model.reset}
                      >
                        {t("clearFilters")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const isClickable = clickable(row.original);
                  const group = rowGroup?.(row.original);
                  const opensGroup =
                    group && (index === 0 || rowGroup?.(rows[index - 1]!.original)?.key !== group.key);
                  return (
                    <Fragment key={row.id}>
                    {opensGroup ? (
                      <tr className="border-b border-border bg-inlay">
                        <th
                          scope="colgroup"
                          colSpan={columns.length}
                          className={cn("h-9 text-start text-xs font-semibold text-foreground", INSET)}
                        >
                          {group.label}
                        </th>
                      </tr>
                    ) : null}
                    <tr
                      data-clickable={isClickable || undefined}
                      className={cn(
                        "group/row border-b border-border transition-colors last:border-0 hover:bg-muted/40",
                        isClickable &&
                          "cursor-pointer focus-visible:bg-muted/40 focus-visible:outline-none"
                      )}
                      onClick={isClickable ? activate(row.original) : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onKeyDown={
                        isClickable
                          ? (event: KeyboardEvent<HTMLTableRowElement>) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onRowClick?.(row.original);
                              }
                            }
                          : undefined
                      }
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = metaOf(cell.column as AnyColumn<TData>);
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "h-14 align-middle",
                              INSET,
                              ALIGN_TEXT[meta.align ?? "start"],
                              hideClass(meta),
                              meta.cellClassName
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </td>
                        );
                      })}
                    </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {isLoading || (!isEmpty && !error && table.getRowCount() > 0) ? (
        <div
          className={cn(
            "flex min-h-12 items-center border-t border-border py-2",
            INSET
          )}
        >
          {isLoading ? (
            <div
              aria-hidden
              className="flex w-full items-center justify-between gap-6"
            >
              <Skeleton className="h-4 w-32" />
              <div className="flex items-center gap-6">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-7 w-28" />
              </div>
            </div>
          ) : (
            <DataTablePagination
              model={model}
              noun={noun}
              pageSizes={pageSizes}
              className="w-full"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sortable header label: click toggles ascending / descending. The resting affordance only appears
 * on hover or focus, so an unsorted header reads as a plain label.
 */
export function DataTableColumnHeader<TData extends RowData>({
  column,
  align = "start",
  children,
}: {
  column: AnyColumn<TData>;
  align?: DataTableColumnMeta["align"];
  children: ReactNode;
}) {
  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
  const icon = (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 transition-opacity",
        sorted
          ? "text-primary-ink opacity-100"
          : "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60"
      )}
    />
  );
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "group/sort -mx-1.5 inline-flex h-7 items-center gap-1 rounded-control-sm px-1.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        sorted && "text-foreground"
      )}
    >
      {align === "end" ? icon : null}
      {children}
      {align === "end" ? null : icon}
    </button>
  );
}
