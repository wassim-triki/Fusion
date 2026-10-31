import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type {
  AlignmentMapDto,
  AlignmentMapNodeDto,
  ObjectiveStatus,
  PersonalAlignmentDto,
} from "@repo/api";
import { cn } from "@repo/ds/lib/utils";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { AnchorViewport, layoutTree, useAnchoredToggle } from "@repo/ds/flow";
import { ChevronDown, ChevronRight, Users } from "@/lib/icons";
import {
  buildAlignmentMap,
  defaultExpanded,
  focusPath,
  nodeAccessibleName,
  personalSummary,
  progressLabel,
  scopeLabel,
  statusLabel,
  visibleMap,
} from "./alignment-map-model";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

// Tall enough for an eyebrow, a two-line title, the status row and the personal row without overlap.
const DIRECTION = { width: 272, height: 152 };
const PERSONAL = { width: 228, height: 76 };
const HIDDEN = { width: 228, height: 44 };
const MAX_ZOOM = 1.25;

const STATUS_DOT: Record<ObjectiveStatus | "none", string> = {
  OnTrack: "bg-success",
  AtRisk: "bg-warning",
  OffTrack: "bg-destructive",
  none: "bg-muted-foreground/40",
};

const tone = (status: ObjectiveStatus | null) => status ?? "none";

type DirectionData = Record<string, unknown> & {
  node: AlignmentMapNodeDto;
  focused: boolean;
  expanded: boolean;
  hasChildren: boolean;
  hiddenCount: number;
  personalOpen: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onTogglePersonal: (id: string) => void;
};
type PersonalData = Record<string, unknown> & {
  node: AlignmentMapNodeDto;
  focused: boolean;
  onOpen: (id: string) => void;
};
type HiddenData = Record<string, unknown> & { count: number };

type MapFlowNode =
  | Node<DirectionData, "direction">
  | Node<PersonalData, "personal">
  | Node<HiddenData, "hidden">;

const hiddenHandle =
  "!pointer-events-none !h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

function StatusMark({ status }: { status: ObjectiveStatus | null }) {
  const map = useSay("goals.map");
  return (
    <span className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[tone(status)])}
      />
      <span className={cn("truncate", status && "font-medium text-foreground")}>
        {statusLabel(status, map)}
      </span>
    </span>
  );
}

/** The owner's reported status as the same badge the plan and record use; unreported stays quiet text. */
function NodeStatus({ status }: { status: ObjectiveStatus | null }) {
  const map = useSay("goals.map");
  return status ? (
    <ObjectiveStatusBadge status={status} className="shrink-0" />
  ) : (
    <span className="shrink-0 type-meta text-muted-foreground">
      {statusLabel(null, map)}
    </span>
  );
}

/** Four-part bar of the personal objectives' status mix; "not reported" is the quiet remainder. */
function MixBar({ counts }: { counts: PersonalAlignmentDto }) {
  const parts: Array<[number, string]> = [
    [counts.onTrack, STATUS_DOT.OnTrack],
    [counts.atRisk, STATUS_DOT.AtRisk],
    [counts.offTrack, STATUS_DOT.OffTrack],
    [counts.noStatus, STATUS_DOT.none],
  ];
  return (
    <span
      aria-hidden
      className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted"
    >
      {parts.map(([count, color], index) =>
        count > 0 ? (
          <span
            key={index}
            className={cn("h-full", color)}
            style={{ width: `${(count / counts.total) * 100}%` }}
          />
        ) : null
      )}
    </span>
  );
}

