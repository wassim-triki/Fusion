"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Building2, ChevronDown, ChevronRight, Network, Search, Users2, X } from "@repo/ds/icons";
import type {
  OrganizationHierarchyNodeDto,
  OrgUnitSelectionInput,
} from "@repo/api";
import { OrgTypeIcon, useOrgHierarchy } from "@repo/workforce-ui";
import { Checkbox } from "@repo/ds/components/ui/checkbox";
import { Switch } from "@repo/ds/components/ui/switch";
import { Input } from "@repo/ds/components/ui/input";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import { computeOrgStates } from "./population-model";
import { setupStepHref } from "../setup-readiness";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const APPLY_DEBOUNCE_MS = 250;
const INDENT = 26;

/**
 * The inline organization-scope picker: a live tree on the left, the resolved selection on the
 * right. Each chosen unit independently decides whether it also pulls in its sub-units, so the
 * scope reads exactly as the server resolves it. Edits are held locally for instant tree feedback
 * and pushed to the parent on a short debounce — the parent owns the authoritative PUT and the
 * re-resolution that feeds the matched count back in.
 */
export function OrgScopePicker({
  cycleId,
  asOf,
  selections,
  matchedCount,
  onChange,
}: {
  cycleId: string;
  asOf: string;
  selections: OrgUnitSelectionInput[];
  matchedCount: number | null;
  onChange: (selections: OrgUnitSelectionInput[]) => void;
}) {
  const t = useTranslations("cycleSetup.OrgScopePicker");
  const hierarchy = useOrgHierarchy(true, asOf);
  const roots = useMemo(() => hierarchy.data?.roots ?? [], [hierarchy.data]);
  // An empty tree on the cycle date may only mean the structure takes effect later; check today's.
  const current = useOrgHierarchy(hierarchy.data !== undefined && roots.length === 0);
  const startsOn = useMemo(() => earliestEffectiveFrom(current.data?.roots ?? []), [current.data]);

  // Local working copy for instant feedback; seeded once (this surface is remounted whenever the
  // mode toggles away and back, which re-reads the authoritative selection from props).
  const [working, setWorking] = useState<OrgUnitSelectionInput[]>(
    () => selections
  );
  const [term, setTerm] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(working);

  // Hold the latest onChange in a ref: the parent re-derives it on every resolution, and keying the
  // scheduler or the unmount flush on its identity would fire redundant PUTs on each re-render (and
  // could loop, since each PUT writes back through the cache). Both stay identity-stable instead.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const schedule = useCallback((next: OrgUnitSelectionInput[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => onChangeRef.current(next),
      APPLY_DEBOUNCE_MS
    );
  }, []);

  // Flush a pending change on true unmount only (mode switch / navigation) so nothing is lost.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      onChangeRef.current(latest.current);
    },
    []
  );

  const commit = useCallback(
    (next: OrgUnitSelectionInput[]) => {
      latest.current = next;
      setWorking(next);
      schedule(next);
    },
    [schedule]
  );

  const toggleUnit = useCallback(
    (id: string) => {
      const exists = latest.current.some((s) => s.orgUnitId === id);
      commit(
        exists
          ? latest.current.filter((s) => s.orgUnitId !== id)
          : [...latest.current, { orgUnitId: id, includeDescendants: true }]
      );
    },
    [commit]
  );

  const setIncludeDescendants = useCallback(
    (id: string, value: boolean) =>
      commit(
        latest.current.map((s) =>
          s.orgUnitId === id ? { ...s, includeDescendants: value } : s
        )
      ),
    [commit]
  );

  const states = useMemo(
    () => computeOrgStates(roots, working),
    [roots, working]
  );

  // Search visibility: a node shows when it matches, or has a matching ancestor or descendant, so
  // the surrounding hierarchy stays navigable rather than collapsing to a flat result list.
  const visibleIds = useMemo(
    () => searchVisibility(roots, term),
    [roots, term]
  );
  const searching = term.trim().length > 0;

  const { names, parents } = useMemo(() => {
    const names = new Map<string, string>();
    const parents = new Map<string, string | null>();
    const walk = (node: OrganizationHierarchyNodeDto, parent: string | null) => {
      names.set(node.unit.id, node.unit.name);
      parents.set(node.unit.id, parent);
      node.children.forEach((child) => walk(child, node.unit.id));
    };
    roots.forEach((root) => walk(root, null));
    return { names, parents };
  }, [roots]);

  const selectedList = working.filter((s) => names.has(s.orgUnitId));

  // Selections the tree can't currently show — inside a collapsed branch or filtered out by the
  // search — surface as chips so nothing chosen is ever out of sight.
  const hiddenSelections = selectedList.filter((selection) => {
    if (visibleIds) return !visibleIds.has(selection.orgUnitId);
    for (let id = parents.get(selection.orgUnitId); id; id = parents.get(id)) {
      if (collapsed.has(id)) return true;
    }
    return false;
  });

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: OrganizationHierarchyNodeDto, depth: number) {
    if (visibleIds && !visibleIds.has(node.unit.id)) return null;
    const state = states.get(node.unit.id);
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.unit.id) && !searching;
    const checked = state?.selected
      ? true
      : state?.inherited
        ? true
        : state?.indeterminate
          ? "indeterminate"
          : false;
    const covered = Boolean(state?.selected || state?.inherited);

    return (
      <li key={node.unit.id}>
        <div
          className={cn(
            "group relative flex min-h-14 items-center rounded-control border py-2 pe-2.5 transition-colors",
            state?.selected
              ? "border-primary/40 bg-primary/10"
              : cn("border-transparent", !state?.inherited && "hover:bg-muted/40")
          )}
          style={{ paddingInlineStart: depth * INDENT + 4 }}
        >
          <Guides depth={depth} />
          <span className="grid size-6 shrink-0 place-items-center">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapse(node.unit.id)}
                className="grid size-6 place-items-center rounded-control-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={
                  isCollapsed
                    ? t("expand", { name: node.unit.name })
                    : t("collapse", { name: node.unit.name })
                }
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
            ) : null}
          </span>

          <label
            className={cn(
              "flex min-w-0 flex-1 items-center",
              state?.inherited ? "cursor-default" : "cursor-pointer"
            )}
          >
            <Checkbox
              className="ms-2 size-5 disabled:cursor-default disabled:opacity-100"
              checked={checked}
              disabled={state?.inherited}
              onCheckedChange={() => toggleUnit(node.unit.id)}
              aria-label={node.unit.name}
            />
            <span
              aria-hidden
              className={cn(
                "ms-3 hidden size-9 shrink-0 place-items-center rounded-full sm:me-3 sm:grid",
                covered ? "bg-primary-tint text-primary-ink" : "bg-muted text-foreground/80"
              )}
            >
              <OrgTypeIcon typeName={node.unit.typeName} />
            </span>
            <span className="ms-3 min-w-0 flex-1 sm:ms-0">
              <span
                className={cn(
                  "block truncate type-subsection-title",
                  covered ? "text-foreground" : "text-foreground/90"
                )}
              >
                {node.unit.name}
              </span>
              <span className="block truncate type-meta text-muted-foreground">
                {[node.unit.typeName, node.unit.code].filter(Boolean).join(" • ")}
              </span>
            </span>
          </label>

          {state?.inherited ? (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-control border border-border px-2.5 py-1 type-meta text-muted-foreground sm:flex">
              <Network className="size-3.5" aria-hidden />
              {t("inheritedViaParent")}
            </span>
          ) : state?.selected && hasChildren ? (
            <label className="flex shrink-0 cursor-pointer items-center gap-2.5 rounded-full border border-primary/35 py-1 ps-1 pe-1 sm:ps-3.5">
              <span
                className={cn(
                  "hidden type-meta sm:inline",
                  state.includeDescendants
                    ? "text-primary-ink"
                    : "text-muted-foreground"
                )}
              >
                {t("includeSubUnits")}
              </span>
              <Switch
                checked={state.includeDescendants}
                onCheckedChange={(value) =>
                  setIncludeDescendants(node.unit.id, value)
                }
                aria-label={t("includeSubUnitsOf", { name: node.unit.name })}
              />
            </label>
          ) : null}
        </div>

        {hasChildren && !isCollapsed ? (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="mt-4 flex h-[34rem] flex-col overflow-hidden rounded-surface border border-border bg-inlay p-4 sm:p-5">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div>
            <h3 className="type-section-title text-foreground">{t("organizationUnits")}</h3>
            <p className="mt-0.5 type-body-secondary text-muted-foreground">
              {t("selectTheOrganizationUnitsTo")}
            </p>
          </div>
          <div className="flex w-full items-center divide-x divide-border rounded-surface border border-border py-2 type-body-secondary tabular-nums text-muted-foreground sm:w-auto">
            <span className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-2.5 sm:flex-none sm:px-3.5">
              <Network className="size-4 text-primary-ink" aria-hidden />
              <span className="font-semibold text-foreground">{selectedList.length}</span>
              {selectedList.length === 1 ? t("unit") : t("units")}
              <span className="-ms-1 hidden sm:inline">{t("selected")}</span>
            </span>
            <span className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap px-2.5 sm:flex-none sm:px-3.5">
              <Users2 className="size-4" aria-hidden />
              <span className="font-semibold text-foreground">
                {matchedCount === null ? "—" : matchedCount}
              </span>
              {matchedCount === 1 ? t("person") : t("people")}
              <span className="-ms-1 hidden sm:inline">{t("matched")}</span>
            </span>
          </div>
        </div>
        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute inset-s-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("searchOrganizationUnits")}
            className="h-11 ps-10"
          />
        </div>
        {hiddenSelections.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label={t("selectedUnitsOutOfView")}>
            {hiddenSelections.map((selection) => (
              <li
                key={selection.orgUnitId}
                className="flex items-center gap-1 rounded-control bg-primary-tint py-0.5 ps-2 pe-0.5 type-meta-strong text-primary-ink"
              >
                {names.get(selection.orgUnitId)}
                <button
                  type="button"
                  onClick={() => toggleUnit(selection.orgUnitId)}
                  className="grid size-5 place-items-center rounded-detail hover:bg-primary/15"
                  aria-label={t("removeFromScope", { value: names.get(selection.orgUnitId) ?? "unit" })}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-surface border border-border p-1.5">
        {hierarchy.isLoading || (roots.length === 0 && current.isLoading) ? (
          <div className="py-1" aria-busy aria-label={t("loadingOrganizationUnits")}>
            {[0, 1, 2, 2, 1, 2].map((depth, index) => (
              <div
                key={index}
                className="flex min-h-14 items-center gap-3 pe-3"
                style={{ paddingInlineStart: depth * INDENT + 38 }}
              >
                <Skeleton className="size-5 shrink-0" />
                <Skeleton className="hidden size-9 shrink-0 rounded-full sm:block" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : hierarchy.error ? (
          <TreeError onRetry={() => void hierarchy.refetch()} />
        ) : roots.length === 0 ? (
          <EmptyTree cycleId={cycleId} asOf={asOf} startsOn={startsOn} />
        ) : visibleIds && visibleIds.size === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <Search className="size-5 text-muted-foreground" aria-hidden />
            <p className="type-body-secondary text-muted-foreground">
              {t("noUnitsMatch", { term })}
            </p>
          </div>
        ) : (
          <ul>{roots.map((root) => renderNode(root, 0))}</ul>
        )}
      </div>
    </div>
  );
}

/** Quiet connector lines: one vertical per ancestor level and an elbow into the row. */
function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 inset-s-0">
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          className="absolute inset-y-0 border-s border-border"
          style={{ insetInlineStart: level * INDENT + 4 + 11 }}
        />
      ))}
      <span
        className="absolute top-1/2 w-3 border-t border-border"
        style={{ insetInlineStart: (depth - 1) * INDENT + 4 + 11 }}
      />
    </span>
  );
}

function EmptyTree({ cycleId, asOf, startsOn }: { cycleId: string; asOf: string; startsOn: string | null }) {
  const format = useFormat();
  const t = useTranslations("cycleSetup.EmptyTree");
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Building2 className="size-6 text-muted-foreground" aria-hidden />
      {startsOn ? (
        <>
          <p className="type-label text-foreground">
            {t("yourOrganizationStructureStartsOn", { startsOn: format.date(startsOn) })}
          </p>
          <p className="type-body-secondary max-w-xs text-muted-foreground">
            {t("thisCycleStartsOnBefore", { asOf: format.date(asOf) })}
          </p>
          <Link
            href={setupStepHref("details", cycleId)}
            className="type-label mt-1 text-primary-ink underline-offset-4 hover:underline"
          >
            {t("changeCycleDates")}
          </Link>
        </>
      ) : (
        <p className="type-body-secondary text-muted-foreground">
          {t("noOrganizationUnitsExistYet")}
        </p>
      )}
    </div>
  );
}

