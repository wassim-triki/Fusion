"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { CyclePhase, FusionWorkItem, YearDto, YearPersonDto, YearReleaseDto, YearReviewerDto, YearStanding, YearStepDto } from "@repo/api";
import { useFusionWork } from "@repo/api/query";
import { Button } from "@repo/ds/components/ui/button";
import { dateFormatter } from "@repo/ds/lib/dates";
import { Bell, Clock, FastForward } from "@repo/ds/icons";
import { AsyncButton, InPlacePreview, PageContainer, PageEmpty, PageSkeleton, PreviewRow } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { useWorkspaceContext, useYear, useYearCommands } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { movedSteps, YearTimeline, yearPosition } from "./year-timeline";
import { appHref, day, dayMonth, daysBetween, firstName } from "./year-words";
import { YearYou } from "./year-you";
import { OpenItToday, ReviewersBehind, RoundOpened, RoundOpens } from "./year-round";
import { FlowSection, StepFlow, type FlowColumn, type FlowTone } from "./step-flow";
import { LookedAt, ReleasedToday, ReleaseMoment, useReleaseRun } from "./year-release";
import { calibrationHref, newReviewRoundHref } from "@/lib/performance-routes";

const PERFORMANCE: ["performance"] = ["performance"];

/**
 * The Year page (D-33, D-44): the year as one page for everyone. Its name and dates, the timeline with today, the
 * viewer's next step hanging from today, then the phase's steps with the people in each at the viewer's reach (D-55).
 * HR moves the year on from here, previewed in place (D-58).
 */
