import {
  ChartNoAxesColumn,
  LayoutDashboard,
  Network,
  Settings2,
  Stamp,
  User,
  Users,
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
    { label: "organization", href: "/organization", icon: Network },
    { label: "changes", href: "/changes", icon: Stamp },
    { label: "reports", href: "/reports", icon: ChartNoAxesColumn },
  ],
};

export const ADMIN_NAV: ShellNavSection = {
  title: "administration",
  items: [{ label: "settings", href: "/settings", icon: Settings2 }],
};
