"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { MyTeamDto, TeamEventDto } from "@repo/api";
import { PersonAvatar, Skeleton } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import { dateFormatter } from "@repo/ds/lib/dates";
import { ArrowRight, MapPin, Network } from "lucide-react";
import { ChecklistSection } from "@/features/checklists/checklist-section";
import { UpcomingRow, useDayParts, type UpcomingItem } from "@/features/people/components/worker-profile/overview-tab";
import { TeamFrame, type TeamBandData } from "./team-frame";

const WINDOW_DAYS = 30;

/** The Team page's Overview (D-27): the rail, then Coming up, the joiner's first week and the team's year. */
export default function TeamWorkspace() {
  return <TeamFrame tab="overview">{(band) => <TeamOverview band={band} />}</TeamFrame>;
}

function TeamOverview({ band }: { band: TeamBandData }) {
  const t = useTranslations("team");
  const team = band.team.data!;
  // The first week shown is the next joiner's, while they are still to come.
  const joiner = team.members.filter((person) => person.joinsOn).sort((a, b) => a.joinsOn!.localeCompare(b.joinsOn!))[0];
  return (
    <div className="mt-8 grid items-start gap-10 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-11">
      <TeamRail team={team} photos={band.photos} />
      <div className="min-w-0 space-y-5">
        <ComingUp band={band} />
        {joiner ? (
          <ChecklistSection employeeKey={joiner.employeeKey} isSelf={false} owner="manager" title={t("firstWeek", { name: joiner.displayName.split(" ")[0] ?? joiner.displayName })} />
        ) : null}
        <TeamYear band={band} />
      </div>
    </div>
  );
}

