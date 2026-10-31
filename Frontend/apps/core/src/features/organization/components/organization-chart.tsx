"use client";

import { useSay } from "@repo/ds/lib/say";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import type { UnitStaffingDto } from "@repo/api";
import { Button, cn } from "@repo/ds";
import { layoutTree } from "@repo/ds/flow";
import { Monogram } from "@/features/people/components/workforce-ui";
import { ChartZoomControls, useChartCamera } from "@/features/org-chart/components/chart-stage";
import { fitTo, type Bounds, type Camera, type Viewport } from "@/features/org-chart/model/org-chart-model";
import type { OrganizationHierarchyModel } from "../model/hierarchy";
import { isInvalidMoveTarget, organizationAccessibleName } from "../model/hierarchy";

const NODE_WIDTH = 244;
const NODE_HEIGHT = 104;
const RANK_GAP = 64;
// The entry framing never goes below this: smaller and the unit cards can't be read; a wider tree pans sideways.
const ENTRY_MIN_ZOOM = 0.55;

export interface OrganizationChartProps {
  model: OrganizationHierarchyModel;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  revealedIds?: ReadonlySet<string>;
  /** Each unit's people and head on the chart's date, when the viewer may read them. */
  staffing?: ReadonlyMap<string, UnitStaffingDto>;
  canManage: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (id: string) => void;
  onStageDragMove: (sourceId: string, targetId: string) => void;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

type Point = { x: number; y: number };
type UnitDrag = { id: string; dx: number; dy: number; over: string | null };

function boundsOf(positions: Map<string, Point>, ids?: Iterable<string>): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids ?? positions.keys()) {
    const p = positions.get(id);
    if (!p) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + NODE_WIDTH);
    y1 = Math.max(y1, p.y + NODE_HEIGHT + 14);
  }
  return x0 === Infinity ? { x0: 0, y0: 0, x1: 1, y1: 1 } : { x0, y0, x1, y1 };
}

/** The whole visible tree at a readable size: fitted when it fits, otherwise its top centred at the smallest readable zoom. */
function entryCamera(b: Bounds, v: Viewport): Camera {
  const fit = fitTo(b, v);
  if (fit.s >= ENTRY_MIN_ZOOM) return fit;
  const s = ENTRY_MIN_ZOOM;
  return { s, x: (v.width - (b.x1 - b.x0) * s) / 2 - b.x0 * s, y: 36 - b.y0 * s };
}

/**
 * Organization's Structure view: the unit hierarchy on the Organization's chart canvas (the people chart's camera,
 * zoom corner and edges), each card with its type, head and headcount. Folding, adding a unit under another and
 * dragging one onto a new parent (which opens the move review) work as before; the canvas reads left to right.
 */
