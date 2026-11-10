"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Check, FileText, Rocket, ShieldCheck, TriangleAlert, Users2 } from "@repo/ds/icons";
import type { CycleDetailDto } from "@repo/api";
import { AsyncButton } from "@repo/ds/shell";
import { Button } from "@repo/ds/components/ui/button";
import { cn } from "@repo/ds/lib/utils";
import { setupStepHref } from "../setup-readiness";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

type Tone = "done" | "blocked";

function Stat({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: Tone;
  value: ReactNode;
  label: string;
}) {
  const done = tone === "done";
  return (
    <div className="flex min-w-0 items-center gap-3.5 py-1 lg:px-5 lg:first:ps-0 lg:last:pe-0 xl:px-6">
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-full border",
          done ? "border-emerald-400/45 text-emerald-400" : "border-amber-400/50 text-amber-400"
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full text-[#0b0c10]",
          done ? "bg-emerald-400" : "bg-amber-400"
        )}
        aria-hidden
      >
        {done ? (
          <Check className="size-3" strokeWidth={3.5} />
        ) : (
          <span className="type-mark leading-none">!</span>
        )}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block type-subsection-title text-white">{value}</span>
        <span className="mt-0.5 block type-meta text-zinc-400">{label}</span>
      </span>
    </div>
  );
}

/**
 * The decision banner — dark in both themes, like the setup hero. When the Cycle has cleared every
 * check it presents launch as the one dominant, irreversible action; when something still blocks
 * it, it states the blockers plainly and withholds the action rather than offering a button that
 * would fail.
 */
export function LaunchHero({
  detail,
  onLaunch,
  launching,
}: {
  detail: CycleDetailDto;
  onLaunch: () => void;
  launching: boolean;
}) {
  const format = useFormat();
  const t = useTranslations("cycleSetup.LaunchHero");
  const ready = detail.launchReadiness.canActivate;
  const blockers = detail.launchReadiness.blockers;
  const participants = detail.confirmedParticipantCount;

  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-surface border bg-[#0b0c10] text-white shadow-lg",
        ready ? "border-amber-400/35" : "border-amber-400/20"
      )}
    >
      {ready && <LaunchGlow />}

      <div className="relative p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4 sm:items-center sm:gap-5">
            <span
              aria-hidden
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full border-2 sm:size-16",
                ready
                  ? "border-amber-400 bg-amber-400/10 text-amber-400 shadow-[0_0_28px_rgba(245,180,60,0.4),inset_0_0_14px_rgba(245,180,60,0.18)]"
                  : "border-amber-400/50 bg-amber-400/5 text-amber-400"
              )}
            >
              {ready ? (
                <Check className="size-6 sm:size-7" strokeWidth={2.5} />
              ) : (
                <TriangleAlert className="size-6" strokeWidth={2} />
              )}
            </span>
            <div className="min-w-0">
              <p className="type-meta text-amber-400">
                {ready ? t("readyToLaunch") : t("notReadyToLaunch")}
              </p>
              <h2 className="type-page-title mt-1 text-white sm:type-display">{detail.cycle.name}</h2>
              <p className="mt-1.5 type-body text-zinc-300">
                {ready
                  ? t("allRequiredComponentsAreComplete")
                  : blockers.length > 0
                    ? (blockers.length === 1 ? t("issueBlocksLaunch", { length: blockers.length }) : t("issuesBlockLaunch", { length: blockers.length }))
                    : t("resolveTheOutstandingSetupBefore")}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {ready ? (
              <AsyncButton
                size="lg"
                className="h-12 w-full bg-amber-400 px-6 type-label text-zinc-950 shadow-[0_0_28px_rgba(245,180,60,0.3)] hover:bg-amber-300 sm:w-auto"
                onClick={onLaunch}
                pending={launching}
              >
                <Rocket className="size-4" data-icon="inline-start" />
                {t("launchCycle")}
              </AsyncButton>
            ) : (
              <Button
                variant="outline"
                size="lg"
                asChild
                className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white sm:w-auto"
              >
                <Link href={setupStepHref("population", detail.cycle.id)}>{t("backToPopulation")}</Link>
              </Button>
            )}
          </div>
        </div>

        {!ready && blockers.length > 0 && (
          <ul className="mt-4 space-y-1.5 sm:ps-[5.25rem]">
            {blockers.map((blocker) => (
              <li key={blocker} className="flex items-start gap-2 type-body text-zinc-200">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-amber-400" aria-hidden />
                {blocker}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-white/10">
          <Stat icon={FileText} tone="done" value="Cycle details" label={t("complete")} />
          <Stat
            icon={Users2}
            tone={participants > 0 ? "done" : "blocked"}
            value={participants}
            label={participants === 1 ? t("participantConfirmed") : t("participantsConfirmed")}
          />
          <Stat
            icon={ShieldCheck}
            tone={blockers.length === 0 ? "done" : "blocked"}
            value={blockers.length}
            label={blockers.length === 1 ? "blocker" : "blockers"}
          />
          <Stat
            icon={CalendarDays}
            tone="done"
            value="Planning opens"
            label={t("through", { planningDeadline: format.date(detail.cycle.planningDeadline) })}
          />
        </div>
      </div>
    </section>
  );
}

/** Warm corner light with a few soft rays — the "primed to launch" moment. Decorative. */
function LaunchGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 120% at 92% -10%, rgba(245,180,60,0.26) 0%, rgba(245,180,60,0.07) 35%, transparent 65%)",
        }}
      />
      <div
        className="absolute -inset-e-10 -top-16 h-72 w-[28rem] opacity-60"
        style={{
          background:
            "repeating-conic-gradient(from 200deg at 85% 0%, rgba(253,230,176,0.10) 0deg 2deg, transparent 2deg 9deg)",
          maskImage: "radial-gradient(70% 90% at 85% 0%, black 0%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(70% 90% at 85% 0%, black 0%, transparent 75%)",
        }}
      />
    </div>
  );
}
