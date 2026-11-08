import {
  CUSTOMER_MODULES,
  resolveCustomerWorkspaceAccessState,
  sanitizeInternalReturnPath,
  type AuthUser,
  type CustomerWorkspaceAccessState,
} from "@repo/auth";

export type CoreWorkspaceAccessState = CustomerWorkspaceAccessState;

export function buildCoreCallbackUrl(pathname: string, query: string): string {
  const appPath = pathname === "/" ? "/core" : pathname.startsWith("/core") ? pathname : `/core${pathname}`;
  return sanitizeInternalReturnPath(`${appPath}${query ? `?${query}` : ""}`) ?? "/core";
}

export function resolveCoreWorkspaceAccessState(input: {
  isLoading: boolean;
  user: AuthUser | null;
}): CoreWorkspaceAccessState {
  return resolveCustomerWorkspaceAccessState({
    isLoading: input.isLoading,
    user: input.user,
    module: CUSTOMER_MODULES.coreHr,
  });
}
