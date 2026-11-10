"use client";

import { WorkspaceSkeleton } from "@/shell/workspace-skeletons";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { ReviewsWorkspaceDto, ReviewsWorkspaceOwnDto, ReviewsWorkspaceRoundDto, ReviewsWorkspaceSessionDto, ReviewsWorkspaceTeamRowDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { PageContainer, PageHeader, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { ArrowRight, Check, ChevronRight, Download, Layers, Pencil, Plus } from "@repo/ds/icons";
import { useSelectedCycleId } from "../../api/use-workspace";
import { useDownloadReviewPdf, useReviewsWorkspace } from "../../api/use-review-work";
import { ContentUnavailable } from "../content-unavailable";
import { formatDate } from "../../lib";
import { calibrationHref, newReviewRoundHref, peerRequestHref, reviewHref, roundHref, withCycle } from "@/lib/performance-routes";
import { CountTile, DueChip, ReviewSection, StageTrack, dayLabel, dueIn, type Step } from "./review-parts";
import { PeerListDrawer } from "./peer-list-drawer";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";
import type { Say } from "@/i18n/say";

/**
 * Reviews (boards 01–03, 18): one landing composed from what the viewer holds. The person's own review leads for someone
 * who only has their own; a reviewer's ready review leads their page; a round administrator's running round leads theirs.
 */
export function ReviewsWorkspace() {
  const t = useTranslations("reviews.ReviewsWorkspace");
  const cycleId = useSelectedCycleId();
  const query = useReviewsWorkspace(cycleId);
  const params = useSearchParams();
  const router = useRouter();
  const peers = params.get("peers");
  if (query.error) return <ContentUnavailable error={query.error} onRetry={query.refetch} />;
  if (!query.data) return <WorkspaceSkeleton />;
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("peers");
    router.replace(`/reviews${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  };
  return (
    <>
      <Workspace data={query.data} />
      {peers ? <PeerListDrawer reviewId={peers} open onOpenChange={(open) => !open && close()} /> : null}
    </>
  );
}

function Workspace({ data }: { data: ReviewsWorkspaceDto }) {
  const t = useTranslations("reviews.Workspace");
  const headlineWords = useSay("reviews.headline");
  const format = useFormat();
  const running = data.rounds.find((round) => round.state === "Active") ?? null;
  const ready = data.toWrite.filter((row) => row.nextAction === "WriteReview");
  const lead: "round" | "ready" | "own" | "firstRound" | null = data.canAdminister
    ? running ? "round" : data.rounds.length === 0 ? "firstRound" : null
    : ready.length > 0 ? "ready" : data.own ? "own" : null;
  const ownIsLead = lead === "own" || (lead === null && data.toWrite.length === 0 && data.own !== null);
  const writes = data.toWrite.length > 0;

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4"
        title={t("reviews")}
        size="display"
        description={headline(data, running, headlineWords, format.locale)}
        actions={data.canAdminister ? (
          <Button variant="outline" asChild><Link href={withCycle(newReviewRoundHref(), data.cycleId)}><Plus className="size-4" aria-hidden />{t("newRound")}</Link></Button>
        ) : writes ? <YourReviewsCount rows={data.toWrite} /> : null}
      />

      <div className="space-y-10">
        {data.sessions.map((session) => <SessionLead key={session.roundId} session={session} cycleId={data.cycleId} />)}
        {lead === "round" && running ? <RunningRoundCard round={running} cycleId={data.cycleId} cycleEnd={data.cycleEnd} /> : null}
        {lead === "firstRound" ? <FirstRoundCard data={data} /> : null}
        {lead === "ready" ? <ReadyForYou row={ready[0]!} cycleId={data.cycleId} /> : null}
        {ownIsLead && data.own ? <OwnReviewCard own={data.own} cycleName={data.cycleName} cycleId={data.cycleId} /> : null}
        {!data.own && data.notIncluded ? <NotIncluded data={data} /> : null}
        {!data.own && !data.notIncluded && !writes && !data.canAdminister && data.askedOfYou.length === 0 ? (
          <p className="type-body-secondary text-muted-foreground">{t("noReviewYetIn")} {data.cycleName ?? t("thisCycle")}.</p>
        ) : null}
        {ownIsLead && data.own && data.own.state !== "Finalized" && data.year ? <YearFacts data={data} /> : null}

        {writes ? <TeamTable rows={data.toWrite} cycleId={data.cycleId} title={data.canAdminister ? t("reviewsYouWrite") : t("yourTeam")} /> : null}
        {data.canAdminister && data.rounds.length > 0 ? <RoundList rounds={data.rounds} cycleId={data.cycleId} cycleName={data.cycleName} /> : null}

        <BottomRow data={data} ownIsLead={ownIsLead} />
      </div>
    </PageContainer>
  );
}

function headline(data: ReviewsWorkspaceDto, running: ReviewsWorkspaceRoundDto | null, say: Say, locale: string): string | undefined {
  if (data.canAdminister) {
    const count = data.rounds.filter((r) => r.state === "Active").length;
    return (count ? say("running", { count, cycle: data.cycleName ?? "" }) : data.cycleName ?? "").trim() || undefined;
  }
  const lists = data.peerLists.length;
  if (data.toWrite.length > 0) {
    const round = data.toWrite[0]!.roundName;
    return lists ? say("lists", { count: lists, round }) : round;
  }
  if (data.own && data.own.state === "SelfAssessment" && data.own.selfAssessmentEnabled)
    return say("selfDue", { round: data.own.roundName, day: dayLabel(data.own.selfAssessmentDue, locale) });
  if (data.own) return data.own.roundName;
  return running?.name;
}

function YourReviewsCount({ rows }: { rows: ReviewsWorkspaceTeamRowDto[] }) {
  const format = useFormat();
  const t = useTranslations("reviews.YourReviewsCount");
  const done = rows.filter((r) => r.reviewStep === "Submitted" || r.reviewStep === "Released").length;
  const ready = rows.filter((r) => r.nextAction === "WriteReview").length;
  const due = rows.find((r) => r.state === "ManagerAssessment" || r.state === "SelfAssessment")?.dueDate ?? null;
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-12 items-center justify-center rounded-full bg-card type-label tabular-nums text-foreground">{done}/{rows.length}</span>
      <div>
        <p className="type-label text-foreground">{t("yourReviews")}</p>
        <p className="type-meta text-muted-foreground">{[due ? t("due", { due: dayLabel(due, format.locale) }) : null, ready ? t("readyNow", { ready }) : null].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

// ── The person's own review (board 01) ────────────────────────────────────────────

function ownSteps(own: ReviewsWorkspaceOwnDto, reviewer: string): Step[] {
  const order = ["SelfAssessment", "ManagerAssessment", "Calibration", "ReadyToFinalize", "Finalized"];
  const at = order.indexOf(own.state);
  const state = (index: number): Step["state"] => (index < at ? "done" : index === at ? (own.daysLate > 0 ? "late" : "current") : "todo");
  const steps: Step[] = [];
  if (own.selfAssessmentEnabled) steps.push({ label: "Your self-assessment", detail: `Due ${dayLabel(own.selfAssessmentDue)}`, state: state(0) });
  steps.push({ label: `${firstName(reviewer)}'s assessment`, detail: `Due ${dayLabel(own.managerAssessmentDue)}`, state: state(1) });
  if (own.calibrationEnabled) steps.push({ label: "Calibration", detail: "HR", state: state(2) });
  steps.push({ label: "Your result", detail: own.state === "Finalized" ? `Released ${formatDate(own.finalizedAt?.slice(0, 10))}` : "Released by HR", state: own.state === "Finalized" ? "done" : "todo" });
  return steps;
}

function OwnReviewCard({ own, cycleName, cycleId }: { own: ReviewsWorkspaceOwnDto; cycleName: string | null; cycleId: string | null }) {
  const format = useFormat();
  const t = useTranslations("reviews.OwnReviewCard");
  const parts = useSay("reviews.parts");
  const writing = own.state === "SelfAssessment" && own.selfAssessmentEnabled;
  const released = own.state === "Finalized";
  const title = released ? (own.finalRatingLabel ?? t("yourResultIsReleased"))
    : writing ? t("selfAssessment", { selfAssessmentDue: dueIn(own.selfAssessmentDue, parts) })
    : t("isWritingYourReview", { reviewerName: firstName(own.reviewerName) });
  const action = released ? (own.acknowledgedAt ? t("readYourReview") : t("readAndAcknowledge"))
    : writing ? (own.sections.objectivesDone + own.sections.competenciesDone + own.sections.questionsDone > 0 ? t("continueSelfAssessment") : t("startSelfAssessment"))
    : t("openYourReview");
  // Amber is the one decision (start, continue, acknowledge); a read-only review keeps a quiet button.
  const decision = writing || (released && !own.acknowledgedAt);
  return (
    <section aria-label={t("yourReview")} className="rounded-surface bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="type-meta text-muted-foreground">{t("your", { toLowerCase: own.roundName.toLowerCase() })}{cycleName ? ` · ${cycleName}` : ""}</p>
          <h2 className="mt-1.5 type-page-title text-foreground">{title}</h2>
          <p className="mt-1 type-meta text-muted-foreground">
            {t("reviewsYouCovers", { reviewerName: own.reviewerName, periodStart: format.range(own.periodStart, own.periodEnd) })}
          </p>
        </div>
        <Button asChild variant={decision ? "default" : "outline"}>
          <Link href={withCycle(reviewHref(own.reviewId), cycleId)}>{decision ? <Pencil className="size-4" aria-hidden /> : null}{action}</Link>
        </Button>
      </div>
      {released ? (
        // The process is over: the result leads and the stages recede to one line.
        <p className="mt-4 type-meta text-muted-foreground">
          {t("released", { formatDate: format.date(own.finalizedAt?.slice(0, 10)) })}{own.acknowledgedAt ? " " + t("youAcknowledgedIt", { formatDate: format.date(own.acknowledgedAt.slice(0, 10)) }) : ""}
        </p>
      ) : (
        <StageTrack className="mt-6" label={t("yourReviewsStages")} steps={ownSteps(own, own.reviewerName)} />
      )}
      {writing ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <SectionTile label={t("objectives")} done={own.sections.objectivesDone} total={own.sections.objectives} />
          <SectionTile label={t("competencies")} done={own.sections.competenciesDone} total={own.sections.competencies} />
          <SectionTile label={t("questions")} done={own.sections.questionsDone} total={own.sections.questions} />
          {own.peers ? (
            <div className="rounded-surface bg-card p-4">
              <p className="type-meta text-muted-foreground">{t("peersAsked")}</p>
              {own.peers.asked.length ? (
                <>
                  <p className="mt-2 flex items-center gap-2"><AvatarStack names={own.peers.asked} size="xs" /><span className="type-label tabular-nums">{own.peers.asked.length}</span></p>
                  <p className="mt-1.5 type-meta text-muted-foreground">{own.peers.approved ? t("approvedBy", { reviewerName: firstName(own.reviewerName), dayLabel: dayLabel(own.peers.approvedAt?.slice(0, 10), format.locale) }) : t("waitingForApproval")}</p>
                </>
              ) : <p className="mt-2 type-meta text-muted-foreground">{t("choose1To5Colleagues")}</p>}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SectionTile({ label, done, total }: { label: string; done: number; total: number }) {
  const t = useTranslations("reviews.SectionTile");
  if (total === 0) return null;
  return (
    <div className="rounded-surface bg-card p-4">
      <p className="type-meta text-muted-foreground">{label}</p>
      <p className="mt-2"><span className="type-label tabular-nums text-foreground">{done}</span> <span className="type-meta text-muted-foreground">{t("of", { total })}</span></p>
      <div className="mt-2.5 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => <span key={i} className={cn("h-1 flex-1 rounded-full", i < done ? "bg-success" : "bg-inlay")} />)}
      </div>
    </div>
  );
}

/** What the review will draw on, as one line of figures beside the person's own review (no tiles, no icons). */
function YearFacts({ data }: { data: ReviewsWorkspaceDto }) {
  const t = useTranslations("reviews.YearFacts");
  const year = data.year!;
  const facts = [
    { value: year.planProgress === null ? "–" : `${Math.round(year.planProgress)}%`, label: (year.objectives === 1 ? t("planProgressObjective", { objectives: year.objectives }) : t("planProgressObjectives", { objectives: year.objectives })) },
    { value: String(year.feedback), label: t("feedbackReceived") },
    { value: String(year.praise), label: "praise" },
    { value: String(year.oneOnOnes), label: t("n11sHeld") },
  ];
  return (
    <ReviewSection id="year" title={t("yourYearAlreadyInThe")}>
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline gap-2">
            <dt className="sr-only">{fact.label}</dt>
            <dd className="type-metric text-foreground">{fact.value}</dd>
            <span aria-hidden className="type-meta text-muted-foreground">{fact.label}</span>
          </div>
        ))}
      </dl>
    </ReviewSection>
  );
}

function NotIncluded({ data }: { data: ReviewsWorkspaceDto }) {
  const t = useTranslations("reviews.NotIncluded");
  const excluded = data.notIncluded!;
  return (
    <section className="rounded-surface bg-card p-6">
      <h2 className="type-panel-title text-foreground">{t("youreNotInThe", { roundName: excluded.roundName })}</h2>
      {excluded.reason ? <p className="mt-1 type-body-secondary text-muted-foreground">{excluded.reason}</p> : null}
    </section>
  );
}

// ── Reviewer (board 02) ───────────────────────────────────────────────────────────

function ReadyForYou({ row, cycleId }: { row: ReviewsWorkspaceTeamRowDto; cycleId: string | null }) {
  const format = useFormat();
  const t = useTranslations("reviews.ReadyForYou");
  return (
    <section aria-label={t("readyForYou")} className="rounded-surface border border-primary/40 bg-primary-tint p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <PersonInitials name={row.subjectDisplayName} size="xl" />
          <div className="min-w-0">
            <p className="type-meta text-primary">{t("readyForYou")}</p>
            <h2 className="mt-1 type-page-title text-foreground">{row.subjectDisplayName}</h2>
            <p className="mt-0.5 type-meta text-muted-foreground">
              {[row.jobTitle, row.selfSubmittedAt ? `self-assessment in since ${dayLabel(row.selfSubmittedAt.slice(0, 10), format.locale)}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <Button asChild><Link href={withCycle(reviewHref(row.reviewId), cycleId)}><Pencil className="size-4" aria-hidden />{t("writeReview")}</Link></Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FactTile label={t("view", { row: pronounView(row) })}>{row.selfOverallLabel ? <><strong className="font-semibold">{row.selfOverallLabel}</strong> {t("overall")}</> : t("noSelfAssessment")}</FactTile>
        <FactTile label={t("peers")}>
          {row.peerTotal ? <span className="flex items-center gap-2"><AvatarStack names={row.peerNames} size="xs" /><strong className="font-semibold tabular-nums">{t("of", { peerAnswered: row.peerAnswered, peerTotal: row.peerTotal })}</strong></span> : t("noneAsked")}
        </FactTile>
        <FactTile label={t("plan")}>{row.planProgress === null ? t("noProgressYet") : <><strong className="font-semibold">{Math.round(row.planProgress)}%</strong>{row.atRisk ? " " + t("atRisk", { atRisk: row.atRisk }) : ""}</>}</FactTile>
        <FactTile label={t("theirYear")}><strong className="font-semibold">{row.feedback}</strong> {t("feedback")} <strong className="font-semibold">{row.praise}</strong> {t("praise")}</FactTile>
      </div>
    </section>
  );
}

function pronounView(row: ReviewsWorkspaceTeamRowDto) {
  return `${firstName(row.subjectDisplayName)}'s`;
}

function FactTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-surface bg-card px-4 py-3.5">
      <p className="type-meta text-muted-foreground">{label}</p>
      <div className="mt-1.5 type-body text-foreground">{children}</div>
    </div>
  );
}

function TeamTable({ rows, cycleId, title }: { rows: ReviewsWorkspaceTeamRowDto[]; cycleId: string | null; title: string }) {
  const t = useTranslations("reviews.TeamTable");
  return (
    <ReviewSection id="team" title={title} count={rows.length} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-start">
          <thead className="bg-inlay">
            <tr className="type-meta text-muted-foreground">
              <th scope="col" className="px-5 py-3 font-semibold">{t("person")}</th>
              <th scope="col" className="px-3 py-3 font-semibold">{t("peers")}</th>
              <th scope="col" className="px-3 py-3 font-semibold">{t("selfAssessment")}</th>
              <th scope="col" className="px-3 py-3 font-semibold">{t("peerInput")}</th>
              <th scope="col" className="px-3 py-3 font-semibold">{t("yourReview")}</th>
              <th scope="col" className="px-5 py-3"><span className="sr-only">{t("action")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => <TeamRow key={row.reviewId} row={row} cycleId={cycleId} primary={index === 0 && row.nextAction === "WriteReview"} />)}
          </tbody>
        </table>
      </div>
    </ReviewSection>
  );
}

function StepCell({ state, children }: { state: "done" | "current" | "todo" | "late"; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5">
        {state === "done" ? <span className="flex size-4 items-center justify-center rounded-full bg-success text-background"><Check className="size-2.5" aria-hidden /></span>
          : state === "todo" ? <span className="block size-4 rounded-full border border-border bg-inlay" />
          : <span className={cn("flex size-4 items-center justify-center rounded-full border-2", state === "late" ? "border-destructive" : "border-primary")}><span className={cn("size-1.5 rounded-full", state === "late" ? "bg-destructive" : "bg-primary")} /></span>}
      </span>
      <div className="min-w-0 type-body text-foreground">{children}</div>
    </div>
  );
}

function TeamRow({ row, cycleId, primary }: { row: ReviewsWorkspaceTeamRowDto; cycleId: string | null; primary: boolean }) {
  const format = useFormat();
  const t = useTranslations("reviews.TeamRow");
  const parts = useSay("reviews.parts");
  const href = withCycle(reviewHref(row.reviewId), cycleId);
  const name = firstName(row.subjectDisplayName);
  const late = row.daysLate > 0;
  return (
    <tr className="align-middle">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <PersonInitials name={row.subjectDisplayName} size="md" />
          <div className="min-w-0">
            <Link href={href} className="type-label text-foreground hover:underline">{row.subjectDisplayName}</Link>
            <p className="type-meta text-muted-foreground">{row.jobTitle ?? row.roundName}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3.5">
        {row.peerStep === "Off" ? <span className="type-meta text-muted-foreground">{t("notAsked")}</span>
          : row.peerStep === "Approved" ? <StepCell state="done">{t("approved", { peerCount: row.peerCount })}</StepCell>
          : row.peerStep === "ToApprove" ? <StepCell state="current"><span className="font-medium text-primary">{t("toApprove", { peerCount: row.peerCount })}</span></StepCell>
          : <StepCell state="todo"><span className="text-muted-foreground">{t("notChosenYet")}</span></StepCell>}
      </td>
      <td className="px-3 py-3.5">
        {row.selfStep === "Off" ? <span className="type-meta text-muted-foreground">{t("notAsked")}</span>
          : row.selfStep === "Submitted" ? <StepCell state="done">{t("submitted")}<p className="type-meta text-muted-foreground">{dayLabel(row.selfSubmittedAt?.slice(0, 10), format.locale)}</p></StepCell>
          : <StepCell state={late && row.state === "SelfAssessment" ? "late" : row.selfStep === "Writing" ? "current" : "todo"}>
              <span className={cn(row.selfStep === "NotStarted" && "text-primary")}>{row.selfStep === "Writing" ? t("writing") : t("notStarted")}</span>
              <p className="type-meta text-muted-foreground">{late && row.state === "SelfAssessment" ? dueIn(row.dueDate, parts) : t("due", { dueDate: dayLabel(row.dueDate, format.locale) })}</p>
            </StepCell>}
      </td>
      <td className="px-3 py-3.5">
        {row.peerStep === "Off" ? <span className="type-meta text-muted-foreground">–</span>
          : row.peerTotal === 0 ? <span className="type-body-secondary text-muted-foreground">{row.peerStep === "ToApprove" ? t("afterYourApproval") : "–"}</span>
          : <StepCell state={row.peerAnswered + row.peerDeclined === row.peerTotal ? "done" : "current"}>
              <span className="tabular-nums">{t("of", { peerAnswered: row.peerAnswered, peerTotal: row.peerTotal })}</span>
              {row.peerDeclined ? <p className="type-meta text-muted-foreground">{t("declined", { peerDeclined: row.peerDeclined })}</p> : null}
            </StepCell>}
      </td>
      <td className="px-3 py-3.5">
        {row.state === "Calibration" ? (
          <StepCell state="current">{t("inCalibration")}<p className="type-meta text-muted-foreground">{t("youRated", { value: row.managerRating ?? "–" })}</p></StepCell>
        ) : row.state === "ReadyToFinalize" && row.finalRating !== null ? (
          <StepCell state="done">
            {row.calibrationChanged ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-primary-ink">
                <span className="tabular-nums text-muted-foreground line-through">{row.managerRating}</span>
                <ArrowRight className="size-3.5" aria-hidden /><span className="tabular-nums">{row.finalRating}</span>
              </span>
            ) : <span className="tabular-nums">{t("final", { finalRating: row.finalRating })}</span>}
            <p className="type-meta text-muted-foreground">{row.calibrationChanged ? t("changedInCalibration") : t("calibrated")}</p>
          </StepCell>
        ) : row.reviewStep === "Waiting" ? <span className="type-body-secondary text-muted-foreground">{t("after", { name })}</span>
          : row.reviewStep === "ReadyToWrite" || row.reviewStep === "Writing" ? <StepCell state={late ? "late" : "current"}><span className="font-medium text-primary">{row.reviewStep === "Writing" ? t("writing") : t("readyToWrite")}</span>{late ? <p className="type-meta text-destructive">{dueIn(row.dueDate, parts)}</p> : null}</StepCell>
          : row.reviewStep === "Closed" ? <span className="type-body-secondary text-muted-foreground">{t("closed")}</span>
          : <StepCell state="done">{row.reviewStep === "Released" ? t("released") : t("submitted")}</StepCell>}
      </td>
      <td className="px-5 py-3.5 text-end">
        {row.summaryToCheck ? (
          <Button size="sm" asChild><Link href={href}>{t("checkSummary")}</Link></Button>
        ) : row.nextAction === "WriteReview" ? (
          <Button size="sm" variant={primary ? "default" : "outline"} asChild><Link href={href}>{t("writeReview")}</Link></Button>
        ) : row.nextAction === "ApprovePeers" ? (
          <Button size="sm" variant="outline" asChild><Link href={`/reviews?${new URLSearchParams({ ...(cycleId ? { cycle: cycleId } : {}), peers: row.reviewId }).toString()}`} scroll={false}>{t("reviewList")}</Link></Button>
        ) : (
          <Link href={href} aria-label={t("openSReview", { subjectDisplayName: row.subjectDisplayName })} className="inline-flex text-muted-foreground hover:text-foreground"><ChevronRight className="size-4" aria-hidden /></Link>
        )}
      </td>
    </tr>
  );
}

// ── Calibration a facilitator holds (board 11) ─────────────────────────────────────

function SessionLead({ session, cycleId }: { session: ReviewsWorkspaceSessionDto; cycleId: string | null }) {
  const t = useTranslations("reviews.SessionLead");
  const discussed = session.people === 0 ? 0 : Math.round((session.discussed / session.people) * 100);
  return (
    <section aria-labelledby={`session-${session.roundId}`} className="rounded-surface bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="type-meta text-muted-foreground">{t("calibration")}</p>
          <h2 id={`session-${session.roundId}`} className="mt-1 type-section-title text-foreground">{session.roundName}</h2>
        </div>
        <Button asChild><Link href={withCycle(calibrationHref(session.roundId), cycleId)}>{t("openTheSession")}<ArrowRight className="size-4" aria-hidden /></Link></Button>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <dt className="type-meta text-muted-foreground">{t("discussed")}</dt>
          <dd className="mt-1 type-metric tabular-nums text-foreground">{session.discussed}<span className="ms-1.5 type-meta text-muted-foreground">{t("of", { people: session.people })}</span></dd>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-inlay" aria-hidden><div className="h-full rounded-full bg-success" style={{ width: `${discussed}%` }} /></div>
        </div>
        <div><dt className="type-meta text-muted-foreground">{t("people")}</dt><dd className="mt-1 type-metric tabular-nums text-foreground">{session.people}</dd></div>
        <div><dt className="type-meta text-muted-foreground">{t("flags")}</dt><dd className="mt-1 type-metric tabular-nums text-foreground">{session.flags}</dd></div>
        <div><dt className="type-meta text-muted-foreground">{t("withManagers")}</dt><dd className="mt-1 type-metric tabular-nums text-foreground">{session.outstanding}</dd></div>
      </dl>
    </section>
  );
}

// ── Round administration (board 03) ───────────────────────────────────────────────

function RunningRoundCard({ round, cycleId, cycleEnd }: { round: ReviewsWorkspaceRoundDto; cycleId: string | null; cycleEnd: string | null }) {
  const format = useFormat();
  const t = useTranslations("reviews.RunningRoundCard");
  const stage = (name: string) => round.stages.find((s) => s.stage === name);
  const self = stage("SelfAssessment");
  const peers = stage("PeerInput");
  const manager = stage("ManagerAssessment");
  const released = stage("Released");
  const today = new Date().toISOString().slice(0, 10);
  const passed = (date: string | null) => Boolean(date && date < today);
  const timeline: Step[] = [
    { label: t("launched"), detail: dayLabel(round.launchedAt?.slice(0, 10), format.locale), state: "done" },
    ...(round.selfAssessmentDue ? [{ label: round.peerInputDue ? t("selfAndPeersClose") : t("selfAssessmentsClose"), detail: dayLabel(round.selfAssessmentDue, format.locale),
      state: passed(round.selfAssessmentDue) ? "done" : "current" } as Step] : []),
    { label: t("managerReviewsClose"), detail: dayLabel(round.managerAssessmentDue, format.locale), state: passed(round.managerAssessmentDue) ? "done" : passed(round.selfAssessmentDue) || !round.selfAssessmentDue ? "current" : "todo" },
    ...(round.calibrationEnabled ? [{ label: t("calibration"), detail: t("whenManagerReviewsAreIn"), state: "todo" } as Step] : []),
    ...(cycleEnd ? [{ label: t("cycleEnds"), detail: dayLabel(cycleEnd, format.locale), state: "todo" } as Step] : []),
  ];
  return (
    <section aria-label={t("runningRound")} className="rounded-surface bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex size-11 items-center justify-center rounded-control bg-primary-tint text-primary-ink"><Layers className="size-5" aria-hidden /></span>
          <div className="min-w-0">
            <p className="type-meta text-muted-foreground">{t("runningLaunched", { dayLabel: dayLabel(round.launchedAt?.slice(0, 10), format.locale) })}</p>
            <h2 className="mt-1 type-page-title text-foreground">{round.name}</h2>
            <p className="mt-0.5 type-meta text-muted-foreground">
              {round.people} {round.people === 1 ? t("person") : t("people")} · {format.range(round.periodStart, round.periodEnd)}{round.calibrationEnabled ? " " + t("calibrationOn") : ""}
            </p>
          </div>
        </div>
        <Button asChild><Link href={withCycle(roundHref(round.roundId), cycleId)}>{t("openRound")}<ArrowRight className="size-4" aria-hidden /></Link></Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {self ? <CountTile label={t("selfAssessments")} value={self.done} total={self.total} foot={t("stillOpen", { open: self.open })} /> : null}
        {peers ? <CountTile label={t("peerInput")} value={peers.done} total={peers.total} foot={round.listsToApprove ? t("listsWait", { count: round.listsToApprove }) : t("declined", { count: peers.declined })} /> : null}
        {manager ? <CountTile label={t("managerReviews")} value={manager.done} total={manager.total} tone="primary" foot={t("readyToWrite", { readyToWrite: manager.readyToWrite })} /> : null}
        {released ? <CountTile label={t("released")} value={released.done} total={released.total} foot={round.calibrationEnabled ? t("afterCalibration") : t("afterManagerReviews")} /> : null}
      </div>
      <StageTrack className="mt-6" label={t("roundTimeline")} steps={timeline} />
    </section>
  );
}

function FirstRoundCard({ data }: { data: ReviewsWorkspaceDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.FirstRoundCard");
  return (
    <section className="rounded-surface border border-dashed border-border p-6">
      <h2 className="type-panel-title text-foreground">{t("setUpTheReview", { value: data.cycleName ?? "cycle" })}</h2>
      <p className="mt-1 type-meta text-muted-foreground">
        {data.cycleFacts ? t("inTheCycleApprovedPlans", { participants: data.cycleFacts.participants, approvedPlans: data.cycleFacts.approvedPlans }) : null}
        {data.cycleEnd ? " " + t("cycleEnds", { cycleEnd: dayLabel(data.cycleEnd, format.locale) }) : null}
      </p>
      <Button className="mt-4" asChild><Link href={withCycle(newReviewRoundHref(), data.cycleId)}><Plus className="size-4" aria-hidden />{t("newRound")}</Link></Button>
    </section>
  );
}

function RoundList({ rounds, cycleId, cycleName }: { rounds: ReviewsWorkspaceRoundDto[]; cycleId: string | null; cycleName: string | null }) {
  const format = useFormat();
  const t = useTranslations("reviews.RoundList");
  return (
    <ReviewSection id="rounds" title={t("rounds", { value: cycleName ?? "Cycle" })} count={rounds.length} flush>
      <ul className="divide-y divide-border">
        {rounds.map((round) => {
          const self = round.stages.find((s) => s.stage === "SelfAssessment");
          const share = round.state === "Closed" ? (round.people ? round.released / round.people : 0) : self && self.total ? self.done / self.total : 0;
          return (
            <li key={round.roundId}>
              <Link href={withCycle(roundHref(round.roundId), cycleId)} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-inlay/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className={cn("flex size-10 items-center justify-center rounded-control", round.state === "Active" ? "bg-primary-tint text-primary" : "bg-inlay text-muted-foreground")}><Layers className="size-4" aria-hidden /></span>
                <span className="min-w-48 flex-1">
                  <span className="block type-label text-foreground">{round.name}</span>
                  <span className="block type-meta text-muted-foreground">{round.people} {round.people === 1 ? t("person") : t("people")} {t("components", { components: round.components })}</span>
                </span>
                {round.state !== "Draft" ? (
                  <span className="w-64">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-inlay"><span className="block h-full rounded-full bg-success" style={{ width: `${Math.round(share * 100)}%` }} /></span>
                    <span className="mt-1 block type-meta text-muted-foreground">
                      {round.state === "Closed" ? t("releasedAcknowledged", { released: round.released, acknowledged: round.acknowledged }) : self ? t("selfAssessments", { round: Math.round(share * 100) }) : t("managerReviews")}
                    </span>
                  </span>
                ) : null}
                <StatusBadge tone={round.state === "Active" ? "warning" : round.state === "Draft" ? "neutral" : "muted"}>
                  {round.state === "Active" ? t("running") : round.state === "Draft" ? t("draft") : t("closed", { formatDate: format.date(round.closedAt?.slice(0, 10)) })}
                </StatusBadge>
              </Link>
            </li>
          );
        })}
      </ul>
    </ReviewSection>
  );
}

// ── The row beneath: asked of you, your own review, past results ─────────────────

function BottomRow({ data, ownIsLead }: { data: ReviewsWorkspaceDto; ownIsLead: boolean }) {
  const ownCompact = !ownIsLead && data.own ? data.own : null;
  const parts = [
    ownCompact ? <OwnCompact key="own" own={ownCompact} cycleId={data.cycleId} /> : null,
    data.askedOfYou.length ? <AskedOfYou key="asked" data={data} /> : null,
    ownIsLead || (!data.own && !data.toWrite.length)
      ? (data.pastResults.some((result) => result.reviewId !== data.own?.reviewId) ? <PastResults key="past" data={data} /> : null)
      : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <div className="grid gap-6 lg:grid-cols-2">{parts}</div>;
}

function OwnCompact({ own, cycleId }: { own: ReviewsWorkspaceOwnDto; cycleId: string | null }) {
  const format = useFormat();
  const t = useTranslations("reviews.OwnCompact");
  const writing = own.state === "SelfAssessment" && own.selfAssessmentEnabled;
  return (
    <ReviewSection id="own" title={t("yourOwnReview")} flush>
      <div className="flex items-center gap-4 px-5 py-4">
        <PersonInitials name={own.reviewerName} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="type-label text-foreground">{t("reviewsYou", { reviewerName: own.reviewerName })}</p>
          <p className="type-meta text-muted-foreground">{writing ? t("selfAssessmentDue", { selfAssessmentDue: dayLabel(own.selfAssessmentDue, format.locale) }) : own.state === "Finalized" ? t("released") : t("withYourReviewer")}</p>
        </div>
        <Button size="sm" variant="outline" asChild><Link href={withCycle(reviewHref(own.reviewId), cycleId)}>{writing ? t("start") : t("open")}</Link></Button>
      </div>
    </ReviewSection>
  );
}

function AskedOfYou({ data }: { data: ReviewsWorkspaceDto }) {
  const format = useFormat();
  const t = useTranslations("reviews.AskedOfYou");
  return (
    // The count is what still waits on you; answered and declined requests stay listed without counting.
    <ReviewSection id="asked" title={t("askedOfYou")} count={data.askedOfYou.filter((r) => r.state === "Open").length || undefined} flush>
      <ul className="divide-y divide-border">
        {data.askedOfYou.map((request) => (
          <li key={request.requestId} className="flex items-center gap-4 px-5 py-4">
            <PersonInitials name={request.subjectDisplayName} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="type-label text-foreground">{request.subjectDisplayName}</p>
              <p className="type-meta text-muted-foreground">
                {request.state === "Open" ? `${request.questions} ${request.questions === 1 ? "question" : "questions"}`
                  : request.state === "Answered" ? t("sent", { dayLabel: dayLabel(request.respondedAt?.slice(0, 10), format.locale) })
                  : request.state === "Declined" ? t("declined") : t("closed")}
              </p>
            </div>
            {request.state === "Open" ? (
              <>
                <DueChip date={request.dueDate} late={request.daysLate > 0} />
                <Button size="sm" asChild><Link href={peerRequestHref(request.requestId)}>{t("giveInput")}</Link></Button>
              </>
            ) : request.state === "Answered" ? <StatusBadge tone="success" dot>{t("sent2")}</StatusBadge> : <StatusBadge tone="muted">{request.state}</StatusBadge>}
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}

function PastResults({ data }: { data: ReviewsWorkspaceDto }) {
  const t = useTranslations("reviews.PastResults");
  const download = useDownloadReviewPdf();
  return (
    <ReviewSection id="past" title={t("pastResults")} flush>
      <ul className="divide-y divide-border">
        {data.pastResults.filter((result) => result.reviewId !== data.own?.reviewId).map((result) => (
          <li key={result.reviewId} className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <Link href={reviewHref(result.reviewId)} className="type-subsection-title text-foreground hover:underline">{result.label ?? t("released")}</Link>
              <p className="type-meta text-muted-foreground">{result.cycleName} {result.roundName.toLowerCase()}{result.acknowledgedAt ? " " + t("acknowledged") : ""}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void download(result.reviewId, `${result.roundName}.pdf`)}>
              <Download className="size-4" aria-hidden />{t("pdf")}
            </Button>
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}


export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
