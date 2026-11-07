import type { AccountPasswordRequirementsDto } from "./tenant-access";

// Password reset by an emailed one-time link (B-295). The token travels in the request body, never in an address.

export const passwordResetPaths = {
  request: () => "/identity/auth/password-reset",
  inspect: () => "/identity/auth/password-reset/inspect",
  complete: () => "/identity/auth/password-reset/complete",
} as const;

/** Where a link stands; `done` only comes back from a completed reset. */
export type PasswordResetState = "ready" | "expired" | "used" | "invalid" | "provider_required" | "done";

export interface PasswordResetLinkDto {
  state: PasswordResetState;
  /** The account's address, only while the link works. */
  email: string | null;
  passwordRequirements: AccountPasswordRequirementsDto;
}
