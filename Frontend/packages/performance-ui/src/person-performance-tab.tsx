"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  FusionWorkBooking,
  ObjectiveStatus,
  PersonPerformanceSummaryDto,
  PersonSummaryCycleDto,
  PersonSummaryObjectiveDto,
  PersonSummaryOneOnOneDto,
} from "@repo/api";
import { Button, cn } from "@repo/ds";
import { Section, StateWord, type StateTone } from "@repo/ds/shell";
import { QuickPicks } from "@repo/ds/choice";
import { GoalLine } from "./goal-line";
import { AvatarStack, PersonInitials } from "./people";
import type { PersonPerformanceSummaryState } from "./person-performance-summary";
import { SummaryDevelopment } from "./summary-development";
import { percent, weightPercent, type RenderSummaryLink } from "./summary-lib";
import { usePerformanceWords } from "./use-words";

const TONE: Record<ObjectiveStatus, StateTone> = { OnTrack: "ok", AtRisk: "warn", OffTrack: "bad" };
const LANE = "grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_120px] items-center gap-6";
const linkClass = "type-meta text-foreground hover:underline";
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export interface PersonPerformanceTabProps {
  state: PersonPerformanceSummaryState;
  renderLink: RenderSummaryLink;
  /** Posts `{ at }` to the booking's path below Performance's API; the host refreshes the summary after. */
  onBook?: (path: string, at: string) => Promise<void>;
}

/**
 * The person page's Performance tab, the one place for a person's year (D-84): a rail with where their year stands
 * (the plan, 1:1s, praise, last year's result), then their goals each on the year against its pace, the 1:1s with
 * what's waiting or times to book, and what people said. Only what the server returned is drawn.
 */
