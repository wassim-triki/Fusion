"use client";

import { useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  type CycleSettingsDto,
  type FusionSettingsSection,
  type MeasurementMethod,
  type OneOnOneCadence,
  type PlanAlignmentPolicy,
  type RatingScaleLevelDto,
} from "@repo/api";
import { useSettingsConflictSaver } from "@repo/api/query";
import { useStagedSettings, type StagedSettings } from "@repo/api/react";
import { cn, Input, NativeSelect, NativeSelectOption, Slider, Switch } from "@repo/ds";
import { OptionCards } from "@repo/ds/choice";
import {
  PageError,
  SettingsBlock,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsSaveBar,
  SettingsValue,
  useSettingsSectionName,
} from "@repo/ds/shell";
import { useRatingScale, useSettings } from "@/features/performance/api/use-performance";
import { useSaveCycleSettings, type CycleSettingsRequest } from "../api";
import { CYCLE_SETTINGS_SECTIONS } from "../performance-settings";
import { sayInEnglish, useSaveFailure, useSettingsSay, type Say } from "../say";

type Draft = CycleSettingsDto;
type Update = StagedSettings<Draft>["update"];

/** Joins a section's consequence sentences: two at most, then how many more. */
export function joinConsequences(sentences: string[], say: Say = sayInEnglish): string {
  if (sentences.length <= 2) return sentences.join(" ");
  return say("more", { sentences: sentences.slice(0, 2).join(" "), count: sentences.length - 2 });
}

/** What saving Reviews does. */
export function reviewsConsequence(saved: Draft, draft: Draft, say: Say = sayInEnglish): string {
  const said = (key: string, values?: Record<string, string | number>) => say(`reviews.consequence.${key}`, values);
  const days = (count: number) => say("dayCount", { count });
  const s: string[] = [];
  if (saved.defaultSelfAssessmentEnabled !== draft.defaultSelfAssessmentEnabled) s.push(said(draft.defaultSelfAssessmentEnabled ? "selfOn" : "selfOff"));
  if (saved.defaultObjectiveRatingsEnabled !== draft.defaultObjectiveRatingsEnabled)
    s.push(said(draft.defaultObjectiveRatingsEnabled ? "ratingsOn" : "ratingsOff"));
  if (saved.defaultCalibrationEnabled !== draft.defaultCalibrationEnabled)
    s.push(said(draft.defaultCalibrationEnabled ? "calibrationOn" : "calibrationOff"));
  const dueChanged =
    saved.selfAssessmentDueDays !== draft.selfAssessmentDueDays ||
    saved.peerInputDueDays !== draft.peerInputDueDays ||
    saved.managerAssessmentDueDays !== draft.managerAssessmentDueDays;
  if (saved.selfAssessmentDueDays !== draft.selfAssessmentDueDays) s.push(said("selfDue", { days: days(draft.selfAssessmentDueDays) }));
  if (saved.peerInputDueDays !== draft.peerInputDueDays) s.push(said("peerDue", { days: days(draft.peerInputDueDays) }));
  if (saved.managerAssessmentDueDays !== draft.managerAssessmentDueDays) s.push(said("managerDue", { days: days(draft.managerAssessmentDueDays) }));
  if (saved.acknowledgementReminderDays !== draft.acknowledgementReminderDays)
    s.push(said("ackReminder", { days: days(draft.acknowledgementReminderDays) }));
  if (saved.nineBoxBands.lowTop !== draft.nineBoxBands.lowTop || saved.nineBoxBands.midTop !== draft.nineBoxBands.midTop)
    s.push(said("bands"));
  const joined = joinConsequences(s, say);
  // New dates never move rounds already created; said once, while the bar has room for it.
  return dueChanged && s.length <= 2 ? said("keepDates", { sentences: joined }) : joined;
}

/** Each method's words are `planning.measurement.<method>`. */
const MEASUREMENT: readonly MeasurementMethod[] = ["NumericTarget", "ManualPercentage", "WeightedMilestones"];

const ALIGNMENT: readonly PlanAlignmentPolicy[] = ["EveryObjectiveConnected", "AtLeastOneConnected", "Optional"];

const CADENCE: readonly OneOnOneCadence[] = ["Weekly", "EveryTwoWeeks", "Monthly"];