/** The rail (D-27): who the manager reports to, where the team works, and the roles still open. */
function TeamRail({ team, photos }: { team: MyTeamDto; photos: ReadonlyMap<string, string> }) {
  const t = useTranslations("team.rail");
  const locale = useLocale();
  const places = [...team.members.reduce((counts, person) => {
    if (person.place) counts.set(person.place, (counts.get(person.place) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const day = (iso: string) => dateFormatter({ day: "numeric", month: "short" }, locale).format(new Date(`${iso}T12:00:00`));
  const group = "grid gap-2 border-t border-border py-4 first:border-t-0 first:pt-0";

  return (
    <aside aria-label={t("label")} className="w-full lg:sticky lg:top-6 lg:pt-1">
      {team.reportsTo ? (
        <div className={group}>
          <p className="type-meta text-muted-foreground">{t("yourManager")}</p>
          <Link href={`/people/${team.reportsTo.employeeKey}`} className="group flex min-w-0 items-center gap-2.5 outline-none focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring">
            <PersonAvatar name={team.reportsTo.displayName} photo={team.reportsTo.photoUrl ? photos.get(team.reportsTo.photoUrl) : undefined} size="xs" />
            <span className="truncate type-body text-foreground group-hover:underline">{team.reportsTo.displayName}</span>
          </Link>
        </div>
      ) : null}
      {places.length > 0 ? (
        <div className={group}>
          <p className="type-meta text-muted-foreground">{t("places")}</p>
          {places.map(([place, count]) => (
            <p key={place} className="flex min-w-0 items-center gap-2.5 type-body text-foreground">
              <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{place}</span>
              <span className="ms-auto tabular-nums text-muted-foreground">{count}</span>
            </p>
          ))}
        </div>
      ) : null}
      <div className={group}>
        <p className="type-meta text-muted-foreground">{t("openRoles")}</p>
        {team.openRoles.length === 0 ? (
          <p className="type-body text-foreground">{t("none")}</p>
        ) : (
          team.openRoles.map((role) => (
            <div key={role.id} className="min-w-0">
              <p className="truncate type-body text-foreground">{role.jobTitle}</p>
              {role.placeName || role.targetStartDate ? (
                <p className="truncate type-meta text-muted-foreground">
                  {[role.placeName, role.targetStartDate ? t("from", { date: day(role.targetStartDate) }) : null].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className={group}>
        <Link href="/team/org-chart" className="inline-flex items-center gap-2 type-label text-primary-ink underline-offset-4 hover:underline">
          <Network className="size-4" aria-hidden />
          {t("showOnChart")}
        </Link>
      </div>
    </aside>
  );
}

/** Coming up for the whole team in the next 30 days (D-27), from Core HR and the manager's 1:1s in Performance. */
function ComingUp({ band }: { band: TeamBandData }) {
  const t = useTranslations("team.comingUp");
  const locale = useLocale();
  const { month, day } = useDayParts();
  const team = band.team.data!;
  const people = new Map(team.members.map((person) => [person.employeeKey, person]));
  const time = (iso: string) => dateFormatter({ hour: "2-digit", minute: "2-digit" }, locale).format(new Date(iso));
  const now = new Date();
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WINDOW_DAYS + 1);

  const core: UpcomingItem[] = team.comingUp.flatMap((event) => {
    const person = people.get(event.employeeKey);
    if (!person) return [];
    const words = eventWords(event, person.displayName, person.jobTitle, t);
    return [{
      key: `${event.kind}-${event.employeeKey}-${event.date}`,
      at: event.date,
      when: { top: month(event.date), main: day(event.date) },
      title: words.title,
      meta: words.meta,
      source: "core" as const,
      href: `/core/people/${event.employeeKey}`,
    }];
  });
  const meetings: UpcomingItem[] = (band.perf.oneOnOnes.data?.reports ?? []).flatMap((row) => {
    const at = row.nextMeetingAt;
    if (row.ended || !at || new Date(at) >= horizon) return [];
    const today = new Date(at).toDateString() === now.toDateString();
    return [{
      key: `one-on-one-${row.seriesId}`,
      at,
      when: today ? { top: t("today"), main: time(at), today: true } : { top: month(at), main: day(at) },
      title: t("oneOnOne", { name: row.with.displayName }),
      meta: t("agenda", { count: row.agendaCount }),
      source: "performance" as const,
      href: `/performance/one-on-ones/${row.seriesId}`,
    }];
  });
  const rows = [...core, ...meetings].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  return (
    <Section title={t("title")} meta={t("window")} flush={rows.length > 0}>
      {rows.length > 0 ? (
        <ul className="divide-y divide-border">
          {rows.map((row) => <UpcomingRow key={row.key} item={row} />)}
        </ul>
      ) : (
        <p className="type-body text-muted-foreground">{t("empty")}</p>
      )}
    </Section>
  );
}

type ComingUpWords = ReturnType<typeof useTranslations<"team.comingUp">>;

function eventWords(event: TeamEventDto, name: string, jobTitle: string | null, t: ComingUpWords): { title: string; meta?: string } {
  switch (event.kind) {
    case "Joins":
      return { title: t("joins", { name }), meta: jobTitle ? t("joinsMeta", { job: jobTitle }) : undefined };
    case "MovesIn":
      return { title: t("movesIn", { name }), meta: jobTitle ?? undefined };
    case "Leaves":
      return { title: t("leaves", { name }) };
    case "MovesOut":
      return { title: t("movesOut", { name }) };
    case "NewJob":
      return { title: t("newJob", { name, job: event.jobTitle ?? "" }) };
    case "Anniversary":
      return { title: t("anniversary", { name, count: event.years ?? 1 }), meta: t("anniversaryMeta") };
    case "Birthday":
      return { title: t("birthday", { name }) };
  }
}

/** The team's year (D-27): this cycle's objectives by status and how many people updated lately, from Performance. */
function TeamYear({ band }: { band: TeamBandData }) {
  const t = useTranslations("team.year");
  const { roster } = band.perf;
  if (roster.isLoading && !roster.data) return <Skeleton className="h-36 w-full rounded-surface" />;
  const summary = roster.data?.summary;
  const status = summary?.status;
  if (!roster.data || !summary || !status) return null;
  const total = status.onTrack + status.atRisk + status.offTrack + status.noStatus;
  if (total === 0) return null;
  const parts = [
    { key: "onTrack", count: status.onTrack, bar: "bg-success", dot: "bg-success", text: "text-success" },
    { key: "atRisk", count: status.atRisk, bar: "bg-warning", dot: "bg-warning", text: "text-warning" },
    { key: "offTrack", count: status.offTrack, bar: "bg-destructive", dot: "bg-destructive", text: "text-destructive" },
    { key: "noStatus", count: status.noStatus, bar: "bg-input", dot: "bg-input", text: "text-muted-foreground" },
  ].filter((part) => part.count > 0);

  return (
    <Section
      title={t("title")}
      action={
        <a href="/performance/team" className="inline-flex items-center gap-1.5 type-label text-primary-ink underline-offset-4 hover:underline">
          {t("performanceTab")}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </a>
      }
    >
      <div className="grid gap-3">
        <p className="flex flex-wrap items-baseline gap-2.5">
          <span className="font-editorial text-[2rem] leading-none text-foreground tabular-nums">{total}</span>
          <span className="type-body text-muted-foreground">
            {t("objectives", { count: total })} · {t("updated", { updated: summary.updatedIn30Days, people: summary.approved })}
          </span>
        </p>
        <div className="flex h-2.5 gap-[3px]" aria-hidden>
          {parts.map((part) => (
            <span key={part.key} className={`${part.bar} rounded-full`} style={{ flexGrow: part.count }} />
          ))}
        </div>
        <p className="flex flex-wrap gap-4 type-meta">
          {parts.map((part) => (
            <span key={part.key} className={`inline-flex items-center gap-1.5 ${part.text}`}>
              <span className={`size-2 rounded-full ${part.dot}`} aria-hidden />
              {t(part.key as "onTrack", { count: part.count })}
            </span>
          ))}
        </p>
      </div>
    </Section>
  );
}
