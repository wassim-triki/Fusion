"use client";

import { PageFailure, useAuth } from "@repo/auth";
import { HomeFrame } from "@/features/home/home-frame";

/** Something crashed: the failure page, with Next's code when the server gave one. Never the error's own message. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { user } = useAuth();
  const failure = <PageFailure error={error} onRetry={reset} digest={error.digest} />;
  // The frame stays for someone signed in; before sign-in there is none to keep.
  return user ? <HomeFrame>{failure}</HomeFrame> : failure;
}