/** What saving Planning does. */
export function planningConsequence(saved: Draft, draft: Draft, say: Say = sayInEnglish): string {
  const said = (key: string, values?: Record<string, string | number>) => say(`planning.consequence.${key}`, values);
  const s: string[] = [];
  if (saved.defaultMeasurementMethod !== draft.defaultMeasurementMethod) s.push(said(`measurement.${draft.defaultMeasurementMethod}`));
  if (saved.suggestedObjectiveCountMin !== draft.suggestedObjectiveCountMin || saved.suggestedObjectiveCountMax !== draft.suggestedObjectiveCountMax)
    s.push(said("count", { min: draft.suggestedObjectiveCountMin, max: draft.suggestedObjectiveCountMax }));
  if (saved.planningDeadlineOffsetDays !== draft.planningDeadlineOffsetDays)
    s.push(said("due", { days: say("dayCount", { count: draft.planningDeadlineOffsetDays }) }));
  if (saved.planAlignmentPolicy !== draft.planAlignmentPolicy) s.push(said(`alignment.${draft.planAlignmentPolicy}`));
  if (s.length) s.push(said("keep"));
  return joinConsequences(s, say);
}

export function conversationsConsequence(saved: Draft, draft: Draft, say: Say = sayInEnglish): string {
  if (saved.defaultOneOnOneCadence === draft.defaultOneOnOneCadence) return "";
  return say(`conversations.consequence.${draft.defaultOneOnOneCadence}`);
}

export function aiAndDataConsequence(saved: Draft, draft: Draft, say: Say = sayInEnglish): string {
  const s: string[] = [];
  if (saved.aiAssistanceEnabled !== draft.aiAssistanceEnabled)
    s.push(say(draft.aiAssistanceEnabled ? "aiAndData.consequence.on" : "aiAndData.consequence.off"));
  if (saved.evidenceRetentionMonths !== draft.evidenceRetentionMonths)
    s.push(say("aiAndData.consequence.retention", { count: draft.evidenceRetentionMonths }));
  return joinConsequences(s, say);
}

function toRequest(saved: Draft, draft: Draft): CycleSettingsRequest {
  const { nineBoxBands, ...rest } = draft;
  const bandsChanged = nineBoxBands.lowTop !== saved.nineBoxBands.lowTop || nineBoxBands.midTop !== saved.nineBoxBands.midTop;
  return {
    ...rest,
    expectedVersion: saved.version,
    ...(bandsChanged ? { nineBoxBands: { lowTop: nineBoxBands.lowTop, midTop: nineBoxBands.midTop } } : {}),
  };
}

/**
 * The frame every cycle-settings section shares: the saved values, staged edits, the save bar with the section's
 * consequence, and the conflict naming whoever saved one of the four sections first.
 */
function CycleSettingsSection({
  section,
  consequence,
  children,
}: {
  section: FusionSettingsSection;
  consequence: (saved: Draft, draft: Draft, say: Say) => string;
  children: (draft: Draft, update: Update, editable: boolean) => ReactNode;
}) {
  const say = useSettingsSay();
  const failure = useSaveFailure();
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const query = useSettings();
  const save = useSaveCycleSettings();
  const saved = query.data;
  const { mutateAsync } = save;
  const persist = useCallback((draft: Draft) => mutateAsync(toRequest(saved!, draft)), [mutateAsync, saved]);
  const staged = useStagedSettings(saved, persist, {
    ignore: ["version", "custom"],
    onReload: () => void query.refetch(),
    leaveMessage: say("cycle.leave", { section: title }),
  });
  const saver = useSettingsConflictSaver("performance", CYCLE_SETTINGS_SECTIONS, staged.conflict);

  if (query.error && !saved) {
    return (
      <SettingsPage title={title}>
        <PageError title={say("cycle.didNotLoad", { section: title })} onRetry={() => void query.refetch()} />
      </SettingsPage>
    );
  }

  const draft = staged.draft;
  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={!editable} loading={!draft}>
      {draft ? children(draft, staged.update, editable) : null}
      {editable && saved && draft ? (
        <SettingsSaveBar
          changes={staged.changes}
          consequence={consequence(saved, draft, say)}
          saving={staged.saving}
          error={failure(staged.error, say("cycle.notSaved", { section: title }))}
          conflict={saver}
          conflictPending={staged.conflict && !saver}
          onDiscard={staged.discard}
          onSave={() => void staged.submit()}
          onReload={staged.reload}
        />
      ) : null}
    </SettingsPage>
  );
}

