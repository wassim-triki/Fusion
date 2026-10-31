"use client";

import { useSay } from "@repo/ds/lib/say";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, CircleMinus, Search, UserCheck } from "lucide-react";
import { Input, Skeleton, cn } from "@repo/ds";
import { FilterChips } from "@repo/ds/choice";
import type { WorkforceReviewCountsDto, WorkforceReviewRowDto } from "@repo/api";
import { Monogram, useWorkforceDate } from "@/features/people/components/workforce-ui";
import { employmentState, notImportedReason, pageList, reviewChips, type ReviewFilter } from "../model/review-view";

export const REVIEW_PAGE_SIZE = 10;

const GRID =
  "grid grid-cols-[minmax(17rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(10rem,1.1fr)_minmax(7.5rem,0.75fr)_minmax(11.5rem,1fr)] items-center gap-x-4";

/**
 * The workforce Fusion will establish, one proposed person per row, read-only. A row opens that
 * person's details; nothing here edits them.
 */
export function WorkforceProposal({
  counts,
  baseline,
  rows,
  totalMatching,
  loading,
  filter,
  onFilter,
  search,
  onSearch,
  page,
  onPage,
  selected,
  onSelect,
}: {
  counts: WorkforceReviewCountsDto;
  baseline: string;
  rows: WorkforceReviewRowDto[];
  totalMatching: number;
  loading: boolean;
  filter: ReviewFilter;
  onFilter: (filter: ReviewFilter) => void;
  search: string;
  onSearch: (value: string) => void;
  page: number;
  onPage: (page: number) => void;
  selected: number | null;
  onSelect: (row: WorkforceReviewRowDto) => void;
}) {
  const t = useTranslations("wfImport.proposal");
  const say = useSay("wfImport");
  return (
    <section aria-labelledby="workforce-proposal-title" className="overflow-hidden rounded-surface bg-card">
      <header className="space-y-4 px-4 pb-4 pt-5 sm:px-5">
        <h2 id="workforce-proposal-title" className="type-section-title text-foreground">
          {t("title")} <span className="text-muted-foreground">·</span> <span className="tabular-nums">{counts.total}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-96">
            <Search className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={t("search")}
              aria-label={t("searchLabel")}
              className="h-10 ps-9"
            />
          </div>
          {/* "" is All in the review's filter; a chip needs a value of its own. */}
          <FilterChips
            type="single"
            label={t("show")}
            value={filter || "all"}
            onChange={(next: ReviewFilter | "all") => onFilter(next === "all" ? "" : next)}
            options={reviewChips(counts, say).map((chip) => ({
              value: (chip.key || "all") as ReviewFilter | "all",
              label: chip.label,
              count: chip.count,
              icon: chip.tone === "destructive" ? <span aria-hidden className="size-1.5 rounded-full bg-destructive" /> : undefined,
            }))}
          />
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[68rem]">
          <div aria-hidden className={cn(GRID, "border-y border-border bg-inlay px-5 py-2.5 type-meta text-muted-foreground")}>
            {[
              t("columns.employee"),
              t("columns.organization"),
              t("columns.jobTitle"),
              t("columns.manager"),
              t("columns.employment"),
              t("columns.result"),
            ].map((label) => (
              <span key={label} className="font-medium">
                {label}
              </span>
            ))}
          </div>
          <ProposalRows rows={rows} loading={loading} baseline={baseline} selected={selected} onSelect={onSelect} />
        </div>
      </div>

      <Pager page={page} total={totalMatching} onPage={onPage} />
    </section>
  );
}

