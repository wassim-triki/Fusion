"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck } from "@repo/ds/icons";
import { toast } from "sonner";
import type {
  OrgUnitSelectionInput,
  PopulationCandidateDto,
  PopulationMode,
  SetPopulationRequest,
} from "@repo/api";
import { AsyncButton } from "@repo/ds/shell";
import { PopulationStepSkeleton } from "./setup-skeletons";
import {
  usePopulation,
  usePopulationMutations,
} from "@/features/performance/api/use-performance";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { SetupStepFooter } from "./setup-step-footer";
import { setupStepHref } from "./setup-readiness";
import { PopulationHero } from "./population/population-hero";
import { PopulationScope } from "./population/population-scope";
import { ResolvedPopulation } from "./population/resolved-population";
import { PeopleInScope } from "./population/people-in-scope";
import { ExcludeDialog, issueReason } from "./population/exclude-dialog";
import { AddInclusionSheet } from "./population/add-inclusion-sheet";
import { PersonDetailDrawer } from "./population/person-detail-drawer";
import {
  selectionToRequest,
} from "./population/population-model";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * Step 2 — Population. One workspace over the existing population domain: choose the scope, let
 * Fusion resolve the workforce and reviewers, resolve or exclude the blockers, then confirm. All
 * eligibility/roster truth stays on the backend; this orchestrates the selection edits (each a
 * wholesale PUT with cache write-through) and the confirm/reconfirm transition.
 */
