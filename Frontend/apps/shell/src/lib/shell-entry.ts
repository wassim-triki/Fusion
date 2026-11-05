import { FUSION_HOME_ROUTE, resolveDefaultProductDestination } from "@repo/auth";
import type { AuthUser } from "@repo/auth";

export type ShellEntryState =
  | { kind: "loading" }
  /** The shell root renders the Fusion home in place. */
  | { kind: "home" }
  | { kind: "redirect"; destination: string }
  | { kind: "no-usable-context" };

export function resolveShellEntryState({
  isLoading,
  user,
}: {
  isLoading: boolean;
  user: AuthUser | null;
}): ShellEntryState {
  if (isLoading) {
    return { kind: "loading" };
  }

  // No session at all is a signed-out visitor, not an account without a workspace.
  if (!user) return { kind: "redirect", destination: "/auth/signin" };

  const destination = resolveDefaultProductDestination(user);
  if (destination === FUSION_HOME_ROUTE) return { kind: "home" };
  return destination
    ? { kind: "redirect", destination }
    : { kind: "no-usable-context" };
}
