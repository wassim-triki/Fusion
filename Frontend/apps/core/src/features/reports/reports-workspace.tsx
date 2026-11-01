"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  createCoreReportsApi,
  createPlatformApiClient,
  type ReportDefinition,
  type ReportMeasure,
  type ReportRunDto,
  type ReportSeriesDto,
  type SavedReportDto,
  type ReportSummaryDto,
  type ReportFieldDto,
} from "@repo/api";
import { formatDate, formatDateParts } from "@repo/ds/lib/dates";
import { useApiQuery } from "@repo/api/query";
import { canBuildCoreReports, canViewCoreReports, useAuth } from "@repo/auth";
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from "@repo/ds";
import { PageContainer, PagePermissionNotice } from "@repo/ds/shell";
import { Segmented } from "@repo/ds/choice";
import {
  createDataTableColumnHelper,
  DataTable,
  useDataTable,
} from "@repo/ds/data-table";
import {
  CalendarDays,
  Download,
  Filter,
  Plus,
  Save,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { downloadBlob } from "@/lib/download";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";
import { ReportChart, seriesColor } from "./report-chart";
import { ReportsPageSkeleton } from "@/shell/route-skeletons";

const standards: ReportMeasure[] = [
  "headcount",
  "joiners-leavers",
  "turnover",
  "tenure",
  "places",
  "jobs",
  "open-roles",
];
const column = createDataTableColumnHelper<ReportSeriesDto>();

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function defaultDefinition(
  measure: ReportMeasure,
  today: string
): ReportDefinition {
  return {
    measure,
    groupBy:
      measure === "places"
        ? "place"
        : measure === "jobs" || measure === "open-roles"
          ? "job"
          : "division",
    mode: "range",
    from: `${Number(today.slice(0, 4)) - 7}-01-01`,
    to: today,
    interval: "year",
    filters: [],
    fields: [],
  };
}

export function ReportsWorkspace({ reportId }: { reportId: string }) {
  const t = useTranslations("reports");
  const { user, isLoading } = useAuth();
  const canSee = canViewCoreReports(user),
    build = canBuildCoreReports(user);
  const standard = standards.includes(reportId as ReportMeasure);
  const fresh = reportId === "new";
  const api = useMemo(
    () => createCoreReportsApi(createPlatformApiClient()),
    []
  );
  const saved = useApiQuery(
    ["reports", "saved", reportId],
    useCallback((signal) => api.get(reportId, signal), [api, reportId]),
    { enabled: canSee && !standard && !fresh }
  );
  const list = useApiQuery(
    ["reports", "list"],
    useCallback((signal) => api.list(signal), [api]),
    { enabled: canSee }
  );
  const fields = useApiQuery(
    ["reports", "fields"],
    useCallback((signal) => api.fields(signal), [api]),
    { enabled: canSee }
  );
  const title = standard
    ? t(`standard.${reportId as ReportMeasure}`)
    : fresh
      ? t("new")
      : saved.data?.name;
  useBreadcrumbLabel(reportId, title);
  if (isLoading) return <ReportsPageSkeleton />;
  if (!canSee)
    return (
      <PagePermissionNotice title={t("title")} description={t("noAccess")} />
    );
  if ((!standard && !fresh && saved.isLoading) || fields.isLoading)
    return <ReportsPageSkeleton />;
  if (saved.error || fields.error || list.error)
    return (
      <PageContainer width="wide">
        <p role="alert">{t("loadFailed")}</p>
        <Button
          variant="outline"
          onClick={() => {
            void saved.refetch();
            void fields.refetch();
            void list.refetch();
          }}
        >
          {t("retry")}
        </Button>
      </PageContainer>
    );
  return (
    <ReportEditor
      key={reportId}
      reportId={reportId}
      initial={
        saved.data?.definition ??
        defaultDefinition(
          standard ? (reportId as ReportMeasure) : "headcount",
          todayDate()
        )
      }
      title={title ?? t("title")}
      canEdit={!!saved.data?.canEdit}
      build={build}
      saved={saved.data}
      list={list.data ?? []}
      fields={fields.data ?? []}
    />
  );
}

function ReportEditor({
  reportId,
  initial,
  title,
  canEdit,
  build,
  saved,
  list,
  fields,
}: {
  reportId: string;
  initial: ReportDefinition;
  title: string;
  canEdit: boolean;
  build: boolean;
  saved?: SavedReportDto;
  list: ReportSummaryDto[];
  fields: ReportFieldDto[];
}) {
  const t = useTranslations("reports"),
    locale = useLocale();
  const router = useRouter(),
    cache = useQueryClient();
  const api = useMemo(
    () => createCoreReportsApi(createPlatformApiClient()),
    []
  );
  const [definition, setDefinition] = useState(initial);
  const [dialog, setDialog] = useState<"save" | "share" | "delete" | null>(
    null
  );
  const [name, setName] = useState(saved?.name ?? "");
  const [roleIds, setRoleIds] = useState(saved?.roleIds ?? []);
  const [busy, setBusy] = useState(false);
  const [filterField, setFilterField] = useState("unit");
  const [filterValue, setFilterValue] = useState("");
  const run = useApiQuery(
    ["reports", "run", definition],
    useCallback((signal) => api.run(definition, signal), [api, definition]),
    { enabled: definition.from <= definition.to }
  );
  const roles = useApiQuery(
    ["reports", "roles"],
    useCallback((signal) => api.roles(signal), [api]),
    { enabled: build && dialog === "share" }
  );
  function update(patch: Partial<ReportDefinition>) {
    setDefinition((d) => ({ ...d, ...patch }));
  }
  const fieldLabel = (key: string) =>
    key.startsWith("field:")
      ? (fields.find((f) => f.key === key)?.label ?? key)
      : t(`field.${key as "name"}`);
  const seriesLabel = (label: string) =>
    label.replace(
      / · (joiners|leavers)$/,
      (_, event: "joiners" | "leavers") => ` · ${t(event)}`
    );
  const number = (value: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}${run.data?.unit === "percent" ? "%" : run.data?.unit === "years" ? ` ${t("years")}` : ""}`;
  const periodLabel = (period: { to: string }) =>
    period.to === todayDate()
      ? t("today")
      : definition.interval === "year" && definition.mode === "range"
        ? period.to.slice(0, 4)
        : formatDateParts(
            period.to,
            {
              year: "numeric",
              month: "short",
              ...(definition.mode === "date"
                ? { day: "numeric" as const }
                : {}),
            },
            "–",
            locale
          );
  const labels = run.data?.periods.map(periodLabel) ?? [];
  const rows = useMemo(
    () =>
      run.data
        ? [
            ...run.data.series,
            {
              key: "__total",
              label: t("everyone"),
              values: run.data.totals,
              change: run.data.totals.at(-1)! - run.data.totals[0]!,
            },
          ]
        : [],
    [run.data, t]
  );
  const columns = useMemo(
    () => [
      column.accessor("label", {
        header: "",
        cell: ({ row }) => (
          <span
            className={
              row.original.key === "__total" ? "type-label" : "type-body"
            }
          >
            {seriesLabel(row.original.label) || t("unspecified")}
          </span>
        ),
        meta: {
          width: "26%",
          headerClassName: "px-0",
          cellClassName: "h-11 whitespace-nowrap ps-0 pe-4",
        },
      }),
      ...(run.data?.periods ?? []).map((period, i) =>
        column.accessor((row) => row.values[i], {
          id: period.to,
          header: periodLabel(period),
          cell: ({ getValue }) => (
            <span className="tabular-nums">{number(getValue() ?? 0)}</span>
          ),
          meta: {
            align: "end" as const,
            headerClassName: "px-2",
            cellClassName: "h-11 px-2",
          },
        })
      ),
      column.accessor("change", {
        header: t("change"),
        cell: ({ getValue }) => (
          <span className="tabular-nums">
            {getValue() > 0 ? "+" : ""}
            {number(getValue())}
          </span>
        ),
        meta: {
          align: "end" as const,
          headerClassName: "px-2",
          cellClassName: "h-11 px-2",
        },
      }),
    ],
    // Labels and number formatting follow the viewer's language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.data, locale, definition.interval, definition.mode, t]
  );
  const model = useDataTable({
    data: rows,
    columns,
    getRowId: (row) => row.key,
    pageSize: 100,
  });

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      setDialog(null);
      await cache.invalidateQueries({ queryKey: ["reports", "list"] });
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: "csv" | "xlsx") {
    setBusy(true);
    try {
      downloadBlob(await api.export(definition, format), `${title}.${format}`);
    } catch {
      toast.error(t("exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer width="wide" className="px-10 pt-9 pb-14">
      <div className="grid items-start gap-9 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t("title")} className="grid gap-0.5">
          <p className="type-eyebrow px-2.5 pb-1.5 text-muted-foreground">
            {t("standardTitle")}
          </p>
          {standards.map((id) => (
            <Link
              key={id}
              href={`/reports/${id}`}
              className={cn(
                "rounded-control px-2.5 py-2 transition-colors hover:bg-section",
                reportId === id
                  ? "bg-secondary type-label text-foreground"
                  : "type-body text-muted-foreground"
              )}
            >
              {t(`standard.${id}`)}
            </Link>
          ))}
          <p className="type-eyebrow px-2.5 pb-1.5 pt-3.5 text-muted-foreground">
            {t("yours")}
          </p>
          {list.map((item) => (
            <Link
              key={item.id}
              href={`/reports/${item.id}`}
              className={cn(
                "rounded-control px-2.5 py-2 hover:bg-section",
                reportId === item.id
                  ? "bg-secondary type-label text-foreground"
                  : "type-body text-muted-foreground"
              )}
            >
              {item.name}
            </Link>
          ))}
          {build && (
            <Link
              href="/reports/new"
              className="flex items-center gap-2 rounded-control px-2.5 py-2 type-body text-muted-foreground hover:bg-section"
            >
              <Plus className="size-4" />
              {t("new")}
            </Link>
          )}
        </nav>
        <div className="grid min-w-0 gap-[18px]">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="type-page-title">{title}</h1>
              <p className="mt-1 type-body text-muted-foreground">
                {t(
                  definition.mode === "date"
                    ? "onDescription"
                    : "rangeDescription",
                  {
                    field: definition.groupBy.startsWith("field:")
                      ? fieldLabel(definition.groupBy)
                      : fieldLabel(definition.groupBy).toLocaleLowerCase(
                          locale
                        ),
                    interval: t(
                      `interval.${definition.interval}`
                    ).toLocaleLowerCase(locale),
                  }
                )}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" aria-label={t("fields")}>
                    <SlidersHorizontal />
                    {t("fields")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="grid max-h-96 gap-3 overflow-y-auto"
                  align="end"
                >
                  <p className="type-label">{t("fields")}</p>
                  {fields.map((f) => (
                    <label
                      key={f.key}
                      className="flex items-center gap-2 type-body"
                    >
                      <Checkbox
                        checked={definition.fields.includes(f.key)}
                        onCheckedChange={(checked) =>
                          update({
                            fields: checked
                              ? [...definition.fields, f.key]
                              : definition.fields.filter((k) => k !== f.key),
                          })
                        }
                      />
                      {fieldLabel(f.key)}
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
              {build && (!saved || canEdit) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!saved) {
                      setDialog("save");
                    } else setDialog("share");
                  }}
                >
                  <Share2 />
                  {t("share")}
                </Button>
              )}
              {build && (
                <Button variant="ghost" onClick={() => setDialog("save")}>
                  <Save />
                  {t("saveAs")}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={busy || !run.data || run.isFetching}
                  >
                    <Download />
                    {t("export")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void exportFile("csv")}>
                    CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void exportFile("xlsx")}>
                    Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label={t("dates")}
              value={definition.mode}
              onChange={(mode) => update({ mode })}
              options={[
                { value: "date", label: t("onDate") },
                { value: "range", label: t("between") },
              ]}
            />
            {definition.mode === "range" ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <CalendarDays />
                    {formatDate(definition.from, {
                      locale,
                      year: "always",
                    })}{" "}
                    –{" "}
                    {definition.to === todayDate()
                      ? t("today")
                      : formatDate(definition.to, { locale, year: "always" })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="grid gap-3">
                  <Label>{t("from")}</Label>
                  <DatePicker
                    aria-label={t("from")}
                    value={definition.from}
                    max={definition.to}
                    onChange={(from) => update({ from })}
                  />
                  <Label>{t("to")}</Label>
                  <DatePicker
                    aria-label={t("to")}
                    value={definition.to}
                    min={definition.from}
                    onChange={(to) => update({ to })}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <DatePicker
                aria-label={t("to")}
                value={definition.to}
                onChange={(to) => update({ to, from: to })}
                className="w-auto"
              />
            )}
            <Select
              value={definition.groupBy}
              onValueChange={(groupBy) => update({ groupBy })}
            >
              <SelectTrigger className="w-auto gap-2" aria-label={t("groupBy")}>
                <span className="text-muted-foreground">{t("groupBy")}</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {fieldLabel(f.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {definition.mode === "range" && (
              <Select
                value={definition.interval}
                onValueChange={(interval) =>
                  update({ interval: interval as ReportDefinition["interval"] })
                }
              >
                <SelectTrigger className="w-auto gap-2" aria-label={t("every")}>
                  <span className="text-muted-foreground">{t("every")}</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["month", "quarter", "year"] as const).map((i) => (
                    <SelectItem key={i} value={i}>
                      {t(`interval.${i}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <Filter />
                  {t("filter")}
                  {definition.filters.length > 0 &&
                    ` (${definition.filters.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="grid gap-3" align="end">
                <Label>{t("fieldTitle")}</Label>
                <Select value={filterField} onValueChange={setFilterField}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {fieldLabel(f.key)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="report-filter">{t("equals")}</Label>
                <Input
                  id="report-filter"
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                />
                <Button
                  disabled={!filterValue.trim()}
                  onClick={() => {
                    update({
                      filters: [
                        ...definition.filters.filter(
                          (f) => f.field !== filterField
                        ),
                        { field: filterField, values: [filterValue.trim()] },
                      ],
                    });
                    setFilterValue("");
                  }}
                >
                  {t("apply")}
                </Button>
              </PopoverContent>
            </Popover>

            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("delete")}
                onClick={() => setDialog("delete")}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          {(reportId === "new" || canEdit) && (
            <Select
              value={definition.measure}
              onValueChange={(measure) =>
                update({ measure: measure as ReportMeasure })
              }
            >
              <SelectTrigger aria-label={t("measure")} className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {standards.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`standard.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {definition.filters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {definition.filters.map((f) => (
                <Button
                  key={f.field}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    update({
                      filters: definition.filters.filter((item) => item !== f),
                    })
                  }
                >
                  {fieldLabel(f.field)}: {f.values.join(", ")}
                  <X />
                </Button>
              ))}
            </div>
          )}
          <section
            className="min-w-0 rounded-surface bg-card p-6"
            aria-busy={run.isFetching}
          >
            {run.isLoading ? (
              <Skeleton className="h-96 rounded-control" />
            ) : run.error ? (
              <div className="grid justify-items-start gap-3 py-16">
                <p role="alert">{t("runFailed")}</p>
                <Button variant="outline" onClick={() => void run.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            ) : (
              run.data && (
                <>
                  <div className="mb-4 flex flex-wrap gap-x-[18px] gap-y-2">
                    {run.data.series.map((s, i) => (
                      <span
                        key={s.key}
                        className="flex items-center gap-2 type-meta text-muted-foreground"
                      >
                        <i
                          className="size-2.5 rounded-detail"
                          style={{ background: seriesColor(i) }}
                        />
                        {seriesLabel(s.label) || t("unspecified")}
                      </span>
                    ))}
                  </div>
                  {run.data.series.length ? (
                    <ReportChart run={run.data} labels={labels} title={title} />
                  ) : (
                    <p className="py-16 text-center type-body text-muted-foreground">
                      {t("empty")}
                    </p>
                  )}
                  <DataTable
                    model={model}
                    showPagination={rows.length > 100}
                    minWidth={run.data.periods.length > 6 ? "720px" : undefined}
                    className="mt-3"
                  />
                </>
              )
            )}
          </section>
          {run.data && run.data.fields.length > 0 && (
            <PeopleFields run={run.data} />
          )}
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {t(
                dialog === "share"
                  ? "share"
                  : dialog === "delete"
                    ? "delete"
                    : "saveAs"
              )}
            </DialogTitle>
          </DialogHeader>
          {dialog === "save" && (
            <>
              <Label htmlFor="report-name">{t("name")}</Label>
              <Input
                id="report-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
              <DialogFooter>
                {canEdit && (
                  <Button
                    variant="outline"
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      void act(async () => {
                        await api.save(name, definition, saved!.id);
                        toast.success(t("saved"));
                      })
                    }
                  >
                    {t("saveChanges")}
                  </Button>
                )}
                <Button
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void act(async () => {
                      const result = await api.save(name, definition);
                      router.push(`/reports/${result.id}`);
                      toast.success(t("saved"));
                    })
                  }
                >
                  {t("save")}
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog === "share" && (
            <>
              {roles.isLoading ? (
                <Skeleton className="h-24" />
              ) : roles.error ? (
                <p role="alert">{t("loadFailed")}</p>
              ) : (
                <div className="grid max-h-80 gap-3 overflow-auto">
                  {roles.data?.map((role) => (
                    <label
                      key={role.id}
                      className="flex items-center gap-3 type-body"
                    >
                      <Checkbox
                        checked={roleIds.includes(role.id)}
                        onCheckedChange={(checked) =>
                          setRoleIds((ids) =>
                            checked
                              ? [...ids, role.id]
                              : ids.filter((id) => id !== role.id)
                          )
                        }
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button
                  disabled={busy || roles.isLoading || !!roles.error}
                  onClick={() =>
                    void act(async () => {
                      await api.share(saved!.id, roleIds);
                      toast.success(t("shared"));
                    })
                  }
                >
                  {t("saveChanges")}
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog === "delete" && (
            <>
              <p className="type-body">
                {t("deleteQuestion", { name: title })}
              </p>
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.remove(saved!.id);
                      router.push("/reports");
                    })
                  }
                >
                  {t("delete")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function PeopleFields({ run }: { run: ReportRunDto }) {
  const t = useTranslations("reports");
  const helper = createDataTableColumnHelper<ReportRunDto["people"][number]>();
  const columns = run.fields.map((f) =>
    helper.accessor((row) => row.values[f.key] ?? "", {
      id: f.key,
      header: f.key.startsWith("field:")
        ? f.label
        : t(`field.${f.key as "name"}`),
    })
  );
  const model = useDataTable({
    data: run.people,
    columns,
    getRowId: (row) => row.employeeKey,
  });
  return (
    <section className="min-w-0 rounded-surface bg-card p-4">
      <h2 className="type-section-title px-4 pb-3">{t("fields")}</h2>
      <DataTable model={model} />
    </section>
  );
}
