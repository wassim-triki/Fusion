"use client";

import { useTranslations } from "next-intl";
import { Skeleton, cn } from "@repo/ds";
import type { OrganizationChangeDto, WorkforceChangeDto } from "@repo/api";
import { CalendarTile, changeDay, useDescribeChange } from "@/features/people/changes/coming-up";
import { useOrganizationEvents } from "./organization-words";

/** A planned change on the slider and in the list: the day it shows on the chart, and what it says. */
export interface PlannedItem {
  key: string;
  /** The first day the chart shows it (a leaver's is the day after their last). */
  day: string;
  /** The day written on it (a leaver's last day). */
  shownDay: string;
  title: string;
  meta: string;
}

/** People's and units' planned changes, in date order. */
export function usePlannedItems(people: WorkforceChangeDto[], units: OrganizationChangeDto[], today: string): PlannedItem[] {
  const describe = useDescribeChange();
  const events = useOrganizationEvents();
  const items: PlannedItem[] = [
    ...people
      .filter((change) => change.effectiveDate > today)
      .map((change) => ({
        key: `p-${change.id}`,
        day: change.effectiveDate,
        shownDay: changeDay(change),
        title: change.person.displayName,
        meta: describe(change),
      })),
    ...units
      .filter((change) => !change.isCancelled && change.effectiveDate > today)
      .map((change) => ({
        key: `u-${change.id}`,
        day: change.effectiveDate,
        shownDay: change.effectiveDate,
        title: change.unitName,
        meta: `${events.label(change)} · ${events.firstContext(change)}`,
      })),
  ];
  return items.sort((a, b) => a.shownDay.localeCompare(b.shownDay) || a.title.localeCompare(b.title));
}

/** "Planned", under the chart: open one to see the organization on its date. */
export function PlannedChanges({
  items, date, loading = false, onOpen,
}: { items: PlannedItem[]; date: string; loading?: boolean; onOpen: (day: string) => void }) {
  const t = useTranslations("organization.planned");
  return (
    <section className="rounded-surface bg-card p-2" aria-labelledby="org-planned">
      <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-2">
        <h2 id="org-planned" className="type-section-title">{t("title")}</h2>
        {items.length ? <span className="type-meta text-muted-foreground">{t("hint")}</span> : null}
      </div>
      {loading ? (
        <div className="grid gap-2 px-2 pb-2" aria-busy>
          <Skeleton className="h-14 w-full rounded-control" />
          <Skeleton className="h-14 w-full rounded-control" />
        </div>
      ) : items.length ? (
        <ul className="grid gap-0.5">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onOpen(item.day)}
                aria-current={item.day === date ? "date" : undefined}
                className={cn(
                  "flex w-full items-center gap-4 rounded-control px-2 py-2 text-start outline-none transition-colors hover:bg-inlay focus-visible:ring-2 focus-visible:ring-ring",
                  item.day === date && "bg-primary-tint"
                )}
              >
                <CalendarTile date={item.shownDay} />
                <span className="min-w-0">
                  <span className="block truncate type-label font-semibold">{item.title}</span>
                  <span className="block truncate type-meta text-muted-foreground">{item.meta}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-3 type-body text-muted-foreground">{t("none")}</p>
      )}
    </section>
  );
}
