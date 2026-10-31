"use client";

import { Said } from "@repo/ds/shell";
import type { GoalNodeDto, OverviewRow as Row, UnitShareDto } from "@repo/api";
import Link from "next/link";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials } from "@repo/performance-ui";
import { Check, ChevronRight } from "@/lib/icons";
import { useOneOnOnes } from "../../api/use-conversations";
import { calibrationHref, roundHref, withCycle } from "@/lib/performance-routes";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { LaunchReadiness } from "../launch-readiness";
import { deriveSetupState, earliestIncompleteStep, setupStepHref } from "../cycle-setup/setup-readiness";
import { ago, appHref, day, daysFrom, firstName, planWord, reviewChip } from "./overview-model";
import {
  Chips,
  Facts,
  Headline,
  MiniItem,
  MiniList,
  N,
  OverviewRow,
  ProgressLine,
  RowAction,
  SegmentBar,
  StepsStrip,
  type Tone,
} from "./overview-primitives";
import { dateFormatter } from "@repo/ds/lib/dates";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";

const insights = (cycleId: string, unitId?: string | null) =>
  withCycle(`/cycle?view=insights${unitId ? `&unit=${unitId}` : ""}`, cycleId);

function UnitsBehind({ units, cycleId, describe }: { units: UnitShareDto[]; cycleId: string; describe: (u: UnitShareDto) => string }) {
  const t = useTranslations("overview.UnitsBehind");
  if (units.length === 0) return null;
  return (
    <>
      <p className="mt-5 type-meta text-muted-foreground">{t("furthestBehind")}</p>
      <MiniList label={t("unitsFurthestBehind")}>
        {units.map((u) => (
          <MiniItem
            key={u.unitId ?? u.name}
            href={insights(cycleId, u.unitId)}
            title={u.name}
            sub={describe(u)}
            trailing={<ProgressLine value={u.total ? (u.count / u.total) * 100 : 0} has className="hidden w-44 sm:flex" />}
          />
        ))}
      </MiniList>
    </>
  );
}

// ── Administration ────────────────────────────────────────────────────────────────────────────────────────────────

export function NextCycleRow({ row }: { row: Row<"nextCycle"> }) {
  const format = useFormat();
  const t = useTranslations("overview.NextCycleRow");
  if (!row.cycleId || !row.setup) {
    return (
      <OverviewRow label={t("nextCycle")}>
        <Headline tone="attention" action={<RowAction href="/cycle/setup/details" primary>{t("createTheNextCycle")}</RowAction>}>
          {t("noNextCycleYet")}
        </Headline>
      </OverviewRow>
    );
  }
  const state = deriveSetupState(row.setup);
  const next = setupStepHref(earliestIncompleteStep(state), row.cycleId);
  // Ready to launch: the decision is activation, and the checklist has nothing left to say.
  const ready = state.readyToLaunch;
  const startPassed = row.plannedStart !== null && daysFrom(row.plannedStart) <= 0;
  return (
    <OverviewRow label={t("nextCycle")} sub={t("draft", { name: row.name ?? "" })} link={{ href: withCycle("/cycle/setup", row.cycleId), label: t("cycle") }}>
      <Headline tone="attention" action={<RowAction href={next} primary>{ready ? t("reviewAndActivate") : t("continueSetup")}</RowAction>}>
        {ready ? t("isReadyToActivate", { name: row.name ?? "" }) : t("setUp", { name: row.name ?? "" })}
      </Headline>
      {row.plannedStart ? (
        <Facts facts={[startPassed
          ? { label: t("plannedStartHasPassed", { plannedStart: day(row.plannedStart, format.locale) }), tone: "attention" }
          : { label: t("plannedStart", { plannedStart: day(row.plannedStart, format.locale) }) }]} />
      ) : null}
      {ready ? null : (
        <div className="mt-4 max-w-3xl">
          <LaunchReadiness readiness={row.setup.launchReadiness} />
        </div>
      )}
    </OverviewRow>
  );
}

