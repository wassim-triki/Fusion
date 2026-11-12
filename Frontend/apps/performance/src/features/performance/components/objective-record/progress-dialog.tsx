"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { EvidenceInput, MilestoneChangeInput, ObjectiveProgressDto, ObjectiveStatus, SubmitProgressRequest } from "@repo/api";
import { cn } from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";
import { Checkbox } from "@repo/ds/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton } from "@repo/ds/shell";
import { reportPerformanceFailure } from "../../api/performance-failure";
import { useObjectiveProgress, useProgressMutations } from "../../api/use-performance";
import { EvidenceUploader } from "../progress/evidence-uploader";
import { dayMonth } from "../year/year-words";
import { paceOn, positionIn } from "@repo/performance-ui";
import { valueIn } from "./goal-panel";
import type { ObjectiveRecord } from "./objective-record-model";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** How it's going, read from the pace (D-63): within ten points of it on track, within twenty-five at risk, else off track. */
export function statusFromPace(progress: number, pace: number): ObjectiveStatus {
  const behind = pace - progress;
  return behind <= 10 ? "OnTrack" : behind <= 25 ? "AtRisk" : "OffTrack";
}

/** The share of the way (0–100) a numeric value stands at, from baseline to target, whichever way it runs. */
export function shareOf(baseline: number, target: number, value: number): number {
  return target === baseline ? 0 : ((value - baseline) / (target - baseline)) * 100;
}

/**
 * Updating a goal's progress (D-63): a small dialog over the page. A number on a rail from baseline to target with
 * where it should be by now, How it's going prefilled from the pace (changeable), milestones ticked, a note; saving
 * shows a toast with undo, which records a correction back to where it was.
 */
