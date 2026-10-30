"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button, Skeleton } from "@repo/ds";
import { StatusBadge } from "@repo/ds/shell";
import { RotateCcw } from "lucide-react";
import type { WorkerProfileView } from "./worker-profile-view";

/** HR's Access tab: the person's Fusion account, and the work email it signs in with. */
export function AccessTab({
  view,
  state,
  onRetry,
  accessAction,
  workEmailAction,
  roles,
}: {
  view: WorkerProfileView;
  state: "loading" | "error" | "ready";
  onRetry: () => void;
  /** Manage or set up the account. */
  accessAction?: ReactNode;
  /** Add or edit the work email. */
  workEmailAction?: ReactNode;
  /** The person's roles and why they have each. */
  roles?: ReactNode;
}) {
  const t = useTranslations("profile");
  const access = view.access;
  return (
    <div className="space-y-10 lg:pt-2">
      <section aria-labelledby="profile-access">
        <h2 id="profile-access" className="mb-3 type-section-title">{t("fusionAccess.title")}</h2>
        {state === "loading" ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : state === "error" || !access ? (
          <div className="flex items-center justify-between gap-4 rounded-surface border border-dashed px-5 py-4">
            <p className="type-body text-muted-foreground">{t("fusionAccess.unavailable")}</p>
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RotateCcw className="size-4" aria-hidden /> {t("fusionAccess.retry")}
            </Button>
          </div>
        ) : (
          <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="type-label text-muted-foreground">{t("fusionAccess.status")}</dt>
              <dd className="mt-1">
                <StatusBadge tone={access.tone} dot>
                  {access.label}
                </StatusBadge>
                {access.detail ? <p className="mt-1.5 type-meta text-muted-foreground">{access.detail}</p> : null}
                {accessAction ? <div className="mt-1.5">{accessAction}</div> : null}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="type-label text-muted-foreground">{t("personal.workEmail")}</dt>
              <dd className="mt-1">
                <p className={view.workEmail ? "truncate type-body text-foreground" : "type-body text-muted-foreground"}>
                  {view.workEmail ?? t("personal.notSet")}
                </p>
                {view.workEmail ? null : <p className="mt-1 type-meta text-muted-foreground">{t("contact.emailRequired")}</p>}
                {workEmailAction ? <div className="mt-1.5">{workEmailAction}</div> : null}
              </dd>
            </div>
          </dl>
        )}
      </section>
      {roles}
    </div>
  );
}
