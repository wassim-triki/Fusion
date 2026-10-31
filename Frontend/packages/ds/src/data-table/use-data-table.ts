"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  useTable,
  type PaginationState,
  type RowData,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import {
  dataTableFeatures,
  type DataTableColumnDef,
  type DataTableInstance,
} from "./features";

// ── The one filter model ────────────────────────────────────────────────────────
//
// Every way of narrowing the rows is a filter field, shown as a chip. A `pinned` field is the table's
// primary question: its chip is always in the toolbar and resets to "All" instead of disappearing.
// Other fields are added through the Filter menu. Matching is a row predicate per option, or the
// field's `value` read from the row; in server mode the hook only reports the state.

type Icon = ComponentType<{ className?: string }>;

export interface DataTableFilterOption<TData = unknown> {
  value: string;
  label: string;
  icon?: Icon;
  /** Client mode: rows this option keeps. Without it, the field's `value` is compared to `value`. */
  match?: (row: TData) => boolean;
}

interface FieldBase {
  id: string;
  label: string;
  icon?: Icon;
  /** Always shown; resets to "All". The table's primary question. */
  pinned?: boolean;
}

export type DataTableFilterField<TData = unknown> =
  | (FieldBase & {
      type: "options";
      options: DataTableFilterOption<TData>[];
      /** One value at a time instead of any of several. */
      single?: boolean;
      /** Client mode: the row's value(s) for this field, when options have no `match`. */
      value?: (row: TData) => string | string[] | null | undefined;
    })
  | (FieldBase & {
      type: "dateRange";
      /** Client mode: the row's ISO date for this field. */
      value?: (row: TData) => string | null | undefined;
    });

export interface DataTableDateRange {
  /** Inclusive, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}

export type DataTableFilterValue = string[] | DataTableDateRange;
export type DataTableFilterState = Record<
  string,
  DataTableFilterValue | undefined
>;

export function isFilterActive(
  value: DataTableFilterValue | undefined
): boolean {
  if (!value) return false;
  return Array.isArray(value)
    ? value.length > 0
    : Boolean(value.from || value.to);
}

/** Whether a row passes one field's filter: the same rule the table applies, for views that filter without a table. */
export function matchesField<TData>(
  field: DataTableFilterField<TData>,
  value: DataTableFilterValue | undefined,
  row: TData
): boolean {
  if (!isFilterActive(value)) return true;
  if (field.type === "dateRange") {
    const { from, to } = value as DataTableDateRange;
    const day = field.value?.(row)?.slice(0, 10);
    if (!day) return false;
    return (!from || day >= from) && (!to || day <= to);
  }
  const selected = value as string[];
  return selected.some((v) => {
    const option = field.options.find((o) => o.value === v);
    if (option?.match) return option.match(row);
    const own = field.value?.(row);
    return Array.isArray(own) ? own.includes(v) : own === v;
  });
}

// ── Hook ────────────────────────────────────────────────────────────────────────

export interface UseDataTableOptions<TData extends RowData> {
  /** The rows: the full set in client mode, the current page in server mode. `undefined` while loading. */
  data: TData[] | undefined;
  columns: DataTableColumnDef<TData>[];
  getRowId: (row: TData) => string;
  /** Client mode: the text the search box matches for a row. */
  search?: (row: TData) => string;
  filters?: DataTableFilterField<TData>[];
  /** Controlled filter state (URL, parent page); uncontrolled when omitted. */
  filterState?: DataTableFilterState;
  onFilterStateChange?: (state: DataTableFilterState) => void;
  /** Rows per option, per field, when the server counts them; client mode counts `data` itself. */
  filterCounts?: Record<string, Record<string, number>>;
  initialSorting?: SortingState;
  pageSize?: number;

