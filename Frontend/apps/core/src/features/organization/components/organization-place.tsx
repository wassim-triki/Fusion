"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { List, Network, Users } from "lucide-react";
import { coreOrgChartQueryKeys, coreOrganizationQueryKeys, createCoreOrgChartApi, createCoreOrganizationApi, createPlatformApiClient } from "@repo/api";
import { canAccessCorePeople, canViewCoreOrganization, useAuth, PageRefusal } from "@repo/auth";
import { Skeleton } from "@repo/ds";
import { OrganizationPageSkeleton as PlaceSkeleton } from "@/shell/route-skeletons";
import { Segmented } from "@repo/ds/choice";
import { PageHeader, PagePermissionNotice } from "@repo/ds/shell";
import OrgChartWorkspace from "@/features/org-chart/components/org-chart-workspace";
import { useOrgChartHistory } from "@/features/org-chart/api/use-org-chart";
import { useOrgChartAccess } from "@/features/org-chart/api/use-org-chart-access";
import { countsOn, coversDay } from "@/features/org-chart/model/org-chart-history";
import { useUpcomingChanges } from "@/features/people/changes/use-changes";
import { useOrganizationReadiness, useOrganizationUpcomingChanges } from "../api/use-organization";
import { useStaffing, useStaffingAccess } from "../api/use-staffing";
import { replayDays, timeSpan } from "../model/time";
import { todayCalendarDate } from "../model/workspace-state";
import OrganizationWorkspace from "./organization-workspace";
import { PlannedChanges, usePlannedItems } from "./planned-changes";
import { TimeBar } from "./time-bar";

export type OrganizationView = "people" | "structure" | "list";

/** Replay holds each step long enough for the chart to settle. */
const REPLAY_STEP_MS = 700;

/**
 * One place for the organization (D-17): the people chart, the structure and the list as views of one date. The time
 * slider reaches back to the company's first day and forward through what's planned, which is marked on it and listed
 * under the chart. People view's other dates are for HR, like the chart itself.
 */
