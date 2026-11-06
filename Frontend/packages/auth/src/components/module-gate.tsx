"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../auth-context";
import { hasModuleEntitlement, type CustomerModule } from "../customer-workspace-access";

interface ModuleGateProps {
  /** The entitlement the module needs; null for a retired module no company can have. */
  module: CustomerModule | null;
  /** Paths inside the app, without its base path, that stay open to anyone. */
  publicPaths?: readonly string[];
  children: ReactNode;
}

/**
 * The shell's middleware only sees a cookie hint, so a typed address to a module
 * the company doesn't have is turned back here, in the browser: a signed-in person
 * without the entitlement goes Home. Someone not signed in passes, for the app's
 * own handling. The module's API stays the authority on its data.
 */
export function ModuleGate({ module, publicPaths = [], children }: ModuleGateProps) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const isPublic = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const refused = !isPublic && !isLoading && user !== null && (module === null || !hasModuleEntitlement(user, module));

  useEffect(() => {
    if (refused) window.location.replace("/");
  }, [refused]);

  if (isPublic) return <>{children}</>;
  if (isLoading || refused) return null;
  return <>{children}</>;
}
