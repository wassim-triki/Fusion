"use client";

import { useMemo, useState } from "react";
import { Building2 } from "@repo/ds/icons";
import type { OrganizationHierarchyNodeDto } from "@repo/api";
import { EntityPicker, type EntityOption } from "@repo/ds/components/ui/entity-picker";
import { useOrgHierarchy } from "./hooks";

export interface PickedOrgUnit {
  id: string;
  name: string;
  /** Ancestor names, top-down, for the selected-path label. */
  path: string[];
}

interface FlatUnit {
  id: string;
  name: string;
  path: string[];
}

function flattenWithPath(
  nodes: OrganizationHierarchyNodeDto[],
  ancestors: string[],
  acc: FlatUnit[]
): FlatUnit[] {
  for (const node of nodes) {
    acc.push({ id: node.unit.id, name: node.unit.name, path: ancestors });
    flattenWithPath(node.children, [...ancestors, node.unit.name], acc);
  }
  return acc;
}

function OrgIcon({ className }: { className?: string }) {
  return (
    <span
      className={
        "flex shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground " +
        (className ?? "size-6")
      }
    >
      <Building2 className="size-3.5" aria-hidden />
    </span>
  );
}

/**
 * Single-select organizational-unit picker over real Core Organization data, on the shared
 * DS `EntityPicker`: the full unit list appears the moment it opens, each row showing the
 * unit name and its top-down path so the org relationship stays legible, and typing narrows
 * by name. (Expand/collapse of the tree is deferred; every unit is reachable here directly.)
 */
export function OrgUnitPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedOrgUnit | null;
  onChange: (unit: PickedOrgUnit) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hierarchy = useOrgHierarchy(open || value !== null);

  const flat = useMemo(
    () => (hierarchy.data ? flattenWithPath(hierarchy.data.roots, [], []) : []),
    [hierarchy.data]
  );

  const q = query.trim().toLowerCase();
  const options: EntityOption[] = useMemo(
    () =>
      (q === "" ? flat : flat.filter((unit) => unit.name.toLowerCase().includes(q))).map(
        (unit) => ({
          id: unit.id,
          title: unit.name,
          description: unit.path.length > 0 ? unit.path.join(" › ") : undefined,
          media: <OrgIcon />,
        })
      ),
    [flat, q]
  );

  const selection = value
    ? {
        title: value.name,
        media: <OrgIcon className="size-6" />,
      }
    : null;

  return (
    <EntityPicker
      selection={selection}
      selectedId={value?.id ?? null}
      options={options}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A transient failure would otherwise stick: this query has one fixed key, so
        // (unlike the people search) nothing re-runs it. Re-fetch on open so a prior
        // error self-heals on the next click instead of showing "unavailable" until reload.
        if (next) {
          if (hierarchy.error) void hierarchy.refetch();
        } else {
          setQuery("");
        }
      }}
      search={query}
      onSearchChange={setQuery}
      onSelect={(id) => {
        const unit = flat.find((candidate) => candidate.id === id);
        if (!unit) return;
        onChange({ id: unit.id, name: unit.name, path: unit.path });
        setOpen(false);
        setQuery("");
      }}
      loading={hierarchy.isLoading}
      disabled={disabled}
      placeholder="Select an organizational unit"
      placeholderIcon={<Building2 className="size-3.5" aria-hidden />}
      searchPlaceholder="Search units…"
      emptyLabel={
        hierarchy.error
          ? "Organization is unavailable."
          : `No units match “${query.trim()}”.`
      }
      hint={hierarchy.error ? "Organization is unavailable." : "No units found."}
    />
  );
}
