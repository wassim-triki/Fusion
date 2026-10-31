"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, ChevronRight, Clock, FileText, Flag, Users } from "@/lib/icons";
import { toast } from "sonner";
import type { CycleDetailDto } from "@repo/api";
import { Input } from "@repo/ds/components/ui/input";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { cn } from "@repo/ds/lib/utils";
import { Calendar } from "@repo/ds/components/ui/calendar";
import { Button } from "@repo/ds/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { Label } from "@repo/ds/components/ui/label";
import { AsyncButton } from "@repo/ds/shell";
import { useCreateCycle, useSettings, useUpdateCycle } from "@/features/performance/api/use-performance";
import { SetupStepFooter } from "./setup-step-footer";
import { CycleTimeline } from "./cycle-timeline";
import { useSetupShell } from "./setup-shell-context";
import { setupStepHref } from "./setup-readiness";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

const DESCRIPTION_MAX = 500;
const DAY = 86_400_000;

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromISODate(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

/** A new Cycle opens on a one-year horizon from today. */
function newCycleDefaults(): { startDate: string; endDate: string } {
  const start = new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return { startDate: toISODate(start), endDate: toISODate(end) };
}

/** Start date + the tenant's planning-deadline offset, clamped to the cycle end. */
function defaultDeadline(start: string, end: string, offsetDays: number): string {
  const d = fromISODate(start);
  if (!d) return "";
  d.setDate(d.getDate() + offsetDays);
  const iso = toISODate(d);
  return end && iso > end ? end : iso;
}

function Required() {
  return <span className="ms-0.5 text-destructive" aria-hidden>*</span>;
}

/**
 * Step 1 — the Cycle's own definition and nothing else. Continue creates the draft (or updates it
 * on return) and advances to Population; "Save and exit" persists and leaves the flow.
 */
export function CycleDetailsStep({ detail }: { detail: CycleDetailDto | null }) {
  const format = useFormat();
  const t = useTranslations("cycleSetup.CycleDetailsStep");
  const router = useRouter();
  const shell = useSetupShell();
  const draft = detail?.cycle.state === "Draft" ? detail.cycle : null;
  const createCycle = useCreateCycle();
  const updateCycle = useUpdateCycle(draft?.id ?? "");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [planningDeadline, setPlanningDeadline] = useState("");
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftVersion, setDraftVersion] = useState<number | null>(draft?.version ?? null);

  const offsetDays = useSettings().data?.planningDeadlineOffsetDays ?? 30;

  // Seed from the draft (or fresh defaults) once it resolves; keyed on the draft id so a freshly
  // created draft rehydrates the concrete, server-derived planning deadline on return.
  useEffect(() => {
    const defaults = draft ? null : newCycleDefaults();
    setName(draft?.name ?? "");
    setDescription(draft?.description ?? "");
    setStartDate(draft?.startDate ?? defaults?.startDate ?? "");
    setEndDate(draft?.endDate ?? defaults?.endDate ?? "");
    setPlanningDeadline(draft?.planningDeadline ?? "");
    setDeadlineTouched(Boolean(draft?.planningDeadline));
    setDraftVersion(draft?.version ?? null);
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // For a new cycle, keep the planning deadline defaulted to start + the tenant's offset until the
  // admin sets it themselves, so the field is never blank and reflects real tenant policy.
  useEffect(() => {
    if (draft || deadlineTouched) return;
    setPlanningDeadline(defaultDeadline(startDate, endDate, offsetDays));
  }, [draft, deadlineTouched, startDate, endDate, offsetDays]);

  const datesInvalid = Boolean(startDate && endDate && endDate <= startDate);
  const valid = name.trim().length > 0 && Boolean(startDate) && Boolean(endDate) && !datesInvalid;

  const persist = useCallback(async () => {
    if (draft) {
      await updateCycle.mutateAsync({
        name: name.trim(),
        startDate,
        endDate,
        planningDeadline,
        description: description.trim() || null,
        expectedVersion: draftVersion ?? draft.version,
      });
      return draft.id;
    } else {
      const created = await createCycle.mutateAsync({
        name: name.trim(),
        startDate,
        endDate,
        planningDeadline: planningDeadline || null,
        description: description.trim() || null,
      });
      return created.id;
    }
  }, [draft, draftVersion, updateCycle, createCycle, name, startDate, endDate, planningDeadline, description]);

  async function submit() {
    setSubmitting(true);
    try {
      const cycleId = await persist();
      router.push(setupStepHref("population", cycleId));
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotSaveTheCycle"));
      setSubmitting(false);
    }
  }

  // "Save and exit" (shared header): persist when there's something valid to keep, then leave.
  const saveAndExit = useCallback(async () => {
    try {
      if (valid) {
        await persist();
        toast.success(t("cycleSetupSaved"));
      }
    } catch (error) {
      reportPerformanceFailure(error, t("couldNotSaveTheCycle"));
      return;
    }
    router.push("/");
  }, [valid, persist, router, t]);

  useEffect(() => {
    shell.setExitHandler(saveAndExit);
    return () => shell.setExitHandler(null);
  }, [shell, saveAndExit]);

  const span = useMemo(() => {
    const s = startDate ? Date.parse(startDate) : NaN;
    const e = endDate ? Date.parse(endDate) : NaN;
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
    const months = Math.round((e - s) / DAY / 30.44);
    return months >= 1 ? { value: months, unit: months === 1 ? "month" : "months" } : { value: Math.round((e - s) / DAY / 7), unit: "weeks" };
  }, [startDate, endDate]);

  const planningWindow = useMemo(() => {
    const s = startDate ? Date.parse(startDate) : NaN;
    const d = planningDeadline ? Date.parse(planningDeadline) : NaN;
    if (Number.isNaN(s) || Number.isNaN(d) || d < s) return null;
    return Math.round((d - s) / DAY);
  }, [startDate, planningDeadline]);

  const deadlineDisabled = [
    ...(startDate ? [{ before: fromISODate(startDate)! }] : []),
    ...(endDate ? [{ after: fromISODate(endDate)! }] : []),
  ];

  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* main form card */}
        <section className="flex flex-col rounded-surface bg-card p-6 lg:p-8">
          <CardTitle icon={FileText} title={t("cycleDetails")} caption={t("giveYourPerformanceCycleA")} />

          <div className="mt-7 space-y-6">
            <Field
              htmlFor="cycle-name"
              label={<>{t("cycleName")} <Required /></>}
              hint={t("thisNameWillBeUsed")}
            >
              <Input
                id="cycle-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("performance2026")}
                className="h-11"
                autoFocus
              />
            </Field>
            <Field
              htmlFor="cycle-description"
              label={<>{t("description")} <span className="ms-1 font-normal text-muted-foreground">{t("optional")}</span></>}
              hint={t("addABriefDescriptionTo")}
              aside={
                <span className="type-meta tabular-nums text-muted-foreground">
                  {description.length}/{DESCRIPTION_MAX}
                </span>
              }
            >
              <Textarea
                id="cycle-description"
                value={description}
                maxLength={DESCRIPTION_MAX}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="resize-none"
                placeholder={t("whatThisCycleIsFor")}
              />
            </Field>
          </div>

          <div className="mt-8 border-t border-border/70 pt-7">
            <CardTitle icon={CalendarDays} title={t("timeline")} caption={t("setTheCycleDatesAnd")} />

            <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <Field
                htmlFor="cycle-dates"
                label={<>{t("cycleDates")} <Required /></>}
                hint={t("theStartAndEndDates")}
              >
                <Popover>
                  <DateTrigger id="cycle-dates" empty={!startDate}>
                    {startDate
                      ? `${format.date(startDate)} – ${endDate ? format.date(endDate) : "…"}`
                      : t("pickStartAndEndDates")}
                  </DateTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      autoFocus
                      fixedWeeks
                      showOutsideDays
                      numberOfMonths={2}
                      defaultMonth={fromISODate(startDate)}
                      selected={{ from: fromISODate(startDate), to: fromISODate(endDate) }}
                      onSelect={(range: { from?: Date; to?: Date } | undefined) => {
                        setStartDate(range?.from ? toISODate(range.from) : "");
                        setEndDate(range?.to ? toISODate(range.to) : "");
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </Field>
              <Field
                htmlFor="cycle-deadline"
                label={<>{t("planningDeadline")} <Required /></>}
                hint={t("theLastDayToComplete")}
              >
                <Popover open={deadlineOpen} onOpenChange={setDeadlineOpen}>
                  <DateTrigger id="cycle-deadline" empty={!planningDeadline}>
                    {planningDeadline ? format.date(planningDeadline) : t("pickADate")}
                  </DateTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      autoFocus
                      fixedWeeks
                      showOutsideDays
                      selected={fromISODate(planningDeadline)}
                      defaultMonth={fromISODate(planningDeadline) ?? fromISODate(startDate)}
                      disabled={deadlineDisabled.length > 0 ? deadlineDisabled : undefined}
                      onSelect={(date: Date | undefined) => {
                        if (!date) return;
                        setDeadlineTouched(true);
                        setPlanningDeadline(toISODate(date));
                        setDeadlineOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </Field>
            </div>

            {datesInvalid ? (
              <p className="mt-3 type-body text-destructive">{t("theEndDateMustBe")}</p>
            ) : null}
          </div>
        </section>

        {/* live summary aside */}
        <aside className="flex flex-col rounded-surface bg-card p-6 lg:p-7">
          <CardTitle icon={Clock} title={t("atAGlance")} caption={t("keyDetailsForThisPerformance")} compact />

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Metric value={span ? span.value : "—"} unit={span?.unit} icon={Clock} label={t("cycleLength")} />
            <Metric
              value={planningWindow ?? "—"}
              unit={planningWindow !== null ? "days to plan" : undefined}
              icon={CalendarDays}
              label={t("planningWindow")}
            />
          </div>

          <div className="mt-6 border-t border-border/70 pt-5">
            <h3 className="type-panel-title text-foreground">{t("timeline")}</h3>
            <div className="mt-2">
              <CycleTimeline
                startDate={startDate}
                endDate={endDate}
                marker={{ date: planningDeadline, label: t("planningDeadline") }}
              />
            </div>
          </div>

          <div className="mt-auto border-t border-border/70 pt-5">
            <p className="type-meta text-muted-foreground">{t("upNext")}</p>
            <ul className="mt-3 space-y-2.5">
              <UpNext icon={Users} step={2} label={t("population")} caption={t("chooseWhoTakesPart")} />
              <UpNext icon={Flag} step={3} label={t("reviewLaunch")} caption={t("confirmAndGoLive")} />
            </ul>
          </div>
        </aside>
      </div>

      <SetupStepFooter cancelHref="/">
        <AsyncButton pending={submitting} disabled={!valid} onClick={submit}>
          {t("next")}
          <ArrowRight className="size-4" data-icon="inline-end" />
        </AsyncButton>
      </SetupStepFooter>
    </div>
  );
}

function CardTitle({
  icon: Icon,
  title,
  caption,
  compact,
}: {
  icon: typeof Users;
  title: string;
  caption: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink ring-1 ring-inset ring-primary-ring",
          compact ? "size-11" : "size-12",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className={cn("text-foreground", compact ? "type-page-title" : "type-display")}>{title}</h2>
        <p className="type-body-secondary mt-0.5 text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  hint,
  aside,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  hint: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="mt-1 mb-2.5 flex items-baseline justify-between gap-3">
        <p className="type-meta text-muted-foreground">{hint}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

function DateTrigger({ id, empty, children }: { id: string; empty: boolean; children: ReactNode }) {
  return (
    <PopoverTrigger asChild>
      <Button
        id={id}
        type="button"
        variant="outline"
        data-empty={empty}
        className="h-11 w-full justify-start gap-3 text-start font-normal data-[empty=true]:text-muted-foreground"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 truncate tabular-nums">{children}</span>
      </Button>
    </PopoverTrigger>
  );
}

function Metric({
  value,
  unit,
  icon: Icon,
  label,
}: {
  value: ReactNode;
  unit?: string;
  icon: typeof Users;
  label: string;
}) {
  return (
    <div className="min-w-0 rounded-surface border border-border bg-inlay px-4 py-3.5">
      <p className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="type-display tabular-nums text-primary-ink">{value}</span>
        {unit ? <span className="type-body-secondary text-foreground/80">{unit}</span> : null}
      </p>
      <p className="type-meta mt-2 flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
    </div>
  );
}

function UpNext({
  icon: Icon,
  step,
  label,
  caption,
}: {
  icon: typeof Users;
  step: number;
  label: string;
  caption: string;
}) {
  return (
    <li className="flex items-center gap-3.5 rounded-surface border border-border bg-inlay px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label text-foreground">
          {step}. {label}
        </p>
        <p className="type-meta text-muted-foreground">{caption}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </li>
  );
}