export function CycleRow({ row }: { row: Row<"cycle"> }) {
  const format = useFormat();
  const t = useTranslations("overview.CycleRow");
  const link = { href: insights(row.cycleId), label: t("insights") };
  if (row.setup) {
    const next = setupStepHref(earliestIncompleteStep(deriveSetupState(row.setup)));
    return (
      <OverviewRow label={t("setup", { cycleName: row.cycleName })} sub={t("draft")} link={{ href: withCycle("/cycle/setup", row.cycleId), label: t("cycle") }}>
        <Headline tone="attention" action={<RowAction href={next} primary>{t("continueSetup")}</RowAction>}>{t("isBeingSetUp", { cycleName: row.cycleName })}</Headline>
        <div className="mt-4 max-w-3xl">
          <LaunchReadiness readiness={row.setup.launchReadiness} />
        </div>
        <Facts facts={[{ label: t("onlyAdministratorsSeeUntilYou", { cycleName: row.cycleName }) }]} />
      </OverviewRow>
    );
  }

  if (row.review) {
    const r = row.review;
    const calibrationOpen = r.calibrationEnabled && r.calibrationState === "Open";
    const steps = [
      { label: t("selfAssessments"), detail: t("of", { selfSubmitted: r.selfSubmitted, selfTotal: r.selfTotal }), state: r.selfSubmitted >= r.selfTotal ? "done" : "current" },
      {
        label: t("managerReviews"),
        detail: (r.managerLate ? t("ofLate", { managerSubmitted: r.managerSubmitted, managerTotal: r.managerTotal, managerLate: r.managerLate }) : t("of2", { managerSubmitted: r.managerSubmitted, managerTotal: r.managerTotal })),
        state: r.managerSubmitted >= r.managerTotal ? "done" : r.selfSubmitted >= r.selfTotal ? "current" : "upcoming",
      },
      ...(r.calibrationEnabled
        ? [{ label: t("calibration"), detail: r.calibrationState ? t("discussed", { calibrationDiscussed: r.calibrationDiscussed }) : t("notOpen"), state: calibrationOpen ? "current" : r.calibrationState === "Finalized" ? "done" : "upcoming" }]
        : []),
      { label: t("release"), detail: t("byYou"), state: r.readyToFinalize > 0 && r.readyToFinalize === r.subjects ? "current" : "upcoming" },
    ] as { label: string; detail: string; state: "done" | "current" | "upcoming" }[];
    return (
      <OverviewRow label={r.roundName} sub={t("personCount", { count: r.subjects })} link={{ href: withCycle(roundHref(r.roundId), row.cycleId), label: t("openTheRound") }}>
        <Headline
          tone="attention"
          action={
            calibrationOpen ? (
              <RowAction href={calibrationHref(r.roundId)} primary>{t("openCalibration")}</RowAction>
            ) : (
              <RowAction href={roundHref(r.roundId)}>{t("openTheRound")}</RowAction>
            )
          }
        >
          {calibrationOpen
            ? t("calibrationIsOpenOfDiscussed", { calibrationDiscussed: r.calibrationDiscussed, calibrationSubjects: r.calibrationSubjects })
            : t("managerReviewsOfIn", { managerSubmitted: r.managerSubmitted, managerTotal: r.managerTotal })}
        </Headline>
        {calibrationOpen && r.managerSubmitted < r.managerTotal ? (
          <p className="mt-1 type-body-secondary text-muted-foreground">{t("finalizeWhenTheLastManager")}</p>
        ) : null}
        <StepsStrip steps={steps} />
        {r.lateManagers.length > 0 ? (
          <>
            <p className="mt-5 type-meta text-muted-foreground">{t("mostLateManagerReviews")}</p>
            <MiniList label={t("mostLateManagerReviews")}>
              {r.lateManagers.map((m) => (
                <MiniItem
                  key={m.employeeId}
                  href={insights(row.cycleId)}
                  title={m.name}
                  sub={t("ofIn", { value: m.unitName ? `${m.unitName} · ` : "", submitted: m.submitted, total: m.total })}
                  trailing={<span className="type-meta text-warning">{t("late", { late: m.late })}</span>}
                />
              ))}
              {r.otherLateManagers > 0 ? (
                <MiniItem href={insights(row.cycleId)} title={`${t("otherManagerCount", { count: r.otherLateManagers })}`} sub={t("lateInAll", { otherLate: r.otherLate })} />
              ) : null}
            </MiniList>
          </>
        ) : null}
      </OverviewRow>
    );
  }

  if (row.closed) {
    const c = row.closed;
    return (
      <OverviewRow label={row.cycleName} sub={t("closed")} link={link}>
        <Headline action={<RowAction href={withCycle("/cycle", row.cycleId)}>{t("closureRecord")}</RowAction>}>
          <span className="type-metric tabular-nums">{c.acknowledged}</span>{" "}
          <span className="text-muted-foreground">{t("ofAcknowledged", { released: t("resultCount", { count: c.released }) })}</span>
        </Headline>
        <Facts
          facts={[
            { label: <><N>{c.released}</N> {t("resultsReleased")}{c.releasedAt ? ` ${day(c.releasedAt, format.locale)}` : ""}</> },
            { label: <><N>{c.calibrationChanged}</N> {t("ratingsChangedInCalibration")}</> },
            { label: <><N>{c.openGrowthGoals}</N> {t("openGrowthGoals")}</> },
          ]}
        />
      </OverviewRow>
    );
  }

  if (row.execution) {
    const e = row.execution;
    return (
      <OverviewRow label={row.cycleName} sub={t("ofApproved", { approvedPlans: row.approvedPlans, participants: t("planCount", { count: row.participants }) })} link={link}>
        <Headline action={<RowAction href={withCycle("/cycle", row.cycleId)}>{t("openTheCycle")}</RowAction>}>
          <span className="type-metric tabular-nums">{e.updatedIn30Days}</span>{" "}
          <span className="text-muted-foreground">{t("ofApprovedPlansUpdatedIn", { approvedPlans: e.approvedPlans })}</span>
        </Headline>
        <p className="mt-4 type-meta text-muted-foreground">{t("objectiveStatusAsTheirOwners", { objectives: t("objectiveCount", { count: e.objectives }) })}</p>
        <SegmentBar
          label={t("objectiveStatus")}
          segments={[
            { count: e.status.onTrack, className: "bg-success" },
            { count: e.status.atRisk, className: "bg-warning" },
            { count: e.status.offTrack, className: "bg-destructive" },
            { count: e.status.noStatus, className: "bg-inlay ring-1 ring-inset ring-border" },
          ]}
        />
        <Facts
          facts={[
            { label: <><N>{e.status.onTrack}</N> {t("onTrack")}</>, tone: "ok" },
            { label: <><N>{e.status.atRisk}</N> {t("atRisk")}</>, tone: "risk" },
            { label: <><N>{e.status.offTrack}</N> {t("offTrack")}</>, tone: "off" },
            { label: <><N>{e.status.noStatus}</N> {t("noStatusYet")}</> },
            e.neverApproved > 0 && { label: <><N>{e.neverApproved}</N> {t("plansNeverApproved")}</> },
          ]}
        />
        <UnitsBehind units={e.furthestBehind} cycleId={row.cycleId} describe={(u) => t("ofUpdatedNot", { count: u.count, total: u.total, missing: u.missing })} />
      </OverviewRow>
    );
  }

  const p = row.planning!;
  return (
    <OverviewRow label={row.cycleName} sub={t("personCount", { count: row.participants })} link={link}>
      <Headline action={<RowAction href={withCycle("/cycle", row.cycleId)}>{t("openTheCycle")}</RowAction>}>
        <span className="type-metric tabular-nums">{p.plans.approved}</span>{" "}
        <span className="text-muted-foreground">{t("ofApproved2", { participants: t("planCount", { count: row.participants }) })}</span>
      </Headline>
      <SegmentBar
        label={t("planStates")}
        segments={[
          { count: p.plans.approved, className: "bg-success" },
          { count: p.plans.submitted, className: "bg-primary" },
          { count: p.plans.drafting, className: "bg-muted-foreground/60" },
          { count: p.plans.notStarted, className: "bg-inlay ring-1 ring-inset ring-border" },
        ]}
      />
      <Facts
        facts={[
          { label: <><N>{p.plans.approved}</N> {t("approved")}</>, tone: "ok" },
          { label: <><N>{p.plans.submitted}</N> {t("submitted")}</>, tone: "attention" },
          { label: <><N>{p.plans.drafting}</N> {t("drafting")}</> },
          { label: <><N>{p.plans.notStarted}</N> {t("notStarted")}</> },
        ]}
      />
      <UnitsBehind units={p.furthestBehind} cycleId={row.cycleId} describe={(u) => t("ofApprovedNotStarted", { count: u.count, total: u.total, missing: u.missing })} />
    </OverviewRow>
  );
}