export function PopulationStep({ cycleId }: { cycleId: string }) {
  const t = useTranslations("cycleSetup.PopulationStep");
  const words = useSay("common.words");
  const router = useRouter();
  const population = usePopulation(cycleId);
  const { set, confirm } = usePopulationMutations(cycleId);

  const [hasConfirmedOnce, setHasConfirmedOnce] = useState(false);
  const [excludeTarget, setExcludeTarget] =
    useState<PopulationCandidateDto | null>(null);
  const [inclusionSheetOpen, setInclusionSheetOpen] = useState(false);
  const [inspectTarget, setInspectTarget] =
    useState<PopulationCandidateDto | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);

  const data = population.data;
  const selection = data?.selection;

  useEffect(() => {
    if (selection?.isConfirmed) setHasConfirmedOnce(true);
  }, [selection?.isConfirmed]);

  const applyOptimistic = useCallback(
    (patch: Partial<SetPopulationRequest>, errorMessage: string) => {
      if (!selection) return;
      set
        .mutateAsync({ ...selectionToRequest(selection), ...patch, expectedVersion: selection.version })
        .catch((error) => reportPerformanceFailure(error, errorMessage));
    },
    [selection, set]
  );

  const onSetMode = useCallback(
    (mode: PopulationMode) => {
      if (!selection || selection.mode === mode) return;
      applyOptimistic({ mode }, t("couldNotChangeScope"));
    },
    [selection, applyOptimistic, t]
  );

  const onApplyOrgSelections = useCallback(
    (orgUnitSelections: OrgUnitSelectionInput[]) =>
      applyOptimistic(
        { mode: "ByScope", orgUnitSelections },
        t("couldNotUpdateScope")
      ),
    [applyOptimistic, t]
  );

  const onAddInclusions = useCallback(
    async (employeeIds: string[]) => {
      if (!selection) return;
      const existing = new Set(selection.inclusions);
      const additions = employeeIds.filter((id) => !existing.has(id));
      if (additions.length === 0) return;
      await set.mutateAsync({
        ...selectionToRequest(selection),
        inclusions: [...selection.inclusions, ...additions],
        expectedVersion: selection.version,
      });
    },
    [selection, set]
  );

  const onRemoveInclusion = useCallback(
    (employeeId: string) => {
      if (!selection) return;
      applyOptimistic(
        { inclusions: selection.inclusions.filter((id) => id !== employeeId) },
        t("couldNotRemove")
      );
    },
    [selection, applyOptimistic, t]
  );

  const onRestore = useCallback(
    (candidate: PopulationCandidateDto) => {
      if (!selection) return;
      applyOptimistic(
        {
          exclusions: selection.exclusions.filter(
            (exclusion) => exclusion.employeeId !== candidate.employeeId
          ),
        },
        t("couldNotRestore")
      );
    },
    [selection, applyOptimistic, t]
  );

  const onExcludeMany = useCallback(
    async (many: PopulationCandidateDto[], reason: string) => {
      if (!selection) return;
      const existing = new Set(
        selection.exclusions.map((exclusion) => exclusion.employeeId)
      );
      const additions = many
        .filter((candidate) => !existing.has(candidate.employeeId))
        .map((candidate) => ({ employeeId: candidate.employeeId, reason }));
      if (additions.length === 0) return;
      await set.mutateAsync({
        ...selectionToRequest(selection),
        exclusions: [...selection.exclusions, ...additions],
        expectedVersion: selection.version,
      });
    },
    [selection, set]
  );

  const onExcludeConfirmed = useCallback(
    async (reason: string) => {
      if (!selection || !excludeTarget) return;
      await set.mutateAsync({
        ...selectionToRequest(selection),
        exclusions: [
          ...selection.exclusions,
          { employeeId: excludeTarget.employeeId, reason },
        ],
        expectedVersion: selection.version,
      });
    },
    [selection, excludeTarget, set]
  );

  const inspect = useCallback((candidate: PopulationCandidateDto) => {
    setInspectTarget(candidate);
    setInspectOpen(true);
  }, []);

  // People the org-unit rule matched (everyone resolved except those added as individual
  // exceptions) — the real, resolved figure the scope picker reads back, not an estimate.
  const matchedCount = useMemo(
    () =>
      data && selection?.mode === "ByScope"
        ? data.candidates.filter((candidate) => !candidate.byExplicitInclusion)
            .length
        : null,
    [data, selection?.mode]
  );

  // The employees the current scope already covers (matched, not individually added), with the unit
  // they came in through — lets the picker say "already included through {unit}".
  const scopeMemberUnits = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const candidate of data?.candidates ?? []) {
      if (!candidate.byExplicitInclusion)
        map.set(candidate.employeeId, candidate.orgUnitName);
    }
    return map;
  }, [data?.candidates]);

  // The individually-added exceptions, resolved back with identity for the main section's list.
  const inclusionCandidates = useMemo(() => {
    const ids = new Set(selection?.inclusions ?? []);
    return (data?.candidates ?? []).filter((candidate) =>
      ids.has(candidate.employeeId)
    );
  }, [data?.candidates, selection?.inclusions]);

  if (population.error && (!data || !selection)) {
    return (
      <ContentUnavailable
        error={population.error}
        onRetry={population.refetch}
      />
    );
  }
  if (population.isLoading || !data || !selection) {
    return <PopulationStepSkeleton />;
  }

  const isConfirmed = selection.isConfirmed;
  const inclusionIds = new Set(selection.inclusions);
  const hasNoScope =
    selection.mode === "ByScope" && selection.orgUnitSelections.length === 0;
  const canConfirm =
    !hasNoScope && data.needsAttentionCount === 0 && data.readyCount > 0;
  const footerMessageId = "population-footer-status";

  return (
    <div className="space-y-6">
      <PopulationHero />

      <div>
        <h1 className="type-page-title text-foreground">{t("population")}</h1>
        <p className="mt-1 type-body-secondary text-muted-foreground">
          {t("selectWhoWillParticipateFusion")}
        </p>
      </div>

      <PopulationScope
        cycleId={cycleId}
        mode={selection.mode}
        eligibilityDate={selection.eligibilityDate}
        orgSelections={selection.orgUnitSelections}
        matchedCount={matchedCount}
        inclusions={inclusionCandidates}
        tenantName={null}
        onSetMode={onSetMode}
        onApplyOrgSelections={onApplyOrgSelections}
        onRemoveInclusion={onRemoveInclusion}
        onInspectInclusion={inspect}
        onOpenInclusionSheet={() => setInclusionSheetOpen(true)}
      />

      {hasNoScope ? null : (
        <>
          <ResolvedPopulation
            population={data}
            onRefresh={() => void population.refetch()}
            refreshing={population.isFetching || set.isLoading}
          />
          <PeopleInScope
            candidates={data.candidates}
            onExclude={setExcludeTarget}
            onRestore={onRestore}
            onExcludeMany={onExcludeMany}
            onRemoveInclusion={(candidate) =>
              onRemoveInclusion(candidate.employeeId)
            }
            onInspect={inspect}
          />
        </>
      )}

      <SetupStepFooter
        backHref={setupStepHref("details", cycleId)}
        center={
          isConfirmed ? (
            <div
              id={footerMessageId}
              className="flex flex-col items-center gap-0.5"
            >
              <span className="inline-flex items-center gap-2 type-label text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="size-4" aria-hidden />
                {t("populationConfirmed2")}
              </span>
              <span className="type-meta text-muted-foreground">
                {t("participantsReviewersResolved", { readyCount: data.readyCount, reviewerReadyCount: data.reviewerReadyCount })}
              </span>
            </div>
          ) : hasNoScope ? (
            <span
              id={footerMessageId}
              className="type-body-secondary text-muted-foreground"
            >
              {t("selectAnOrganizationUnitTo")}
            </span>
          ) : !canConfirm && data.needsAttentionCount > 0 ? (
            <span
              id={footerMessageId}
              className="type-label text-amber-600 dark:text-amber-400"
            >
              {data.needsAttentionCount}{" "}
              {data.needsAttentionCount === 1 ? t("issue") : t("issues")} {t("mustBeResolvedBeforeConfirmation")}
            </span>
          ) : data.readyCount === 0 ? (
            <span
              id={footerMessageId}
              className="type-body-secondary text-muted-foreground"
            >
              {t("atLeastOneEligibleParticipant")}
            </span>
          ) : hasConfirmedOnce ? (
            <div
              id={footerMessageId}
              className="flex flex-col items-center gap-0.5"
            >
              <span className="inline-flex items-center gap-2 type-label text-amber-600 dark:text-amber-400">
                {t("populationChangedConfirmItAgain")}
              </span>
              <span className="type-meta text-muted-foreground">
                {t("participantsReviewersResolved", { readyCount: data.readyCount, reviewerReadyCount: data.reviewerReadyCount })}
              </span>
            </div>
          ) : (
            <span
              id={footerMessageId}
              className="type-body-secondary text-muted-foreground"
            >
              {t("participantsReviewersResolved", { readyCount: data.readyCount, reviewerReadyCount: data.reviewerReadyCount })}
            </span>
          )
        }
      >
        {isConfirmed ? (
          <AsyncButton
            pending={false}
            onClick={() => router.push(setupStepHref("review", cycleId))}
          >
            {t("continue")}
            <ArrowRight className="size-4" data-icon="inline-end" />
          </AsyncButton>
        ) : (
          <AsyncButton
            pending={confirm.isLoading}
            disabled={!canConfirm}
            aria-describedby={footerMessageId}
            onClick={async () => {
              try {
                await confirm.mutateAsync(selection.version);
                setHasConfirmedOnce(true);
                toast.success(t("populationConfirmed"));
              } catch (error) {
                reportPerformanceFailure(error, t("couldNotConfirmThePopulation"));
              }
            }}
          >
            {hasConfirmedOnce ? t("reConfirmPopulation") : t("confirmPopulation")}
          </AsyncButton>
        )}
      </SetupStepFooter>

      <ExcludeDialog
        name={excludeTarget?.displayName ?? null}
        defaultReason={excludeTarget ? issueReason(excludeTarget, selection.eligibilityDate, words) : undefined}
        open={excludeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setExcludeTarget(null);
        }}
        onExclude={onExcludeConfirmed}
      />

      <AddInclusionSheet
        open={inclusionSheetOpen}
        onOpenChange={setInclusionSheetOpen}
        inclusionIds={inclusionIds}
        scopeMembers={scopeMemberUnits}
        onAddMany={onAddInclusions}
      />

      <PersonDetailDrawer
        candidate={inspectTarget}
        open={inspectOpen}
        onOpenChange={setInspectOpen}
        eligibilityDate={selection.eligibilityDate}
        onExclude={(candidate) => {
          setInspectOpen(false);
          setExcludeTarget(candidate);
        }}
        onRestore={(candidate) => {
          setInspectOpen(false);
          onRestore(candidate);
        }}
      />
    </div>
  );
}
