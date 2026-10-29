// @repo/ds/shell — shared Platform, Core, and Performance product shell
// (sidebar, app frame, and page-layout kit).

export { ModuleSidebar } from "./module-sidebar";
export { FusionSidebar, sectionPaths, useSettingsSectionName } from "./fusion-sidebar";
export { FUSION_MODULE_ICONS, FUSION_MODULES } from "./modules";
export { ShellUserPanel } from "./shell-user-panel";
export type {
  ShellUserPanelProps,
  ShellUserPanelLink,
} from "./shell-user-panel";
export { AppShell } from "./app-shell";
export type { AppShellProps } from "./app-shell";
export { ThemeProvider, ThemeToggle, useTheme } from "./theme";
export { TopBar } from "./top-bar";
export type { TopBarProps } from "./top-bar";
export { AppBreadcrumb } from "./app-breadcrumb";
export type { AppBreadcrumbProps } from "./app-breadcrumb";
export { PageContainer, PageHeader, PageToolbar } from "./page";
export type {
  PageContainerProps,
  PageHeaderProps,
  PageToolbarProps,
} from "./page";
export { TableFilterToolbar } from "./table-filter-toolbar";
export {
  PageEmpty,
  PageError,
  PageListSkeleton,
  PageLoading,
  PagePermissionNotice,
  PageSkeleton,
} from "./page-states";
export type {
  PageErrorProps,
  PageListSkeletonProps,
  PageLoadingProps,
  PageSkeletonProps,
} from "./page-states";
export {
  InvitationTransactionFrame,
  InvitationTransactionLoading,
  InvitationTransactionTerminalFrame,
  InvitationWordmark,
} from "./invitation-transaction";
export { InvitationContextPanel } from "./invitation-context-panel";
export type { InvitationContextRow } from "./invitation-context-panel";
export { InvitationTerminalCard } from "./invitation-terminal-card";
export { PasswordStrengthField } from "./password-strength-field";
export type { PasswordCheck } from "./password-strength-field";
export { AsyncButton } from "./async-button";
export { StatusBadge } from "./status-badge";
export type { StatusBadgeProps, StatusTone } from "./status-badge";
export {
  KpiStat,
  KpiGrid,
  DashboardSection,
  DashboardPanel,
} from "./dashboard";
export type { KpiStatProps, DashboardSectionProps } from "./dashboard";
export {
  DonutChart,
  AllocationGauge,
  BarChartMini,
  ColumnChart,
  ProgressMeter,
  CHART_PALETTE,
  CHART_TONES,
} from "./charts";
export type { DonutDatum } from "./charts";
export type {
  ShellNavItem,
  ShellNavSection,
  ShellModule,
  ModuleSidebarProps,
  FusionSidebarModule,
  FusionSidebarPerson,
  FusionSidebarProps,
  FusionSidebarRecord,
  FusionSidebarSettings,
  FusionSidebarSettingsGroup,
  FusionSidebarSettingsSection,
} from "./types";
export { NotificationBell, notificationDay, relativeStamp } from "./notification-bell";
export type { NotificationDay, StampWords } from "./notification-bell";
export { claimChime, playChime } from "./notification-arrival";
export type {
  NotificationBellArrival,
  NotificationBellBadge,
  NotificationBellItem,
  NotificationBellModule,
  NotificationBellProps,
} from "./notification-bell";
export { WorkList, daysUntil, dueLabel, useDueWords } from "./work-list";
export type { DueWords, RenderWorkLink, WorkListItem, WorkListModule, WorkListProps } from "./work-list";
export { HomeAgenda, LeadFocus, agendaEntries, momentDay, selectLead, shortDay } from "./home";
export type { HomeAgendaProps, HomeLead, HomeMoment, HomeWorkItem, LeadFocusProps } from "./home";
export {
  LastChange,
  SettingsBlock,
  SettingsBreadcrumb,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsSaveBar,
  SettingsSaved,
  SettingsSkeleton,
  SettingsValue,
  ViewOnlyBadge,
  settingsWhen,
  useSettingsWhen,
} from "./settings";
export { NotificationModeList } from "./notification-modes";
export type { NotificationModeGroup, NotificationModeValue } from "./notification-modes";
export type {
  SettingsBlockProps,
  SettingsConflict,
  SettingsLastChangeValue,
  SettingsPageProps,
  SettingsRowProps,
  SettingsSaveBarProps,
} from "./settings";
