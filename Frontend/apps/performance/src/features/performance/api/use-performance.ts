"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPerformanceApi,
  createPlatformApiClient,
  performanceQueryKeys,
  type AddPlanObjectiveRequest,
  type DevelopmentGoalInput,
  type ConfigureContributionRequest,
  type CreateCycleRequest,
  type CreateOrganizationalObjectiveRequest,
  type CreateStrategicObjectiveRequest,
  type CompetencyDto,
  type CreateCompetencyRequest,
  type UpdateCompetencyRequest,
  type UpdateRatingScaleRequest,
  type ExceptionalApprovePlanRequest,
  type PopulationDto,
  type ReturnPlanRequest,
  type SetPopulationRequest,
  type ProgressUpdateDto,
  type SubmitProgressRequest,
  type UpdateCycleRequest,
  type UpdateOrganizationalObjectiveRequest,
  type UpdatePlanObjectiveRequest,
  type UpdateStrategicObjectiveRequest,
} from "@repo/api";
import { useApiMutation, useApiQuery, useApiQueryClient, type UseApiMutationOptions } from "@repo/api/query";
import { recoverPerformanceFailure } from "./performance-failure";
import { useSelectedCycleId, useWorkspaceContext } from "./use-workspace";
import type { InsightsPeopleQuery, YourPeopleQuery } from "@repo/api";
import type { CloseCycleRequest, CycleDetailDto } from "@repo/api";

type RequestDraft<T> = Omit<T, "expectedVersion">;

function usePerformanceMutation<TData, TArgs = void>(fn: (args: TArgs) => Promise<TData>, options?: UseApiMutationOptions<TData, TArgs>) {
  const queryClient = useApiQueryClient();
  return useApiMutation(fn, {
    ...options,
    onError: async (error, args) => {
      await recoverPerformanceFailure(error, () => queryClient.invalidateQueries({ queryKey: performanceQueryKeys.all() }));
      await options?.onError?.(error, args);
    },
  });
}

const withVersion = <T extends object>(request: T, expectedVersion: number) => ({ ...request, expectedVersion });

export function useApis() {
  const client = useMemo(() => createPlatformApiClient(), []);
  return useMemo(
    () => ({
      performance: createPerformanceApi(client),
    }),
    [client]
  );
}

/** One person's performance as the caller may see it (D-32). */
export function usePersonSummary(employeeId: string, cycleId?: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.personSummary(employeeId, cycleId),
    (signal) => performance.getPersonSummary(employeeId, cycleId, signal),
    { enabled: enabled && Boolean(employeeId) },
  );
}

export function useCycle(cycleId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.cycle(cycleId ?? "none"),
    (signal) => performance.getCycle(cycleId as string, signal),
    { enabled: Boolean(cycleId) }
  );
}

/** The selected Cycle detail, using workspace context when the route has no Cycle address. */
export function useCurrentCycle(enabled = true) {
  const { performance } = useApis();
  const selected = useSelectedCycleId();
  const context = useWorkspaceContext(enabled && selected === null);
  const cycleId = selected ?? context.data?.selected?.id ?? null;
  const detail = useApiQuery<CycleDetailDto | null>(
    performanceQueryKeys.cycle(cycleId ?? "none"),
    (signal) => cycleId ? performance.getCycle(cycleId, signal) : Promise.resolve(null),
    { enabled: enabled && Boolean(cycleId) }
  );
  return {
    ...detail,
    isLoading: detail.isLoading || (enabled && selected === null && context.isLoading),
  };
}

export function useSettings(enabled = true) {
  const { performance } = useApis();
  return useApiQuery(performanceQueryKeys.settings(), (signal) => performance.getSettings(signal), {
    enabled,
  });
}

export function useRatingScale(enabled = true) {
  const { performance } = useApis();
  return useApiQuery(performanceQueryKeys.ratingScale(), (signal) => performance.ratingScale(signal), { enabled });
}

export function useUpdateRatingScale() {
  const { performance } = useApis();
  return usePerformanceMutation((request: UpdateRatingScaleRequest) =>
    performance.updateRatingScale(request), {
      invalidateQueries: [{ queryKey: performanceQueryKeys.ratingScale() }],
    });
}