export function YearPage() {
  const t = useTranslations("year.YearPage");
  const context = useWorkspaceContext();
  const selected = context.data?.selected ?? null;
  const administers = context.data?.capabilities.administers ?? false;
  const cycleId = selected && selected.state !== "Draft" ? selected.id : null;
  const year = useYear(cycleId);

  if (context.isLoading || (cycleId && year.isLoading)) return <PageSkeleton rows={4} label={t("loading")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (!selected || selected.state === "Draft") {
    return (
      <PageContainer>
        <PageEmpty
          headingLevel={1}
          title={selected ? t("beingSetUp", { name: selected.name }) : t("noYear")}
          description={administers ? undefined : t("noYearYet")}
          action={administers ? (
            <Button asChild>
              <Link href="/year/setup">{selected ? t("continueSetup") : t("setUpTheYear")}</Link>
            </Button>
          ) : undefined}
        />
      </PageContainer>
    );
  }
  if (year.error) return <ContentUnavailable error={year.error} onRetry={year.refetch} />;
  if (!year.data) return <PageSkeleton rows={4} label={t("loading")} />;
  return <TheYear year={year.data} refetch={year.refetch} />;
}

function TheYear({ year, refetch }: { year: YearDto; refetch: () => Promise<unknown> }) {
  const t = useTranslations("year.YearPage");
  const locale = useLocale();
  const params = useSearchParams();
  const move = year.nextMove;
  // The Calibration page's Release opens the preview here (D-72).
  const [previewing, setPreviewing] = useState(() => params.get("release") === "1" && move?.kind === "release" && move.canMove);
  const current = year.phase;
  const steps = previewing && move && current ? movedSteps(year.steps, current, year.today) : year.steps;
  const long = dateFormatter({ day: "numeric", month: "long", year: "numeric" }, locale);
  const longDay = (iso: string) => long.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
  const caretAt = yearPosition(year.startDate, year.endDate, year.today);
  // Once released, the moment stays on screen as the year moves on, until it's closed (B-433).
  const [released, setReleased] = useState<{ count: number; release: YearReleaseDto; roundId: string | null } | null>(null);

  const openPreview = async () => {
    await refetch();
    setPreviewing(true);
  };

  return (
    <PageContainer>
      <div className="grid max-w-[1120px] gap-[22px]">
        <div className="flex items-end gap-4 pt-2">
          <div className="grid gap-1">
            <h1 className="type-display text-foreground">{year.name}</h1>
            <span className="text-sm text-muted-foreground">{t("dates", { start: longDay(year.startDate), end: longDay(year.endDate) })}</span>
          </div>
          {/* A round coming up opens from its own card ("Open it today"), not from the header. */}
          {move && !previewing && !(move.kind === "launchRound" && move.canMove && move.opensOn) ? (
            <Button variant="outline" className="ms-auto" onClick={() => void openPreview()}>
              <FastForward aria-hidden className="size-4" />
              {t(`move.${move.kind}`)}
            </Button>
          ) : null}
        </div>
        <div className="-mt-2">
          <YearTimeline start={year.startDate} end={year.endDate} today={year.today} steps={steps} current={previewing && move ? move.to : current} />
        </div>
        {released ? (
          <ReleaseMoment release={released.release} affected={released.count} roundId={released.roundId} insteadOf={null} run={null}
            released={{ count: released.count, day: dayMonth(year.today, locale) }} pending={false} caret={<Caret at={caretAt} />}
            onRelease={() => undefined} onCancel={() => setReleased(null)} onDone={() => setReleased(null)} />
        ) : previewing && move ? (
          <MovePreview year={year} caretAt={caretAt} onDone={() => setPreviewing(false)}
            onReleased={(count, release, roundId) => { setReleased({ count, release, roundId }); setPreviewing(false); }} />
        ) : (
          <NextStep year={year} caretAt={caretAt} onPreview={() => void openPreview()} />
        )}
        {year.scope !== "You" && current ? <PhaseSteps year={year} phase={current} /> : null}
        {year.scope === "You" && current && year.me ? <YearYou cycleId={year.cycleId} phase={current} employeeId={year.me.employeeId} /> : null}
      </div>
    </PageContainer>
  );
}

// ── The next step, hanging from today ─────────────────────────────────────────────────────────────

interface Next {
  eyebrow: string;
  title: string;
  due?: string;
  action?: ReactNode;
  body?: ReactNode;
}

function Caret({ at, preview = false }: { at: number; preview?: boolean }) {
  return (
    <span
      aria-hidden
      className="absolute -top-[9px] size-[18px] -translate-x-1/2 rotate-45 rounded-[4px] bg-card transition-[inset-inline-start] duration-700"
      style={{ insetInlineStart: `clamp(34px, ${at * 100}%, calc(100% - 34px))`, boxShadow: preview ? "-1.5px -1.5px 0 0 var(--primary)" : undefined }}
    />
  );
}

function NextStep({ year, caretAt, onPreview }: { year: YearDto; caretAt: number; onPreview: () => void }) {
  const next = useNext(year, onPreview);
  return (
    <section aria-live="polite" className="relative grid gap-4 rounded-surface bg-card px-[26px] py-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <Caret at={caretAt} />
      <div className="flex items-start justify-between gap-[18px]">
        <div className="grid gap-2">
          <span className="text-[12.5px] text-muted-foreground">{next.eyebrow}</span>
          <h2 className="text-2xl font-semibold leading-tight tracking-[-0.01em] text-foreground">{next.title}</h2>
          {next.due ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Clock aria-hidden className="size-[15px]" />
              {next.due}
            </span>
          ) : null}
        </div>
        {next.action ? <div className="flex shrink-0 items-center gap-2.5">{next.action}</div> : null}
      </div>
      {next.body}
    </section>
  );
}

