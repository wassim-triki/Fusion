"use client";

import { CircleUserRound } from "@/lib/icons";
import type { PopulationCandidateDto } from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { cn } from "@repo/ds/lib/utils";
import { candidateStatus, initials, reviewerView } from "./population-model";
import { useTranslations } from "next-intl";

/** Name + role, with an avatar monogram — the identity column shared across the roster tables. */
export function EmployeeCell({ candidate }: { candidate: PopulationCandidateDto }) {
  const t = useTranslations("cycleSetup.EmployeeCell");
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-9 shrink-0">
        <AvatarFallback hue={candidate.displayName} className="type-meta">{initials(candidate.displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="type-label truncate text-foreground">{candidate.displayName}</p>
        <p className="type-meta truncate text-muted-foreground">{candidate.jobTitle ?? "—"}</p>
        {candidate.byExplicitInclusion ? (
          <p className="type-meta text-primary/90">{t("addedIndividually")}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Org unit (with its parent path element if we ever carry one) — quiet secondary column. */
export function OrgCell({ candidate }: { candidate: PopulationCandidateDto }) {
  const t = useTranslations("cycleSetup.OrgCell");
  if (!candidate.orgUnitName) {
    return <span className="type-body-secondary text-muted-foreground">{t("noUnit")}</span>;
  }
  return <span className="type-body-secondary text-foreground">{candidate.orgUnitName}</span>;
}

/** Reviewer identity, dimming/flagging an inactive manager and naming an unresolved one. */
export function ReviewerCell({ candidate }: { candidate: PopulationCandidateDto }) {
  const t = useTranslations("cycleSetup.ReviewerCell");
  const reviewer = reviewerView(candidate);
  if (reviewer.kind === "unresolved") {
    return (
      <span className="flex items-center gap-2 type-body-secondary text-muted-foreground">
        <CircleUserRound className="size-4 shrink-0 opacity-60" aria-hidden />
        {t("notResolved")}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6 shrink-0">
        <AvatarFallback hue={reviewer.name} className="type-mark">{initials(reviewer.name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span
          className={cn(
            "type-body-secondary block truncate",
            reviewer.kind === "inactive" ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {reviewer.name}
        </span>
        {reviewer.kind === "inactive" ? (
          <span className="type-meta text-amber-500">{t("inactive")}</span>
        ) : null}
      </span>
    </span>
  );
}

/** The roster status — a coloured dot + label with a one-line consequence beneath it. */
export function StatusCell({ candidate }: { candidate: PopulationCandidateDto }) {
  const t = useTranslations("cycleSetup.StatusCell");
  const status = candidateStatus(candidate);
  const config =
    status === "ready"
      ? { dot: "bg-emerald-500", label: t("ready"), caption: t("canParticipate"), label_class: "text-foreground" }
      : status === "attention"
        ? { dot: "bg-amber-500", label: t("needsAttention"), caption: t("resolveOrExclude"), label_class: "text-foreground" }
        : { dot: "bg-muted-foreground/60", label: t("excluded"), caption: t("wontParticipate"), label_class: "text-muted-foreground" };
  return (
    <div>
      <span className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", config.dot)} aria-hidden />
        <span className={cn("type-label", config.label_class)}>{config.label}</span>
      </span>
      <span className="type-meta ps-3.5 text-muted-foreground">{config.caption}</span>
    </div>
  );
}
