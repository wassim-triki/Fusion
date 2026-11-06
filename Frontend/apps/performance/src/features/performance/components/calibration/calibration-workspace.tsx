"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, type CalibrationFilter, type CalibrationHeaderDto, type CalibrationSessionDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { AsyncButton, PageContainer, PageRefusal, PageSkeleton } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";
import { ArrowLeft } from "@/lib/icons";
import { roundHref, withCycle } from "@/lib/performance-routes";
import Link from "next/link";
import { RecordCycleScope, useWorkspaceContext } from "../../api/use-workspace";
import { useReviewRound } from "../../api/use-reviews";
import {
  useCalibrationChanges,
  useCalibrationDistribution,
  useCalibrationMutations,
  useCalibrationNineBox,
  useCalibrationPeople,
  useCalibrationSession,
  useFacilitatorCandidates,
  type CalibrationView,
} from "../../api/use-calibration";
import { ContentUnavailable } from "../content-unavailable";
import { AdjustDrawer } from "./adjust-drawer";
import { readLocation, writeLocation } from "./calibration-format";
import { SessionAction, SessionStats, SessionTitle, SessionToolbar } from "./calibration-header";
import { ChangesView, DistributionView, PeopleView } from "./calibration-views";
import { FinalizeDialog } from "./finalize-dialog";
import { NineBoxView, type NineBoxMove } from "./nine-box";
import { useRecentRecord } from "@repo/api/react";
import { useTranslations } from "next-intl";

export function CalibrationWorkspacePage({ roundId }: { roundId: string }) {
  const t = useTranslations("calibration.CalibrationWorkspacePage");
  const context = useWorkspaceContext();
  const canCalibrate = context.data?.capabilities.canCalibrate ?? false;
  const session = useCalibrationSession(roundId, canCalibrate);
  useRecentRecord(
    "performance",
    session.data
      ? { label: session.data.reviewRoundName, kind: "Calibration", href: `/performance/reviews/rounds/${roundId}/calibration` }
      : null,
  );
  const mutations = useCalibrationMutations(roundId, session.data?.cycleId ?? context.data?.selected?.id ?? null);

  if (context.isLoading || (canCalibrate && session.isLoading)) return <PageSkeleton rows={7} width="wide" label={t("loadingCalibration")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} subject={t("calibration")} />;
  if (!canCalibrate) return <PageContainer><PageRefusal /></PageContainer>;
  const status = session.error instanceof ApiError ? session.error.status : null;
  if (status === 403) return <PageContainer><PageRefusal /></PageContainer>;
  if (status === 404) return <OpenSession roundId={roundId} cycleId={context.data?.selected?.id ?? null} mutations={mutations} />;
  if (session.error) return <ContentUnavailable error={session.error} onRetry={session.refetch} subject={t("calibration")} />;
  if (!session.data?.header) return <PageSkeleton rows={7} width="wide" label={t("loadingCalibration")} />;
  return (
    <RecordCycleScope cycleId={session.data.cycleId}>
      <CalibrationSession session={session.data} header={session.data.header} roundId={roundId} mutations={mutations} />
    </RecordCycleScope>
  );
}

type Mutations = ReturnType<typeof useCalibrationMutations>;

