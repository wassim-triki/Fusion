"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { YearPlanDto, YearSetupDto } from "@repo/api";
import { useCompanyWorkWeek } from "@repo/api/query";
import { PageRefusal } from "@repo/auth";
import { cn } from "@repo/ds";
import { dateFormatter } from "@repo/ds/lib/dates";
import { Check, ChevronRight, Rocket, Settings } from "@repo/ds/icons";
import { AsyncButton, PageContainer, PageSkeleton } from "@repo/ds/shell";
import { AvatarStack } from "@repo/performance-ui";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { useLaunchYear, useSaveYear, useYearSetup } from "../../api/use-performance";
import { useWorkspaceContext } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { addDays, YearDates, type DaysOff, type Holiday, type MomentKey } from "./year-dates";
import { isIn, WhosIn, type WhoIsIn } from "./year-whos-in";
import { day, daysBetween } from "./year-words";

/**
 * Setting up a year (D-91; its dates redrawn in D-103, who's in in D-104): one page whose object is the year. Its name
 * is edited in the title; when each step happens is a row per date, every date proposed from last year's a year on;
 * who's in is everyone in Core HR less the Leave out rules and the exceptions by name; then what comes along. Kept as
 * a draft (nobody is told) or launched for the people counted (D-84).
 */
export function YearSetupPage() {
  const t = useTranslations("year.YearSetup");
  const context = useWorkspaceContext();
  const administers = context.data?.capabilities.administers ?? false;
  const setup = useYearSetup();

  if (context.isLoading || (administers && setup.isLoading)) return <PageSkeleton rows={5} width="wide" label={t("loading")} />;
  if (!administers) return <PageContainer><PageRefusal /></PageContainer>;
  if (setup.error) return <ContentUnavailable error={setup.error} onRetry={setup.refetch} />;
  if (!setup.data) return <PageSkeleton rows={5} width="wide" label={t("loading")} />;
  return <SetUp key={setup.data.draftId ?? "new"} setup={setup.data} />;
}

