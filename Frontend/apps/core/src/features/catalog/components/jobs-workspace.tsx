"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CompanyListValueDto, JobDto } from "@repo/api";
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
  DataTableCellEmpty,
  DataTableCellStack,
  createDataTableColumnHelper,
  useDataTable,
  type DataTableFilterField,
} from "@repo/ds/data-table";
import { StatusBadge } from "@repo/ds/shell";
import { Archive, Briefcase, GitMerge, Layers, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCompanyLists, useJobMutations, useJobs } from "../api/use-catalog";
import { CatalogFrame, CountCell } from "./catalog-frame";
import { DeleteDialog, JobDialog, MergeDialog, toMergeable } from "./catalog-dialogs";

const column = createDataTableColumnHelper<JobDto>();
const NO_FAMILY = "none";

/** Jobs ordered the way the catalogue reads: by family (the list's order, no family last), then title. */
function ordered(jobs: JobDto[], families: CompanyListValueDto[]): JobDto[] {
  const rank = new Map(families.map((family, index) => [family.id, index]));
  const familyRank = (job: JobDto) => (job.family ? (rank.get(job.family.id) ?? families.length) : families.length + 1);
  return [...jobs].sort(
    (a, b) => familyRank(a) - familyRank(b) || Number(a.isRetired) - Number(b.isRetired) || a.title.localeCompare(b.title),
  );
}

/**
 * The company's jobs (Organization › Jobs): grouped by family, each with its level and who holds it today. People who
 * manage the structure add, edit, merge duplicates, retire and delete; everyone else who works with the structure reads.
 */
