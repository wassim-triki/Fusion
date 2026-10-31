"use client";

import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { OrganizationUnitStateDto, UnitStaffingDto } from "@repo/api";
import { cn } from "@repo/ds";
import {
  DataTable,
  DataTableCellEmpty,
  DataTableCellStack,
  createDataTableColumnHelper,
  useDataTable,
  type DataTableFilterField,
} from "@repo/ds/data-table";
import { Layers } from "lucide-react";
import { Monogram } from "@/features/people/components/workforce-ui";
import type { OrganizationHierarchyModel } from "../model/hierarchy";

/** A unit as the list reads it: the unit, how deep it sits, the units above it, and who works there on the date. */
interface UnitRow {
  unit: OrganizationUnitStateDto;
  depth: number;
  above: string;
  staff: UnitStaffingDto | undefined;
}

const column = createDataTableColumnHelper<UnitRow>();

/**
 * Organization's List view, on the table kit People uses: every unit in hierarchy order, indented, with its type,
 * head and headcount on the date; search by name, code or head, filter by type. A row opens the unit's panel.
 */
export function OrganizationList({
  model,
  staffing,
  selectedId,
  onSelect,
}: {
  model: OrganizationHierarchyModel;
  staffing?: ReadonlyMap<string, UnitStaffingDto>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("organization");
  // Indented as a tree while the whole list shows; a search or filter shows each match with what it sits under.
  const filtered = useRef(false);

  const rows = useMemo<UnitRow[]>(() => {
    const ordered: UnitRow[] = [];
    const visit = (id: string) => {
      const unit = model.byId.get(id);
      if (!unit) return;
      const path = model.pathById.get(id) ?? [];
      ordered.push({
        unit,
        depth: model.depthById.get(id) ?? 0,
        above: path.slice(0, -1).map((ancestor) => model.byId.get(ancestor)?.name ?? "").filter(Boolean).join(" › "),
        staff: staffing?.get(id),
      });
      for (const child of model.childrenByParent.get(id) ?? []) visit(child);
    };
    for (const root of model.roots) visit(root);
    return ordered;
  }, [model, staffing]);

  const columns = useMemo(
    () => [
      column.accessor((row) => row.unit.name, {
        id: "unit",
        header: t("outline.unit"),
        enableSorting: false,
        cell: ({ row }) => {
          const { unit, depth, above } = row.original;
          const flat = filtered.current;
          return (
            <span className="block" style={flat ? undefined : { paddingInlineStart: `${depth * 20}px` }}>
              <DataTableCellStack
                primary={<span className={cn("truncate", unit.id === selectedId && "text-primary-ink")}>{unit.name}</span>}
                secondary={flat && above ? above : undefined}
              />
            </span>
          );
        },
        meta: { width: "34%" },
      }),
      column.accessor((row) => row.unit.typeName, {
        id: "type",
        header: t("outline.type"),
        enableSorting: false,
        cell: ({ getValue }) => <span className="type-body text-muted-foreground">{getValue()}</span>,
        meta: { width: "14%", hideBelow: "sm" },
      }),
      column.accessor((row) => row.staff?.head?.displayName ?? "", {
        id: "head",
        header: t("outline.head"),
        enableSorting: false,
        cell: ({ row }) => {
          const head = row.original.staff?.head;
          return head ? (
            <span className="flex min-w-0 items-center gap-2">
              <Monogram name={head.displayName} photoUrl={head.photoUrl} size="sm" className="size-6 text-[10px]" />
              <span className="truncate type-body">{head.displayName}</span>
            </span>
          ) : <DataTableCellEmpty />;
        },
        meta: { width: "24%", hideBelow: "md" },
      }),
      column.accessor((row) => row.staff?.people ?? -1, {
        id: "people",
        header: t("outline.people"),
        enableSorting: false,
        cell: ({ row }) => (row.original.staff ? <span className="type-body tabular-nums">{row.original.staff.people}</span> : <DataTableCellEmpty />),
        meta: { width: "8%", align: "end" },
      }),
      column.accessor((row) => row.unit.code, {
        id: "code",
        header: t("outline.code"),
        enableSorting: false,
        cell: ({ getValue }) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{getValue()}</span>,
        meta: { width: "20%", align: "end", hideBelow: "lg" },
      }),
    ],
    [t, selectedId]
  );

  const types = useMemo(
    () => [...new Map(model.units.map((unit) => [unit.typeId, unit.typeName])).entries()],
    [model.units]
  );
  const filters = useMemo<DataTableFilterField<UnitRow>[]>(
    () => [
      {
        id: "type",
        label: t("outline.type"),
        icon: Layers,
        type: "options",
        options: types.map(([id, name]) => ({ value: id, label: name })),
        value: (row) => row.unit.typeId,
      },
    ],
    [t, types]
  );

  const table = useDataTable({
    data: rows,
    columns,
    getRowId: (row) => row.unit.id,
    search: (row) => `${row.unit.name} ${row.unit.code} ${row.staff?.head?.displayName ?? ""}`,
    filters,
    pageSize: 100,
  });
  filtered.current = table.isFiltered;

  return (
    <div className="h-full overflow-auto bg-section p-4">
      <DataTable
        model={table}
        searchPlaceholder={t("search.placeholder")}
        noun={[t("list.nounOne"), t("list.nounOther")]}
        noResults={t("search.none")}
        onRowClick={(row) => onSelect(row.unit.id)}
      />
    </div>
  );
}
