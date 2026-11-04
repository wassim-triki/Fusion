"use client";

import { CoreRouteSkeleton } from "@/shell/route-page-skeleton";

// Route-group loading boundary: renders INSIDE CorePagesShell (frame persists)
// and shows the TARGET route's dedicated skeleton — the same component the
// page's own loading branch renders — so the transition reads as one skeleton.
export default function PagesLoading() {
  return <CoreRouteSkeleton />;
}