export function ProgressDialog({ record, open, onOpenChange }: { record: ObjectiveRecord; open: boolean; onOpenChange: (open: boolean) => void }) {
  const progress = useObjectiveProgress(open ? record.ref.cycleId : null, open ? record.ref.objectiveId : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        {progress.data ? (
          <ProgressForm key={progress.data.version} record={record} progress={progress.data} onDone={() => onOpenChange(false)} />
        ) : (
          <DialogHeader>
            <DialogTitle>{record.title}</DialogTitle>
            <DialogDescription className="sr-only">{record.title}</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProgressForm({ record, progress, onDone }: { record: ObjectiveRecord; progress: ObjectiveProgressDto; onDone: () => void }) {
  const t = useTranslations("objective.ProgressDialog");
  const words = useTranslations("objective.GoalPanel");
  const locale = useLocale();
  const { submit, uploadEvidence } = useProgressMutations(record.ref.cycleId, record.ref.objectiveId);
  const [evidence, setEvidence] = useState<EvidenceInput[]>([]);
  const today = todayIso();
  const pace = paceOn(record.startDate, record.endDate, today);
  const numeric = progress.method === "NumericTarget" && progress.baseline != null && progress.target != null;
  const milestones = progress.method === "WeightedMilestones";

  const startValue = numeric ? progress.currentActual ?? progress.baseline! : progress.currentPercentage ?? 0;
  const [text, setText] = useState(String(+startValue.toFixed(2)));
  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(progress.milestones.map((m) => [m.id, m.isCompleted])));
  const [note, setNote] = useState("");
  const value = Number(text.replace(",", "."));
  const valid = milestones || (text.trim() !== "" && !Number.isNaN(value));
  const share = milestones
    ? progress.milestones.filter((m) => done[m.id]).reduce((n, m) => n + m.weight, 0)
    : numeric ? shareOf(progress.baseline!, progress.target!, value) : value;
  const suggested = statusFromPace(valid ? share : 0, pace);
  const [status, setStatus] = useState<ObjectiveStatus | null>(null);
  const chosen = status ?? suggested;

  const request = (): SubmitProgressRequest => ({
    expectedVersion: progress.version,
    status: chosen,
    contextNote: note.trim() || null,
    isCorrection: false,
    evidence: evidence.length > 0 ? evidence : null,
    ...(milestones
      ? { milestones: progress.milestones.filter((m) => done[m.id] !== m.isCompleted).map((m): MilestoneChangeInput => ({ milestoneId: m.id, completed: done[m.id]! })) }
      : numeric ? { numericActual: value } : { percentage: value }),
  });

  // Undo is a correction back to where the goal stood before this update.
  const undoFrom = (saved: ObjectiveProgressDto): SubmitProgressRequest => ({
    expectedVersion: saved.version,
    status: progress.currentStatus ?? chosen,
    contextNote: null,
    isCorrection: true,
    ...(milestones
      ? { milestones: progress.milestones.filter((m) => done[m.id] !== m.isCompleted).map((m) => ({ milestoneId: m.id, completed: m.isCompleted })) }
      : numeric ? { numericActual: progress.currentActual ?? progress.baseline! } : { percentage: progress.currentPercentage ?? 0 }),
  });

  const save = () => submit.mutateAsync(request())
    .then((saved) => {
      onDone();
      toast.success(t("saved"), {
        action: { label: t("undo"), onClick: () => void submit.mutateAsync(undoFrom(saved)).then(() => toast.success(t("undone"))).catch((error) => reportPerformanceFailure(error, t("couldntUndo"))) },
      });
    })
    .catch((error) => reportPerformanceFailure(error, t("couldntSave")));

  const railFill = Math.max(0, Math.min(100, share));
  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-section-title">{record.title}</DialogTitle>
        <DialogDescription>{record.source.node.measurementSummary}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-5">
        {milestones ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 type-label">{t("milestones")}</legend>
            {progress.milestones.map((m) => (
              <label key={m.id} className="flex items-center gap-3 rounded-inset bg-inlay px-3 py-2.5">
                <Checkbox checked={done[m.id]} onCheckedChange={(next) => { setDone((d) => ({ ...d, [m.id]: next === true })); setStatus(null); }} />
                <span className="flex-1 type-body">{m.title}</span>
                <span className="type-meta tabular-nums text-muted-foreground">
                  {m.weight}%{m.dueDate ? `, ${t("due", { day: dayMonth(m.dueDate, locale) })}` : ""}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="grid gap-3">
            <Label htmlFor="progress-value">{numeric ? t("whereItIsNow", { unit: progress.unit ?? "" }) : t("percentDone")}</Label>
            <Input id="progress-value" inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); setStatus(null); }} className="w-40 tabular-nums" aria-invalid={!valid} />
            <div className="grid gap-1.5">
              <div className="relative h-2.5 overflow-hidden rounded-full bg-inlay">
                <i className="absolute inset-y-0 start-0 block rounded-full bg-primary transition-[width]" style={{ width: `${railFill}%` }} />
              </div>
              <div className="relative h-0">
                <span aria-hidden className="absolute -top-[14px] h-[18px] w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${positionIn(record.startDate, record.endDate, today) * 100}%` }} />
              </div>
              <div className="flex justify-between type-meta tabular-nums text-muted-foreground">
                <span>{numeric ? valueIn(record.measurement, progress.baseline!) : "0%"}</span>
                <span>{t("shouldBeByNow", { value: numeric ? valueIn(record.measurement, progress.baseline! + ((progress.target! - progress.baseline!) * pace) / 100) : `${Math.round(pace)}%` })}</span>
                <span>{numeric ? valueIn(record.measurement, progress.target!) : "100%"}</span>
              </div>
            </div>
          </div>
        )}
        <div className="grid gap-2">
          <span className="type-label">{t("howItsGoing")}</span>
          <Segmented<ObjectiveStatus>
            fill
            label={t("howItsGoing")}
            value={chosen}
            onChange={setStatus}
            options={(["OnTrack", "AtRisk", "OffTrack"] as const).map((s) => ({ value: s, label: words(`status.${s}`) }))}
          />
          {status === null ? <span className="type-meta text-muted-foreground">{t("fromThePace")}</span> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="progress-note">{chosen === "OnTrack" ? t("whatHappened") : t("whatsInTheWay")}</Label>
          <Textarea id="progress-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={cn("resize-none")} />
        </div>
        <EvidenceUploader items={evidence} onChange={setEvidence} upload={(file) => uploadEvidence.mutateAsync(file)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{t("cancel")}</Button>
        <AsyncButton pending={submit.isLoading} disabled={!valid} onClick={() => void save()}>{t("save")}</AsyncButton>
      </DialogFooter>
    </>
  );
}
