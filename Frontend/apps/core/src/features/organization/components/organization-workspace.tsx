"use client";

import { useOrganizationEvents } from "./organization-words";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@repo/ds";
import { PagePermissionNotice } from "@repo/ds/shell";
import type { UnitStaffingDto } from "@repo/api";
import { useStaffingAccess } from "../api/use-staffing";
import { FilterFieldChip, isFilterActive, matchesField, type DataTableFilterField, type DataTableFilterState } from "@repo/ds/data-table";
import { Segmented } from "@repo/ds/choice";
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  Ban,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileOutput,
  History,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Search,
  Settings2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import {
  canManageCoreOrganization,
  canViewCoreOrganization,
  canViewTenantAdministration,
  useAuth,
} from "@repo/auth";
import type {
  OrganizationUnitStateDto,
} from "@repo/api";
import { useTenantAccessSummary } from "@/features/tenant-access/api/use-tenant-access";
import {
  useOrganizationHierarchy,
  useOrganizationHistory,
  useOrganizationMutations,
  useOrganizationReadiness,
  useOrganizationSearch,
  useOrganizationTypes,
  useOrganizationUnit,
  useOrganizationUpcomingChanges,
} from "../api/use-organization";
import {
  buildOrganizationHierarchy,
  type OrganizationHierarchyModel,
} from "../model/hierarchy";
import {
  readOrganizationUrlState,
  organizationLocalReducer,
  todayCalendarDate,
  writeOrganizationUrlState,
  type OrganizationLocalState,
  type OrganizationUrlState,
} from "../model/workspace-state";
import { useOrganizationImportApi } from "@/features/organization-import/api/use-organization-import";
import { downloadBlob } from "@/features/organization-import/model/format";
import { OrganizationList } from "./organization-list";
import {
  CorrectionPanel,
  CreateTypeDialog,
  InactivateDialog,
  ManageTypesPanel,
  MoveReviewDialog,
  RootEstablishment,
  UnitFormPanel,
  UpcomingChangesSheet,
} from "./organization-surfaces";
import { useRecentRecord } from "@repo/api/react";
import OrganizationChart from "./organization-chart";

const EMPTY_REVEAL: ReadonlySet<string> = new Set();

/** The structure's top three levels: everything under the third level folds under its unit. */
function topLevelsFold(model: OrganizationHierarchyModel) {
  return new Set(model.units
    .filter((unit) => model.depthById.get(unit.id) === 2 && (model.childrenByParent.get(unit.id)?.length ?? 0) > 0)
    .map((unit) => unit.id));
}

function StructureSkeleton() {
  return (
    <div className="grid min-h-[560px] place-items-center bg-section">
      <div className="space-y-12">
        <Skeleton className="mx-auto h-24 w-56 rounded-surface" />
        <div className="flex gap-16">
          <Skeleton className="h-24 w-56 rounded-surface" />
          <Skeleton className="h-24 w-56 rounded-surface" />
          <Skeleton className="h-24 w-56 rounded-surface" />
        </div>
      </div>
    </div>
  );
}

