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
export { useNotificationAlerts } from "./notification-alerts";
export type { NotificationAlerts } from "./auth-service";

// Auth context & hook
export { AuthProvider, useAuth } from "./auth-context";
export type { AuthContextValue } from "./auth-context";
export {
  PLATFORM_ADMIN_ROLE,
  HR_ADMIN_ROLE,
  MANAGER_ROLE,
  EMPLOYEE_ROLE,
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
  canImportCoreEmployees,
  canManageCoreReporting,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  canSeeCorePeopleNavigation,
  canSeeOwnCoreProfileNavigation,
  canSeeCoreTeamNavigation,
  canAccessCoreOrgChart,
  canSeeCoreOrgChart,
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
export { useHydratedWorkspaceAccess } from "./use-hydrated-workspace-access";
export type { HydratedWorkspaceAccess } from "./use-hydrated-workspace-access";
export {
  getTrustedShellOrigin,
  sanitizeInternalReturnPath,
  resolveDefaultProductDestination,
  resolvePostSignInDestination,
  landingRequiresOrganizationReadiness,
  GETTING_STARTED_ROUTE,
  FUSION_HOME_ROUTE,
} from "./routing";
export type { OrganizationReadinessSignal } from "./routing";
export {
  fetchOrganizationReadySignal,
  useOrganizationReadyLanding,
} from "./organization-ready-landing";
export type { OrganizationReadyLanding } from "./organization-ready-landing";

// Components
export {
  SidebarUserPanel,
  getSidebarAccountLabel,
} from "./components/sidebar-user-panel";
export { SignInFrame, SignInPage, type SignInBrand } from "./components/signin-page";
export type { SignInPageProps } from "./components/signin-page";
export { SignUpPage } from "./components/signup-page";
export type { SignUpPageProps } from "./components/signup-page";
