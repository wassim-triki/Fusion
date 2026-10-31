import { Skeleton } from "@repo/ds";

export default function OrganizationLoading() {
  return (
    <div className="grid gap-4 px-6 pt-5">
      <Skeleton className="h-9 w-56 rounded-control" />
      <Skeleton className="h-20 w-full rounded-surface" />
      <Skeleton className="h-[520px] w-full rounded-surface" />
    </div>
  );
}
