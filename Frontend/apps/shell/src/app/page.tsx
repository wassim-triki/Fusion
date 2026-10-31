"use client";

import { useEffect } from "react";
import { useAuth, useOrganizationReadyLanding } from "@repo/auth";
import { resolveShellEntryState } from "@/lib/shell-entry";
import { FusionHome } from "@/features/home/fusion-home";

export default function HomePage() {
  const { user, isLoading, logout } = useAuth();
  const { pending, organizationReady } = useOrganizationReadyLanding({
    user,
    isLoading,
  });
  const state = resolveShellEntryState({
    user,
    isLoading,
    organizationReady,
    readinessPending: pending,
  });
  const destination = state.kind === "redirect" ? state.destination : null;

  useEffect(() => {
    if (destination) {
      window.location.replace(destination);
    }
  }, [destination]);

  if (state.kind === "home") {
    return <FusionHome />;
  }

  if (state.kind !== "no-usable-context") {
    return <ShellEntrySkeleton />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-surface bg-card p-8 text-card-foreground">
        <p className="text-sm font-medium text-muted-foreground">Fusion account</p>
        <h1 className="mt-2 text-2xl font-semibold">No workspace is available</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your account is signed in, but it does not currently have access to a
          Fusion workspace. Contact your administrator if you expected access.
        </p>
        <button
          type="button"
          className="mt-6 rounded-control border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={async () => {
            await logout();
            window.location.assign("/auth/signin");
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}

function ShellEntrySkeleton() {
  return (
    <main
      className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16"
      aria-busy="true"
      aria-label="Opening your Fusion workspace"
    >
      <div className="h-48 w-full animate-pulse rounded-surface bg-muted" />
    </main>
  );
}