// ── Responsibility ────────────────────────────────────────────────────────────────────────────────────────────────

export function TeamRow({ row, cycleId, quietAfterReviews }: { row: Row<"team">; cycleId: string; quietAfterReviews?: boolean }) {
  const format = useFormat();
  const t = useTranslations("overview.TeamRow");
  const model = useSay("overview.model");
  const link = { href: withCycle("/team", cycleId), label: t("myTeam") };
  const sub = [t("personCount", { count: row.people }), row.objectives ? t("objectiveCount", { count: row.objectives }) : null].filter(Boolean).join(" · ");
  const recency = [
    row.approvedPlans > 0 && { label: <><N>{row.updatedIn30Days}</N> {t("ofUpdatedInTheLast", { approvedPlans: row.approvedPlans })}</> },
    row.withoutRecentUpdateTotal > 0 && {
      label: <>{t("noUpdateIn30Days")} <N>{row.withoutRecentUpdate.join(", ")}{row.withoutRecentUpdateTotal > row.withoutRecentUpdate.length ? " " + t("andMore", { value: row.withoutRecentUpdateTotal - row.withoutRecentUpdate.length }) : ""}</N></>,
      tone: "attention" as Tone,
    },
    row.openRequests > 0 && { label: <><N>{row.openRequests}</N> {row.openRequests === 1 ? t("updateRequest") : t("updateRequests")} {t("open")}</> },
  ];

  if (row.results) {
    const r = row.results;
    return (
      <OverviewRow label={t("yourTeam")} sub={sub} link={link}>
        <Headline tone="ok" action={<RowAction href={withCycle("/team", cycleId)}>{t("openMyTeam")}</RowAction>}>
          {t("resultsAreOutForYour", { released: t("personCount", { count: r.released }) })}
        </Headline>
        <p className="mt-1 type-body-secondary text-muted-foreground">
          {t("acknowledged", { acknowledged: r.acknowledged })}
          {r.notAcknowledged.length > 0 ? " " + t("notYet", { join: r.notAcknowledged.join(", ") }) : ""}
        </p>
        <Facts
          facts={[
            { label: <><N>{r.calibrationChanged}</N> {r.calibrationChanged === 1 ? t("ratingChanged") : t("ratingsChanged")} {t("inCalibration")}</> },
            { label: <><N>{r.withOpenGrowthGoals}</N> {t("ofHaveOpenGrowthGoals", { released: r.released })}</> },
          ]}
        />
      </OverviewRow>
    );
  }

  if (row.awaitingDecision > 0 && row.firstAwaitingHref) {
    return (
      <OverviewRow label={t("yourTeam")} sub={sub} link={link}>
        <Headline tone="attention" action={<RowAction href={row.firstAwaitingHref} primary>{t("reviewSPlan", { firstAwaitingName: firstName(row.firstAwaitingName) })}</RowAction>}>
          {row.awaitingDecision === 1 ? t("n1PlanWaitsForYour") : t("plansWaitForYourDecision", { awaitingDecision: row.awaitingDecision })}
        </Headline>
        <Chips chips={row.chips} word={(chip) => (chip.state === "Submitted" && chip.since ? t("submitted", { since: ago(chip.since, undefined, model) }) : planWord(chip.state, model))} />
      </OverviewRow>
    );
  }

  if (row.flaggedTotal > 0) {
    const only = row.flagged[0]!;
    return (
      <OverviewRow label={t("yourTeam")} sub={sub} link={link}>
        <Headline tone={only.status === "OffTrack" ? "off" : "attention"} action={<RowAction href={withCycle("/team", cycleId)} primary>{t("openMyTeam")}</RowAction>}>
          {row.flaggedTotal === 1
            ? (only.status === "OffTrack" ? t("sObjectiveIsOffTrack", { personName: only.personName }) : t("sObjectiveIsAtRisk", { personName: only.personName }))
            : t("objectivesAreOffTrackOr", { flaggedTotal: row.flaggedTotal })}
        </Headline>
        <MiniList label={t("objectivesOffTrackOrAt")}>
          {row.flagged.map((f) => (
            <MiniItem
              key={f.objectiveId}
              href={f.href}
              title={<>{f.personName} · {f.title}</>}
              sub={<>{f.reason ? `"${f.reason}"` : t("noReasonGiven")}{f.since ? " " + t("since", { since: day(f.since, format.locale) }) : ""}</>}
              trailing={
                <span className="hidden items-center gap-4 sm:flex">
                  <span className={cn("inline-flex items-center gap-1.5 type-meta", f.status === "OffTrack" ? "text-destructive" : "text-warning")}>
                    <span className={cn("size-2 rounded-full", f.status === "OffTrack" ? "bg-destructive" : "bg-warning")} aria-hidden />
                    {f.status === "OffTrack" ? t("offTrack") : t("atRisk")}
                  </span>
                  <ProgressLine value={f.progress} has className="w-36" />
                </span>
              }
            />
          ))}
        </MiniList>
        <Facts facts={recency} />
      </OverviewRow>
    );
  }

  if (quietAfterReviews) {
    return (
      <OverviewRow label={t("yourTeam")} link={link}>
        <Headline>{t("objectivesClose", { cycleEnd: day(row.cycleEnd, format.locale) })}</Headline>
        <Facts facts={recency} />
      </OverviewRow>
    );
  }

  const planning = row.plans.approved < row.people;
  return (
    <OverviewRow label={t("yourTeam")} sub={sub} link={link}>
      <Headline tone={planning ? "quiet" : "ok"}>
        {planning ? t("ofApproved", { approved: row.plans.approved, people: t("planCount", { count: row.people }) }) : t("nothingOnYourTeamNeeds")}
      </Headline>
      {planning ? (
        <Chips chips={row.chips} word={(chip) => planWord(chip.state, model)} />
      ) : (
        <Facts facts={recency} />
      )}
    </OverviewRow>
  );
}