export function useCompetencies(enabled = true) {
  const { performance } = useApis();
  return useApiQuery(performanceQueryKeys.competencies(), (signal) => performance.getCompetencies(signal), { enabled });
}

export function useCompetencyMutations() {
  const { performance } = useApis();
  const cache = useApiQueryClient();
  const invalidate = [{ queryKey: performanceQueryKeys.competencies() }];
  const replaceItem = (items: CompetencyDto[] | undefined, value: CompetencyDto) =>
    items?.some((item) => item.id === value.id) ? items.map((item) => item.id === value.id ? value : item) : [...(items ?? []), value];
  return {
    create: usePerformanceMutation((request: CreateCompetencyRequest) => performance.createCompetency(request), {
      invalidateQueries: invalidate,
      onSuccess: (value) => { cache.setQueryData<CompetencyDto[]>(performanceQueryKeys.competencies(), (current) => replaceItem(current, value)); },
    }),
    update: usePerformanceMutation(({ id, ...request }: { id: string } & UpdateCompetencyRequest) => {
      return performance.updateCompetency(id, request);
    }, { invalidateQueries: invalidate, onSuccess: (value) => { cache.setQueryData<CompetencyDto[]>(performanceQueryKeys.competencies(), (current) => replaceItem(current, value)); } }),
    archive: usePerformanceMutation((args: { id: string; expectedVersion: number }) => {
      return performance.archiveCompetency(args.id, { expectedVersion: args.expectedVersion });
    }, {
      invalidateQueries: invalidate,
      onSuccess: (value) => { cache.setQueryData<CompetencyDto[]>(performanceQueryKeys.competencies(), (current) => replaceItem(current, value)); },
    }),
    remove: usePerformanceMutation((args: { id: string; expectedVersion: number }) => {
      return performance.deleteCompetency(args.id, { expectedVersion: args.expectedVersion });
    }, {
      invalidateQueries: invalidate,
      onSuccess: (_value, args) => { cache.setQueryData<CompetencyDto[]>(performanceQueryKeys.competencies(), (current) => current?.filter((item) => item.id !== args.id)); },
    }),
  };
}

export function useStrategy(cycleId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.strategy(cycleId ?? "none"),
    (signal) => performance.listStrategy(cycleId as string, signal),
    { enabled: Boolean(cycleId) }
  );
}

