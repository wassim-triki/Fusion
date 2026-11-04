"use client";

import { useMemo } from "react";
import { coreAccessPaths, coreAccessQueryKeys, type RolesOverviewDto } from "../core-access";
import { corePeopleQueryKeys, createCorePeopleApi } from "../core-people";
import { coreWorkforcePaths, coreWorkforceQueryKeys, type WorkforceAccessRosterSummaryDto } from "../core-workforce";
import { createPerformanceApi, performanceQueryKeys } from "../performance";
import { createPlatformApiClient } from "../platform";
import { useApiQuery } from "./useApiQuery";
import { useTenantSummary } from "./useFusionNavigation";

export type SetupStepKey = "company" | "organization" | "invite" | "roles" | "performance";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
}

export interface SetupGuide {
  /** Still reading; the steps aren't known yet. */
  pending: boolean;
  steps: SetupStep[];
  doneCount: number;
  /** The first step not done, which the guide opens; null once everything is done. */
  open: SetupStepKey | null;
  /** Everyone in the company today, the viewer included. */
  people: number;
  /** A few of them, for faces. */
  faces: { key: string; name: string; photoUrl: string | null }[];
}

/** The count, and the newest few faces for the company card. */
const FIRST_PEOPLE = { page: 1, pageSize: 4, sort: "EmploymentDate", direction: "Desc" } as const;

/**
 * The company's setup guide (D-09, B-188), the product tour's administrator track: five steps, each done from what the
 * company has, never from a stored checklist. Your company: its name, language and time zone, set when it was
 * created (done on day one, as drawn; Edit brands it). Organization and people: someone besides the viewer. Invite: an
 * invitation out or accepted, besides the viewer's own account. Who does what:
 * a role made, changed or removed by someone at the company. Performance: a cycle exists (only where the company has it).
 */
export function useSetupGuide({
  enabled,
  selfEmployeeId,
  performance,
}: {
  enabled: boolean;
  /** The viewer's own person, when they have one: they don't count as the company's people or invitations. */
  selfEmployeeId: string | null | undefined;
  /** Whether the company has Performance; without it the guide has four steps. */
  performance: boolean;
}): SetupGuide {
  const { client, people, perf } = useMemo(() => {
    const api = createPlatformApiClient();
    return { client: api, people: createCorePeopleApi(api), perf: createPerformanceApi(api) };
  }, []);
  const tenant = useTenantSummary();
  const roster = useApiQuery(corePeopleQueryKeys.list(FIRST_PEOPLE), (signal) => people.people(FIRST_PEOPLE, signal), { enabled });
  const access = useApiQuery(
    coreWorkforceQueryKeys.accessSubjectsSummary(),
    (signal) => client.get<WorkforceAccessRosterSummaryDto>(coreWorkforcePaths.accessSubjectsSummary(), { signal }),
    { enabled },
  );
  const roles = useApiQuery(coreAccessQueryKeys.roles(), (signal) => client.get<RolesOverviewDto>(coreAccessPaths.roles(), { signal }), { enabled });
  const cycles = useApiQuery(
    performanceQueryKeys.workspaceContext(null),
    (signal) => perf.getWorkspaceContext(null, signal),
    { enabled: enabled && performance },
  );

  const self = selfEmployeeId ? 1 : 0;
  const total = roster.data?.totalCount ?? 0;
  const signedIn = (access.data?.activeAccountCount ?? 0) - self;
  const steps: SetupStep[] = [
    { key: "company", done: Boolean(tenant.data?.name && tenant.data.language && tenant.data.timeZone) },
    { key: "organization", done: total > self },
    { key: "invite", done: (access.data?.invitePendingCount ?? 0) > 0 || signedIn > 0 },
    { key: "roles", done: Boolean(roles.data?.lastChange) },
    ...(performance ? [{ key: "performance" as const, done: (cycles.data?.cycles.length ?? 0) > 0 }] : []),
  ];
  const pending =
    enabled && (tenant.isLoading || roster.isLoading || access.isLoading || roles.isLoading || (performance && cycles.isLoading));
  return {
    pending,
    steps,
    doneCount: steps.filter((step) => step.done).length,
    open: steps.find((step) => !step.done)?.key ?? null,
    people: total,
    faces: (roster.data?.items ?? []).map((p) => ({ key: p.employeeKey, name: p.displayName, photoUrl: p.photoUrl })),
  };
}
