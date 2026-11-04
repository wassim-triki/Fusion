"use client";

import { usePathname } from "next/navigation";
import { getCorePathname, getRoutePageSkeleton } from "./route-skeletons";

/** Presentation only: never mounts the protected page or starts its queries. */
export function CoreRouteSkeleton({ label }: { label?: string }) {
  const pathname = usePathname();
  return (
    <div aria-busy aria-label={label}>
      {getRoutePageSkeleton(getCorePathname(pathname))}
    </div>
  );
}
