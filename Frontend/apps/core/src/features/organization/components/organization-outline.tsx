"use client";

import { useSay } from "@repo/ds/lib/say";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { Button, cn } from "@repo/ds";
import type { UnitStaffingDto } from "@repo/api";
import { Monogram } from "@/features/people/components/workforce-ui";
import {
  flattenOrganizationHierarchy,
  isInvalidMoveTarget,
  organizationAccessibleName,
  type OrganizationHierarchyModel,
} from "../model/hierarchy";

export interface OrganizationOutlineProps {
  model: OrganizationHierarchyModel;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  /** Each unit's people and head on the list's date, when the viewer may read them. */
  staffing?: ReadonlyMap<string, UnitStaffingDto>;
  canManage: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (id: string) => void;
  onStageDragMove: (sourceId: string, targetId: string) => void;
}

export function OrganizationOutline({
  model,
  collapsed,
  selectedId,
  staffing,
  canManage,
  readOnly,
  onSelect,
  onToggle,
  onAddChild,
  onStageDragMove,
}: OrganizationOutlineProps) {
  const t = useTranslations("organization");
  const say = useSay("organization");
  const rows = useMemo(() => flattenOrganizationHierarchy(model, collapsed), [collapsed, model]);
  const [activeId, setActiveId] = useState(selectedId ?? rows[0]?.unit.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const dragMovable = canManage && !readOnly;

  useEffect(() => {
    if (selectedId) setActiveId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function focusAt(index: number) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setActiveId(row.unit.id);
    rowRefs.current.get(row.unit.id)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const row = rows[index];
    if (!row) return;
    if (event.key === "ArrowDown") { event.preventDefault(); focusAt(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
    else if (event.key === "End") { event.preventDefault(); focusAt(rows.length - 1); }
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.hasChildren && !row.expanded) onToggle(row.unit.id);
      else if (row.hasChildren) focusAt(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.hasChildren && row.expanded) onToggle(row.unit.id);
      else if (row.unit.parentId) {
        const parentIndex = rows.findIndex((candidate) => candidate.unit.id === row.unit.parentId);
        if (parentIndex >= 0) focusAt(parentIndex);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(row.unit.id);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, targetId: string) {
    if (!dragId || dragId === targetId) return;
    event.preventDefault();
    const invalid = isInvalidMoveTarget(model, dragId, targetId);
    event.dataTransfer.dropEffect = invalid ? "none" : "move";
    setOverId(targetId);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    const source = dragId;
    setDragId(null);
    setOverId(null);
    if (!source || source === targetId || isInvalidMoveTarget(model, source, targetId)) return;
    onStageDragMove(source, targetId);
  }

  return (
    <div role="treegrid" aria-label={t("outline.label")} aria-rowcount={rows.length} className="h-full min-h-[520px] overflow-auto bg-section">
      <div role="row" className="sticky top-0 z-10 grid grid-cols-[minmax(260px,1fr)_160px_220px_90px_120px] border-b bg-card px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm">
        <span role="columnheader">{t("outline.unit")}</span>
        <span role="columnheader">{t("outline.type")}</span>
        <span role="columnheader">{t("outline.head")}</span>
        <span role="columnheader" className="text-end">{t("outline.people")}</span>
        <span role="columnheader" className="text-end">{t("outline.code")}</span>
      </div>
      {rows.map((row, index) => {
        const selected = row.unit.id === selectedId;
        const isOver = overId === row.unit.id && dragId !== null && dragId !== row.unit.id;
        const overInvalid = isOver && isInvalidMoveTarget(model, dragId!, row.unit.id);
        const canDragRow = dragMovable && row.unit.parentId !== null;
        return (
          <div
            key={row.unit.id}
            ref={(element) => { if (element) rowRefs.current.set(row.unit.id, element); else rowRefs.current.delete(row.unit.id); }}
            role="row"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={selected}
            aria-label={organizationAccessibleName(model, row.unit.id, say)}
            tabIndex={activeId === row.unit.id ? 0 : -1}
            onFocus={() => setActiveId(row.unit.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onDoubleClick={() => onSelect(row.unit.id)}
            onDragOver={dragMovable ? (event) => handleDragOver(event, row.unit.id) : undefined}
            onDragLeave={() => setOverId((current) => (current === row.unit.id ? null : current))}
            onDrop={dragMovable ? (event) => handleDrop(event, row.unit.id) : undefined}
            className={cn(
              "group grid min-h-12 grid-cols-[minmax(260px,1fr)_160px_220px_90px_120px] items-center border-b border-border/70 px-4 text-sm outline-none [content-visibility:auto] [contain-intrinsic-size:48px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected ? "bg-primary/[0.07]" : "hover:bg-muted/45",
              dragId === row.unit.id && "opacity-50",
              isOver && !overInvalid && "ring-2 ring-inset ring-primary/45 bg-primary/[0.06]",
              overInvalid && "ring-2 ring-inset ring-destructive/35 bg-destructive/[0.05]"
            )}
          >
            <div role="gridcell" className="flex min-w-0 items-center" style={{ paddingInlineStart: `${row.depth * 24}px` }}>
              {row.hasChildren ? (
                <button type="button" aria-label={t(row.expanded ? "outline.collapse" : "outline.expand", { name: row.unit.name })} onClick={() => onToggle(row.unit.id)} className="me-1 grid h-7 w-7 shrink-0 place-items-center rounded-control-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  {row.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              ) : <span className="me-1 h-7 w-7 shrink-0" />}
              <button type="button" onClick={() => onSelect(row.unit.id)} className="min-w-0 truncate text-start font-medium outline-none focus-visible:underline">
                {row.unit.name}
              </button>
              {dragMovable ? (
                <div className="ms-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button variant="ghost" size="icon-sm" aria-label={t("outline.addChild", { name: row.unit.name })} onClick={() => onAddChild(row.unit.id)}><Plus className="h-3.5 w-3.5" /></Button>
                  {canDragRow ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      draggable
                      aria-label={t("outline.drag", { name: row.unit.name })}
                      title={t("outline.dragHint")}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", row.unit.id);
                        setDragId(row.unit.id);
                      }}
                      onDragEnd={() => { setDragId(null); setOverId(null); }}
                      className="grid h-7 w-7 cursor-grab place-items-center rounded-control-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <span role="gridcell" className="text-muted-foreground">{row.unit.typeName}</span>
            <span role="gridcell" className="flex min-w-0 items-center gap-2 text-muted-foreground">
              {staffing?.get(row.unit.id)?.head ? (
                <>
                  <Monogram name={staffing.get(row.unit.id)!.head!.displayName} photoUrl={staffing.get(row.unit.id)!.head!.photoUrl} size="sm" className="size-6 text-[10px]" />
                  <span className="truncate text-foreground">{staffing.get(row.unit.id)!.head!.displayName}</span>
                </>
              ) : null}
            </span>
            <span role="gridcell" className="text-end font-semibold tabular-nums">{staffing?.get(row.unit.id)?.people ?? ""}</span>
            <span role="gridcell" className="text-end font-mono text-xs text-muted-foreground">{row.unit.code}</span>
          </div>
        );
      })}
    </div>
  );
}
