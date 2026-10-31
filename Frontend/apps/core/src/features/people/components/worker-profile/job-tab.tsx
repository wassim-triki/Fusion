"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import type { PeopleChangeFieldDto, PeopleJobHistoryRowDto, PeopleTimelineEventDto } from "@repo/api";
import { Button, Skeleton, cn } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import {
  DataTable,
  DataTableCellEmpty,
  createDataTableColumnHelper,
  useDataTable,
} from "@repo/ds/data-table";
import { ArrowRight, Plus, RotateCcw } from "lucide-react";
import { Monogram, useWorkforceDate } from "../workforce-ui";
import { useTenure } from "./worker-profile";
import type { WorkerProfileView } from "./worker-profile-view";

export interface JobHistoryState {
  rows: PeopleJobHistoryRowDto[] | undefined;
  isLoading: boolean;
  failed: boolean;
  retry: () => void;
}

/**
 * The Job tab: employment figures, then the job's record (Job information for HR and the branch manager), the
 * dotted lines and what is coming up, then the change history.
 */
export function JobTab({
  view,
  jobHistory,
  timeline,
  dottedLines,
  comingUp,
  onSchedule,
}: {
  view: WorkerProfileView;
  /** Undefined when the viewer may not read job history (the person themselves). */
  jobHistory?: JobHistoryState;
  /** Undefined when the viewer may not read the history. */
  timeline?: { events: PeopleTimelineEventDto[]; isLoading: boolean };
  dottedLines?: ReactNode;
  /** Undefined hides the section; an empty list shows "Nothing scheduled". */
  comingUp?: ReactNode[];
  /** Offered on an empty Coming up. */
  onSchedule?: () => void;
}) {
  const t = useTranslations("profile.job");
  return (
    <div className="space-y-5 lg:pt-2">
      <EmploymentFigures view={view} rows={jobHistory?.rows} />

      {jobHistory ? (
        <JobSection title={t("information")} aside={jobHistory.rows ? t("records", { count: jobHistory.rows.length }) : undefined}>
          {jobHistory.failed ? (
            <div className="flex items-center justify-between gap-4 rounded-surface border border-dashed px-5 py-4">
              <p className="type-body text-muted-foreground">{t("historyFailed")}</p>
              <Button variant="ghost" size="sm" onClick={jobHistory.retry}>
                <RotateCcw className="size-4" aria-hidden /> {t("retry")}
              </Button>
            </div>
          ) : (
            <JobInformation rows={jobHistory.rows} isLoading={jobHistory.isLoading} />
          )}
        </JobSection>
      ) : null}

      {dottedLines ? <JobSection title={t("dottedLines")}>{dottedLines}</JobSection> : null}

      {comingUp ? (
        <JobSection title={t("comingUp")}>
          {comingUp.length > 0 ? (
            <div className="grid gap-2.5">{comingUp}</div>
          ) : (
            <div className="flex min-h-14 items-center justify-between gap-4 rounded-surface border border-dashed px-5 py-3">
              <p className="type-body text-muted-foreground">{t("nothingScheduled")}</p>
              {onSchedule ? (
                <Button variant="ghost" size="sm" onClick={onSchedule}>
                  <Plus className="size-4" aria-hidden /> {t("schedule")}
                </Button>
              ) : null}
            </div>
          )}
        </JobSection>
      ) : null}

      {timeline && (timeline.isLoading || timeline.events.length > 0) ? (
        <JobSection title={t("history")}>
          {timeline.isLoading && timeline.events.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : (
            <ProfileTimeline events={timeline.events} />
          )}
        </JobSection>
      ) : null}
    </div>
  );
}

function JobSection({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <Section title={title} meta={aside}>
      {children}
    </Section>
  );
}

/** The oldest row of the current run where `same` holds: since when the job (or unit) has been what it is. */
function sinceOf(rows: PeopleJobHistoryRowDto[], same: (row: PeopleJobHistoryRowDto, current: PeopleJobHistoryRowDto) => boolean) {
  const current = rows.find((row) => row.isCurrent) ?? rows[0];
  if (!current) return null;
  let since = current.effectiveDate;
  for (const row of rows.slice(rows.indexOf(current) + 1)) {
    if (!same(row, current)) break;
    since = row.effectiveDate;
  }
  return since;
}

