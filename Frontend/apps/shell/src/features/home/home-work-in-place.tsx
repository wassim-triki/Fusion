"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  createPlatformApiClient,
  fusionAttentionQueryKeys,
  getFusionAttentionModule,
  type FusionAttentionModuleKey,
  type FusionWorkItem,
} from "@repo/api";
import { Button, cn } from "@repo/ds";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { dateFormatter } from "@repo/ds/lib/dates";
import type { WorkListItem } from "@repo/ds/shell";
import { QuickPicks } from "@repo/ds/choice";
import { HomeDecision } from "./home-decision";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

const TONE = { ok: "text-success", warn: "text-warning", bad: "text-destructive" } as const;

/** Whether a work item carries something to show or answer in place (B-434). */
export function answersInPlace(item: WorkListItem): boolean {
  const work = item as FusionWorkItem;
  return Boolean(work.lines?.length || work.quote || work.actions?.length || work.booking?.slots.length);
}

/**
 * A Needs you row answered where it stands (D-84): what it's about line by line and the person's own words, then the
 * answer — approve or ask for a change, a time to book from those both are free, or a one-click answer like asking for
 * an update. The row leaves once its module says the work is done; the title still opens where the work lives.
 */
export function HomeWorkInPlace({ item }: { item: WorkListItem }) {
  const t = useTranslations("home.inPlace");
  const locale = useLocale();
  const work = item as FusionWorkItem;
  const client = useMemo(() => createPlatformApiClient(), []);
  const cache = useQueryClient();
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = getFusionAttentionModule(work.module as FusionAttentionModuleKey).apiBase;
  const time = dateFormatter({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, locale);
  const subject = work.subject?.displayName ?? null;

  const send = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      await client.post(`${base}${path}`, body);
      await cache.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() });
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const slots = work.booking?.slots ?? [];
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-3 px-5 py-4 sm:grid-cols-[40px_minmax(0,1fr)_auto]">
      {subject ? (
        <Avatar className="size-10"><AvatarFallback hue={subject} className="text-sm">{initials(subject)}</AvatarFallback></Avatar>
      ) : (
        <span aria-hidden className="size-10 rounded-full bg-inlay" />
      )}
      <div className="grid min-w-0 gap-1">
        <a href={work.href} className="type-label text-foreground hover:underline">{work.title}</a>
        {work.context ? <span className="type-meta text-muted-foreground">{work.context}</span> : null}
        {work.lines?.length ? (
          <ul className="mt-1.5 grid gap-1">
            {work.lines.map((line, index) => (
              <li key={index} className="flex min-w-0 items-baseline gap-2.5">
                <span className="type-narrative min-w-0 truncate text-[15px] text-foreground">{line.text}</span>
                {line.meta ? <span className={cn("shrink-0 type-meta", line.tone ? TONE[line.tone] : "text-muted-foreground")}>{line.meta}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {work.quote ? <q dir="auto" className="type-narrative mt-1.5 text-[14px] text-muted-foreground">{work.quote}</q> : null}
        {slots.length ? (
          <QuickPicks
              className="mt-1"
              label={t("times")}
              value={slots[pick]}
              onPick={(slot) => setPick(slots.indexOf(slot))}
              options={slots.map((slot) => ({ value: slot, label: time.format(new Date(slot)) }))}
            />
        ) : null}
        {error ? <span role="alert" className="type-meta text-destructive">{error}</span> : null}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
        {work.decision ? <HomeDecision item={item} /> : null}
        {work.actions?.map((action) => (
          <Button key={action.path} writes size="sm" variant={action.primary ? "default" : "ghost"} disabled={busy}
            onClick={() => void send(action.path, {})}>
            {action.label}
          </Button>
        ))}
        {slots.length && work.booking ? (
          <Button writes size="sm" disabled={busy} onClick={() => void send(work.booking!.path, { at: slots[pick] })}>{t("bookIt")}</Button>
        ) : null}
      </div>
    </div>
  );
}
