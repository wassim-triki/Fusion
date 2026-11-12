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
import { formatDateParts } from "@repo/ds/lib/dates";
import { useApiQuery } from "@repo/api/query";
import { canBuildCoreReports, canViewCoreReports, useAuth, PageRefusal } from "@repo/auth";
import {
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  Checkbox,
  DatePicker,
  DateRangePicker,
  type DateRangeValue,
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
  PersonAvatar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import { Segmented } from "@repo/ds/choice";
import {
  createDataTableColumnHelper,
  DataTable,
  useDataTable,
  FilterFieldChip,
  type DataTableFilterField,
} from "@repo/ds/data-table";
import { Bookmark, BriefcaseBusiness, CirclePlus, ChevronDown, Download, Hourglass, MapPin, Percent, UserRoundPlus, UsersRound, Save, Share2, SlidersHorizontal, Trash2 } from "@repo/ds/icons";
import { toast } from "sonner";
import { downloadBlob } from "@/lib/download";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";
import { ReportNumberFilter } from "./report-number-filter";
import { ReportChart } from "./report-chart";
import { PeopleResultsSkeleton, ReportResultsSkeleton, ReportsPageSkeleton } from "@/shell/route-skeletons";

const standards: ReportMeasure[] = [
  "headcount",
  "joiners-leavers",
  "turnover",
  "tenure",
  "places",
  "jobs",
  "open-roles",
];
const reportMarks: Record<ReportMeasure, { icon: typeof UsersRound; color: string }> = {
  headcount: { icon: UsersRound, color: "bg-identity-1/15 text-identity-1" },
  "joiners-leavers": { icon: UserRoundPlus, color: "bg-identity-2/15 text-identity-2" },
  turnover: { icon: Percent, color: "bg-identity-5/15 text-identity-5" },
  tenure: { icon: Hourglass, color: "bg-identity-4/15 text-identity-4" },
  places: { icon: MapPin, color: "bg-identity-3/15 text-identity-3" },
  jobs: { icon: BriefcaseBusiness, color: "bg-identity-1/15 text-identity-1" },
  "open-roles": { icon: CirclePlus, color: "bg-identity-2/15 text-identity-2" },
};
const column = createDataTableColumnHelper<ReportSeriesDto>();

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function defaultDefinition(
  measure: ReportMeasure,
  today: string,
  availableFields: ReportFieldDto[]
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
    fields: measure === "open-roles" ? [] : ["name", "job", "division", "place"].filter((key) => availableFields.some((field) => field.key === key)),
  };
}