function EmploymentFigures({ view, rows }: { view: WorkerProfileView; rows?: PeopleJobHistoryRowDto[] }) {
  const t = useTranslations("profile.job");
  const workforceDate = useWorkforceDate();
  const tenureOf = useTenure();
  if (!view.employmentStart) return null;
  const inJob = rows?.length ? sinceOf(rows, (row, current) => row.jobTitle === current.jobTitle) : view.assignmentEffectiveFrom;
  const inUnit = rows?.length ? sinceOf(rows, (row, current) => row.orgUnitId === current.orgUnitId) : null;
  const figures = [
    { label: t("started"), value: workforceDate(view.employmentStart, { month: "short" }) },
    { label: t("withCompany"), value: tenureOf(view.employmentStart, "narrow") },
    { label: t("inJob"), value: tenureOf(inJob, "narrow") },
    { label: view.orgUnitName ? t("inUnit", { unit: view.orgUnitName }) : null, value: tenureOf(inUnit, "narrow") },
  ].filter((figure): figure is { label: string; value: string } => Boolean(figure.label && figure.value));

  return (
    <Section title={t("employment")}>
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        {figures.map((figure) => (
          <div key={figure.label} className="min-w-0">
            <dt className="max-w-48 truncate type-label text-muted-foreground">{figure.label}</dt>
            <dd className="mt-1 type-metric text-foreground">{figure.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

const column = createDataTableColumnHelper<PeopleJobHistoryRowDto>();

function JobInformation({ rows, isLoading }: { rows: PeopleJobHistoryRowDto[] | undefined; isLoading: boolean }) {
  const t = useTranslations("profile.job");
  const workforceDate = useWorkforceDate();
  const columns = useMemo(
    () => [
      column.accessor("effectiveDate", {
        header: t("effective"),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className={cn("type-body tabular-nums", !row.original.isCurrent && "text-muted-foreground")}>
              {workforceDate(row.original.effectiveDate, { month: "short" })}
            </span>
            {row.original.isCurrent ? <span className="type-meta text-primary-ink">{t("current")}</span> : null}
          </span>
        ),
        meta: { width: "18%" },
      }),
      column.accessor("jobTitle", {
        header: t("jobTitle"),
        enableSorting: false,
        cell: ({ row }) => <Muted current={row.original.isCurrent}>{row.original.jobTitle}</Muted>,
      }),
      column.accessor("unitName", {
        header: t("unit"),
        enableSorting: false,
        cell: ({ row }) => <Muted current={row.original.isCurrent}>{row.original.unitName}</Muted>,
      }),
      column.accessor("location", {
        header: t("location"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.location ? <Muted current={row.original.isCurrent}>{row.original.location}</Muted> : <DataTableCellEmpty />,
        meta: { width: "14%" },
      }),
      column.accessor((row) => row.manager?.displayName ?? "", {
        id: "manager",
        header: t("reportsTo"),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.manager ? (
            <Link href={`/people/${row.original.manager.employeeKey}`} className="group flex min-w-0 items-center gap-2">
              <Monogram name={row.original.manager.displayName} photoUrl={row.original.manager.photoUrl} size="xs" />
              <span className="truncate type-body text-foreground group-hover:underline">{row.original.manager.displayName}</span>
            </Link>
          ) : (
            <span className="type-body text-muted-foreground">{t("noManager")}</span>
          ),
        meta: { width: "24%" },
      }),
    ],
    [t, workforceDate]
  );
  const model = useDataTable({
    data: rows,
    columns,
    getRowId: (row) => `${row.effectiveDate}-${row.jobTitle}-${row.orgUnitId}`,
    initialSorting: [{ id: "effectiveDate", desc: true }],
  });
  return <DataTable model={model} isLoading={isLoading} skeletonRows={3} noun={[t("record"), t("recordPlural")]} minWidth="40rem" />;
}

function Muted({ current, children }: { current: boolean; children: ReactNode }) {
  return <span className={cn("block truncate type-body", current ? "text-foreground" : "text-muted-foreground")}>{children}</span>;
}

/** from → to for a single changed field; a field with neither (a section the person updated) is its name alone. */
function ChangeField({ field }: { field: PeopleChangeFieldDto }) {
  return (
    <p className="type-meta">
      <span className="text-muted-foreground">{field.label} </span>
      {field.from ? (
        <>
          <span className="text-muted-foreground line-through decoration-muted-foreground/40">{field.from}</span>
          <ArrowRight aria-hidden className="mx-1.5 inline size-3.5 -translate-y-px text-muted-foreground rtl:rotate-180" />
        </>
      ) : null}
      <span className="font-medium text-foreground">{field.to ?? "—"}</span>
    </p>
  );
}

/** Section names the server writes on "Updated contact details", in the viewer's language. */
const PERSONAL_SECTIONS: Record<string, string> = {
  "Preferred name": "preferredName",
  Mobile: "mobile",
  "Personal email": "personalEmail",
  "Home address": "address",
  "Date of birth": "dateOfBirth",
  "Emergency contacts": "emergency",
};

export function ProfileTimeline({ events }: { events: PeopleTimelineEventDto[] }) {
  const t = useTranslations("profile.history");
  const tp = useTranslations("profile.personal");
  const workforceDate = useWorkforceDate();
  if (events.length === 0) {
    return <p className="type-body text-muted-foreground">{t("empty")}</p>;
  }
  // Oldest first: the timeline reads as a life-of-record story top to bottom.
  const ordered = [...events].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const last = ordered.length - 1;
  return (
    <ol>
      {ordered.map((event, index) => {
        const personal = event.kind === "PersonalDetails";
        return (
          <li key={`${event.kind}-${event.effectiveDate}-${index}`} className="flex gap-4">
            <span
              className={cn(
                "w-[5.5rem] shrink-0 pt-0.5 text-end type-meta tabular-nums",
                event.isFuture ? "text-primary-ink" : "text-muted-foreground"
              )}
            >
              {workforceDate(event.effectiveDate)}
            </span>
            <div className="flex flex-col items-center" aria-hidden>
              <span
                className={cn(
                  "mt-1 size-2.5 shrink-0 rounded-full ring-4",
                  event.isFuture ? "bg-primary ring-primary/15" : "bg-muted-foreground/35 ring-transparent"
                )}
              />
              {index < last ? <span className="w-px flex-1 bg-border" /> : null}
            </div>
            <div className={cn("min-w-0", index < last && "pb-6")}>
              <p className="type-label text-foreground">{personal ? t("personalDetails") : event.title}</p>
              {personal ? (
                event.fields.length > 0 ? (
                  <p className="mt-1 type-meta text-muted-foreground">
                    {event.fields
                      .map((field) => (PERSONAL_SECTIONS[field.label] ? tp(PERSONAL_SECTIONS[field.label] as "mobile") : field.label))
                      .join(", ")}
                  </p>
                ) : null
              ) : event.fields.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {event.fields.map((field) => (
                    <ChangeField key={field.label} field={field} />
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
