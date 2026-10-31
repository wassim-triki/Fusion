"use client";

import { useSay } from "@repo/ds/lib/say";
import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { Button, cn } from "@repo/ds";
import { AnchorViewport, layoutTree, useAnchoredToggle } from "@repo/ds/flow";
import type { OrganizationHierarchyModel } from "../model/hierarchy";
import { isInvalidMoveTarget, organizationAccessibleName } from "../model/hierarchy";

const NODE_WIDTH = 244;
const NODE_HEIGHT = 78;

const MAX_ZOOM = 1.5;
// Default framing zoom = "level 9": max zoom followed by 8 zoom-out clicks.
// React Flow's zoom control steps by a factor of 1.2 per click, so 1.5 / 1.2^8.
const DEFAULT_ZOOM = MAX_ZOOM / 1.2 ** 8;

type OrganizationNodeData = Record<string, unknown> & {
  id: string;
  name: string;
  typeName: string;
  code: string;
  accessibleName: string;
  root: boolean;
  selected: boolean;
  collapsed: boolean;
  hasChildren: boolean;
  hiddenCount: number;
  canManage: boolean;
  readOnly: boolean;
  inBranch: boolean;
  lifted: boolean;
  dimmed: boolean;
  validDrop: boolean;
  invalidDrop: boolean;
  revealed: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (id: string) => void;
};

type OrganizationFlowNode = Node<OrganizationNodeData, "organizationUnit">;

const hiddenHandle =
  "!pointer-events-none !h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

