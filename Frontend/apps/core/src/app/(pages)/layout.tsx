import { Suspense, type ReactNode } from "react";
import { AuthProvider } from "@repo/auth";
import { CoreRouteSkeleton } from "@/shell/route-page-skeleton";
import { BreadcrumbOverridesProvider } from "@/shell/breadcrumb-overrides";
import { CorePagesShell } from "@/shell/core-pages-shell";
import { CoreWorkspaceAccessBoundary } from "@/shell/core-workspace-access-boundary";
import { Toaster } from "@/components/ui/sonner";

// The module frame (sidebar, top bar) renders unconditionally — its SSR and
// first client paint are identical, and it stays present while the session is
// still restoring. Auth/access resolution and route data loading are confined
// to the content region: the access boundary gates only `children`, and its
// pending/forbidden states render inside the persistent frame rather than
// replacing the whole workspace with a skeleton.
export default function PagesLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <BreadcrumbOverridesProvider>
        <CorePagesShell>
          <Suspense fallback={<CoreRouteSkeleton />}>
            <CoreWorkspaceAccessBoundary>{children}</CoreWorkspaceAccessBoundary>
          </Suspense>
        </CorePagesShell>
      </BreadcrumbOverridesProvider>
      <Toaster />
    </AuthProvider>
  );
}