/** The session from open to finalized, in three views of one set of people (R6, S-11). */
export function CalibrationSession({ session, header, roundId, mutations }: {
  session: CalibrationSessionDto;
  header: CalibrationHeaderDto;
  roundId: string;
  mutations: Mutations;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const location = useMemo(() => readLocation(new URLSearchParams(params?.toString() ?? ""), header.potentialEnabled), [params, header.potentialEnabled]);
  const navigate = useCallback((view: CalibrationView, filter: CalibrationFilter) => {
    router.replace(`${pathname}${writeLocation({ view, filter })}`, { scroll: false });
  }, [router, pathname]);
  const [person, setPerson] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [facilitators, setFacilitators] = useState(false);
  const open = session.state === "Open";
  const top = session.ratingScale.length;

  return (
    <PageContainer width="wide">
      <SessionTitle session={session} header={header} onFacilitators={open ? () => setFacilitators(true) : undefined}
        action={<SessionAction session={session} header={header} onFinalize={() => setFinalizing(true)} />} />
      <SessionStats header={header} />
      {open && header.outstanding > 0 ? <StillWithManagers header={header} /> : null}
      {open ? (
        <>
          <SessionToolbar header={header} view={location.view} filter={location.filter}
            onView={(view) => navigate(view, location.filter)} onFilter={(filter) => navigate(location.view, filter)} />
          <SessionBody roundId={roundId} view={location.view} filter={location.filter} header={header} top={top} session={session}
            mutations={mutations} onPerson={setPerson}
            onManager={(manager) => navigate("people", { ...location.filter, manager })} />
        </>
      ) : <Finalized roundId={roundId} top={top} />}
      <AdjustDrawer roundId={roundId} reviewId={person} readOnly={!open} potentialEnabled={header.potentialEnabled}
        mutations={mutations} onClose={() => setPerson(null)} />
      {open ? (
        <FinalizeDialog session={session} roundId={roundId} open={finalizing} mutations={mutations}
          onClose={() => setFinalizing(false)} onOpenPerson={setPerson} />
      ) : null}
      {facilitators ? <FacilitatorDialog session={session} roundId={roundId} mutations={mutations} onClose={() => setFacilitators(false)} /> : null}
    </PageContainer>
  );
}

function SessionBody({ roundId, view, filter, header, top, session, mutations, onPerson, onManager }: {
  roundId: string;
  view: CalibrationView;
  filter: CalibrationFilter;
  header: CalibrationHeaderDto;
  top: number;
  session: CalibrationSessionDto;
  mutations: Mutations;
  onPerson: (reviewId: string) => void;
  onManager: (managerId: string) => void;
}) {
  const t = useTranslations("calibration.SessionBody");
  const distribution = useCalibrationDistribution(roundId, filter, view === "distribution");
  const people = useCalibrationPeople(roundId, filter, view === "people");
  const nineBox = useCalibrationNineBox(roundId, filter, view === "nine-box");
  const lenient = useMemo(() => new Set(header.managers.filter((manager) => manager.flagged).map((manager) => manager.id)), [header.managers]);
  const query = view === "distribution" ? distribution : view === "nine-box" ? nineBox : people;
  if (query.error) return <ContentUnavailable error={query.error} onRetry={query.refetch} subject={t("thisView")} />;
  if (view === "distribution" && distribution.data) return <DistributionView view={distribution.data} onManager={onManager} />;
  if (view === "people" && people.data) return <PeopleView view={people.data} top={top} lenient={lenient} onOpen={(person) => onPerson(person.reviewId)} />;
  if (view === "nine-box" && nineBox.data) {
    return (
      <NineBoxView view={nineBox.data} scale={session.ratingScale} readOnly={false} onOpen={onPerson}
        onMove={async (move: NineBoxMove) => {
          await mutations.adjust.mutateAsync({
            reviewId: move.person.reviewId,
            rating: move.rating,
            rationale: move.reason,
            discussionState: move.discussed ? "Discussed" : "NotDiscussed",
            expectedVersion: move.person.version,
            potential: move.potential,
          });
          toast.success(t("moved", { name: move.person.name }));
        }} />
    );
  }
  return <Skeleton className="h-96 rounded-surface" />;
}

/** Board 02: work starts on what is in; what is missing is listed by manager. */
function StillWithManagers({ header }: { header: CalibrationHeaderDto }) {
  const t = useTranslations("calibration.StillWithManagers");
  return (
    <section aria-labelledby="still-title" className="mt-6 rounded-surface bg-card p-5">
      <h2 id="still-title" className="type-label text-foreground">
        {t("stillWithManagers")}<span className="ms-1.5 type-meta tabular-nums text-muted-foreground">{header.outstanding}</span>
      </h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-3">
        {header.outstandingByReviewer.map((group) => (
          <li key={group.reviewerId} className="flex items-start gap-3 rounded-control bg-inlay px-3.5 py-3">
            <PersonInitials name={group.reviewerName} size="md" />
            <span className="min-w-0">
              <span className="block type-label text-foreground">{group.reviewerName}<span className="ms-1.5 type-meta tabular-nums text-muted-foreground">{group.count}</span></span>
              <span className="block truncate type-meta text-muted-foreground">{group.people.join(", ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Finalized({ roundId, top }: { roundId: string; top: number }) {
  const t = useTranslations("calibration.Finalized");
  const changes = useCalibrationChanges(roundId, {}, true);
  if (changes.error) return <ContentUnavailable error={changes.error} onRetry={changes.refetch} subject={t("theOutcome")} />;
  if (!changes.data) return <Skeleton className="mt-8 h-96 rounded-surface" />;
  return <div className="mt-8"><ChangesView view={changes.data} top={top} /></div>;
}

/** Board 01: before the session exists, what is in, who is late, and who facilitates. */
function OpenSession({ roundId, cycleId, mutations }: { roundId: string; cycleId: string | null; mutations: Mutations }) {
  const t = useTranslations("calibration.OpenSession");
  const round = useReviewRound(roundId);
  const candidates = useFacilitatorCandidates(roundId);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const teams = round.data?.progress?.teams ?? [];
  const managerStage = round.data?.progress?.stages.find((stage) => stage.stage === "ManagerAssessment");
  const late = teams.filter((team) => team.manager.done < team.manager.total);
  const open = async () => {
    try {
      const session = await mutations.open.mutateAsync();
      const extra = chosen ? [...chosen].filter((id) => !session.facilitators.some((item) => item.userId === id)) : [];
      if (extra.length > 0) {
        await mutations.setFacilitators.mutateAsync({ userIds: [...session.facilitators.map((item) => item.userId), ...extra], expectedVersion: session.version });
      }
    } catch { /* shown below */ }
  };
  return (
    <PageContainer width="default">
      <Link href={withCycle(roundHref(roundId), cycleId)}
        className="mb-3 inline-flex items-center gap-1.5 rounded-detail type-body text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" aria-hidden />{round.data?.name ?? t("reviewRound")}
      </Link>
      <h1 className="type-display text-foreground">{t("openCalibration")}</h1>
      {managerStage ? (
        <section aria-label={t("managerReviews")} className="mt-6 rounded-surface bg-card p-5">
          <p className="type-meta text-muted-foreground">{t("managerReviewsIn")}</p>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="type-metric tabular-nums text-foreground">{managerStage.done}</span>
            <span className="type-meta tabular-nums text-muted-foreground">{t("of", { total: managerStage.total })}</span>
          </p>
          {late.length > 0 ? (
            <ul className="mt-4 divide-y divide-border">
              {late.map((team) => (
                <li key={team.reviewerEmployeeId} className="flex items-center gap-3 py-2.5">
                  <PersonInitials name={team.reviewerDisplayName} size="md" />
                  <span className="flex-1 type-label text-foreground">{team.reviewerDisplayName}</span>
                  <span className="type-meta tabular-nums text-muted-foreground">{t("toSubmit", { value: team.manager.total - team.manager.done })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section aria-labelledby="facilitators-title" className="mt-6 rounded-surface bg-card p-5">
        <h2 id="facilitators-title" className="type-label text-foreground">{t("facilitators")}</h2>
        {candidates.isLoading ? <Skeleton className="mt-3 h-20" />
          : candidates.error ? <p className="mt-3 type-body text-destructive" role="alert">{candidates.error.message}</p>
          : (
            <ul className="mt-2 divide-y divide-border">
              {(candidates.data ?? []).map((candidate) => (
                <li key={candidate.userId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2 type-body text-foreground">
                    <input type="checkbox" className="size-4 accent-primary" checked={chosen?.has(candidate.userId) ?? false}
                      onChange={() => setChosen((current) => {
                        const next = new Set(current ?? []);
                        if (next.has(candidate.userId)) next.delete(candidate.userId); else next.add(candidate.userId);
                        return next;
                      })} />
                    <PersonInitials name={candidate.displayName} size="sm" />
                    {candidate.displayName}
                  </label>
                </li>
              ))}
            </ul>
          )}
      </section>
      {mutations.open.error || mutations.setFacilitators.error ? (
        <p className="mt-4 type-body text-destructive" role="alert">{(mutations.open.error ?? mutations.setFacilitators.error)?.message}</p>
      ) : null}
      <div className="mt-6 flex justify-end">
        <AsyncButton pending={mutations.open.isLoading || mutations.setFacilitators.isLoading} onClick={open}>{t("openTheSession")}</AsyncButton>
      </div>
    </PageContainer>
  );
}

function FacilitatorDialog({ session, roundId, mutations, onClose }: {
  session: CalibrationSessionDto; roundId: string; mutations: Mutations; onClose: () => void;
}) {
  const t = useTranslations("calibration.FacilitatorDialog");
  const candidates = useFacilitatorCandidates(roundId);
  const [chosen, setChosen] = useState(() => new Set(session.facilitators.map((item) => item.userId)));
  const toggle = (userId: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  });
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !mutations.setFacilitators.isLoading) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("facilitators")}</DialogTitle></DialogHeader>
        {candidates.isLoading ? <Skeleton className="h-24" />
          : candidates.error ? <p className="type-body text-destructive" role="alert">{candidates.error.message}</p>
          : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {(candidates.data ?? []).map((candidate) => (
                <li key={candidate.userId}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2 type-body text-foreground">
                    <input type="checkbox" className="size-4 accent-primary" checked={chosen.has(candidate.userId)} onChange={() => toggle(candidate.userId)} />
                    {candidate.displayName}
                  </label>
                </li>
              ))}
            </ul>
          )}
        {mutations.setFacilitators.error ? <p className="type-body text-destructive" role="alert">{mutations.setFacilitators.error.message}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutations.setFacilitators.isLoading}>{t("cancel")}</Button>
          <AsyncButton pending={mutations.setFacilitators.isLoading} disabled={chosen.size === 0}
            onClick={async () => {
              try { await mutations.setFacilitators.mutateAsync({ userIds: [...chosen], expectedVersion: session.version }); onClose(); } catch { /* shown above */ }
            }}>
            {t("saveFacilitators")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