export function ReviewsYouWriteRow({ row }: { row: Row<"reviewsYouWrite"> }) {
  const format = useFormat();
  const t = useTranslations("overview.ReviewsYouWriteRow");
  const model = useSay("overview.model");
  const link = { href: "/reviews", label: t("reviews") };
  const sub = row.dueDate ? t("due", { dueDate: day(row.dueDate, format.locale) }) : row.roundName;
  if (row.inCalibration) {
    return (
      <OverviewRow label={t("reviewsYouWrite")} link={link}>
        <Headline tone="ok">{t("allSubmitted", { total: row.total })}</Headline>
        <p className="mt-1 type-body-secondary text-muted-foreground">{t("inCalibration")}</p>
      </OverviewRow>
    );
  }
  return (
    <OverviewRow label={t("reviewsYouWrite")} sub={sub} link={link}>
      <Headline
        tone={row.ready > 0 ? "attention" : row.total > 0 && row.submitted === row.total ? "ok" : "quiet"}
        action={row.firstReadyHref ? <RowAction href={row.firstReadyHref} primary>{t("review", { firstReadyName: firstName(row.firstReadyName) })}</RowAction> : undefined}
      >
        {row.ready > 0
          ? row.ready === 1 ? t("n1ReviewIsReadyFor") : t("reviewsAreReadyForYou", { ready: row.ready })
          : row.total > 0 && row.submitted === row.total ? t("allSubmitted", { total: row.total }) : t("ofSubmitted", { submitted: row.submitted, total: row.total })}
      </Headline>
      <Chips chips={row.chips} word={(chip) => reviewChip(chip.state, model)} />
      <Facts
        facts={[
          row.peerListsToApprove > 0 && {
            label: <><N>{row.peerListsToApprove}</N> {row.peerListsToApprove === 1 ? t("peerList") : t("peerLists")} {t("toApprove")}{row.peerListsDue ? t("by", { peerListsDue: day(row.peerListsDue, format.locale) }) : ""}</>,
            tone: "attention" as Tone,
          },
          // The count is the headline unless reviews are waiting.
          row.ready > 0 && { label: <><N>{row.submitted}</N> {t("ofSubmitted2", { total: row.total })}</> },
        ]}
      />
    </OverviewRow>
  );
}