function DaysField({
  id,
  label,
  value,
  unit,
  min,
  max,
  editable,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  editable: boolean;
  onChange: (value: number) => void;
}) {
  if (!editable) return <SettingsValue>{`${value} ${unit}`}</SettingsValue>;
  return (
    <>
      <Input
        id={id}
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="h-9 w-16 text-center font-semibold tabular-nums"
      />
      <span className="type-meta text-muted-foreground">{unit}</span>
    </>
  );
}

function Toggle({ id, checked, editable, onChange }: { id: string; checked: boolean; editable: boolean; onChange: (value: boolean) => void }) {
  const t = useTranslations("settings");
  return editable ? <Switch id={id} checked={checked} onCheckedChange={onChange} /> : <SettingsValue>{checked ? t("on") : t("off")}</SettingsValue>;
}

/** Choice cards for a setting with a few named options. */
function Choices<T extends string>({
  label,
  value,
  options,
  editable,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; detail?: string }[];
  editable: boolean;
  onChange: (value: T) => void;
}) {
  if (!editable) {
    const chosen = options.find((option) => option.value === value);
    return (
      <SettingsRows>
        <SettingsRow label={chosen?.label ?? value} description={chosen?.detail} />
      </SettingsRows>
    );
  }
  return (
    <OptionCards
      columns={1}
      label={label}
      value={value}
      onChange={onChange}
      options={options.map((option) => ({ value: option.value, label: option.label, description: option.detail }))}
    />
  );
}

/** Where calibration splits the scale: two cut points over its levels, each band holding at least one level. */
function NineBoxBands({
  levels,
  lowTop,
  midTop,
  editable,
  onChange,
}: {
  levels: RatingScaleLevelDto[];
  lowTop: number;
  midTop: number;
  editable: boolean;
  onChange: (lowTop: number, midTop: number) => void;
}) {
  const t = useTranslations("settings.reviews");
  const count = levels.length;
  const lowIndex = levels.findIndex((level) => level.value === lowTop) + 1;
  const midIndex = levels.findIndex((level) => level.value === midTop) + 1;
  const band = (index: number) => (index < lowIndex ? "low" : index < midIndex ? "middle" : "high");
  const range = (from: number, to: number) => {
    const a = levels[from]?.value;
    const b = levels[to]?.value;
    return a === b ? `${a}` : `${a}–${b}`;
  };
  return (
    <div className="flex flex-col gap-4 rounded-surface bg-card p-5">
      <p className="type-meta text-muted-foreground">{t("nineBoxDetail")}</p>
      <div className="relative">
        <ol className="grid overflow-hidden rounded-control border border-border" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {levels.map((level, index) => (
            <li
              key={level.value}
              className={cn(
                "flex min-w-0 flex-col gap-0.5 px-3 py-2.5",
                band(index) === "low" ? "bg-inlay" : band(index) === "middle" ? "bg-info-subtle" : "bg-primary-tint",
                index > 0 && "border-s border-border"
              )}
            >
              <span className="type-meta tabular-nums text-muted-foreground">{level.value}</span>
              <span className="truncate type-subsection-title text-foreground">{level.label}</span>
            </li>
          ))}
        </ol>
        {editable && count >= 3 ? (
          // The thumbs sit on the boundaries between levels: boundary k is after the k-th level.
          <Slider
            aria-label={t("cutPoints")}
            min={1}
            max={count - 1}
            step={1}
            minStepsBetweenThumbs={1}
            value={[lowIndex, midIndex]}
            onValueChange={([low, mid]) => onChange(levels[low! - 1]!.value, levels[mid! - 1]!.value)}
            className="absolute top-1/2 -translate-y-1/2"
            style={{ left: `${100 / count}%`, width: `${(100 * (count - 2)) / count}%` }}
          />
        ) : null}
      </div>
      <div className="grid grid-cols-3 type-body">
        <span className="flex flex-col">
          <span className="font-semibold text-foreground">{t("low")}</span>
          <span className="type-meta tabular-nums text-muted-foreground">{range(0, lowIndex - 1)}</span>
        </span>
        <span className="flex flex-col items-center">
          <span className="font-semibold text-foreground">{t("middle")}</span>
          <span className="type-meta tabular-nums text-muted-foreground">{range(lowIndex, midIndex - 1)}</span>
        </span>
        <span className="flex flex-col items-end">
          <span className="font-semibold text-foreground">{t("high")}</span>
          <span className="type-meta tabular-nums text-muted-foreground">{range(midIndex, count - 1)}</span>
        </span>
      </div>
    </div>
  );
}

