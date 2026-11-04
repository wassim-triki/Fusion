import { PerformanceRouteSkeleton } from "@/shell/route-page-skeleton";

// Route-group loading boundary: renders INSIDE PerformancePagesShell (the frame
// persists) so a route transition shows one localized in-frame skeleton in the
// content region — never a bare full-screen skeleton that erases navigation.
export default function PagesLoading() {
  return <PerformanceRouteSkeleton />;
}
