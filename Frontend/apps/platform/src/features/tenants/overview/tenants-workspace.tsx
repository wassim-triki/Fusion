"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageFailure } from "@repo/auth";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Blocks, Building2, CalendarDays, Plus } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import {
  DataTable,
  DataTableCellStack,
  DataTableExport,
  createDataTableColumnHelper,
  type DataTableDateRange,
  type DataTableFilterField,
  type DataTableFilterState,
  useDataTable,
  type SortingState,
} from "@repo/ds/data-table";
import { cn } from "@repo/ds/lib/utils";
import { PageContainer, PageEmpty, PageHeader } from "@repo/ds/shell";
import type {
  OverviewFilter,
  TenantOverviewQuery,
  TenantOverviewRow,
  TenantOverviewSort,
} from "../api";
import { listAllMatchingTenants, TENANT_PAGE_SIZES } from "../api";
import { useTenantWords, type TenantWords } from "../language";
import { useTenantActivity, useTenantOverview } from "../queries";
import { TenantsPageSkeleton } from "./tenants-page-skeleton";
import { RecoveryFailure } from "../recovery-dialog";
import { activationSummary } from "./tenant-activation";
import { TenantActivitySection } from "./tenant-activity";
import { csvFile, exportFileName, toCsv } from "./tenant-export";
import { TenantModulesCell } from "./tenant-modules-cell";
import { TenantMonogram } from "./tenant-monogram";
import { TenantRowActions } from "./tenant-row-actions";
import { TenantSummaryCards } from "./tenant-summary-cards";
import {
  parseQuery,
  serializeQuery,
  withQueryChange,
} from "./tenant-query";

/**
 * The Platform tenant directory.
 *
 * The page answers two questions in order: where the customer estate stands,
 * and which tenant needs something done. The summary carries the first and
 * doubles as the control that scopes the second; the directory beneath it stays
 * the workspace, not a widget under a dashboard.
 *
 * The query lives in the URL, so opening a tenant and coming back — or sharing
 * the link — returns to the same list rather than resetting to everything. The
 * directory is the shared data table in server mode: the service searches, sorts
 * and pages; the table reports what the operator asked for and the URL records it.
 */
export function TenantsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = useMemo(
    () =>
      parseQuery(
        new URLSearchParams(searchParams.toString()),
        FILTER_MODULES.map((m) => m.value)
      ),
    [searchParams]
  );

  // A change builds on the last query committed, not only the last one rendered: the URL catches up
  // asynchronously, and a reset issues two changes (filters, then search) back to back.
  const pending = useRef<TenantOverviewQuery | null>(null);
  useEffect(() => {
    pending.current = null;
  }, [query]);

  const commit = useCallback(
    (next: TenantOverviewQuery) => {
      pending.current = next;
      const serialized = serializeQuery(next);
      router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname]
  );

  const update = useCallback(
    (change: Partial<TenantOverviewQuery>) =>
      commit(withQueryChange(pending.current ?? query, change)),
    [commit, query]
  );

  const { data, error, isLoading, isFetching, refetch } =
    useTenantOverview(query);
  const activity = useTenantActivity();
  const [actionError, setActionError] = useState<Error | null>(null);
  const t = useTranslations("tenants.overview");
  const words = useTenantWords();
  // The file holds every tenant the query matches, not only the page on screen.
  const exportTenants = useCallback(async () => {
    const result = await listAllMatchingTenants(query);
    return { blob: csvFile(toCsv(result.rows, words)), fileName: exportFileName() };
  }, [query, words]);
  // setActionError is stable, so the columns are rebuilt only when the language changes.
  const columns = useMemo(() => tenantColumns(setActionError, t, words), [t, words]);
  const filterFields = useMemo(() => tenantFilterFields(t), [t]);

  const serialized = serializeQuery(query);
  const provisionHref = serialized
    ? `/tenants/new?from=${encodeURIComponent(serialized)}`
    : "/tenants/new";

  const model = useDataTable({
    data: data?.rows,
    columns,
    getRowId: (row) => row.tenantId,
    manual: { rowCount: data?.totalCount ?? 0 },
    filters: filterFields,
    filterState: toFilterState(query),
    onFilterStateChange: (next) => update(fromFilterState(next)),
    filterCounts: data?.counts
      ? {
          activation: {
            AwaitingActivation: data.counts.awaitingActivation,
            Active: data.counts.active,
            NeedsAttention: data.counts.needsAttention,
          },
        }
      : undefined,
    searchQuery: query.search,
    onSearchQueryChange: (search) => update({ search }),
    sorting: toSorting(query.sort),
    onSortingChange: (sorting) => update({ sort: fromSorting(sorting) }),
    pagination: { pageIndex: query.page - 1, pageSize: query.pageSize },
    onPaginationChange: (next) =>
      next.pageSize !== query.pageSize
        ? update({ pageSize: next.pageSize })
        : update({ page: next.pageIndex + 1 }),
  });

  const tenantHref = (id: string) =>
    serialized
      ? `/tenants/${id}?from=${encodeURIComponent(serialized)}`
      : `/tenants/${id}`;

  if (isLoading && !data) return <TenantsPageSkeleton />;

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild>
            {/* The current query travels with the operator so returning from
                provisioning lands on the list they left, not on an unfiltered
                one they have to rebuild. */}
            <Link href={provisionHref}>
              <Plus aria-hidden="true" className="size-4" />
              {t("provision")}
            </Link>
          </Button>
        }
      />

      <TenantSummaryCards
        counts={data?.counts ?? null}
        selected={query.filter}
        isLoading={isLoading}
        onSelect={(filter: OverviewFilter) => update({ filter })}
      />

      <DataTable
        model={model}
        isLoading={isLoading}
        isRefreshing={isFetching && !isLoading}
        skeletonRows={query.pageSize}
        searchPlaceholder={t("search")}
        actions={
          <DataTableExport
            formats={["csv"]}
            disabled={Boolean(error)}
            onExport={exportTenants}
          />
        }
        notice={actionError ? <RecoveryFailure error={actionError} /> : null}
        error={
          error ? <TenantsFailure error={error} onRetry={refetch} /> : null
        }
        emptyState={<TenantsEmpty />}
        noResults={t("noResults")}
        noun={[t("noun.one"), t("noun.other")]}
        pageSizes={TENANT_PAGE_SIZES}
        onRowClick={(row) => router.push(tenantHref(row.tenantId))}
        minWidth="560px"
      />

      <TenantActivitySection query={activity} />
    </PageContainer>
  );
}

