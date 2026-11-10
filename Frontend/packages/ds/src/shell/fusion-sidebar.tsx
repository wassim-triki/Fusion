"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  ChevronDown,
  ChevronLeft,
  Eye,
  FileCheck2,
  History,
  Home,
  List,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  MessageSquareText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  Target,
  TriangleAlert,
  type IconComponent,
} from "../icons";
import { useCompanyColor } from "../brand/use-company-color";
import { cn } from "../lib/utils";
import { Kbd } from "../components/ui/kbd";
import { Skeleton } from "../components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { FUSION_MODULE_ICONS } from "./modules";
import type {
  FusionSidebarModule,
  FusionSidebarProps,
  FusionSidebarRecord,
  FusionSidebarSettings,
  FusionSidebarSettingsGroup,
  ShellNavItem,
} from "./types";

/** Where Fusion Settings opens: Preferences, served by the shell. */
const SETTINGS_HREF = "/settings";

/**
 * The page "Back to …" returns to, kept for the browser session: the key `@repo/api`'s `readSettingsReturn`
 * reads. Settings pages themselves are never kept.
 */
const SETTINGS_RETURN_KEY = "fusion.settings.back";
const SETTINGS_PATH = /^(\/core|\/performance)?\/settings(\/|$|\?)/;

const COLLAPSED_KEY = "fusion.nav.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberReturn() {
  try {
    const path = `${window.location.pathname}${window.location.search}`;
    if (!SETTINGS_PATH.test(path)) window.sessionStorage.setItem(SETTINGS_RETURN_KEY, path);
  } catch {
    // A convenience only: without it, Back goes Home.
  }
}

/** Each settings section's mark: same section, same icon wherever it is listed. */
const SETTINGS_SECTION_ICONS: Record<string, IconComponent> = {
  preferences: SlidersHorizontal,
  notifications: Bell,
  company: Building2,
  "employee-fields": ListChecks,
  lists: List,
  jobs: Briefcase,
  places: MapPin,
  roles: ShieldCheck,
  approvals: Stamp,
  invitations: Mail,
  "change-history": History,
  "rating-scale": BarChart3,
  competencies: Award,
  "review-questions": MessageSquareText,
  reviews: FileCheck2,
  planning: Target,
  conversations: MessageSquare,
  "ai-and-data": Sparkles,
};

function isItemActive(activePath: string, item: ShellNavItem): boolean {
  if (item.exact || item.href === "/") return activePath === item.href;
  return activePath === item.href || activePath.startsWith(`${item.href}/`);
}

/** The absolute paths of the modules' pages, which the shared hook counts work under. */
export function pagePaths(modules: readonly Pick<FusionSidebarModule, "href" | "items">[]): string[] {
  return modules.flatMap((module) => (module.items ?? []).map((item) => absolutePath(module.href, item.href)));
}

/** Absolute navigation path of a module-relative item, the key section counts use. */
function absolutePath(basePath: string, href: string): string {
  return href === "/" ? basePath || "/" : `${basePath}${href}`;
}

/** A count of waiting work: a number when expanded, a dot on the rail, nothing at zero. */
function Count({ value, collapsed }: { value?: number; collapsed: boolean }) {
  if (!value) return null;
  if (collapsed) {
    return <span aria-hidden className="absolute top-1 inset-e-1 size-1.5 rounded-full bg-foreground" />;
  }
  return (
    <span className="ms-auto inline-grid h-5 min-w-[22px] place-items-center rounded-detail bg-inlay px-1.5 text-[11.5px] font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border">
      {value}
    </span>
  );
}

