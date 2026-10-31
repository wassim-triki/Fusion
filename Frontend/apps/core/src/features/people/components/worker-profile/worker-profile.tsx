"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { PersonAvatar, cn } from "@repo/ds";
import { LinkTabs, PageContainer, StatusBadge } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import { usePhoto, useTenantSummary } from "@repo/api/query";
import { Mail, MapPin, Phone, Workflow } from "lucide-react";
import { useSay } from "@repo/ds/lib/say";
import { Monogram, useWorkforceDate } from "../workforce-ui";
import {
  formatEmploymentType,
  tenure,
  type WorkerProfileReport,
  type WorkerProfileView,
} from "./worker-profile-view";

export type ProfileTab = "overview" | "job" | "personal" | "performance" | "documents" | "access";

export interface ProfileTabLink {
  key: ProfileTab;
  label: string;
  href: string;
}

export interface WorkerProfileProps {
  view: WorkerProfileView;
  /** Back navigation above the band (a person's record returns to People). */
  backLink?: ReactNode;
  /** Top-right of the band: the record's actions, then its ⋯ menu. */
  headerActions?: ReactNode;
  /** Chip beside the name after an establishment reveal. */
  nameBadge?: ReactNode;
  /** H1 ref, for focus management after navigation. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** Sits on the photo's edge: change the photo (the person or HR). */
  photoAction?: ReactNode;
  /** The viewer's tabs, in the band. */
  tabs?: ProfileTabLink[];
  currentTab?: ProfileTab;
  /** Others on the same manager, for someone without reports. */
  teammates?: WorkerProfileReport[];
  /** Opens the team in full when the rail shows only part of it. */
  reportsFooter?: ReactNode;
  /** The org chart opened around this person; omitted when the viewer can't see the chart. */
  orgChartHref?: string;
  /** Next to the work email in the rail (HR adds or edits it). */
  workEmailAction?: ReactNode;
  /** The current tab's body. */
  children?: ReactNode;
}

const RAIL_PEOPLE = 5;

/**
 * One person's page (D-01, B-180): a band with the photo, name, a glance row (manager, team, time with the company,
 * place) and the tabs; a rail that stays on every tab; the tab's body, its sections stacked one under another.
 */
export function WorkerProfile({
  view,
  backLink,
  headerActions,
  nameBadge,
  headingRef,
  photoAction,
  tabs,
  currentTab,
  teammates,
  reportsFooter,
  orgChartHref,
  workEmailAction,
  children,
}: WorkerProfileProps) {
  const t = useTranslations("profile");
  const photo = usePhoto(view.photoUrl);
  const parent = parentUnit(view.orgUnitPath);

  return (
    <PageContainer width="wide" className="max-w-6xl pb-16">
      {backLink ? <div className="mb-4">{backLink}</div> : null}

      <section aria-labelledby="profile-name" className="relative z-10 rounded-surface bg-section px-6 pt-6 sm:grid sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-x-8 sm:px-8 sm:pt-8">
        <div className="relative mb-4 w-fit sm:row-span-3 sm:mb-0 sm:self-start">
          <PersonAvatar
            name={view.displayName}
            photo={photo}
            size="profile"
            className="size-24 border-2 font-serif text-3xl font-medium ring-[6px] ring-section sm:size-[10.5rem] sm:text-[3.5rem]"
          />
          {photoAction ? <div className="absolute end-[4%] bottom-[4%]">{photoAction}</div> : null}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 sm:col-start-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 id="profile-name" ref={headingRef} tabIndex={-1} className="type-display min-w-0 max-w-full truncate outline-none sm:text-[2.25rem]">
                {view.displayName}
              </h1>
              {view.status.tone !== "success" ? (
                <StatusBadge tone={view.status.tone} dot>
                  {view.status.label}
                </StatusBadge>
              ) : null}
              {nameBadge}
            </div>
            {view.jobTitle ? (
              <p className="mt-1.5 type-subsection-title text-foreground">{view.jobTitle}</p>
            ) : view.workUnavailable ? (
              <p className="mt-1.5 type-body text-muted-foreground">{t("assignment.unavailable")}</p>
            ) : null}
            {view.orgUnitName ? (
              <p className="mt-1 type-body text-muted-foreground">
                {parent ? t("band.unitIn", { unit: view.orgUnitName, parent }) : view.orgUnitName}
              </p>
            ) : null}
          </div>
          {headerActions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div> : null}
        </div>

        <Glance view={view} teammates={teammates} />

        {tabs?.length ? (
          <LinkTabs label={t("tabs.label")} tabs={tabs} current={currentTab ?? tabs[0]!.key} className="mt-6 pb-5 sm:col-start-2" />
        ) : (
          <div className="h-6 sm:col-start-2" />
        )}
      </section>

      <div className="mt-8 flex flex-col gap-10 lg:flex-row lg:items-start">
        <ProfileRail
          view={view}
          showPeople={Boolean(tabs?.length)}
          teammates={teammates}
          reportsFooter={reportsFooter}
          orgChartHref={orgChartHref}
          workEmailAction={workEmailAction}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageContainer>
  );
}