function ProposalRows({
  rows,
  loading,
  baseline,
  selected,
  onSelect,
}: {
  rows: WorkforceReviewRowDto[];
  loading: boolean;
  baseline: string;
  selected: number | null;
  onSelect: (row: WorkforceReviewRowDto) => void;
}) {
  const t = useTranslations("wfImport.proposal");
  const say = useSay("wfImport");
  const workforceDate = useWorkforceDate();
  if (loading && rows.length === 0)
    return (
      <div>
        {Array.from({ length: REVIEW_PAGE_SIZE }).map((_, i) => (
          <div key={i} className={cn(GRID, "border-b border-border/60 px-5 py-3")}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            {Array.from({ length: 5 }).map((__, j) => (
              <Skeleton key={j} className="h-3.5 w-24" />
            ))}
          </div>
        ))}
      </div>
    );
  if (rows.length === 0)
    return <p className="px-5 py-12 text-center type-body text-muted-foreground">{t("empty")}</p>;

  return (
    <div aria-busy={loading || undefined} className={cn(loading && "opacity-60 transition-opacity")}>
      {rows.map((row) => {
        const active = row.sourceRowNumber === selected;
        const employment = employmentState(row, baseline, say);
        return (
          <button
            key={row.sourceRowNumber}
            type="button"
            onClick={() => onSelect(row)}
            className={cn(
              GRID,
              "w-full border-b border-border/60 px-5 py-2.5 text-start outline-none transition-colors duration-[var(--duration-fast)] last:border-b-0 focus-visible:bg-muted/50",
              active ? "bg-primary/[0.06]" : "hover:bg-muted/40"
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Monogram name={row.employee.displayName} size="md" className="rounded-full" />
              <span className="min-w-0">
                <span className="block truncate type-label font-semibold text-foreground">{row.employee.displayName}</span>
                <span className="block truncate type-meta text-muted-foreground">
                  {[row.employee.numberGenerated ? t("generated") : row.employee.employeeNumber, row.employee.workEmail]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </span>
            </span>
            <span className="min-w-0">
              {row.work.organization ? (
                <span className="block truncate type-body text-foreground">{row.work.organization}</span>
              ) : row.classification !== "Blocked" ? (
                <span className="block truncate type-body text-muted-foreground">{row.work.sourceOrganization ?? "—"}</span>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5 type-body text-destructive" title={t("noUnit")}>
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{row.work.sourceOrganization ?? t("missing")}</span>
                </span>
              )}
            </span>
            <span className="truncate type-body text-foreground">
              {row.work.displayTitle ?? <span className="text-muted-foreground">—</span>}
            </span>
            <span className="min-w-0">
              {row.classification === "NotImported" ? (
                <span className="type-body text-muted-foreground">—</span>
              ) : (
                <ManagerCell manager={row.manager} />
              )}
            </span>
            <span className="min-w-0 type-body">
              <span className="block text-muted-foreground">{employment.label}</span>
              {employment.date ? <span className="block tabular-nums text-foreground">{workforceDate(employment.date)}</span> : null}
            </span>
            <span className="min-w-0">
              <ResultPill row={row} reason={notImportedReason(row, baseline, say)} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ManagerCell({ manager }: { manager: WorkforceReviewRowDto["manager"] }) {
  const t = useTranslations("wfImport.proposal");
  if (manager.state === "NoManager")
    return (
      <span className="block type-body text-muted-foreground">
        <span aria-hidden className="block leading-none">—</span>
        {t("noManager")}
      </span>
    );
  if (manager.state === "Unresolved")
    return (
      <span className="flex min-w-0 items-center gap-1.5 type-body text-destructive" title={t("noOne")}>
        <AlertCircle className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{manager.display ?? t("unresolved")}</span>
      </span>
    );
  const name = manager.display ?? "—";
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Monogram name={name} size="sm" className="size-7 rounded-full text-[0.625rem]" />
      <span className="min-w-0">
        <span className="block truncate type-body text-foreground">{name}</span>
        {manager.employeeNumber ? <span className="block truncate type-meta text-muted-foreground">{manager.employeeNumber}</span> : null}
      </span>
    </span>
  );
}

function ResultPill({ row, reason }: { row: WorkforceReviewRowDto; reason: string | null }) {
  const t = useTranslations("wfImport.proposal");
  const pill = (() => {
    switch (row.classification) {
      case "Create":
        return { icon: CheckCircle2, label: t("result.Create"), className: "bg-success/12 text-success", iconClass: "fill-success text-card" };
      case "Existing":
        return { icon: UserCheck, label: t("result.Existing"), className: "bg-muted text-muted-foreground", iconClass: "" };
      case "Blocked":
        return { icon: AlertCircle, label: t("result.Blocked"), className: "bg-destructive/12 text-destructive", iconClass: "" };
      default:
        return { icon: CircleMinus, label: t("result.NotImported"), className: "bg-muted text-muted-foreground", iconClass: "fill-muted-foreground/30" };
    }
  })();
  const Icon = pill.icon;
  return (
    <span className="block min-w-0">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 type-meta font-medium", pill.className)}>
        <Icon className={cn("size-4 shrink-0", pill.iconClass)} aria-hidden />
        {pill.label}
      </span>
      {reason ? <span className="mt-1 block ps-1 text-[0.6875rem] leading-tight text-muted-foreground">{reason}</span> : null}
    </span>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const t = useTranslations("wfImport.proposal");
  const pages = Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * REVIEW_PAGE_SIZE + 1;
  const last = Math.min(page * REVIEW_PAGE_SIZE, total);
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 type-meta text-muted-foreground">
      <span className="tabular-nums">
        {t("showing", { first, last, count: total })}
      </span>
      {pages > 1 ? (
        <nav aria-label={t("pages")} className="flex items-center gap-1">
          <PageButton label={t("previous")} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </PageButton>
          {pageList(page, pages).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} aria-hidden className="grid size-8 place-items-center">
                …
              </span>
            ) : (
              <PageButton key={item} label={t("page", { page: item })} current={item === page} onClick={() => onPage(item)}>
                {item}
              </PageButton>
            )
          )}
          <PageButton label={t("next")} disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight className="size-4" aria-hidden />
          </PageButton>
        </nav>
      ) : null}
    </footer>
  );
}

function PageButton({
  label,
  current,
  disabled,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-control tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        current ? "border border-primary text-foreground" : "hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