export function usePopulation(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.population(cycleId ?? "none"),
    (signal) => performance.getPopulation(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

export function useGoals(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.goals(cycleId ?? "none"),
    (signal) => performance.getGoals(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

/** The cycle's alignment map (D-06): published direction for everyone, personal objectives as visibility allows. */
export function useAlignmentMap(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.alignmentMap(cycleId ?? "none"),
    (signal) => performance.getAlignmentMap(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

export function useTeamObjectiveWorkspace(
  cycleId: string | null,
  orgUnitId?: string | null,
  enabled = true
) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.teamObjectiveWorkspace(cycleId ?? "none", orgUnitId),
    (signal) => performance.getTeamObjectiveWorkspace(cycleId as string, orgUnitId, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

export function useGoal(cycleId: string | null, objectiveId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.goal(cycleId ?? "none", objectiveId ?? "none"),
    (signal) => performance.getGoal(cycleId as string, objectiveId as string, signal),
    { enabled: Boolean(cycleId) && Boolean(objectiveId) }
  );
}

export function useGoalMutations(cycleId: string) {
  const { performance } = useApis();
  // Any goal mutation can change the graph and any node's detail, so invalidate the whole goals
  // area plus the current Cycle detail (counts on the overview).
  const invalidate = [
    { queryKey: performanceQueryKeys.goals(cycleId) },
    { queryKey: performanceQueryKeys.alignmentTargets(cycleId) },
    { queryKey: [...performanceQueryKeys.all(), "team-objectives", cycleId] },
    { queryKey: [...performanceQueryKeys.all(), "goal", cycleId] },
    { queryKey: [...performanceQueryKeys.all(), "progress", cycleId] },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
  ];
  const create = usePerformanceMutation(
    (args: { request: RequestDraft<CreateOrganizationalObjectiveRequest>; expectedVersion: number }) => performance.createTeamObjective(cycleId, withVersion(args.request, args.expectedVersion)),
    { invalidateQueries: invalidate }
  );
  const update = usePerformanceMutation(
    (args: { objectiveId: string; request: RequestDraft<UpdateOrganizationalObjectiveRequest>; expectedVersion: number }) =>
      performance.updateGoal(cycleId, args.objectiveId, withVersion(args.request, args.expectedVersion)),
    { invalidateQueries: invalidate }
  );
  const publish = usePerformanceMutation((args: { objectiveId: string; expectedVersion: number }) => performance.publishGoal(cycleId, args.objectiveId, args.expectedVersion), {
    invalidateQueries: invalidate,
  });
  const configureContribution = usePerformanceMutation(
    (args: { objectiveId: string; request: RequestDraft<ConfigureContributionRequest>; expectedVersion: number }) =>
      performance.configureGoalContribution(cycleId, args.objectiveId, withVersion(args.request, args.expectedVersion)),
    { invalidateQueries: invalidate }
  );
  const lockContribution = usePerformanceMutation(
    (args: { objectiveId: string; expectedVersion: number }) => performance.lockGoalContribution(cycleId, args.objectiveId, args.expectedVersion),
    { invalidateQueries: invalidate }
  );
  const remove = usePerformanceMutation((args: { objectiveId: string; expectedVersion: number }) => performance.deleteGoal(cycleId, args.objectiveId, args.expectedVersion), {
    invalidateQueries: invalidate,
  });
  const archive = usePerformanceMutation((args: { objectiveId: string; expectedVersion: number }) => performance.archiveGoal(cycleId, args.objectiveId, args.expectedVersion), { invalidateQueries: invalidate });
  return { create, update, publish, archive, configureContribution, lockContribution, remove };
}

// ── Employee plans (Chunk C) ───────────────────────────────────────────────────

export function useMyPlan(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.myPlan(cycleId ?? "none"),
    (signal) => performance.getMyPlan(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}

export function useAlignmentTargets(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.alignmentTargets(cycleId ?? "none"),
    (signal) => performance.getAlignmentTargets(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}


/**
 * Your People: one server page of the caller's recorded responsibility. The previous page stays on screen
 * while the next view or page loads, so the table never collapses to a skeleton between pages.
 */
export function useYourPeople(cycleId: string | null, query: YourPeopleQuery, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.yourPeople(cycleId ?? "none", query),
    (signal) => performance.getYourPeople(cycleId as string, query, signal),
    { enabled: Boolean(cycleId) && enabled, placeholderData: (previous) => previous }
  );
}


/** The released results of the caller's own team; empty until a round's results are released. */
export function useTeamResults(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.teamResults(cycleId ?? "none"),
    (signal) => performance.getTeamResults(cycleId as string, signal),
    { enabled: Boolean(cycleId) && enabled }
  );
}


/** Cycle › Insights for cycle administrators, scoped to one org unit and its sub-units when given. */
export function useInsights(cycleId: string | null, unitId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.insights(cycleId ?? "none", unitId),
    (signal) => performance.getInsights(cycleId as string, unitId, signal),
    { enabled: Boolean(cycleId) && enabled, placeholderData: (previous) => previous }
  );
}

/** The people behind one Insights figure, a server page at a time. */
export function useInsightsPeople(cycleId: string | null, query: InsightsPeopleQuery | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.insightsPeople(cycleId ?? "none", query ?? { metric: "people" }),
    (signal) => performance.getInsightsPeople(cycleId as string, query as InsightsPeopleQuery, signal),
    { enabled: Boolean(cycleId) && query !== null, placeholderData: (previous) => previous }
  );
}


export function usePlanDetail(cycleId: string | null, planId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.planDetail(cycleId ?? "none", planId ?? "none"),
    (signal) => performance.getPlanDetail(cycleId as string, planId as string, signal),
    { enabled: Boolean(cycleId) && Boolean(planId) }
  );
}

/** Employee authoring: create/edit/weight/submit the caller's own plan. */
export function usePlanMutations(cycleId: string) {
  const { performance } = useApis();
  const invalidate = [
    { queryKey: performanceQueryKeys.myPlan(cycleId) },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
  ];
  const create = usePerformanceMutation((expectedVersion: number) => performance.createMyPlan(cycleId, expectedVersion), { invalidateQueries: invalidate });
  const addObjective = usePerformanceMutation(
    (args: { request: RequestDraft<AddPlanObjectiveRequest>; expectedVersion: number }) => performance.addPlanObjective(cycleId, withVersion(args.request, args.expectedVersion)),
    { invalidateQueries: invalidate }
  );
  const updateObjective = usePerformanceMutation(
    (args: { objectiveId: string; request: RequestDraft<UpdatePlanObjectiveRequest>; expectedVersion: number }) =>
      performance.updatePlanObjective(cycleId, args.objectiveId, withVersion(args.request, args.expectedVersion)),
    { invalidateQueries: invalidate }
  );
  const removeObjective = usePerformanceMutation(
    (args: { objectiveId: string; expectedVersion: number }) => performance.removePlanObjective(cycleId, args.objectiveId, args.expectedVersion),
    { invalidateQueries: invalidate }
  );
  const submit = usePerformanceMutation((expectedVersion: number) => performance.submitPlan(cycleId, expectedVersion), { invalidateQueries: invalidate });
  const addressChangeRequest = usePerformanceMutation(
    (args: { requestId: string; reply: string | null; expectedVersion: number }) =>
      performance.addressChangeRequest(cycleId, args.requestId, { reply: args.reply, expectedVersion: args.expectedVersion }),
    { invalidateQueries: [...invalidate, { queryKey: [...performanceQueryKeys.all(), "plan", cycleId] }] }
  );
  return { create, addObjective, updateObjective, removeObjective, submit, addressChangeRequest };
}

/** Manager/administrator decision: return, approve, or exceptionally approve a submitted plan. */
export function usePlanReviewMutations(cycleId: string, planId: string) {
  const { performance } = useApis();
  const invalidate = [
    { queryKey: performanceQueryKeys.planDetail(cycleId, planId) },
    { queryKey: performanceQueryKeys.yourPeople(cycleId) },
    { queryKey: performanceQueryKeys.overviews() },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
  ];
  const approve = usePerformanceMutation((expectedVersion: number) => performance.approvePlan(cycleId, planId, expectedVersion), { invalidateQueries: invalidate });
  const returnForRevision = usePerformanceMutation(
    (request: ReturnPlanRequest) => performance.returnPlan(cycleId, planId, request),
    { invalidateQueries: invalidate }
  );
  const exceptionalApprove = usePerformanceMutation(
    (request: ExceptionalApprovePlanRequest) => performance.exceptionalApprovePlan(cycleId, planId, request),
    { invalidateQueries: invalidate }
  );
  return { approve, returnForRevision, exceptionalApprove };
}

// ── Progress & contribution (Chunk D) ──────────────────────────────────────────

export function useObjectiveProgress(cycleId: string | null, objectiveId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.objectiveProgress(cycleId ?? "none", objectiveId ?? "none"),
    (signal) => performance.getObjectiveProgress(cycleId as string, objectiveId as string, signal),
    { enabled: Boolean(cycleId) && Boolean(objectiveId) }
  );
}

/** Owner progress recording on one objective, plus evidence staging. Refreshes every surface that reads its execution truth. */
export function useProgressMutations(cycleId: string, objectiveId: string) {
  const { performance } = useApis();
  const invalidate = [
    { queryKey: performanceQueryKeys.objectiveProgress(cycleId, objectiveId) },
    { queryKey: performanceQueryKeys.myPlan(cycleId) },
    // Organization Goals carries progress on every hierarchy node. A child update can also change
    // one or more calculated ancestors, so refresh the bounded cycle overview and open goal details.
    { queryKey: performanceQueryKeys.goals(cycleId) },
    { queryKey: [...performanceQueryKeys.all(), "team-objectives", cycleId] },
    { queryKey: [...performanceQueryKeys.all(), "goal", cycleId] },
    // Progress can satisfy an open update request on the objective or its plan.
    { queryKey: [...performanceQueryKeys.all(), "update-requests", cycleId] },
    { queryKey: performanceQueryKeys.overviews() },
    // Status shows on the plan record and the person summary.
    { queryKey: [...performanceQueryKeys.all(), "plan", cycleId] },
    { queryKey: [...performanceQueryKeys.all(), "person-summary"] },
  ];
  const submit = usePerformanceMutation(
    (request: SubmitProgressRequest) => performance.submitProgress(cycleId, objectiveId, request),
    { invalidateQueries: invalidate }
  );
  const uploadEvidence = usePerformanceMutation((file: File) => performance.uploadEvidence(cycleId, objectiveId, file));
  return { submit, uploadEvidence, evidenceDownloadPath: (id: string) => performance.evidenceDownloadPath(cycleId, id) };
}

/** The plan's responsible reviewer acknowledges an objective's at-risk or off-track status (D-05). */
export function useAcknowledgeStatus(cycleId: string, objectiveId: string) {
  const { performance } = useApis();
  return usePerformanceMutation(
    (expectedVersion: number) => performance.acknowledgeObjectiveStatus(cycleId, objectiveId, expectedVersion),
    {
      invalidateQueries: [
        { queryKey: performanceQueryKeys.goal(cycleId, objectiveId) },
        { queryKey: [...performanceQueryKeys.all(), "plan", cycleId] },
        { queryKey: performanceQueryKeys.yourPeople(cycleId) },
      ],
    }
  );
}

// ── Development (D-34) ─────────────────────────────────────────────────────────

export function useDevelopmentPlan(cycleId: string | null, employeeId: string | null) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.development(cycleId ?? "none", employeeId ?? "none"),
    (signal) => performance.getDevelopmentPlan(cycleId as string, employeeId as string, signal),
    { enabled: Boolean(cycleId) && Boolean(employeeId) }
  );
}

