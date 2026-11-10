"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@repo/auth";
import { ArrowLeft } from "@repo/ds/icons";
import { planHref, withCycle } from "@/lib/performance-routes";
import { PageContainer } from "@repo/ds/shell";
import { Button } from "@repo/ds/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@repo/ds/components/ui/sheet";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { cn } from "@repo/ds/lib/utils";
import type { ObjectiveRecord, RecordSectionId } from "./objective-record-model";
import { resolveSections } from "./objective-record-model";
import { useTranslations } from "next-intl";
import { english, type Say } from "@/i18n/say";
import { useSay } from "@repo/ds/lib/say";

// The objective's accent, inherited by every accent inside: amber for direction and aligned objectives,
// blue for a standalone plan objective — the colour its card carries everywhere else.
const ACCENT: Record<ObjectiveRecord["accent"], { className: string; style: CSSProperties }> = {
  primary: {
    className: "[--type-tint:var(--primary-tint)] [--type-ring:var(--primary-ring)] [--type-ink:var(--primary-ink)]",
    style: { "--type-accent": "var(--primary)" } as CSSProperties,
  },
  info: {
    className:
      "[--type-tint:color-mix(in_oklab,var(--info)_10%,transparent)] [--type-ring:color-mix(in_oklab,var(--info)_20%,transparent)] [--type-ink:var(--info)]",
    style: { "--type-accent": "var(--info)" } as CSSProperties,
  },
};

export type RecordSheetState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error"; onRetry: () => void }
  | { status: "ready"; record: ObjectiveRecord };

/**
 * The record's shell and nothing more: a right-hand sheet with a header, the body the model resolves,
 * and an action area. It knows no section's logic — `renderSection` draws each section, `header` and
 * `actions` are supplied — so the same record composes identically wherever it is opened, and sections
 * stay reusable on their own.
 */
export function ObjectiveRecordSheet({
  open,
  onOpenChange,
  state,
  header,
  renderSection,
  actions,
  presentation = "sheet",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: RecordSheetState;
  header: (record: ObjectiveRecord) => ReactNode;
  renderSection: (id: RecordSectionId, record: ObjectiveRecord) => ReactNode;
  actions: (record: ObjectiveRecord) => ReactNode;
  presentation?: "sheet" | "page";
}) {
  const t = useTranslations("objective.ObjectiveRecordSheet");
  const backWords = useSay("objective.back");
  const accent = ACCENT[state.status === "ready" ? state.record.accent : "primary"];
  const { user } = useAuth();

  if (presentation === "page") {
    const record = state.status === "ready" ? state.record : null;
    const back = record ? recordBack(record, user?.employeeId ?? null, backWords) : null;
    // Document + sidebar: what happens to the objective reads down the main column; what defines it (measure,
    // window, weight) and what you can do sit beside it.
    const main = record ? resolveSections(record).flatMap((row) => (typeof row === "string" ? [row] : [...row])) : [];
    return (
      <PageContainer width="wide">
        <article className={cn("space-y-6", accent.className)} style={accent.style}>
          {back ? (
            <Link href={back.href} className="inline-flex items-center gap-1.5 type-meta text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden />
              {back.label}
            </Link>
          ) : null}
          {record ? (
            <>
              <header className="border-b border-border pb-6">{header(record)}</header>
              {(
                <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0 space-y-8">
                    {main.map((id) => (
                      <div key={id}>{renderSection(id, record)}</div>
                    ))}
                  </div>
                  <aside className="min-w-0 space-y-6 lg:sticky lg:top-6">
                    {actions(record)}
                  </aside>
                </div>
              )}
            </>
          ) : state.status === "loading" ? (
            <div className="max-w-3xl space-y-5" aria-label={t("loadingObjective")}>
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-32 w-full rounded-surface" />
              <Skeleton className="h-48 w-full rounded-surface" />
            </div>
          ) : (
            <div className="space-y-4 py-12">
              <h1 className="type-page-title">{state.status === "denied" ? t("thisObjectiveIsntAvailableTo") : t("thisObjectiveCouldNotBe")}</h1>
              {state.status === "error" ? <Button variant="outline" onClick={state.onRetry}>{t("tryAgain")}</Button> : null}
            </div>
          )}
        </article>
      </PageContainer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "flex w-full flex-col gap-0 overflow-hidden bg-inlay p-0 dark:bg-popover data-[side=right]:sm:max-w-[540px]",
          accent.className
        )}
        style={accent.style}
      >
        {state.status === "ready" ? (
          <>
            <div className="border-b border-border p-5 pe-12">{header(state.record)}</div>
            <SheetDescription className="sr-only">{t("objectiveRecordFor", { title: state.record.title })}</SheetDescription>
            {(
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                  {resolveSections(state.record).map((row) =>
                    typeof row === "string" ? (
                      <div key={row}>{renderSection(row, state.record)}</div>
                    ) : (
                      <div key={row.join("+")} className="grid grid-cols-2 gap-4">
                        {row.map((id) => (
                          <div key={id} className="flex">
                            <div className="w-full [&>section]:h-full">{renderSection(id, state.record)}</div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
                {actions(state.record)}
              </>
            )}
          </>
        ) : state.status === "loading" ? (
          <RecordLoading />
        ) : (
          <RecordUnavailable
            title={state.status === "denied" ? t("thisObjectiveIsntAvailableTo") : t("thisObjectiveCouldNotBe")}
            onRetry={state.status === "error" ? state.onRetry : undefined}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Where a directly opened record leads back to: the plan it belongs to, else the direction it's part of. */
function recordBack(record: ObjectiveRecord, viewerEmployeeId: string | null, say: Say = english("objective.back")): { href: string; label: string } {
  const plan = record.source.plan;
  if (record.kind === "plan" && plan) {
    const own = viewerEmployeeId !== null && plan.owner.id === viewerEmployeeId;
    return {
      href: own ? withCycle("/goals?tab=you", record.ref.cycleId) : planHref({ cycleId: record.ref.cycleId, planId: plan.planId }),
      label: own ? say("myPlan") : say("theirPlan", { name: plan.owner.name ?? say("their") }),
    };
  }
  return { href: withCycle("/goals?tab=company", record.ref.cycleId), label: say("direction") };
}

function RecordLoading() {
  const t = useTranslations("objective.RecordLoading");
  return (
    <>
      <div className="border-b border-border p-5 pe-12">
        <SheetTitle className="sr-only">{t("objective")}</SheetTitle>
        <SheetDescription className="sr-only">{t("loadingTheObjective")}</SheetDescription>
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-10 shrink-0 rounded-control" />
          <div className="w-full space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <Skeleton className="h-16 w-full rounded-surface" />
        <Skeleton className="h-32 w-full rounded-surface" />
        <Skeleton className="h-28 w-full rounded-surface" />
      </div>
    </>
  );
}

function RecordUnavailable({ title, onRetry }: { title: string; onRetry?: () => void }) {
  const t = useTranslations("objective.RecordUnavailable");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <SheetTitle className="type-panel-title">{title}</SheetTitle>
      <SheetDescription className="sr-only">{title}</SheetDescription>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("tryAgain")}
        </Button>
      ) : null}
    </div>
  );
}
