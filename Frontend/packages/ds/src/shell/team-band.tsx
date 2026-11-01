"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRightLeft, BriefcaseBusiness, Cake, Coffee, Gift, LogOut, PartyPopper, UserPlus, type LucideIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { PersonAvatar } from "../components/ui/person-avatar";
import { dateFormatter } from "../lib/dates";
import { cn } from "../lib/utils";
import { LinkTabs } from "./link-tabs";

export type TeamBandEventKind = "Joins" | "MovesIn" | "Leaves" | "MovesOut" | "NewJob" | "Anniversary" | "Birthday";

/** A person on the band: what their "what's next" is chosen from. Dates are ISO days; `oneOnOneAt` is an instant. */
export interface TeamBandPerson {
  employeeKey: string;
  name: string;
  jobTitle: string | null;
  photo: string | null;
  joinsOn: string | null;
  events: { kind: TeamBandEventKind; date: string; years: number | null }[];
  oneOnOneAt: string | null;
  attention: "offTrack" | "atRisk" | null;
  href?: string;
}

export type TeamNext =
  | { kind: TeamBandEventKind; date: string; years: number | null }
  | { kind: "OneOnOne"; date: string; today: boolean }
  | { kind: "offTrack" | "atRisk" };

const SOON_DAYS = 7;
const WINDOW_DAYS = 30;
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * What's next for one person (D-27): a joiner's first day; otherwise the soonest dated thing in the next week (a 1:1,
 * a last day, an anniversary), then an objective that needs attention, then anything later in the 30 days.
 */
export function teamNext(person: TeamBandPerson, now: Date = new Date()): TeamNext | null {
  const today = isoDay(now);
  const add = (days: number) => isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const join = person.events.find((event) => event.kind === "Joins" || event.kind === "MovesIn");
  if (person.joinsOn && join) return join;
  const dated: { at: string; next: TeamNext }[] = person.events.map((event) => ({ at: event.date, next: event }));
  if (person.oneOnOneAt) {
    const day = isoDay(new Date(person.oneOnOneAt));
    if (day >= today) dated.push({ at: day, next: { kind: "OneOnOne", date: person.oneOnOneAt, today: day === today } });
  }
  dated.sort((a, b) => a.at.localeCompare(b.at));
  const soon = dated.find((item) => item.at <= add(SOON_DAYS));
  if (soon) return soon.next;
  if (person.attention) return { kind: person.attention };
  return dated.find((item) => item.at <= add(WINDOW_DAYS))?.next ?? null;
}

const ICON: Record<TeamNext["kind"], LucideIcon> = {
  Joins: UserPlus,
  MovesIn: UserPlus,
  Leaves: LogOut,
  MovesOut: ArrowRightLeft,
  NewJob: BriefcaseBusiness,
  Anniversary: Gift,
  Birthday: Cake,
  OneOnOne: Coffee,
  atRisk: AlertTriangle,
  offTrack: AlertTriangle,
};

export type TeamBandTab = "overview" | "performance" | "orgChart";

export interface TeamBandProps {
  manager: { name: string; jobTitle: string | null; photo: string | null; href?: string };
  people: TeamBandPerson[];
  /** The page's tabs, worded by the band; a tab in another module is a full navigation (`external`). */
  tabs: { key: TeamBandTab; href: string; external?: boolean }[];
  current: TeamBandTab;
  /** Performance's praise composer, offered to viewers who can enter Performance. */
  praiseHref?: string;
  actions?: ReactNode;
}

/**
 * The Team page's band (D-27), shared by Core HR and Performance: the person page's band for a team, with the team
 * as a small chart (the manager over each person's card and what's next for them) and the page's tabs.
 */