/** What the viewer does next: HR's move through the year, else their own work, else who it waits on (D-49), else nothing. */
function useNext(year: YearDto, onPreview: () => void): Next {
  const t = useTranslations("year.NextStep");
  const locale = useLocale();
  const commands = useYearCommands(year.cycleId);
  const work = useFusionWork(PERFORMANCE);
  const [nudged, setNudged] = useState<{ phase: CyclePhase | null; count: number } | null>(null);
  const [nudgedManagers, setNudgedManagers] = useState<ReadonlySet<string>>(new Set());
  const phase = year.phase;
  const step = (p: CyclePhase) => year.steps.find((s) => s.phase === p)!;
  const count = (p: CyclePhase, ...standings: YearStanding[]) =>
    step(p).groups.filter((g) => standings.includes(g.standing)).reduce((sum, g) => sum + g.count, 0);
  const planningEnd = step("Planning").end;
  const reviewStart = step("Review").start;
  const resultsStart = step("ResultsOut").start;
  const upcoming =
    phase === "Planning" ? t("plansDue", { day: day(planningEnd, locale), days: Math.max(0, daysBetween(year.today, planningEnd)) })
      : phase === "Execution" ? t("reviewsOpen", { day: day(reviewStart, locale) })
        : phase === "Review" ? t("resultsFrom", { day: day(resultsStart, locale) })
          : t("yearEnds", { name: year.name, day: day(year.endDate, locale) });
  const nothing: Next = { eyebrow: t("yourNextStep"), title: t("nothingForYou"), due: upcoming };

  const nudge = (standings: YearStanding[], label: string) => (
    <AsyncButton
      pending={commands.nudge.isLoading}
      onClick={() => void commands.nudge.mutateAsync({ standings })
        .then((result) => {
          setNudged({ phase, count: result.nudged });
          toast.success(t("nudgedToast", { count: result.nudged }));
        })
        .catch((error) => reportPerformanceFailure(error, t("nudgeFailed")))}
    >
      {label}
    </AsyncButton>
  );

  // A manager's reviews waiting on them: one nudge each, reaching the manager once (D-74).
  const nudgeManagers = (reviewers: YearReviewerDto[]) => commands.nudge.mutateAsync({ employeeIds: reviewers.flatMap((r) => r.toWritePeople.map((p) => p.employeeId)) })
    .then(() => {
      setNudgedManagers((before) => new Set([...before, ...reviewers.map((r) => r.employeeId)]));
      toast.success(reviewers.length === 1 ? t("nudgedOne", { name: firstName(reviewers[0]!.name) }) : t("nudgedManagers", { count: reviewers.length }));
    })
    .catch((error) => reportPerformanceFailure(error, t("nudgeFailed")));

  if (year.scope === "Company") {
    const move = year.nextMove;
    // The drafted round opens by itself on its day (D-74); "Open it today" launches it now.
    if (phase === "Execution" && move?.kind === "launchRound" && move.canMove && move.opensOn && move.opens) {
      const days = Math.max(0, daysBetween(year.today, move.opensOn));
      return {
        eyebrow: t("comingUp"),
        title: t("roundOpensOn", { day: day(move.opensOn, locale) }),
        due: t("inDays", { count: days }),
        action: <OpenItToday pending={commands.move.isLoading}
          onOpen={() => commands.move.mutateAsync({ expectedVersion: year.version, to: "Review" })
            .then(() => toast.success(t("roundOpened")))
            .catch((error) => reportPerformanceFailure(error, t("couldntOpen")))} />,
        body: <RoundOpens move={move} />,
      };
    }
    if (phase === "Review" && year.review) {
      const review = year.review;
      const due = t("reviewsDue", { day: day(review.managerDue, locale), count: Math.max(0, daysBetween(year.today, review.managerDue)) });
      if (review.openedOn === year.today && review.reviewed === 0)
        return { ...nothing, due: review.selfDue ? t("selfReviewsDue", { day: day(review.selfDue, locale) }) : due, body: <RoundOpened review={review} /> };
      // Flagged reviews wait on a look in calibration (D-35); the rest are ready as rated.
      if (review.toLookAt > 0)
        return {
          eyebrow: t("yourNextStep"),
          title: t("toLookAt", { count: review.toLookAt }),
          due: t("resultsFrom", { day: day(resultsStart, locale) }),
          action: <Button asChild><Link href={calibrationHref(review.roundId)}>{t("lookAtThem")}</Link></Button>,
          body: <Faces people={review.toLookAtFaces} />,
        };
      const behind = review.reviewers.filter((r) => !r.onPace && !nudgedManagers.has(r.employeeId));
      if (!behind.length && move?.kind === "release" && move.canMove && move.release)
        return {
          eyebrow: t("yourNextStep"),
          title: t("releaseResults"),
          due: t("resultsDueOut", { day: day(resultsStart, locale) }),
          action: <Button onClick={onPreview}>{t("releaseCount", { count: move.affected })}</Button>,
          body: <LookedAt release={move.release} />,
        };
      return {
        eyebrow: t("yourNextStep"),
        title: behind.length ? t("managersBehind", { count: behind.length }) : t("nothingForYou"),
        due,
        action: behind.length ? (
          <AsyncButton pending={commands.nudge.isLoading} onClick={() => void nudgeManagers(behind)}>{t("nudgeTheCount", { count: behind.length })}</AsyncButton>
        ) : undefined,
        body: <ReviewersBehind review={review} nudged={nudgedManagers} pending={commands.nudge.isLoading} onNudge={(r) => nudgeManagers([r])} />,
      };
    }
    if (nudged && nudged.phase === phase)
      return { ...nothing, body: <span className="text-sm text-muted-foreground">{t("nudgedPeople", { count: nudged.count, day: dayMonth(year.today, locale) })}</span> };
    if (phase === "Planning") {
      const notForward = count("Planning", "notStarted", "drafting", "returned");
      if (notForward > 0) return { eyebrow: t("yourNextStep"), title: t("plansNotForward", { count: notForward }), due: upcoming, action: nudge(["notStarted", "drafting", "returned"], t("nudgeThem")) };
      const waiting = count("Planning", "submitted");
      if (waiting > 0) return { eyebrow: t("yourNextStep"), title: t("plansWithManagers", { count: waiting }), due: upcoming, action: nudge(["submitted"], t("nudgeTheManagers")) };
    }
    if (phase === "Execution") {
      const quiet = count("Execution", "quiet");
      if (quiet > 0) return { eyebrow: t("yourNextStep"), title: t("notUpdated", { count: quiet }), due: upcoming, action: nudge(["quiet"], t("nudgeThem")) };
    }
    if (phase === "Review") {
      const withManagers = count("Review", "withManager");
      if (withManagers > 0) return { eyebrow: t("yourNextStep"), title: t("reviewsWithManagers", { count: withManagers }), due: upcoming, action: nudge(["withManager"], t("nudgeTheManagers")) };
      const self = count("Review", "selfReview");
      if (self > 0) return { eyebrow: t("yourNextStep"), title: t("selfReviewsLeft", { count: self }), due: upcoming, action: nudge(["selfReview"], t("nudgeThem")) };
    }
    if (phase === "ResultsOut") {
      // D-57: the year ends by itself; HR's next step is the next year.
      return {
        eyebrow: t("yourNextStep"),
        title: t("setUpNextYear"),
        due: t(year.today > year.endDate ? "ended" : "endsByItself", { name: year.name, day: day(year.endDate, locale) }),
        action: <Button asChild><Link href="/year/setup">{t("setUpNextYear")}</Link></Button>,
        body: resultsStart === year.today ? <ReleasedToday count={count("ResultsOut", "released", "acknowledged")} /> : undefined,
      };
    }
    return nothing;
  }

  const item: FusionWorkItem | undefined = work.items[0];
  if (item) {
    return {
      eyebrow: t("yourNextStep"),
      title: item.title,
      due: item.dueOn ? t("dueOn", { day: day(item.dueOn, locale) }) : item.context ?? upcoming,
      action: <Button asChild><Link href={appHref(item.href)}>{item.actionLabel ?? t("open")}</Link></Button>,
      body: item.subject ? (
        <div className="flex items-center gap-3">
          <PersonInitials name={item.subject.displayName} size="md" />
          <span className="text-sm font-semibold text-foreground">{item.subject.displayName}</span>
          {item.dueOn && item.context ? <span className="ms-auto text-sm text-muted-foreground">{item.context}</span> : null}
        </div>
      ) : undefined,
    };
  }

  const me = year.me;
  const manager = me?.managerName;
  if (me && manager && (me.standing === "submitted" || me.standing === "withManager")) {
    const first = firstName(manager);
    const done = nudged && nudged.phase === phase;
    return {
      eyebrow: t("waitingOn", { name: first }),
      title: me.standing === "submitted" ? t("planWith", { name: first }) : t("reviewWith", { name: first }),
      due: me.since ? t("since", { day: day(me.since, locale) }) : upcoming,
      action: done ? undefined : (
        <AsyncButton
          variant="outline"
          pending={commands.nudge.isLoading}
          onClick={() => void commands.nudge.mutateAsync({ employeeIds: [me.employeeId] })
            .then((result) => {
              setNudged({ phase, count: result.nudged });
              toast.success(t("nudgedOne", { name: first }));
            })
            .catch((error) => reportPerformanceFailure(error, t("nudgeFailed")))}
        >
          {t("nudgeName", { name: first })}
        </AsyncButton>
      ),
      body: (
        <div className="flex items-center gap-3">
          <PersonInitials name={manager} size="lg" />
          <div className="grid">
            <b className="text-sm font-semibold text-foreground">{manager}</b>
            <span className="text-sm text-muted-foreground">{done ? t("nudgedOne", { name: first }) : upcoming}</span>
          </div>
        </div>
      ),
    };
  }
  return nothing;
}