const DirectionNode = memo(function DirectionNode({
  data,
}: NodeProps<Node<DirectionData, "direction">>) {
  const t = useTranslations("goals.DirectionNode");
  const map = useSay("goals.map");
  const { node } = data;
  const company = node.kind === "Company";
  const counts = node.personal;
  return (
    <div
      className={cn(
        "group pointer-events-auto relative flex h-[152px] w-[272px] flex-col rounded-surface bg-card shadow-raised transition-[border-color,box-shadow] duration-300",
        company && "bg-[color-mix(in_oklab,var(--primary)_5%,var(--card))]",
        data.focused && "ring-2 ring-primary ring-offset-2 ring-offset-section",
        !data.focused && "hover:border-foreground/25"
      )}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <button
        type="button"
        aria-label={nodeAccessibleName(node, map)}
        onClick={() => data.onOpen(node.id)}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden rounded-control px-3.5 pt-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "type-meta truncate",
              // A category label, not a state: the same quiet tone for every scope (amber stays for "yours").
              company ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {scopeLabel(node, map)}
          </span>
          <NodeStatus status={node.status} />
        </span>
        <span className="line-clamp-2 type-subsection-title leading-snug text-foreground">
          {node.title}
        </span>
        <span className="mt-auto flex items-center gap-2.5 pb-2.5 type-meta tabular-nums text-muted-foreground">
          {node.hasProgress ? (
            <span
              aria-hidden
              className="block h-1 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, node.progress)}%` }}
              />
            </span>
          ) : null}
          <span
            className={cn(
              "shrink-0",
              node.hasProgress && "font-medium text-foreground"
            )}
          >
            {progressLabel(node, map)}
          </span>
        </span>
      </button>
      {counts && counts.total > 0 ? (
        <button
          type="button"
          aria-expanded={data.personalOpen}
          aria-label={(data.personalOpen ? t("hideThem", { counts: personalSummary(counts, map) }) : t("showThem", { counts: personalSummary(counts, map) }))}
          onClick={(event) => {
            event.stopPropagation();
            data.onTogglePersonal(node.id);
          }}
          className="mx-2 mb-2 flex items-center gap-2 rounded-control-sm border-t border-border/70 px-1.5 pt-1.5 type-meta text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Users className="size-3.5" aria-hidden />
          <span className="tabular-nums">{t("personal", { total: counts.total })}</span>
          <MixBar counts={counts} />
          {data.personalOpen ? (
            <ChevronDown className="ms-auto size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="ms-auto size-3.5" aria-hidden />
          )}
        </button>
      ) : null}
      {data.hasChildren ? (
        <button
          type="button"
          aria-label={
            data.expanded
              ? t("collapse", { title: node.title })
              : (data.hiddenCount === 1 ? t("expandHiddenObjective", { title: node.title, hiddenCount: data.hiddenCount }) : t("expandHiddenObjectives", { title: node.title, hiddenCount: data.hiddenCount }))
          }
          aria-expanded={data.expanded}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggle(node.id);
          }}
          className={cn(
            "absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-raised outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            data.expanded ? "w-6" : "gap-0.5 px-1.5"
          )}
        >
          {data.expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <>
              <ChevronRight className="size-3.5" />
              <span className="type-mark tabular-nums">
                {data.hiddenCount}
              </span>
            </>
          )}
        </button>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  );
});

const PersonalNode = memo(function PersonalNode({
  data,
}: NodeProps<Node<PersonalData, "personal">>) {
  const t = useTranslations("goals.PersonalNode");
  const map = useSay("goals.map");
  const { node } = data;
  return (
    <div
      className={cn(
        "pointer-events-auto h-[76px] w-[228px] rounded-control border border-border bg-card shadow-raised transition-colors hover:border-foreground/25",
        data.focused && "ring-2 ring-primary ring-offset-2 ring-offset-section"
      )}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <button
        type="button"
        aria-label={nodeAccessibleName(node, map)}
        onClick={() => data.onOpen(node.id)}
        className="flex h-full w-full flex-col justify-between rounded-control px-3 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="line-clamp-2 type-meta-strong leading-snug text-foreground">
          {node.title}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate type-meta",
              node.isOwn
                ? "font-medium text-primary-ink"
                : "text-muted-foreground"
            )}
          >
            {node.isOwn ? t("you") : (node.ownerName ?? t("personalObjective"))}
          </span>
          <NodeStatus status={node.status} />
        </span>
      </button>
    </div>
  );
});

const HiddenNode = memo(function HiddenNode({
  data,
}: NodeProps<Node<HiddenData, "hidden">>) {
  const t = useTranslations("goals.HiddenNode");
  return (
    <div className="flex h-[44px] w-[228px] items-center justify-center rounded-control border border-dashed border-border px-3 type-meta text-muted-foreground">
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      {t("notVisibleToYou", { count: data.count })}
    </div>
  );
});

const nodeTypes = {
  direction: DirectionNode,
  personal: PersonalNode,
  hidden: HiddenNode,
};

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Centres the focused objective once per focus, from the layout's own positions (no measuring needed),
 * once the viewport exists. Entry framing without a focus is React Flow's own `fitView`.
 */
function FocusViewport({
  focusId,
  nodes,
}: {
  focusId: string | null;
  nodes: MapFlowNode[];
}) {
  const flow = useReactFlow();
  const framedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || framedRef.current === focusId) return;
    const target = nodes.find((node) => node.id === focusId);
    if (!target) return;
    let frame = 0;
    const center = () => {
      if (!flow.viewportInitialized) {
        frame = requestAnimationFrame(center);
        return;
      }
      framedRef.current = focusId;
      const size = target.type === "direction" ? DIRECTION : PERSONAL;
      void flow.setCenter(
        target.position.x + size.width / 2,
        target.position.y + size.height / 2,
        {
          zoom: 0.95,
          duration: reduceMotion() ? 0 : 240,
        }
      );
    };
    frame = requestAnimationFrame(center);
    return () => cancelAnimationFrame(frame);
  }, [flow, focusId, nodes]);
  return null;
}

/**
 * The alignment map (D-06, S-15): the cycle's published direction as a controlled tree. Company and
 * their unit objectives open first; deeper branches and personal objectives open on request; every
 * objective opens its record. Status shows as the shared status badge (dot and word), never colour alone.
 */
