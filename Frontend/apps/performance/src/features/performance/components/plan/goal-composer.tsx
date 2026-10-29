"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Target, UserRound } from "@/lib/icons";
import type {
  AddPlanObjectiveRequest,
  AlignmentTargetDto,
  CycleSummaryDto,
  ImprovementDirection,
  MeasurementInput,
  PlanObjectiveDto,
} from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { OptionCards } from "@repo/ds/choice";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { Textarea } from "@repo/ds/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@repo/ds/components/ui/select";
import {
  DateRangePicker,
  type DateRangeValue,
} from "@repo/ds/components/ui/date-range-picker";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { parseNumeric } from "../../lib";
import { pct } from "./plan-lib";
import {
  milestoneDatesWithin,
  milestoneWeightSum,
  milestonesFromMeasurement,
  toMilestoneInputs,
  type MilestoneRow,
} from "../measurement/milestone-editor";
import {
  MeasurementEditor,
  type MeasurementMethod,
} from "../measurement/measurement-editor";
import { ObjectiveComposerSection } from "../objective-composer-section";
import {
  AiSuggestedTag,
  CoachField,
  CoachNothing,
  CoachSuggestion,
  CoachTrigger,
} from "../coach/coach";
import {
  draftMeasurement,
  measurePreview,
  milestoneRows,
} from "../coach/coach-model";
import { useAutoCoach, useObjectiveCoach } from "../coach/use-objective-coach";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 2000;

type AlignMode = "aligned" | "standalone";

/**
 * The Employee Objective Composer — a large contextual modal opened by "Add objective" from My Plan,
 * leaving the plan visible behind it. One composer, five settled sections in order (Alignment →
 * Definition → Measurement → Plan weight → Dates), the same shell reused for edit. Measurement is a
 * placeholder shell in this pass (the dedicated measurement design slots into section 3 later); a new
 * objective is created as a manual-percentage measure, while editing preserves the objective's existing
 * measurement untouched.
 */