// ── Moving the year on, previewed in place (D-58) ─────────────────────────────────────────────────

function MovePreview({ year, caretAt, onDone, onReleased }: {
  year: YearDto;
  caretAt: number;
  onDone: () => void;
  onReleased: (count: number, release: YearReleaseDto, roundId: string | null) => void;
}) {
  const t = useTranslations("year.MovePreview");
  const locale = useLocale();
  const commands = useYearCommands(year.cycleId);
  const move = year.nextMove!;
  const step = (p: CyclePhase) => year.steps.find((s) => s.phase === p)!;
  const everyone = (...phases: CyclePhase[]) => phases.flatMap((p) => step(p).groups);
  const sum = (groups: YearStepDto["groups"]) => groups.reduce((n, g) => n + g.count, 0);
  const faces = (groups: YearStepDto["groups"]) => groups.flatMap((g) => g.people).slice(0, 3);
  const original = move.kind === "closePlanning" ? step("Planning").end : move.kind === "launchRound" ? step("Review").start : step("ResultsOut").start;
  const releasing = useReleaseRun(year, (count) => {
    toast.success(t("released", { count }));
    if (move.release) onReleased(count, move.release, move.roundId);
  });

  const confirm = () => commands.move.mutateAsync({ expectedVersion: year.version, to: move.to })
    .then(() => {
      toast.success(t(`moved.${move.kind}`));
      onDone();
    })
    .catch((error) => reportPerformanceFailure(error, t("couldntMove")));

  // Releasing is its own moment (B-433): held to confirm, counted out in the same card.
  if (move.kind === "release" && move.canMove && move.release) {
    return (
      <ReleaseMoment release={move.release} affected={move.affected} roundId={move.roundId}
        insteadOf={original !== year.today ? t("insteadOf", { day: day(original, locale) }) : null}
        run={releasing.run} released={null} pending={releasing.run !== null} caret={<Caret at={caretAt} />}
        onRelease={() => void releasing.start().catch((error) => reportPerformanceFailure(error, t("couldntMove")))}
        onCancel={onDone} onDone={onDone} />
    );
  }

  return (
    <InPlacePreview
      eyebrow={t("preview")}
      title={t(`title.${move.kind}`)}
      detail={<span className="inline-flex items-center gap-1.5"><Clock aria-hidden className="size-[15px]" />{t("insteadOf", { day: day(original, locale) })}</span>}
      actions={
        <>
          <Button variant="outline" onClick={onDone}>{t("cancel")}</Button>
          {move.canMove ? (
            <AsyncButton pending={commands.move.isLoading} onClick={() => void confirm()}>
              {t(`go.${move.kind}`, { count: move.affected })}
            </AsyncButton>
          ) : null}
        </>
      }
    >
      <Caret at={caretAt} preview />
      {!move.canMove && move.blocker ? (
        <div className="flex items-center gap-3 rounded-inset bg-inlay px-3.5 py-3 text-sm">
          <span className="text-foreground">{t(`blocker.${move.blocker}`)}</span>
          {move.blocker === "noDraftRound" ? (
            <Button asChild size="sm" variant="outline" className="ms-auto"><Link href={newReviewRoundHref()}>{t("draftTheRound")}</Link></Button>
          ) : null}
        </div>
      ) : null}
      <div>
        {move.kind === "closePlanning" ? (
          <>
            <PreviewRow label={t("everyone")} count={year.total}>{t("rows.updatesOpen")}</PreviewRow>
            <PreviewRow label={t("approvedPlans")} count={sum(everyone("Execution", "Review", "ResultsOut"))}>
              <Faces people={faces(everyone("Execution", "Review", "ResultsOut"))} />{t("rows.locked")}
            </PreviewRow>
            <PreviewRow label={t("stillWriting")} count={move.affected}>
              <Faces people={move.people.slice(0, 3)} />{t("rows.keepGoing")}
            </PreviewRow>
          </>
        ) : move.kind === "launchRound" ? (
          <>
            <PreviewRow label={t("everyoneInTheRound")} count={move.affected}>
              <Faces people={move.people.slice(0, 3)} />{t("rows.selfReviewOpens")}
            </PreviewRow>
            <PreviewRow label={t("managers")}>{t("rows.reviewsOpen")}</PreviewRow>
          </>
        ) : null}
      </div>
      {move.kind === "release" ? null : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bell aria-hidden className="size-[15px]" />
          {t("oneNotificationEach")}
        </div>
      )}
    </InPlacePreview>
  );
}