/** The top bar's path on this page: Performance › Year › Set up FY2028. */
export function YearSetupCrumbs() {
  const t = useTranslations("year.YearSetup");
  const setup = useYearSetup();
  const name = setup.data?.year.name;
  return (
    <nav aria-label={t("crumbs")}>
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        <li><Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">{t("crumbPerformance")}</Link></li>
        <li className="flex items-center gap-2">
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70 rtl:rotate-180" />
          <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">{t("crumbYear")}</Link>
        </li>
        {name ? (
          <li className="flex min-w-0 items-center gap-2">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70 rtl:rotate-180" />
            <span aria-current="page" className="truncate font-semibold text-foreground">{t("title", { name })}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

function SetUp({ setup }: { setup: YearSetupDto }) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const router = useRouter();
  const save = useSaveYear();
  const launch = useLaunchYear();
  const [year, setYear] = useState<YearPlanDto>(() => withMoments(setup.year));
  const [who, setWho] = useState<WhoIsIn>(() => ({ leaveOut: setup.leaveOut, exceptions: setup.exceptions }));
  const [busy, setBusy] = useState<"draft" | "launch" | null>(null);
  const days = useDaysOff(year.startDate, year.endDate);
  const long = dateFormatter({ day: "numeric", month: "long", year: "numeric" }, locale);
  const longDay = (iso: string) => long.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  const count = setup.everyone.filter((person) => isIn(who, person)).length;

  const set = (patch: Partial<YearPlanDto>) => setYear((current) => ({ ...current, ...patch }));
  const move = (key: MomentKey, iso: string) => setYear((current) => ({ ...current, [key]: iso }));
  const pick = (key: MomentKey, iso: string) => {
    const was = year[key];
    move(key, iso);
    toast.success(t("movedToast", { moment: t(`moment.${MOMENT_WORD[key]}`), day: day(iso, locale) }), {
      action: { label: t("undo"), onClick: () => { if (was) move(key, was); } },
    });
  };

  const persist = () =>
    save.mutateAsync({
      draftId: setup.draftId,
      version: setup.draftVersion,
      request: {
        name: year.name.trim(),
        startDate: year.startDate,
        endDate: year.endDate,
        planningDeadline: year.planningEndsOn,
        plan: {
          reviewOpensOn: year.reviewOpensOn,
          resultsOutOn: year.resultsOutOn,
          midYearCheckInOn: year.midYearCheckInOn,
          selfReviewsDueOn: year.selfReviewsDueOn,
          calibrationOn: year.calibrationOn,
          joinersJoin: year.joinersJoin,
          droppedCompanyGoalIds: year.droppedCompanyGoalIds,
          whoIsIn: who,
        },
      },
    });

  const keepDraft = async () => {
    setBusy("draft");
    try {
      await persist();
      toast.success(t("keptToast"));
    } catch (error) {
      reportPerformanceFailure(error, t("saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const launchYear = async () => {
    setBusy("launch");
    try {
      const saved = await persist();
      const launched = await launch.mutateAsync({ cycleId: saved.id, version: saved.version });
      toast.success(t("launchedToast", { name: year.name.trim(), count: launched.people }));
      router.push("/");
    } catch (error) {
      reportPerformanceFailure(error, t("launchFailed"));
      setBusy(null);
    }
  };

  const blocked = setup.launchBlocker === "lastYearRunning";

  return (
    <PageContainer>
      <div className="grid max-w-[1180px] gap-[18px]">
        <div className="flex flex-wrap items-end gap-4 pt-2">
          <div className="grid gap-1">
            <h1 className="type-display text-[40px] text-foreground">
              {t.rich("titleEditable", { name: () => <YearName name={year.name} fallback={setup.year.name} onName={(name) => set({ name })} /> })}
            </h1>
            <span className="text-muted-foreground">{t("dates", { start: longDay(year.startDate), end: longDay(year.endDate) })}</span>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <AsyncButton variant="ghost" pending={busy === "draft"} disabled={busy !== null} onClick={() => void keepDraft()}>
              {t("keepDraft")}
            </AsyncButton>
            <AsyncButton writes pending={busy === "launch"} disabled={busy !== null || blocked || count === 0} onClick={() => void launchYear()}
              title={t("launchTitle", { count, name: year.name })}>
              <Rocket aria-hidden className="size-4" />
              {t("launchFor", { count })}
            </AsyncButton>
          </div>
        </div>
        {blocked ? (
          <p className="-mt-2 text-end text-[13px] text-muted-foreground">{t("lastYearRunning", { name: setup.lastYearName ?? "" })}</p>
        ) : null}

        <Section title={t("when")} aside={setup.lastYearName ? t("fromLastYear", { name: setup.lastYearName }) : null}>
          <YearDates year={year} lastYear={setup.lastYear} lastYearName={setup.lastYearName} days={days} onMove={move} onPick={pick} />
        </Section>

        <Section title={t("whosIn")}>
          <WhosIn setup={setup} startDate={year.startDate} who={who} onWho={setWho}
            joinersJoin={year.joinersJoin} onJoiners={(joinersJoin) => set({ joinersJoin })} />
        </Section>

        <WhatComesAlong setup={setup} dropped={year.droppedCompanyGoalIds}
          onToggle={(id) => set({ droppedCompanyGoalIds: year.droppedCompanyGoalIds.includes(id)
            ? year.droppedCompanyGoalIds.filter((d) => d !== id) : [...year.droppedCompanyGoalIds, id] })} />
      </div>
    </PageContainer>
  );
}

const MOMENT_WORD = {
  startDate: "yearStarts",
  planningEndsOn: "goalsAgreed",
  midYearCheckInOn: "midYearCheckInOn",
  reviewOpensOn: "reviewsOpen",
  selfReviewsDueOn: "selfReviewsDueOn",
  calibrationOn: "calibrationOn",
  resultsOutOn: "resultsOut",
  endDate: "yearEnds",
} as const satisfies Record<MomentKey, string>;

/** A section of the page: its serif heading large over what it holds (B-467). */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-5 rounded-surface bg-card px-7 pb-6 pt-[26px]">
      <div className="flex items-baseline gap-3.5">
        <h2 className="font-editorial text-[26px] font-medium leading-tight tracking-[-0.01em] text-foreground">{title}</h2>
        {aside ? <span className="ms-auto text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The year's name, edited where it reads: in the title. Enter or leaving it keeps it; emptied, it goes back. */
function YearName({ name, fallback, onName }: { name: string; fallback: string; onName: (name: string) => void }) {
  const t = useTranslations("year.YearSetup");
  const ref = useRef<HTMLSpanElement>(null);
  // The text is written here, not rendered, so React never fights the caret over it.
  useLayoutEffect(() => {
    if (ref.current && ref.current.textContent !== name) ref.current.textContent = name;
  }, [name]);
  const commit = () => {
    const typed = (ref.current?.textContent ?? "").trim().slice(0, 200);
    const next = typed || name || fallback;
    if (ref.current) ref.current.textContent = next;
    if (next !== name) onName(next);
  };
  return (
    <span ref={ref} role="textbox" aria-label={t("yearName")} tabIndex={0} contentEditable="plaintext-only" spellCheck={false}
      suppressContentEditableWarning onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      className="-mx-1 cursor-text rounded-detail px-1 outline-none hover:shadow-[inset_0_-2px_0_color-mix(in_oklab,var(--muted-foreground)_45%,transparent)] focus:shadow-[inset_0_0_0_1.5px_var(--primary)]" />
  );
}

/** With no date fields, every moment needs a date: one missing is proposed inside its step. */
function withMoments(year: YearPlanDto): YearPlanDto {
  const within = (from: string, to: string, share: number) => addDays(from, Math.round(daysBetween(from, to) * share));
  return {
    ...year,
    midYearCheckInOn: year.midYearCheckInOn ?? within(year.planningEndsOn, year.reviewOpensOn, 0.5),
    selfReviewsDueOn: year.selfReviewsDueOn ?? within(year.reviewOpensOn, year.resultsOutOn, 0.35),
    calibrationOn: year.calibrationOn ?? within(year.reviewOpensOn, year.resultsOutOn, 0.7),
  };
}

function WhatComesAlong({ setup, dropped, onToggle }: { setup: YearSetupDto; dropped: string[]; onToggle: (id: string) => void }) {
  const t = useTranslations("year.YearSetup");
  if (!setup.lastYearName) {
    return (
      <Section title={t("whatComesAlong")}>
        <span className="text-sm text-muted-foreground">{t("firstYear")}</span>
        <SettingsLine />
      </Section>
    );
  }
  return (
    <Section title={t("whatComesAlong")} aside={t("fromYear", { name: setup.lastYearName })}>
      <div className="grid items-start gap-8 md:grid-cols-2">
        <div className="grid gap-0.5">
          <span className="px-2.5 pb-1 text-[12.5px] text-muted-foreground">{t("companyGoals")}</span>
          {setup.companyGoals.length > 0 ? setup.companyGoals.map((goal) => {
            const kept = !dropped.includes(goal.id);
            return (
              <button key={goal.id} type="button" role="checkbox" aria-checked={kept} onClick={() => onToggle(goal.id)}
                className="flex items-center gap-2.5 rounded-inset px-2.5 py-[9px] text-start transition-colors hover:bg-inlay">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-detail", kept ? "bg-primary text-primary-foreground" : "shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]")}>
                  {kept ? <Check aria-hidden className="size-3.5" /> : null}
                </span>
                <span className={cn("flex-1 font-editorial text-[14.5px] font-medium", kept ? "text-foreground" : "text-muted-foreground line-through")}>{goal.title}</span>
                {goal.ownerName ? <span className="text-[12.5px] text-muted-foreground">{goal.ownerName}</span> : null}
              </button>
            );
          }) : <span className="px-2.5 text-sm text-muted-foreground">{t("noCompanyGoals", { name: setup.lastYearName })}</span>}
        </div>
        <div className="grid content-start gap-3.5">
          {setup.unfinishedGoals > 0 ? (
            <div className="flex items-center gap-3 rounded-inset bg-inlay px-3.5 py-3">
              <AvatarStack names={setup.unfinishedOwners.map((p) => p.name)} size="xs" max={4} />
              <span className="text-sm">
                <b className="font-semibold">{t("unfinished", { count: setup.unfinishedGoals })}</b>
                <span className="text-muted-foreground">{t("intoDrafts")}</span>
              </span>
            </div>
          ) : null}
          <SettingsLine />
        </div>
      </div>
    </Section>
  );
}

function SettingsLine() {
  const t = useTranslations("year.YearSetup");
  return (
    <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <Settings aria-hidden className="size-[15px] shrink-0" />
      <span>
        {t("settingsAsTheyAre")}{" "}
        <Link href="/settings" className="font-semibold text-primary-ink underline-offset-4 hover:underline">{t("settings")}</Link>
      </span>
    </span>
  );
}

// ── Days off: the company's work week (Core HR) and public holidays (D-92) ───────────────────────

function useDaysOff(start: string, end: string): DaysOff {
  const locale = useLocale();
  const week = useCompanyWorkWeek();
  const [all, setAll] = useState<Holiday[]>([]);
  const fromYear = Number(start.slice(0, 4));
  const toYear = Number(end.slice(0, 4));
  useEffect(() => {
    let live = true;
    // Public holidays follow Tunisia until a company records its country (B-441).
    void import("date-holidays").then(({ default: Holidays }) => {
      const calendar = new Holidays("TN", { languages: [locale.slice(0, 2), "en"] });
      const found: Holiday[] = [];
      for (let y = fromYear; y <= toYear; y++)
        for (const h of calendar.getHolidays(y)) if (h.type === "public") found.push({ date: h.date.slice(0, 10), name: h.name });
      if (live) setAll(found);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [fromYear, toYear, locale]);

  return useMemo(() => {
    const holidays = all.filter((h) => h.date >= addDays(start, -40) && h.date <= addDays(end, 40));
    const byDate = new Set(holidays.map((h) => h.date));
    const working = new Set(week.data?.workingDays?.length ? week.data.workingDays : [1, 2, 3, 4, 5]);
    const isoWeekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const isRestDay = (iso: string) => !working.has(isoWeekday(iso));
    const isOff = (iso: string) => isRestDay(iso) || byDate.has(iso);
    const nextWorkingDay = (iso: string) => {
      let next = iso;
      for (let i = 0; i < 14 && isOff(next); i++) next = addDays(next, 1);
      return next;
    };
    return { holidays, isRestDay, isOff, nextWorkingDay };
  }, [all, start, end, week.data]);
}
