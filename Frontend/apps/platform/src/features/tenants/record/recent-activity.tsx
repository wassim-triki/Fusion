"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSay, type Say } from "@repo/ds/lib/say";
import { Clock } from "@/lib/icons";
import { cn } from "@repo/ds/lib/utils";
import type { TenantHistoryEntry } from "../api";
import { isFailureOutcome, useTenantWords } from "../language";
import { destinationHref } from "./record-routes";
import { useTenantRecord } from "./record-shell";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * Recent activity — a short tail of the tenant's platform-control-plane history.
 *
 * It answers "what just happened?" at a glance and hands off to the Activity
 * destination for the full timeline; it never becomes the log itself. Each entry
 * states what happened and when, drawn from the record's own audit trail rather
 * than assembled here.
 */
const PREVIEW_LIMIT = 4;

export function RecentActivity() {
  const { tenant, query } = useTenantRecord();
  const entries = tenant.history.slice(0, PREVIEW_LIMIT);
  const activityHref = `${destinationHref(tenant.tenantId, "activity")}${query}`;
  const t = useTranslations("record.activity");

  return (
    <section className="rounded-surface bg-card p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Clock aria-hidden="true" className="size-8 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
        </div>
        {entries.length > 0 ? (
          <Link
            href={activityHref}
            className="rounded-control text-sm font-medium text-primary-ink hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t("view")}
          </Link>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ActivityTimeline entries={entries} className="mt-4" />
      )}
    </section>
  );
}

/**
 * The tenant's events as one connected sequence. The Overview shows a short
 * tail with relative times; the Activity destination shows everything, with who
 * acted and the exact moment.
 */
export function ActivityTimeline({
  entries,
  detailed = false,
  className,
}: {
  entries: TenantHistoryEntry[];
  detailed?: boolean;
  className?: string;
}) {
  return (
    <ol className={className}>
      {entries.map((entry, index) => (
        <ActivityRow
          key={`${entry.eventType}-${entry.occurredAt}-${index}`}
          entry={entry}
          last={index === entries.length - 1}
          detailed={detailed}
        />
      ))}
    </ol>
  );
}

function ActivityRow({
  entry,
  last,
  detailed,
}: {
  entry: TenantHistoryEntry;
  last: boolean;
  detailed: boolean;
}) {
  const failed = isFailureOutcome(entry.outcome);
  const words = useTenantWords();
  const format = useFormat();
  const say = useSay("record.activity.describe");
  const t = useTranslations("record.activity");

  return (
    <li className="flex gap-3">
      {/* The rail: a dot per event joined by a continuous line, so the entries
          read as one sequence rather than as separate rows. */}
      <div className="flex flex-col items-center" aria-hidden="true">
        <span
          className={cn(
            "mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-card",
            failed ? "bg-destructive" : "bg-primary"
          )}
        />
        {!last ? <span className="w-px flex-1 bg-border" /> : null}
      </div>

      <div className={cn("min-w-0 flex-1", last ? "" : "pb-5")}>
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={cn(
              "min-w-0 truncate text-sm font-medium",
              failed ? "text-destructive" : "text-foreground"
            )}
          >
            {words.eventTitle(entry.eventType, failed)}
          </p>
          {detailed ? null : (
            <time
              dateTime={entry.occurredAt}
              title={format.dateTime(entry.occurredAt, { year: "always" })}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {words.relative(entry.occurredAt)}
            </time>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {describe(entry.eventType, failed, say)}
        </p>
        {detailed ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {entry.actorName?.trim()
              ? t("by", { name: entry.actorName.trim() })
              : t("byPlatform")}
            <span aria-hidden="true"> · </span>
            <time dateTime={entry.occurredAt}>
              {format.dateTime(entry.occurredAt, { year: "always" })}
            </time>
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One truthful line per event kind. It states what the event means for the
 * tenant — not fabricated specifics the audit record does not carry (a
 * recipient's name, a module list), which would be invention dressed as detail.
 */
const DESCRIBED_EVENTS = new Set([
  "TenantProvisioned",
  "InvitationResent",
  "InvitationRevoked",
  "InvitationReplaced",
  "InvitationReissued",
  "BootstrapCompleted",
  "ActivationRejected",
  "TenantDeactivated",
  "TenantReactivated",
  "TenantProfileChanged",
  "TenantArchived",
]);

function describe(eventType: string, failed: boolean, say: Say): string {
  if (eventType === "InvitationDeliveryAttempted") {
    return say(failed ? "deliveryFailed" : "deliverySent");
  }
  if (DESCRIBED_EVENTS.has(eventType)) return say(eventType);
  return say(failed ? "failed" : "recorded");
}