const OrganizationNode = memo(function OrganizationNode({ data }: NodeProps<OrganizationFlowNode>) {
  const t = useTranslations("organization");
  return (
    <div
      className={cn(
        // React Flow sets pointer-events:none on non-draggable nodes (root, and
        // every node in read-only as-of views); re-enable so the card stays
        // selectable/inspectable and its disclosure stays operable.
        "group pointer-events-auto relative h-[78px] w-[244px] rounded-surface bg-card shadow-raised transition-[border-color,box-shadow,opacity,background-color,transform] duration-500 motion-reduce:transition-none",
        data.root && "border-primary/40 bg-[color-mix(in_oklab,var(--primary)_4%,var(--card))]",
        !data.selected && !data.validDrop && !data.invalidDrop && "hover:border-foreground/25",
        // A descendant of the selected node: part of the highlighted branch, but clearly
        // subordinate to the selection — a tinted border only, no ring/shadow.
        data.inBranch && "border-primary/45 bg-[color-mix(in_oklab,var(--primary)_4%,var(--card))]",
        // The selected node itself owns the branch: full primary border + ring + shadow.
        data.selected && "border-primary ring-2 ring-primary/30",
        data.revealed && "org-reveal-highlight z-10",
        // The card being dragged lifts off the canvas and moves with the cursor in real time.
        data.lifted && "z-20 scale-[1.03] cursor-grabbing border-primary opacity-100 shadow-overlay ring-2 ring-primary !duration-100",
        // Descendants that will travel with it are ghosted at their origin.
        data.dimmed && "opacity-40",
        data.validDrop && "border-primary bg-[color-mix(in_oklab,var(--primary)_7%,var(--card))] ring-2 ring-primary/35",
        data.invalidDrop && "border-destructive bg-[color-mix(in_oklab,var(--destructive)_6%,var(--card))] ring-2 ring-destructive/25"
      )}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <button
        type="button"
        aria-label={data.accessibleName}
        // eslint-disable-next-line no-restricted-syntax -- a chart node toggles its own selection; not a choice among options
        aria-pressed={data.selected}
        onClick={() => data.onSelect(data.id)}
        className="flex h-full w-full flex-col justify-center gap-1 rounded-control px-3.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <span className="truncate pe-14 text-sm font-semibold leading-tight text-foreground">
          {data.name}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pe-2 text-xs text-muted-foreground">
          <span className="truncate">{data.typeName}</span>
          <span aria-hidden className="text-muted-foreground/50">·</span>
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide">{data.code}</span>
        </span>
      </button>
      {data.hasChildren ? (
        <button
          type="button"
          aria-label={data.collapsed ? t("chart.expand", { name: data.name, count: data.hiddenCount }) : t("chart.collapse", { name: data.name })}
          aria-expanded={!data.collapsed}
          onClick={(event) => { event.stopPropagation(); data.onToggle(data.id); }}
          className={cn(
            "absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border bg-background text-muted-foreground shadow-raised outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            data.collapsed ? "gap-0.5 px-1.5" : "w-6"
          )}
        >
          {data.collapsed ? (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold tabular-nums">{data.hiddenCount}</span>
            </>
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
      {data.canManage && !data.readOnly ? (
        <div className="absolute inset-e-1.5 top-1.5 flex items-center gap-0.5 rounded-control border bg-popover p-0.5 opacity-0 shadow-raised transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button type="button" variant="ghost" size="icon-sm" className="h-6 w-6" aria-label={t("outline.addChild", { name: data.name })} onClick={(event) => { event.stopPropagation(); data.onAddChild(data.id); }}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          {!data.root ? (
            <span
              className="org-drag-handle grid h-6 w-6 cursor-grab place-items-center rounded-detail text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
              role="button"
              aria-label={t("outline.drag", { name: data.name })}
              title={t("outline.dragHint")}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} />
    </div>
  );
});

const nodeTypes = { organizationUnit: OrganizationNode };

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function FocusSelected({
  selectedId,
  isRoot,
  nodes,
}: {
  selectedId: string | null;
  isRoot: boolean;
  nodes: OrganizationFlowNode[];
}) {
  const flow = useReactFlow<OrganizationFlowNode, Edge>();
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    // The initial root framing is owned by the parent's onInit/frameEntry; only a
    // deliberate non-root selection centers here, so a load that defaults its selection
    // to the root does not fight the entry framing.
    if (!selectedId || isRoot) return;
    if (focusedRef.current === selectedId) return;
    const node = nodes.find((candidate) => candidate.id === selectedId);
    if (!node) return;
    focusedRef.current = selectedId;
    void flow.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
      zoom: flow.getZoom(),
      duration: reduceMotion() ? 0 : 180,
    });
  }, [flow, selectedId, isRoot, nodes]);
  return null;
}

// A genuine reveal is allowed to move the viewport: bring the just-changed unit(s)
// into view — center a single node, or fit a created set — without disturbing
// pan/zoom on ordinary interactions.
function RevealViewport({
  revealedIds,
  nodes,
}: {
  revealedIds: ReadonlySet<string>;
  nodes: OrganizationFlowNode[];
}) {
  const flow = useReactFlow<OrganizationFlowNode, Edge>();
  const revealKey = useMemo(() => [...revealedIds].sort().join(","), [revealedIds]);
  useEffect(() => {
    if (revealKey === "") return;
    const ids = revealKey.split(",");
    const present = ids.filter((id) => nodes.some((node) => node.id === id));
    if (present.length === 0) return;
    const duration = reduceMotion() ? 0 : 420;
    if (present.length === 1) {
      const node = nodes.find((candidate) => candidate.id === present[0])!;
      void flow.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
        zoom: Math.min(flow.getZoom(), 1),
        duration,
      });
    } else {
      void flow.fitView({
        nodes: present.map((id) => ({ id })),
        padding: 0.25,
        maxZoom: 1,
        duration,
      });
    }
    // Center once per revealed set; the highlight fade is owned by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, revealKey]);
  return null;
}

export interface OrganizationChartProps {
  model: OrganizationHierarchyModel;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  revealedIds?: ReadonlySet<string>;
  canManage: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (id: string) => void;
  onStageDragMove: (sourceId: string, targetId: string) => void;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

export default function OrganizationChart({
  model,
  collapsed,
  selectedId,
  revealedIds = EMPTY_IDS,
  canManage,
  readOnly,
  onSelect,
  onToggle,
  onAddChild,
  onStageDragMove,
}: OrganizationChartProps) {
  const t = useTranslations("organization");
  const say = useSay("organization");
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Live position of the card being dragged. Because `nodes` is recomputed mid-drag
  // (dropTarget changes as the cursor sweeps over targets), the memo would otherwise feed
  // React Flow the dragged node's *original* dagre position every frame and snap it back —
  // so only the cursor would appear to move. Pinning this live position keeps the card
  // itself travelling under the cursor.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // Keep the node the user toggled visually anchored: capture its pre-relayout
  // position, and after the layout repositions everything, compensate the viewport so
  // it does not jump across the screen. See AnchorViewport.
  const nodesRef = useRef<OrganizationFlowNode[]>([]);
  const { pendingAnchorRef, handleToggle } = useAnchoredToggle(nodesRef, onToggle);

  const dropValid =
    dragSource !== null &&
    dropTarget !== null &&
    !isInvalidMoveTarget(model, dragSource, dropTarget);

  const selectedIsRoot = selectedId !== null && model.roots.includes(selectedId);
  // Identity of the underlying dataset: changes on load, effective-date change, or
  // import; stable across expand/collapse. The chart frames its entry once per dataset.
  const dataKey = useMemo(() => `${[...model.roots].join(",")}|${model.byId.size}`, [model]);
  // A post-action reveal, or a deliberate non-root selection, owns the viewport;
  // otherwise the entry framing (root head) runs.
  const autoFrame = revealedIds.size === 0 && (selectedId === null || selectedIsRoot);
  const flowRef = useRef<ReactFlowInstance<OrganizationFlowNode, Edge> | null>(null);
  const framedRef = useRef<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const movingSet = dragSource
      ? new Set<string>([dragSource, ...(model.descendantsById.get(dragSource) ?? [])])
      : null;
    // The selected node plus its whole sub-tree: highlighted as one branch, with the
    // selected node styled distinctly from its descendants.
    const branchSet = selectedId
      ? new Set<string>([selectedId, ...(model.descendantsById.get(selectedId) ?? [])])
      : null;
    const visibleIds: string[] = [];
    const visibleEdges: Array<{ source: string; target: string }> = [];
    const visit = (id: string) => {
      visibleIds.push(id);
      if (collapsed.has(id)) return;
      for (const child of model.childrenByParent.get(id) ?? []) {
        visibleEdges.push({ source: id, target: child });
        visit(child);
      }
    };
    for (const root of model.roots) visit(root);

    // Top-to-bottom layout: the root sits on top and depth flows downward across ranks,
    // while sibling units at each level spread sideways. `nodesep` is the horizontal gap
    // between siblings; `ranksep` is the vertical gap between depth levels. The wide, short
    // nodes spread far horizontally, so a generous `ranksep` gives the tree comparable
    // vertical extent rather than a short, very wide band.
    const positions = layoutTree(visibleIds, visibleEdges, {
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
      nodesep: 8,
      ranksep: 260,
      margin: 40,
    });

    return {
      nodes: visibleIds.map<OrganizationFlowNode>((id) => {
        const unit = model.byId.get(id)!;
        const position = positions.get(id) ?? { x: 0, y: 0 };
        const isCandidate = dropTarget === id && dragSource !== null && dragSource !== id;
        return {
          id,
          type: "organizationUnit",
          position,
          // Top-to-bottom flow: parents connect from their bottom edge to a child's top.
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          // Explicit dimensions so the MiniMap can draw every node without waiting for
          // each to be measured from the DOM.
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          draggable: canManage && !readOnly && unit.parentId !== null,
          dragHandle: ".org-drag-handle",
          data: {
            id,
            name: unit.name,
            typeName: unit.typeName,
            code: unit.code,
            accessibleName: organizationAccessibleName(model, id, say),
            root: unit.parentId === null,
            selected: selectedId === id,
            collapsed: collapsed.has(id),
            hasChildren: (model.childrenByParent.get(id)?.length ?? 0) > 0,
            hiddenCount: collapsed.has(id) ? (model.descendantsById.get(id)?.size ?? 0) : 0,
            canManage,
            readOnly,
            inBranch: branchSet?.has(id) === true && id !== selectedId,
            lifted: id === dragSource,
            dimmed: movingSet?.has(id) === true && id !== dragSource && dropTarget !== id,
            validDrop: isCandidate && !isInvalidMoveTarget(model, dragSource!, id),
            invalidDrop: isCandidate && isInvalidMoveTarget(model, dragSource!, id),
            revealed: revealedIds.has(id),
            onSelect,
            onToggle: handleToggle,
            onAddChild,
          },
        };
      }),
      edges: visibleEdges.map<Edge>((edge) => {
        // A link inside the selected branch: both ends are in the sub-tree, so the whole
        // branch — nodes and the connecting ropes — reads as one highlighted lineage.
        const inBranch = branchSet !== null && branchSet.has(edge.source) && branchSet.has(edge.target);
        return {
          id: `${edge.source}-${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          animated: inBranch && dragSource === null,
          style: {
            stroke: inBranch ? "var(--primary)" : "var(--border)",
            strokeWidth: inBranch ? 2.25 : 1.25,
            opacity: dragSource && movingSet?.has(edge.target) ? 0.4 : 1,
          },
        };
      }),
    };
  }, [canManage, collapsed, dragSource, dropTarget, handleToggle, model, onAddChild, onSelect, readOnly, revealedIds, say, selectedId]);

  nodesRef.current = nodes;

  // Pin the live drag position onto the dragged card so mid-drag relayouts don't snap it
  // back to its dagre slot; every other node keeps its computed position.
  const displayNodes = useMemo(() => {
    if (!dragSource || !dragPos) return nodes;
    return nodes.map((node) => (node.id === dragSource ? { ...node, position: dragPos } : node));
  }, [nodes, dragSource, dragPos]);

  // Frame the head of the organization: the root at a readable zoom, biased rightward so
  // its immediate children (which flow to the right in this left-to-right layout) come
  // into view and the rest is a scroll/zoom away. The built-in `fitView` frames a large
  // org too small, so this replaces it with a legible entry, framed once per dataset.
  // Called from `onInit` for the first mount (which runs after ReactFlow's own viewport
  // init, so it is not clobbered) and from the effect below for later dataset changes.
  const frameEntry = useCallback(
    (instance: ReactFlowInstance<OrganizationFlowNode, Edge>) => {
      if (!autoFrame) return;
      const current = nodesRef.current;
      const root = current.find((node) => model.roots.includes(node.id)) ?? current[0];
      if (!root) return;
      framedRef.current = dataKey;
      void instance.setCenter(root.position.x + NODE_WIDTH * 2.5, root.position.y + NODE_HEIGHT / 2, {
        zoom: DEFAULT_ZOOM,
        duration: reduceMotion() ? 0 : 240,
      });
    },
    [autoFrame, dataKey, model.roots]
  );

  useEffect(() => {
    // Re-frame on a genuine dataset change after mount (effective-date, import); the
    // first mount is handled by onInit. Skips expand/collapse (same dataKey).
    if (!flowRef.current || framedRef.current === null || framedRef.current === dataKey) return;
    frameEntry(flowRef.current);
  }, [dataKey, frameEntry]);

  const findDropTarget: OnNodeDrag<OrganizationFlowNode> = (_event, dragged) => {
    // Trigger as soon as the dragged card overlaps a target card (not only when
    // its center reaches the target); pick the most-overlapped node.
    const ax1 = dragged.position.x;
    const ay1 = dragged.position.y;
    const ax2 = ax1 + NODE_WIDTH;
    const ay2 = ay1 + NODE_HEIGHT;
    let candidate: string | null = null;
    let bestOverlap = 0;
    for (const node of nodes) {
      if (node.id === dragged.id) continue;
      const overlapX = Math.max(0, Math.min(ax2, node.position.x + NODE_WIDTH) - Math.max(ax1, node.position.x));
      const overlapY = Math.max(0, Math.min(ay2, node.position.y + NODE_HEIGHT) - Math.max(ay1, node.position.y));
      const overlap = overlapX * overlapY;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        candidate = node.id;
      }
    }
    setDropTarget(candidate);
    setDragPos(dragged.position);
  };

  const handleDragStop: OnNodeDrag<OrganizationFlowNode> = (_event, dragged) => {
    if (dropTarget && dropTarget !== dragged.id && !isInvalidMoveTarget(model, dragged.id, dropTarget)) {
      onStageDragMove(dragged.id, dropTarget);
    }
    setDragSource(null);
    setDropTarget(null);
    setDragPos(null);
  };

  const draggedUnit = dragSource ? model.byId.get(dragSource) : null;
  const draggedCount = dragSource ? (model.descendantsById.get(dragSource)?.size ?? 0) : 0;

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden bg-section">
      {draggedUnit ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-popover px-3.5 py-1.5 text-xs shadow-raised">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              dropTarget ? (dropValid ? "bg-primary" : "bg-destructive") : "bg-muted-foreground"
            )}
          />
          <span className="font-medium">
            {draggedCount > 0
              ? t("chart.movingWith", { name: draggedUnit.name, count: draggedCount })
              : t("chart.moving", { name: draggedUnit.name })}
          </span>
          <span className="text-muted-foreground">
            {dropTarget
              ? dropValid
                ? t("chart.dropToReview")
                : t("chart.cantDrop")
              : t("chart.dropOnto")}
          </span>
        </div>
      ) : null}
      <ReactFlow<OrganizationFlowNode, Edge>
        // React Flow positions in physical pixels and breaks right to left; the chart reads left to right in every language.
        dir="ltr"
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 0, y: 0, zoom: DEFAULT_ZOOM }}
        minZoom={0.08}
        maxZoom={MAX_ZOOM}
        nodesConnectable={false}
        elementsSelectable={false}
        nodeDragThreshold={8}
        onInit={(instance) => {
          flowRef.current = instance;
          frameEntry(instance);
        }}
        onNodeDragStart={(_event, node) => { setDragSource(node.id); setDragPos(node.position); }}
        onNodeDrag={findDropTarget}
        onNodeDragStop={handleDragStop}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <FocusSelected selectedId={selectedId} isRoot={selectedIsRoot} nodes={nodes} />
        <AnchorViewport nodes={nodes} pendingAnchorRef={pendingAnchorRef} />
        <RevealViewport revealedIds={revealedIds} nodes={nodes} />
        {/* Fine single grid that rides the viewport transform, so panning and
            zooming read as movement through space. */}
        <Background
          variant={BackgroundVariant.Lines}
          gap={16}
          lineWidth={1}
          color="color-mix(in oklab, var(--border) 50%, transparent)"
        />
        <Controls position="bottom-right" showInteractive={false} />
        {nodes.length > 30 ? (
          <MiniMap
            ariaLabel={t("chart.overview")}
            pannable
            zoomable
            className="!bottom-3 ltr:!right-14 !rounded-control !border !border-border !bg-popover !shadow-raised"
            maskColor="color-mix(in oklab, var(--muted) 66%, transparent)"
            nodeColor={(node) =>
              node.data?.root === true || node.data?.selected === true
                ? "var(--primary)"
                : "var(--muted-foreground)"
            }
            nodeStrokeColor="transparent"
            nodeBorderRadius={2}
          />
        ) : null}
      </ReactFlow>
    </div>
  );
}
