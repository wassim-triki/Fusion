"use client";

import { useWorkforceAccessWords } from "./access-language";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  OrganizationHierarchyNodeDto,
  WorkforceAccessCandidateDto,
  WorkforceAccessState,
  WorkforceAccessSubjectSummaryDto,
} from "@repo/api";
import {
  canManageWorkforceAccess,
  canViewWorkforceAccess,
  useAuth,
} from "@repo/auth";
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@repo/ds";
import { FilterChips, Segmented } from "@repo/ds/choice";
import {
  PageContainer,
  PageHeader,
  PagePermissionNotice,
  PageSkeleton,
} from "@repo/ds/shell";
import { Building2, ChevronDown, Eye, Search, X } from "lucide-react";
import { OrganizationTree } from "@/features/organization/components/organization-tree";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { PersonIdentity } from "@/features/people/components/workforce-ui";
import {
  useAccessRoster,
  useAccessRosterSummary,
  useAccessSelectionPreview,
  type AccessRosterFilters,
} from "../api/use-workforce-access";
import { AccountInspector } from "./account-inspector";
import { ActivationPlan } from "./activation-plan";
import { IdentityCorrection } from "./identity-correction";
import {
  ROSTER_STATE_ORDER,
} from "./access-language";
import {
  selectionScopePeople,
  shouldOfferScopeEscalation,
} from "./workforce-access-selection";

const PAGE_SIZE = 10;
const BASELINE_FILTER_OPTIONS: Array<{
  key: "Employee" | "Manager" | "all";
  label: string;
}> = [
  { key: "all", label: "baselineAll" },
  { key: "Employee", label: "baselineEmployees" },
  { key: "Manager", label: "baselineManagers" },
];

/**
 * Workforce Access — who in the workforce can sign in to Fusion.
 *
 * The page opens with a compact distribution of the whole workforce by access
 * state, doubling as the primary filter. Below it, the people themselves: one
 * human-first row per person with their work context, the Employee/Manager
 * recommendation, their account state, and one clear way in. Selecting a person
 * opens the account inspector without leaving the roster.
 */