export function ReportsWorkspace({ reportId }: { reportId: string }) {
  const t = useTranslations("reports");
  const { user, isLoading } = useAuth();
  const canSee = canViewCoreReports(user),
    build = canBuildCoreReports(user);
  const standard = standards.includes(reportId as ReportMeasure);
  const api = useMemo(
    () => createCoreReportsApi(createPlatformApiClient()),
    []
  );
  const saved = useApiQuery(
    ["reports", "saved", reportId],
    useCallback((signal) => api.get(reportId, signal), [api, reportId]),
    { enabled: canSee && !standard }
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
    : saved.data?.name;
  useBreadcrumbLabel(reportId, title);
  if (isLoading) return <ReportsPageSkeleton />;
  if (!canSee)
    return <PageContainer><PageRefusal /></PageContainer>;
  if ((!standard && saved.isLoading) || fields.isLoading)
    return <ReportsPageSkeleton />;
  if (saved.error || fields.error || list.error)
    return (
      <div>
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
      </div>
    );
  return (
    <ReportEditor
      key={reportId}
      reportId={reportId}
      initial={
        saved.data?.definition ??
        defaultDefinition(
          standard ? (reportId as ReportMeasure) : "headcount",
          todayDate(),
          fields.data ?? []
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
  const [definition, setDefinition] = useState(() => initial.measure === "open-roles" ? { ...initial, mode: "date" as const, from: todayDate(), to: todayDate() } : initial);
  const [selectedSeries, setSelectedSeries] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState<"save" | "share" | "delete" | null>(
    null
  );
  const [name, setName] = useState(saved?.name ?? "");
  const [roleIds, setRoleIds] = useState(saved?.roleIds ?? []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rangeDraft, setRangeDraft] = useState<DateRangeValue | null>(null);
  const [rememberedRange, setRememberedRange] = useState({ from: initial.from, to: initial.to });
  const [fieldSearch, setFieldSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(initial.filters.length > 0);
  const [legendLimit, setLegendLimit] = useState(8);
  const spanDays = (Date.parse(definition.to) - Date.parse(definition.from)) / 86400000;
  const dateError = definition.mode === "range" && (spanDays < 0 || spanDays > 366 * 30);
  const periodCount = (interval: ReportDefinition["interval"], from = definition.from, to = definition.to) => {
    const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
    const step = { month: 1, quarter: 3, year: 12 }[interval];
    return Math.floor(monthIndex(to) / step) - Math.floor(monthIndex(from) / step) + 1;
  };
  const [persisted, setPersisted] = useState(saved);
  const ownsReport = persisted?.canEdit ?? canEdit;
  const dirty =
    JSON.stringify(definition) !==
    JSON.stringify(persisted?.definition ?? initial);
  const canSaveChanges = !!persisted && ownsReport && dirty;
  const run = useApiQuery(
    ["reports", "run", definition],
    useCallback((signal) => api.run(definition, signal), [api, definition]),
    { enabled: !dateError && definition.from <= definition.to, placeholderData: (previous) => previous }
  );
  const roles = useApiQuery(
    ["reports", "roles"],
    useCallback((signal) => api.roles(signal), [api]),
    { enabled: build && dialog === "share" }
  );
  function update(patch: Partial<ReportDefinition>) {
    setDefinition((d) => {
      const next = { ...d, ...patch };
      if (next.mode === "range" && periodCount(next.interval, next.from, next.to) > 120)
        next.interval = periodCount("quarter", next.from, next.to) <= 120 ? "quarter" : "year";
      return next;
    });
  }
  const fieldLabel = (key: string) => {
    const field = fields.find((f) => f.key === key);
    if (key.startsWith("field:")) return field?.label ?? key;
    // The server names this one with the company's own word for its top level.
    if (key === "division" && field) return t(`field.${field.label.toLowerCase() as "division"}`);
    return t(`field.${key as "name"}`);
  };
  const seriesLabel = (label: string) =>
    label.replace(
      / · (joiners|leavers)$/,
      (_, event: "joiners" | "leavers") => ` · ${t(event)}`
    );
  const tableNumber = (value: number | null | undefined) =>
    value == null ? "–" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}${run.data?.unit === "percent" ? "%" : ""}`;
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
            {
              key: "__total",
              label: t("everyone"),
              values: run.data.totals,
              change: run.data.totals.at(-1) != null && run.data.totals[0] != null ? run.data.totals.at(-1)! - run.data.totals[0]! : null,
            },
            ...run.data.series,
          ]
        : [],
    [run.data, t]
  );
  const columns = useMemo(
    () => [
      column.accessor("label", {
        header: "",
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className={row.original.key === "__total" ? "type-label" : "type-body"}>
              {seriesLabel(row.original.label) || t("unspecified")}
            </span>
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
            <span className="tabular-nums">{tableNumber(getValue())}</span>
          ),
          meta: {
            align: "end" as const,
            headerClassName: "px-2",
            cellClassName: "h-11 whitespace-nowrap px-2",
          },
        })
      ),
      ...(run.data && run.data.periods.length > 1 ? [column.accessor("change", {
        header: t(run.data?.unit === "percent" ? "changePoints" : "change"),
        cell: ({ getValue }) => (
          <span className="tabular-nums">
            {getValue() != null && getValue()! > 0 ? "+" : ""}
            {run.data?.unit === "percent" && getValue() != null ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(getValue()!)} ${t("points")}` : tableNumber(getValue())}
          </span>
        ),
        meta: {
          align: "end" as const,
          headerClassName: "px-2",
          cellClassName: "h-11 whitespace-nowrap px-2",
        },
      })] : []),
    ],
    // Labels and number formatting follow the viewer's language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.data, locale, definition.interval, definition.mode, t]
  );
  const model = useDataTable({
    data: rows,
    columns,
    getRowId: (row) => row.key,
    pageSize: 10,
  });

  async function act(
    work: () => Promise<unknown>,
    errorKey: "saveFailed" | "shareFailed" = "saveFailed"
  ) {
    setActionError(null);
    setBusy(true);
    try {
      await work();
      setDialog(null);
      await cache.invalidateQueries({ queryKey: ["reports", "list"] });
    } catch {
      setActionError(t(errorKey));
      toast.error(t(errorKey));
    } finally {
      setBusy(false);
    }
  }
  function remember(report: SavedReportDto) {
    setPersisted(report);
    cache.setQueryData(["reports", "saved", report.id], report);
    cache.setQueryData<ReportSummaryDto[]>(["reports", "list"], (items = []) =>
      [
        ...items.filter((item) => item.id !== report.id),
        { id: report.id, name: report.name, canEdit: report.canEdit },
      ].sort((a, b) => a.name.localeCompare(b.name))
    );
  }
  async function saveCurrent() {
    if (!persisted) {
      setName(title === t("new") ? "" : title);
      setDialog("save");
      return;
    }
    await act(async () => {
      remember(await api.save(persisted.name, definition, persisted.id));
      toast.success(t("saved"));
    });
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
    <div>
      <div className="grid items-start gap-9 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label={t("title")} className="rounded-surface bg-card p-4">
          <div className="px-2 pb-5 pt-1">
            <h2 className="type-section-title">{t("title")}</h2>
            <p className="mt-1 type-meta text-muted-foreground">{t("libraryHint")}</p>
          </div>
          <div className="px-2 pb-2 type-label text-muted-foreground">{t("explore")}</div>
          <div className="grid gap-0.5">
            {standards.map((id) => {
              const Mark = reportMarks[id].icon;
              return <Link
                key={id}
                href={`/insights/reports/${id}`}
                aria-current={reportId === id ? "page" : undefined}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2 rounded-control px-2.5 py-1.5 transition-colors",
                  reportId === id
                    ? "bg-primary-tint type-label text-primary-ink ring-1 ring-primary/30"
                    : "type-body text-foreground hover:bg-inlay"
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-control-sm", reportMarks[id].color)}><Mark aria-hidden="true" className="size-4" /></span>
                  <span>{t(`standard.${id}`)}</span>
                </span>
                {reportId === id && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />}
              </Link>;
            })}
          </div>
          <div className="mx-2 mt-5 flex items-center justify-between border-t border-border pb-2 pt-4">
            <h3 className="type-label text-muted-foreground">{t("savedReports")}</h3>
            {list.length > 0 && <span className="type-meta tabular-nums text-muted-foreground">{list.length}</span>}
          </div>
          <div className="grid gap-0.5">
            {list.map((item) => (
              <Link
                key={item.id}
                href={`/insights/reports/${item.id}`}
                aria-current={reportId === item.id ? "page" : undefined}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2 rounded-control px-2.5 py-1.5 transition-colors",
                  reportId === item.id
                    ? "bg-primary-tint type-label text-primary-ink ring-1 ring-primary/30"
                    : "type-body text-foreground hover:bg-inlay"
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-control-sm", reportId === item.id ? "bg-primary/15 text-primary-ink" : "bg-inlay text-muted-foreground")}><Bookmark aria-hidden="true" className="size-4" /></span>
                  <span className="min-w-0 break-words">{item.name}</span>
                </span>
                {reportId === item.id && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />}
              </Link>
            ))}
            {list.length === 0 && <p className="px-2.5 py-2 type-meta text-muted-foreground">{t(build ? "saveHint" : "noSavedReports")}</p>}
          </div>
        </nav>
        <div className="grid min-w-0 gap-[18px]">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="type-page-title">{title}</h2>
              <p className="mt-1 type-body text-muted-foreground">
                {t(`standardDescription.${definition.measure}`)} · {t(
                  definition.measure === "open-roles" ? "currentDescription" : definition.mode === "date"
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
              {build && (!persisted || ownsReport) && (
                <Button
                  variant="ghost"
                  disabled={busy || dateError}
                  onClick={() => {
                    setActionError(null);
                    setName(persisted?.name ?? title);
                    setRoleIds(persisted?.roleIds ?? []);
                    setDialog("share");
                  }}
                >
                  <Share2 />
                  {t("share")}
                </Button>
              )}
              {build && (
                <ButtonGroup aria-label={t("saveOptions")}>
                  <Button
                    disabled={busy || dateError}
                    onClick={() => {
                      if (persisted && !canSaveChanges) {
                        setName(persisted.name);
                        setDialog("save");
                      } else {
                        void saveCurrent();
                      }
                    }}
                  >
                    <Save />
                    {t(canSaveChanges ? "saveChanges" : "saveAs")}
                  </Button>
                  {persisted && canSaveChanges && (
                    <>
                      <ButtonGroupSeparator className="bg-primary-foreground/25" />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" aria-label={t("saveOptions")} disabled={busy || dateError}>
                            <ChevronDown />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => { setName(persisted.name); setDialog("save"); }}>
                            {t("saveAs")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </ButtonGroup>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={busy || dateError || !run.data || run.isFetching}
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
              {ownsReport && (
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
          </header>
          <div>
          <div className="flex flex-wrap items-center gap-2">
            {definition.measure === "open-roles" ? <span className="type-label text-muted-foreground">{t("currentOpenRoles")}</span> : <>
            <Segmented
              className="bg-secondary"
              label={t("dates")}
              value={definition.mode}
              onChange={(mode) => {
                setRangeDraft(null);
                if (definition.mode === "range") setRememberedRange({ from: definition.from, to: definition.to });
                update(mode === "range" ? { mode, ...rememberedRange } : { mode, from: definition.to });
              }}
              options={[
                { value: "date", label: t("onDate") },
                { value: "range", label: t("between") },
              ]}
            />
            {definition.mode === "range" ? (
              <DateRangePicker
                value={
                  rangeDraft ?? { from: definition.from, to: definition.to }
                }
                min="1900-01-01"
                max="2200-12-31"
                placeholder={t("between")}
                aria-label={t("between")}
                className="bg-secondary dark:bg-secondary"
                onOpenChange={(open) => {
                  if (!open) setRangeDraft(null);
                }}
                onChange={(range) => {
                  setRangeDraft(range);
                  if (range.from && range.to) {
                    update({ from: range.from, to: range.to });
                    setRangeDraft(null);
                  }
                }}
              />
            ) : (
              <DatePicker
                min="1900-01-01"
                max="2200-12-31"
                captionLayout="dropdown"
                aria-label={t("to")}
                value={definition.to}
                onChange={(to) => update({ to, from: to })}
                className="w-auto bg-secondary dark:bg-secondary"
              />
            )}
            </>}
            <Select
              value={definition.groupBy}
              onValueChange={(groupBy) => update({ groupBy })}
            >
              <SelectTrigger
                className="w-auto gap-2 bg-secondary"
                aria-label={t("groupBy")}
              >
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
            {definition.measure !== "open-roles" && definition.mode === "range" && (
              <Select
                value={definition.interval}
                onValueChange={(interval) =>
                  update({ interval: interval as ReportDefinition["interval"] })
                }
              >
                <SelectTrigger
                  className="w-auto gap-2 bg-secondary"
                  aria-label={t("every")}
                >
                  <span className="text-muted-foreground">{t("every")}</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["month", "quarter", "year"] as const).map((i) => (
                    <SelectItem key={i} value={i} disabled={periodCount(i) > 120}>
                      {t(`interval.${i}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="secondary" aria-expanded={filtersOpen} aria-controls="report-filters" onClick={() => setFiltersOpen((open) => !open)}>
              <SlidersHorizontal />
              {t("filters")}{definition.filters.length > 0 && ` · ${definition.filters.length}`}
            </Button>
          </div>
          {dateError && <p role="alert" className="mt-2 type-body text-destructive">{t("dateLimit")}</p>}

          <div id="report-filters" className={cn("grid transition-[grid-template-rows] duration-[var(--duration-reveal)] ease-emphasized", filtersOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} aria-hidden={!filtersOpen} inert={!filtersOpen}>
          <div className="overflow-hidden">
          <div
            className="flex flex-wrap items-center gap-2 pt-4"
            aria-label={t("filter")}
            aria-busy={run.isFetching}
          >
            {definition.filters.length > 0 && <Button variant="ghost" size="sm" onClick={() => update({ filters: [] })}>{t("clearFilters")}</Button>}
            {fields.map((f) => {
              const active = definition.filters.find((item) => item.field === f.key);
              const change = (next?: { values: string[]; from?: string; to?: string }) =>
                update({ filters: [...definition.filters.filter((item) => item.field !== f.key),
                  ...(next ? [{ field: f.key, ...next }] : [])] });
              const disabled = run.isLoading || (!active && definition.filters.length >= 20);
              if (f.kind === "number" && !active?.values.length) return (
                <ReportNumberFilter key={f.key} label={fieldLabel(f.key)} disabled={disabled}
                  from={active?.from} to={active?.to}
                  onChange={(range) => change(range ? { values: [], ...range } : undefined)} />
              );
              const personField = f.kind === "person" && definition.measure !== "open-roles";
              const people = run.data?.personOptions ?? [];
              const nameCounts = new Map<string, number>();
              const detailCounts = new Map<string, number>();
              for (const person of people) {
                nameCounts.set(person.name, (nameCounts.get(person.name) ?? 0) + 1);
                const pair = JSON.stringify([person.name, person.detail]);
                detailCounts.set(pair, (detailCounts.get(pair) ?? 0) + 1);
              }
              const values = [...new Set([...(run.data?.filterOptions?.[f.key] ?? []), ...(active?.values ?? [])])].sort();
              const options = personField ? [
                ...people.map((person) => ({
                  value: person.key,
                  label: (nameCounts.get(person.name) ?? 0) > 1
                    ? [person.name, person.detail, (detailCounts.get(JSON.stringify([person.name, person.detail])) ?? 0) > 1 || !person.detail ? person.key : null].filter(Boolean).join(" · ") : person.name,
                })),
                ...(active?.values ?? []).filter((key) => !people.some((person) => person.key === key)).map((key) => ({ value: key, label: key })),
              ] : values.map((value) => ({ value, label: value }));
              const field: DataTableFilterField<unknown> = f.kind === "date" && !active?.values.length
                ? { id: f.key, label: fieldLabel(f.key), type: "dateRange" }
                : { id: f.key, label: fieldLabel(f.key), type: "options", maxSelections: 100,
                    searchable: f.kind === "person", options };
              const value = field.type === "dateRange" ? (active && { from: active.from, to: active.to }) : active?.values;
              return (
                <FilterFieldChip key={f.key} disabled={disabled} field={field} value={value}
                  onChange={(next) => change(Array.isArray(next) ? (next.length ? { values: next } : undefined) :
                    next && (next.from || next.to) ? { values: [], from: next.from, to: next.to } : undefined)} />
              );
            })}
          </div>
          </div>
          </div>
          </div>
          <section
            className={cn("min-w-0 rounded-surface bg-card p-6", rows.length > 10 && "pb-0")}
            aria-busy={run.isFetching}
          >
            {dateError ? <p className="py-16 type-body text-muted-foreground">{t("dateLimit")}</p> : run.isLoading ? (
              <div role="status" aria-label={t("loadingReport")}><ReportResultsSkeleton /></div>
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
                  {run.data.series.length || run.data.totals.some((value) => value != null) ? (
                    <ReportChart run={run.data} labels={labels} title={title} measure={definition.measure} locale={locale}
                      selectedSeries={selectedSeries} onSelectedSeriesChange={setSelectedSeries}
                      seriesLabel={seriesLabel} texts={{ overall: t("overall"), joiners: t("joiners"), leavers: t("leavers"),
                        compare: t("compareGroups"), more: (count) => t("showMoreLegend", { count }),
                        less: t("showLess"), noData: t("unavailable"), empty: t("empty"), limit: t("compareLimit"),
                        years: t("years"), people: t("peopleResults"), other: t("otherGroups"), reset: t("resetComparison"),
                        topGroups: t("topGroups") }} legendLimit={legendLimit} onLegendLimitChange={setLegendLimit} />
                  ) : <p className="py-16 text-center type-body text-muted-foreground">{t(definition.filters.length ? "noMatches" : "empty")}</p>}
                  {run.data.unit === "years" && <p className="mt-4 text-end type-meta text-muted-foreground">{t("years")}</p>}
                  <DataTable
                    model={model}
                    showPagination={rows.length > 10}
                    minWidth={`${Math.max(420, 230 + run.data.periods.length * 64 + (run.data.periods.length > 1 ? 72 : 0))}px`}
                    className="mt-3"
                  />
                </>
              )
            )}
          </section>
          <section className="min-w-0 rounded-surface bg-card p-4" aria-busy={run.isFetching}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
              <div>
                <h2 className="type-section-title">{t("peopleResults")}</h2>
                {definition.mode === "range" && <p className="type-meta text-muted-foreground">{t("latestPeriod")}</p>}
              </div>
            <Popover onOpenChange={(open) => { if (!open) setFieldSearch(""); }}>
              <PopoverTrigger asChild>
                <Button variant="secondary" aria-label={t("columns")}>
                  <SlidersHorizontal />
                  {t("columns")}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="grid max-h-96 gap-3 overflow-y-auto"
                align="end"
              >
                <p className="type-label">{t("fieldCount", { count: definition.fields.length })}</p>
                <Input aria-label={t("searchFields")} placeholder={t("searchFields")} value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} />
                {fields.filter((f) => fieldLabel(f.key).toLocaleLowerCase(locale).includes(fieldSearch.trim().toLocaleLowerCase(locale))).map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2 type-body"
                  >
                    <Checkbox
                      disabled={!definition.fields.includes(f.key) && definition.fields.length >= 30}
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
            </div>
            {dateError ? <p className="px-4 pb-2 type-body text-muted-foreground">{t("dateLimit")}</p> :
              run.isLoading ? <div role="status" aria-label={t("loadingPeople")}><PeopleResultsSkeleton /></div> :
              run.error ? <p className="px-4 pb-2 type-body text-muted-foreground">{t("runFailed")}</p> :
              run.data && run.data.fields.length > 0 ? <PeopleFields run={run.data} /> :
              run.data ? <p className="px-4 pb-2 type-body text-muted-foreground">{t("chooseColumnsHint")}</p> : null}
          </section>
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setActionError(null);
          }
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
                    : persisted
                      ? "saveAs"
                      : "save"
              )}
            </DialogTitle>
          </DialogHeader>
          {actionError && (
            <p role="alert" className="type-body text-destructive">
              {actionError}
            </p>
          )}
          {dialog === "save" && (
            <>
              <Label htmlFor="report-name">{t("name")}</Label>
              <Input
                disabled={busy}
                id="report-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
              <DialogFooter>
                <Button writes
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void act(async () => {
                      const result = await api.save(name.trim(), definition);
                      remember(result);
                      router.push(`/insights/reports/${result.id}`);
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
              {persisted && <p className="type-label">{persisted.name}</p>}
              {!persisted && (
                <>
                  <Label htmlFor="shared-report-name">{t("name")}</Label>
                  <Input
                    disabled={busy}
                    id="shared-report-name"
                    value={name}
                    maxLength={120}
                    onChange={(e) => setName(e.target.value)}
                  />
                </>
              )}
              <p className="type-body text-muted-foreground">
                {t("viewerReach")}
              </p>
              {persisted && dirty && (
                <p className="type-body text-muted-foreground">
                  {t("saveBeforeShare")}
                </p>
              )}
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
                        disabled={busy}
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
                <Button writes
                  disabled={
                    busy ||
                    roles.isLoading ||
                    !!roles.error ||
                    (!persisted && !name.trim()) ||
                    (roleIds.length === 0 &&
                      (persisted?.roleIds.length ?? 0) === 0)
                  }
                  onClick={() =>
                    void act(async () => {
                      const report = persisted
                        ? dirty
                          ? await api.save(
                              persisted.name,
                              definition,
                              persisted.id
                            )
                          : persisted
                        : await api.save(name.trim(), definition);
                      // Keep a successful save if sharing fails, so retrying never creates a duplicate.
                      remember(report);
                      const chosen = roleIds.filter((id) =>
                        roles.data?.some((role) => role.id === id)
                      );
                      await api.share(report.id, chosen);
                      remember({ ...report, roleIds: chosen });
                      if (!persisted) router.push(`/insights/reports/${report.id}`);
                      toast.success(t("shared"));
                    }, "shareFailed")
                  }
                >
                  {t(
                    roleIds.length === 0 && (persisted?.roleIds.length ?? 0) > 0
                      ? "stopSharing"
                      : "share"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
          {dialog === "delete" && (
            <>
              <p className="type-body">
                {t("deleteQuestion", { name: persisted?.name ?? title })}
              </p>
              <DialogFooter>
                <Button writes
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.remove(persisted!.id);
                      router.push("/insights/reports");
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
    </div>
  );
}

function PeopleFields({ run }: { run: ReportRunDto }) {
  const t = useTranslations("reports");
  const helper = createDataTableColumnHelper<ReportRunDto["people"][number]>();
  const columns = run.fields.map((f) =>
    helper.accessor((row) => row.values[f.key] ?? "", {
      id: f.key,
      ...(f.key === "name" ? { cell: ({ getValue }: { getValue: () => unknown }) => {
        const name = getValue();
        return typeof name === "string" && name ? <span className="flex items-center gap-2"><PersonAvatar name={name} size="xs" /><span>{name}</span></span> : null;
      } } : {}),
      header: f.key.startsWith("field:")
        ? f.label
        : t(`field.${(f.key === "division" ? f.label.toLowerCase() : f.key) as "name"}`),
    })
  );
  const model = useDataTable({
    data: run.people,
    columns,
    getRowId: (row) => row.employeeKey,
  });
  return (
    <DataTable model={model} />
  );
}