function TreeError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("cycleSetup.TreeError");
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <AlertCircle className="size-6 text-destructive" aria-hidden />
      <p className="type-body-secondary text-muted-foreground">
        {t("couldntLoadOrganizationUnits")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="type-label text-primary-ink underline-offset-4 hover:underline"
      >
        {t("tryAgain")}
      </button>
    </div>
  );
}

function earliestEffectiveFrom(nodes: OrganizationHierarchyNodeDto[]): string | null {
  let min: string | null = null;
  const walk = (list: OrganizationHierarchyNodeDto[]) => {
    for (const node of list) {
      const from = node.unit.effectiveFrom;
      if (from && (min === null || from < min)) min = from;
      walk(node.children);
    }
  };
  walk(nodes);
  return min;
}

/**
 * Returns the set of unit ids to show for the current search term (matches plus their ancestors and
 * descendants), or null when there is no term (show everything). Keeps a matched unit's surrounding
 * hierarchy visible so the result stays navigable.
 */
function searchVisibility(
  roots: OrganizationHierarchyNodeDto[],
  term: string
): Set<string> | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  const visible = new Set<string>();
  const walk = (
    node: OrganizationHierarchyNodeDto,
    ancestorMatched: boolean
  ): boolean => {
    const selfMatched = node.unit.name.toLowerCase().includes(needle);
    let descendantMatched = false;
    for (const child of node.children) {
      if (walk(child, ancestorMatched || selfMatched)) descendantMatched = true;
    }
    if (selfMatched || descendantMatched || ancestorMatched)
      visible.add(node.unit.id);
    return selfMatched || descendantMatched;
  };
  for (const root of roots) walk(root, false);
  return visible;
}