export default function WorkforceAccessWorkspace() {
  const t = useTranslations("wfAccess");
  const { user, isLoading: isAuthLoading } = useAuth();
  const canView = canViewWorkforceAccess(user);
  const canManage = canManageWorkforceAccess(user);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The import handoff arrives as ?importBatch={id}; it scopes the roster to exactly
  // that cohort and shows a removable chip. Every other filter is local page state.
  const cohort = searchParams.get("importBatch");

  const [search, setSearch] = useState("");
  const [access, setAccess] = useState<WorkforceAccessState | null>(null);
  const [baseline, setBaseline] = useState<"Employee" | "Manager" | null>(null);
  const [orgUnitId, setOrgUnitId] = useState<string | null>(null);
  const [orgScope, setOrgScope] = useState<"Subtree" | "Direct">("Subtree");
  const [page, setPage] = useState(1);
  const [inspecting, setInspecting] =
    useState<WorkforceAccessSubjectSummaryDto | null>(null);
  // Selection persists across pages/filters as full row records, so the Activation
  // Plan always has each person's data regardless of what the roster currently shows.
  const [selected, setSelected] = useState<
    Record<string, WorkforceAccessSubjectSummaryDto>
  >({});
  const [reviewing, setReviewing] = useState(false);
  const [correcting, setCorrecting] =
    useState<WorkforceAccessCandidateDto | null>(null);

  const filters: AccessRosterFilters = useMemo(
    () => ({
      search: search.trim() || null,
      access,
      baseline,
      cohort,
      orgUnitId,
      organizationScope: orgUnitId ? orgScope : null,
    }),
    [search, access, baseline, cohort, orgUnitId, orgScope]
  );

  const summary = useAccessRosterSummary(canView);
  const roster = useAccessRoster(filters, page, PAGE_SIZE, canView);
  // Every selectable person that matches the current filters, across all pages,
  // so the full-view count is exact and never silently expands.
  const preview = useAccessSelectionPreview(filters, canView && canManage);

  const clearCohort = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("importBatch");
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, {
      scroll: false,
    });
    setPage(1);
  };

  const orgAsOf = new Date().toISOString().slice(0, 10);
  const organization = useOrganizationHierarchy(orgAsOf, canView);

  if (isAuthLoading) {
    return (
      <PageSkeleton rows={6} width="wide" label={t("loading")} />
    );
  }

  if (!canView) {
    return (
      <PageContainer width="wide" className="max-w-5xl space-y-6">
        <PageHeader title={t("title")} />
        <PagePermissionNotice
          title={t("denied.title")}
          description={t("denied.description")}
        />
      </PageContainer>
    );
  }

  const rows = roster.data?.items ?? [];
  const total = roster.data?.totalCount ?? 0;
  const totalPages = roster.data?.totalPages ?? 1;
  const selectedList = Object.values(selected);
  const selectedCount = selectedList.length;

  // Reviewable means every non-active person matching this exact view. The server
  // preview makes cross-page selection literal; filter changes never add anyone.
  const reviewablePreview = selectionScopePeople(preview.data ?? []);
  const reviewableCount = reviewablePreview.length;
  const allInViewSelected =
    reviewableCount > 0 &&
    selectedCount === reviewableCount &&
    reviewablePreview.every((person) => selected[person.employeeId]);

  const selectAllInView = () =>
    setSelected((prev) => {
      const next = { ...prev };
      for (const person of reviewablePreview) next[person.employeeId] = person;
      return next;
    });

  const setFilter = (next: WorkforceAccessState | null) => {
    setAccess((current) => (current === next ? null : next));
    setPage(1);
  };

  const setBaselineFilter = (next: "Employee" | "Manager" | null) => {
    setBaseline(next);
    setPage(1);
  };

  const toggle = (person: WorkforceAccessSubjectSummaryDto) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[person.employeeId]) delete next[person.employeeId];
      else next[person.employeeId] = person;
      return next;
    });

  const pageSelectableIds = rows
    .filter((r) => r.accessState !== "ActiveAccount")
    .map((r) => r.employeeId);
  const allPageSelected =
    pageSelectableIds.length > 0 &&
    pageSelectableIds.every((id) => selected[id]);

  const togglePage = () =>
    setSelected((prev) => {
      const next = { ...prev };
      if (allPageSelected) {
        for (const r of rows) delete next[r.employeeId];
      } else {
        for (const r of rows)
          if (r.accessState !== "ActiveAccount") next[r.employeeId] = r;
      }
      return next;
    });

  if (correcting) {
    return (
      <PageContainer width="wide" className="max-w-3xl space-y-7">
        <PageHeader
          eyebrow={
            <span className="type-eyebrow text-muted-foreground">
              {t("correctTitle")}
            </span>
          }
          title={t("correctTitle")}
        />
        <IdentityCorrection
          source={correcting}
          onBack={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            void roster.refetch();
            void summary.refetch();
          }}
        />
      </PageContainer>
    );
  }

  if (reviewing && selectedCount > 0) {
    return (
      <PageContainer width="wide" className="max-w-5xl space-y-7">
        <PageHeader
          eyebrow={
            <span className="type-eyebrow text-muted-foreground">
              {t("planEyebrow")}
            </span>
          }
          title={t("reviewTitle")}
        />
        <ActivationPlan
          people={selectedList}
          onBack={() => setReviewing(false)}
          onExit={() => {
            setReviewing(false);
            setSelected({});
            void roster.refetch();
            void summary.refetch();
          }}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide" className="max-w-6xl space-y-6">
      <PageHeader
        title={t("title")}
        description={
          summary.data
            ? t("description", { count: summary.data.totalCount })
            : t("descriptionGeneric")
        }
      />

      <StatusBand
        summary={summary.data}
        active={access}
        onSelect={setFilter}
        loading={summary.isLoading}
      />

      {cohort ? (
        <div className="flex items-center justify-between gap-4 rounded-surface bg-card px-4 py-3">
          <div>
            <p className="type-label">{t("cohort.title")}</p>
            <p className="type-meta text-muted-foreground">
              {t("cohort.showing", { count: total })}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={clearCohort}>
            {t("cohort.showAll")} <X className="ms-1.5 size-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t("search")}
            className="ps-9"
            aria-label={t("searchLabel")}
          />
        </div>
        <OrgFilter
          roots={organization.data?.roots ?? []}
          selectedId={orgUnitId}
          scope={orgScope}
          onSelect={(id) => {
            setOrgUnitId(id);
            setPage(1);
          }}
          onScopeChange={(next) => {
            setOrgScope(next);
            setPage(1);
          }}
        />
        <BaselineFilter value={baseline} onSelect={setBaselineFilter} />
      </div>

      <section aria-label={t("workforce")} className="space-y-3">
        {roster.isLoading ? (
          <PageSkeleton rows={6} width="wide" label={t("loadingWorkforce")} />
        ) : roster.error !== null ? (
          <SectionFailure onRetry={() => void roster.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyRoster filtered={access !== null || search.trim().length > 0} />
        ) : (
          <div
            className={cn(
              "border-y",
              selectedCount > 0 && "border-foreground/30"
            )}
          >
            {canManage ? (
              <div
                className={cn(
                  "flex items-center justify-between gap-3 border-b px-4 py-2.5",
                  "bg-inlay"
                )}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={togglePage}
                    aria-label={t("selectPage")}
                    className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                  />
                  <span className="type-meta text-muted-foreground">
                    {allPageSelected
                      ? t("pageSelected")
                      : t("selectThisPage")}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="divide-y">
              {rows.map((person) => (
                <PersonRow
                  key={person.employeeId}
                  person={person}
                  selectable={canManage}
                  selected={Boolean(selected[person.employeeId])}
                  onToggle={() => toggle(person)}
                  onOpen={() => setInspecting(person)}
                />
              ))}
            </div>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between pt-1">
            <p className="type-meta text-muted-foreground">
              {t("pageOf", { page, pages: totalPages, count: total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <AccountInspector
        employeeId={inspecting?.employeeId ?? null}
        accessState={inspecting?.accessState ?? null}
        canManage={canManage}
        onOpenChange={(open) => !open && setInspecting(null)}
        onCorrect={(candidate) => {
          setInspecting(null);
          setCorrecting(candidate);
        }}
      />

      {selectedCount > 0 ? (
        <SelectionBar
          people={selectedList}
          selectedCount={selectedCount}
          pageCount={pageSelectableIds.length}
          pageSelected={allPageSelected}
          scopeCount={reviewableCount}
          scopeSelected={allInViewSelected}
          scopeLoading={preview.isLoading}
          onClear={() => setSelected({})}
          onSelectScope={selectAllInView}
          onReview={() => setReviewing(true)}
        />
      ) : null}
    </PageContainer>
  );
}

/**
 * The status band: the whole workforce distributed across the four access states,
 * doubling as the primary filter. Figures, not a completion score.
 */
function StatusBand({
  summary,
  active,
  onSelect,
  loading,
}: {
  summary:
    | {
        totalCount: number;
        activeAccountCount: number;
        invitePendingCount: number;
        notInvitedCount: number;
        needsReviewCount: number;
        suspendedCount: number;
      }
    | undefined;
  active: WorkforceAccessState | null;
  onSelect: (state: WorkforceAccessState | null) => void;
  loading: boolean;
}) {
  const words = useWorkforceAccessWords();
  const t = useTranslations("wfAccess");
  const counts: Record<WorkforceAccessState, number> = {
    ActiveAccount: summary?.activeAccountCount ?? 0,
    InvitePending: summary?.invitePendingCount ?? 0,
    NotInvited: summary?.notInvitedCount ?? 0,
    NeedsReview: summary?.needsReviewCount ?? 0,
    Suspended: summary?.suspendedCount ?? 0,
  };

  return (
    // The band is structurally stable: all five states are always present so the
    // information architecture and filters never shift as data changes. Zero-count
    // states are simply quieter (dimmed figure), never removed.
    <div
      className="overflow-x-auto border-y"
      aria-label={t("filterState")}
    >
      <div className="flex min-w-max items-stretch">
        <button
          type="button"
          onClick={() => onSelect(null)}
          // eslint-disable-next-line no-restricted-syntax -- the state band is a row of figures that also filters; chips would lose the figures
          aria-pressed={active === null}
          className={cn(
            "flex min-w-28 items-baseline gap-2 border-e px-4 py-3.5 text-start transition-colors",
            active === null
              ? "border-b-2 border-b-primary bg-primary/10 text-foreground"
              : "hover:bg-muted/40"
          )}
        >
          <span className="type-metric">
            {loading ? "—" : (summary?.totalCount ?? 0)}
          </span>
          <span
            className={cn(
              "type-meta",
              active === null ? "text-foreground/70" : "text-muted-foreground"
            )}
          >
            {t("all")}
          </span>
        </button>
        {ROSTER_STATE_ORDER.map((state) => {
          const selected = active === state;
          const empty = !loading && counts[state] === 0;
          return (
            <button
              key={state}
              type="button"
              onClick={() => onSelect(state)}
              // eslint-disable-next-line no-restricted-syntax -- the state band is a row of figures that also filters; chips would lose the figures
              aria-pressed={selected}
              className={`flex min-w-32 items-baseline gap-2 border-e px-4 py-3.5 text-start transition-colors last:border-e-0 ${
                selected
                  ? "border-b-2 border-b-primary bg-primary/10 text-foreground"
                  : "hover:bg-muted/40"
              }`}
            >
              <span
                className={cn(
                  "type-metric",
                  empty && !selected && "text-muted-foreground/50"
                )}
              >
                {loading ? "—" : counts[state]}
              </span>
              <span
                className={cn(
                  "type-meta",
                  selected ? "text-foreground/70" : "text-muted-foreground"
                )}
              >
                {words.roster(state)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PersonRow({
  person,
  selectable,
  selected,
  onToggle,
  onOpen,
}: {
  person: WorkforceAccessSubjectSummaryDto;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations("wfAccess");
  const words = useWorkforceAccessWords();
  const state = person.accessState;
  return (
    <div
      className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_9rem_auto] lg:grid-cols-[auto_minmax(0,1fr)_10rem_9rem_auto] ${
        selected ? "bg-primary/8" : "hover:bg-muted/30"
      }`}
    >
      {selectable ? (
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={t("selectPerson", { name: person.displayName })}
          disabled={person.accessState === "ActiveAccount"}
        />
      ) : null}
      <PersonIdentity
        name={person.displayName}
        email={person.workEmail}
        jobTitle={person.jobTitle}
        organization={person.orgUnitName}
        employeeNumber={person.employeeNumber}
        accent={selected}
      />

      <p className="hidden type-meta text-muted-foreground lg:block">
        {words.baseline(person.directReportCount)}
      </p>

      <div className="hidden min-w-0 sm:block">
        <p
          className={cn(
            "type-meta font-medium",
            state === "NeedsReview" && "text-warning-foreground",
            state === "Suspended" && "text-danger",
            state !== "NeedsReview" &&
              state !== "Suspended" &&
              "text-muted-foreground"
          )}
        >
          {words.roster(state)}
        </p>
        {state === "NeedsReview" && person.reviewReason ? (
          <p className="truncate text-xs text-muted-foreground">
            {person.reviewReason}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpen}
          aria-label={t("inspect", { name: person.displayName })}
          title={t("inspect", { name: person.displayName })}
        >
          <Eye className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The contextual selection bar: appears only while people are selected, summarises
 * how the selection breaks down, and offers the single dominant next step. The roster
 * stays visible behind it; there is no competing permanent activation CTA.
 */
function SelectionBar({
  people,
  selectedCount,
  pageCount,
  pageSelected,
  scopeCount,
  scopeSelected,
  scopeLoading,
  onClear,
  onSelectScope,
  onReview,
}: {
  people: WorkforceAccessSubjectSummaryDto[];
  selectedCount: number;
  pageCount: number;
  pageSelected: boolean;
  scopeCount: number;
  scopeSelected: boolean;
  scopeLoading: boolean;
  onClear: () => void;
  onSelectScope: () => void;
  onReview: () => void;
}) {
  const t = useTranslations("wfAccess");
  // "Ready" means will actually be activated. Pending/active/suspended are carried as
  // unchanged context (bulk activation never resends or re-mutates them).
  const ready = people.filter(
    (p) => p.accessState === "NotInvited" && Boolean(p.workEmail)
  ).length;
  const needsReview = people.filter(
    (p) =>
      p.accessState === "NeedsReview" ||
      (p.accessState === "NotInvited" && !p.workEmail) ||
      p.accessState === "InvitePending" ||
      p.accessState === "Suspended"
  ).length;

  const showScopeEscalation = shouldOfferScopeEscalation({
    pageSelected,
    scopeSelected,
    scopeLoading,
    pageCount,
    scopeCount,
  });
  const reviewCount = scopeSelected ? scopeCount : selectedCount;

  return (
    <div className="sticky bottom-3 z-10 mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-surface border bg-popover px-4 py-3 shadow-raised backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClear}
          className="rounded-control p-1 text-muted-foreground hover:text-foreground"
          aria-label={t("clearSelection")}
        >
          <X className="size-4" />
        </button>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="type-label text-foreground">
            {scopeSelected
              ? t("selectedInView", { count: scopeCount })
              : pageSelected && selectedCount === pageCount
                ? t("selectedOnPage", { count: pageCount })
                : t("selected", { count: selectedCount })}
          </span>
          <span className="type-meta text-muted-foreground">{t("ready", { count: ready })}</span>
          <span
            className={cn(
              "type-meta",
              needsReview > 0
                ? "font-medium text-warning-foreground"
                : "text-muted-foreground"
            )}
          >
            {t("needReview", { count: needsReview })}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {showScopeEscalation ? (
          <button
            type="button"
            onClick={onSelectScope}
            className="type-meta font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("selectAll", { count: scopeCount })}
          </button>
        ) : null}
        <Button onClick={onReview}>
          {t("review", { count: reviewCount })}
        </Button>
      </div>
    </div>
  );
}

function EmptyRoster({ filtered }: { filtered: boolean }) {
  const t = useTranslations("wfAccess");
  return (
    <div className="rounded-surface border border-dashed px-4 py-12 text-center">
      <p className="type-body text-muted-foreground">
        {filtered
          ? t("noMatch")
          : t("empty")}
      </p>
    </div>
  );
}

function SectionFailure({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("wfAccess");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border px-4 py-3">
      <p className="type-body text-muted-foreground">
        {t("failed")}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}

function findUnitName(
  roots: OrganizationHierarchyNodeDto[],
  id: string | null
): string | null {
  if (!id) return null;
  for (const node of roots) {
    if (node.unit.id === id) return node.unit.name;
    const found = findUnitName(node.children ?? [], id);
    if (found) return found;
  }
  return null;
}

/**
 * The Organization filter: the canonical Core org tree in a compact popover, with a
 * unit/subtree scope toggle once a unit is chosen. Reuses the shared OrganizationTree so
 * the roster scopes to real structure rather than a flat list.
 */
function OrgFilter({
  roots,
  selectedId,
  scope,
  onSelect,
  onScopeChange,
}: {
  roots: OrganizationHierarchyNodeDto[];
  selectedId: string | null;
  scope: "Subtree" | "Direct";
  onSelect: (id: string | null) => void;
  onScopeChange: (scope: "Subtree" | "Direct") => void;
}) {
  const t = useTranslations("wfAccess");
  const [open, setOpen] = useState(false);
  const selectedName = useMemo(
    () => findUnitName(roots, selectedId),
    [roots, selectedId]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "max-w-56 justify-between gap-2 font-normal",
            selectedId && "border-foreground/25"
          )}
        >
          <Building2 className="size-4 text-muted-foreground" />
          <span className="truncate">
            {selectedName ?? t("allOrganizations")}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] p-0"
      >
        {selectedId ? (
          <div className="border-b p-2">
            <Segmented
              fill
              label={t("unitScope")}
              value={scope}
              onChange={onScopeChange}
              options={[
                { value: "Subtree", label: t("unitBelow") },
                { value: "Direct", label: t("unitOnly") },
              ]}
            />
          </div>
        ) : null}
        <OrganizationTree
          roots={roots}
          selectedId={selectedId}
          onSelect={(id) => {
            onSelect(id);
            if (id === null) setOpen(false);
          }}
          allOption={{ label: t("allOrganizations") }}
          emptyLabel={t("noUnit")}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The Employee/Manager baseline filter: All, Employees or Managers.
 */
function BaselineFilter({
  value,
  onSelect,
}: {
  value: "Employee" | "Manager" | null;
  onSelect: (value: "Employee" | "Manager" | null) => void;
}) {
  const t = useTranslations("wfAccess");
  return (
    <FilterChips
      type="single"
      label={t("filterBaseline")}
      value={value ?? "all"}
      onChange={(next) => onSelect(next === "all" ? null : next)}
      options={BASELINE_FILTER_OPTIONS.map((option) => ({ value: option.key, label: t(option.label as "baselineAll") }))}
    />
  );
}