export function PlanGoalComposer({
  open,
  onOpenChange,
  cycle,
  targets,
  standaloneAllowed,
  teamName,
  objective,
  otherWeightTotal,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycle: CycleSummaryDto;
  targets: AlignmentTargetDto[];
  standaloneAllowed: boolean;
  /** The author's own team; a new aligned objective starts on that team's objective. */
  teamName?: string | null;
  objective?: PlanObjectiveDto;
  /** Combined weight of the plan's other objectives — the allocation before this objective is committed. */
  otherWeightTotal: number;
  onCreate: (
    request: Omit<AddPlanObjectiveRequest, "expectedVersion">
  ) => Promise<void>;
  onUpdate: (
    request: Omit<AddPlanObjectiveRequest, "expectedVersion">
  ) => Promise<void>;
}) {
  const tr = useTranslations("plan.PlanGoalComposer");
  const isEdit = Boolean(objective);

  const [mode, setMode] = useState<AlignMode>("aligned");
  const [parentId, setParentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [method, setMethod] = useState<MeasurementMethod | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[]>(() =>
    milestonesFromMeasurement(objective?.measurement)
  );
  const [baseline, setBaseline] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [direction, setDirection] = useState<ImprovementDirection>("Increase");
  // An explicit window override. Null means "not set" — the objective follows its inherited window
  // (the aligned parent's, or the cycle's) until the author picks a range.
  const [dateOverride, setDateOverride] = useState<DateRangeValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Fields filled from an AI suggestion keep a label until the author edits them (D-26).
  const [aiFilled, setAiFilled] = useState({
    title: false,
    measure: false,
    parent: false,
  });
  const coach = useObjectiveCoach({ open, cycleId: cycle.id, surface: "Plan" });

  useEffect(() => {
    if (!open) return;
    const m = objective?.measurement;
    setMode(objective && !objective.isAligned ? "standalone" : "aligned");
    setParentId(
      objective
        ? (objective.parentObjectiveId ?? "")
        : (targets.find(
            (t) =>
              t.ownershipScope !== "Company" &&
              teamName != null &&
              t.orgUnitName === teamName
          )?.id ?? "")
    );
    setTitle(objective?.title ?? "");
    setDescription(objective?.description ?? "");
    setWeight(
      objective?.planWeight != null ? String(objective.planWeight) : ""
    );
    const numeric = m?.method === "NumericTarget" ? m : null;
    setMethod(m?.method ?? null);
    setMilestones(milestonesFromMeasurement(m));
    setBaseline(numeric ? String(numeric.baseline) : "");
    setTarget(numeric ? String(numeric.target) : "");
    setUnit(numeric?.unit ?? "");
    setDirection(numeric?.direction ?? "Increase");
    // Editing starts from the objective's own dates; a new objective starts from the inherited window.
    setDateOverride(
      objective?.startDate
        ? { from: objective.startDate, to: objective.endDate ?? undefined }
        : null
    );
    setAiFilled({ title: false, measure: false, parent: false });
    // Seed only when the composer opens; later target refetches must not overwrite the author's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, objective]);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.id === parentId) ?? null,
    [targets, parentId]
  );

  // Order the alignment options broad → specific: company strategy first, then organizational
  // objectives grouped by their owning unit, alphabetical within each — so the closest direction
  // is easy to scan rather than an undifferentiated list.
  const targetGroups = useMemo(() => {
    const company = targets
      .filter((t) => t.ownershipScope === "Company")
      .sort((a, b) => a.title.localeCompare(b.title));
    const organizational = targets
      .filter((t) => t.ownershipScope !== "Company")
      .sort(
        (a, b) =>
          (a.orgUnitName ?? "").localeCompare(b.orgUnitName ?? "") ||
          a.title.localeCompare(b.title)
      );
    return { company, organizational };
  }, [targets]);

  // The inherited window — the aligned parent's when aligned, otherwise the cycle's. It's the default
  // the objective takes until the author picks their own range, and the bounds every range stays within.
  const inheritedStart =
    (mode === "aligned" && selectedTarget?.startDate) || cycle.startDate;
  const inheritedEnd =
    (mode === "aligned" && selectedTarget?.endDate) || cycle.endDate;
  // The window shown and committed: the author's override when set, else the inherited window.
  const dateStart = dateOverride?.from ?? inheritedStart;
  const dateEnd = dateOverride?.to ?? inheritedEnd;

  const weightNum = Math.round(Number(weight) || 0);
  const alignValid = mode === "standalone" || parentId !== "";
  // A weighted-milestone measure is only complete once every named row carries a weight and the
  // weights total 100% — the same contract the domain enforces for milestone objectives.
  const milestoneSum = milestoneWeightSum(milestones);
  const milestonesComplete =
    milestones.every(
      (row) =>
        row.title.trim() !== "" &&
        Number(row.weight) > 0 &&
        Number(row.weight) <= 100
    ) && milestoneSum === 100;
  // Dated milestones must sit inside the objective's window — it moves with alignment and range.
  const milestoneDatesValid =
    method !== "WeightedMilestones" ||
    milestoneDatesWithin(milestones, dateStart, dateEnd);

  // A numeric measure needs a well-formed baseline and target that differ, plus a unit.
  const base = parseNumeric(baseline);
  const tgt = parseNumeric(target);
  const numericInvalid = base.invalid || tgt.invalid;
  const numericSameValue =
    base.num !== null && tgt.num !== null && base.num === tgt.num;
  const numericComplete =
    base.num !== null &&
    tgt.num !== null &&
    !numericInvalid &&
    !numericSameValue &&
    unit.trim() !== "";

  const measurementValid =
    method === "ManualPercentage"
      ? true
      : method === "WeightedMilestones"
        ? milestonesComplete
        : method === "NumericTarget"
          ? numericComplete
          : false;
  const valid =
    title.trim() !== "" &&
    alignValid &&
    weightNum > 0 &&
    weightNum <= 100 &&
    measurementValid &&
    milestoneDatesValid;

  const disabledReason = !valid
    ? title.trim() === ""
      ? tr("addATitleFirst")
      : !alignValid
        ? tr("chooseTheObjectiveThisAligns")
        : !measurementValid
          ? method === null
            ? tr("chooseHowProgressIsMeasured")
            : method === "WeightedMilestones"
              ? tr("giveEachMilestoneAWeight")
              : tr("setABaselineTargetAnd")
          : !milestoneDatesValid
            ? tr("moveMilestoneDueDatesInside")
            : weightNum <= 0
              ? tr("giveThisObjectiveAPlan")
              : tr("planWeightCanBeAt")
    : undefined;

  // Allocation context — the plan before this objective (edit mode already excludes its own weight).
  const existing = clamp(otherWeightTotal, 0, 100);
  const remaining = Math.max(0, 100 - existing);
  const total = existing + weightNum;
  const totalTone =
    total === 100
      ? "text-success"
      : total > 100
        ? "text-destructive"
        : "text-muted-foreground";

  // The measurement sent with the objective, authored from the section's controls.
  function buildMeasurement(): MeasurementInput {
    if (method === "WeightedMilestones")
      return {
        method: "WeightedMilestones",
        milestones: toMilestoneInputs(milestones),
      };
    if (method === "NumericTarget")
      return {
        method: "NumericTarget",
        baseline: base.num ?? 0,
        target: tgt.num ?? 0,
        unit: unit.trim(),
        direction,
      };
    return { method: "ManualPercentage" };
  }

  // The draft as it stands, complete or not: what the coach reads.
  const coachDraft = () => ({
    title: title.trim(),
    description: description.trim() || null,
    measurement: draftMeasurement({
      method,
      baseline,
      target,
      unit,
      direction,
      milestones,
    }),
    parentObjectiveId: mode === "aligned" && parentId ? parentId : null,
  });
  useAutoCoach({ coach, ready: method !== null, title, draft: coachDraft });
  const suggestions =
    coach.state.kind === "ready" ? coach.state.suggestions : null;
  const suggestedParent = suggestions?.parentObjectiveId
    ? (targets.find((t) => t.id === suggestions.parentObjectiveId) ?? null)
    : null;

  function applyTitle(text: string) {
    setTitle(text);
    setAiFilled((current) => ({ ...current, title: true }));
    coach.settle("title");
  }

  function applyMeasure() {
    const measure = suggestions?.measure;
    if (!measure) return;
    setMethod(measure.method);
    if (measure.method === "NumericTarget") {
      // The baseline is the author's fact: it is filled only when the draft stated one.
      if (measure.baseline !== null) setBaseline(String(measure.baseline));
      setTarget(measure.target !== null ? String(measure.target) : "");
      setUnit(measure.unit ?? "");
      setDirection(measure.direction ?? "Increase");
    }
    if (measure.method === "WeightedMilestones")
      setMilestones(milestoneRows(measure));
    setAiFilled((current) => ({ ...current, measure: true }));
    coach.settle("measure");
  }

  /** A measurement edit by the author: the field is theirs now, so the AI label goes. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setAiFilled((current) =>
        current.measure ? { ...current, measure: false } : current
      );
    };
  }

  function applyParent(id: string) {
    setMode("aligned");
    setParentId(id);
    setAiFilled((current) => ({ ...current, parent: true }));
    coach.settle("parent");
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const measurement = buildMeasurement();
      const request: Omit<AddPlanObjectiveRequest, "expectedVersion"> = {
        title: title.trim(),
        description: description.trim() || null,
        parentObjectiveId: mode === "aligned" ? parentId : null,
        startDate: dateStart,
        endDate: dateEnd,
        measurement,
        planWeight: weightNum,
      };
      if (isEdit) await onUpdate(request);
      else await onCreate(request);
      onOpenChange(false);
    } catch (error) {
      reportPerformanceFailure(error, tr("couldNotSaveTheObjective"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* Header — identity + a compact snapshot of the plan's current allocation. */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5 pe-14">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle>
                {isEdit ? tr("editObjective") : tr("addObjective")}
              </DialogTitle>
              {/* The objective's window — a real range picker beside the title. It defaults to the
                  inherited window (aligned parent's, or the cycle's) and stays bounded to the cycle. */}
              <DateRangePicker
                id="pg-dates"
                value={
                  dateOverride ?? { from: inheritedStart, to: inheritedEnd }
                }
                onChange={setDateOverride}
                min={cycle.startDate}
                max={cycle.endDate}
                className="h-8 px-2.5 type-body shadow-2xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-surface border border-border px-3.5 py-2">
            <div className="flex items-baseline gap-1.5">
              <span className="type-section-title tabular-nums leading-none text-primary-ink">
                {pct(existing)}%
              </span>
              <span className="type-meta text-muted-foreground">
                {tr("allocated")}
              </span>
            </div>
            <div
              className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={tr("percentOfPlanWeightAllocated", { existing: pct(existing) })}
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${existing}%` }}
              />
            </div>
            <span className="whitespace-nowrap type-meta tabular-nums text-muted-foreground">
              {tr("left", { remaining: pct(remaining) })}
            </span>
          </div>
        </div>

        {/* Body — scrolls; header and footer stay put. */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-8">
            {/* 1. Alignment */}
            <ObjectiveComposerSection
              n={1}
              title={tr("alignment")}
              hint={tr("chooseHowThisObjectiveConnects")}
            >
              <OptionCards
                columns={2}
                label={tr("alignment")}
                value={mode}
                onChange={setMode}
                options={[
                  { value: "aligned", label: tr("alignedToDirection"), description: tr("alignThisObjectiveToAn"), icon: <Target aria-hidden /> },
                  {
                    value: "standalone",
                    label: tr("standaloneRoleObjective"),
                    description: standaloneAllowed ? tr("createAnObjectiveFocusedOn") : tr("notPermittedThisCycleEvery"),
                    icon: <UserRound aria-hidden />,
                    disabled: !standaloneAllowed,
                  },
                ]}
              />

              {mode === "aligned" ? (
                targets.length === 0 ? (
                  <p className="rounded-surface border border-dashed border-border px-3 py-4 type-body text-muted-foreground">
                    {tr("noPublishedOrganizationalObjectivesTo")}
                  </p>
                ) : (
                  <CoachField
                    label="parent"
                    suggestion={
                      coach.enabled && suggestedParent ? (
                        <TargetSummary target={suggestedParent} />
                      ) : null
                    }
                    onApply={() =>
                      suggestedParent && applyParent(suggestedParent.id)
                    }
                    onDismiss={() => coach.settle("parent")}
                  >
                    <Select
                      value={parentId}
                      onValueChange={(value) => {
                        setParentId(value);
                        setAiFilled((current) => ({
                          ...current,
                          parent: false,
                        }));
                      }}
                    >
                      <SelectTrigger
                        aria-label={tr("selectOrganizationalObjective")}
                        className="h-auto w-full items-center whitespace-normal py-2.5 text-start data-[size=default]:h-auto [&>svg]:self-center"
                      >
                        {selectedTarget ? (
                          <TargetSummary target={selectedTarget} />
                        ) : (
                          <span className="text-muted-foreground">
                            {tr("chooseAnOrganizationalObjective")}
                          </span>
                        )}
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        align="start"
                        className="max-h-72 w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-3rem)]"
                      >
                        {targetGroups.company.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>{tr("companyStrategy")}</SelectLabel>
                            {targetGroups.company.map((t) => (
                              <TargetOption key={t.id} target={t} />
                            ))}
                          </SelectGroup>
                        ) : null}
                        {targetGroups.organizational.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>{tr("organizational")}</SelectLabel>
                            {targetGroups.organizational.map((t) => (
                              <TargetOption key={t.id} target={t} />
                            ))}
                          </SelectGroup>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </CoachField>
                )
              ) : coach.enabled && suggestedParent ? (
                <CoachField
                  label="parent"
                  suggestion={<TargetSummary target={suggestedParent} />}
                  onApply={() => applyParent(suggestedParent.id)}
                  onDismiss={() => coach.settle("parent")}
                />
              ) : null}
              {aiFilled.parent ? (
                <p className="type-meta">
                  <AiSuggestedTag />
                </p>
              ) : null}
            </ObjectiveComposerSection>

            {/* 2. Objective definition */}
            <ObjectiveComposerSection
              n={2}
              title={tr("objectiveDefinition")}
              action={
                coach.enabled ? (
                  <CoachTrigger
                    state={coach.state}
                    onRun={() => void coach.run(coachDraft())}
                  />
                ) : undefined
              }
            >
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="pg-title">
                    {tr("title")} <span className="text-destructive">*</span>
                    {aiFilled.title ? <AiSuggestedTag /> : null}
                  </Label>
                  <span className="type-meta tabular-nums text-muted-foreground">
                    {title.length}/{TITLE_MAX}
                  </span>
                </div>
                <CoachField
                  label="title"
                  suggestion={
                    coach.enabled && suggestions?.title
                      ? suggestions.title
                      : null
                  }
                  onApply={() =>
                    suggestions?.title && applyTitle(suggestions.title)
                  }
                  onDismiss={() => coach.settle("title")}
                >
                  <Input
                    id="pg-title"
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setAiFilled((current) => ({ ...current, title: false }));
                    }}
                    placeholder={tr("enterAClearAndSpecific")}
                    autoFocus
                  />
                </CoachField>
                {coach.enabled && coach.state.kind === "nothing" ? (
                  <CoachNothing />
                ) : null}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor="pg-desc">
                    {tr("description")}
                    <span className="font-normal text-muted-foreground">
                      {tr("optional")}
                    </span>
                  </Label>
                  <span className="type-meta tabular-nums text-muted-foreground">
                    {description.length}/{DESCRIPTION_MAX}
                  </span>
                </div>
                <Textarea
                  id="pg-desc"
                  value={description}
                  maxLength={DESCRIPTION_MAX}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder={tr("describeWhatSuccessLooksLike")}
                />
              </div>
            </ObjectiveComposerSection>

            {/* 3. Measurement — the method choice. Manual percentage is built; the numeric and
                milestone editors slot in here in their own pass and stay unavailable until then. */}
            <ObjectiveComposerSection
              n={3}
              title={tr("measurement")}
              hint={tr("howWillYouMeasureProgress")}
              action={aiFilled.measure ? <AiSuggestedTag /> : undefined}
            >
              {coach.enabled && suggestions?.measure ? (
                <CoachSuggestion
                  label="measure"
                  onApply={applyMeasure}
                  onDismiss={() => coach.settle("measure")}
                >
                  {measurePreview(suggestions.measure)}
                </CoachSuggestion>
              ) : null}
              <MeasurementEditor
                method={method}
                onMethodChange={edited(setMethod)}
                baseline={baseline}
                target={target}
                unit={unit}
                direction={direction}
                numericInvalid={numericInvalid}
                numericSameValue={numericSameValue}
                onBaseline={edited(setBaseline)}
                onTarget={edited(setTarget)}
                onUnit={edited(setUnit)}
                onDirection={edited(setDirection)}
                milestones={milestones}
                milestoneWeightSum={milestoneSum}
                onMilestonesChange={edited(setMilestones)}
                minDate={dateStart}
                maxDate={dateEnd}
              />
            </ObjectiveComposerSection>

            {/* 4. Plan weight */}
            <ObjectiveComposerSection
              n={4}
              title={tr("planWeight")}
              hint={tr("assignTheWeightOfThis")}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setWeight(String(clamp(weightNum - 5, 0, 100)))
                    }
                    disabled={weightNum <= 0}
                    aria-label={tr("decreaseWeightBy5")}
                  >
                    <Minus className="size-4" />
                  </Button>
                  <div className="relative w-24">
                    <Input
                      id="pg-weight"
                      type="number"
                      inputMode="numeric"
                      value={weight}
                      min={0}
                      max={100}
                      onChange={(e) => setWeight(e.target.value)}
                      className="pe-7 text-end tabular-nums"
                      placeholder="0"
                      aria-label={tr("planWeightPercent")}
                    />
                    <span className="pointer-events-none absolute inset-e-3 top-1/2 -translate-y-1/2 type-body text-muted-foreground">
                      %
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setWeight(String(clamp(weightNum + 5, 0, 100)))
                    }
                    disabled={weightNum >= 100}
                    aria-label={tr("increaseWeightBy5")}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full",
                        total === 100 ? "bg-success/60" : "bg-primary/60"
                      )}
                      style={{ width: `${existing}%` }}
                    />
                    <span
                      className={cn(
                        "block h-full",
                        total > 100
                          ? "bg-destructive"
                          : total === 100
                            ? "bg-success"
                            : "bg-primary"
                      )}
                      style={{ width: `${clamp(weightNum, 0, remaining)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 type-meta">
                    <span className="text-muted-foreground">
                      <span className="font-medium tabular-nums text-foreground">
                        {pct(existing)}%
                      </span>{tr("inYourOtherObjectives")}
                    </span>
                    <span className={cn("font-medium", totalTone)}>
                      {tr("planTotal")}
                      <span className="tabular-nums">{pct(total)}%</span>
                    </span>
                  </div>
                </div>
              </div>
              {/* <p className="text-xs text-muted-foreground">
                The total weight of all objectives in your plan must equal 100%.
              </p> */}
            </ObjectiveComposerSection>
          </div>
        </div>

        {/* Footer — stable. Cancel is quiet; the primary action commits the pending objective. */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tr("cancel")}
          </Button>
          <AsyncButton
            pending={submitting}
            disabled={!valid}
            onClick={handleSubmit}
            title={disabledReason}
          >
            {isEdit ? (
              tr("saveChanges")
            ) : (
              <>
                {tr("addObjective")} <Plus className="size-4" data-icon="inline-end" />
              </>
            )}
          </AsyncButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Alignment choice tile ───────────────────────────────────────────────────────────

// ── Selected organizational objective (rich trigger content) ─────────────────────────

function TargetSummary({ target }: { target: AlignmentTargetDto }) {
  const t = useTranslations("plan.TargetSummary");
  const words = useSay("common.words");
  const scope =
    target.ownershipScope === "Company"
      ? t("companyStrategy")
      : (target.orgUnitName ?? words("organizational"));
  const lineage = lineageLabel(target);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="type-meta text-muted-foreground">{scope}</span>
      <span className="font-semibold text-foreground">{target.title}</span>
      {lineage ? (
        <span className="type-meta text-muted-foreground">{lineage}</span>
      ) : null}
    </span>
  );
}

/** One objective option in the selector — title with its owning unit (or upstream lineage) beneath. */
function TargetOption({ target }: { target: AlignmentTargetDto }) {
  const context =
    target.ownershipScope === "Company"
      ? lineageLabel(target)
      : (target.orgUnitName ?? lineageLabel(target));
  return (
    <SelectItem value={target.id} className="py-2">
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{target.title}</span>
        {context ? (
          <span className="type-meta text-muted-foreground">{context}</span>
        ) : null}
      </span>
    </SelectItem>
  );
}

/** The upstream direction above a target — its objective ancestry, top-down, excluding the target itself. */
function lineageLabel(target: AlignmentTargetDto): string {
  return target.directionPath.slice(0, -1).join(" › ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