export default function OrganizationPlace() {
  const t = useTranslations("organization");
  const tc = useTranslations("orgChart");
  const { user, isLoading } = useAuth();
  const chartAccess = useOrgChartAccess();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const today = useMemo(() => todayCalendarDate(), []);

  const canStructure = canViewCoreOrganization(user);
  const canPeople = chartAccess.canSee;
  const hr = canAccessCorePeople(user);
  const requested = params.get("view");
  const view: OrganizationView =
    requested === "people" && canPeople ? "people"
    : requested === "list" && canStructure ? "list"
    : canStructure ? "structure" : "people";
  const asOf = params.get("asOf") || today;
  // The chart reads another date than today for HR only; the structure for anyone who sees it.
  const canMoveTime = view === "people" ? canPeople && hr : canStructure;
  const date = canMoveTime ? asOf : today;

  const readiness = useOrganizationReadiness(canStructure);
  const established = !canStructure || readiness.data?.hasPermanentRoot === true;
  const staffingAccess = useStaffingAccess(date, today);
  const opening = useStaffing(today, canStructure && established);
  const first = opening.data?.firstDate ?? null;
  const unitChanges = useOrganizationUpcomingChanges(canStructure && established);
  const peopleChanges = useUpcomingChanges(hr && established);
  // The slider waits for the company's first day and what's planned, so it doesn't jump once they arrive.
  const timeLoading = (canStructure && opening.isLoading) || unitChanges.isLoading || peopleChanges.isLoading;
  const planned = usePlannedItems(peopleChanges.data ?? [], unitChanges.data ?? [], today);
  const span = useMemo(() => timeSpan(first, today, planned.map((item) => item.day)), [first, today, planned]);
  // The People chart reads every day the slider reaches as one history (B-419); its figures come from it too, so
  // moving the date asks Core HR for nothing.
  const reach = useMemo(
    () => (view === "people" && canMoveTime && established && !timeLoading ? { from: span.lo, to: span.hi } : null),
    [view, canMoveTime, established, timeLoading, span]
  );
  const history = useOrgChartHistory(reach);
  const local = history.data && coversDay(history.data, date) ? countsOn(history.data, date) : null;
  const staffing = useStaffing(date, staffingAccess.counts && established && !history.data && !history.waiting);

  const navigate = useCallback(
    (next: { view?: OrganizationView; asOf?: string }) => {
      const query = new URLSearchParams(params.toString());
      if (next.view) {
        if (next.view === (canStructure ? "structure" : "people")) query.delete("view");
        else query.set("view", next.view);
      }
      if (next.asOf !== undefined) {
        if (next.asOf === today) query.delete("asOf");
        else query.set("asOf", next.asOf);
      }
      query.delete("reveal");
      const search = query.toString();
      // The view and the date live in the URL, but changing them is client state: the history API updates
      // useSearchParams without a server round trip, so the slider and Replay follow the hand (B-399). The state is
      // null: Next copies its own in, and skips updating useSearchParams for a state that already carries it (B-419).
      // The browser's path keeps the app's base path (/core), which Next's pathname leaves out.
      const path = window.location.pathname;
      window.history.replaceState(null, "", search ? `${path}?${search}` : path);
    },
    [canStructure, params, today]
  );

  // ── Replay: the company from its first day to today, a step at a time, each step loaded before it shows ──
  const [replaying, setReplaying] = useState(false);
  // While the hand drags the slider, the chart follows it without animating each date.
  const [scrubbing, setScrubbing] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const run = useRef(0);
  const prefetch = useCallback(
    async (day: string) => {
      const client = createPlatformApiClient();
      if (view === "people") {
        const api = createCoreOrgChartApi(client);
        // The history holds every step; without it (a chart too large, or it failed) each step is read ahead.
        if (history.data && coversDay(history.data, day)) return;
        await queryClient.prefetchQuery({ queryKey: coreOrgChartQueryKeys.chart(day), queryFn: ({ signal }) => api.chart(day, signal), staleTime: 60_000 });
        return;
      }
      const organization = createCoreOrganizationApi(client);
      const chart = createCoreOrgChartApi(client);
      await Promise.all([
        queryClient.prefetchQuery({ queryKey: coreOrganizationQueryKeys.hierarchy(day), queryFn: ({ signal }) => organization.hierarchy(day, signal), staleTime: 60_000 }),
        hr ? queryClient.prefetchQuery({ queryKey: coreOrgChartQueryKeys.staffing(day), queryFn: ({ signal }) => chart.staffing(day, signal), staleTime: 60_000 }) : null,
      ]);
    },
    [hr, queryClient, view, history.data]
  );
  const stop = () => {
    run.current += 1;
    setReplaying(false);
  };
  const replay = async () => {
    if (replaying) return stop();
    const mine = ++run.current;
    setReplaying(true);
    for (const day of replayDays(span)) {
      await prefetch(day).catch(() => undefined);
      if (run.current !== mine) return;
      navigate({ asOf: day });
      await new Promise((resolve) => window.setTimeout(resolve, REPLAY_STEP_MS));
      if (run.current !== mine) return;
    }
    setReplaying(false);
  };
  useEffect(() => () => { run.current += 1; }, []);

  if (isLoading || chartAccess.isLoading) return <PlaceSkeleton />;
  if (!canStructure && !canPeople) {
    return (
      <div className="p-6">
        <PageHeader title={t("title")} />
        {chartAccess.narrowed ? (
          <PagePermissionNotice title={tc("access.narrowed.title")} description={tc("access.narrowed.description")} />
        ) : (
          <PageRefusal />
        )}
      </div>
    );
  }

  const views = [
    ...(canPeople ? [{ value: "people" as const, label: t("views.people"), icon: <Users aria-hidden /> }] : []),
    ...(canStructure ? [
      { value: "structure" as const, label: t("views.structure"), icon: <Network aria-hidden /> },
      { value: "list" as const, label: t("views.list"), icon: <List aria-hidden /> },
    ] : []),
  ];
  const root = staffing.data?.units.reduce((top, unit) => (unit.people > (top?.people ?? -1) ? unit : top), staffing.data.units[0]);
  const people = local?.people ?? (staffingAccess.counts && root ? root.people : null);
  const units = local?.units ?? staffing.data?.units.length ?? 0;

  return (
    <div className="grid gap-4 px-6 pt-5 pb-10">
      <PageHeader
        title={t("title")}
        description={people !== null ? t("place.meta", { people, units }) : undefined}
        className="mb-0"
        actions={
          <>
            {views.length > 1 ? (
              <Segmented label={t("views.label")} value={view} onChange={(next) => { stop(); navigate({ view: next }); }} options={views} />
            ) : null}
            <div ref={setActionsTarget} className="contents" />
          </>
        }
      />
      {canMoveTime && established && timeLoading ? <Skeleton className="h-[78px] w-full rounded-surface" /> : null}
      {canMoveTime && established && !timeLoading ? (
        <TimeBar
          span={span}
          date={date}
          planned={planned.map((item) => ({ day: item.day, title: `${item.title} · ${item.meta}` }))}
          people={people}
          replaying={replaying}
          onScrub={setScrubbing}
          onDate={(next) => { stop(); navigate({ asOf: next }); }}
          onReplay={() => void replay()}
        />
      ) : null}
      <div className="h-[clamp(520px,calc(100dvh-21rem),880px)] overflow-hidden rounded-surface bg-section">
        {view === "people" ? (
          <OrgChartWorkspace asOf={date === today ? null : date} replaying={replaying} reach={reach} still={scrubbing} />
        ) : (
          <OrganizationWorkspace staffing={staffingAccess.counts ? staffing.byUnit : undefined} actionsTarget={actionsTarget} />
        )}
      </div>
      {canMoveTime && established ? (
        <PlannedChanges items={planned} date={date} loading={timeLoading} onOpen={(day) => { stop(); navigate({ asOf: day }); }} />
      ) : null}
    </div>
  );
}