export function JobsWorkspace() {
  const t = useTranslations("catalog");
  const { user } = useAuth();
  const canManage = canManageCoreOrganization(user);
  const jobs = useJobs();
  const lists = useCompanyLists();
  const { retire } = useJobMutations();
  const [editing, setEditing] = useState<JobDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [merging, setMerging] = useState<JobDto | null>(null);
  const [deleting, setDeleting] = useState<JobDto | null>(null);

  const families = useMemo(() => lists.data?.find((list) => list.id === "job-families")?.values ?? [], [lists.data]);
  const levels = useMemo(() => lists.data?.find((list) => list.id === "levels")?.values ?? [], [lists.data]);
  const levelRank = useMemo(() => new Map(levels.map((level, index) => [level.id, index])), [levels]);
  const rows = useMemo(() => (jobs.data ? ordered(jobs.data, families) : undefined), [jobs.data, families]);

  function edit(job: JobDto | null) {
    setEditing(job);
    setDialogOpen(true);
  }

  async function setRetired(job: JobDto, retired: boolean) {
    try {
      await retire.mutateAsync({ id: job.id, retired });
      toast.success(t(retired ? "job.retired" : "job.restored", { name: job.title }));
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  const columns = useMemo(
    () => [
      column.accessor("title", {
        header: t("jobs.col.job"),
        cell: ({ row }) => {
          const job = row.original;
          return (
            <DataTableCellStack
              leading={
                <span className="grid size-8 shrink-0 place-items-center rounded-control bg-inlay text-muted-foreground">
                  <Briefcase className="size-4" aria-hidden />
                </span>
              }
              primary={
                <span className="flex min-w-0 items-center gap-2">
                  <span className={job.isRetired ? "truncate text-muted-foreground" : "truncate"}>{job.title}</span>
                  {job.isRetired ? <StatusBadge tone="muted">{t("retired")}</StatusBadge> : null}
                </span>
              }
            />
          );
        },
        meta: { width: "46%" },
      }),
      column.accessor((job) => job.level?.label ?? "", {
        id: "level",
        header: t("jobs.col.level"),
        sortFn: (a: { original: JobDto }, b: { original: JobDto }) => (levelRank.get(a.original.level?.id ?? "") ?? 99) - (levelRank.get(b.original.level?.id ?? "") ?? 99),
        cell: ({ row }) => (row.original.level ? <span className="type-body">{row.original.level.label}</span> : <DataTableCellEmpty />),
        meta: { width: "20%", hideBelow: "sm" },
      }),
      column.accessor("peopleCount", {
        header: t("jobs.col.people"),
        cell: ({ getValue }) => <CountCell value={getValue()} />,
        meta: { width: "12%", align: "end" },
      }),
      column.accessor("openRoleCount", {
        header: t("jobs.col.openRoles"),
        cell: ({ getValue }) => <CountCell value={getValue()} />,
        meta: { width: "12%", align: "end", hideBelow: "md" },
      }),
      ...(canManage
        ? [
            column.display({
              id: "actions",
              header: () => <span className="sr-only">{t("more")}</span>,
              cell: ({ row }) => (
                <JobMenu
                  job={row.original}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers only open dialogs; the columns change with the words and levels
    [t, canManage, levelRank],
  );

  const filters = useMemo<DataTableFilterField<JobDto>[]>(
    () => [
      {
        id: "family",
        label: t("jobs.filter.family"),
        icon: Layers,
        type: "options",
        options: [
          ...families.map((family) => ({ value: family.id, label: family.label })),
          { value: NO_FAMILY, label: t("jobs.noFamily") },
        ],
        value: (job) => job.family?.id ?? NO_FAMILY,
      },
      {
        id: "level",
        label: t("jobs.filter.level"),
        type: "options",
        options: levels.map((level) => ({ value: level.id, label: level.label })),
        value: (job) => job.level?.id ?? null,
      },
      {
        id: "state",
        label: t("jobs.filter.state"),
        type: "options",
        single: true,
        options: [
          { value: "active", label: t("jobs.filter.active"), match: (job) => !job.isRetired },
          { value: "retired", label: t("jobs.filter.retired"), match: (job) => job.isRetired },
        ],
      },
    ],
    [t, families, levels],
  );

  const model = useDataTable({
    data: rows,
    columns,
    getRowId: (job) => job.id,
    search: (job) => `${job.title} ${job.family?.label ?? ""} ${job.level?.label ?? ""}`,
    filters,
    pageSize: 50,
  });

  const familyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of rows ?? []) counts.set(job.family?.id ?? NO_FAMILY, (counts.get(job.family?.id ?? NO_FAMILY) ?? 0) + 1);
    return counts;
  }, [rows]);

  return (
    <CatalogFrame
      lens="jobs"
      actions={
        canManage ? (
          <Button onClick={() => edit(null)}>
            <Plus className="size-4" aria-hidden />
            {t("job.add")}
          </Button>
        ) : undefined
      }
    >
      <DataTable
        model={model}
        isLoading={jobs.isLoading}
        searchPlaceholder={t("jobs.searchPlaceholder")}
        noun={[t("jobs.nounOne"), t("jobs.nounOther")]}
        noResults={t("jobs.noResults")}
        error={
          jobs.error ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="type-body">{t("jobs.didNotLoad")}</p>
              <Button variant="outline" size="sm" onClick={() => void jobs.refetch()}>{t("jobs.retry")}</Button>
            </div>
          ) : undefined
        }
        emptyState={
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="type-body text-muted-foreground">{t("jobs.empty")}</p>
            {canManage ? <Button variant="outline" size="sm" onClick={() => edit(null)}>{t("jobs.emptyAction")}</Button> : null}
          </div>
        }
        rowGroup={(job) => {
          const key = job.family?.id ?? NO_FAMILY;
          const label = job.family?.label ?? t("jobs.noFamily");
          return { key, label: `${label} · ${familyCounts.get(key) ?? 0}` };
        }}
        onRowClick={canManage ? (job) => edit(job) : undefined}
        minWidth="40rem"
      />
      <JobDialog job={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <MergeDialog
        kind="job"
        source={merging ? toMergeable.job(merging) : null}
        candidates={(jobs.data ?? []).filter((job) => !job.isRetired).map(toMergeable.job)}
        onOpenChange={(open) => !open && setMerging(null)}
      />
      <DeleteDialog kind="job" target={deleting ? { id: deleting.id, name: deleting.title } : null} onOpenChange={(open) => !open && setDeleting(null)} />
    </CatalogFrame>
  );
}

function JobMenu({
  job,
  onEdit,
  onMerge,
  onRetire,
  onDelete,
}: {
  job: JobDto;
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
          {t("job.merge")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRetire(!job.isRetired)}>
          {job.isRetired ? <RotateCcw className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
          {job.isRetired ? t("bringBack") : t("retire")}
        </DropdownMenuItem>
        {!job.inUse ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
              <Trash2 className="size-4" aria-hidden />
              {t("job.delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
