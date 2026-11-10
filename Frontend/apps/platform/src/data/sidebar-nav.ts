import { Building2 } from "@repo/ds/icons";
import type { ShellNavSection } from "@repo/ds/shell";

/** Platform's navigation. Labels are keys of the `frame.nav` catalogue, resolved by `usePlatformNav`. */
export const PLATFORM_NAV: ShellNavSection = {
  items: [
    {
      label: "tenants",
      href: "/tenants",
      icon: Building2,
    },
  ],
};
