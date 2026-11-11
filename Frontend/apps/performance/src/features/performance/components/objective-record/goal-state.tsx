"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ObjectiveStatus } from "@repo/api";
import { StateWord, type StateTone } from "@repo/ds/shell";
import { dayMonth } from "../year/year-words";

const TONE: Record<ObjectiveStatus, StateTone> = { OnTrack: "ok", AtRisk: "warn", OffTrack: "bad" };

/**
 * A goal's state as Performance shows it everywhere (D-96, D-97): the three-step mark and the word, with the day it
 * turned for At risk and Off track. Pass no `since` where the word heads a group of people.
 */
export function GoalState({ status, since, className }: { status: ObjectiveStatus; since?: string | null; className?: string }) {
  const t = useTranslations("objective.GoalState");
  const locale = useLocale();
  return (
    <StateWord tone={TONE[status]} since={since ? t("since", { day: dayMonth(since, locale) }) : undefined} className={className}>
      {t(status)}
    </StateWord>
  );
}