/** The employee and their reviewer keep the goals together; every change returns the whole plan. */
export function useDevelopmentMutations(cycleId: string, employeeId: string) {
  const { performance } = useApis();
  const invalidateQueries = [
    { queryKey: performanceQueryKeys.development(cycleId, employeeId) },
    { queryKey: [...performanceQueryKeys.all(), "person-summary", employeeId] },
  ];
  const add = usePerformanceMutation(
    (input: DevelopmentGoalInput) => performance.addDevelopmentGoal(cycleId, employeeId, input),
    { invalidateQueries }
  );
  const update = usePerformanceMutation(
    (args: { goalId: string; input: DevelopmentGoalInput }) => performance.updateDevelopmentGoal(cycleId, employeeId, args.goalId, args.input),
    { invalidateQueries }
  );
  const remove = usePerformanceMutation(
    (args: { goalId: string; expectedVersion: number }) => performance.removeDevelopmentGoal(cycleId, employeeId, args.goalId, args.expectedVersion),
    { invalidateQueries }
  );
  const carryOver = usePerformanceMutation(
    (args: { goalIds: string[]; expectedVersion: number }) => performance.carryOverDevelopmentGoals(cycleId, employeeId, args.goalIds, args.expectedVersion),
    // The earlier plan's goals become carried too.
    { invalidateQueries: [...invalidateQueries, { queryKey: [...performanceQueryKeys.all(), "development"] }] }
  );
  const dismiss = usePerformanceMutation(
    (expectedVersion: number) => performance.dismissDevelopmentCarryOver(cycleId, employeeId, expectedVersion),
    { invalidateQueries }
  );
  return { add, update, remove, carryOver, dismiss };
}

