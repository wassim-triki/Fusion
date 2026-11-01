import {
  canAccessCoreAccess,
  canAccessCoreOverview,
  canAccessCorePeople,
  canAccessCoreSettings,
  canAccessCoreTeam,
  canAccessOwnCoreProfile,
  canManageCoreAccessProfiles,
  type AuthUser,
} from "@repo/auth";

export function resolveInviteAcceptanceDestination(
  user: AuthUser
): string {
  if (canAccessCoreOverview(user)) {
    return "/";
  }

  if (canAccessCoreAccess(user)) {
    return "/access";
  }

  if (canManageCoreAccessProfiles(user)) {
    return "/settings?tab=access-permissions";
  }

  if (canAccessCoreSettings(user)) {
    return "/settings";
  }

  if (canAccessCorePeople(user)) {
    return "/people";
  }

  // Own profile precedes the manager Team workspace: activation must never land a
  // user on Team without genuine team context. Team stays reachable via navigation.
  if (canAccessOwnCoreProfile(user)) {
    return "/profile";
  }

  if (canAccessCoreTeam(user)) {
    return "/team";
  }

  return "/";
}
