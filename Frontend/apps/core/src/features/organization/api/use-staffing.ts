"use client";

import { useCallback, useMemo } from "react";
import { coreOrgChartQueryKeys, createCoreOrgChartApi, createPlatformApiClient, type UnitStaffingDto } from "@repo/api";
import { keepPreviousData, useApiQuery } from "@repo/api/query";
import { canAccessCorePeople, canViewCoreOrganization, useAuth } from "@repo/auth";
import { useOrgChartAccess } from "@repo/auth";

function useOrgChartApi() {
  return useMemo(() => createCoreOrgChartApi(createPlatformApiClient()), []);
}

/** What the viewer may read about who works where: counts (today, or any date for HR), heads and unit pages (whole chart). */
export function useStaffingAccess(asOf: string, today: string) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const chart = useOrgChartAccess();
  const ready = !isLoading && isAuthenticated && canViewCoreOrganization(user);
  const hr = canAccessCorePeople(user);
  return {
    hr,
    counts: ready && (asOf === today || hr),
    unitPages: ready && !chart.isLoading && chart.canSee && chart.wholeCompany && (asOf === today || hr),
  };
}

/** Every unit's people, head and open roles as of a date, keyed by unit; the previous date's stays while the next loads. */
export function useStaffing(asOf: string, enabled: boolean) {
  const api = useOrgChartApi();
  const query = useApiQuery(
    coreOrgChartQueryKeys.staffing(asOf),
    useCallback((signal) => api.staffing(asOf, signal), [api, asOf]),
    { enabled, placeholderData: keepPreviousData }
  );
  const byUnit = useMemo(
    () => (query.data ? new Map<string, UnitStaffingDto>(query.data.units.map((unit) => [unit.unitId, unit])) : undefined),
    [query.data]
  );
  return { ...query, byUnit };
}

/** A unit's page: its head, everyone in it and below, its open roles. */
export function useUnitPeople(id: string, asOf: string, enabled: boolean) {
  const api = useOrgChartApi();
  return useApiQuery(
    coreOrgChartQueryKeys.unit(id, asOf),
    useCallback((signal) => api.unit(id, asOf, signal), [api, id, asOf]),
    { enabled, placeholderData: keepPreviousData }
  );
}