function Faces({ people }: { people: YearPersonDto[] }) {
  return people.length ? <AvatarStack names={people.map((p) => p.name)} size="md" max={3} /> : null;
}

// ── The phase's steps with the people in each (D-55, D-56) ────────────────────────────────────────

function useColumns(year: YearDto, phase: CyclePhase): FlowColumn[] {
  const t = useTranslations("year.PhaseSteps");
  const team = year.scope === "Team";
  const step = (p: CyclePhase) => year.steps.find((s) => s.phase === p)!;
  const of = (key: string, label: string, tone: FlowTone, groups: YearStepDto["groups"], here = false): FlowColumn => ({
    key, label, tone, here,
    count: groups.reduce((n, g) => n + g.count, 0),
    people: groups.flatMap((g) => g.people),
  });
  const pick = (p: CyclePhase, ...standings: YearStanding[]) => step(p).groups.filter((g) => standings.includes(g.standing));
  const all = (...phases: CyclePhase[]) => phases.flatMap((p) => step(p).groups);
  const notEmpty = (column: FlowColumn) => column.count > 0;

  if (phase === "Planning") {
    const columns = [
      of("notStarted", t("notStarted"), "mu", pick("Planning", "notStarted")),
      of("writing", t("writing"), "pr", pick("Planning", "drafting", "returned")),
      of("withManager", team ? t("withYou") : t("withTheirManager"), "pr", pick("Planning", "submitted"), team),
      of("approved", t("approved"), "ok", all("Execution", "Review", "ResultsOut")),
    ];
    // First use (D-56): everyone in the first step with their faces and the real count; the later steps outlines.
    if (year.total > 0 && columns[0]!.count === year.total) {
      const places = team ? [2, 2, 4] : [7, 6, 9];
      columns.slice(1).forEach((column, i) => (column.ghost = places[i]));
    }
    return columns;
  }
  if (phase === "Execution") {
    return [
      of("stillPlanning", t("stillPlanning"), "mu", all("Planning")),
      of("updated", t("updated"), "ok", pick("Execution", "updated")),
      of("quiet", t("quiet"), "wa", pick("Execution", "quiet")),
    ].filter((column) => column.key !== "stillPlanning" || notEmpty(column));
  }
  if (phase === "Review") {
    return [
      of("notInRound", t("notInRound"), "mu", all("Planning", "Execution")),
      of("selfReview", t("selfReview"), "mu", pick("Review", "selfReview")),
      of("withManager", team ? t("yoursToWrite") : t("withTheirManager"), "pr", pick("Review", "withManager"), team),
      of("reviewed", t("reviewed"), "ok", [...pick("Review", "reviewed"), ...all("ResultsOut")]),
      { ...of("flagged", t("flaggedForALook"), "wa", pick("Review", "flagged")), stateHead: true },
    ].filter((column) => !["notInRound", "flagged"].includes(column.key) || notEmpty(column));
  }
  return [
    of("notInRound", t("notInRound"), "mu", all("Planning", "Execution")),
    of("stillWritten", t("stillBeingWritten"), "mu", all("Review")),
    of("notRead", t("notReadYet"), "pr", pick("ResultsOut", "released")),
    of("acknowledged", t("acknowledged"), "ok", pick("ResultsOut", "acknowledged")),
    of("closed", t("closedWithoutResult"), "mu", pick("ResultsOut", "closed")),
  ].filter((column) => !["notInRound", "closed"].includes(column.key) || notEmpty(column));
}

function PhaseSteps({ year, phase }: { year: YearDto; phase: CyclePhase }) {
  const t = useTranslations("year.PhaseSteps");
  const locale = useLocale();
  const columns = useColumns(year, phase);
  const team = year.scope === "Team";
  const step = (p: CyclePhase) => year.steps.find((s) => s.phase === p)!;
  const past = (...phases: CyclePhase[]) => phases.reduce((n, p) => n + step(p).count, 0);
  const title = team ? t("yourTeam") : t(`title.${phase}`);
  const right = team ? t("people", { count: year.total })
    : phase === "Planning" ? t("putForward", { count: step("Planning").groups.filter((g) => g.standing === "submitted").reduce((n, g) => n + g.count, 0) + past("Execution", "Review", "ResultsOut"), total: year.total })
      : phase === "Execution" ? t("people", { count: year.total })
        : phase === "Review" ? t("reviewedOf", { count: columns.find((c) => c.key === "reviewed")?.count ?? 0, total: year.total })
          : t("released", { day: dayMonth(step("ResultsOut").start, locale) });

  return (
    <FlowSection title={title} right={right}>
      <StepFlow columns={columns} total={year.total} named={team} />
    </FlowSection>
  );
}

