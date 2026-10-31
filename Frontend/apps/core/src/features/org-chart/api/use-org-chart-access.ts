"use client";

import { useFieldVisibility } from "@repo/api/query";
import { canAccessCoreOrgChart, canAccessCorePeople, canAccessCoreTeam, canSeeCoreOrgChart, canSeeWholeCoreOrgChart, useAuth } from "@repo/auth";

/**
 * Whether the org chart is open to the viewer under the tenant's audience (Core HR settings › Employee fields). Managers
 * and people who read the whole workforce always see it; everyone else waits for the field policy, which every member
 * may read. `wholeCompany` says whether they see all of it rather than their own branch (unit heads and unit pages).
 * Core HR enforces the same rules, so this only hides what would lead to a refusal.
 */
export function useOrgChartAccess(): { canSee: boolean; wholeCompany: boolean; isLoading: boolean; narrowed: boolean } {
  const { user, isLoading: authLoading } = useAuth();
  const needsPolicy = canAccessCoreOrgChart(user) && !canAccessCoreTeam(user);
  const readsPolicy = canAccessCoreOrgChart(user) && !canAccessCorePeople(user);
  const policy = useFieldVisibility({ enabled: !authLoading && readsPolicy });
  const audience = policy.data?.orgChart?.audience;
  const canSee = canSeeCoreOrgChart(user, needsPolicy ? audience : "Everyone");
  return {
    canSee,
    wholeCompany: canSee && canSeeWholeCoreOrgChart(user, audience),
    isLoading: authLoading || (readsPolicy && policy.isLoading),
    // The role includes the chart but the company keeps it to managers and HR.
    narrowed: needsPolicy && !canSee && policy.data !== undefined,
  };
}
