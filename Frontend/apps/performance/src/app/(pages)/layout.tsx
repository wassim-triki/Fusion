import { Suspense, type ReactNode } from "react";
import { AuthProvider } from "@repo/auth";
import { PerformanceRouteSkeleton } from "@/shell/route-page-skeleton";
import { Toaster } from "@repo/ds/components/ui/sonner";
import { PerformancePagesShell } from "@/shell/performance-pages-shell";
import { PerformanceWorkspaceAccessBoundary } from "@/shell/performance-workspace-access-boundary";
import { LegacyRecordRedirect } from "@/features/performance/components/objective-record/legacy-record-redirect";

// The module frame (sidebar, top bar) renders unconditionally and stays present
// while the session restores. Auth/access resolution and route data loading are
// confined to the content region: the access boundary gates only `children`, and
// its pending/forbidden states render inside the persistent frame rather than
// replacing the whole workspace with a skeleton. The `record` slot shows the
// objective record over the current workspace when it is opened in context.
// Every Performance page is an authenticated workspace view whose frame reads the selected Cycle from
// the URL; none has meaningful static output, so render on request rather than prerender.
export const dynamic = "force-dynamic";

export default function PagesLayout({ children, record }: { children: ReactNode; record: ReactNode }) {
  return (
    <AuthProvider>
      <PerformancePagesShell>
        <Suspense fallback={<PerformanceRouteSkeleton />}>
          <PerformanceWorkspaceAccessBoundary>
            {children}
            {record}
            <LegacyRecordRedirect />
          </PerformanceWorkspaceAccessBoundary>
        </Suspense>
      </PerformancePagesShell>
      <Toaster />
    </AuthProvider>
  );
}