export default function OrganizationChart({
  model,
  collapsed,
  selectedId,
  revealedIds = EMPTY_IDS,
  staffing,
  canManage,
  readOnly,
  onSelect,
  onToggle,
  onAddChild,
  onStageDragMove,
}: OrganizationChartProps) {
  const t = useTranslations("organization");
  const say = useSay("organization");
  const { stageRef, worldRef, cam, zoomLabel, panning, dragged, flyTo, jumpTo, zoomBy, viewport, startPan } = useChartCamera(0);

  const { ids, edges, positions } = useMemo(() => {
    const visible: string[] = [];
    const links: Array<{ source: string; target: string }> = [];
    const visit = (id: string) => {
      visible.push(id);
      if (collapsed.has(id)) return;
      for (const child of model.childrenByParent.get(id) ?? []) {
        links.push({ source: id, target: child });
        visit(child);
      }
    };
    for (const root of model.roots) visit(root);
    const laid = layoutTree(visible, links, { nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT, nodesep: 24, ranksep: RANK_GAP, margin: 40 });
    return { ids: visible, edges: links, positions: laid };
  }, [collapsed, model]);

  const branch = useMemo(
    () => (selectedId ? new Set<string>([selectedId, ...(model.descendantsById.get(selectedId) ?? [])]) : null),
    [model, selectedId]
  );

  // ── Camera: enter on the whole tree once per dataset; a fold keeps its unit where it was on screen ──
  const dataKey = `${model.roots.join(",")}|${model.byId.size}`;
  const framed = useRef<string | null>(null);
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (anchor.current) {
      const { id, x, y } = anchor.current;
      anchor.current = null;
      const p = positions.get(id);
      if (p) {
        const s = cam.current.s;
        flyTo({ s, x: x - p.x * s, y: y - p.y * s }, 240);
        return;
      }
    }
    if (framed.current === dataKey) return;
    framed.current = dataKey;
    jumpTo(entryCamera(boundsOf(positions), viewport()));
  }, [positions, dataKey, flyTo, jumpTo, viewport, cam]);

  const toggle = (id: string) => {
    const p = positions.get(id);
    if (p) anchor.current = { id, x: p.x * cam.current.s + cam.current.x, y: p.y * cam.current.s + cam.current.y };
    onToggle(id);
  };

  // A deliberate selection below the top comes into view at the current zoom.
  const centred = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || model.roots.includes(selectedId) || centred.current === selectedId) return;
    const p = positions.get(selectedId);
    if (!p) return;
    centred.current = selectedId;
    const v = viewport();
    const s = cam.current.s;
    const inView = p.x * s + cam.current.x > 0 && (p.x + NODE_WIDTH) * s + cam.current.x < v.width
      && p.y * s + cam.current.y > 0 && (p.y + NODE_HEIGHT) * s + cam.current.y < v.height;
    if (!inView) flyTo({ s, x: v.width / 2 - (p.x + NODE_WIDTH / 2) * s, y: v.height / 2 - (p.y + NODE_HEIGHT / 2) * s }, 360);
  }, [selectedId, positions, model.roots, flyTo, viewport, cam]);

  // A just-added or imported set of units comes into view.
  const revealKey = [...revealedIds].sort().join(",");
  useEffect(() => {
    if (!revealKey) return;
    const present = revealKey.split(",").filter((id) => positions.has(id));
    if (present.length === 0) return;
    flyTo(fitTo(boundsOf(positions, present), viewport(), Math.min(1, cam.current.s * 1.5)), 420);
    // Once per revealed set; the highlight fades on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  // ── Drag a unit onto a new parent: the move review opens on drop ──
  const [drag, setDrag] = useState<UnitDrag | null>(null);
  const movable = canManage && !readOnly;
  const moving = useMemo(
    () => (drag ? new Set<string>([drag.id, ...(model.descendantsById.get(drag.id) ?? [])]) : null),
    [drag, model]
  );
  const valid = drag?.over ? !isInvalidMoveTarget(model, drag.id, drag.over) : false;

  function startUnitDrag(event: ReactPointerEvent, id: string) {
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let current: UnitDrag | null = null;
    dragged.current = false;
    const move = (e: PointerEvent) => {
      if (!dragged.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 5) return;
      dragged.current = true;
      const s = cam.current.s;
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-unit-id]")?.dataset.unitId ?? null;
      current = { id, dx: (e.clientX - start.x) / s, dy: (e.clientY - start.y) / s, over: hit && hit !== id ? hit : null };
      setDrag(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (current?.over && !isInvalidMoveTarget(model, id, current.over)) onStageDragMove(id, current.over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const points = [...positions.values()];
  const width = Math.max(1, ...points.map((p) => p.x + NODE_WIDTH + 80));
  const height = Math.max(1, ...points.map((p) => p.y + NODE_HEIGHT + 80));
  const draggedUnit = drag ? model.byId.get(drag.id) : null;
  const draggedCount = drag ? (model.descendantsById.get(drag.id)?.size ?? 0) : 0;

  return (
    <div
      ref={stageRef}
      dir="ltr"
      className={cn("oc-stage h-full min-h-[520px] bg-section", panning && "oc-panning")}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("[data-oc-overlay], [data-unit-id]")) return;
        startPan(event);
      }}
      onClickCapture={(event) => {
        if (dragged.current) {
          event.stopPropagation();
          event.preventDefault();
          dragged.current = false;
        }
      }}
    >
      {draggedUnit ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-popover px-3.5 py-1.5 text-xs shadow-raised">
          <span className={cn("inline-block size-1.5 rounded-full", drag?.over ? (valid ? "bg-primary" : "bg-destructive") : "bg-muted-foreground")} />
          <span className="font-medium">
            {draggedCount > 0 ? t("chart.movingWith", { name: draggedUnit.name, count: draggedCount }) : t("chart.moving", { name: draggedUnit.name })}
          </span>
          <span className="text-muted-foreground">{drag?.over ? (valid ? t("chart.dropToReview") : t("chart.cantDrop")) : t("chart.dropOnto")}</span>
        </div>
      ) : null}

      <div ref={worldRef} className="oc-world">
        <svg className="oc-edges" width={width} height={height} aria-hidden>
          {edges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            if (!from || !to) return null;
            const x1 = from.x + NODE_WIDTH / 2;
            const y1 = from.y + NODE_HEIGHT;
            const x2 = to.x + NODE_WIDTH / 2;
            const my = y1 + RANK_GAP / 2;
            const lit = branch?.has(edge.source) && branch.has(edge.target);
            return (
              <path
                key={`${edge.source}-${edge.target}`}
                className={cn(lit && "oc-lit")}
                d={`M${x1} ${y1}V${my}H${x2}V${to.y}`}
                opacity={moving?.has(edge.target) ? 0.35 : 1}
              />
            );
          })}
        </svg>
        {ids.map((id) => {
          const unit = model.byId.get(id)!;
          const p = positions.get(id)!;
          const lifted = drag?.id === id;
          const staff = staffing?.get(id);
          const people = staff?.people ?? null;
          const hasChildren = (model.childrenByParent.get(id)?.length ?? 0) > 0;
          const folded = collapsed.has(id);
          const root = unit.parentId === null;
          const over = drag?.over === id;
          const hidden = model.descendantsById.get(id)?.size ?? 0;
          return (
            <div
              key={id}
              data-unit-id={id}
              className={cn(
                "oc-node group h-[104px] w-[244px] rounded-surface border bg-card shadow-raised",
                people === 0 && "border-dashed border-input bg-transparent shadow-none",
                branch?.has(id) && id !== selectedId && "border-primary/45",
                id === selectedId && "border-primary ring-2 ring-primary/30",
                revealedIds.has(id) && "org-reveal-highlight z-10",
                lifted && "z-20 shadow-overlay ring-2 ring-primary",
                moving?.has(id) && !lifted && "oc-dim",
                over && (valid ? "border-primary ring-2 ring-primary/35" : "border-destructive ring-2 ring-destructive/25")
              )}
              style={{
                transform: `translate(${p.x + (lifted ? drag.dx : 0)}px, ${p.y + (lifted ? drag.dy : 0)}px)`,
                transition: lifted ? "none" : undefined,
              }}
            >
              <button
                type="button"
                aria-label={organizationAccessibleName(model, id, say)}
                // eslint-disable-next-line no-restricted-syntax -- a chart card toggles its own selection; not a choice among options
                aria-pressed={id === selectedId}
                onClick={() => onSelect(id)}
                className="grid h-full w-full grid-rows-[1fr_auto] rounded-surface text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn("grid content-center gap-0.5 px-3.5", people === 0 && "opacity-60")}>
                  <span className="truncate pe-14 text-sm font-semibold leading-tight text-foreground">{unit.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{unit.typeName}</span>
                </span>
                <span className={cn("flex min-w-0 items-center gap-2 border-t px-3.5 py-2 text-xs text-muted-foreground", people === 0 && "border-dashed border-input opacity-60")}>
                  {staff?.head ? <Monogram name={staff.head.displayName} photoUrl={staff.head.photoUrl} size="sm" className="size-5 text-[9px]" /> : null}
                  <span className="min-w-0 flex-1 truncate">{staff?.head?.displayName ?? (people === 0 ? t("chart.nobody") : "")}</span>
                  {people !== null ? (
                    <span className="shrink-0 font-semibold tabular-nums text-foreground" title={t("chart.people", { count: people })}>{people}</span>
                  ) : null}
                </span>
              </button>
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={folded ? t("chart.expand", { name: unit.name, count: hidden }) : t("chart.collapse", { name: unit.name })}
                  aria-expanded={!folded}
                  onClick={() => toggle(id)}
                  className={cn(
                    "absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-raised outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    folded ? "gap-0.5 px-1.5" : "w-6"
                  )}
                >
                  {folded ? (
                    <>
                      <ChevronRight className="size-3.5" />
                      <span className="text-[11px] font-semibold tabular-nums">{hidden}</span>
                    </>
                  ) : <ChevronDown className="size-3.5" />}
                </button>
              ) : null}
              {movable ? (
                <div className="absolute end-1.5 top-1.5 flex items-center gap-0.5 rounded-control border bg-popover p-0.5 opacity-0 shadow-raised transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button type="button" variant="ghost" size="icon-sm" className="size-6" aria-label={t("outline.addChild", { name: unit.name })} onClick={() => onAddChild(id)}>
                    <Plus className="size-3.5" />
                  </Button>
                  {!root ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={t("outline.drag", { name: unit.name })}
                      title={t("outline.dragHint")}
                      onPointerDown={(event) => startUnitDrag(event, id)}
                      className="grid size-6 cursor-grab place-items-center rounded-detail text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="size-3.5" />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <ChartZoomControls label={zoomLabel} onZoom={(factor) => zoomBy(factor)} onFit={() => flyTo(fitTo(boundsOf(positions), viewport()))} />
    </div>
  );
}