// ── One's own ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function OwnReviewRow({ row, own }: { row: Row<"ownReview">; own?: boolean }) {
  const format = useFormat();
  const t = useTranslations("overview.OwnReviewRow");
  const model = useSay("overview.model");
  const label = own ? t("yourOwnReview") : row.result ? t("yourResult") : t("yourReview");
  const link = { href: "/reviews", label: t("reviews") };
  if (row.result) {
    const r = row.result;
    return (
      <OverviewRow label={label} sub={row.roundName} link={link}>
        <Headline
          action={
            r.acknowledgedAt ? <RowAction href={row.href}>{t("readYourReview")}</RowAction> : <RowAction href={row.href} primary>{t("readAndAcknowledge")}</RowAction>
          }
        >
          <span className="inline-flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-detail bg-primary/15 type-panel-title text-primary ring-1 ring-inset ring-primary/50">{r.level}</span>
            {r.label}
          </span>
        </Headline>
        <p className="mt-2 type-body-secondary text-muted-foreground">
          {t("released", { releasedAt: day(r.releasedAt, format.locale) })} {r.acknowledgedAt ? t("youAcknowledgedItOn", { acknowledgedAt: day(r.acknowledgedAt, format.locale) }) : t("notAcknowledgedYet")}
        </p>
      </OverviewRow>
    );
  }
  if (row.state === "SelfAssessment" && row.steps) {
    return (
      <OverviewRow label={label} sub={row.roundName} link={own ? undefined : link}>
        <Headline tone="attention" action={<RowAction href={row.href} primary={!own}>{t("continueWriting")}</RowAction>}>
          {row.dueDate ? t("yourSelfAssessmentIsDue", { dueDate: day(row.dueDate, format.locale) }) : t("writeYourSelfAssessment")}
        </Headline>
        <p className="mt-1 type-body-secondary text-muted-foreground">
          {[row.draftSavedAt ? t("draftSaved", { draftSavedAt: ago(row.draftSavedAt, undefined, model) }) : null,
            row.peersAsked > 0 ? t("ofColleaguesHaveSharedTheir", { peersAnswered: row.peersAnswered, peersAsked: row.peersAsked }) : null].filter(Boolean).join(" · ") || t("notStarted")}
        </p>
        <StepsStrip steps={row.steps} />
      </OverviewRow>
    );
  }
  return (
    <OverviewRow label={label} sub={row.roundName} link={link}>
      <Headline tone="attention">{t("with", { reviewerName: row.reviewerName })}</Headline>
      <p className="mt-1 type-body-secondary text-muted-foreground">
        {row.selfSubmittedAt ? t("yourSelfAssessmentWentIn", { selfSubmittedAt: day(row.selfSubmittedAt, format.locale) }) : t("yourReviewIsWithYour")}
        {row.dueDate ? " " + t("theirReviewIsDue", { dueDate: day(row.dueDate, format.locale) }) : ""}
      </p>
    </OverviewRow>
  );
}

export function InputOwedRow({ row }: { row: Row<"inputOwed"> }) {
  const format = useFormat();
  const t = useTranslations("overview.InputOwedRow");
  const first = row.requests[0]!;
  return (
    <OverviewRow label={t("inputYouOwe")}>
      <Headline tone="attention" action={<RowAction href={first.href}>{t("answer")}</RowAction>}>
        {t("askedForYourInput", { subjectName: first.subjectName })}
      </Headline>
      <p className="mt-1 type-body-secondary text-muted-foreground">
        {[first.questions ? t("questionCount", { count: first.questions }) : null, first.dueDate ? t("due", { dueDate: day(first.dueDate, format.locale) }) : null,
          t("onlySManagerAndHr", { subjectName: firstName(first.subjectName) })].filter(Boolean).join(" · ")}
      </p>
      {row.requests.length > 1 ? <Facts facts={[{ label: t("inReviews", { plural: t("moreRequestCount", { count: row.requests.length - 1 }) }) }]} /> : null}
    </OverviewRow>
  );
}

