import {
  ClipboardList,
  KeyRound,
  LayoutDashboard,
  Network,
  Settings2,
  Stamp,
  User,
  Users,
  Workflow,
} from "lucide-react";
import { type ShellNavSection } from "@repo/ds/shell";

// Titles and labels are keys of the `frame.nav` catalogue; `useCoreNav` words them.
export const PEOPLE_NAV: ShellNavSection = {
  title: "people",
  items: [
    { label: "overview", href: "/", icon: LayoutDashboard },
    { label: "myProfile", href: "/profile", icon: User },
    { label: "myTeam", href: "/team", icon: Users },
    { label: "peopleDirectory", href: "/people", icon: Users },
    { label: "orgChart", href: "/org-chart", icon: Workflow },
    { label: "organization", href: "/organization", icon: Network },
    { label: "changes", href: "/changes", icon: Stamp },
  ],
};

export const ADMIN_NAV: ShellNavSection = {
  title: "administration",
  items: [
    // Temporary tenant-foundation orientation, reached at the shell-canonical
    // `/getting-started` (it lives outside the Core basePath). Not a permanent
    // primary destination — offered while administrators establish the tenant.
    {
      label: "gettingStarted",
      href: "/getting-started",
      navigateHref: "/getting-started",
      shellRoute: true,
      icon: ClipboardList,
    },
    { label: "workforceAccess", href: "/workforce-access", icon: KeyRound },
    { label: "settings", href: "/settings", icon: Settings2 },
  ],
};
