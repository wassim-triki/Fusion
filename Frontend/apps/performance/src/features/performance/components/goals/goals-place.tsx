"use client";

import { useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageFailure } from "@repo/auth";
import { Button } from "@repo/ds/components/ui/button";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Segmented } from "@repo/ds/choice";
import { Building2, ListView, MapView, Plus, User, Users } from "@repo/ds/icons";
import { LinkTabs, PageContainer, PageEmpty, PageSkeleton, type LinkTab } from "@repo/ds/shell";
import { useAlignmentMap, useCurrentCycle, useGoals } from "../../api/use-performance";
import { useWorkforceMe } from "../../api/use-workforce-me";
import { useWorkspaceContext } from "../../api/use-workspace";
import { ContentUnavailable } from "../content-unavailable";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { CompanyComposerHost, type CompanyComposerState } from "./company-composer-host";
import { CompanyGoals, goalTree, UnitGoals } from "./goals-company";
import { GoalsYou } from "./goals-you";
import { OrgComposerHost, type ComposerState } from "./org-composer-host";
import type { UnitContext } from "./working-context-lib";

export type GoalsTab = "you" | "unit" | "company";

/** Which tab an address opens: the one asked for when the viewer has it, else their plan, else the company's goals. */
export function goalsTab(asked: string | null, mapView: boolean, has: { plan: boolean; unit: boolean }): GoalsTab {
  if (asked === "company" || mapView) return "company";
  if (asked === "unit" && has.unit) return "unit";
  return has.plan ? "you" : "company";
}