/**
 * Opens a file-evidence item in a new tab. The download endpoint is bearer-authenticated, so a plain
 * link cannot carry the token; this fetches the file as a Blob through the authenticated client and hands
 * the tab a same-origin object URL. The blank tab is opened synchronously inside the click gesture so the
 * popup blocker permits it, then pointed at the blob once it resolves. `openingId` marks the row in flight.
 */
export function useEvidenceOpener(cycleId: string | null) {
  const { performance } = useApis();
  const [openingId, setOpeningId] = useState<string | null>(null);

  const open = useCallback(
    async (evidenceId: string) => {
      if (!cycleId || typeof window === "undefined") return;
      const tab = window.open("about:blank", "_blank");
      setOpeningId(evidenceId);
      try {
        const blob = await performance.downloadEvidence(cycleId, evidenceId);
        const url = URL.createObjectURL(blob);
        if (tab) tab.location.href = url;
        else window.open(url, "_blank");
        // Revoke once the tab has had time to load the resource.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (error) {
        tab?.close();
        throw error;
      } finally {
        setOpeningId(null);
      }
    },
    [cycleId, performance]
  );

  return { open, openingId };
}

/**
 * Progressive loading for an objective's progress history. Seeded with the first page the progress surface
 * already carries, it appends older keyset-paginated pages on demand. Resets whenever the objective changes
 * or a new update lands at the top (a submit), so the accumulated tail never drifts from the refreshed head.
 */
