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

  const destination = resolveDefaultProductDestination(user);
  if (destination === FUSION_HOME_ROUTE) return { kind: "home" };
  return destination
    ? { kind: "redirect", destination }
    : { kind: "no-usable-context" };
}