// ── Filters: beyond lifecycle, which the summary cards own ──────────────────────

/** Every Fusion module, whether or not this environment grants it yet. Product names, the same in every language. */
const FILTER_MODULES = [
  { value: "CoreHR", label: "Core HR" },
  { value: "Performance", label: "Performance" },
  { value: "Recruitment", label: "Recruitment" },
  { value: "Interview", label: "Interview" },
  { value: "Learning", label: "Learning" },
];

const ACTIVATION_OPTIONS: Exclude<OverviewFilter, "All">[] = [
  "AwaitingActivation",
  "Active",
  "NeedsAttention",
];

type OverviewT = ReturnType<typeof useTranslations<"tenants.overview">>;

/**
 * Activation is the directory's primary question, so it is the pinned filter: always in the toolbar,
 * resetting to "All". It is the same state as the summary cards, so the two can never disagree. The
 * service takes one stage at a time.
 */
function tenantFilterFields(t: OverviewT): DataTableFilterField<TenantOverviewRow>[] {
  return [
    {
      id: "activation",
      label: t("filters.activation"),
      icon: Activity,
      type: "options",
      single: true,
      pinned: true,
      options: ACTIVATION_OPTIONS.map((value) => ({
        value,
        label: t(`activationOptions.${value}`),
      })),
    },
    {
      id: "modules",
      label: t("filters.module"),
      icon: Blocks,
      type: "options",
      options: FILTER_MODULES,
    },
    { id: "created", label: t("filters.created"), icon: CalendarDays, type: "dateRange" },
  ];
}

function toFilterState(query: TenantOverviewQuery): DataTableFilterState {
  return {
    activation: query.filter === "All" ? undefined : [query.filter],
    modules: query.modules,
    created: {
      from: query.createdFrom ?? undefined,
      to: query.createdTo ?? undefined,
    },
  };
}

function fromFilterState(
  state: DataTableFilterState
): Partial<TenantOverviewQuery> {
  const created = state.created as DataTableDateRange | undefined;
  const activation = (state.activation as OverviewFilter[] | undefined)?.[0];
  return {
    filter: activation ?? "All",
    modules: (state.modules as string[] | undefined) ?? [],
    createdFrom: created?.from ?? null,
    createdTo: created?.to ?? null,
  };
}

// ── Sort: the service's sort names ⇄ the table's column sorting ─────────────────

function toSorting(sort: TenantOverviewSort): SortingState {
  switch (sort) {
    case "NameAscending":
      return [{ id: "tenant", desc: false }];
    case "NameDescending":
      return [{ id: "tenant", desc: true }];
    case "CreatedAscending":
      return [{ id: "created", desc: false }];
    default:
      return [{ id: "created", desc: true }];
  }
}