export function useProgressHistoryPager(
  cycleId: string,
  objectiveId: string,
  firstPage: ProgressUpdateDto[],
  firstCursor: string | null
) {
  const { performance } = useApis();
  const [extra, setExtra] = useState<ProgressUpdateDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const topId = firstPage[0]?.id ?? null;
  useEffect(() => {
    setExtra([]);
    setCursor(firstCursor);
  }, [objectiveId, topId, firstCursor]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await performance.getObjectiveProgressHistory(cycleId, objectiveId, cursor);
      setExtra((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [performance, cycleId, objectiveId, cursor, loadingMore]);

  return {
    items: extra.length > 0 ? [...firstPage, ...extra] : firstPage,
    hasMore: cursor != null,
    loadingMore,
    loadMore,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateCycle() {
  const { performance } = useApis();
  return usePerformanceMutation((request: RequestDraft<CreateCycleRequest>) => performance.createCycle(request), {
    invalidateQueries: [
      { queryKey: [...performanceQueryKeys.all(), "workspace-context"] },
    ],
  });
}

export function useUpdateCycle(cycleId: string) {
  const { performance } = useApis();
  return usePerformanceMutation((request: UpdateCycleRequest) => performance.updateCycle(cycleId, request), {
    invalidateQueries: [
      { queryKey: [...performanceQueryKeys.all(), "workspace-context"] },
      { queryKey: performanceQueryKeys.cycle(cycleId) },
    ],
  });
}

export function useActivateCycle(cycleId: string) {
  const { performance } = useApis();
  return usePerformanceMutation((expectedVersion: number) => performance.activateCycle(cycleId, expectedVersion), {
    invalidateQueries: [
      { queryKey: [...performanceQueryKeys.all(), "workspace-context"] },
      { queryKey: performanceQueryKeys.cycle(cycleId) },
    ],
  });
}

/** What closing the Cycle would involve — administration only. */
export function useCycleClosure(cycleId: string | null, enabled = true) {
  const { performance } = useApis();
  return useApiQuery(
    performanceQueryKeys.cycleClosure(cycleId ?? "none"),
    () => performance.cycleClosure(cycleId as string),
    { enabled: Boolean(cycleId) && enabled }
  );
}

const cycleLifecycleInvalidations = (cycleId: string) => [
  { queryKey: [...performanceQueryKeys.all(), "workspace-context"] },
  { queryKey: performanceQueryKeys.cycle(cycleId) },
  { queryKey: performanceQueryKeys.cycleClosure(cycleId) },
];

export function useCloseCycle(cycleId: string) {
  const { performance } = useApis();
  return usePerformanceMutation((args: { request: CloseCycleRequest; expectedVersion: number }) => performance.closeCycle(cycleId, args.request, args.expectedVersion), {
    // Closing changes what every surface can do, so refresh the whole module.
    invalidateQueries: [{ queryKey: performanceQueryKeys.all() }],
  });
}

export function useDeleteDraftCycle(cycleId: string) {
  const { performance } = useApis();
  return usePerformanceMutation((expectedVersion: number) => performance.deleteDraftCycle(cycleId, expectedVersion), {
    invalidateQueries: cycleLifecycleInvalidations(cycleId),
  });
}

export function useUpdateSettings() {
  const { performance } = useApis();
  return usePerformanceMutation((request: Parameters<typeof performance.updateSettings>[0]) => performance.updateSettings(request), {
    invalidateQueries: [{ queryKey: performanceQueryKeys.settings() }],
  });
}

export function useSaveStrategy(cycleId: string) {
  const { performance } = useApis();
  // A company/strategic objective is a root node in the Organization Goals cascade, so any
  // strategic mutation must refresh the goals overview too (§60 — one objective truth, no manual
  // refresh) alongside the Cycle detail counts.
  const invalidate = [
    { queryKey: performanceQueryKeys.strategy(cycleId) },
    { queryKey: [...performanceQueryKeys.all(), "goal", cycleId] },
    { queryKey: [...performanceQueryKeys.all(), "team-objectives", cycleId] },
    { queryKey: performanceQueryKeys.goals(cycleId) },
    { queryKey: performanceQueryKeys.alignmentTargets(cycleId) },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
    { queryKey: performanceQueryKeys.cycle(cycleId) },
  ];
  const create = usePerformanceMutation(
    (args: RequestDraft<CreateStrategicObjectiveRequest> & { expectedVersion: number }) => {
      const { expectedVersion, ...request } = args;
      return performance.createStrategy(cycleId, withVersion(request, expectedVersion));
    },
    { invalidateQueries: invalidate }
  );
  const update = usePerformanceMutation(
    (args: { objectiveId: string; request: RequestDraft<UpdateStrategicObjectiveRequest>; expectedVersion: number }) =>
      performance.updateStrategy(cycleId, args.objectiveId, withVersion(args.request, args.expectedVersion)),
    { invalidateQueries: invalidate }
  );
  const publish = usePerformanceMutation(
    (args: { objectiveId: string; expectedVersion: number }) => performance.publishStrategy(cycleId, args.objectiveId, args.expectedVersion),
    { invalidateQueries: invalidate }
  );
  const remove = usePerformanceMutation(
    (args: { objectiveId: string; expectedVersion: number }) => performance.deleteStrategy(cycleId, args.objectiveId, args.expectedVersion),
    { invalidateQueries: invalidate }
  );
  const archive = usePerformanceMutation((args: { objectiveId: string; expectedVersion: number }) => performance.archiveStrategy(cycleId, args.objectiveId, args.expectedVersion), { invalidateQueries: invalidate });
  return { create, update, publish, archive, remove };
}

export function usePopulationMutations(cycleId: string) {
  const { performance } = useApis();
  const queryClient = useApiQueryClient();

  // Scope edits (org selections, include-sub-units) fire often during setup. The PUT
  // already returns the fully recomputed population, so write it straight into the
  // cache instead of invalidating and paying a second GET. Overview counts refresh in
  // the background (fire-and-forget) so the interaction never waits on them.
  const set = usePerformanceMutation(
    (request: SetPopulationRequest) => performance.setPopulation(cycleId, request),
    {
      onSuccess: (data: PopulationDto) => {
        queryClient.setQueryData(performanceQueryKeys.population(cycleId), data);
        void queryClient.invalidateQueries({ queryKey: performanceQueryKeys.cycle(cycleId) });
      },
    }
  );

  const confirm = usePerformanceMutation((expectedVersion: number) => performance.confirmPopulation(cycleId, expectedVersion), {
    invalidateQueries: [
      { queryKey: performanceQueryKeys.population(cycleId) },
      { queryKey: performanceQueryKeys.cycle(cycleId) },
      { queryKey: performanceQueryKeys.cycle(cycleId) },
    ],
  });
  return { set, confirm };
}