export function PersonPerformanceTab({ state, renderLink, onBook }: PersonPerformanceTabProps) {
  const t = useTranslations("performanceUi.PersonPerformanceTab");
  const words = usePerformanceWords();
  if (state.status === "loading") {
    return (
      <div aria-busy aria-label={t("loading")} className="grid gap-[18px]">
        <div className="h-20 animate-pulse rounded-surface bg-card" />
        <div className="grid gap-[18px]">
          <div className="h-56 animate-pulse rounded-surface bg-card" />
          <div className="h-28 animate-pulse rounded-surface bg-card" />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-card px-5 py-4">
        <p className="type-body text-foreground">{t("couldntLoad")}</p>
        <Button variant="outline" size="sm" onClick={state.onRetry}>{t("tryAgain")}</Button>
      </div>
    );
  }

  const { summary } = state;
  const cycle = summary.currentCycle;
  const said = [
    ...(summary.praise?.items ?? []).map((item) => ({ id: item.id, text: item.message, by: item.author.name, at: item.givenAt })),
    ...(summary.feedback?.items ?? []).map((item) => ({ id: item.id, text: item.message, by: item.author.name, at: item.sentAt })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2);
  const nothing = !cycle && !summary.reviews && !summary.praise && !summary.feedback && !summary.oneOnOne && !summary.oneOnOneBooking;
  if (nothing) return <p className="type-body-secondary text-muted-foreground">{t("nothingToSee")}</p>;

  return (
    <div className="grid gap-[18px]">
      <Rail summary={summary} />
      <div className="grid gap-[18px]">
        {cycle?.isParticipant ? <Goals cycle={cycle} renderLink={renderLink} /> : null}
        {summary.oneOnOne || summary.oneOnOneBooking ? (
          <OneOnOnes oneOnOne={summary.oneOnOne} booking={summary.oneOnOneBooking} name={summary.displayName} renderLink={renderLink} onBook={onBook} />
        ) : null}
        {summary.praise || summary.feedback ? (
          <Section
            id="person-said"
            title={t("praiseAndFeedback")}
            action={summary.praise && summary.praise.total > 0
              ? renderLink({ href: summary.praise.href, className: linkClass, children: t("allPraise", { count: summary.praise.total }) })
              : null}
          >
            {said.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {said.map((item) => (
                  <figure key={item.id} className="grid content-between gap-2.5 rounded-inset bg-inlay p-4">
                    <blockquote dir="auto" className="type-narrative line-clamp-4 text-[15px] leading-snug text-foreground">“{item.text}”</blockquote>
                    <figcaption className="flex items-center gap-2 type-meta text-muted-foreground">
                      <PersonInitials name={item.by} size="xs" />
                      {t("byOn", { name: first(item.by) || t("aColleague"), day: words.date(item.at) })}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="type-body-secondary text-muted-foreground">{t("nothingSaidYet")}</p>
            )}
          </Section>
        ) : null}
        {summary.development && summary.development.goals.length ? (
          <SummaryDevelopment development={summary.development} renderLink={renderLink} />
        ) : null}
      </div>
    </div>
  );
}

/** One fact of the year: a small label over its value. */
function RailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1 px-5 py-4">
      <span className="type-meta text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Rail({ summary }: { summary: PersonPerformanceSummaryDto }) {
  const t = useTranslations("performanceUi.PersonPerformanceTab");
  const words = usePerformanceWords();
  const cycle = summary.currentCycle;
  const last = summary.reviews?.history.find((result) => result.cycleName !== cycle?.cycleName) ?? null;
  const current = summary.reviews?.current ?? null;
  const givers = [...new Set((summary.praise?.items ?? []).map((item) => item.author.name))].slice(0, 3);
  return (
    // The person page has its own rail beside the tabs, so the year's facts read as one row over the sections.
    <aside aria-label={t("atAGlance")}
      className="grid divide-border overflow-hidden rounded-surface bg-card max-sm:divide-y sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))] sm:divide-x">
      {cycle?.isParticipant && cycle.planStatus ? (
        <RailItem label={cycle.cycleName}>
          <span className="flex flex-wrap items-center gap-2">
            {cycle.planStatus === "Approved"
              ? <StateWord tone="ok">{t("planApproved")}</StateWord>
              : <span className="type-label text-foreground">{words.planStatus(cycle.planStatus)}</span>}
            {cycle.planSince ? <span className="type-meta text-muted-foreground">{words.date(cycle.planSince)}</span> : null}
          </span>
        </RailItem>
      ) : null}
      {current ? (
        <RailItem label={current.reviewRoundName}>
          <span className="type-label text-foreground">{words.step(current.state === "Closed" ? "Finalized" : current.state)}</span>
          {current.dueDate ? <span className="type-meta text-muted-foreground">{t("due", { day: words.date(current.dueDate) })}</span> : null}
        </RailItem>
      ) : null}
      {summary.oneOnOne ? (
        <RailItem label={t("oneOnOnes")}>
          <span className="type-label text-foreground">
            {summary.oneOnOne.nextMeetingAt ? t("nextOn", { day: words.date(summary.oneOnOne.nextMeetingAt) }) : t("notBooked")}
          </span>
          {summary.oneOnOne.lastMeetingAt ? <span className="type-meta text-muted-foreground">{t("lastOn", { day: words.date(summary.oneOnOne.lastMeetingAt) })}</span> : null}
        </RailItem>
      ) : summary.oneOnOneBooking ? (
        <RailItem label={t("oneOnOnes")}>
          <span className="type-label text-warning">{t("noneYet")}</span>
        </RailItem>
      ) : null}
      {summary.praise ? (
        <RailItem label={t("praise")}>
          <span className="flex items-center gap-2">
            <b className="type-label tabular-nums text-foreground">{summary.praise.total}</b>
            {givers.length ? <AvatarStack names={givers} size="xs" /> : null}
          </span>
        </RailItem>
      ) : null}
      {last ? (
        <RailItem label={last.cycleName}>
          <span className="type-label text-foreground">{last.finalRatingLabel ?? words.t("noRating")}</span>
          {last.reviewerName ? (
            <span className="type-meta text-muted-foreground">
              {last.acknowledgedAt ? t("fromAcknowledged", { name: first(last.reviewerName) }) : t("from", { name: first(last.reviewerName) })}
            </span>
          ) : null}
        </RailItem>
      ) : null}
    </aside>
  );
}

/** The person's goals, each on the year against its pace; a lane opens the goal where the viewer may. */
function Goals({ cycle, renderLink }: { cycle: PersonSummaryCycleDto; renderLink: RenderSummaryLink }) {
  const t = useTranslations("performanceUi.PersonPerformanceTab");
  const words = usePerformanceWords();
  const today = todayIso();
  const running = cycle.planStatus === "Approved";
  const even = cycle.objectives.length ? 100 / cycle.objectives.length : 0;
  return (
    <Section
      id="person-goals"
      title={t("goals")}
      meta={running && cycle.overallProgress != null ? t("planDone", { progress: percent(cycle.overallProgress) }) : undefined}
      action={cycle.planHref ? renderLink({ href: cycle.planHref, className: linkClass, children: words.t("openPlan") }) : null}
    >
      {cycle.objectives.length === 0 ? (
        <p className="type-body-secondary text-muted-foreground">{t("noGoalsYet")}</p>
      ) : (
        <div className="grid">
          {cycle.objectives.map((goal, index) => {
            const lane = <Lane goal={goal} share={goal.weight ?? even} running={running} today={today} />;
            const className = cn("-mx-3.5 block rounded-inset px-3.5 py-3.5 hover:bg-foreground/[0.035]", index > 0 && "border-t border-border");
            return goal.href
              ? <div key={goal.objectiveId}>{renderLink({ href: goal.href, className, children: lane })}</div>
              : <div key={goal.objectiveId} className={className}>{lane}</div>;
          })}
        </div>
      )}
    </Section>
  );
}

function Lane({ goal, share, running, today }: { goal: PersonSummaryObjectiveDto; share: number; running: boolean; today: string }) {
  const t = useTranslations("performanceUi.PersonPerformanceTab");
  const words = usePerformanceWords();
  return (
    <span className={LANE}>
      <span className="grid min-w-0 gap-[3px]">
        <span className="type-narrative text-[15.5px] font-medium leading-snug text-foreground">{goal.title}</span>
        <span className="type-meta text-muted-foreground">{t("ofThePlan", { weight: weightPercent(share) })}</span>
      </span>
      <GoalLine
        start={goal.startDate}
        end={goal.endDate}
        today={today}
        updates={goal.line.map((point) => ({ recordedAt: point.at, resultingProgress: point.progress, status: null }))}
        status={goal.status}
        height={44}
        dots={false}
        ghost={!running}
      />
      <span className="grid justify-items-end gap-[3px] text-end">
        {running && goal.status ? <StateWord tone={TONE[goal.status]}>{words.objectiveStatus(goal.status)}</StateWord> : null}
        <span className="type-meta text-muted-foreground">
          {!running ? `${weightPercent(share)}%` : goal.lastProgressAt ? t("doneOn", { progress: percent(goal.progress ?? 0), day: words.date(goal.lastProgressAt) }) : t("noUpdateYet")}
        </span>
      </span>
    </span>
  );
}

/** The 1:1s with the person: the next one with what's waiting on it, or times both are free to book the first. */
function OneOnOnes({ oneOnOne, booking, name, renderLink, onBook }: {
  oneOnOne: PersonSummaryOneOnOneDto | null;
  booking: FusionWorkBooking | null;
  name: string | null;
  renderLink: RenderSummaryLink;
  onBook?: (path: string, at: string) => Promise<void>;
}) {
  const t = useTranslations("performanceUi.PersonPerformanceTab");
  const words = usePerformanceWords();
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const book = async () => {
    if (!booking || !onBook) return;
    setBusy(true);
    setError(false);
    try { await onBook(booking.path, booking.slots[pick]!); } catch { setError(true); } finally { setBusy(false); }
  };
  return (
    <Section
      id="person-one-on-ones"
      title={t("oneOnOnes")}
      action={oneOnOne ? renderLink({ href: oneOnOne.href, className: linkClass, children: t("openTheOneOnOne") }) : null}
    >
      {oneOnOne ? (
        <div className="grid gap-1.5">
          <b className="type-label text-foreground">
            {oneOnOne.nextMeetingAt ? t("nextOneAt", { at: words.dateTime(new Date(oneOnOne.nextMeetingAt)) }) : t("notBooked")}
          </b>
          <span className="type-meta text-muted-foreground">
            {oneOnOne.waiting.length ? t("waiting", { count: oneOnOne.waiting.length, items: oneOnOne.waiting.slice(0, 3).join(", ") }) : t("nothingWaiting")}
          </span>
        </div>
      ) : booking ? (
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid min-w-0 flex-1 gap-1.5">
            <b className="type-label text-foreground">{t("noOneOnOnesYet", { name: first(name) })}</b>
            <span className="type-meta text-muted-foreground">{t("bothFree")}</span>
            <QuickPicks
              className="mt-1"
              label={t("bothFree")}
              value={booking.slots[pick]}
              onPick={(slot) => setPick(booking.slots.indexOf(slot))}
              options={booking.slots.map((slot) => ({ value: slot, label: words.dateTime(new Date(slot)) }))}
            />
            {error ? <span role="alert" className="type-meta text-destructive">{t("couldntBook")}</span> : null}
          </div>
          {onBook ? <Button size="sm" disabled={busy} onClick={() => void book()}>{t("bookIt")}</Button> : null}
        </div>
      ) : null}
    </Section>
  );
}
