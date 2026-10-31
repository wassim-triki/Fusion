import { PLATFORM_ADMIN_ROLE } from "./roles";
import type { AuthUser } from "./types";

/** The account type in plain words, for the sidebar's person panel when Core HR has no job title. */
export function getSidebarAccountLabel(user: AuthUser): string {
  if (user.roles.includes(PLATFORM_ADMIN_ROLE)) {
    return "Platform Admin";
  }

  const administratorProfile = user.accessProfiles.find(
    (profile) => profile.name === "Tenant Administrator"
  );
  if (administratorProfile) {
    return administratorProfile.name;
  }

  if (!user.employeeId) {
    return "Account";
  }

  return user.accessProfiles.length > 1
    ? `${user.accessProfiles[0]?.name ?? "Access profile"} +${
        user.accessProfiles.length - 1
      }`
    : user.accessProfiles[0]?.name ?? "Employee";
}
