"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@repo/ds";
import { StatusBadge } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import type { PersonLeaveDto } from "@repo/api";
import { TreePalm } from "lucide-react";

/** The small leave mark on a person's photo while they are away (B-229): the same everywhere they appear. */
export function LeaveMark({ className }: { className?: string }) {
  const t = useTranslations("profile.leave");
  return (
    <span role="img" aria-label={t("mark")} title={t("mark")}
      className={cn("grid place-items-center rounded-full bg-card text-info shadow-raised", className)}>
      <TreePalm className="size-[60%]" aria-hidden />
    </span>
  );
}

/** A photo with the leave mark on its edge while the person is on leave. */
export function WithLeaveMark({ leave, children, className }: { leave?: PersonLeaveDto | null; children: ReactNode; className?: string }) {
  if (!leave?.now) return <>{children}</>;
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      <LeaveMark className={cn("absolute -bottom-1 -end-1 size-[18px] ring-2 ring-card", className)} />
    </span>
  );
}

/** On leave now: "On leave · back <day>"; scheduled: a quiet "Leave from <day>". */
export function LeaveBadge({ leave }: { leave: PersonLeaveDto }) {
  const t = useTranslations("changes.badge");
  const format = useFormat();
  if (!leave.now) return <StatusBadge tone="neutral">{t("leaveFrom", { date: format.date(leave.from) })}</StatusBadge>;
  return <StatusBadge tone="info" dot>{leave.back ? t("onLeave", { date: format.date(leave.back) }) : t("onLeaveOpen")}</StatusBadge>;
}
