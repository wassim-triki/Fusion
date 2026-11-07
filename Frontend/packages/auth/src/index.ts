// Types
export type {
  LoginRequest,
  LoginFailure,
  RegisterRequest,
  RefreshTokenRequest,
  AuthResponse,
  AuthUser,
  AuthState,
  StoredAuth,
} from "./types";

// Auth service
export {
  login,
  register,
  refreshToken,
  logout,
  persistAuth,
  loadAuth,
  clearAuth,
  saveLanguage,
} from "./auth-service";
export { useLanguage } from "./language";
export { TopBarPreferences } from "./components/top-bar-preferences";
export { TopBarSearch } from "./components/top-bar-search";
export { ViewingAsBar } from "./components/viewing-as-bar";
export {
  ADMINISTRATORS_ROLE,
  endViewAs,
  startViewAs,
  useViewAs,
} from "./view-as";
export { useNotificationAlerts } from "./notification-alerts";
export type { NotificationAlerts } from "./auth-service";

// Auth context & hook
export { AuthProvider, useAuth } from "./auth-context";
export type { AuthContextValue } from "./auth-context";
export {
  PLATFORM_ADMIN_ROLE,
  HR_ADMIN_ROLE,
  hasAnyRole,
  canAccessPlatform,
  hasCorePermission,
  canViewTenantAdministration,
  canManageTenantAdministration,
  hasAnyCorePermission,
  canAccessCoreSetup,
  canAccessCoreSettings,
  canManageCoreSettings,
  canSeeCoreSetupNavigation,
  canSeeCoreSettingsNavigation,
  canAccessCorePeople,
  canManageCoreEmployees,
  canViewCoreReports,
  canBuildCoreReports,
  canImportCoreEmployees,
  canManageCoreReporting,
  canProposeCoreChanges,
  canApproveCoreChanges,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  canSeeCorePeopleNavigation,
  canSeeOwnCoreProfileNavigation,
  canSeeCoreTeamNavigation,
  canAccessCoreOrgChart,
  canSeeCoreOrgChart,
  canSeeWholeCoreOrgChart,
  canSeeCoreOrgChartNavigation,
  canViewCoreOrganization,
  canManageCoreOrganization,
  canAccessCoreOverview,
  canAccessCoreAccess,
  canManageCoreAccess,
  canViewWorkforceAccess,
  canManageWorkforceAccess,
  canSeeCoreAccessNavigation,
  canViewCoreAccessProfiles,
  canManageCoreAccessProfiles,
} from "./roles";
export {
  resolveCustomerWorkspaceAccessState,
  hasModuleEntitlement,
  canEnterCoreHr,
  canEnterPerformance,
  resolveFusionAttentionModules,
  CUSTOMER_MODULES,
} from "./customer-workspace-access";
export type { CustomerModule } from "./customer-workspace-access";
export type { CustomerWorkspaceAccessState } from "./customer-workspace-access";
export { InvitationEnd } from "./components/invitation-end";
export { ModuleGate } from "./components/module-gate";
export { PageFailure, PageGone, PageNotFound, PageRefusal } from "./components/page-failure";
export type { FailurePageApp, PageFailureProps } from "./components/page-failure";
export { useHydratedWorkspaceAccess } from "./use-hydrated-workspace-access";
export type { HydratedWorkspaceAccess } from "./use-hydrated-workspace-access";
export {
  getTrustedShellOrigin,
  sanitizeInternalReturnPath,
  resolveDefaultProductDestination,
  resolvePostSignInDestination,
  FUSION_HOME_ROUTE,
} from "./routing";

// Components
export {
  SidebarUserPanel,
  getSidebarAccountLabel,
} from "./components/sidebar-user-panel";
export {
  SignInFrame,
  SignInPage,
  type SignInBrand,
} from "./components/signin-page";
export type { SignInPageProps } from "./components/signin-page";
export { ForgotPasswordPage, ResetPasswordPage } from "./components/password-reset-page";
export {
  finishSsoFlow,
  ProviderButton,
  ProviderMark,
  startSsoFlow,
  takeSsoRefusal,
  useSsoRefusalText,
} from "./sso";
export { SignUpPage } from "./components/signup-page";
export type { SignUpPageProps } from "./components/signup-page";