export function OwnPlanRow({ row }: { row: Row<"ownPlan"> }) {
  const format = useFormat();
  const t = useTranslations("overview.OwnPlanRow");
  const model = useSay("overview.model");
  const link = { href: row.href, label: t("myPlan") };
  if (row.openRequests > 0 && row.firstRequestHref) {
    return (
      <OverviewRow label={t("yourPlan")} link={link}>
        <Headline tone="attention" action={<RowAction href={row.firstRequestHref} primary>{t("recordProgress")}</RowAction>}>
          {t("askedForAnUpdate", { firstRequestBy: row.firstRequestBy ?? "" })}
        </Headline>
        <p className="mt-1 type-body-secondary text-muted-foreground">
          {row.firstRequestObjective ?? t("onYourPlan")}
          {row.openRequests > 1 ? ` · ${t("moreRequestCount", { count: row.openRequests - 1 })}` : ""}
        </p>
      </OverviewRow>
    );
  }

  if (row.standing === "Approved") {
    const status = row.status!;
    const parts = [status.onTrack && t("onTrack2", { onTrack: status.onTrack }), status.atRisk && t("atRisk2", { atRisk: status.atRisk }), status.offTrack && t("offTrack2", { offTrack: status.offTrack })]
      .filter(Boolean).join(", ");
    if (row.staleObjectives > 0) {
      return (
        <OverviewRow label={t("yourPlan")} link={link}>
          <Headline tone="attention" action={<RowAction href={row.href}>{t("recordProgress")}</RowAction>}>
            {row.staleObjectives === 1 ? t("n1Objective") : t("objectives", { staleObjectives: row.staleObjectives })} {t("lastUpdatedDaysAgo", { stalestDays: row.stalestDays ?? "" })}
          </Headline>
          <Facts
            facts={[
              { label: t("objectiveCount", { count: row.objectives }) },
              row.progress !== null && { label: <>{t("plan")} <N>{Math.round(row.progress)}%</N></> },
              status.onTrack > 0 && { label: <><N>{status.onTrack}</N> {t("onTrack")}</>, tone: "ok" },
              status.atRisk > 0 && { label: <><N>{status.atRisk}</N> {t("atRisk")}</>, tone: "risk" },
              status.offTrack > 0 && { label: <><N>{status.offTrack}</N> {t("offTrack")}</>, tone: "off" },
            ]}
          />
        </OverviewRow>
      );
    }
    return (
      <OverviewRow label={t("yourPlan")} link={link}>
        <Headline tone={status.offTrack ? "off" : status.atRisk ? "risk" : "ok"}>
          {parts || t("objectiveCount", { count: row.objectives })}{row.progress !== null ? ` · ${Math.round(row.progress)}%` : ""}
        </Headline>
        <p className="mt-1 type-body-secondary text-muted-foreground">
          {row.lastUpdateAt ? t("lastUpdate", { lastUpdateAt: ago(row.lastUpdateAt, undefined, model) }) : t("noUpdateYet")}
        </p>
      </OverviewRow>
    );
  }

  if (row.standing === "Submitted") {
    return (
      <OverviewRow label={t("yourPlan")} link={link}>
        <Headline tone="attention">{t("submittedWaitingFor")} {row.reviewerName ?? t("yourReviewer")}</Headline>
        <p className="mt-1 type-body-secondary text-muted-foreground">
          {t("objectiveCount", { count: row.objectives })}{row.submittedAt ? " " + t("submitted", { submittedAt: day(row.submittedAt, format.locale) }) : ""}
        </p>
      </OverviewRow>
    );
  }

  if (row.standing === "ReturnedForChanges") {
    return (
      <OverviewRow label={t("yourPlan")} link={link}>
        <Headline tone="attention" action={<RowAction href={row.href} primary>{t("reviseYourPlan")}</RowAction>}>
          {row.returnedBy ? t("askedForChanges", { returnedBy: row.returnedBy }) : t("yourPlanCameBackWith")}
        </Headline>
        {row.returnFeedback ? <Said className="mt-2 max-w-2xl text-foreground/90">{row.returnFeedback}</Said> : null}
      </OverviewRow>
    );
  }

  const draft = row.standing === "Draft";
  const range = row.minObjectives && row.maxObjectives ? t("toObjectivesSuggested", { minObjectives: row.minObjectives, maxObjectives: row.maxObjectives }) : null;
  return (
    <OverviewRow label={t("yourPlan")} sub={row.planningOpen ? t("due", { planningDeadline: day(row.planningDeadline, format.locale) }) : undefined} link={link}>
      <Headline tone="attention" action={<RowAction href={row.href} primary>{draft ? t("continueYourPlan") : t("startYourPlan")}</RowAction>}>
        {draft ? t("yourPlanIsADraft") : t("writeYourPlan")}
      </Headline>
      {draft ? (
        <Facts
          facts={[
            {
              label: row.objectives ? t("objectivesAligned", { count: row.objectives, aligned: row.alignedObjectives === row.objectives ? (row.objectives === 2 ? t("both") : t("all")) : row.alignedObjectives }) : t("objectiveCount", { count: row.objectives }),
              tone: row.objectives > 0 && row.alignedObjectives === row.objectives ? "ok" : undefined,
            },
            { label: <>{t("weightsAt")} <N>{Math.round(row.weightTotal)}</N> {t("of100")}</>, tone: Math.round(row.weightTotal) === 100 ? "ok" : "attention" },
            range ? { label: range } : null,
          ]}
        />
      ) : range ? (
        <Facts facts={[{ label: range }]} />
      ) : null}
    </OverviewRow>
  );
}

