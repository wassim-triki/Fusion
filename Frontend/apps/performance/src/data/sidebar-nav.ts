import { CalendarRange, FeedbackIcon, FileCheck2, GitBranch, LayoutDashboard, OneOnOnes, Settings, UserRoundCheck } from "@/lib/icons";
import type { WorkspaceDestinationsDto } from "@repo/api";
import type { ShellNavSection } from "@repo/ds/shell";

/**
 * Primary Performance navigation: one entry per durable, recurring job — never one per entity,
 * service or capability. Overview orients and points onward; My Plan is planning and executing
 * one's own commitments. A team is Core HR's Team page, whose Performance tab is `/team` (B-185). Entries are
 * capability-gated at render. Organization direction is deliberately absent: it is reached in
 * context (Overview, My Team, any objective record), not as a destination of its own.
 * Titles and labels are keys of the `common.nav` catalogue; the sidebar words them.
 */
export const PRIMARY_NAV: ShellNavSection = {
  items: [
    { label: "overview", href: "/", icon: LayoutDashboard, exact: true },
    { label: "myPlan", href: "/plan", icon: UserRoundCheck },
    // Conversations belong to people, not cycles (S-02): they keep no cycle in their address.
    { label: "oneOnOnes", href: "/one-on-ones", icon: OneOnOnes },
    { label: "feedback", href: "/feedback", icon: FeedbackIcon },
    { label: "reviews", href: "/reviews", icon: FileCheck2 },
  ],
};

/** Routes reached in context rather than from the sidebar; listed so labels still resolve. */
export const CONTEXTUAL_ROUTES = [{ label: "direction", href: "/goals", icon: GitBranch }];

/** Administration, kept out of the primary rail: Cycle for cycle administrators, Settings for whoever can view it. */
export const ADMIN_NAV: ShellNavSection = {
  title: "administration",
  items: [
    { label: "cycle", href: "/cycle", icon: CalendarRange },
    { label: "settings", href: "/settings", icon: Settings },
  ],
};

/** Which primary destinations the caller has, from the server's workspace context (navigation, never access). */
const DESTINATION_OF: Record<string, keyof WorkspaceDestinationsDto> = {
  "/plan": "myPlan",
  "/one-on-ones": "oneOnOnes",
  "/feedback": "feedback",
  "/reviews": "reviews",
};

export function visibleAdminItems(destinations: WorkspaceDestinationsDto | undefined): ShellNavSection["items"] {
  return ADMIN_NAV.items.filter((item) => (item.href === "/cycle" ? destinations?.cycleAdmin : destinations?.settings) ?? false);
}

export function visiblePrimaryItems(destinations: WorkspaceDestinationsDto | undefined): ShellNavSection["items"] {
  return PRIMARY_NAV.items.filter((item) => {
    const key = DESTINATION_OF[item.href];
    return key ? (destinations?.[key] ?? false) : true;
  });
}

/** Destinations that belong to people, not cycles: the cycle switcher never follows into them. */
export const CYCLE_FREE_ROUTES: ReadonlySet<string> = new Set(["/one-on-ones", "/feedback", "/settings"]);

