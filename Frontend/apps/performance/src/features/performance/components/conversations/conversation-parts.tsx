"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { FeedbackSubjectDto } from "@repo/api";
import { cn } from "@repo/ds/lib/utils";
import { ValueChip } from "@repo/performance-ui";
import { Target } from "@repo/ds/icons";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/** Paths from the server carry the app's base path; the router adds it itself. */
export function inApp(href: string) {
  return href.replace(/^\/performance/, "") || "/";
}

export function firstName(name: string | null | undefined): string {
  return (name ?? "").split(/\s+/)[0] || "They";
}

/**
 * What feedback or a request is about: an objective as a quiet chip with its mark (a link when it has a record), a
 * company value in its own hue.
 */
export function SubjectChip({ subject, link = false, className }: { subject: FeedbackSubjectDto; link?: boolean; className?: string }) {
  if (subject.kind === "Competency" && subject.competencyId) {
    return <ValueChip value={{ id: subject.competencyId, name: subject.label }} className={className} />;
  }
  const chip = (
    <>
      <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{subject.label}</span>
    </>
  );
  const shape = cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-control-sm bg-inlay px-2 type-meta-strong text-foreground", className);
  return link && subject.href ? (
    <Link href={inApp(subject.href)} className={cn(shape, "hover:underline")}>{chip}</Link>
  ) : (
    <span className={shape}>{chip}</span>
  );
}

/** Items grouped under their month, the month set in its own column on wide screens. */
export function ByMonth<T>({ items, at, render }: { items: readonly T[]; at: (item: T) => string; render: (item: T) => ReactNode }) {
  const format = useFormat();
  const groups: { key: string; label: string; items: T[] }[] = [];
  const thisYear = new Date().getFullYear();
  for (const item of items) {
    const date = new Date(at(item));
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = {
        key,
        label: format.parts(date, { month: "long", ...(date.getFullYear() === thisYear ? {} : { year: "numeric" }) }),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} className="grid gap-3 md:grid-cols-[6rem_minmax(0,1fr)] md:gap-5">
          <h3 className="type-meta text-muted-foreground md:pt-5">{group.label}</h3>
          <ul className="space-y-3">{group.items.map(render)}</ul>
        </section>
      ))}
    </div>
  );
}

/** A due date as a block: the weekday when it's this week, else the date; amber once it's close, red when past. */
export function DueBlock({ date, overdue }: { date: string; overdue: boolean }) {
  const format = useFormat();
  const t = useTranslations("conversations.DueBlock");
  const due = new Date(`${date}T00:00:00`);
  const days = Math.round((due.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const label = days === 0 ? t("today") : days === 1 ? t("tomorrow") : days > 1 && days < 7
    ? format.parts(due, { weekday: "short" })
    : format.parts(due, { day: "numeric", month: "short" });
  return (
    <span
      className={cn(
        "flex w-20 shrink-0 flex-col items-center justify-center rounded-control py-2.5 text-center",
        overdue ? "bg-destructive/12 text-destructive" : days <= 3 ? "bg-primary-tint text-primary-ink ring-1 ring-primary-ring" : "bg-inlay text-foreground",
      )}
    >
      <span className="type-meta">{overdue ? t("overdue") : t("due")}</span>
      <span className="type-label tabular-nums">{label}</span>
    </span>
  );
}