export function DevelopmentRow({ row }: { row: Row<"development"> }) {
  const format = useFormat();
  const t = useTranslations("overview.DevelopmentRow");
  return (
    <OverviewRow label={t("development")} sub={t("goalCount", { count: row.total })} link={{ href: row.href, label: t("myPlan") }}>
      <Headline tone={row.open > 0 ? "attention" : "ok"} action={<RowAction href={row.href}>{t("openDevelopment")}</RowAction>}>
        {row.open === 0 ? t("everyGrowthGoalIsDone") : row.open === 1 ? t("n1GrowthGoalIsStill") : t("growthGoalsAreStillOpen", { open: row.open })}
      </Headline>
      {row.open > 0 ? <p className="mt-1 type-body-secondary text-muted-foreground">{t("openGoalsCanCarryInto")}</p> : null}
      <MiniList label={t("growthGoals")}>
        {row.goals.map((g) => (
          <MiniItem
            key={g.id}
            href={row.href}
            title={g.title}
            sub={`${g.status === "Done" ? t("done") : g.status === "InProgress" ? t("inProgress") : t("notStarted")}${g.targetDate ? ` · ${t("target", { day: day(g.targetDate, format.locale) })}` : ""}`}
            trailing={
              <span className={cn("hidden items-center gap-1.5 type-meta sm:inline-flex", g.status === "Done" ? "text-success" : g.status === "InProgress" ? "text-primary" : "text-muted-foreground")}>
                <span className={cn("size-2 rounded-full", g.status === "Done" ? "bg-success" : g.status === "InProgress" ? "bg-primary" : "bg-muted-foreground")} aria-hidden />
                {g.status === "Done" ? t("done") : g.status === "InProgress" ? t("inProgress") : t("notStarted")}
              </span>
            }
          />
        ))}
      </MiniList>
    </OverviewRow>
  );
}

const WEEKDAY = dateFormatter({ weekday: "short" });
const TIME = dateFormatter({ hour: "2-digit", minute: "2-digit" });

export function ConversationsRow({ row }: { row: Row<"conversations"> }) {
  const format = useFormat();
  const t = useTranslations("overview.ConversationsRow");
  const soon = row.meetings[0] ? daysFrom(row.meetings[0].at) : null;
  return (
    <OverviewRow label={t("conversations")} sub={soon !== null && soon >= 0 && soon <= 7 ? t("thisWeek") : undefined} link={{ href: "/one-on-ones", label: "1:1s" }}>
      <div className="grid gap-6 sm:grid-cols-2">
        {row.meetings.map((m, index) => {
          const days = daysFrom(m.at);
          // A meeting stays the series' next until it's completed, so a passed one is overdue rather than gone.
          const overdue = days < 0;
          return (
            <Link key={m.seriesId} href={appHref(m.href)} className="flex items-center gap-4 rounded-control transition-colors hover:bg-card">
              <span className={cn("grid w-14 shrink-0 place-items-center rounded-inset py-1.5 ring-1 ring-inset",
                overdue ? "bg-destructive/10 text-destructive ring-destructive/40"
                  : index === 0 ? "bg-primary/10 text-primary ring-primary/40" : "bg-inlay text-muted-foreground ring-border")}>
                <span className="type-eyebrow">{WEEKDAY.format(new Date(m.at))}</span>
                <span className="type-panel-title tabular-nums">{TIME.format(new Date(m.at))}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate type-label text-foreground">{t("n11With", { with: m.with })}</span>
                <span className="block truncate type-meta text-muted-foreground">
                  {[overdue ? t("overdueSince", { day: day(m.at.slice(0, 10), format.locale) }) : days === 0 ? t("today") : days === 1 ? t("tomorrow") : t("inDays", { days }),
                    m.agenda ? t("onTheAgenda", { agenda: m.agenda }) : null, m.openActions ? t("openActionCount", { count: m.openActions }) : null].filter(Boolean).join(" · ")}
                </span>
              </span>
            </Link>
          );
        })}
        {row.owed ? (
          <div className="flex items-center gap-4">
            <span className="min-w-0 flex-1">
              <span className="block type-label text-foreground">
                {row.owed.kind === "feedback-request" ? t("askedForYourFeedback", { title: row.owed.title }) : (row.owed.count === 1 ? t("isOverdue", { count: t("actionItemCount", { count: row.owed.count }) }) : t("areOverdue", { count: t("actionItemCount", { count: row.owed.count }) }))}
              </span>
              <span className="block truncate type-meta text-muted-foreground">
                {row.owed.kind === "feedback-request"
                  ? `${row.owed.context ?? ""}${row.owed.due ? ` · ${t("due", { day: day(row.owed.due, format.locale) })}` : ""}`
                  : `${row.owed.title}${row.owed.due ? ` · ${t("wasDue", { day: day(row.owed.due, format.locale) })}` : ""}`}
              </span>
            </span>
            <RowAction href={row.owed.href}>{row.owed.kind === "feedback-request" ? t("answer") : t("openThe11")}</RowAction>
          </div>
        ) : null}
      </div>
    </OverviewRow>
  );
}

