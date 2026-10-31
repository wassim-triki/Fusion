"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
} from "@repo/ds";
import { StatusBadge } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import type { WorkforceChangeDto } from "@repo/api";
import { ArrowRight, Pencil } from "lucide-react";
import { useRefusal } from "@/i18n/words";
import { Monogram } from "../components/workforce-ui";
import { useCancelChange } from "./use-changes";

const first = (name: string) => name.split(" ")[0] ?? name;

/** The day a change is about: the last day for an end of employment, the first day otherwise. */
export function changeDay(change: WorkforceChangeDto): string {
  return change.kind === "EndEmployment" && change.details.lastDay ? change.details.lastDay : change.effectiveDate;
}

/** One line naming what a change does, in the words the chart, profile and People share. */
export function useDescribeChange() {
  const t = useTranslations("changes.coming");
  const format = useFormat();
  return (change: WorkforceChangeDto): string => {
    const d = change.details;
    if (change.kind === "EndEmployment") return t("leaves", { date: format.date(changeDay(change)) });
    if (change.kind === "Join") {
      if (d.managerTo) return d.isHire ? t("joins", { manager: d.managerTo.displayName }) : t("startsAgain", { manager: d.managerTo.displayName });
      return t("joinsUnit", { unit: d.unitTo ?? "" });
    }
    if (d.managerChanged && d.managerTo) return t("movesTo", { manager: d.managerTo.displayName });
    if (d.managerChanged && d.managerFrom) return t("noManager", { manager: d.managerFrom.displayName });
    if (d.titleChanged && d.titleTo) return t("becomes", { title: d.titleTo });
    if (d.unitChanged && d.unitTo) return t("movesUnit", { unit: d.unitTo });
    return t("relocates", { location: d.locationTo ?? "" });
  };
}

/** The short badge on People rows and chart cards: same words and colours everywhere. */
export function ChangeBadge({ change }: { change: WorkforceChangeDto }) {
  const t = useTranslations("changes.badge");
  const format = useFormat();
  const date = format.date(changeDay(change));
  if (change.kind === "Join") return <StatusBadge tone="info" dot>{t("joins", { date })}</StatusBadge>;
  if (change.kind === "EndEmployment") return <StatusBadge tone="danger" dot>{t("leaves", { date })}</StatusBadge>;
  return <StatusBadge tone="warning" dot>{change.details.managerChanged ? t("moves", { date }) : t("changes", { date })}</StatusBadge>;
}

function CalendarTile({ date }: { date: string }) {
  const format = useFormat();
  return (
    <div className="grid w-14 shrink-0 justify-items-center rounded-control bg-inlay py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-ink">{format.parts(date, { month: "short" })}</span>
      <span className="text-[22px] font-semibold leading-tight tabular-nums">{format.parts(date, { day: "numeric" })}</span>
    </div>
  );
}

/** The before → after chips of a change: only what it changes. */
function Diffs({ change }: { change: WorkforceChangeDto }) {
  const t = useTranslations("changes.coming");
  const d = change.details;
  const chips: ReactNode[] = [];
  const chip = (key: string, children: ReactNode, plain = false) => (
    <span key={key} className={cn("inline-flex h-7 items-center gap-1.5 rounded-control bg-inlay pe-2.5 text-[13px] text-muted-foreground", plain ? "ps-2.5" : "ps-1")}>
      {children}
    </span>
  );
  const arrow = <ArrowRight className="size-3.5" aria-hidden />;
  if (change.kind === "JobChange" && d.managerChanged) {
    chips.push(chip("manager", (
      <>
        {d.managerFrom ? <><Monogram name={d.managerFrom.displayName} size="sm" className="size-5 text-[9px]" />{d.managerFrom.displayName} {arrow}</> : null}
        {d.managerTo ? <><Monogram name={d.managerTo.displayName} size="sm" className="size-5 text-[9px]" /><b className="font-semibold text-foreground">{d.managerTo.displayName}</b></> : null}
      </>
    ), !d.managerFrom && !d.managerTo));
  }
  if (change.kind === "Join") {
    if (d.titleTo) chips.push(chip("title", d.titleTo, true));
    if (d.unitTo) chips.push(chip("unit", d.unitTo, true));
  } else {
    if (d.titleChanged) chips.push(chip("title", <>{d.titleFrom} {arrow} <b className="font-semibold text-foreground">{d.titleTo}</b></>, true));
    if (d.unitChanged) chips.push(chip("unit", <>{d.unitFrom} {arrow} <b className="font-semibold text-foreground">{d.unitTo}</b></>, true));
    if (d.locationChanged) chips.push(chip("location", <>{d.locationFrom ?? "—"} {arrow} <b className="font-semibold text-foreground">{d.locationTo ?? "—"}</b></>, true));
  }
  if (d.teamOutcome && d.teamCount > 0) {
    chips.push(chip("team", d.teamOutcome === "Along"
      ? t("teamAlong", { count: d.teamCount })
      : t("teamStays", { count: d.teamCount, manager: d.teamManager?.displayName ?? "" }), true));
  }
  if (d.reassigned?.length) chips.push(chip("reports", t("reportsMove", { count: d.reassigned.length }), true));
  return chips.length ? <div className="flex flex-wrap gap-2">{chips}</div> : null;
}