function MapSkeleton() {
  const t = useTranslations("goals.Place");
  return (
    <div className="grid h-full min-h-[420px] place-items-center rounded-surface bg-card" aria-label={t("loadingTheMap")}>
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

const AlignmentMap = dynamic(() => import("./alignment-map"), { ssr: false, loading: MapSkeleton });

/**
 * Goals (D-33, D-62, D-83): one place for every level. You is your plan; your unit is its goals with your team's under
 * them; Company is the company's goals with the units' under each, or the same on the map. The tab and the view live
 * in the address, so each can be linked to.
 */
export function GoalsPlace() {
  const t = useTranslations("goals.Place");
  const params = useSearchParams();
  const router = useRouter();
  const context = useWorkspaceContext();
  const capabilities = context.data?.capabilities;
  const participates = context.data?.destinations.myPlan ?? false;
  const detail = useCurrentCycle(Boolean(context.data));
  const cycle = detail.data?.cycle ?? null;
  const running = cycle && cycle.state !== "Draft" ? cycle : null;
  const me = useWorkforceMe(Boolean(context.data));
  const unit = me.data?.employee?.orgUnit ?? null;

  const mapView = params.get("view") === "map";
  const tab = goalsTab(params.get("tab"), mapView, { plan: participates, unit: Boolean(unit) });

  const map = useAlignmentMap(running?.id ?? null, tab !== "you");
  const setsDirection = capabilities?.canViewOrgDirection ?? false;
  const overview = useGoals(running?.id ?? null, tab === "company" && !mapView && setsDirection);
  const record = useObjectiveRecord();
  const [unitComposer, setUnitComposer] = useState<ComposerState | null>(null);
  const [companyComposer, setCompanyComposer] = useState<CompanyComposerState | null>(null);

  const tree = useMemo(() => goalTree(map.data?.nodes ?? [], unit?.orgUnitId ?? null), [map.data, unit?.orgUnitId]);
  const ownUnit: UnitContext | null = useMemo(
    () => (unit ? { orgUnitId: unit.orgUnitId, name: unit.name, type: unit.type, path: unit.path, memberCount: me.data?.orgUnitMemberCount ?? null, isOwnUnit: true } : null),
    [unit, me.data?.orgUnitMemberCount],
  );

  if (context.isLoading || detail.isLoading) return <PageSkeleton rows={4} label={t("loading")} />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (detail.error) return <ContentUnavailable error={detail.error} onRetry={detail.refetch} />;
  if (!running) {
    return (
      <PageContainer>
        <PageEmpty headingLevel={1} title={t("noYearYet")} />
      </PageContainer>
    );
  }

  const address = (next: { tab?: GoalsTab; view?: "map" | "list" }) => {
    const query = new URLSearchParams(params.toString());
    for (const key of ["view", "focus", "near"]) query.delete(key);
    query.set("tab", next.tab ?? "company");
    if (next.view === "map") query.set("view", "map");
    return `/goals?${query.toString()}`;
  };
  const tabs: LinkTab[] = [
    ...(participates ? [{ key: "you", label: t("you"), href: address({ tab: "you" }), icon: User }] : []),
    ...(unit ? [{ key: "unit", label: unit.name, href: address({ tab: "unit" }), icon: Users }] : []),
    { key: "company", label: t("company"), href: address({ tab: "company" }), icon: Building2 },
  ];
  const header = (actions?: ReactNode) => (
    <div className="flex flex-wrap items-end gap-3 pt-2">
      <div className="grid gap-3">
        <h1 className="type-display text-foreground">{t("goals")}</h1>
        <LinkTabs label={t("goals")} tabs={tabs} current={tab} />
      </div>
      {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
  const open = (objectiveId: string) => record.open({ cycleId: running.id, objectiveId });
  const canAddUnitGoal = (capabilities?.administers ?? false) || (capabilities?.managesOrgObjectives ?? false);
  const canAddCompanyGoal = (capabilities?.administers ?? false) || (capabilities?.publishesStrategy ?? false);
  const addUnitGoal = (parentId: string | null) =>
    setUnitComposer({ mode: "create", alignment: parentId ? { mode: "aligned", parentId } : null, orgUnitId: unit?.orgUnitId ?? null });

  let body: ReactNode;
  if (tab === "you") {
    body = <GoalsYou cycle={running} header={header} />;
  } else {
    const viewSwitch = tab === "company" ? (
      <Segmented
        label={t("view")}
        value={mapView ? "map" : "list"}
        onChange={(view) => router.replace(address({ view }), { scroll: false })}
        options={[
          { value: "list", label: t("goalsView"), icon: <ListView aria-hidden /> },
          { value: "map", label: t("map"), icon: <MapView aria-hidden /> },
        ]}
      />
    ) : null;
    const add = tab === "company" && canAddCompanyGoal ? (
      <Button writes onClick={() => setCompanyComposer({ mode: "create" })}>
        <Plus aria-hidden className="size-4" />
        {t("addACompanyGoal")}
      </Button>
    ) : tab === "unit" && canAddUnitGoal ? (
      <Button writes onClick={() => addUnitGoal(null)}>
        <Plus aria-hidden className="size-4" />
        {t("addAUnitGoal")}
      </Button>
    ) : null;
    body = (
      <>
        {header(viewSwitch || add ? <>{viewSwitch}{add}</> : undefined)}
        {map.isLoading ? (
          mapView ? <div className="h-[calc(100dvh-15rem)] min-h-[420px]"><MapSkeleton /></div> : <PageSkeleton rows={3} label={t("loading")} />
        ) : map.error || !map.data ? (
          <PageFailure error={map.error} onRetry={map.refetch} />
        ) : tab === "unit" && unit ? (
          <UnitGoals tree={tree} unitId={unit.orgUnitId} cycle={running} onOpen={open}
            onOpenCompany={() => router.push(address({ tab: "company" }), { scroll: false })} />
        ) : mapView && tree.companies.length > 0 ? (
          <div className="h-[calc(100dvh-15rem)] min-h-[420px]">
            <AlignmentMap map={map.data} focusId={params.get("focus")} nearId={params.get("near")} onOpen={open} />
          </div>
        ) : (
          <CompanyGoals
            tree={tree}
            myUnitId={unit?.orgUnitId ?? null}
            drafts={(overview.data?.nodes ?? []).filter((node) => node.state === "Draft")}
            cycle={running}
            onOpen={open}
            onOpenUnit={() => router.push(address({ tab: "unit" }), { scroll: false })}
            onAddUnitGoal={canAddUnitGoal ? addUnitGoal : undefined}
          />
        )}
      </>
    );
  }

  return (
    <PageContainer>
      <div className="grid max-w-[1120px] gap-[18px]">{body}</div>
      {unitComposer ? <OrgComposerHost cycle={running} state={unitComposer} ownUnit={ownUnit} onClose={() => setUnitComposer(null)} /> : null}
      {companyComposer ? <CompanyComposerHost cycle={running} state={companyComposer} onClose={() => setCompanyComposer(null)} /> : null}
    </PageContainer>
  );
}
