import { toast } from "sonner";
import { ApiError } from "@repo/api";
import { showStatus } from "@repo/ds/components/ui/status-pill";
import enCommon from "../../../../messages/en/common.json";
import frCommon from "../../../../messages/fr/common.json";
import arCommon from "../../../../messages/ar/common.json";

/**
 * The page's language, read when a failure is reported (always in the browser, after an action). The service words
 * its refusals in English, so they read as sent in English and as the screen's own line in other languages.
 */
function language(): string {
  return typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
}

const COMMON: Record<string, typeof enCommon> = { fr: frCommon, ar: arCommon };

function words() {
  return (COMMON[language()] ?? enCommon).failure;
}

export function performanceFailure(error: unknown, fallback?: string) {
  const kind = error instanceof ApiError ? error.failureKind : null;
  const w = words();
  const english = language() === "en";
  return {
    kind,
    unavailable: kind === "Forbidden",
    refresh: kind === "Stale" || kind === "InvalidState" || kind === "Forbidden",
    message: kind === "Stale" ? w.stale
      : kind === "Forbidden" ? w.unavailable
      : english && error instanceof Error && error.message ? error.message : fallback ?? w.generic,
  };
}

const reported = new WeakSet<Error>();

export function reportPerformanceFailure(error: unknown, fallback?: string) {
  if (error instanceof Error && reported.has(error)) return;
  if (error instanceof Error) reported.add(error);
  const failure = performanceFailure(error, fallback);
  // Someone else changed it first: nothing broke, so a quiet pill says so while the page catches up (B-456).
  if (failure.kind === "Stale") showStatus(failure.message, { tone: "notice" });
  else toast.error(failure.message);
}

export async function recoverPerformanceFailure(error: unknown, refresh: () => Promise<unknown>) {
  const failure = performanceFailure(error);
  if (failure.refresh) await refresh();
  if (failure.kind) reportPerformanceFailure(error);
}
