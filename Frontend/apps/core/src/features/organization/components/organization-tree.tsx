"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input, cn } from "@repo/ds";
import { Building2, Check, ChevronRight, Search } from "@repo/ds/icons";
import type { OrganizationHierarchyNodeDto } from "@repo/api";

/**
 * The one Core Organization selector. A real tree — carets for branches, a leaf marker for
 * teams, parent-path context, and search — so hierarchy is communicated structurally rather
 * than by indentation alone. Used by the People filter, Hire, Add Existing, and anywhere Core
 * needs an Organization chosen from the canonical structure.
 */

interface FlatNode {
  id: string;
  name: string;
  path: string;
  ancestry: string;
  depth: number;
  hasChildren: boolean;
}

export function OrganizationTree({
  roots,
  selectedId,
  onSelect,
  allOption,
  emptyLabel,
  autoFocusSearch = true,
}: {
  roots: OrganizationHierarchyNodeDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Optional "everything" leaf pinned at the top (e.g. the People filter). */
  allOption?: { label: string };
  emptyLabel?: string;
  autoFocusSearch?: boolean;
}) {
  const t = useTranslations("organization");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searchRef = useRef<HTMLInputElement>(null);

  // Ancestry index + the path of ids from root to the selected node (to auto-expand it).
  const { flat, parentPathIds } = useMemo(() => {
    const flatList: FlatNode[] = [];
    const parents: Record<string, string[]> = {};
    const walk = (nodes: OrganizationHierarchyNodeDto[], depth: number, trail: string[]) => {
      for (const node of nodes) {
        const segments = node.unit.path.split("/").map((s) => s.trim()).filter(Boolean);
        flatList.push({
          id: node.unit.id,
          name: node.unit.name,
          path: node.unit.path,
          ancestry: segments.slice(0, -1).join(" / "),
          depth,
          hasChildren: node.children.length > 0,
        });
        parents[node.unit.id] = trail;
        walk(node.children, depth + 1, [...trail, node.unit.id]);
      }
    };
    walk(roots, 0, []);
    return { flat: flatList, parentPathIds: selectedId ? parents[selectedId] ?? [] : [] };
  }, [roots, selectedId]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Reveal the selected node when the tree opens or selection changes.
  useEffect(() => {
    if (parentPathIds.length) setExpanded((prev) => new Set([...prev, ...parentPathIds]));
  }, [parentPathIds]);
  useEffect(() => {
    if (autoFocusSearch) searchRef.current?.focus();
  }, [autoFocusSearch]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const searchResults = useMemo(
    () => (q ? flat.filter((n) => n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)).slice(0, 60) : []),
    [flat, q]
  );

  return (
    <div>
      <div className="relative border-b border-border p-2.5">
        <Search className="pointer-events-none absolute inset-s-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("tree.search")}
          aria-label={t("tree.search")}
          className="h-9 ps-9"
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1" role="tree" aria-label={t("tree.label")}>
        {allOption ? (
          <Row
            leaf
            depth={0}
            name={allOption.label}
            selected={selectedId === null}
            onSelect={() => onSelect(null)}
          />
        ) : null}

        {q ? (
          searchResults.length > 0 ? (
            searchResults.map((n) => (
              <Row
                key={n.id}
                leaf
                depth={0}
                name={n.name}
                ancestry={n.ancestry}
                selected={selectedId === n.id}
                onSelect={() => onSelect(n.id)}
              />
            ))
          ) : (
            <p className="p-6 text-center type-meta text-muted-foreground">{emptyLabel ?? t("tree.none")}</p>
          )
        ) : (
          <TreeLevel
            nodes={roots}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
        {!q && roots.length === 0 && !allOption ? (
          <p className="p-6 text-center type-meta text-muted-foreground">{emptyLabel ?? t("tree.none")}</p>
        ) : null}
      </div>
    </div>
  );
}

function TreeLevel({
  nodes,
  depth,
  expanded,
  onToggle,
  selectedId,
  onSelect,
}: {
  nodes: OrganizationHierarchyNodeDto[];
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isOpen = expanded.has(node.unit.id);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.unit.id} role="none">
            <Row
              depth={depth}
              name={node.unit.name}
              hasChildren={hasChildren}
              open={isOpen}
              onToggle={() => onToggle(node.unit.id)}
              selected={selectedId === node.unit.id}
              onSelect={() => onSelect(node.unit.id)}
            />
            {hasChildren && isOpen ? (
              <TreeLevel
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Row({
  depth,
  name,
  ancestry,
  hasChildren,
  open,
  onToggle,
  leaf,
  selected,
  onSelect,
}: {
  depth: number;
  name: string;
  ancestry?: string;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
  leaf?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("organization");
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      className={cn(
        "flex items-center gap-1 rounded-control pe-2 transition-colors",
        selected ? "bg-primary/[0.08]" : "hover:bg-muted/70"
      )}
      style={{ paddingInlineStart: `${0.25 + depth * 1}rem` }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={open ? t("tree.collapse") : t("tree.expand")}
          onClick={onToggle}
          className="grid size-6 shrink-0 place-items-center rounded-detail text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
        </button>
      ) : (
        <span className="grid size-6 shrink-0 place-items-center" aria-hidden>
          <span className={cn("rounded-full", leaf ? "size-1 bg-muted-foreground/40" : "")} />
        </span>
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-detail"
      >
        <Building2 className={cn("size-4 shrink-0", selected ? "text-primary-ink" : "text-muted-foreground")} aria-hidden />
        <span className="min-w-0">
          <span className={cn("block truncate type-label", selected ? "font-semibold text-foreground" : "font-medium text-foreground")}>
            {name}
          </span>
          {ancestry ? <span className="block truncate type-meta text-muted-foreground">{ancestry}</span> : null}
        </span>
      </button>
      {selected ? <Check className="size-4 shrink-0 text-primary-ink" aria-hidden /> : null}
    </div>
  );
}
