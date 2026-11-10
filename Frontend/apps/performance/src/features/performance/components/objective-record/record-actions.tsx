"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import Link from "next/link";
import { toast } from "sonner";
import { GitBranch, Pencil, Trash2 } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import { cn } from "@repo/ds/lib/utils";
import { AsyncButton } from "@repo/ds/shell";
import { useGoalMutations, useSaveStrategy } from "../../api/use-performance";
import type { ObjectiveRecord } from "./objective-record-model";
import { useTranslations } from "next-intl";

/**
 * The record's actions, each offered only when the server says this viewer may take it. Company direction
 * is maintained through strategy, team objectives through goals — the record routes each to its own
 * transport so the same buttons mean the same thing on every objective.
 */
export function RecordActions({
  record,
  canOpenDirection,
  onEdit,
  onRemoved,
  presentation = "sheet",
}: {
  record: ObjectiveRecord;
  /** The viewer can enter the organization-direction workspace (navigation, not readability). */
  canOpenDirection: boolean;
  onEdit: () => void;
  onRemoved: () => void;
  presentation?: "sheet" | "page";
}) {
  const t = useTranslations("objective.RecordActions");
  const goals = useGoalMutations(record.ref.cycleId);
  const strategy = useSaveStrategy(record.ref.cycleId);
  const isCompany = record.kind === "company";
  const publish = isCompany ? strategy.publish : goals.publish;
  const remove = isCompany ? strategy.remove : goals.remove;
  const archive = isCompany ? strategy.archive : goals.archive;
  const showDirectionLink = canOpenDirection && record.kind !== "plan";

  if (!record.can.edit && !record.can.remove && !record.can.publish && !record.can.archive && !showDirectionLink) return null;

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", presentation === "sheet" ? "border-t border-border bg-inlay px-5 py-3.5 dark:bg-popover" : "py-2")}>
      <div className="flex items-center gap-1.5">
        {record.can.edit ? (
          <Button writes variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5" data-icon="inline-start" /> {t("edit")}
          </Button>
        ) : null}
        {record.can.remove ? (
          <AsyncButton
            variant="ghost"
            size="sm"
            pending={remove.isLoading}
            onClick={async () => {
              try {
                await remove.mutateAsync({ objectiveId: record.ref.objectiveId, expectedVersion: record.source.node.version });
                toast.success(t("draftObjectiveRemoved"));
                onRemoved();
              } catch (error) {
                reportPerformanceFailure(error, t("theObjectiveCouldNotBe"));
              }
            }}
          >
            <Trash2 className="size-3.5" data-icon="inline-start" /> {t("remove")}
          </AsyncButton>
        ) : null}
        {record.can.archive ? (
          <AsyncButton variant="outline" size="sm" pending={archive.isLoading} pendingLabel={t("archiving")}
            onClick={async () => {
              try {
                await archive.mutateAsync({ objectiveId: record.ref.objectiveId, expectedVersion: record.source.node.version });
                toast.success(t("objectiveArchived"));
              } catch (error) { reportPerformanceFailure(error, t("theObjectiveCouldNotBe2")); }
            }}>
            {t("archive")}
          </AsyncButton>
        ) : null}
        {showDirectionLink ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/goals?view=map&focus=${record.ref.objectiveId}`}>
              <GitBranch className="size-3.5" data-icon="inline-start" /> {t("openInOrganizationDirection")}
            </Link>
          </Button>
        ) : null}
      </div>
      {record.can.publish ? (
        <AsyncButton
          size="sm"
          pending={publish.isLoading}
          onClick={async () => {
            try {
              await publish.mutateAsync({ objectiveId: record.ref.objectiveId, expectedVersion: record.source.node.version });
              toast.success(isCompany ? t("publishedCompany") : t("publishedOrg"));
            } catch (error) {
              reportPerformanceFailure(error, t("theObjectiveCouldNotBe3"));
            }
          }}
        >
          {t("publish")}
        </AsyncButton>
      ) : null}
    </div>
  );
}