function withTooltip(collapsed: boolean, label: string, node: ReactNode) {
  if (!collapsed) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function rowClass(active: boolean, collapsed: boolean, disabled = false) {
  return cn(
    "relative flex items-center gap-3 rounded-control px-2.5 py-2 text-sm font-medium transition-colors",
    active ? "bg-inlay text-foreground" : "text-muted-foreground hover:bg-inlay/60 hover:text-foreground",
    disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
    collapsed && "justify-center",
  );
}

const BRAND_MARK =
  "grid size-9 shrink-0 place-items-center overflow-hidden rounded-detail bg-primary text-base font-bold text-primary-foreground";

/** The company's logo, else its initial on its colour; Fusion's F before the company is known. */
function CompanyMark({ name, logoUrl }: { name?: string | null; logoUrl?: string | null }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="size-full bg-card object-contain" />;
  }
  return <>{name?.trim().charAt(0).toUpperCase() || "F"}</>;
}

/**
 * A small sidebar: on the folded rail the company mark turns into it on hover, and its pane slides open to say what
 * the click does (B-250).
 */
function PaneIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-5">
      <rect x="1.5" y="2.5" width="17" height="15" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect
        x="4.2"
        y="5.2"
        height="9.6"
        rx="1.3"
        fill="currentColor"
        className="w-[1.6px] transition-[width] duration-200 group-hover/mark:w-[6.5px] group-focus-visible/mark:w-[6.5px]"
      />
    </svg>
  );
}

/** The fold's name with its shortcut, for both tooltips. */
function FoldHint({ label }: { label: string }) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  return (
    <span className="flex items-center gap-2">
      {label}
      <Kbd>{mac ? "⌘" : "Ctrl"} B</Kbd>
    </span>
  );
}

function ActiveMark({ active }: { active: boolean }) {
  return active ? <span className="absolute top-1/2 inset-s-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" /> : null;
}

function moduleIcon(module: Pick<FusionSidebarModule, "key" | "icon">) {
  return module.icon ?? FUSION_MODULE_ICONS[module.key] ?? Home;
}

/** Which module groups the person folded; open by default (D-45). */
const FOLDED_KEY = "fusion.nav.folded";

