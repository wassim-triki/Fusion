import { Suspense, type ReactNode } from "react";
import { AuthProvider } from "@repo/auth";
import { PlatformRouteSkeleton } from "@/shell/route-page-skeleton";
import { PlatformAccessBoundary } from "@/features/access/platform-access-boundary";
import { PlatformPagesShell } from "@/shell/platform-pages-shell";

export default async function PagesLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PlatformPagesShell>
        <Suspense
          fallback={
            <PlatformRouteSkeleton />
          }
        >
          <PlatformAccessBoundary>{children}</PlatformAccessBoundary>
        </Suspense>
      </PlatformPagesShell>
    </AuthProvider>
  );
}