function fromSorting(sorting: SortingState): TenantOverviewSort {
  const [first] = sorting;
  if (first?.id === "tenant")
    return first.desc ? "NameDescending" : "NameAscending";
  return first && !first.desc ? "CreatedAscending" : "CreatedDescending";
}

// ── Columns ─────────────────────────────────────────────────────────────────────

/**
 * Five columns, each earning its width: who the tenant is, where its activation
 * stands, what it is entitled to, when it appeared, and what can be done. The
 * separate status, invitation and administrator columns are gone — they were
 * three cells restating one situation, and the row read as a wall of badges.
 */
const column = createDataTableColumnHelper<TenantOverviewRow>();

const TWO_LINES = (
  <div className="w-full space-y-1.5">
    <Skeleton className="h-3.5 w-40 max-w-full" />
    <Skeleton className="h-3 w-28 max-w-full" />
  </div>
);

function tenantColumns(
  onActionFailed: (error: Error | null) => void,
  t: OverviewT,
  words: TenantWords
) {
  return [
    column.accessor("name", {
      id: "tenant",
      header: t("columns.tenant"),
      cell: ({ row }) => (
        <DataTableCellStack
          leading={<TenantMonogram name={row.original.name} />}
          primary={<span title={row.original.name}>{row.original.name}</span>}
          secondary={
            <span title={row.original.initialAdministratorEmail ?? undefined}>
              {row.original.initialAdministratorEmail ??
                t("administratorNotRecorded")}
            </span>
          }
        />
      ),
      meta: {
        width: "34%",
        skeleton: (
          <div className="flex w-full items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-control" />
            {TWO_LINES}
          </div>
        ),
      },
    }),
    column.display({
      id: "activation",
      header: t("columns.activation"),
      cell: ({ row }) => <ActivationCell row={row.original} />,
      meta: { skeleton: TWO_LINES },
    }),
    column.display({
      id: "modules",
      header: t("columns.modules"),
      cell: ({ row }) => <TenantModulesCell modules={row.original.modules} />,
      meta: { hideBelow: "lg", skeleton: <Skeleton className="h-5 w-24" /> },
    }),
    column.accessor("createdAt", {
      id: "created",
      header: t("columns.created"),
      sortDescFirst: true,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {words.date(row.original.createdAt)}
        </span>
      ),
      meta: {
        hideBelow: "lg",
        width: "9rem",
        skeleton: <Skeleton className="h-4 w-20" />,
      },
    }),
    column.display({
      id: "actions",
      header: () => <span className="sr-only">{t("columns.actions")}</span>,
      cell: ({ row }) => (
        <TenantRowActions row={row.original} onActionFailed={onActionFailed} />
      ),
      meta: {
        align: "end",
        width: "4rem",
        skeleton: <Skeleton className="size-8 rounded-control" />,
      },
    }),
  ];
}

/**
 * Two lines on every row, including the ordinary ones. Letting only exceptions
 * grow a second line would make the list jump as states change, and would put
 * the routine rows and the urgent ones on different rhythms.
 */
function ActivationCell({ row }: { row: TenantOverviewRow }) {
  const words = useTenantWords();
  const { status, detail, isException } = activationSummary(row, words);

  return (
    <div className="min-w-0">
      {/* The lifecycle status repeats down almost every row, so it sits back as
          context. The line below it is what actually differs between rows, and
          it is what the operator is scanning for. */}
      <p className="truncate text-xs text-muted-foreground" title={status}>
        {status}
      </p>
      <p
        className={cn(
          "mt-0.5 flex items-center gap-1.5 truncate text-sm",
          isException ? "font-medium text-destructive" : "text-foreground"
        )}
      >
        {/* A dot, not colour alone: the words already say what is wrong, and
            the marker only helps the eye find the row again. */}
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            isException
              ? "bg-destructive"
              : row.administratorActivationStatus === "Active"
                ? "bg-success"
                : "bg-muted-foreground/40"
          )}
        />
        {detail}
      </p>
    </div>
  );
}

/** A platform with no tenants at all. A query that matched nothing is the table's "no matches" state. */
function TenantsEmpty() {
  const t = useTranslations("tenants.overview");
  return (
    <PageEmpty
      icon={Building2}
      title={t("empty.title")}
      description={t("empty.description")}
      action={
        <Button asChild size="sm">
          <Link href="/tenants/new">
            <Plus aria-hidden="true" className="size-4" />
            {t("provision")}
          </Link>
        </Button>
      }
    />
  );
}

/** A retrieval failure is never presented as an empty tenant set. */
function TenantsFailure({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return <PageFailure error={error} onRetry={onRetry} />;
}
