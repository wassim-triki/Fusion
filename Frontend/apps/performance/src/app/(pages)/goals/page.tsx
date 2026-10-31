"use client";

import { Suspense, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListView, MapView, Plus } from "@/lib/icons";
import { toast } from "sonner";
import { Button } from "@repo/ds/components/ui/button";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Segmented } from "@repo/ds/choice";
import { useOrgHierarchy } from "@repo/workforce-ui";
import { PageContainer, PageError, PageHeader, PagePermissionNotice, PageSkeleton } from "@repo/ds/shell";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { useObjectiveRecord } from "@/features/performance/components/objective-record/use-objective-record";
import { ObjectiveWorkspace } from "@/features/performance/components/goals/objective-workspace";
import {
  OrgComposerHost,
  type ComposerState,
} from "@/features/performance/components/goals/org-composer-host";
import {
  CompanyComposerHost,
  type CompanyComposerState,
} from "@/features/performance/components/goals/company-composer-host";
import {
  scopeUnitsFromTree,
  WorkingScopeSelector,
} from "@/features/performance/components/goals/working-scope-selector";
import { type UnitContext } from "@/features/performance/components/goals/working-context-lib";
import { resolveDirectionView } from "@/features/performance/components/goals/direction-view";
import {
  useAlignmentMap,
  useCurrentCycle,
  useGoals,
  useGoalMutations,
  useSaveStrategy,
} from "@/features/performance/api/use-performance";
import { useWorkforceMe } from "@/features/performance/api/use-workforce-me";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { useTranslations } from "next-intl";

function MapSkeleton() {
  const t = useTranslations("goals.MapSkeleton");
  return (
    <div className="grid h-full min-h-[420px] place-items-center rounded-surface bg-section" aria-label={t("loadingTheAlignmentMap")}>
      <div className="space-y-6">
        <Skeleton className="mx-auto h-28 w-64 rounded-surface" />
        <div className="flex gap-8">
          <Skeleton className="h-28 w-64 rounded-surface" />
          <Skeleton className="h-28 w-64 rounded-surface" />
        </div>
      </div>
    </div>
  );
}

const AlignmentMap = dynamic(() => import("@/features/performance/components/goals/alignment-map"), {
  ssr: false,
  loading: MapSkeleton,
});

export default function GoalsPage() {
  const t = useTranslations("goals.GoalsPage");
  return (
    <Suspense fallback={<PageSkeleton rows={4} label={t("loadingGoals")} />}>
      <GoalsWorkspace />
    </Suspense>
  );
}