/** Who they work with and for how long, before any tab: manager, team, time with the company, place. */
function Glance({ view, teammates }: { view: WorkerProfileView; teammates?: WorkerProfileReport[] }) {
  const t = useTranslations("profile.glance");
  const workforceDate = useWorkforceDate();
  const tenureOf = useTenure();
  const company = useTenantSummary().data?.name;
  const leads = view.directReportCount > 0;
  // A manager's team is their reports; anyone else's is their manager's, themselves included.
  const faces = leads ? view.directReports : (teammates ?? []);
  const teamSize = leads ? view.directReportCount : faces.length > 0 ? faces.length + 1 : 0;
  const since = tenureOf(view.employmentStart);
  const managerFirst = view.manager?.name.split(" ")[0];
  const started = view.employmentStart ? workforceDate(view.employmentStart, { month: "short" }) : null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-4 sm:col-start-2">
      {view.manager ? (
        <Link href={view.manager.href} className="group flex items-center gap-2.5 outline-none focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring">
          <Monogram name={view.manager.name} photoUrl={view.manager.photoUrl} size="md" />
          <span className="min-w-0">
            <span className="block type-meta text-muted-foreground">{t("manager")}</span>
            <span className="block truncate type-label text-foreground group-hover:underline">{view.manager.name}</span>
          </span>
        </Link>
      ) : null}
      {teamSize > 0 ? (
        <div className="flex items-center gap-2.5">
          <ul className="flex" aria-hidden>
            {faces.slice(0, 5).map((mate) => (
              <li key={mate.href} className="-ms-2 first:ms-0">
                <Monogram name={mate.name} photoUrl={mate.photoUrl} size="sm" className="border-2 border-section" />
              </li>
            ))}
          </ul>
          <span className="min-w-0">
            <span className="block type-meta text-muted-foreground">
              {leads ? t("theirTeam") : managerFirst ? t("managersTeam", { name: managerFirst }) : t("team")}
            </span>
            <span className="block type-label text-foreground">{t("people", { count: teamSize })}</span>
          </span>
        </div>
      ) : null}
      {started && since ? (
        <div className="min-w-0">
          <span className="block type-meta text-muted-foreground">
            {company ? t("withCompanySince", { company, date: started }) : t("since", { date: started })}
          </span>
          <span className="block type-label text-foreground">{since}</span>
        </div>
      ) : null}
      {view.workLocation ? (
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-card text-muted-foreground">
            <MapPin className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block type-meta text-muted-foreground">{t("place")}</span>
            <span className="block truncate type-label text-foreground">{view.workLocation}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** "Product & Engineering" from "Group / Product & Engineering / Product". */
function parentUnit(path: string | null): string | null {
  const parts = path?.split("/").map((part) => part.trim()).filter(Boolean) ?? [];
  return parts.length >= 2 ? parts[parts.length - 2]! : null;
}

/** "6 years, 4 months" (long) or "6y 4m" (narrow), in the viewer's language; days only in the first month. */
export function useTenure() {
  const format = useFormat();
  const locale = useLocale();
  return (from: string | null | undefined, style: "long" | "narrow" = "long"): string | null => {
    const span = tenure(from);
    if (!span) return null;
    const unit = (value: number, name: "year" | "month" | "day") =>
      format.number(value, { style: "unit", unit: name, unitDisplay: style });
    const parts = [
      span.years > 0 ? unit(span.years, "year") : null,
      span.months > 0 ? unit(span.months, "month") : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length === 0) return unit(Math.max(span.days, 1), "day");
    return new Intl.ListFormat(locale, { type: "unit", style }).format(parts);
  };
}

function RailGroup({ label, aside, children }: { label?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t py-4 first:border-t-0 first:pt-0">
      {label ? (
        <p className="mb-2 flex items-baseline justify-between gap-3 type-label text-muted-foreground">
          {label}
          {aside}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function RailLine({ icon: Icon, children }: { icon: typeof Mail; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 py-1">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {children}
    </div>
  );
}

function PersonLink({
  name,
  href,
  detail,
  photoUrl,
  size = "sm",
}: {
  name: string;
  href: string;
  detail?: string | null;
  photoUrl?: string | null;
  size?: "sm" | "xs";
}) {
  return (
    <Link href={href} className="group flex min-w-0 items-center gap-2.5 py-1 outline-none focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring">
      <Monogram name={name} photoUrl={photoUrl} size={size} />
      <span className="min-w-0">
        <span className="block truncate type-label text-foreground group-hover:underline">{name}</span>
        {detail ? <span className="block truncate type-meta text-muted-foreground">{detail}</span> : null}
      </span>
    </Link>
  );
}

function ProfileRail({
  view,
  showPeople,
  teammates,
  reportsFooter,
  orgChartHref,
  workEmailAction,
}: {
  view: WorkerProfileView;
  showPeople: boolean;
  teammates?: WorkerProfileReport[];
  reportsFooter?: ReactNode;
  orgChartHref?: string;
  workEmailAction?: ReactNode;
}) {
  const t = useTranslations("profile.rail");
  const say = useSay("profile");
  const workforceDate = useWorkforceDate();
  const tenureOf = useTenure();
  const reports = view.directReports.slice(0, RAIL_PEOPLE);
  const mates = view.directReportCount === 0 ? (teammates ?? []) : [];
  const since = tenureOf(view.employmentStart);
  const hasContact = Boolean(view.workEmail || view.phone || view.workLocation || workEmailAction);

  return (
    <aside aria-label={t("label", { name: view.displayName })} className="w-full shrink-0 lg:sticky lg:top-6 lg:w-64 lg:pt-1">
      {hasContact ? (
        <RailGroup>
          {view.workEmail ? (
            <RailLine icon={Mail}>
              <a href={`mailto:${view.workEmail}`} className="truncate type-body text-foreground underline-offset-4 hover:underline">
                {view.workEmail}
              </a>
            </RailLine>
          ) : null}
          {workEmailAction ? <div className="ps-6.5">{workEmailAction}</div> : null}
          {view.phone ? (
            <RailLine icon={Phone}>
              <span className="truncate type-body text-foreground">{view.phone}</span>
            </RailLine>
          ) : null}
          {view.workLocation ? (
            <RailLine icon={MapPin}>
              <span className="truncate type-body text-foreground">{view.workLocation}</span>
            </RailLine>
          ) : null}
        </RailGroup>
      ) : null}

      {view.employmentStart ? (
        <RailGroup label={t("hireDate")}>
          <p className="type-body text-foreground">{workforceDate(view.employmentStart, { month: "long" })}</p>
          {since ? <p className="type-meta text-muted-foreground">{since}</p> : null}
        </RailGroup>
      ) : null}

      {view.employeeNumber || view.employmentType ? (
        <RailGroup>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {view.employeeNumber ? (
              <div className="min-w-0">
                <dt className="type-label text-muted-foreground">{t("employeeNumber")}</dt>
                <dd className="mt-0.5 truncate type-code text-foreground">{view.employeeNumber}</dd>
              </div>
            ) : null}
            {view.employmentType ? (
              <div className="min-w-0">
                <dt className="type-label text-muted-foreground">{t("contract")}</dt>
                <dd className="mt-0.5 truncate type-body text-foreground">{formatEmploymentType(view.employmentType, { say })}</dd>
              </div>
            ) : null}
          </dl>
        </RailGroup>
      ) : null}

      {showPeople ? (
        <>
          <RailGroup label={t("manager")}>
            {view.manager ? (
              <PersonLink name={view.manager.name} href={view.manager.href} detail={view.manager.employeeNumber} photoUrl={view.manager.photoUrl} />
            ) : (
              <p className="type-body text-muted-foreground">{t("noManager")}</p>
            )}
          </RailGroup>

          {view.directReportCount > 0 ? (
            <RailGroup label={t("directReports")} aside={<span className="type-meta tabular-nums">{view.directReportCount}</span>}>
              {reports.map((report) => (
                <PersonLink key={report.href} name={report.name} href={report.href} photoUrl={report.photoUrl} size="xs" />
              ))}
              {reportsFooter ??
                (view.directReportCount > reports.length ? (
                  <p className="mt-1 type-meta text-muted-foreground">{t("more", { count: view.directReportCount - reports.length })}</p>
                ) : null)}
            </RailGroup>
          ) : mates.length > 0 ? (
            <RailGroup label={t("teammates")} aside={<span className="type-meta tabular-nums">{mates.length}</span>}>
              <ul className="flex flex-wrap" aria-label={mates.map((mate) => mate.name).join(", ")}>
                {mates.slice(0, 8).map((mate) => (
                  <li key={mate.href} className="-ms-2 first:ms-0">
                    <Link href={mate.href} title={mate.name} className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Monogram name={mate.name} photoUrl={mate.photoUrl} size="sm" className="border-2 border-background" />
                    </Link>
                  </li>
                ))}
              </ul>
            </RailGroup>
          ) : null}
        </>
      ) : null}

      {orgChartHref ? (
        <RailGroup>
          <Link href={orgChartHref} className="inline-flex items-center gap-2 type-label text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            <Workflow className="size-4" aria-hidden /> {t("orgChart")}
          </Link>
        </RailGroup>
      ) : null}
    </aside>
  );
}
