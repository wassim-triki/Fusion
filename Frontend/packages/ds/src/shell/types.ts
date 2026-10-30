import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

/** A single navigation destination within a module. `href` is module-relative (basePath is prepended). */
export interface ShellNavItem {
  label: string;
  /** Module-relative path used for active-state matching (e.g. "/employees"). */
  href: string;
  /** Full link target if it differs from `${basePath}${href}` (e.g. with tenant-context query). */
  navigateHref?: string;
  /**
   * Target sits outside this app's basePath — a tenant-level destination rather
   * than a module one. Rendered as a plain anchor, because `Link` would prefix
   * the basePath and silently point at a different page.
   */
  shellRoute?: boolean;
  icon: LucideIcon;
  badge?: string | number;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Access state not yet known: rendered visually identical to enabled but inert
   * (no navigation), so items never flash enabled→locked while access resolves.
   */
  pending?: boolean;
  /** Only an exact path match marks this item active (default: prefix match). */
  exact?: boolean;
}

/** A titled group of nav items, organized by the user's job (not by technical module boundary). */
export interface ShellNavSection {
  title?: string;
  items: ShellNavItem[];
}

/** A module the user can switch to (Core ↔ Performance). `href` is an absolute app path (e.g. "/core"). */
export interface ShellModule {
  key: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  href: string;
}

export interface ModuleSidebarProps {
  brandTitle: string;
  brandSubtitle?: string;
  brandIcon: LucideIcon;
  /** Current path within the module (e.g. "/employees"), used for active state. Nav hrefs are
   *  module-relative; Next.js auto-prepends the app basePath, so no basePath prop is needed. */
  activePath: string;
  sections: ShellNavSection[];
  /** Modules available in the switcher; `currentModuleKey` marks the active one. */
  modules?: ShellModule[];
  currentModuleKey?: string;
  /** Optional tenant switcher / context control rendered under the brand. */
  tenantSwitcher?: ReactNode;
  /** Optional short role/context label shown in the header area. */
  contextLabel?: string;
  /** User panel at the very bottom; receives the collapsed state. */
  userPanel?: (collapsed: boolean) => ReactNode;
  collapsible?: boolean;
  /**
   * Nav content not yet known (e.g. auth still hydrating): renders skeleton nav
   * rows in the nav area while keeping the real brand header and footer.
   */
  pending?: boolean;
}

/** A module in the Fusion sidebar's switcher or, on Home, its module list. `href` is absolute. */
export interface FusionSidebarModule {
  key: string;
  label: string;
  description?: string;
  /** Defaults to the module's icon in `FUSION_MODULE_ICONS`. */
  icon?: LucideIcon;
  href: string;
  /** Waiting work in the module; absent when it serves none or hasn't answered. */
  count?: number;
}

/** A record the person opened recently in the current module. `href` is absolute. */
export interface FusionSidebarRecord {
  label: string;
  kind: string;
  href: string;
}

export interface FusionSidebarPerson {
  name?: string | null;
  /** Their photo, ready to display; initials without one. */
  photo?: string | null;
  /** Job title, else the account type in plain words. */
  detail?: string | null;
  /** The job title is still resolving. */
  detailPending?: boolean;
  /** The session is still restoring. */
  pending?: boolean;
  links?: { label: string; href: string; icon: ComponentType<{ className?: string }> }[];
  onSignOut?: () => void;
}

/** A settings section in the settings-mode sidebar. `path` is absolute. */
export interface FusionSidebarSettingsSection {
  id: string;
  label: string;
  path: string;
  access: "view" | "manage";
}

/** A group of the settings-mode sidebar: You, or one module. */
export interface FusionSidebarSettingsGroup {
  key: string;
  label: string;
  status: "loading" | "ready" | "error";
  sections: FusionSidebarSettingsSection[];
  /** Every section is view-only: the group label carries the view-only mark. */
  viewOnly?: boolean;
  retry?: () => void;
}

/** What the sidebar shows while Settings is open (fusion-settings). */
export interface FusionSidebarSettings {
  /** "Back to <label>": the page the person came from, or Home. */
  back: { href: string; label: string };
  groups: FusionSidebarSettingsGroup[];
}

export interface FusionSidebarProps {
  /** "settings" swaps the switcher, sections and Recent for the settings groups and a way back. */
  mode?: "module" | "settings";
  /** Required in settings mode. */
  settings?: FusionSidebarSettings;
  tenantName?: string | null;
  /** The company's logo address; the company's initial shows without one. */
  tenantLogoUrl?: string | null;
  /** The company's colour, applied to every screen; undefined leaves the page's colour as it is. */
  brandColor?: string | null;
  /** All of the person's waiting work; absent until a module answers. */
  homeCount?: number;
  /** The modules the person can enter, in sidebar order. */
  modules: FusionSidebarModule[];
  /** The module being shown. Omitted on the Fusion home, where the modules are listed instead. */
  currentModuleKey?: string;
  /** The app's basePath (e.g. "/performance"): turns item hrefs into the absolute paths counts are keyed by. */
  basePath?: string;
  /** Current path within the module, for active state. */
  activePath: string;
  /** The module's own sections, exactly as the module decides them. */
  sections?: ShellNavSection[];
  /** Waiting work per absolute navigation path. */
  sectionCounts?: Record<string, number>;
  /** Sections not known yet: stable placeholders in their place. */
  pending?: boolean;
  recent?: FusionSidebarRecord[];
  person: FusionSidebarPerson;
}
