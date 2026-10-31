"use client";

import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import type { ChangeRequestDto } from "@repo/api";

/** The day a request is about: the last day for leaving, the first day otherwise. */
export function requestDay(request: ChangeRequestDto): string {
  return request.kind === "EndEmployment" && request.change?.lastDay ? request.change.lastDay : request.effectiveDate;
}

/** A request's headline and meta line, in the words Home, notifications and the changes page share. */
export function useRequestWords() {
  const t = useTranslations("changes.requests");
  const format = useFormat();
  return (request: ChangeRequestDto) => {
    const c = request.change;
    const name = request.person.displayName;
    const date = format.date(requestDay(request));
    let title: string;
    if (request.kind === "HomeAddress") title = t("headline.address", { name });
    else if (request.kind === "EndEmployment") title = t("headline.leaving", { name, date });
    else if (c?.titleChanged || c?.unitChanged) {
      title = t("headline.job", { name, summary: [c.titleChanged ? c.titleTo : null, c.unitChanged ? c.unitTo : null].filter(Boolean).join(" · ") });
    } else if (c?.managerChanged) {
      title = c.managerTo ? t("headline.manager", { name, manager: c.managerTo.displayName }) : t("headline.noManager", { name });
    } else title = t("headline.place", { name, summary: c?.locationTo ?? "" });

    const actor = request.requestedBy.displayName;
    const meta = request.kind === "HomeAddress"
      ? t("metaAddress", { actor, date: format.date(request.requestedAt) })
      : request.reason
        ? t("metaReason", { reason: request.reason, actor, date })
        : t("meta", { actor, date });
    const decided = request.status !== "Pending"
      ? t(`decided.${request.status}`, { name: request.decidedBy?.displayName ?? "", date: format.date(request.decidedAt ?? request.requestedAt) })
      : null;
    return { title, meta, decided, date };
  };
}