/** Settings › Reviews: what a review includes, its due-date defaults and the nine-box bands. */
export function ReviewsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.reviews");
  const scale = useRatingScale();
  return (
    <CycleSettingsSection section={section} consequence={reviewsConsequence}>
      {(draft, update, editable) => (
        <>
          <SettingsBlock title={t("includes")}>
            <SettingsRows>
              <SettingsRow label={t("selfAssessment")} htmlFor={editable ? "include-self" : undefined}>
                <Toggle id="include-self" checked={draft.defaultSelfAssessmentEnabled} editable={editable}
                  onChange={(value) => update((d) => ({ ...d, defaultSelfAssessmentEnabled: value }))} />
              </SettingsRow>
              <SettingsRow label={t("ratings")} htmlFor={editable ? "include-ratings" : undefined}>
                <Toggle id="include-ratings" checked={draft.defaultObjectiveRatingsEnabled} editable={editable}
                  onChange={(value) => update((d) => ({ ...d, defaultObjectiveRatingsEnabled: value }))} />
              </SettingsRow>
              <SettingsRow label={t("calibration")} htmlFor={editable ? "include-calibration" : undefined}>
                <Toggle id="include-calibration" checked={draft.defaultCalibrationEnabled} editable={editable}
                  onChange={(value) => update((d) => ({ ...d, defaultCalibrationEnabled: value }))} />
              </SettingsRow>
            </SettingsRows>
          </SettingsBlock>

          <SettingsBlock title={t("dueDates")}>
            <SettingsRows>
              <SettingsRow label={t("selfAssessment")} htmlFor={editable ? "due-self" : undefined}>
                <DaysField id="due-self" label={t("selfDueLabel")} value={draft.selfAssessmentDueDays} unit={t("afterLaunch")}
                  min={1} max={60} editable={editable} onChange={(value) => update((d) => ({ ...d, selfAssessmentDueDays: value }))} />
              </SettingsRow>
              <SettingsRow label={t("peerInput")} htmlFor={editable ? "due-peer" : undefined}>
                <DaysField id="due-peer" label={t("peerDueLabel")} value={draft.peerInputDueDays} unit={t("afterLaunch")}
                  min={1} max={60} editable={editable} onChange={(value) => update((d) => ({ ...d, peerInputDueDays: value }))} />
              </SettingsRow>
              <SettingsRow label={t("managerAssessment")} htmlFor={editable ? "due-manager" : undefined}>
                <DaysField id="due-manager" label={t("managerDueLabel")} value={draft.managerAssessmentDueDays}
                  unit={t("afterSelf")} min={1} max={60} editable={editable}
                  onChange={(value) => update((d) => ({ ...d, managerAssessmentDueDays: value }))} />
              </SettingsRow>
              <SettingsRow label={t("acknowledgement")} htmlFor={editable ? "due-ack" : undefined}>
                <DaysField id="due-ack" label={t("ackLabel")} value={draft.acknowledgementReminderDays}
                  unit={t("afterRelease")} min={1} max={30} editable={editable}
                  onChange={(value) => update((d) => ({ ...d, acknowledgementReminderDays: value }))} />
              </SettingsRow>
            </SettingsRows>
          </SettingsBlock>

          <SettingsBlock title={t("nineBox")}>
            {scale.data ? (
              <NineBoxBands
                levels={scale.data.levels}
                lowTop={draft.nineBoxBands.lowTop}
                midTop={draft.nineBoxBands.midTop}
                editable={editable}
                onChange={(lowTop, midTop) => update((d) => ({ ...d, nineBoxBands: { ...d.nineBoxBands, lowTop, midTop } }))}
              />
            ) : (
              <SettingsRows>
                <SettingsRow label={t("bands")}>
                  <SettingsValue>{t("bandsValue", { low: draft.nineBoxBands.lowTop, middle: draft.nineBoxBands.midTop })}</SettingsValue>
                </SettingsRow>
              </SettingsRows>
            )}
          </SettingsBlock>
        </>
      )}
    </CycleSettingsSection>
  );
}