export default function AlignmentMap({
  map,
  focusId: requestedFocus,
  nearId = null,
  onOpen,
}: {
  map: AlignmentMapDto;
  focusId: string | null;
  /** Where to centre when the requested objective is not on this viewer's map. */
  nearId?: string | null;
  onOpen: (objectiveId: string) => void;
}) {
  const t = useTranslations("goals.AlignmentMap");
  const model = useMemo(() => buildAlignmentMap(map), [map]);
  // Focus only what is on the map; otherwise the fallback, otherwise frame the whole tree.
  const focusId =
    requestedFocus && model.byId.has(requestedFocus)
      ? requestedFocus
      : nearId && model.byId.has(nearId)
        ? nearId
        : null;
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpanded(model)
  );
  const [openPersonal, setOpenPersonal] = useState<Set<string>>(
    () => new Set()
  );

  // A different set of objectives starts from the default view; a focus opens the path to it. A
  // background refetch of the same objectives keeps what the person opened.
  const dataKey = useMemo(
    () => map.nodes.map((node) => node.id).join(","),
    [map]
  );
  useEffect(() => {
    const next = defaultExpanded(model);
    const personal = new Set<string>();
    if (focusId) {
      const path = focusPath(model, focusId);
      path.expand.forEach((id) => next.add(id));
      if (path.openPersonal) personal.add(path.openPersonal);
    }
    setExpanded(next);
    setOpenPersonal(personal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, focusId]);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const togglePersonalNow = useCallback((id: string) => {
    setOpenPersonal((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const nodesRef = useRef<MapFlowNode[]>([]);
  const { pendingAnchorRef, handleToggle } = useAnchoredToggle(
    nodesRef,
    toggle
  );
  const anchoredPersonal = useAnchoredToggle(nodesRef, togglePersonalNow);

  const { nodes, edges } = useMemo(() => {
    const visible = visibleMap(model, expanded, openPersonal);
    const sizes = new Map(
      visible.nodes.map((n) => [
        n.id,
        n.kind === "direction"
          ? DIRECTION
          : n.kind === "personal"
            ? PERSONAL
            : HIDDEN,
      ])
    );
    const positions = layoutTree(
      visible.nodes.map((n) => n.id),
      visible.edges,
      {
        nodeWidth: DIRECTION.width,
        nodeHeight: DIRECTION.height,
        nodesep: 28,
        ranksep: 72,
        margin: 40,
        sizeOf: (id) => sizes.get(id),
      }
    );
    const flowNodes = visible.nodes.map<MapFlowNode>((entry) => {
      const position = positions.get(entry.id) ?? { x: 0, y: 0 };
      const size = sizes.get(entry.id)!;
      const base = {
        id: entry.id,
        position,
        width: size.width,
        height: size.height,
        draggable: false,
        selectable: false,
      };
      if (entry.kind === "direction")
        return {
          ...base,
          type: "direction",
          data: {
            node: model.byId.get(entry.id)!,
            focused: focusId === entry.id,
            expanded: entry.expanded,
            hasChildren: entry.hasChildren,
            hiddenCount: entry.hiddenCount,
            personalOpen: entry.personalOpen,
            onOpen,
            onToggle: handleToggle,
            onTogglePersonal: anchoredPersonal.handleToggle,
          },
        };
      if (entry.kind === "personal")
        return {
          ...base,
          type: "personal",
          data: {
            node: model.byId.get(entry.id)!,
            focused: focusId === entry.id,
            onOpen,
          },
        };
      return { ...base, type: "hidden", data: { count: entry.count } };
    });
    const flowEdges = visible.edges.map<Edge>((edge) => ({
      id: `${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      style: {
        stroke: "var(--border)",
        strokeWidth: edge.personal ? 1 : 1.5,
        strokeDasharray: edge.personal ? "4 4" : undefined,
      },
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [
    model,
    expanded,
    openPersonal,
    focusId,
    onOpen,
    handleToggle,
    anchoredPersonal.handleToggle,
  ]);

  nodesRef.current = nodes;

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-surface bg-section">
      <ReactFlow<MapFlowNode, Edge>
        // React Flow positions in physical pixels and breaks right to left; the map reads left to right in every language.
        dir="ltr"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={MAX_ZOOM}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        fitView={!focusId}
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <FocusViewport focusId={focusId} nodes={nodes} />
        <AnchorViewport nodes={nodes} pendingAnchorRef={pendingAnchorRef} />
        <AnchorViewport
          nodes={nodes}
          pendingAnchorRef={anchoredPersonal.pendingAnchorRef}
        />
        <Background
          variant={BackgroundVariant.Lines}
          gap={16}
          lineWidth={1}
          color="color-mix(in oklab, var(--border) 50%, transparent)"
        />
        <Panel position="top-left">
          <ul
            aria-label={t("statusKey")}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-border bg-card px-3 py-1.5 shadow-raised"
          >
            {(["OnTrack", "AtRisk", "OffTrack", null] as const).map(
              (status) => (
                <li key={status ?? "none"}>
                  <StatusMark status={status} />
                </li>
              )
            )}
          </ul>
        </Panel>
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
