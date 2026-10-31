import type { PersonRoleDto } from "./core-access";
import type { RefreshResponse } from "./platform";

/** Seeing Fusion as someone (B-178): an administrator gets the person's own authority, read-only, for 30 minutes. */
export const viewAsPaths = {
  start: () => "/identity/view-as",
  /** The one change a view token can make. */
  end: () => "/identity/view-as/end",
} as const;

export interface StartViewAsRequest {
  userId: string;
}

export interface ViewAsSessionDto {
  sessionId: string;
  viewerName: string;
  personName: string;
  expiresAt: string;
  roles: PersonRoleDto[];
  /** The person's session: their token, marked read-only, with no refresh token. */
  session: RefreshResponse;
}

/** The problem type every service answers a change with while the token is a view. */
export const READ_ONLY_VIEW_PROBLEM = "read-only-view";