/**
 * A coming change: its date, what it does, before → after, and Edit / Cancel while it can still be taken back.
 * `compact` is the chart panel's version; the default sits in the profile hero and on My Team.
 */
export function ComingUpCard({
  change, canChange, onEdit, action, compact = false,
}: {
  change: WorkforceChangeDto;
  /** Whether the viewer may cancel or edit this change at all (the server decides the rest). */
  canChange: boolean;
  onEdit?: (change: WorkforceChangeDto) => void;
  /** Replaces Edit / Cancel (My Team's "View profile"). */
  action?: ReactNode;
  compact?: boolean;
}) {
  const t = useTranslations("changes.coming");
  const describe = useDescribeChange();
  const format = useFormat();
  const [cancelling, setCancelling] = useState(false);
  const actions = action ?? (canChange && change.canCancel ? (
    <div className="flex shrink-0 gap-2">
      {change.canEdit && onEdit ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(change)}>
          <Pencil className="size-3.5" /> {t("edit")}
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(true)}>{t("cancel")}</Button>
    </div>
  ) : null);
  return (
    <div className={cn(compact ? "grid gap-3" : "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-control bg-inlay px-4 py-3.5")}>
      <div className={cn(compact && "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5", !compact && "contents")}>
        <CalendarTile date={changeDay(change)} />
        <div className="min-w-0">
          <h4 className="type-label font-semibold">{describe(change)}</h4>
          {compact ? (
            <p className="mt-0.5 type-meta text-muted-foreground">
              {change.details.teamOutcome === "Along" && change.details.teamCount
                ? `${t("teamAlong", { count: change.details.teamCount })} · `
                : ""}
              {change.createdBy ? t("by", { name: change.createdBy, date: format.date(change.createdAt) }) : null}
            </p>
          ) : (
            <div className="mt-1.5"><Diffs change={change} /></div>
          )}
        </div>
      </div>
      {actions}
      {cancelling ? <CancelChangeDialog change={change} onClose={() => setCancelling(false)} /> : null}
    </div>
  );
}

/** Cancel names what stays, never "Are you sure?". */
export function CancelChangeDialog({ change, onClose }: { change: WorkforceChangeDto; onClose: () => void }) {
  const t = useTranslations("changes.cancel");
  const format = useFormat();
  const refusal = useRefusal();
  const cancel = useCancelChange();
  const d = change.details;
  const name = change.person.displayName;
  const date = format.date(changeDay(change));
  const title = change.kind === "EndEmployment" ? t("end", { name })
    : change.kind === "Join" ? t("join", { name, date })
    : d.managerChanged ? t("move", { name, date })
    : t("change", { name, date });
  const stays = change.kind === "EndEmployment" ? t("staysEmployed", { name: first(name) })
    : change.kind === "Join" ? (d.isHire ? t("notHired", { name }) : t("notStarting", { name: first(name) }))
    : d.managerChanged && d.managerFrom
      ? d.teamOutcome === "Stays" && d.teamCount
        ? t("teamStaysWith", { name: first(name), count: d.teamCount, manager: d.managerFrom.displayName })
        : t("staysWith", { name: first(name), manager: d.managerFrom.displayName })
      : t("staysAs", { name: first(name), title: d.titleFrom ?? "", unit: d.unitFrom ?? "" });
  const confirm = async () => {
    try {
      await cancel.mutateAsync(change.id);
      toast.success(t("done"));
      onClose();
    } catch (caught) {
      toast.error(refusal(caught, t("failed")));
    }
  };
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{stays}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={cancel.isLoading}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
