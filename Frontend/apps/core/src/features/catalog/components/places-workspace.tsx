"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { PlaceDto } from "@repo/api";
import { canManageCoreOrganization, useAuth } from "@repo/auth";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ds";
import {
  DataTable,
  DataTableCellStack,
  createDataTableColumnHelper,
  useDataTable,
  type DataTableFilterField,
} from "@repo/ds/data-table";
import { StatusBadge } from "@repo/ds/shell";
import { Archive, GitMerge, MapPin, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { usePlaceMutations, usePlaces } from "../api/use-catalog";
import { CatalogFrame, CountCell } from "./catalog-frame";
import { DeleteDialog, MergeDialog, PlaceDialog, toMergeable } from "./catalog-dialogs";
import { placeContext } from "./catalog-pickers";

const column = createDataTableColumnHelper<PlaceDto>();

/** Where people work (Organization › Places): each place with its city and country and who works there today. */
export function PlacesWorkspace() {
  const t = useTranslations("catalog");
  const { user } = useAuth();
  const canManage = canManageCoreOrganization(user);
  const places = usePlaces();
  const { retire } = usePlaceMutations();
  const [editing, setEditing] = useState<PlaceDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [merging, setMerging] = useState<PlaceDto | null>(null);
  const [deleting, setDeleting] = useState<PlaceDto | null>(null);

  const rows = useMemo(
    () => places.data && [...places.data].sort((a, b) => Number(a.isRetired) - Number(b.isRetired) || b.peopleCount - a.peopleCount || a.name.localeCompare(b.name)),
    [places.data],
  );

  function edit(place: PlaceDto | null) {
    setEditing(place);
    setDialogOpen(true);
  }

  async function setRetired(place: PlaceDto, retired: boolean) {
    try {
      await retire.mutateAsync({ id: place.id, retired });
      toast.success(t(retired ? "place.retired" : "place.restored", { name: place.name }));
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: t("places.col.place"),
        cell: ({ row }) => {
          const place = row.original;
          return (
            <DataTableCellStack
              leading={
                <span className="grid size-8 shrink-0 place-items-center rounded-control bg-inlay text-muted-foreground">
                  <MapPin className="size-4" aria-hidden />
                </span>
              }
              primary={
                <span className="flex min-w-0 items-center gap-2">
                  <span className={place.isRetired ? "truncate text-muted-foreground" : "truncate"}>{place.name}</span>
                  {place.isRetired ? <StatusBadge tone="muted">{t("retired")}</StatusBadge> : null}
                </span>
              }
              secondary={placeContext(place)}
            />
          );
        },
        meta: { width: "62%" },
      }),
      column.accessor("peopleCount", {
        header: t("places.col.people"),
        cell: ({ getValue }) => <CountCell value={getValue()} />,
        meta: { width: "15%", align: "end" },
      }),
      column.accessor("openRoleCount", {
        header: t("places.col.openRoles"),
        cell: ({ getValue }) => <CountCell value={getValue()} />,
        meta: { width: "15%", align: "end", hideBelow: "md" },
      }),
      ...(canManage
        ? [
            column.display({
              id: "actions",
              header: () => <span className="sr-only">{t("more")}</span>,
              cell: ({ row }) => (
                <PlaceMenu
                  place={row.original}
                  onEdit={() => edit(row.original)}
                  onMerge={() => setMerging(row.original)}
                  onRetire={(retired) => void setRetired(row.original, retired)}
                  onDelete={() => setDeleting(row.original)}
                />
              ),
              meta: { width: "3.5rem", align: "end" },
            }),
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers only open dialogs; the columns change with the words
    [t, canManage],
  );

  const filters = useMemo<DataTableFilterField<PlaceDto>[]>(
    () => [
      {
        id: "state",
        label: t("places.filter.state"),
        type: "options",
        single: true,
        options: [
          { value: "active", label: t("places.filter.active"), match: (place) => !place.isRetired },
          { value: "retired", label: t("places.filter.retired"), match: (place) => place.isRetired },
        ],
      },
    ],
    [t],
  );

  const model = useDataTable({
    data: rows,
    columns,
    getRowId: (place) => place.id,
    search: (place) => `${place.name} ${place.city ?? ""} ${place.country ?? ""}`,
    filters,
    pageSize: 50,
  });

  return (
    <CatalogFrame
      lens="places"
      actions={
        canManage ? (
          <Button onClick={() => edit(null)}>
            <Plus className="size-4" aria-hidden />
            {t("place.add")}
          </Button>
        ) : undefined
      }
    >
      <DataTable
        model={model}
        isLoading={places.isLoading}
        searchPlaceholder={t("places.searchPlaceholder")}
        noun={[t("places.nounOne"), t("places.nounOther")]}
        noResults={t("places.noResults")}
        error={
          places.error ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="type-body">{t("places.didNotLoad")}</p>
              <Button variant="outline" size="sm" onClick={() => void places.refetch()}>{t("places.retry")}</Button>
            </div>
          ) : undefined
        }
        emptyState={
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="type-body text-muted-foreground">{t("places.empty")}</p>
            {canManage ? <Button variant="outline" size="sm" onClick={() => edit(null)}>{t("places.emptyAction")}</Button> : null}
          </div>
        }
        onRowClick={canManage ? (place) => edit(place) : undefined}
        minWidth="36rem"
      />
      <PlaceDialog place={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <MergeDialog
        kind="place"
        source={merging ? toMergeable.place(merging) : null}
        candidates={(places.data ?? []).filter((place) => !place.isRetired).map(toMergeable.place)}
        onOpenChange={(open) => !open && setMerging(null)}
      />
      <DeleteDialog kind="place" target={deleting ? { id: deleting.id, name: deleting.name } : null} onOpenChange={(open) => !open && setDeleting(null)} />
    </CatalogFrame>
  );
}

function PlaceMenu({
  place,
  onEdit,
  onMerge,
  onRetire,
  onDelete,
}: {
  place: PlaceDto;
  onEdit: () => void;
  onMerge: () => void;
  onRetire: (retired: boolean) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("catalog");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("more")} onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-4" aria-hidden />
          {t("edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMerge}>
          <GitMerge className="size-4" aria-hidden />
          {t("place.merge")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRetire(!place.isRetired)}>
          {place.isRetired ? <RotateCcw className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
          {place.isRetired ? t("bringBack") : t("retire")}
        </DropdownMenuItem>
        {!place.inUse ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
              <Trash2 className="size-4" aria-hidden />
              {t("place.delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
