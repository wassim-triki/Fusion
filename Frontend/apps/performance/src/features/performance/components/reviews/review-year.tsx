"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PerformanceReviewDto, ReviewYearItemDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Clapping, Lock, MessagesSquare, OneOnOnes, Paperclip, Pencil, Target, Users } from "@repo/ds/icons";
import { dayMonth } from "../year/year-words";

export type YearFilter = "all" | "goals" | "praise" | "feedback" | "peers" | "oneone";

type Kind = Exclude<YearFilter, "all">;
const GROUP: Record<string, Kind> = {
  objective: "goals", evidence: "goals", praise: "praise", feedback: "feedback", peer: "peers", "one-on-one": "oneone", "private-note": "oneone",
};
const ICON: Record<Kind, typeof Target> = { goals: Target, praise: Clapping, feedback: MessagesSquare, peers: Users, oneone: OneOnOnes };
/** Each kind of item with its own icon and hue (B-460), so a goal's update, its evidence, a 1:1 and a note never look alike. */
const KIND: Record<string, { icon: typeof Target; tone: string }> = {
  objective: { icon: Target, tone: "text-primary-ink" },
  evidence: { icon: Paperclip, tone: "text-identity-2" },
  praise: { icon: Clapping, tone: "text-identity-5" },
  feedback: { icon: MessagesSquare, tone: "text-identity-1" },
  peer: { icon: Users, tone: "text-identity-3" },
  "one-on-one": { icon: OneOnOnes, tone: "text-identity-6" },
  "private-note": { icon: Pencil, tone: "text-muted-foreground" },
};

/** An item's number in the year by its key, what a drafted sentence shows as its citation. */
export function citationNumbers(items: readonly ReviewYearItemDto[] | undefined): Map<string, number> {
  return new Map((items ?? []).map((item) => [item.key, item.number]));
}

/**
 * The person's year beside the review (H3), as drawn: what Fusion drafted from, numbered as each sentence cites it,
 * filtered by kind. Kinds with nothing in them stay, dimmed (D-60). A cited item lights up when its sentence is picked.
 */
export function ReviewYear({ record, items, loading, cite, title, since, pendingPeers = [] }: {
  record: PerformanceReviewDto;
  items: readonly ReviewYearItemDto[] | undefined;
  loading: boolean;
  cite: string | null;
  title: string;
  since: string;
  /** Colleagues asked who haven't answered: outlines after the peers who did (manager only). */
  pendingPeers?: string[];
}) {
  const t = useTranslations("reviews.Year");
  const [filter, setFilter] = useState<YearFilter>("all");
  const filters: YearFilter[] = record.lens === "Subject" ? ["all", "goals", "praise", "feedback", "oneone"] : ["all", "goals", "praise", "feedback", "peers", "oneone"];
  const count = (f: YearFilter) => f === "all" ? (items?.length ?? 0) : (items ?? []).filter((item) => GROUP[item.kind] === f).length;
  const shown = (items ?? []).filter((item) => filter === "all" || GROUP[item.kind] === filter);
  const pending = filter === "all" || filter === "peers" ? pendingPeers : [];

  return (
    <aside aria-label={title} className="grid content-start gap-3 rounded-surface bg-section px-[22px] pb-10 pt-[18px] lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
      <div className="flex items-center gap-3">
        <h2 className="type-section-title text-foreground">{title}</h2>
        <span className="ms-auto text-[13px] text-muted-foreground">{since}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filter")}>
        {filters.map((f) => {
          const n = count(f);
          const FilterIcon = f === "all" ? null : ICON[f];
          return (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={cn("inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                n === 0 && f !== "all" && "opacity-50")}>
              {FilterIcon ? <FilterIcon aria-hidden className="size-3.5" /> : null}
              {t(`filters.${f}`)}
              <span className="tabular-nums opacity-60">{n}</span>
            </button>
          );
        })}
      </div>
      {loading ? (
        <div className="grid gap-2" aria-label={t("loading")}>
          <Skeleton className="h-16 w-full rounded-inset" />
          <Skeleton className="h-16 w-full rounded-inset" />
          <Skeleton className="h-16 w-full rounded-inset" />
        </div>
      ) : (
        <>
          {shown.map((item) => <YearItem key={item.key} item={item} lit={cite === item.key} />)}
          {pending.map((name) => (
            <div key={name} className="grid gap-1.5 rounded-inset border-[1.5px] border-dashed border-border px-3.5 py-3">
              <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Users aria-hidden className="size-[15px]" />{t("peer", { name })}</span>
              <span className="text-sm text-muted-foreground">{t("notAnsweredYet")}</span>
            </div>
          ))}
          {shown.length === 0 && pending.length === 0 ? <span className="px-0.5 py-1 text-sm text-muted-foreground">{t("nothingYet")}</span> : null}
        </>
      )}
    </aside>
  );
}

function YearItem({ item, lit }: { item: ReviewYearItemDto; lit: boolean }) {
  const t = useTranslations("reviews.Year");
  const locale = useLocale();
  const group: Kind = GROUP[item.kind] ?? "goals";
  const { icon: Icon, tone } = KIND[item.kind] ?? { icon: ICON[group], tone: "text-muted-foreground" };
  const when = dayMonth(item.at, locale);
  const head =
    item.kind === "objective" ? t("head.goal", { day: when })
      : item.kind === "evidence" ? t("head.evidence", { day: when })
        : item.kind === "praise" ? t("head.praise", { who: item.who ?? "", day: when })
          : item.kind === "feedback" ? t("head.feedback", { who: item.who ?? "", day: when })
            : item.kind === "one-on-one" ? t("head.oneOnOne", { day: when })
              : item.kind === "private-note" ? t("head.yourNote", { day: when })
                : t("head.peer", { who: item.who ?? "" });
  const quoted = ["praise", "feedback", "peer", "one-on-one", "private-note"].includes(item.kind);
  return (
    <div id={`year-${item.key}`} className={cn("grid gap-1.5 rounded-inset bg-card px-3.5 py-3 transition-[box-shadow,background-color] duration-300",
      lit && "bg-primary/[0.08] shadow-[inset_0_0_0_1.5px_var(--primary)]")}>
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span data-kind={item.kind} className={cn("inline-grid size-6 shrink-0 place-items-center rounded-lg bg-inlay", tone)}><Icon aria-hidden className="size-[15px]" /></span>
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-inlay px-[5px] text-[11px] font-semibold tabular-nums">{item.number}</span>
        <span className="min-w-0 truncate">{head}</span>
        {item.private ? <span className="ms-auto inline-flex shrink-0 items-center gap-1" title={t("private")}><Lock aria-hidden className="size-3.5" /><span className="sr-only">{t("private")}</span></span> : null}
      </div>
      {item.title ? <span className="type-narrative text-[15px] font-medium leading-snug text-foreground">{item.title}</span> : null}
      {item.body ? (
        quoted
          ? <span className="type-narrative line-clamp-4 text-[15px] leading-normal text-foreground">“{item.body}”</span>
          : <span className="text-sm text-muted-foreground">{item.body}</span>
      ) : null}
    </div>
  );
}
