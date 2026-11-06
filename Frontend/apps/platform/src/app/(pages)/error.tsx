"use client";

import { PageFailure } from "@repo/auth";

/** Something crashed: the failure page, with Next's code when the server gave one. Never the error's own message. */
export default function PlatformError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageFailure error={error} onRetry={reset} digest={error.digest} />;
}