/** Company direction this cycle executes, each objective opening in its record. */
export function DirectionRow({ row, cycleId }: { row: Row<"direction">; cycleId: string }) {
  const t = useTranslations("overview.DirectionRow");
  const record = useObjectiveRecord();
  return (
    <OverviewRow
      label={t("organizationDirection")}
      sub={row.final ? t("finalResults") : t("companyObjectiveCount", { count: row.count })}
      link={{ href: withCycle("/goals", cycleId), label: t("openTheMap") }}
    >
      {/* Unframed like every other row; a track only once the objective has measured progress. */}
      <ul className="divide-y divide-border">
        {row.objectives.map((node: GoalNodeDto) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => record.open({ cycleId, objectiveId: node.id })}
              className="group flex w-full items-center gap-4 rounded-control py-3 text-start transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate type-label text-foreground">{node.title}</span>
                <span className="block truncate type-meta text-muted-foreground">
                  {t("alignedObjectiveCount", { count: node.childCount })}{node.accountablePersonName ? t("ownedBy", { accountablePersonName: node.accountablePersonName }) : ""}
                </span>
              </span>
              {node.hasProgress ? <ProgressLine value={node.derivedProgress} has className="hidden w-44 shrink-0 sm:flex" /> : null}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </OverviewRow>
  );
}

export function NotParticipantRow({ row }: { row: Row<"notParticipant"> }) {
  const format = useFormat();
  const t = useTranslations("overview.NotParticipantRow");
  return (
    <OverviewRow label={t("yourPlan")}>
      <Headline>{t("youreNotPartOf", { cycleName: row.cycleName })}</Headline>
      <p className="mt-1 type-body-secondary text-muted-foreground">
        {[row.joined ? t("youJoinedOn", { joined: day(row.joined, format.locale) }) : null, row.populationSetAt ? t("itsPopulationWasSetOn", { populationSetAt: day(row.populationSetAt, format.locale) }) : null]
          .filter(Boolean).join("; ") || t("yourConversationsCarryOnAs")}
      </p>
    </OverviewRow>
  );
}

export function NoCycleRow({ row }: { row: Row<"noCycle"> }) {
  const t = useTranslations("overview.NoCycleRow");
  const readiness = row.readiness;
  return (
    <OverviewRow label={t("performanceCycle")} link={row.canCreate ? { href: "/cycle", label: t("cycle") } : undefined}>
      <Headline action={row.canCreate ? <RowAction href="/cycle/setup/details" primary>{t("setUpACycle")}</RowAction> : undefined}>
        {t("noPerformanceCycleYet")}
      </Headline>
      {readiness ? (
        // What the first cycle would start from (board 16): checked when ready, marked when it needs a look.
        <ul className="mt-4 max-w-3xl divide-y divide-border">
          {readiness.workforceAvailable ? (
            <>
              <ReadinessLine ok={readiness.units > 0} title={t("withPeopleInCoreHr", { units: t("unitCount", { count: readiness.units }) })} />
              <ReadinessLine
                ok={readiness.withManager === readiness.people}
                title={t("ofHaveAManager", { withManager: readiness.withManager, people: t("personCount", { count: readiness.people }) })}
                detail={readiness.withoutManager.length > 0
                  ? (readiness.people - readiness.withManager > readiness.withoutManager.length ? t("andOthersWouldBeLeft", { join: readiness.withoutManager.join(", ") }) : t("wouldBeLeftOut", { join: readiness.withoutManager.join(", ") }))
                  : undefined}
              />
            </>
          ) : (
            <ReadinessLine ok={false} title={t("coreHrCouldntBeRead")} detail={t("peopleAndManagersShowOnce")} />
          )}
          <ReadinessLine ok={readiness.ratingLevels > 0 && readiness.competencies > 0} title={t("ratingScaleAndCompetencies")} detail={`${t("levelCount", { count: readiness.ratingLevels })}, ${t("competencyCount", { count: readiness.competencies })}`}
            href={row.canCreate ? "/settings" : undefined} />
        </ul>
      ) : null}
    </OverviewRow>
  );
}

function ReadinessLine({ ok, title, detail, href }: { ok: boolean; title: string; detail?: string; href?: string }) {
  const t = useTranslations("overview.ReadinessLine");
  return (
    <li className="flex items-center gap-3 py-3">
      <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-detail", ok ? "bg-success text-background" : "ring-1 ring-inset ring-warning")}>
        {ok ? <Check className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block type-label text-foreground">{title}<span className="sr-only">{ok ? " " + t("ready") : " " + t("needsALook")}</span></span>
        {detail ? <span className="block type-meta text-muted-foreground">{detail}</span> : null}
      </span>
      {href ? <Link href={href} className="type-meta text-muted-foreground hover:text-foreground">{t("settings")}</Link> : null}
    </li>
  );
}

/** With no cycle, conversations still work: the people this person can start 1:1s with (board 16). */
export function StartConversationsRow() {
  const t = useTranslations("overview.StartConversationsRow");
  const oneOnOnes = useOneOnOnes();
  const people = [
    ...(oneOnOnes.data?.startWithManager ? [oneOnOnes.data.startWithManager.with] : []),
    ...(oneOnOnes.data?.startWithReports.map((option) => option.with) ?? []),
  ];
  if (people.length === 0) return null;
  return (
    <OverviewRow label={t("conversations")} link={{ href: "/one-on-ones", label: "1:1s" }}>
      <Headline>{t("startYour11s")}</Headline>
      <ul className="mt-3 flex flex-wrap gap-2">
        {people.slice(0, 6).map((person) => (
          <li key={person.employeeId}>
            <Link href="/one-on-ones" className="flex items-center gap-2.5 rounded-control bg-card px-3 py-2 hover:bg-inlay">
              <PersonInitials name={person.displayName} size="sm" />
              <span className="type-label text-foreground">{person.displayName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </OverviewRow>
  );
}