function readFolded(): string[] {
  try {
    const raw = window.localStorage.getItem(FOLDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The shell-owned Fusion sidebar (fusion-navigation): tenant brand, Home, then every module the person can enter as
 * a group that folds, its pages under it (D-45), Recent for the current module, and Settings at the end. Pure
 * presentation: each app passes the modules with their pages and the shared navigation state from
 * `useFusionNavigation` in `@repo/api/query`. Below 1024px, or on request, it collapses to an icon rail.
 */
export function FusionSidebar({
  mode = "module",
  settings,
  tenantName,
  tenantLogoUrl,
  brandColor,
  homeCount,
  modules,
  currentModuleKey,
  basePath = "",
  activePath,
  sectionCounts = {},
  recent = [],
  showSettings = false,
}: FusionSidebarProps) {
  const t = useTranslations("ds.sidebar");
  const locale = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [folded, setFolded] = useState<string[]>([]);
  // The width animates only for a click, not when a page opens already collapsed.
  const [animate, setAnimate] = useState(false);
  useCompanyColor(brandColor);
  const inSettings = mode === "settings" && settings !== undefined;
  const onHome = !currentModuleKey && !inSettings;

  // Ctrl+B (⌘B) folds or opens it from anywhere but a text field, where the keys belong to the writing.
  const collapsedRef = useRef(collapsed);
  const chooseRef = useRef<(next: boolean) => void>(() => undefined);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      event.preventDefault();
      chooseRef.current(!collapsedRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // Every page outside Settings is where "Back to …" may need to return.
    if (!inSettings) rememberReturn();
  }, [inSettings, activePath]);

  useEffect(() => {
    // At tablet widths a full navigation column turns a record into a narrow reading pane; the rail keeps
    // every destination with a dedicated expand control.
    const query = window.matchMedia("(max-width: 1023px)");
    if (query.matches || readCollapsed()) setCollapsed(true);
    setFolded(readFolded());
    const handleChange = (event: MediaQueryListEvent) => setCollapsed(event.matches || readCollapsed());
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  // Anyone can keep the navigation as icons (D-04); the choice follows them from page to page and module to module.
  const choose = (next: boolean) => {
    setAnimate(true);
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Storage off: the choice lasts for this page.
    }
  };
  useEffect(() => {
    collapsedRef.current = collapsed;
    chooseRef.current = choose;
  });

  const fold = (key: string, open: boolean) => {
    const next = open ? folded.filter((k) => k !== key) : [...folded.filter((k) => k !== key), key];
    setFolded(next);
    try {
      window.localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
    } catch {
      // Storage off: the fold lasts for this page.
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        data-collapsed={collapsed}
        lang={locale}
        aria-label={t("navigation")}
        className={cn(
          "relative flex h-screen shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground",
          animate && "transition-[width] duration-200",
          collapsed ? "w-[68px]" : "w-[264px]",
        )}
      >
        {/* Brand: the company's logo and name. Open, a tab on the sidebar's edge folds it; folded, the mark opens it (B-250). */}
        <div className={cn("flex items-center gap-2.5 pt-4 pb-3", collapsed ? "justify-center" : "ps-4")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => choose(false)}
                  aria-label={t("expand")}
                  aria-expanded={false}
                  className={cn(BRAND_MARK, "group/mark relative outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  <CompanyMark name={tenantName} logoUrl={tenantLogoUrl} />
                  <span
                    aria-hidden
                    className="absolute inset-0 grid place-items-center bg-inlay text-foreground opacity-0 transition-opacity duration-150 group-hover/mark:opacity-100 group-focus-visible/mark:opacity-100"
                  >
                    <PaneIcon />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <FoldHint label={t("expand")} />
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <span aria-hidden className={BRAND_MARK}>
                <CompanyMark name={tenantName} logoUrl={tenantLogoUrl} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {tenantName ? (
                  <span className="truncate text-sm font-semibold leading-tight">{tenantName}</span>
                ) : (
                  <Skeleton className="h-3 w-28" />
                )}
                <span className="truncate text-xs text-muted-foreground">Fusion</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => choose(true)}
                    aria-label={t("collapse")}
                    aria-expanded
                    className="group/tab grid h-[30px] w-[22px] shrink-0 place-items-center rounded-s-control border border-e-0 border-border bg-inlay text-muted-foreground transition-[width,color] duration-150 hover:w-[26px] hover:text-foreground focus-visible:w-[26px] focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronLeft aria-hidden className="size-3.5 transition-transform duration-150 group-hover/tab:-translate-x-px rtl:rotate-180" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <FoldHint label={t("collapse")} />
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {inSettings ? (
            <SettingsNavigation
              settings={settings}
              activePath={absolutePath(basePath, activePath)}
              basePath={basePath}
              collapsed={collapsed}
            />
          ) : (
            <>
              {/* Home, always first */}
              {withTooltip(
                collapsed,
                homeCount ? `${t("home")} ${homeCount}` : t("home"),
                <a href="/" aria-current={onHome ? "page" : undefined} aria-label={collapsed ? t("home") : undefined} className={rowClass(onHome, collapsed)}>
                  <ActiveMark active={onHome} />
                  <Home className="size-4 shrink-0" />
                  {!collapsed ? <span className="flex-1 truncate">{t("home")}</span> : null}
                  <Count value={homeCount} collapsed={collapsed} />
                </a>,
              )}

              <div className="mx-1 my-2.5 h-px bg-border" />

              {/* Every module as a group that folds, open by default (D-45) */}
              <ul className="flex flex-col gap-0.5">
                {modules.map((module) => (
                  <li key={module.key}>
                    <ModuleGroup
                      module={module}
                      current={module.key === currentModuleKey}
                      open={!folded.includes(module.key)}
                      onFold={(open) => fold(module.key, open)}
                      collapsed={collapsed}
                      activePath={activePath}
                      sectionCounts={sectionCounts}
                      recent={module.key === currentModuleKey ? recent : []}
                      basePath={basePath}
                    />
                  </li>
                ))}
              </ul>

              {showSettings ? (
                <>
                  <div className="mx-1 my-2.5 h-px bg-border" />
                  {withTooltip(
                    collapsed,
                    t("settings"),
                    <a href={SETTINGS_HREF} onClick={rememberReturn} aria-label={collapsed ? t("settings") : undefined} className={rowClass(false, collapsed)}>
                      <Settings className="size-4 shrink-0" />
                      {!collapsed ? <span className="flex-1 truncate">{t("settings")}</span> : null}
                    </a>,
                  )}
                </>
              ) : null}
            </>
          )}
        </nav>
      </aside>
    </TooltipProvider>
  );
}

/** A module's group: its name opens the module's front page; the chevron folds the pages under it. */
function ModuleGroup({
  module,
  current,
  open,
  onFold,
  collapsed,
  activePath,
  sectionCounts,
  recent,
  basePath,
}: {
  module: FusionSidebarModule;
  current: boolean;
  open: boolean;
  onFold: (open: boolean) => void;
  collapsed: boolean;
  activePath: string;
  sectionCounts: Record<string, number>;
  recent: FusionSidebarRecord[];
  basePath: string;
}) {
  const t = useTranslations("ds.sidebar");
  const Icon = moduleIcon(module);
  const items = module.items;
  const label = module.count ? `${module.label} ${module.count}` : module.label;
  // A module without pages (the other contributors') is one link.
  if (!items && !module.pending) {
    return withTooltip(
      collapsed,
      label,
      <a href={module.href} aria-label={collapsed ? module.label : undefined} className={rowClass(false, collapsed)}>
        <Icon className="size-4 shrink-0" />
        {!collapsed ? <span className="flex-1 truncate">{module.label}</span> : null}
        <Count value={module.count} collapsed={collapsed} />
      </a>,
    );
  }
  const head = collapsed ? (
    withTooltip(
      true,
      label,
      <a href={module.href} aria-label={module.label} className={cn(rowClass(false, true), current && "text-foreground")}>
        <Icon className="size-4 shrink-0" />
        <Count value={module.count} collapsed />
      </a>,
    )
  ) : (
    <div
      className={cn(
        "flex items-center gap-3 rounded-control px-2.5 py-2 text-sm transition-colors hover:bg-inlay/60",
        current || open ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
      )}
    >
      <a href={module.href} className="flex min-w-0 flex-1 items-center gap-3 rounded-detail outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{module.label}</span>
      </a>
      {!open ? <Count value={module.count} collapsed={false} /> : null}
      <button
        type="button"
        onClick={() => onFold(!open)}
        aria-expanded={open}
        aria-label={open ? t("foldModule", { module: module.label }) : t("openModule", { module: module.label })}
        className="grid size-5 shrink-0 place-items-center rounded-detail text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150", !open && "-rotate-90 rtl:rotate-90")} />
      </button>
    </div>
  );
  return (
    <div>
      {head}
      {open ? (
        <div className={cn(!collapsed && "ps-3")}>
          {module.pending ? (
            <div aria-busy aria-label={t("loadingNavigation")} className="flex flex-col gap-0.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={cn("flex items-center gap-3 px-2.5 py-2", collapsed && "justify-center")}>
                  <Skeleton className="size-4 shrink-0 rounded-detail" />
                  {!collapsed ? <Skeleton className="h-4 flex-1" /> : null}
                </div>
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {(items ?? []).map((item) => (
                <li key={item.href}>
                  <SectionItem
                    item={item}
                    active={current && isItemActive(activePath, item)}
                    collapsed={collapsed}
                    count={sectionCounts[absolutePath(module.href, item.href)]}
                    // Another module's page: a document load, since a client link would carry this app's basePath.
                    href={current ? undefined : absolutePath(module.href, item.href)}
                  />
                </li>
              ))}
            </ul>
          )}
          {recent.length > 0 && !collapsed ? (
            <div className="mt-1">
              <p className="px-2.5 pt-2 pb-1.5 type-eyebrow text-muted-foreground/70">{t("recent")}</p>
              <ul className="flex flex-col gap-0.5">
                {recent.map((record) => (
                  <li key={record.href}>
                    <RecentLink href={record.href} basePath={basePath}>
                      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-foreground/90">{record.label}</span>
                        <span className="truncate text-xs text-muted-foreground/70">{record.kind}</span>
                      </span>
                    </RecentLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionItem({
  item,
  active,
  collapsed,
  count,
  href,
}: {
  item: ShellNavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
  /** An absolute address outside this app: a document load. */
  href?: string;
}) {
  const Icon = item.icon;
  const value = count || (typeof item.badge === "number" ? item.badge : undefined);
  const content = (
    <span className={rowClass(active, collapsed, item.disabled)}>
      <ActiveMark active={active} />
      <Icon className="size-4 shrink-0" />
      {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
      {!collapsed && item.disabled ? <Lock className="size-3.5 shrink-0 opacity-70" /> : null}
      {!item.disabled ? <Count value={value} collapsed={collapsed} /> : null}
    </span>
  );
  const target = item.navigateHref ?? item.href;
  const label = collapsed ? item.label : undefined;
  const node = item.disabled || item.pending ? (
    <div aria-disabled aria-label={label} className={item.pending ? "cursor-default" : undefined}>
      {content}
    </div>
  ) : item.shellRoute || href ? (
    // Leaves this app's basePath, so it is a document load by nature.
    <a href={href ?? target} aria-label={label} aria-current={active ? "page" : undefined}>
      {content}
    </a>
  ) : (
    <Link href={target} aria-label={label} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
  const tip = item.disabled && item.disabledReason ? item.disabledReason : value ? `${item.label} ${value}` : item.label;
  return collapsed || (item.disabled && item.disabledReason) ? (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">{tip}</TooltipContent>
    </Tooltip>
  ) : (
    node
  );
}

/** A record of this module stays a client navigation; anything else is a document load. */
function RecentLink({ href, basePath, children }: { href: string; basePath: string; children: ReactNode }) {
  const className = "flex items-start gap-3 rounded-control px-2.5 py-1.5 transition-colors hover:bg-inlay/60";
  if (basePath && (href === basePath || href.startsWith(`${basePath}/`) || href.startsWith(`${basePath}?`))) {
    return (
      <Link href={href.slice(basePath.length) || "/"} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * Settings mode speaks the person's language. The You group, its sections and the Back place arrive from `@repo/api`
 * as `ds` message keys; a module's own groups arrive as product names and are shown as they are.
 */
function useSettingsLabel(): (label: string) => string {
  const t = useTranslations("ds");
  return (label) => {
    const key = label as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : label;
  };
}

/**
 * A settings section's name in the person's language: the catalogue's name for a section id Fusion knows, else the
 * label the module sent (a section added on the server before its translation).
 */
export function useSettingsSectionName(): (section: { id: string; label: string }) => string {
  const t = useTranslations("ds.settings.sections");
  const label = useSettingsLabel();
  return (section) => {
    const key = section.id as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : label(section.label);
  };
}

/** Settings mode: the way back, then each group with its sections (fusion-settings). */
function SettingsNavigation({
  settings,
  activePath,
  basePath,
  collapsed,
}: {
  settings: FusionSidebarSettings;
  activePath: string;
  basePath: string;
  collapsed: boolean;
}) {
  const t = useTranslations("ds.settings");
  const locale = useLocale();
  const label = useSettingsLabel();
  const backLabel = t("back", { place: label(settings.back.label) });
  // The open section is the one whose address matches most of the path: Preferences (`/settings`) is not current on
  // Notifications (`/settings/notifications`).
  const current = settings.groups
    .flatMap((group) => group.sections)
    .filter((section) => activePath === section.path || activePath.startsWith(`${section.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;
  return (
    <div lang={locale} className="contents">
      {withTooltip(
        collapsed,
        backLabel,
        <a
          href={settings.back.href}
          aria-label={collapsed ? backLabel : undefined}
          className={cn(rowClass(false, collapsed), "font-semibold text-foreground")}
        >
          <ArrowLeft className="size-4 shrink-0" />
          {!collapsed ? <span className="flex-1 truncate">{backLabel}</span> : null}
        </a>,
      )}

      <div className="mx-1 my-2.5 h-px bg-border" />

      {settings.groups.map((group, index) => (
        <SettingsGroup
          key={group.key}
          group={group}
          first={index === 0}
          currentPath={current}
          basePath={basePath}
          collapsed={collapsed}
        />
      ))}
    </div>
  );
}

function SettingsGroup({
  group,
  first,
  currentPath,
  basePath,
  collapsed,
}: {
  group: FusionSidebarSettingsGroup;
  first: boolean;
  currentPath: string | undefined;
  basePath: string;
  collapsed: boolean;
}) {
  const t = useTranslations("ds.settings");
  const label = useSettingsLabel();
  const sectionName = useSettingsSectionName();
  const groupLabel = label(group.label);
  return (
    <div
      className={cn(!first && "mt-2")}
      role="group"
      aria-label={group.viewOnly ? t("groupViewOnly", { group: groupLabel }) : groupLabel}
    >
      {!collapsed ? (
        <p className="flex items-center gap-1.5 px-2.5 pt-3 pb-1.5 type-eyebrow text-muted-foreground/70">
          {groupLabel}
          {group.viewOnly ? <Eye aria-label={t("viewOnly")} className="size-3.5" /> : null}
        </p>
      ) : !first ? (
        <div className="mx-2 my-2 h-px bg-border" />
      ) : null}
      {group.status === "loading" ? (
        <div aria-busy aria-label={t("loadingGroup", { group: groupLabel })} className="flex flex-col gap-0.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={cn("flex items-center gap-3 px-2.5 py-2", collapsed && "justify-center")}>
              <Skeleton className="size-4 shrink-0 rounded-detail" />
              {!collapsed ? <Skeleton className="h-4 flex-1" /> : null}
            </div>
          ))}
        </div>
      ) : group.status === "error" ? (
        withTooltip(
          collapsed,
          t("groupDidNotLoad", { group: groupLabel }),
          <div className={cn("flex items-start gap-3 px-2.5 py-2 text-sm text-muted-foreground", collapsed && "justify-center")}>
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {!collapsed ? (
              <span className="flex flex-col items-start">
                <span>{t("didNotLoad")}</span>
                {group.retry ? (
                  <button
                    type="button"
                    onClick={group.retry}
                    className="rounded-detail font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("tryAgain")}
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>,
        )
      ) : (
        <ul className="flex flex-col gap-0.5">
          {group.sections.map((section) => {
            const sectionLabel = sectionName(section);
            const active = section.path === currentPath;
            const Icon = SETTINGS_SECTION_ICONS[section.id] ?? Settings;
            const content = (
              <span className={rowClass(active, collapsed)}>
                <ActiveMark active={active} />
                <Icon className="size-4 shrink-0" />
                {!collapsed ? <span className="flex-1 truncate">{sectionLabel}</span> : null}
              </span>
            );
            const ariaLabel = collapsed ? sectionLabel : undefined;
            const sameApp = basePath !== "" && section.path.startsWith(`${basePath}/`);
            const link = sameApp ? (
              <Link href={section.path.slice(basePath.length)} aria-label={ariaLabel} aria-current={active ? "page" : undefined}>
                {content}
              </Link>
            ) : (
              // Another module, or the shell: a document load, as with the module switcher.
              <a href={section.path} aria-label={ariaLabel} aria-current={active ? "page" : undefined}>
                {content}
              </a>
            );
            return <li key={section.path}>{withTooltip(collapsed, sectionLabel, link)}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