function GoalsWorkspace() {
  const t = useTranslations("goals.GoalsWorkspace");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const context = useWorkspaceContext();
  const capabilities = context.data?.capabilities;
  // Everyone in Performance reads published direction on the map (D-06). The List is the authoring
  // workspace for organizational responsibility, so only direction authority gets it.
  const canList = capabilities?.canViewOrgDirection ?? false;
  const view = resolveDirectionView(searchParams.get("view"), canList);
  const listing = view === "list";
  // Authority (not placement) decides the List's default context. A tenant-wide actor (administration, or
  // tenant-breadth read) is responsible for the whole organization, so they land organization-wide;
  // everyone else is centered on the unit they actually belong to. Both drill the same hierarchy.
  const broad = capabilities?.canChooseOrganizationScope ?? false;
  const canReachSetup = capabilities?.administers || capabilities?.publishesStrategy || false;
  const requestedScopeId = searchParams.get("scope");
  const focusId = searchParams.get("focus");
  const nearId = searchParams.get("near");

  const detail = useCurrentCycle(Boolean(capabilities));
  const cycle = detail.data?.cycle ?? null;
  const map = useAlignmentMap(cycle?.id ?? null, !listing);
  const goals = useGoals(cycle?.id ?? null, listing);
  // The actor's own organizational context — resolved from real workforce data, never fabricated.
  // Fetched for every List viewer (not just non-broad ones) so a broad actor with a real
  // placement can narrow the working scope to their own unit (§33). Absent for a placement-less admin.
  const me = useWorkforceMe(listing);
  // A CoreHR tree is fetched only for broad viewers who can actually switch organizational context.
  // Managers stay within their workforce placement, even if the MVP's coarse permission happens to
  // be technically wider.
  const organization = useOrgHierarchy(listing && broad);
  // Mutation hooks live above every early return so hook order is stable; they no-op until invoked and
  // the id is only meaningful once the Cycle resolves.
  const goalMutations = useGoalMutations(cycle?.id ?? "");
  const strategyMutations = useSaveStrategy(cycle?.id ?? "");

  // The branch to reveal after a mutation — the parent of a just-created/edited objective.
  const [revealId, setRevealId] = useState<string | null>(null);
  const record = useObjectiveRecord();
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [companyComposer, setCompanyComposer] =
    useState<CompanyComposerState | null>(null);

  const ownUnit: UnitContext | null = useMemo(() => {
    const org = me.data?.employee?.orgUnit;
    if (!org) return null;
    return {
      orgUnitId: org.orgUnitId,
      name: org.name,
      type: org.type,
      path: org.path,
      memberCount: me.data?.orgUnitMemberCount ?? null,
      isOwnUnit: true,
    };
  }, [me.data]);

  const scopeUnits = useMemo(
    () => scopeUnitsFromTree(organization.data?.roots ?? []),
    [organization.data]
  );
  const selectedScope = useMemo(
    () =>
      requestedScopeId
        ? (scopeUnits.find((unit) => unit.id === requestedScopeId) ?? null)
        : null,
    [requestedScopeId, scopeUnits]
  );
  const workingUnit: UnitContext | null = broad
    ? selectedScope
      ? {
          orgUnitId: selectedScope.id,
          name: selectedScope.name,
          type: selectedScope.type,
          path: selectedScope.path,
          memberCount: selectedScope.memberCount,
          isOwnUnit: selectedScope.id === ownUnit?.orgUnitId,
        }
      : null
    : ownUnit;
  const organizationWide = broad && workingUnit === null;

  const replaceContext = (next: {
    focusId?: string | null;
    scopeId?: string | null;
    view?: "map" | "list";
  }) => {
    const query = new URLSearchParams(searchParams.toString());
    if (next.focusId !== undefined) {
      if (next.focusId) query.set("focus", next.focusId);
      else query.delete("focus");
    }
    if (next.scopeId !== undefined) {
      if (next.scopeId) query.set("scope", next.scopeId);
      else query.delete("scope");
    }
    if (next.view !== undefined) query.set("view", next.view);
    router.replace(`${pathname}${query.size ? `?${query.toString()}` : ""}`, {
      scroll: false,
    });
  };

  if (context.isLoading)
    return <PageSkeleton rows={4} label={t("loadingPerformance")} />;
  if (context.error)
    return <ContentUnavailable error={context.error} onRetry={context.refetch} subject={t("performanceWorkspace")} />;
  if (detail.isLoading) return <PageSkeleton rows={4} label={t("loadingCycle")} />;
  if (detail.error)
    return (
      <ContentUnavailable
        error={detail.error}
        onRetry={detail.refetch}
        subject={t("theCycle")}
      />
    );
  if (!cycle) {
    return (
      <PageContainer>
        <PagePermissionNotice
          title={t("noCycleYet")}
          description={t("organizationDirectionOpensOnceA")}
        />
      </PageContainer>
    );
  }

  // Authoring organizational objectives is governed by organizational-scope management authority
  // (governed admin, or the org-manage grant). The precise per-org-unit check is enforced
  // server-side when the unit is chosen, so this only decides whether to offer the affordance.
  const canAuthorOrgObjectives =
    (capabilities?.administers ?? false) || (capabilities?.managesOrgObjectives ?? false);
  // Company (strategic) direction — create / edit / publish — is the strategy-publish authority.
  const canManageCompany =
    (capabilities?.administers ?? false) || (capabilities?.publishesStrategy ?? false);

  async function handleDeleteOrg(objectiveId: string) {
    try {
      const version = goals.data?.nodes.find((node) => node.id === objectiveId)?.version;
      if (version === undefined) throw new Error("Refresh this objective before making changes.");
      await goalMutations.remove.mutateAsync({ objectiveId, expectedVersion: version });
      toast.success(t("draftObjectiveRemoved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove the objective."
      );
    }
  }

  async function handlePublishCompany(objectiveId: string) {
    try {
      const version = goals.data?.nodes.find((node) => node.id === objectiveId)?.version;
      if (version === undefined) throw new Error("Refresh this objective before making changes.");
      await strategyMutations.publish.mutateAsync({ objectiveId, expectedVersion: version });
      toast.success(t("publishedAsCompanyDirection"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not publish the objective."
      );
    }
  }

  const overview = goals.data;
  const meResolving = listing && !broad && me.isLoading;

  const viewSwitch = canList ? (
    <Segmented
      label={t("organizationDirectionView")}
      value={view}
      onChange={(value) => replaceContext({ view: value })}
      options={[
        { value: "map", label: t("map"), icon: <MapView aria-hidden /> },
        { value: "list", label: t("list"), icon: <ListView aria-hidden /> },
      ]}
    />
  ) : null;

  const actions = (
    <>
      {viewSwitch}
      {listing && overview && broad ? (
        <WorkingScopeSelector
          roots={organization.data?.roots ?? []}
          value={requestedScopeId}
          loading={organization.isLoading}
          onChange={(scopeId) => replaceContext({ scopeId, focusId: null })}
        />
      ) : null}
      {listing && overview && canManageCompany ? (
        <Button
          size="sm"
          onClick={() => setCompanyComposer({ mode: "create" })}
        >
          <Plus className="size-4" data-icon="inline-start" /> {t("createCompanyObjective")}
        </Button>
      ) : null}
    </>
  );

  const hasDirection = map.data?.nodes.some((node) => node.kind === "Company") ?? false;

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4"
        title={t("organizationDirection")}
        back={{ href: "/", label: t("overview") }}
        actions={actions}
      />

      {!listing ? (
        <div className="h-[calc(100dvh-12rem)] min-h-[420px]">
          {map.isLoading ? (
            <MapSkeleton />
          ) : map.error || !map.data ? (
            <ContentUnavailable
              error={map.error ?? new Error("The alignment map did not load.")}
              onRetry={map.refetch}
              subject={t("theAlignmentMap")}
            />
          ) : !hasDirection ? (
            <div className="grid h-full place-items-center rounded-surface border border-dashed border-border bg-section px-6 text-center">
              <div className="space-y-3">
                <p className="type-label text-foreground">{t("noPublishedDirectionForThis")}</p>
                {canList ? (
                  <Button size="sm" variant="outline" onClick={() => replaceContext({ view: "list" })}>
                    {t("openTheList")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <AlignmentMap
              map={map.data}
              focusId={focusId}
              nearId={nearId}
              onOpen={(objectiveId) => record.open({ cycleId: cycle.id, objectiveId })}
            />
          )}
        </div>
      ) : goals.isLoading || meResolving ? (
        <PageSkeleton rows={4} label={t("loadingGoals")} />
      ) : goals.error || !overview ? (
        <PageError
          title={t("organizationDirectionUnavailable")}
          description={goals.error?.message}
          onRetry={goals.refetch}
        />
      ) : (
        <ObjectiveWorkspace
          cycleId={cycle.id}
          overview={overview}
          focusId={focusId}
          revealId={revealId}
          ownUnit={workingUnit}
          broad={organizationWide}
          canAuthor={canAuthorOrgObjectives}
          canManageCompany={canManageCompany}
          canReachSetup={canReachSetup}
          onFocus={(id) => replaceContext({ focusId: id })}
          onInspect={(objectiveId) => record.open({ cycleId: cycle.id, objectiveId })}
          onCreate={(parentId, orgUnitId) =>
            setComposer({
              mode: "create",
              alignment: { mode: "aligned", parentId },
              orgUnitId,
            })
          }
          onResumeDraft={(id) => setComposer({ mode: "edit", objectiveId: id })}
          onDelete={handleDeleteOrg}
          onCreateCompany={() => setCompanyComposer({ mode: "create" })}
          onEditCompany={(id) =>
            setCompanyComposer({ mode: "edit", objectiveId: id })
          }
          onPublishCompany={handlePublishCompany}
        />
      )}

      {composer ? (
        <OrgComposerHost
          cycle={cycle}
          state={composer}
          ownUnit={workingUnit}
          onClose={() => setComposer(null)}
          onFocusParent={setRevealId}
        />
      ) : null}

      {companyComposer ? (
        <CompanyComposerHost
          cycle={cycle}
          state={companyComposer}
          onClose={() => setCompanyComposer(null)}
        />
      ) : null}
    </PageContainer>
  );
}