function InspectorContent({
  selectedId,
  asOf,
  today,
  canManage,
  readOnly,
  model,
  onClose,
  onEdit,
  onAddChild,
  onMove,
  onInactivate,
  onCorrect,
}: {
  selectedId: string;
  asOf: string;
  today: string;
  canManage: boolean;
  readOnly: boolean;
  model: OrganizationHierarchyModel;
  onClose: () => void;
  onEdit: (unit: OrganizationUnitStateDto) => void;
  onAddChild: (id: string) => void;
  onMove: (id: string) => void;
  onInactivate: (unit: OrganizationUnitStateDto) => void;
  onCorrect: (unit: OrganizationUnitStateDto, date: string) => void;
}) {
  const t = useTranslations("organization");
  const events = useOrganizationEvents();
  const [tab, setTab] = useState("details");
  const unitPages = useStaffingAccess(asOf, today).unitPages;
  const detail = useOrganizationUnit(selectedId, asOf);
  const history = useOrganizationHistory(selectedId, Boolean(selectedId));
  const unit = detail.data;
  const root = unit?.parentId === null;
  const businessEvents = (history.data ?? []).filter(
    (event) => event.businessEventKinds.length > 0
  );
  const recentEvents = businessEvents.slice(0, 3);

  return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {unit?.name ??
                model.byId.get(selectedId)?.name ??
                t("unit")}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {unit ? `${unit.typeName} · ${unit.code}` : t("loadingDetails")}
            </p>
            {unitPages ? (
              <Link
                href={`/organization/units/${encodeURIComponent(selectedId)}${asOf === today ? "" : `?asOf=${asOf}`}`}
                className="mt-2 inline-flex items-center gap-1 type-meta font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("openPage")}
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
              </Link>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("closeInspector")}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
            <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
            <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
          </TabsList>
          <TabsContent
            value="details"
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3"
          >
            {detail.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-3/4" />
              </div>
            ) : detail.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t("details.unavailable")}</AlertTitle>
                <AlertDescription>
                  {detail.error.message}
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => void detail.refetch()}
                  >
                    {t("details.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : unit ? (
              <>
                <dl className="divide-y text-sm">
                  <div className="grid grid-cols-[100px_1fr] gap-3 py-3">
                    <dt className="text-muted-foreground">{t("details.name")}</dt>
                    <dd className="font-medium">{unit.name}</dd>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-3 py-3">
                    <dt className="text-muted-foreground">{t("details.type")}</dt>
                    <dd>{unit.typeName}</dd>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-3 py-3">
                    <dt className="text-muted-foreground">{t("details.code")}</dt>
                    <dd className="font-mono text-xs">{unit.code}</dd>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-3 py-3">
                    <dt className="text-muted-foreground">{t("details.parent")}</dt>
                    <dd>{unit.parentName ?? t("details.root")}</dd>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-3 py-3">
                    <dt className="text-muted-foreground">{t("details.path")}</dt>
                    <dd className="leading-5 text-muted-foreground">
                      {unit.path}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-3 py-3">
                    <dt className="text-muted-foreground">{t("details.effective")}</dt>
                    <dd>{unit.effectiveFrom}</dd>
                  </div>
                </dl>
                {canManage && !readOnly ? (
                  <div className="mt-5 flex items-center gap-1">
                    <Button
                      size="sm"
                      className="gap-1 px-2 text-xs"
                      onClick={() => onAddChild(unit.id)}
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      {t("actions.addChild")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 px-2 text-xs"
                      onClick={() => onEdit(unit)}
                    >
                      <Pencil className="h-3.5 w-3.5 shrink-0" />
                      {t("actions.edit")}
                    </Button>
                    {!root ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 px-2 text-xs"
                        onClick={() => onMove(unit.id)}
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                        {t("actions.move")}
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 px-2 text-xs"
                          aria-label={t("actions.moreActions")}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
                          {t("actions.more")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onCorrect(unit, asOf)}>
                          <Wrench className="h-4 w-4" />
                          {t("actions.correct")}
                        </DropdownMenuItem>
                        {!root ? (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onInactivate(unit)}
                          >
                            <Ban className="h-4 w-4" />
                            {t("actions.inactivate")}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
                <div className="mt-6 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("history.recent")}
                    </p>
                    {businessEvents.length ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => setTab("history")}
                      >
                        {t("history.viewFull")}
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                  {history.isLoading ? (
                    <div className="mt-3 space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-2/3" />
                    </div>
                  ) : recentEvents.length ? (
                    <ul className="mt-3 space-y-2.5">
                      {recentEvents.map((event) => {
                        const scheduled = event.effectiveDate > today;
                        return (
                          <li
                            key={event.id}
                            className="flex items-start gap-2.5 text-xs"
                          >
                            <span
                              className={cn(
                                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                                scheduled ? "bg-warning" : "bg-primary"
                              )}
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">
                                {events.label(event)}
                              </p>
                              <p className="truncate text-muted-foreground">
                                {event.effectiveDate} · {events.context(event)}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("history.noEffective")}
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </TabsContent>
          <TabsContent
            value="history"
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3"
          >
            {history.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : history.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t("history.unavailable")}</AlertTitle>
                <AlertDescription>
                  {history.error.message}
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => void history.refetch()}
                  >
                    {t("history.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : businessEvents.length ? (
              <ol className="relative space-y-0 before:absolute before:bottom-3 before:inset-s-[5px] before:top-3 before:w-px before:bg-border">
                {businessEvents.map((event) => {
                  const scheduled = event.effectiveDate > today;
                  return (
                    <li key={event.id} className="group/history relative pb-5 ps-6">
                      <span
                        className={cn(
                          "absolute inset-s-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                          scheduled ? "bg-warning" : "bg-primary"
                        )}
                      />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">
                              {events.label(event)}
                            </p>
                            {scheduled ? (
                              <Badge variant="outline" className="text-[10px]">
                                {t("history.scheduled")}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {event.effectiveDate}
                          </p>
                          <p className="mt-1 text-xs leading-5">
                            {events.context(event)}
                          </p>
                        </div>
                        {canManage && !readOnly && unit ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="-me-1 h-7 w-7 shrink-0 text-muted-foreground opacity-0 group-hover/history:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                aria-label={t("history.actionsFor", { event: events.label(event), date: event.effectiveDate })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() =>
                                  onCorrect(unit, event.effectiveDate)
                                }
                              >
                                {t("history.correctState")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="py-12 text-center">
                <History className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  {t("history.empty")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("history.emptyDescription")}
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
  );
}

/**
 * Organization's Structure and List views: the unit hierarchy on the Organization's date (`?asOf=`), as a chart or
 * as a list, with each unit's people and head when the viewer may read them. Editing units happens here, on today.
 */
export default function OrganizationWorkspace({
  staffing,
  actionsTarget,
}: {
  staffing?: ReadonlyMap<string, UnitStaffingDto>;
  /** The page header's actions slot: Add unit and the ⋯ menu sit there, beside the view switch. */
  actionsTarget?: HTMLElement | null;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const t = useTranslations("organization");
  const events = useOrganizationEvents();
  const canView = canViewCoreOrganization(user);
  const canManage = canManageCoreOrganization(user);
  const canReadTenantName = canViewTenantAdministration(user);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = todayCalendarDate();
  const urlState = readOrganizationUrlState(
    new URLSearchParams(searchParams.toString()),
    today
  );
  const readOnly = urlState.asOf !== today;
  const [local, dispatchLocal] = useReducer(organizationLocalReducer, {
    collapsed: new Set<string>(),
    editor: null,
    createType: false,
    createdTypeId: null,
    upcomingOpen: false,
    moveProposal: null,
    inactivateUnit: null,
    cancelChange: null,
    inspectorOpen: Boolean(urlState.selectedId),
  });
  const {
    collapsed,
    editor,
    createType,
    createdTypeId,
    upcomingOpen,
    moveProposal,
    inactivateUnit,
    cancelChange,
    inspectorOpen,
  } = local;
  const patchLocal = (value: Partial<OrganizationLocalState>) =>
    dispatchLocal({ type: "patch", value });
  const deferredSearch = useDeferredValue(urlState.search);

  const readiness = useOrganizationReadiness(canView);
  // Before the structure's first day in Fusion, it reads as that first day (as the chart reads units), while the
  // counts stay on the date: the company's units fill from people's real start dates.
  const rootFirst = readiness.data?.isPermanentRootEffective ? readiness.data.permanentRootFirstEffectiveDate : null;
  const structureDate = rootFirst && urlState.asOf < rootFirst ? rootFirst : urlState.asOf;
  const hierarchy = useOrganizationHierarchy(structureDate, canView);
  const moveHierarchy = useOrganizationHierarchy(
    moveProposal?.effectiveDate ?? urlState.asOf,
    canView &&
      moveProposal !== null &&
      moveProposal.effectiveDate !== urlState.asOf
  );
  const upcoming = useOrganizationUpcomingChanges(
    canView && readiness.data?.hasPermanentRoot === true
  );
  const search = useOrganizationSearch(deferredSearch, structureDate, canView);
  const tenantSummary = useTenantAccessSummary(
    canView && canReadTenantName && readiness.data?.hasPermanentRoot === false
  );
  const needTypes = editor !== null || createType;
  const types = useOrganizationTypes(canView && needTypes);
  const mutations = useOrganizationMutations();
  const importApi = useOrganizationImportApi();
  const cancelUnit = useOrganizationUnit(
    cancelChange?.orgUnitId ?? null,
    cancelChange?.effectiveDate ?? today,
    canView && cancelChange !== null
  );

  const model = useMemo(
    () => (hierarchy.data ? buildOrganizationHierarchy(hierarchy.data) : null),
    [hierarchy.data]
  );
  const moveModel = useMemo(
    () =>
      !moveProposal || moveProposal.effectiveDate === urlState.asOf
        ? model
        : moveHierarchy.data
          ? buildOrganizationHierarchy(moveHierarchy.data)
          : null,
    [model, moveHierarchy.data, moveProposal, urlState.asOf]
  );

  function navigate(next: Partial<OrganizationUrlState>) {
    const state = { ...urlState, ...next };
    const query = writeOrganizationUrlState(state, today).toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  useEffect(() => {
    if (!model || hierarchy.isFetching || !urlState.selectedId) return;
    if (!model.byId.has(urlState.selectedId)) {
      navigate({ selectedId: null });
      patchLocal({ inspectorOpen: false });
    }
    // Selection is reconciled only after this exact as-of hierarchy resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, hierarchy.isFetching, urlState.selectedId]);

  // The structure opens on its top three levels (the company, its business units and what's under them); deeper
  // levels fold under their unit until someone opens them. Once per visit, so a person's own folding stays.
  // The chart waits for this first fold, so it frames the folded tree rather than the whole one.
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    if (!model || folded) return;
    setFolded(true);
    if (!urlState.selectedId) patchLocal({ collapsed: topLevelsFold(model) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // ── The structure's own controls: how deep it opens, and the same filter chips as People and the list ──
  const [depth, setDepth] = useState<"top" | "all">("top");
  const [structureFilters, setStructureFilters] = useState<DataTableFilterState>({});
  const structureFields = useMemo<DataTableFilterField<OrganizationUnitStateDto>[]>(() => {
    const types = [...new Map((model?.units ?? []).map((unit) => [unit.typeId, unit.typeName])).entries()];
    const fields: DataTableFilterField<OrganizationUnitStateDto>[] = [
      { id: "type", label: t("outline.type"), type: "options", options: types.map(([id, name]) => ({ value: id, label: name })), value: (unit) => unit.typeId },
    ];
    if (staffing) {
      fields.push(
        { id: "head", label: t("outline.head"), type: "options", single: true, options: [
          { value: "set", label: t("filters.hasHead"), match: (unit) => Boolean(staffing.get(unit.id)?.head) },
          { value: "none", label: t("filters.noHead"), match: (unit) => !staffing.get(unit.id)?.head },
        ] },
        { id: "people", label: t("outline.people"), type: "options", single: true, options: [
          { value: "some", label: t("filters.hasPeople"), match: (unit) => (staffing.get(unit.id)?.people ?? 0) > 0 },
          { value: "none", label: t("filters.empty"), match: (unit) => (staffing.get(unit.id)?.people ?? 0) === 0 },
        ] },
      );
    }
    return fields;
  }, [model, staffing, t]);
  const matching = useMemo(() => {
    if (!model || !structureFields.some((field) => isFilterActive(structureFilters[field.id]))) return null;
    return new Set(model.units
      .filter((unit) => structureFields.every((field) => matchesField(field, structureFilters[field.id], unit)))
      .map((unit) => unit.id));
  }, [model, structureFields, structureFilters]);

  // The root opens by default, so only units the person moved to count as opened.
  const openedUnit =
    model && urlState.selectedId && !model.roots.includes(urlState.selectedId)
      ? model.byId.get(urlState.selectedId)
      : undefined;
  useRecentRecord(
    "core",
    openedUnit
      ? { label: openedUnit.name, kind: t("recentKind"), href: `/core/organization?unit=${encodeURIComponent(openedUnit.id)}` }
      : null,
  );

  function select(id: string) {
    if (model) dispatchLocal({ type: "reveal", model, id });
    patchLocal({ inspectorOpen: true });
    navigate({ selectedId: id });
  }

  function toggle(id: string) {
    dispatchLocal({ type: "toggle-collapse", id });
  }

  // After a successful structural action (import, add), the affected units are
  // carried in a `?reveal=` param. Deriving the highlight from the URL rather than
  // component state keeps it resilient across the navigation/refetch churn that
  // follows those actions; the fade is a self-contained CSS animation, and the
  // param is dropped after the window so a later refresh is quiet.
  // After a successful structural action, the affected units arrive as `?reveal=`.
  // Capture them into state on first sight and immediately drop the param — the
  // highlight then runs entirely from state, immune to the URL churn (soft
  // navigations, refetches) that follows those actions. The highlight is a bounded
  // state, not a one-shot animation: it holds for the reveal window, then clears,
  // and the node's own box-shadow transition fades the halo out — robust even
  // across the node remounts React Flow performs during the reveal viewport move.
  const revealParam = searchParams.get("reveal");
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(EMPTY_REVEAL);
  useEffect(() => {
    if (!revealParam) return;
    const ids = revealParam.split(",").map((value) => value.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setRevealedIds(new Set(ids));
    // The param is left in the URL (harmless — the window is bounded here, and the
    // next selection/date/view change drops it through `navigate`). Stripping it
    // in this effect would re-run the effect and clear the timer prematurely.
    const timer = setTimeout(() => setRevealedIds(EMPTY_REVEAL), 2600);
    return () => clearTimeout(timer);
    // Capture once per distinct reveal param value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealParam]);
  const revealKey = useMemo(() => [...revealedIds].sort().join(","), [revealedIds]);

  // Expand collapsed ancestors so the revealed units are actually visible.
  useEffect(() => {
    if (!model || revealKey === "") return;
    for (const id of revealKey.split(",")) {
      if (model.byId.has(id)) dispatchLocal({ type: "reveal", model, id });
    }
  }, [model, revealKey]);

  // Reveal a set of units by carrying them in the URL (used by manual Add so it
  // shares the exact import reveal/highlight mechanism).
  const revealUnits = useCallback(
    (ids: string[], selectId?: string) => {
      const params = writeOrganizationUrlState(
        { ...urlState, selectedId: selectId ?? urlState.selectedId },
        today
      );
      if (ids.length > 0) params.set("reveal", ids.join(","));
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      if (selectId && model) dispatchLocal({ type: "reveal", model, id: selectId });
      if (selectId) patchLocal({ inspectorOpen: true });
    },
    // urlState/model are read fresh; patchLocal/dispatchLocal are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, router, today, urlState, model]
  );

  function addChild(id: string) {
    if (!readOnly && canManage)
      patchLocal({ editor: { kind: "unit-form", mode: { kind: "add", parentId: id } } });
  }
  function stageMove(
    id: string,
    targetId: string | null,
    entry: "drag" | "explicit" = "explicit"
  ) {
    if (!model) return;
    const unit = model.byId.get(id);
    if (!unit) return;
    patchLocal({
      moveProposal: {
        sourceId: id,
        fromParentId: unit.parentId,
        toParentId: targetId,
        effectiveDate: today,
        version: unit.version,
        subordinateCount: model.descendantsById.get(id)?.size ?? 0,
        entry,
        error: null,
      },
    });
  }

  if (authLoading)
    return (
      <div className="p-6">
        <StructureSkeleton />
      </div>
    );
  if (!canView)
    return (
      <div className="p-6">
        <PagePermissionNotice
          title={t("access.title")}
          description={t("access.description")}
        />
      </div>
    );

  const futureRoot =
    readiness.data?.hasPermanentRoot &&
    !readiness.data.isPermanentRootEffective &&
    readiness.data.permanentRootFirstEffectiveDate;
  const futureChanges = (upcoming.data ?? []).filter(
    (change) => !change.isCancelled && change.effectiveDate > today
  );

  async function exportStructure() {
    try {
      const blob = await importApi.exportStructure(urlState.asOf);
      downloadBlob(blob, `Fusion-organization-${urlState.asOf}.xlsx`);
    } catch {
      toast.error(t("export.failed"), {
        description: t("export.failedDescription"),
      });
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {readiness.isLoading ? (
        <div className="flex-1 p-6">
          <StructureSkeleton />
        </div>
      ) : readiness.error ? (
        <div className="grid flex-1 place-items-center px-6">
          <Alert variant="destructive" className="max-w-xl">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("unresolved")}</AlertTitle>
            <AlertDescription>
              {readiness.error.message}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void readiness.refetch()}
              >
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : readiness.data && !readiness.data.hasPermanentRoot ? (
        <RootEstablishment
          canManage={canManage}
          today={today}
          tenantName={tenantSummary.data?.tenantName ?? null}
          mutations={mutations}
          onCreated={(id, effectiveDate) => {
            if (effectiveDate === today)
              navigate({ selectedId: id, representation: "chart" });
            else navigate({ asOf: effectiveDate, selectedId: id });
          }}
        />
      ) : futureRoot && urlState.asOf < futureRoot ? (
        <div className="mx-auto flex flex-1 max-w-2xl flex-col justify-center px-6">
          <div className="mb-5 grid h-11 w-11 place-items-center rounded-control bg-warning-subtle text-warning">
            <CalendarDays className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold">
            {t("scheduledRoot.title", { date: futureRoot })}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("scheduledRoot.description")}
          </p>
          <Button
            className="mt-5 w-fit"
            onClick={() =>
              navigate({
                asOf: futureRoot,
                selectedId: readiness.data?.permanentRootId ?? null,
              })
            }
          >
            {t("scheduledRoot.view")}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className={cn("flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3", urlState.representation === "outline" && "hidden")}>
            <div className="relative min-w-[280px] max-w-lg flex-1">
              <Search className="pointer-events-none absolute inset-s-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t("search.label")}
                value={urlState.search}
                onChange={(event) => navigate({ search: event.target.value })}
                placeholder={t("search.placeholder")}
                className="ps-9 pe-9"
              />
              {urlState.search ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("search.clear")}
                  onClick={() => navigate({ search: "" })}
                  className="absolute inset-e-1 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
              {urlState.search.trim().length >= 2 ? (
                <div className="absolute inset-s-0 inset-e-0 top-[calc(100%+6px)] z-30 max-h-80 overflow-y-auto rounded-surface border bg-popover p-1 shadow-overlay">
                  {search.isLoading ? (
                    <div className="space-y-2 p-3">
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ) : search.data?.length ? (
                    search.data.map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => {
                          select(unit.id);
                          navigate({ search: "", selectedId: unit.id });
                        }}
                        className="flex w-full items-start gap-3 rounded-control px-3 py-2 text-start outline-none hover:bg-muted focus-visible:bg-muted"
                      >
                        <Network className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {unit.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {unit.path} · {unit.code}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">{t("search.none")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("search.noneDescription")}
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => navigate({ search: "" })}
                      >
                        {t("search.clearSearch")}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            {urlState.representation === "chart" && model ? (
              <>
                <Segmented
                  label={t("depth.label")}
                  value={depth}
                  onChange={(next) => {
                    setDepth(next);
                    patchLocal({ collapsed: next === "all" ? new Set() : topLevelsFold(model) });
                  }}
                  options={[{ value: "top", label: t("depth.top") }, { value: "all", label: t("depth.all") }]}
                />
                {structureFields.map((field) => (
                  <FilterFieldChip
                    key={field.id}
                    field={field as DataTableFilterField<unknown>}
                    value={structureFilters[field.id]}
                    onChange={(next) => {
                      setStructureFilters((current) => ({ ...current, [field.id]: next }));
                      if (next) patchLocal({ collapsed: new Set() });
                    }}
                  />
                ))}
                {matching ? <span className="ms-auto type-meta text-muted-foreground">{t("filters.matching", { count: matching.size, total: model.units.length })}</span> : null}
              </>
            ) : null}
            {actionsTarget ? createPortal(
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label={t("toolbar.more")}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canManage && !readOnly ? (
                      <DropdownMenuItem asChild>
                        <Link href="/organization/import">
                          <Upload className="h-4 w-4" />
                          {t("toolbar.import")}
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => void exportStructure()}>
                      <FileOutput className="h-4 w-4" />
                      {t("toolbar.export")}
                    </DropdownMenuItem>
                    {futureChanges.length ? (
                      <DropdownMenuItem onClick={() => patchLocal({ upcomingOpen: true })}>
                        <Clock3 className="h-4 w-4" />
                        {t("toolbar.plannedUnits", { count: futureChanges.length })}
                      </DropdownMenuItem>
                    ) : null}
                    {canManage && !readOnly ? (
                      <DropdownMenuItem onClick={() => patchLocal({ editor: { kind: "manage-types" } })}>
                        <Settings2 className="h-4 w-4" />
                        {t("toolbar.manageTypes")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
                {canManage && !readOnly ? (
                  <Button variant="outline" onClick={() => patchLocal({ editor: { kind: "unit-form", mode: { kind: "add", parentId: null } } })}>
                    <Plus className="h-4 w-4" />
                    {t("toolbar.addUnit")}
                  </Button>
                ) : null}
              </>,
              actionsTarget
            ) : null}
          </div>
          <div className="relative flex min-h-0 flex-1">
            <main
              className="min-w-0 flex-1"
              aria-label={t("workspaceLabel")}
            >
              {hierarchy.isLoading && !hierarchy.data ? (
                <StructureSkeleton />
              ) : hierarchy.error ? (
                <div className="grid h-full place-items-center p-6">
                  <Alert variant="destructive" className="max-w-xl">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      Structure unavailable for {urlState.asOf}
                    </AlertTitle>
                    <AlertDescription>
                      {hierarchy.error.message}
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void hierarchy.refetch()}
                        >
                          {t("retry")}
                        </Button>
                        {readOnly ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate({ asOf: today })}
                          >
                            {t("returnToToday")}
                          </Button>
                        ) : null}
                      </div>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : model && model.units.length ? (
                urlState.representation === "chart" ? (
                  !folded ? <StructureSkeleton /> : <OrganizationChart
                    model={model}
                    matching={matching}
                    frameKey={`${depth}|${JSON.stringify(structureFilters)}`}
                    staffing={staffing}
                    collapsed={collapsed}
                    selectedId={urlState.selectedId}
                    revealedIds={revealedIds}
                    canManage={canManage}
                    readOnly={readOnly}
                    onSelect={select}
                    onToggle={toggle}
                    onAddChild={addChild}
                    onStageDragMove={(source, target) =>
                      stageMove(source, target, "drag")
                    }
                  />
                ) : (
                  <OrganizationList model={model} staffing={staffing} selectedId={urlState.selectedId} onSelect={select} />
                )
              ) : (
                <div className="grid h-full place-items-center">
                  <p className="text-sm text-muted-foreground">
                    {t("noUnitsForDate")}
                  </p>
                </div>
              )}
            </main>
            {model &&
            (editor !== null || (urlState.selectedId && inspectorOpen)) ? (
              <aside
                className="min-h-0 w-[360px] shrink-0 border-s bg-card max-xl:absolute max-xl:inset-y-0 max-xl:inset-e-0 max-xl:z-20 max-xl:shadow-overlay"
                aria-label={t("panelLabel")}
              >
                {editor?.kind === "unit-form" ? (
                  <UnitFormPanel
                    mode={editor.mode}
                    today={today}
                    model={model}
                    types={types.data ?? []}
                    createdTypeId={createdTypeId}
                    mutations={mutations}
                    onClose={() =>
                      patchLocal({ editor: null, createdTypeId: null })
                    }
                    onCreateType={() => patchLocal({ createType: true })}
                    onSaved={(id, effectiveDate) => {
                      if (effectiveDate === today) revealUnits([id], id);
                    }}
                  />
                ) : editor?.kind === "correction" ? (
                  <CorrectionPanel
                    unit={editor.unit}
                    effectiveDate={editor.date}
                    model={model}
                    types={types.data ?? []}
                    mutations={mutations}
                    onClose={() => patchLocal({ editor: null })}
                    onDone={() => void hierarchy.refetch()}
                  />
                ) : editor?.kind === "manage-types" ? (
                  <ManageTypesPanel
                    types={types.data ?? []}
                    mutations={mutations}
                    onClose={() => patchLocal({ editor: null })}
                    onCreateType={() => patchLocal({ createType: true })}
                  />
                ) : urlState.selectedId && inspectorOpen ? (
                  <InspectorContent
                    selectedId={urlState.selectedId}
                    asOf={structureDate}
                    today={today}
                    canManage={canManage}
                    readOnly={readOnly}
                    model={model}
                    onClose={() => {
                      patchLocal({ inspectorOpen: false });
                      navigate({ selectedId: null });
                    }}
                    onEdit={(unit) =>
                      patchLocal({ editor: { kind: "unit-form", mode: { kind: "edit", unit } } })
                    }
                    onAddChild={addChild}
                    onMove={(id) => stageMove(id, null)}
                    onInactivate={(unit) =>
                      patchLocal({ inactivateUnit: unit })
                    }
                    onCorrect={(unit, date) =>
                      patchLocal({ editor: { kind: "correction", unit, date } })
                    }
                  />
                ) : null}
              </aside>
            ) : null}
          </div>
        </>
      )}

      {model ? (
        <>
          <CreateTypeDialog
            open={createType}
            mutations={mutations}
            onOpenChange={(open) => patchLocal({ createType: open })}
            onCreated={(type) => {
              patchLocal({ createdTypeId: type.id });
              void types.refetch();
            }}
          />
          {moveProposal ? (
            <MoveReviewDialog
              proposal={moveProposal}
              today={today}
              model={moveModel ?? model}
              resolving={!moveModel || moveHierarchy.isFetching}
              mutations={mutations}
              onChange={(value) => patchLocal({ moveProposal: value })}
              onOpenChange={(open) => {
                if (!open) patchLocal({ moveProposal: null });
              }}
              onMoved={(id, effectiveDate) => {
                if (effectiveDate === today) select(id);
              }}
            />
          ) : null}
          <InactivateDialog
            unit={inactivateUnit}
            today={today}
            model={model}
            mutations={mutations}
            onOpenChange={(open) => {
              if (!open) patchLocal({ inactivateUnit: null });
            }}
            onDone={() => navigate({ selectedId: null })}
            onSelectDescendant={select}
          />
        </>
      ) : null}
      <UpcomingChangesSheet
        open={upcomingOpen}
        changes={futureChanges}
        canManage={canManage}
        today={today}
        mutations={mutations}
        onOpenChange={(open) => patchLocal({ upcomingOpen: open })}
        onViewDate={(date) => navigate({ asOf: date })}
        onCancel={(change) => patchLocal({ cancelChange: change })}
      />
      {cancelChange ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) patchLocal({ cancelChange: null });
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("cancelChange.title", { event: events.label(cancelChange).toLowerCase() })}
              </DialogTitle>
              <DialogDescription>
                {t("cancelChange.description", { unit: cancelChange.unitName, date: cancelChange.effectiveDate })}
              </DialogDescription>
            </DialogHeader>
            {cancelUnit.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t("cancelChange.versionUnavailable")}</AlertTitle>
                <AlertDescription>{cancelUnit.error.message}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => patchLocal({ cancelChange: null })}
              >
                {t("cancelChange.keep")}
              </Button>
              <Button
                variant="destructive"
                disabled={!cancelUnit.data || mutations.cancelChange.isLoading}
                onClick={async () => {
                  if (!cancelUnit.data || mutations.cancelChange.isLoading)
                    return;
                  try {
                    await mutations.cancelChange.mutateAsync({
                      id: cancelChange.id,
                      version: cancelUnit.data.version,
                    });
                    toast.success(t("cancelChange.cancelled"));
                    patchLocal({ cancelChange: null });
                  } catch {
                    return;
                  }
                }}
              >
                {t("cancelChange.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
