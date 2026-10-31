"use client";

import { useTranslations } from "next-intl";
import { Clock } from "@/lib/icons";
import { ActivityTimeline } from "./recent-activity";
import { useTenantRecord } from "./record-shell";

/** The service returns at most this many events, newest first. */
const HISTORY_LIMIT = 50;

/**
 * Everything recorded about this tenant, newest first: provisioning, invitation
 * delivery and recovery, activation, lifecycle and profile changes, each with
 * who acted and when.
 */
export function TenantActivityDestination() {
  const { tenant } = useTenantRecord();
  const t = useTranslations("record.activityPage");
  const entries = tenant.history;

  return (
    <section className="rounded-surface bg-card p-5">
      <header className="flex items-center gap-3">
        <Clock
          aria-hidden="true"
          className="size-8 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          {entries.length > 0 ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {entries.length >= HISTORY_LIMIT
                ? t("latest", { count: entries.length })
                : t("count", { count: entries.length })}
            </p>
          ) : null}
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ActivityTimeline entries={entries} detailed className="mt-5" />
      )}
    </section>
  );
}