  /**
   * Server mode: the server searches, filters, sorts and pages, and `rowCount` is the total match
   * count. Search, filters, sorting and pagination are then controlled by the caller; the table only
   * reports changes. Search is debounced before `onSearchQueryChange` fires.
   */
  manual?: { rowCount: number };
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  pagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
}

export interface DataTableModel<TData extends RowData> {
  table: DataTableInstance<TData>;
  /** Rows before search and filters: what "empty" means, as opposed to "no matches". */
  totalCount: number;
  search: {
    enabled: boolean;
    value: string;
    /** The debounced value actually applied. */
    query: string;
    setValue: (value: string) => void;
  };
  filters: {
    fields: DataTableFilterField<TData>[];
    state: DataTableFilterState;
    /** Replace some fields' values; `undefined` clears a field. */
    set: (changes: DataTableFilterState) => void;
    counts: Record<string, Record<string, number> | undefined>;
  };
  isFiltered: boolean;
  /** Clears search and every filter. */
  reset: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;
const NO_FIELDS: never[] = [];
const EMPTY: never[] = [];

function resolve<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function"
    ? (updater as (old: T) => T)(current)
    : updater;
}

/**
 * The one hook behind a Fusion data table.
 *
 * Client mode (default): search and filters narrow the rows before TanStack sorts and pages them, and
 * every narrowing lands back on page one. Server mode (`manual`): the same UI, but search, filters,
 * sort and page are reported to the caller, who fetches the matching page.
 */
export function useDataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  search,
  filters: fields = NO_FIELDS as DataTableFilterField<TData>[],
  filterState: controlledFilters,
  onFilterStateChange,
  filterCounts,
  initialSorting = [],
  pageSize = 10,
  manual,
  searchQuery,
  onSearchQueryChange,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
}: UseDataTableOptions<TData>): DataTableModel<TData> {
  // Filters: local or controlled.
  const [localFilters, setLocalFilters] = useState<DataTableFilterState>({});
  const filterState = controlledFilters ?? localFilters;
  const setFilters = (changes: DataTableFilterState) => {
    const next: DataTableFilterState = { ...filterState };
    for (const [id, v] of Object.entries(changes))
      next[id] = isFilterActive(v) ? v : undefined;
    (onFilterStateChange ?? setLocalFilters)(next);
  };

  // Search: the field is always local while typing; the applied query is local or controlled.
  const [localQuery, setLocalQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const applyQuery = onSearchQueryChange ?? setLocalQuery;
  const [searchValue, setSearchValue] = useState(query);
  const lastApplied = useRef(query);
  useEffect(() => {
    // An outside change (back navigation, a shared link, Clear) resets the field.
    if (query !== lastApplied.current) {
      lastApplied.current = query;
      setSearchValue(query);
    }
  }, [query]);
  useEffect(() => {
    if (searchValue === query) return;
    const apply = () => {
      lastApplied.current = searchValue;
      applyQuery(searchValue);
    };
    // Clearing applies at once; typing settles first so the table does not reshuffle on every key.
    if (searchValue === "") return apply();
    const timer = setTimeout(apply, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchValue, query, applyQuery]);

  const all = data ?? EMPTY;

  const counts = useMemo(() => {
    const result: Record<string, Record<string, number> | undefined> = {};
    for (const field of fields) {
      if (field.type !== "options") continue;
      if (filterCounts?.[field.id]) {
        result[field.id] = filterCounts[field.id];
      } else if (!manual) {
        result[field.id] = Object.fromEntries(
          field.options.map((o) => [
            o.value,
            all.filter((row) => matchesField(field, [o.value], row)).length,
          ])
        );
      }
    }
    return result;
  }, [all, fields, filterCounts, manual]);

  const rows = useMemo(() => {
    if (manual) return all;
    const term = query.trim().toLowerCase();
    const activeFields = fields.filter((f) =>
      isFilterActive(filterState[f.id])
    );
    if (activeFields.length === 0 && (term === "" || !search)) return all;
    return all.filter(
      (row) =>
        activeFields.every((f) => matchesField(f, filterState[f.id], row)) &&
        (term === "" || !search || search(row).toLowerCase().includes(term))
    );
  }, [all, fields, filterState, query, search, manual]);

  const controlledState = {
    ...(sorting ? { sorting } : {}),
    ...(pagination ? { pagination } : {}),
  };

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns,
    getRowId,
    initialState: {
      sorting: initialSorting,
      pagination: { pageIndex: 0, pageSize },
    },
    state: controlledState,
    ...(onSortingChange
      ? {
          onSortingChange: (u: Updater<SortingState>) =>
            onSortingChange(resolve(u, sorting ?? [])),
        }
      : {}),
    ...(onPaginationChange
      ? {
          onPaginationChange: (u: Updater<PaginationState>) =>
            onPaginationChange(
              resolve(u, pagination ?? { pageIndex: 0, pageSize })
            ),
        }
      : {}),
    enableSortingRemoval: false,
    enableMultiSort: false,
    autoResetPageIndex: !manual,
    manualSorting: Boolean(manual),
    manualFiltering: Boolean(manual),
    manualPagination: Boolean(manual),
    rowCount: manual?.rowCount,
  });

  const isFiltered =
    query.trim() !== "" ||
    fields.some((f) => isFilterActive(filterState[f.id]));

  return {
    table,
    totalCount: manual ? manual.rowCount : all.length,
    search: {
      enabled: Boolean(search || onSearchQueryChange),
      value: searchValue,
      query,
      setValue: setSearchValue,
    },
    filters: { fields, state: filterState, set: setFilters, counts },
    isFiltered,
    reset: () => {
      setSearchValue("");
      setFilters(Object.fromEntries(fields.map((f) => [f.id, undefined])));
    },
  };
}
