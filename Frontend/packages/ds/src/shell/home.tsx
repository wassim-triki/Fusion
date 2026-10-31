import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { dateFormatter, formatDate } from "../lib/dates";
import { FUSION_MODULE_ICONS } from "./modules";
import { daysUntil, type RenderWorkLink, type WorkListItem, type WorkListModule } from "./work-list";

/** Something dated that isn't work: a 1:1, a deadline, a cycle's end. */
export interface HomeMoment {
  id: string;
  module: string;
  kind: string;
  title: string;
  context?: string | null;
  /** ISO date (`yyyy-mm-dd`). */
  date: string;
  /** ISO UTC instant when the moment has a time. */
  at?: string | null;
  href: string;
  /** Work-item kinds this moment summarizes on its date. */
  covers?: string[] | null;
}

/** A work item as the home leads with it: with the kind (for agenda dedupe) and the steps of its path. */
export interface HomeWorkItem extends WorkListItem {
  kind?: string;
  /** ISO UTC instant since which someone else has waited on the person; null when nobody waits. */
  waitingSince?: string | null;
}

const defaultLink: RenderWorkLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** The local calendar day of a moment: its time's day when it has one, else its date. */
export function momentDay(moment: HomeMoment): string {
  return moment.at ? localDay(moment.at) : moment.date;
}

/**
 * Needs you in the order things are due (fusion-home): overdue work first (earliest due), then work someone else is
 * waiting on (longest wait), then the earliest due, then undated work as the modules gave it. A pending decision costs
 * another person time every day; one's own work that isn't due yet costs nothing today.
 */
export function orderWork<T extends HomeWorkItem>(work: readonly T[], today: Date): T[] {
  const rank = (item: T) => {
    if (item.dueOn && daysUntil(item.dueOn, today) < 0) return 0;
    if (item.waitingSince) return 1;
    return item.dueOn ? 2 : 3;
  };
  const within = (a: T, b: T) => {
    if (rank(a) === 1) return Date.parse(a.waitingSince!) - Date.parse(b.waitingSince!);
    return a.dueOn && b.dueOn ? (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0) : 0;
  };
  return [...work].sort((a, b) => rank(a) - rank(b) || within(a, b));
}

const TIME = { hour: "2-digit", minute: "2-digit" } as const;
const WEEKDAY = { weekday: "short" } as const;
const MONTH = { month: "short" } as const;

function localDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** The local calendar day (`yyyy-mm-dd`) of a UTC instant. */
function localDay(instant: string): string {
  const at = new Date(instant);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** "Sat 31 Oct" (the year outside this year). */
export function shortDay(isoDate: string, locale?: string): string {
  return formatDate(isoDate, { weekday: true, locale });
}

export interface HomeAgendaProps {
  moments: readonly HomeMoment[];
  modules: readonly WorkListModule[];
  today?: Date;
  days?: number;
  renderLink?: RenderWorkLink;
}

/** The moments of the next two weeks, earliest first; work isn't repeated here, Needs you carries its due date. */
export function agendaEntries({ moments, today, days = 14 }: Omit<HomeAgendaProps, "modules" | "renderLink">): HomeMoment[] {
  const reference = today ?? new Date();
  const inWindow = (day: string) => {
    const offset = daysUntil(day, reference);
    return offset >= 0 && offset <= days;
  };
  const key = (moment: HomeMoment) => moment.at ?? `${moment.date}T23:59`;
  return moments.filter((moment) => inWindow(momentDay(moment))).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * Coming up on the home, as drawn: a row per moment from every entitled module (its day in a tile, what happens, the
 * module it comes from), each opening its path. A module that couldn't answer is named in one quiet line.
 */
export function HomeAgenda(props: HomeAgendaProps): ReactNode {
  const t = useTranslations("ds.home");
  const locale = useLocale();
  const { modules, renderLink = defaultLink } = props;
  const entries = agendaEntries(props);
  const failed = modules.filter((module) => module.status === "error");
  const labels = new Map(modules.map((module) => [module.key, module.label]));
  const weekday = dateFormatter(WEEKDAY, locale);
  const time = dateFormatter(TIME, locale);
  const month = dateFormatter(MONTH, locale);
  const thisMonth = (props.today ?? new Date()).getMonth();
  return (
    <div lang={locale}>
      {entries.length === 0 ? (
        <p className="px-5 py-4 type-body-secondary text-muted-foreground">{t("nothingScheduled")}</p>
      ) : (
        <ol className="divide-y divide-border">
          {entries.map((entry) => {
            const date = localDate(momentDay(entry));
            const Icon = FUSION_MODULE_ICONS[entry.module];
            const context = [entry.at ? time.format(new Date(entry.at)) : null, entry.context].filter(Boolean).join(" · ");
            return (
              <li key={entry.id}>
                {renderLink({
                  href: entry.href,
                  className: "group flex min-h-[70px] items-center gap-4 px-5 py-3 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  children: (
                    <>
                      <span className="grid size-12 shrink-0 place-items-center content-center rounded-control bg-inlay">
                        <span className="type-eyebrow leading-none text-muted-foreground">
                          {date.getMonth() !== thisMonth ? month.format(date) : weekday.format(date)}
                        </span>
                        <span className="type-subsection-title leading-tight tabular-nums text-foreground">{date.getDate()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-label font-semibold text-foreground">{entry.title}</span>
                        {context ? <span className="block truncate type-meta text-muted-foreground">{context}</span> : null}
                      </span>
                      <span className="hidden shrink-0 items-center gap-1.5 type-meta text-muted-foreground sm:inline-flex">
                        {Icon ? <Icon aria-hidden className="size-4" /> : null}
                        {labels.get(entry.module) ?? entry.module}
                      </span>
                    </>
                  ),
                })}
              </li>
            );
          })}
        </ol>
      )}
      {failed.map((module) => (
        <p key={module.key} role="status" className="px-5 py-3 type-meta text-muted-foreground">
          {t("datesFailed", { module: module.label })}
        </p>
      ))}
    </div>
  );
}
