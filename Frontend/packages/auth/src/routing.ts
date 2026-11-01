import type { AuthUser } from "./types";
import { canAccessPlatform, canViewTenantAdministration } from "./roles";
import { canEnterCoreHr, canEnterPerformance } from "./customer-workspace-access";

const FALLBACK_SHELL_ORIGIN = "http://localhost:3000";
const ENCODED_BACKSLASH = /%5c/i;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function containsUnsafeEncoding(value: string): boolean {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current.includes("\\") || containsControlCharacter(current) || ENCODED_BACKSLASH.test(current)) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      current = decoded;
    } catch {
      return true;
    }
  }
  return current.includes("\\") || containsControlCharacter(current);
}

export function getTrustedShellOrigin(explicitOrigin?: string): string {
  if (explicitOrigin) return new URL(explicitOrigin).origin;
  if (typeof window !== "undefined") return window.location.origin;
  return FALLBACK_SHELL_ORIGIN;
}

/**
 * Converts a candidate callback into a same-origin path. Authentication
 * callbacks are navigation intent only; the destination still authorizes the
 * restored session.
 */
export function sanitizeInternalReturnPath(
  candidate: string | null | undefined,
  trustedOrigin?: string
): string | null {
  if (!candidate || containsUnsafeEncoding(candidate)) return null;

  try {
    const origin = getTrustedShellOrigin(trustedOrigin);
    const resolved = new URL(candidate, `${origin}/`);
    if (resolved.origin !== origin || resolved.username || resolved.password) {
      return null;
    }
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

/** The Fusion home at the shell root (D-31). */
export const FUSION_HOME_ROUTE = "/";

/**
 * Product-aware fallback after ordinary authentication. Known journeys such as
 * invitation acceptance use their own purpose-specific destinations instead.
 *
 * Tenant users land on the Fusion home when they can enter at least one module;
 * a tenant administrator always does, since Home carries the company's setup
 * guide until it is done (B-188).
 */
export function resolveDefaultProductDestination(user: AuthUser | null): string | null {
  if (!user) return null;
  if (canAccessPlatform(user) && !user.tenantId) return "/platform";
  if (!user.tenantId) return null;
  if (canViewTenantAdministration(user)) return FUSION_HOME_ROUTE;
  return canEnterCoreHr(user) || canEnterPerformance(user) ? FUSION_HOME_ROUTE : null;
}

export function resolvePostSignInDestination({
  intendedDestination,
  user,
  trustedOrigin,
}: {
  intendedDestination?: string | null;
  user: AuthUser | null;
  trustedOrigin?: string;
}): string | null {
  return sanitizeInternalReturnPath(intendedDestination, trustedOrigin) ?? resolveDefaultProductDestination(user);
}
