import type { ElementType, ReactNode } from "react";
import { cn } from "@repo/ds/lib/utils";
import { Unlink } from "@repo/ds/icons";
import { StatusBadge } from "@repo/ds/shell";
import { ObjectiveStatusBadge } from "@repo/performance-ui";
import { ScopeMark } from "../../scope-mark";
import type { ObjectiveRecord } from "../objective-record-model";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

/**
 * Who and what an objective is at a glance: its mark, title, kind, state and accountable person. The
 * record's header — and the block any other surface (a review, a result) shows when it cites an
 * objective without opening the whole record.
 */
export function ObjectiveSummary({
  record,
  titleAs: Title = "h3",
  trailing,
}: {
  record: ObjectiveRecord;
  /** The element the title renders as — the record passes its accessible sheet title. */
  titleAs?: ElementType<{ className?: string; children?: ReactNode }>;
  trailing?: ReactNode;
}) {
  const t = useTranslations("objective.ObjectiveSummary");
  const model = useSay("objective.model");
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-(--type-ring) bg-(--type-tint) text-(--type-ink)">
        {record.accent === "info" ? <Unlink className="size-5" aria-hidden /> : <ScopeMark className="size-7" />}
      </span>
      <div className="min-w-0 flex-1">
        <Title className={cn(Title === "h1" ? "type-page-title" : "type-section-title", "text-foreground")}>{record.title}</Title>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 type-meta">
          <span className="font-medium text-(--type-ink)">{record.kindLabel}</span>
          {/* A plan objective's own state is its status; the plan's state is context, said below. */}
          {record.kind === "plan" ? null : (
            <StatusBadge tone={record.status.tone} dot>
              {model(`status.${record.status.label}`)}
            </StatusBadge>
          )}
          <ObjectiveStatusBadge status={record.source.status?.value ?? null} />
        </p>
        <p className="mt-1.5 truncate type-meta text-muted-foreground">
          {t("accountable")} <span className="text-foreground">{record.accountable.name ?? t("unassigned")}</span>
          {record.kind === "plan" && record.status.label !== "Approved" ? ` · ${record.status.label === "Submitted" ? model("planWaiting") : model("planDraft")}` : null}
        </p>
      </div>
      {trailing}
    </div>
  );
}
