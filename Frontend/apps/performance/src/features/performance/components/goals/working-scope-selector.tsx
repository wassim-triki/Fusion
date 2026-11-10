"use client";

import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Search } from "@repo/ds/icons";
import type { OrganizationHierarchyNodeDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ds/components/ui/popover";
import { ScrollArea } from "@repo/ds/components/ui/scroll-area";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";

export interface WorkingScopeUnit {
  id: string;
  name: string;
  type: string;
  path: string;
  memberCount: number | null;
}

interface ScopeTreeNode extends WorkingScopeUnit {
  children: ScopeTreeNode[];
}

/** Flattens the CoreHR tree only for deterministic scope lookup; it never creates goal nodes. */
export function scopeUnitsFromTree(
  roots: OrganizationHierarchyNodeDto[]
): WorkingScopeUnit[] {
  const units: WorkingScopeUnit[] = [];
  const visit = (node: OrganizationHierarchyNodeDto) => {
    units.push({
      id: node.unit.id,
      name: node.unit.name,
      type: node.unit.typeName,
      path: node.unit.path,
      memberCount: null,
    });
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return units;
}

function asScopeTree(nodes: OrganizationHierarchyNodeDto[]): ScopeTreeNode[] {
  return nodes.map((node) => ({
    id: node.unit.id,
    name: node.unit.name,
    type: node.unit.typeName,
    path: node.unit.path,
    memberCount: null,
    children: asScopeTree(node.children),
  }));
}

function matchingTree(nodes: ScopeTreeNode[], query: string): ScopeTreeNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = matchingTree(node.children, query);
    return node.name.toLowerCase().includes(query) || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}

/**
 * A CoreHR-backed context switcher for broad organizational viewers. It preserves the real unit
 * hierarchy in the list, while search narrows to matching branches without turning scope into a
 * lifecycle or objective filter.
 */
export function WorkingScopeSelector({
  roots,
  value,
  loading,
  onChange,
}: {
  roots: OrganizationHierarchyNodeDto[];
  value: string | null;
  loading: boolean;
  onChange: (orgUnitId: string | null) => void;
}) {
  const t = useTranslations("goals.WorkingScopeSelector");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const units = useMemo(() => scopeUnitsFromTree(roots), [roots]);
  const scopeTree = useMemo(() => asScopeTree(roots), [roots]);
  const selected = value ? units.find((unit) => unit.id === value) : null;
  const visibleRoots = useMemo(
    () => matchingTree(scopeTree, query.trim().toLowerCase()),
    [scopeTree, query]
  );

  const select = (orgUnitId: string | null) => {
    onChange(orgUnitId);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 gap-2">
          <Building2
            className="size-3.5"
            data-icon="inline-start"
            aria-hidden
          />
          <span className="truncate">
            {selected?.name ?? t("organizationWide")}
          </span>
          <ChevronDown
            className="size-3.5 text-muted-foreground"
            data-icon="inline-end"
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] gap-2 p-2"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute inset-s-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchOrganization")}
            className="ps-8"
            aria-label={t("searchWorkingScope")}
          />
        </div>
        <ScrollArea className="h-80">
          <div className="pe-2">
            <ScopeOption
              label={t("organizationWide")}
              active={value === null}
              depth={0}
              onClick={() => select(null)}
            />
            {loading ? (
              <p className="px-2.5 py-3 type-body text-muted-foreground">
                {t("loadingOrganization")}
              </p>
            ) : visibleRoots.length > 0 ? (
              visibleRoots.map((node) => (
                <ScopeBranch
                  key={node.id}
                  node={node}
                  selectedId={value}
                  onSelect={select}
                />
              ))
            ) : (
              <p className="px-2.5 py-3 type-body text-muted-foreground">
                {t("noOrganizationalUnitsMatch")}
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function ScopeBranch({
  node,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: ScopeTreeNode;
  selectedId: string | null;
  onSelect: (orgUnitId: string) => void;
  depth?: number;
}) {
  return (
    <>
      <ScopeOption
        label={node.name}
        detail={node.type}
        active={selectedId === node.id}
        depth={depth}
        onClick={() => onSelect(node.id)}
      />
      {node.children.map((child) => (
        <ScopeBranch
          key={child.id}
          node={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

function ScopeOption({
  label,
  detail,
  active,
  depth,
  onClick,
}: {
  label: string;
  detail?: string;
  active: boolean;
  depth: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-inset py-2 pe-2 text-start type-body transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-primary/[0.10] text-foreground"
      )}
      style={{ paddingInlineStart: `${0.625 + depth * 1.25}rem` }}
    >
      <Building2
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {detail ? (
        <span className="type-meta shrink-0 text-muted-foreground">
          {detail}
        </span>
      ) : null}
      {active ? (
        <Check className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
      ) : null}
    </button>
  );
}
