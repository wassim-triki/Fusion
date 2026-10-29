"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, Briefcase, Maximize, Minus, Play, Plus, Search, Square, X } from "lucide-react";
import type { ChangePersonRef, OrgChartDto, OrgChartOpenRoleDto, OrgChartPersonDto, WorkforceChangeDto } from "@repo/api";
import {
  canAccessCorePeople,
  canEnterPerformance,
  canAccessCoreTeam,
  canManageCoreEmployees,
  canManageCoreReporting,
  useAuth,
} from "@repo/auth";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  cn,
} from "@repo/ds";
import { FilterChips, Segmented } from "@repo/ds/choice";
import { PageHeader, PagePermissionNotice } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import { canAccessEmployeeRoster } from "@/lib/employee-roster-access";
import { useOrgChart, useOrgChartBranches, useOrgChartChanges, useOrgChartSearch, usePrefetchOrgChart, useReviewProgress } from "../api/use-org-chart";
import { useOrgChartAccess } from "../api/use-org-chart-access";
import {
  HR_LENSES,
  MAX_ZOOM,
  MIN_ZOOM,
  addDays,
  boundsOf,
  buildTree,
  centerOn,
  createLens,
  dayAt,
  dayIndex,
  dottedPath,
  edgePath,
  fitTo,
  fitTop,
  isInBranchOf,
  isMore,
  isOrderedLens,
  isPlaceholder,
  isRole,
  isoDay,
  layoutChart,
  litLine,
  mergeWindows,
  monthTicks,
  parentOf,
  replaySteps,
  roleId,
  searchPeople,
  stepFrom,
  timeWindow,
  zoomTier,
  type Camera,
  type LensKey,
  type LensWords,
  type OrgTree,
  type OrgView,
} from "../model/org-chart-model";
import { ChainPill, LeadCard, MoreCard, OrgAvatar, PersonCard, RoleCard, type CardContext } from "./org-chart-cards";
import { OpenRolePanel, type OpenRoleDraft } from "./open-role-panel";
import { ChangePanel, type ChangeDraft, type ChangeKind } from "@/features/people/changes/change-panel";
import { ComingUpCard } from "@/features/people/changes/coming-up";
import { useChangeRights, useUpcomingChanges } from "@/features/people/changes/use-changes";

const PANEL_WIDTH = 344;
const CHANGE_PANEL_WIDTH = 452;

/** A change open in the panel slot: who, which kind, and (from a drop) the new manager, or the change being edited. */
type OpenChange = { id: string; kind: ChangeKind; managerKey: string | null; editing: WorkforceChangeDto | null };
/** An open role in the panel slot: a new one under a manager, or one being edited. */
type OpenRoleEdit = { editing: OrgChartOpenRoleDto | null; manager: ChangePersonRef; unit: { id: string; name: string } | null };
/** The dashed card a new role previews as, until it is saved. */
const DRAFT_ROLE = "draft";
const SETTLE_MS = 470;
/** Replay holds each quarter long enough for the cards to settle. */
const REPLAY_STEP_MS = 650;
/** A windowed chart asks Core HR once typing pauses. */
const SEARCH_PAUSE_MS = 200;
const NO_ROOTS: string[] = [];

type FitRequest = { mode: "fit" | "top" } | { mode: "centre"; id: string; s: number } | null;

export default function OrgChartWorkspace() {
  const t = useTranslations("orgChart");
  const { user } = useAuth();
  const access = useOrgChartAccess();
  const canView = access.canSee;
  // HR's time bar: null is today. The previous chart stays on screen while the next date loads.
  const [asOf, setAsOf] = useState<string | null>(null);
  const chart = useOrgChart(asOf);

  if (access.isLoading) return <Frame title={t("title")}><StageSkeleton /></Frame>;
  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title={t("title")} />
        <PagePermissionNotice
          title={t(access.narrowed ? "access.narrowed.title" : "access.title")}
          description={t(access.narrowed ? "access.narrowed.description" : "access.description")}
        />
      </div>
    );
  }
  if (chart.isLoading || (!chart.data && !chart.error)) return <Frame title={t("title")}><StageSkeleton /></Frame>;
  if (chart.error || !chart.data) {
    return (
      <Frame title={t("title")}>
        <div className="grid flex-1 place-items-center bg-section px-6">
          <Alert variant="destructive" className="max-w-xl">
            <AlertTriangle className="size-4" />
            <AlertTitle>{t("states.error")}</AlertTitle>
            <AlertDescription>
              {chart.error?.message}
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void chart.refetch()}>
                {t("states.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </Frame>
    );
  }
  if (!chart.data.people.length) {
    return (
      <Frame title={t("title")}>
        <div className="grid flex-1 place-items-center bg-section px-6">
          <div className="grid justify-items-center gap-3">
            <p className="type-body-secondary">{t("states.empty")}</p>
            {canAccessEmployeeRoster(user) ? (
              <Button asChild variant="outline" size="sm"><Link href="/people">{t("states.emptyAction")}</Link></Button>
            ) : null}
          </div>
        </div>
      </Frame>
    );
  }
  return <OrgChart data={chart.data} asOf={asOf} onAsOf={setAsOf} />;
}

function Frame({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[680px] flex-col overflow-hidden">
      <header className="shrink-0 px-6 pt-5">
        <PageHeader title={title} description={description} actions={actions} className="mb-4" />
      </header>
      {children}
    </div>
  );
}

function StageSkeleton() {
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-y px-6 py-3">
        <Skeleton className="h-9 w-72 rounded-control" />
        <Skeleton className="h-9 w-40 rounded-control" />
      </div>
      <div className="grid flex-1 place-items-center bg-section">
        <div className="grid justify-items-center gap-10">
          <Skeleton className="h-52 w-64 rounded-surface" />
          <div className="flex gap-12">
            <Skeleton className="h-20 w-64 rounded-surface" />
            <Skeleton className="h-20 w-64 rounded-surface" />
          </div>
        </div>
      </div>
    </>
  );
}