/** Settings › Planning: the defaults every new cycle copies. */
export function PlanningSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.planning");
  const measurement = MEASUREMENT.map((value) => ({
    value,
    label: t(`measurement.${value}.label`),
    detail: t(`measurement.${value}.detail`),
  }));
  return (
    <CycleSettingsSection section={section} consequence={planningConsequence}>
      {(draft, update, editable) => (
        <>
          <SettingsBlock title={t("measured")}>
            <Choices label={t("measured")} value={draft.defaultMeasurementMethod} options={measurement} editable={editable}
              onChange={(value) => update((d) => ({ ...d, defaultMeasurementMethod: value }))} />
          </SettingsBlock>
          <SettingsBlock title={t("plans")}>
            <SettingsRows>
              <SettingsRow label={t("objectivesPerPlan")}>
                {editable ? (
                  <>
                    <Input aria-label={t("fewest")} type="number" min={1} max={20} value={draft.suggestedObjectiveCountMin}
                      onChange={(event) => update((d) => ({ ...d, suggestedObjectiveCountMin: event.target.valueAsNumber }))}
                      className="h-9 w-16 text-center font-semibold tabular-nums" />
                    <span className="type-meta text-muted-foreground">{t("to")}</span>
                    <Input aria-label={t("most")} type="number" min={1} max={20} value={draft.suggestedObjectiveCountMax}
                      onChange={(event) => update((d) => ({ ...d, suggestedObjectiveCountMax: event.target.valueAsNumber }))}
                      className="h-9 w-16 text-center font-semibold tabular-nums" />
                  </>
                ) : (
                  <SettingsValue>{t("range", { min: draft.suggestedObjectiveCountMin, max: draft.suggestedObjectiveCountMax })}</SettingsValue>
                )}
              </SettingsRow>
              <SettingsRow label={t("plansDue")} htmlFor={editable ? "plans-due" : undefined}>
                <DaysField id="plans-due" label={t("plansDueLabel")} value={draft.planningDeadlineOffsetDays} unit={t("afterStart")}
                  min={1} max={365} editable={editable} onChange={(value) => update((d) => ({ ...d, planningDeadlineOffsetDays: value }))} />
              </SettingsRow>
            </SettingsRows>
          </SettingsBlock>
          <SettingsBlock title={t("alignment")}>
            <SettingsRows>
              <SettingsRow label={t("required")} htmlFor={editable ? "alignment" : undefined}>
                {editable ? (
                  <NativeSelect id="alignment" value={draft.planAlignmentPolicy} className="w-56"
                    onChange={(event) => update((d) => ({ ...d, planAlignmentPolicy: event.target.value as PlanAlignmentPolicy }))}>
                    {ALIGNMENT.map((option) => (
                      <NativeSelectOption key={option} value={option}>{t(`alignments.${option}`)}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <SettingsValue>{t(`alignments.${draft.planAlignmentPolicy}`)}</SettingsValue>
                )}
              </SettingsRow>
            </SettingsRows>
          </SettingsBlock>
        </>
      )}
    </CycleSettingsSection>
  );
}

/** Settings › Conversations: the rhythm new 1:1 series start with. */
export function ConversationsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.conversations");
  const cadence = CADENCE.map((value) => ({ value, label: t(`cadence.${value}`) }));
  return (
    <CycleSettingsSection section={section} consequence={conversationsConsequence}>
      {(draft, update, editable) => (
        <SettingsBlock title={t("rhythm")}>
          <Choices label={t("rhythm")} value={draft.defaultOneOnOneCadence} options={cadence} editable={editable}
            onChange={(value) => update((d) => ({ ...d, defaultOneOnOneCadence: value }))} />
        </SettingsBlock>
      )}
    </CycleSettingsSection>
  );
}

/** Settings › AI and data: one switch for Performance AI, and how long evidence is kept. */
export function AiAndDataSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.aiAndData");
  return (
    <CycleSettingsSection section={section} consequence={aiAndDataConsequence}>
      {(draft, update, editable) => (
        <>
          <SettingsBlock title={t("assistance")}>
            <SettingsRows>
              <SettingsRow label={t("suggestions")} description={t("suggestionsDetail")}
                htmlFor={editable ? "ai-assistance" : undefined}>
                <Toggle id="ai-assistance" checked={draft.aiAssistanceEnabled} editable={editable}
                  onChange={(value) => update((d) => ({ ...d, aiAssistanceEnabled: value }))} />
              </SettingsRow>
            </SettingsRows>
          </SettingsBlock>
          <SettingsBlock title={t("evidence")}>
            <SettingsRows>
              <SettingsRow label={t("keepFiles")} htmlFor={editable ? "evidence-retention" : undefined}>
                <DaysField id="evidence-retention" label={t("keepLabel")} value={draft.evidenceRetentionMonths}
                  unit={t("months")} min={1} max={120} editable={editable} onChange={(value) => update((d) => ({ ...d, evidenceRetentionMonths: value }))} />
              </SettingsRow>
            </SettingsRows>
          </SettingsBlock>
        </>
      )}
    </CycleSettingsSection>
  );
}