export function TeamBand({ manager, people, tabs, current, praiseHref, actions }: TeamBandProps) {
  const t = useTranslations("ds.team");
  const locale = useLocale();
  const day = (iso: string) => dateFormatter({ weekday: "short", day: "numeric", month: "short" }, locale).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));
  const time = (iso: string) => dateFormatter({ hour: "2-digit", minute: "2-digit" }, locale).format(new Date(iso));
  const today = people.filter((person) => !person.joinsOn);
  const joining = people.filter((person) => person.joinsOn).sort((a, b) => a.joinsOn!.localeCompare(b.joinsOn!));
  const count = t("people", { count: today.length });
  const subtitle = joining.length === 1
    ? t("withJoiner", { people: count, name: joining[0]!.name, date: day(joining[0]!.joinsOn!) })
    : joining.length > 1 ? t("withJoiners", { people: count, count: joining.length }) : count;

  function wordNext(next: TeamNext): string {
    switch (next.kind) {
      case "OneOnOne":
        return next.today ? t("next.oneOnOneToday", { time: time(next.date) }) : t("next.oneOnOne", { date: day(next.date) });
      case "atRisk":
      case "offTrack":
        return t(`next.${next.kind}`);
      case "Anniversary":
        return t("next.Anniversary", { count: next.years ?? 1, date: day(next.date) });
      default:
        return t(`next.${next.kind}`, { date: day(next.date) });
    }
  }

  return (
    <section aria-labelledby="team-title" className="rounded-surface bg-section px-6 pt-6 sm:px-8 sm:pt-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 id="team-title" className="type-display sm:text-[2.125rem]">{t("title")}</h1>
          <p className="mt-1 type-body text-muted-foreground">{subtitle}</p>
        </div>
        {praiseHref || actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {praiseHref ? (
              <Button asChild variant="outline">
                <a href={praiseHref}>
                  <PartyPopper data-icon="inline-start" aria-hidden />
                  {t("givePraise")}
                </a>
              </Button>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col items-center overflow-x-auto pb-1">
        <div className="flex w-56 items-center gap-2.5 rounded-control border border-primary/45 bg-card px-3 py-2.5">
          <PersonAvatar name={manager.name} photo={manager.photo} size="md" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate type-label text-foreground">
              <span className="truncate">{manager.name}</span>
              <span className="shrink-0 rounded-full bg-primary-tint px-1.5 text-[11px] font-semibold text-primary-ink">{t("you")}</span>
            </p>
            {manager.jobTitle ? <p className="truncate type-meta text-muted-foreground">{manager.jobTitle}</p> : null}
          </div>
        </div>
        {people.length > 0 ? (
          <>
            <div className="h-5 w-px bg-input" aria-hidden />
            <ul
              aria-label={t("chart")}
              className={cn(
                "relative flex gap-4 pt-5",
                people.length > 1 && "before:absolute before:inset-x-[69px] before:top-0 before:h-px before:bg-input"
              )}
            >
              {people.map((person) => {
                const next = teamNext(person);
                const Icon = next ? ICON[next.kind] : null;
                const card = (
                  <>
                    <PersonAvatar name={person.name} photo={person.photo} size="lg" className={cn("size-12", person.joinsOn && "border-dashed")} />
                    <div className="grid w-full gap-0.5">
                      <p className="truncate type-label text-foreground">{person.name}</p>
                      <p className="line-clamp-2 min-h-[31px] type-meta leading-[1.3] text-muted-foreground">{person.jobTitle ?? ""}</p>
                    </div>
                    <p
                      className={cn(
                        "-mx-2.5 flex w-[calc(100%+20px)] items-center justify-center gap-1.5 border-t border-border px-1.5 py-2 text-[11.5px] font-medium whitespace-nowrap text-muted-foreground",
                        next?.kind === "OneOnOne" && next.today && "text-primary-ink",
                        (next?.kind === "atRisk" || next?.kind === "offTrack") && "text-warning"
                      )}
                    >
                      {Icon ? <Icon className="size-[13px] shrink-0" aria-hidden /> : null}
                      <span className="truncate">{next ? wordNext(next) : t("next.none")}</span>
                    </p>
                  </>
                );
                const className =
                  "relative grid w-[138px] shrink-0 justify-items-center gap-2.5 rounded-control border border-border bg-card px-2.5 pt-4 text-center before:absolute before:-top-5 before:left-1/2 before:h-5 before:w-px before:bg-input";
                return (
                  <li key={person.employeeKey} className="flex">
                    {person.href ? (
                      <Link href={person.href} className={cn(className, "outline-none transition-colors hover:border-input focus-visible:ring-2 focus-visible:ring-ring")}>
                        {card}
                      </Link>
                    ) : (
                      <div className={className}>{card}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>

      <LinkTabs label={t("tabsLabel")} tabs={tabs.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))} current={current} className="mt-5 pb-5" />
    </section>
  );
}

/** The band's shape while the team loads: title, the manager, a row of cards, the tabs. */
export function TeamBandSkeleton({ cards = 5 }: { cards?: number }) {
  return (
    <div role="status" className="rounded-surface bg-section px-6 pt-6 pb-5 sm:px-8 sm:pt-7">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="mt-2 h-4 w-40" />
      <div className="mt-2 flex flex-col items-center">
        <Skeleton className="h-14 w-56 rounded-control" />
        <div className="mt-10 flex gap-4">
          {Array.from({ length: cards }, (_, index) => <Skeleton key={index} className="h-[156px] w-[138px] rounded-control" />)}
        </div>
      </div>
      <Skeleton className="mt-5 h-9 w-72 rounded-full" />
    </div>
  );
}