function OrgChart({ data, asOf, onAsOf }: { data: OrgChartDto; asOf: string | null; onAsOf: (date: string | null) => void }) {
  const t = useTranslations("orgChart");
  const tc = useTranslations("changes");
  const { user } = useAuth();
  const params = useSearchParams();

  // ── Time (HR): past and future dates, upcoming changes, Replay ──
  const hr = canAccessCorePeople(user);
  const today = useMemo(() => isoDay(Date.now()), []);
  const date = asOf ?? today;
  const range = useMemo(() => timeWindow(today), [today]);
  const [replaying, setReplaying] = useState(false);
  const showsChanges = hr && !replaying && date >= range.lo && date < range.hi;
  // Review progress is today's, from Performance: offered to anyone who can enter it, on today's chart only.
  const reviewLens = canEnterPerformance(user) && date === today;
  const changes = useOrgChartChanges(addDays(date, 1), range.hi, showsChanges);
  const upcoming = showsChanges ? changes.data : undefined;

  // ── Above 3,000 people the chart is a window; branches load as people open them, for the chart's date ──
  const windowed = data.window !== null;
  const [opened, setOpened] = useState<{ asOf: string | null; roots: string[] }>({ asOf, roots: [] });
  const roots = windowed && opened.asOf === asOf ? opened.roots : NO_ROOTS;
  const branches = useOrgChartBranches(asOf, roots);
  const loadBranch = useCallback((key: string) => {
    setOpened((current) => {
      const list = current.asOf === asOf ? current.roots : [];
      return list.includes(key) ? current : { asOf, roots: [...list, key] };
    });
  }, [asOf]);
  const loading = useMemo(() => new Set(roots.filter((_, index) => branches.status[index] === "loading")), [roots, branches.status]);
  const failed = useMemo(() => roots.filter((_, index) => branches.status[index] === "failed"), [roots, branches.status]);
  useEffect(() => {
    if (!failed.length) return;
    toast.error(t("states.branchError"));
    setOpened((current) => ({ ...current, roots: current.roots.filter((root) => !failed.includes(root)) }));
  }, [failed, t]);
  const merged = useMemo(() => mergeWindows(data, branches.windows), [data, branches.windows]);

  // ── A change in the panel: the chart itself previews where the person (and their team) will sit ──
  const rights = useChangeRights();
  const records = useUpcomingChanges(rights.seeComing && hr);
  const [change, setChange] = useState<OpenChange | null>(null);
  const [draft, setDraft] = useState<ChangeDraft | null>(null);
  const [roleEdit, setRoleEdit] = useState<OpenRoleEdit | null>(null);
  const [roleDraft, setRoleDraft] = useState<OpenRoleDraft | null>(null);
  const withRoleDraft = useMemo(() => {
    if (!roleEdit || !roleDraft) return merged;
    const id = roleEdit.editing?.id ?? DRAFT_ROLE;
    const shown = roleDraft.status === "Open" || roleDraft.status === "OnHold";
    const card: OrgChartOpenRoleDto = {
      id,
      jobTitle: roleDraft.jobTitle || t("role.untitled"),
      managerKey: roleDraft.managerKey,
      unit: roleDraft.unitName ? { id: "", name: roleDraft.unitName, divisionId: null, divisionName: null } : null,
      targetStartDate: roleDraft.targetStartDate,
      status: roleDraft.status,
    };
    const others = merged.openRoles.filter((role) => role.id !== id);
    return { ...merged, openRoles: shown ? [...others, card] : others };
  }, [merged, roleEdit, roleDraft, t]);
  const previewed = useMemo(() => {
    const data = withRoleDraft;
    if (!change || !draft) return data;
    const subject = data.people.find((person) => person.employeeKey === change.id);
    if (!subject || draft.managerKey === subject.managerKey && !draft.teamManagerKey) return data;
    return {
      ...data,
      people: data.people.map((person) =>
        person.employeeKey === change.id ? { ...person, managerKey: draft.managerKey }
          : draft.teamManagerKey && person.managerKey === change.id ? { ...person, managerKey: draft.teamManagerKey }
          : person),
    };
  }, [withRoleDraft, change, draft]);
  const tree = useMemo(() => buildTree(previewed, upcoming ?? []), [previewed, upcoming]);

  const requested = params.get("focus");
  const initialFocus = requested && tree.people.has(requested) ? requested : tree.viewerKey;
  const [view, setView] = useState<OrgView>(params.get("view") === "company" || !initialFocus ? "company" : "focus");
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const [chosenLens, setLensKey] = useState<LensKey>("division");
  const lensKey: LensKey = chosenLens === "review" && !reviewLens ? "division" : chosenLens;
  const progress = useReviewProgress(lensKey === "review");
  const [chosenFilter, setFilter] = useState<string | null>(null);
  // A legend filter belongs to the lens it was picked in.
  const filter = lensKey === chosenLens ? chosenFilter : null;
  const reviewByKey = useMemo(() => new Map(progress.data?.people.map((p) => [p.employeeKey, p]) ?? []), [progress.data]);
  const [selected, setSelected] = useState<string | null>(requested && tree.people.has(requested) ? requested : null);
  const [lit, setLit] = useState<string | null>(null);
  const [animate, setAnimate] = useState(true);
  const [fitRequest, setFitRequest] = useState<FitRequest>({ mode: view === "focus" ? "top" : "fit" });

  const layout = useMemo(() => layoutChart(tree, { view, focus, folded, unfolded }), [tree, view, focus, folded, unfolded]);
  const lensWords = useMemo<LensWords>(() => ({
    leadership: t("lens.leadership"),
    tenure: [t("lens.tenure0"), t("lens.tenure1"), t("lens.tenure2"), t("lens.tenure3")],
    span: [t("lens.span0"), t("lens.span1"), t("lens.span2")],
    review: [t("lens.review0"), t("lens.review1"), t("lens.review2"), t("lens.review3"), t("lens.review4"), t("lens.review5")],
  }), [t]);
  const lensOf = useMemo(() => createLens(tree, lensKey, lensWords, data.asOf, reviewByKey, data.window?.divisions),
    [tree, lensKey, lensWords, data.asOf, reviewByKey, data.window]);
  const litIds = useMemo(() => litLine(tree, lit), [tree, lit]);

  // ── Camera: transform applied straight to the world element, not through React ──
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const flight = useRef(0);
  const [tier, setTier] = useState<"near" | "mid" | "far">("near");
  const [zoomLabel, setZoomLabel] = useState("100%");

  const applyCam = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.style.transform = `translate(${cam.current.x}px, ${cam.current.y}px) scale(${cam.current.s})`;
    setTier(zoomTier(cam.current.s));
    setZoomLabel(`${Math.round(cam.current.s * 100)}%`);
  }, []);

  const flyTo = useCallback((target: Camera, ms = 560) => {
    cancelAnimationFrame(flight.current);
    const from = { ...cam.current };
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      cam.current = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, s: from.s + (target.s - from.s) * e };
      applyCam();
      if (k < 1) flight.current = requestAnimationFrame(step);
    };
    flight.current = requestAnimationFrame(step);
  }, [applyCam]);

  const viewport = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 1200, height: rect?.height ?? 700, panel: change || roleEdit ? CHANGE_PANEL_WIDTH : selected ? PANEL_WIDTH : 0 };
  }, [selected, change, roleEdit]);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    const v = viewport();
    const px = cx ?? v.width / 2;
    const py = cy ?? v.height / 2;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.current.s * factor));
    const k = s / cam.current.s;
    cancelAnimationFrame(flight.current);
    cam.current = { s, x: px - (px - cam.current.x) * k, y: py - (py - cam.current.y) * k };
    applyCam();
  }, [applyCam, viewport]);

  useLayoutEffect(() => {
    if (!fitRequest) return;
    const v = viewport();
    if (fitRequest.mode === "centre") {
      const node = layout.nodes.get(fitRequest.id);
      if (node) flyTo(centerOn(node, v, fitRequest.s), 700);
    } else {
      const bounds = boundsOf(layout.nodes);
      flyTo(fitRequest.mode === "top" ? fitTop(bounds, v) : fitTo(bounds, v));
    }
    setFitRequest(null);
  }, [fitRequest, layout, flyTo, viewport]);

  // Edges wait for the cards to settle in their new places.
  const [edgesShown, setEdgesShown] = useState(false);
  useEffect(() => {
    setEdgesShown(false);
    const timer = window.setTimeout(() => setEdgesShown(true), animate ? SETTLE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [layout, animate]);

  // Wheel zooms around the pointer.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("[data-oc-overlay]")) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Drag pans; a drag never counts as a click on what it started on.
  const dragged = useRef(false);
  const [panning, setPanning] = useState(false);

  // ── Drag to change manager (HR who manage people, today or later) ──
  const movable = (canManageCoreEmployees(user) || canManageCoreReporting(user)) && date >= today && !replaying;
  type CardDrag = { id: string; x: number; y: number; over: string | null; target: string | null; refused: string | null };
  const cardDrag = useRef<CardDrag | null>(null);
  const [drag, setDrag] = useState<CardDrag | null>(null);
  /** A new manager must be on the chart today, outside the person's own branch, and not their manager already. */
  const canReportTo = (id: string, manager: string) =>
    manager !== id && tree.people.has(manager) && !tree.ghosts.has(manager)
    && !isInBranchOf(tree, manager, id) && tree.people.get(id)?.managerKey !== manager;
  /** Why a drop is refused, in the chip under the pointer (the server refuses the same). */
  const refusedBecause = (id: string, manager: string) => {
    const name = (key: string) => (tree.people.get(key)?.displayName ?? "").split(" ")[0] ?? "";
    if (manager === id || !tree.people.has(manager)) return null;
    if (tree.people.get(id)?.managerKey === manager) return tc("refused.already", { name: tree.people.get(manager)?.displayName ?? "" });
    if (isInBranchOf(tree, manager, id)) return tc("refused.inBranch", { target: name(manager), name: name(id) });
    return null;
  };

  function startCardDrag(event: React.PointerEvent, id: string) {
    const stage = stageRef.current!.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    dragged.current = false;
    const move = (e: PointerEvent) => {
      if (!dragged.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 5) return;
      dragged.current = true;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-oc-id]")?.dataset.ocId ?? null;
      const target = over && canReportTo(id, over) ? over : null;
      cardDrag.current = { id, x: e.clientX - stage.left, y: e.clientY - stage.top, over, target, refused: over && !target ? refusedBecause(id, over) : null };
      setDrag(cardDrag.current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const dropped = cardDrag.current;
      cardDrag.current = null;
      setDrag(null);
      if (dropped?.target) {
        setSelected(null);
        setChange({ id: dropped.id, kind: "job", managerKey: dropped.target, editing: null });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-oc-overlay]")) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-oc-drag]");
    if (movable && card && !(event.target as HTMLElement).closest("button")) {
      startCardDrag(event, card.dataset.ocId!);
      return;
    }
    cancelAnimationFrame(flight.current);
    const start = { x: event.clientX, y: event.clientY, cx: cam.current.x, cy: cam.current.y };
    dragged.current = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged.current && Math.hypot(dx, dy) <= 5) return;
      if (!dragged.current) setPanning(true);
      dragged.current = true;
      cam.current = { ...cam.current, x: start.cx + dx, y: start.cy + dy };
      applyCam();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── Actions ──
  const relayout = (fit: FitRequest, still = false) => {
    setAnimate(!still);
    setFitRequest(fit);
  };
  const centreOn = (target: string) => {
    const id = isRole(target) ? parentOf(tree, target) ?? target : target;
    setView("focus");
    setFocus(id);
    setSelected(id);
    setLit(null);
    relayout({ mode: "top" });
  };
  const select = (id: string) => {
    setSelected(id);
    setLit(view === "company" ? (isRole(id) ? parentOf(tree, id) : id) : null);
    setAnimate(false);
  };
  const [arriving, setArriving] = useState<string | null>(null);
  const goTo = (id: string) => {
    setQuery("");
    if (!tree.people.has(id)) {
      loadBranch(id);
      setArriving(id);
      return;
    }
    if (view === "focus") {
      centreOn(id);
      return;
    }
    setSelected(id);
    setLit(id);
    setFolded((current) => {
      const next = new Set(current);
      for (let up = parentOf(tree, id); up; up = parentOf(tree, up)) next.delete(up);
      return next;
    });
    relayout({ mode: "centre", id, s: 0.9 });
  };
  // The latest goTo, for when the branch arrives (Next's bundled React has no useEffectEvent yet).
  const goToLatest = useRef(goTo);
  useEffect(() => { goToLatest.current = goTo; });
  useEffect(() => {
    if (!arriving || !tree.people.has(arriving)) return;
    setArriving(null);
    goToLatest.current(arriving);
  }, [arriving, tree]);
  // A link to someone outside the first window loads them.
  const missing = requested && windowed && !tree.people.has(requested) ? requested : null;
  useEffect(() => {
    if (!missing) return;
    loadBranch(missing);
    setArriving(missing);
  }, [missing, loadBranch]);
  // Around someone shows their whole team.
  const aroundRoot = view === "focus" ? layout.root : null;
  useEffect(() => {
    if (aroundRoot && tree.loadable.has(aroundRoot)) loadBranch(aroundRoot);
  }, [aroundRoot, tree, loadBranch]);

  const toggleFold = (id: string) => {
    if (tree.unopened.has(id)) {
      loadBranch(id);
      if (view === "focus") setUnfolded((current) => new Set(current).add(id));
      else setFolded((current) => { const next = new Set(current); next.delete(id); return next; });
      relayout(null);
      return;
    }
    const flip = (current: Set<string>) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };
    if (view === "focus") {
      setUnfolded((current) => (layout.folded.has(id) ? new Set(current).add(id) : flip(current)));
    } else setFolded(flip);
    relayout(null);
  };
  const switchView = (next: OrgView) => {
    if (next === "focus" && view === "focus") setFocus(tree.viewerKey);
    if (next === "focus" && !focus) setFocus(tree.viewerKey);
    setView(next);
    setLit(null);
    relayout({ mode: next === "focus" ? "top" : "fit" });
  };
  const replayRun = useRef(0);
  const prefetch = usePrefetchOrgChart();
  const stopReplay = () => {
    replayRun.current += 1;
    setReplaying(false);
  };
  const changeDate = (next: string) => {
    stopReplay();
    setAnimate(true);
    onAsOf(next === today ? null : next);
  };
  /** Replay: the company from its first day to today, a quarter at a time, the camera fitting it as it grows. */
  const replay = async () => {
    if (replaying) {
      stopReplay();
      return;
    }
    const starts = data.people.map((p) => p.startDate).filter((d): d is string => Boolean(d)).sort();
    const first = data.window?.firstStartDate ?? starts[0] ?? today;
    const run = ++replayRun.current;
    setReplaying(true);
    setView("company");
    setSelected(null);
    setLit(null);
    for (const step of replaySteps(first, today)) {
      await prefetch(step).catch(() => undefined);
      if (replayRun.current !== run) return;
      onAsOf(step === today ? null : step);
      relayout({ mode: "fit" });
      await new Promise((resolve) => window.setTimeout(resolve, REPLAY_STEP_MS));
      if (replayRun.current !== run) return;
    }
    setReplaying(false);
  };
  useEffect(() => {
    const run = replayRun;
    return () => { run.current += 1; };
  }, []);

  const copyEmail = (person: OrgChartPersonDto) => {
    if (!person.workEmail) return;
    void navigator.clipboard?.writeText(person.workEmail).then(() => toast.success(t("card.copied")));
  };

  const ctx: CardContext = {
    tree, lensKey, lensOf, folded: layout.folded, loading,
    onCopyEmail: copyEmail, onCentre: centreOn, onToggleFold: toggleFold,
  };

  // ── Keyboard: Enter selects; arrows move to the manager, reports and peers ──
  function onNodeKey(event: KeyboardEvent<HTMLDivElement>, id: string, kind: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (kind === "chain") centreOn(id);
      else if (!isMore(id)) select(id);
      else if (tree.loadable.has(parentOf(tree, id)!)) loadBranch(parentOf(tree, id)!);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = isMore(id) ? null : stepFrom(tree, id, event.key);
    if (!next) return;
    if (!layout.nodes.has(next)) {
      centreOn(next);
      return;
    }
    setSelected(next);
    setLit(view === "company" ? next : null);
    setAnimate(false);
    flyTo(centerOn(layout.nodes.get(next)!, viewport(), cam.current.s), 360);
    requestAnimationFrame(() => stageRef.current?.querySelector<HTMLElement>(`[data-oc-id="${CSS.escape(next)}"]`)?.focus({ preventScroll: true }));
  }

  // ── Search ──
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(query.trim()), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);
  const found = useOrgChartSearch(asOf, term, windowed);
  const searching = windowed && (term !== query.trim() || found.isFetching);
  const local = useMemo(() => searchPeople(tree, query), [tree, query]);
  const hits = windowed ? (term ? (found.data ?? []) : []) : local;
  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && hits.length) {
      event.preventDefault();
      setHit((current) => (current + (event.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    }
    if (event.key === "Enter" && hits[hit]) {
      event.preventDefault();
      goTo(hits[hit]!.employeeKey);
    }
    if (event.key === "Escape") setQuery("");
  }

  // ── Legend ──
  const legend = useMemo(() => {
    if (lensKey === "none") return [];
    const counts = new Map<string, { key: string; label: string; color: string | null; n: number }>();
    for (const [id, node] of layout.nodes) {
      if (node.kind === "chain" || node.kind === "more") continue;
      const lens = lensOf(id);
      if (!lens) continue;
      const entry = counts.get(lens.key) ?? { ...lens, n: 0 };
      entry.n += 1;
      counts.set(lens.key, entry);
    }
    return [...counts.values()].sort((a, b) => isOrderedLens(lensKey) ? a.key.localeCompare(b.key)
      : a.key === "lead" ? -1 : b.key === "lead" ? 1 : a.label.localeCompare(b.label));
  }, [layout, lensOf, lensKey]);

  const divisions = useMemo(() => data.window?.divisions.length ?? new Set(data.people.map((p) => p.unit?.divisionId).filter(Boolean)).size, [data]);
  const headcount = data.window?.headcount ?? data.people.length;
  const openCount = data.openRoles.filter((role) => role.status === "Open").length;
  /** HR who manage people add and edit open roles, on today's chart or later. */
  const managesRoles = rights.people && date >= today && !replaying;
  const closeRole = () => { setRoleEdit(null); setRoleDraft(null); };
  const addRoleUnder = (person: OrgChartPersonDto) => {
    setSelected(null);
    setChange(null);
    setRoleEdit({
      editing: null,
      manager: { employeeId: "", employeeKey: person.employeeKey, displayName: person.displayName },
      unit: person.unit ? { id: person.unit.id, name: person.unit.name } : null,
    });
  };
  const editRole = (role: OrgChartOpenRoleDto) => {
    const manager = tree.people.get(role.managerKey);
    setSelected(null);
    setRoleEdit({
      editing: role,
      manager: { employeeId: "", employeeKey: role.managerKey, displayName: manager?.displayName ?? "" },
      unit: role.unit ? { id: role.unit.id, name: role.unit.name } : null,
    });
  };
  const focusPerson = focus ? tree.people.get(focus) : undefined;
  const aroundLabel = !focus || focus === tree.viewerKey ? t("views.aroundYou") : t("views.aroundName", { name: focusPerson?.displayName.split(" ")[0] ?? "" });
  const bounds = boundsOf(layout.nodes);

  const profileHref = (person: OrgChartPersonDto): string | null => {
    if (person.employeeKey === tree.viewerKey) return "/profile";
    if (canAccessEmployeeRoster(user)) return `/people/${person.employeeKey}`;
    if (canAccessCoreTeam(user) && person.managerKey === tree.viewerKey) return `/people/${person.employeeKey}`;
    return null;
  };

  return (
    <Frame
      title={t("title")}
      description={t("meta", { people: headcount, divisions, open: openCount })}
      actions={
        <Segmented
          label={t("views.label")}
          value={view}
          onChange={switchView}
          options={[
            ...(tree.viewerKey || focus ? [{ value: "focus" as const, label: aroundLabel }] : []),
            { value: "company" as const, label: t("views.company") },
          ]}
        />
      }
    >
      <div className="flex shrink-0 items-center gap-3 border-y px-6 py-3">
        <div className="relative w-80 max-w-full">
          <Search className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={t("search.label")}
            placeholder={t("search.label")}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setHit(0); }}
            onKeyDown={onSearchKey}
            className="ps-9"
            autoComplete="off"
          />
          {query.trim() ? (
            <div role="listbox" aria-label={t("search.label")} className="absolute inset-s-0 top-[calc(100%+6px)] z-30 grid w-[22rem] gap-0.5 rounded-menu border bg-popover p-1 shadow-overlay">
              {hits.length ? hits.map((person, index) => (
                <button
                  key={person.employeeKey}
                  type="button"
                  role="option"
                  aria-selected={index === hit}
                  onMouseEnter={() => setHit(index)}
                  onClick={() => goTo(person.employeeKey)}
                  className={cn("flex w-full items-center gap-2.5 rounded-inset px-2 py-1.5 text-start outline-none", index === hit && "bg-inlay")}
                >
                  <OrgAvatar id={person.employeeKey} size="sm" ctx={ctx} person={person} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{person.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[person.jobTitle, person.unit?.name].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              )) : searching ? (
                <p className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />{t("search.searching")}</p>
              ) : <p className="px-2.5 py-2 text-sm text-muted-foreground">{t("search.none")}</p>}
            </div>
          ) : null}
        </div>
        <Select value={lensKey} onValueChange={(value) => { setLensKey(value as LensKey); setFilter(null); setAnimate(false); }}>
          <SelectTrigger aria-label={t("lens.label")} className="w-auto gap-2">
            <span className="text-muted-foreground">{t("lens.label")}</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="division">{t("lens.division")}</SelectItem>
            <SelectItem value="location">{t("lens.location")}</SelectItem>
            {hr ? HR_LENSES.map((key) => <SelectItem key={key} value={key}>{t(`lens.${key}`)}</SelectItem>) : null}
            {reviewLens ? <SelectItem value="review">{t("lens.review")}</SelectItem> : null}
            <SelectItem value="none">{t("lens.none")}</SelectItem>
          </SelectContent>
        </Select>
        {hr ? (
          <TimeBar
            date={date}
            today={today}
            lo={range.lo}
            hi={range.hi}
            people={headcount}
            coming={new Set((upcoming ?? []).map((item) => item.employeeKey)).size}
            replaying={replaying}
            onDate={changeDate}
            onReplay={() => void replay()}
          />
        ) : null}
      </div>

      <div
        ref={stageRef}
        className={cn("oc-stage flex-1 bg-section", panning && "oc-panning")}
        onPointerDown={onPointerDown}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.stopPropagation();
            event.preventDefault();
            dragged.current = false;
          }
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest(".oc-node, [data-oc-overlay]") && selected) {
            setSelected(null);
            setLit(null);
            setAnimate(false);
          }
        }}
      >
        <div ref={worldRef} className={cn("oc-world", !animate && "oc-still", tier === "mid" && "oc-z-mid", tier === "far" && "oc-z-far")}>
          <svg className={cn("oc-edges", !edgesShown && "oc-hide")} width={Math.max(1, bounds.x1 + 80)} height={Math.max(1, bounds.y1 + 80)} aria-hidden>
            {edgesShown ? <Edges tree={tree} layout={layout} lit={litIds} /> : null}
          </svg>
          {[...layout.nodes].map(([id, node]) => {
            const lens = isPlaceholder(id) ? null : lensOf(id);
            const isChain = node.kind === "chain";
            const label = isMore(id) ? undefined : isRole(id) ? tree.roles.get(id)?.jobTitle : tree.people.get(id)?.displayName;
            const ghost = tree.ghosts.has(id);
            const loadsMore = isMore(id) && tree.loadable.has(parentOf(tree, id)!);
            return (
              <div
                key={id}
                data-oc-id={id}
                data-oc-drag={movable && !isChain && !isPlaceholder(id) && !ghost ? "" : undefined}
                role={isMore(id) && !loadsMore ? undefined : "button"}
                tabIndex={isMore(id) && !loadsMore ? -1 : 0}
                aria-label={label}
                // eslint-disable-next-line no-restricted-syntax -- a chart node toggles its own selection; not a choice among options
                aria-pressed={isMore(id) || isChain ? undefined : selected === id}
                onKeyDown={(event) => onNodeKey(event, id, node.kind)}
                onClick={() => (isChain ? centreOn(id) : loadsMore ? loadBranch(parentOf(tree, id)!) : isMore(id) ? undefined : select(id))}
                className={cn(
                  "oc-node bg-card",
                  node.kind === "lead" ? cn("oc-lead rounded-surface", node.top && "oc-top") : "oc-pc rounded-surface",
                  isChain && "oc-chain",
                  node.kind === "more" && "oc-more",
                  loadsMore && "oc-more-load",
                  node.kind === "role" && "oc-role",
                  roleEdit && id === roleId(roleEdit.editing?.id ?? DRAFT_ROLE) && "oc-draft",
                  id === tree.viewerKey && !isChain && "oc-you",
                  selected === id && "oc-sel",
                  ghost && "oc-ghost",
                  movable && !isChain && !isPlaceholder(id) && !ghost && "oc-movable",
                  drag?.id === id && "oc-lifted",
                  change && draft && change.id === id && "oc-preview",
                  drag && drag.over === id && (drag.target === id ? "oc-drop" : "oc-nodrop"),
                  filter && !isRole(id) && (!lens || lens.key !== filter) && "oc-dim",
                )}
                style={{
                  transform: `translate(${node.x}px, ${node.y}px)`,
                  width: node.w,
                  height: node.h,
                  ...(lens?.color ? ({ "--lc": lens.color } as CSSProperties) : {}),
                }}
              >
                {node.kind === "lead" ? <LeadCard id={id} ctx={ctx} />
                  : node.kind === "more" ? <MoreCard id={id} ctx={ctx} />
                  : node.kind === "role" ? <RoleCard id={id} ctx={ctx} />
                  : isChain ? <ChainPill id={id} ctx={ctx} />
                  : <PersonCard id={id} ctx={ctx} />}
              </div>
            );
          })}
        </div>

        {legend.length ? (
          <div data-oc-overlay className="absolute bottom-3.5 start-3.5 max-w-[calc(100%-10rem)]">
            <FilterChips
              type="single"
              clearable
              overlay
              label={t("lens.legend")}
              value={filter}
              onChange={(next) => { setFilter(next); setAnimate(false); }}
              options={legend.map((entry) => ({
                value: entry.key,
                label: entry.label,
                count: entry.n,
                hint: t("lens.filter", { label: entry.label }),
                icon: entry.color ? <i className="oc-swatch" style={{ background: entry.color }} /> : undefined,
              }))}
            />
          </div>
        ) : lensKey === "review" ? (
          <div data-oc-overlay className="absolute bottom-3.5 start-3.5 inline-flex h-7 items-center gap-1.5 rounded-full border bg-popover px-2.5 text-xs text-muted-foreground">
            {progress.isLoading ? <><Spinner className="size-3" />{t("lens.reviewLoading")}</>
              : progress.error ? (
                <>
                  <AlertTriangle className="size-3 text-destructive" />
                  {t("lens.reviewError")}
                  <button type="button" onClick={() => void progress.refetch()} className="font-medium text-foreground underline-offset-2 hover:underline">{t("states.retry")}</button>
                </>
              ) : t("lens.reviewNone")}
          </div>
        ) : null}

        {drag ? (
          <span className={cn("oc-dragchip rounded-control border bg-popover shadow-overlay", drag.refused && "oc-refused")} style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 14}px)` }}>
            <OrgAvatar id={drag.id} size="sm" ctx={ctx} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{tree.people.get(drag.id)?.displayName}</span>
              {drag.refused ? <span className="block truncate text-xs text-destructive">{drag.refused}</span> : null}
            </span>
          </span>
        ) : null}

        <span className="pointer-events-none absolute bottom-[18px] end-[58px] text-xs text-muted-foreground tabular-nums">{zoomLabel}</span>
        <div data-oc-overlay className="absolute bottom-3.5 end-3.5 grid overflow-hidden rounded-control border bg-popover shadow-overlay">
          <button type="button" aria-label={t("zoom.in")} onClick={() => zoomBy(1.25)} className="grid h-8 w-[34px] place-items-center text-muted-foreground hover:bg-inlay hover:text-foreground"><Plus className="size-4" /></button>
          <button type="button" aria-label={t("zoom.out")} onClick={() => zoomBy(0.8)} className="grid h-8 w-[34px] place-items-center border-t text-muted-foreground hover:bg-inlay hover:text-foreground"><Minus className="size-4" /></button>
          <button type="button" aria-label={t("zoom.fit")} onClick={() => flyTo(fitTo(boundsOf(layout.nodes), viewport()))} className="grid h-8 w-[34px] place-items-center border-t text-muted-foreground hover:bg-inlay hover:text-foreground"><Maximize className="size-4" /></button>
        </div>

        {roleEdit ? (
          <aside
            data-oc-overlay
            aria-label={roleEdit.editing?.jobTitle ?? t("role.new")}
            className="absolute inset-y-3 end-3 z-20 flex cursor-default flex-col overflow-hidden rounded-surface border bg-popover shadow-overlay"
            style={{ width: CHANGE_PANEL_WIDTH }}
          >
            <OpenRolePanel
              key={roleEdit.editing?.id ?? `new-${roleEdit.manager.employeeKey}`}
              editing={roleEdit.editing}
              manager={roleEdit.manager}
              unit={roleEdit.unit}
              onDraft={setRoleDraft}
              onClose={closeRole}
            />
          </aside>
        ) : change ? (
          <aside
            data-oc-overlay
            aria-label={tree.people.get(change.id)?.displayName}
            className="absolute inset-y-3 end-3 z-20 flex cursor-default flex-col overflow-hidden rounded-surface border bg-popover shadow-overlay"
            style={{ width: CHANGE_PANEL_WIDTH }}
          >
            <ChangePanel
              key={`${change.id}-${change.managerKey ?? ""}-${change.editing?.id ?? "new"}`}
              employeeKey={change.id}
              kind={change.kind}
              editing={change.editing}
              initialManagerKey={change.managerKey}
              onDraft={setDraft}
              onClose={() => { setChange(null); setDraft(null); }}
            />
          </aside>
        ) : selected && tree.roles.has(selected) ? (
          <RolePanel
            role={tree.roles.get(selected)!}
            tree={tree}
            canEdit={managesRoles}
            onEdit={editRole}
            onClose={() => { setSelected(null); setLit(null); setAnimate(false); }}
            onGoTo={goTo}
          />
        ) : selected && tree.people.has(selected) ? (
          <PersonPanel
            person={tree.people.get(selected)!}
            tree={tree}
            ctx={ctx}
            showCentre={view === "company" || focus !== selected}
            profileHref={profileHref(tree.people.get(selected)!)}
            coming={(records.data ?? []).filter((item) => item.person.employeeKey === selected)}
            canChangeLines={movable}
            canChangeAll={rights.people}
            canAddRole={managesRoles && !tree.ghosts.has(selected)}
            onAddRole={() => addRoleUnder(tree.people.get(selected)!)}
            onChangeJob={() => setChange({ id: selected, kind: "job", managerKey: null, editing: null })}
            onEdit={(item) => setChange({ id: selected, kind: item.kind === "EndEmployment" ? "end" : item.kind === "Join" ? "start" : "job", managerKey: null, editing: item })}
            onClose={() => { setSelected(null); setLit(null); setAnimate(false); }}
            onGoTo={goTo}
            onCentre={centreOn}
          />
        ) : null}
      </div>
    </Frame>
  );
}

/** HR's date control: the canvas's slider over the year with month ticks and Today, plus Replay. */
function TimeBar({
  date, today, lo, hi, people, coming, replaying, onDate, onReplay,
}: {
  date: string;
  today: string;
  lo: string;
  hi: string;
  people: number;
  coming: number;
  replaying: boolean;
  onDate: (date: string) => void;
  onReplay: () => void;
}) {
  const t = useTranslations("orgChart.time");
  const format = useFormat();
  const span = dayIndex(hi) - dayIndex(lo);
  const at = (day: string) => `${((dayIndex(day) - dayIndex(lo)) / span) * 100}%`;
  const value = Math.min(dayIndex(hi), Math.max(dayIndex(lo), dayIndex(date)));
  const shown = format.date(date, { year: "always" });
  return (
    <div className="oc-timebar ms-auto">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onReplay}
        // eslint-disable-next-line no-restricted-syntax -- the replay button toggles one thing on and off
        aria-pressed={replaying}
      >
        {replaying ? <Square /> : <Play />}
        {replaying ? t("stop") : t("replay")}
      </Button>
      <div className="oc-track">
        <input
          type="range"
          min={dayIndex(lo)}
          max={dayIndex(hi)}
          value={value}
          aria-label={t("asOf")}
          aria-valuetext={shown}
          onChange={(event) => onDate(dayAt(Number(event.target.value)))}
        />
        <div className="oc-ticks">
          {monthTicks(lo, hi, today).map((month) => (
            <span key={month} aria-hidden style={{ insetInlineStart: at(month) }}>{format.parts(month, { month: "short" })}</span>
          ))}
          <button type="button" className="oc-today" style={{ insetInlineStart: at(today) }} onClick={() => onDate(today)}>{t("today")}</button>
        </div>
      </div>
      <p className="oc-timeinfo" aria-live="polite">
        <b>{date === today ? t("todayDate", { date: shown }) : shown}</b>
        {t("summary", { people, coming })}
      </p>
    </div>
  );
}

function Edges({ tree, layout, lit }: { tree: OrgTree; layout: ReturnType<typeof layoutChart>; lit: Set<string> }) {
  const paths: { key: string; d: string; className?: string }[] = [];
  for (const edge of layout.edges) {
    const to = layout.nodes.get(edge.to);
    if (!to) continue;
    const isLit = lit.has(edge.to) && lit.has(edge.from);
    const dashed = isPlaceholder(edge.to) || tree.ghosts.has(edge.to);
    paths.push({ key: `${edge.from}>${edge.to}`, d: edgePath(edge, to), className: isLit ? "oc-lit" : dashed ? "oc-dash" : undefined });
  }
  for (const [id, person] of tree.people) {
    const from = layout.nodes.get(id);
    if (!from || from.kind === "chain") continue;
    for (const key of person.dottedLineManagerKeys) {
      const to = layout.nodes.get(key);
      if (to) paths.push({ key: `${id}~${key}`, d: dottedPath(from, to), className: "oc-dot" });
    }
  }
  // Lit lines draw last, over the rest.
  paths.sort((a, b) => Number(a.className === "oc-lit") - Number(b.className === "oc-lit"));
  return <>{paths.map((path) => <path key={path.key} d={path.d} className={path.className} />)}</>;
}

function PersonPanel({
  person, tree, ctx, showCentre, profileHref, coming, canChangeLines, canChangeAll, canAddRole, onAddRole, onChangeJob, onEdit, onClose, onGoTo, onCentre,
}: {
  person: OrgChartPersonDto;
  tree: OrgTree;
  ctx: CardContext;
  showCentre: boolean;
  profileHref: string | null;
  /** The person's coming change records (HR), with Edit and Cancel. */
  coming: WorkforceChangeDto[];
  canChangeLines: boolean;
  canChangeAll: boolean;
  canAddRole: boolean;
  onAddRole: () => void;
  onChangeJob: () => void;
  onEdit: (change: WorkforceChangeDto) => void;
  onClose: () => void;
  onGoTo: (id: string) => void;
  onCentre: (id: string) => void;
}) {
  const t = useTranslations("orgChart.panel");
  const tc = useTranslations("changes");
  const format = useFormat();
  const manager = person.managerKey ? tree.people.get(person.managerKey) : undefined;
  const flag = tree.flags.get(person.employeeKey);
  const flagManager = flag?.managerKey ? tree.people.get(flag.managerKey)?.displayName ?? "" : "";
  const dotted = person.dottedLineManagerKeys.map((key) => tree.people.get(key)).filter((p): p is OrgChartPersonDto => Boolean(p));
  const fact = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[80px_1fr] gap-2.5 border-b py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  const personLink = (target: OrgChartPersonDto) => (
    <button type="button" className="text-start font-semibold hover:underline" onClick={() => onGoTo(target.employeeKey)}>{target.displayName}</button>
  );
  return (
    <aside
      data-oc-overlay
      aria-label={person.displayName}
      className="absolute inset-y-3 end-3 z-20 flex w-[320px] cursor-default flex-col gap-4 overflow-auto rounded-surface border bg-popover p-[18px] shadow-overlay"
    >
      <Button variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose} className="absolute end-3 top-3">
        <X className="size-4" />
      </Button>
      <div className="grid gap-2.5">
        <OrgAvatar id={person.employeeKey} size="xl" ctx={ctx} />
        <div>
          <h2 className="type-panel-title">{person.displayName}</h2>
          {person.jobTitle ? <p className="type-body-secondary">{person.jobTitle}</p> : null}
        </div>
        {flag ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <i className="oc-swatch" style={{ background: flag.kind === "leave" ? "var(--destructive)" : "var(--info)" }} />
            {t(`upcoming.${flag.kind}`, { date: format.date(flag.date, { year: "always" }), manager: flagManager })}
          </span>
        ) : person.isNew && person.startYear ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <i className="oc-swatch" style={{ background: "var(--primary)" }} />
            {t("joined", { year: String(person.startYear) })}
          </span>
        ) : null}
      </div>
      {coming.length ? (
        <section className="grid gap-3 border-t pt-3.5">
          <h3 className="type-label font-semibold">{tc("coming.title")}</h3>
          {coming.map((item) => (
            <ComingUpCard key={item.id} compact change={item} canChange={item.details.isReportingOnly ? canChangeLines : canChangeAll} onEdit={onEdit} />
          ))}
        </section>
      ) : null}
      <dl className="grid border-t">
        {person.unit ? fact(t("unit"), (
          <>
            {person.unit.name}
            {person.unit.divisionName && person.unit.divisionName !== person.unit.name ? (
              <span className="block text-muted-foreground">{person.unit.divisionName}</span>
            ) : null}
          </>
        )) : null}
        {fact(t("manager"), manager ? personLink(manager) : <span className="text-muted-foreground">{t("top")}</span>)}
        {dotted.length ? fact(t("dotted"), <span className="grid">{dotted.map((m) => <span key={m.employeeKey}>{personLink(m)}</span>)}</span>) : null}
        {fact(t("team"), person.directCount
          ? person.totalCount > person.directCount
            ? t("teamCountAll", { direct: person.directCount, total: person.totalCount })
            : t("teamCount", { direct: person.directCount })
          : <span className="text-muted-foreground">{t("noReports")}</span>)}
        {person.workLocation ? fact(t("location"), person.workLocation) : null}
        {person.startYear ? fact(t("since"), String(person.startYear)) : null}
        {person.workEmail ? fact(t("email"), person.workEmail) : null}
      </dl>
      {showCentre || profileHref || canChangeLines || canAddRole ? (
        <div className="flex flex-wrap gap-2">
          {showCentre ? <Button variant="outline" size="sm" onClick={() => onCentre(person.employeeKey)}>{t("centre")}</Button> : null}
          {profileHref ? <Button asChild variant="outline" size="sm"><Link href={profileHref}>{t("openProfile")}</Link></Button> : null}
          {canChangeLines ? (
            <Button variant="outline" size="sm" onClick={onChangeJob}>
              <ArrowLeftRight className="size-3.5" /> {canChangeAll ? tc("menu.changeJob") : tc("menu.changeManager")}
            </Button>
          ) : null}
          {canAddRole ? (
            <Button variant="outline" size="sm" onClick={onAddRole}>
              <Briefcase className="size-3.5" /> {t("addRole")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

/** An open role: what it is, whose team, where, and when; people admins edit it. */
function RolePanel({
  role, tree, canEdit, onEdit, onClose, onGoTo,
}: {
  role: OrgChartOpenRoleDto;
  tree: OrgTree;
  canEdit: boolean;
  onEdit: (role: OrgChartOpenRoleDto) => void;
  onClose: () => void;
  onGoTo: (id: string) => void;
}) {
  const t = useTranslations("orgChart");
  const format = useFormat();
  const manager = tree.people.get(role.managerKey);
  const fact = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[96px_1fr] gap-2.5 border-b py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
  return (
    <aside
      data-oc-overlay
      aria-label={role.jobTitle}
      className="absolute inset-y-3 end-3 z-20 flex w-[320px] cursor-default flex-col gap-4 overflow-auto rounded-surface border bg-popover p-[18px] shadow-overlay"
    >
      <Button variant="ghost" size="icon-sm" aria-label={t("panel.close")} onClick={onClose} className="absolute end-3 top-3">
        <X className="size-4" />
      </Button>
      <div className="grid gap-2.5">
        <span className="grid size-[52px] place-items-center rounded-control bg-primary-tint text-primary"><Briefcase className="size-6" /></span>
        <div>
          <h2 className="type-panel-title">{role.jobTitle}</h2>
          <p className="type-body-secondary">{role.status === "OnHold" ? t("role.onHold") : t("role.kind")}</p>
        </div>
      </div>
      <dl className="grid border-t">
        {fact(t("role.team"), manager ? (
          <button type="button" className="text-start font-semibold hover:underline" onClick={() => onGoTo(manager.employeeKey)}>{manager.displayName}</button>
        ) : null)}
        {role.unit ? fact(t("panel.unit"), role.unit.name) : null}
        {fact(t("role.targetStart"), role.targetStartDate
          ? format.date(role.targetStartDate, { year: "always" })
          : <span className="text-muted-foreground">{t("role.noStart")}</span>)}
      </dl>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(role)}>{t("role.edit")}</Button>
        </div>
      ) : null}
    </aside>
  );
}
