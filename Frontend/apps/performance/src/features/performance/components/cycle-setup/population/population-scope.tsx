"use client";

import {
  CalendarCheck,
  Network,
  Plus,
  Users2,
  UsersRound,
  X,
} from "@/lib/icons";
import type {
  OrgUnitSelectionInput,
  PopulationCandidateDto,
  PopulationMode,
} from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { OptionCards } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";

import { OrgScopePicker } from "./org-scope-picker";
import { initials } from "./population-model";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * Layer 1 — how the population is chosen. Two strong tiles carry the mode; choosing "Selected
 * organization units" reveals the inline tree-and-scope picker directly beneath them, and the
 * individual exceptions row stays available at the foot. Eligibility date is shown, never chosen
 * here — it follows the cycle's start date.
 */
export function PopulationScope({
  cycleId,
  mode,
  eligibilityDate,
  orgSelections,
  matchedCount,
  inclusions,
  tenantName,
  onSetMode,
  onApplyOrgSelections,
  onRemoveInclusion,
  onInspectInclusion,
  onOpenInclusionSheet,
}: {
  cycleId: string;
  mode: PopulationMode;
  eligibilityDate: string;
  orgSelections: OrgUnitSelectionInput[];
  matchedCount: number | null;
  inclusions: PopulationCandidateDto[];
  tenantName: string | null;
  onSetMode: (mode: PopulationMode) => void;
  onApplyOrgSelections: (selections: OrgUnitSelectionInput[]) => void;
  onRemoveInclusion: (employeeId: string) => void;
  onInspectInclusion: (candidate: PopulationCandidateDto) => void;
  onOpenInclusionSheet: () => void;
}) {
  const format = useFormat();
  const t = useTranslations("cycleSetup.PopulationScope");
  const tile = useTranslations("cycleSetup.ScopeTile");
  const byScope = mode === "ByScope";

  return (
    <section className="rounded-surface bg-card p-5 lg:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary-tint text-primary-ink type-meta-strong tabular-nums">
            1
          </span>
          <div>
            <h2 className="type-section-title text-foreground">
              {t("populationScope")}
            </h2>
            <p className="type-meta text-muted-foreground">
              {t("chooseHowToSelectParticipants")}
            </p>
          </div>
        </div>
        <span className="flex items-center gap-2 rounded-control border border-border bg-inlay px-3 py-1.5">
          <CalendarCheck
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
          <span className="type-meta text-muted-foreground">
            {t("eligibilityDate")}
          </span>
          <span className="type-label tabular-nums text-foreground">
            {format.date(eligibilityDate)}
          </span>
        </span>
      </div>

      <OptionCards
        columns={2}
        className="mt-5"
        label={t("populationScope")}
        value={byScope ? "ByScope" : "AllActive"}
        onChange={onSetMode}
        options={[
          {
            value: "AllActive",
            label: (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {t("allActiveEmployees")}
                <span className="rounded-control bg-primary-tint px-2 py-0.5 type-meta-strong text-primary-ink">{tile("recommended")}</span>
              </span>
            ),
            description: t("everyoneEligibleAcross", { value: tenantName ?? "the organization" }),
            icon: <UsersRound aria-hidden strokeWidth={1.75} />,
          },
          {
            value: "ByScope",
            label: t("selectedOrganizationUnits"),
            description: t("chooseSpecificUnitsAndOptionally"),
            icon: <Network aria-hidden strokeWidth={1.75} />,
          },
        ]}
      />

      {byScope ? (
        <OrgScopePicker
          cycleId={cycleId}
          asOf={eligibilityDate}
          selections={orgSelections}
          matchedCount={matchedCount}
          onChange={onApplyOrgSelections}
        />
      ) : null}

      {byScope || inclusions.length > 0 ? (
        <div className="mt-4 rounded-surface border border-border bg-inlay p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                <Users2 className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="type-label text-foreground">
                  {byScope ? t("populationExceptions") : t("savedScopeAdditions")}
                </p>
                <p className="type-meta text-muted-foreground">
                  {!byScope
                    ? t("theseAdditionsAreRetainedIf")
                    : inclusions.length > 0
                      ? (inclusions.length === 1 ? t("specificEmployeeAdded", { length: inclusions.length }) : t("specificEmployeesAdded", { length: inclusions.length }))
                      : t("addSpecificEmployeesOutsideThe")}
                </p>
              </div>
            </div>
            {byScope ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenInclusionSheet}
              >
                <Plus className="size-4" data-icon="inline-start" />
                {t("addSpecificEmployees")}
              </Button>
            ) : null}
          </div>

          {inclusions.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {inclusions.map((candidate) => (
                <li
                  key={candidate.employeeId}
                  className="flex items-center gap-2.5 rounded-surface bg-card px-3 py-2"
                >
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback hue={candidate.displayName} className="type-mark">
                      {initials(candidate.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <button
                    type="button"
                    onClick={() => onInspectInclusion(candidate)}
                    className="min-w-0 flex-1 text-start"
                  >
                    <p className="type-label truncate text-foreground">
                      {candidate.displayName}
                    </p>
                    <p className="type-meta truncate text-muted-foreground">
                      {[candidate.jobTitle ?? "—", candidate.orgUnitName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveInclusion(candidate.employeeId)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-control-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("remove", { displayName: candidate.displayName })}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
