import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import type { SetupStep } from "./setup-readiness";
import { useTranslations } from "next-intl";

/*
 * Shape-matched loading states for the cycle-setup journey. Each mirrors the layout it stands in
 * for (header, stepper, hero, step body) so content lands in place instead of replacing a generic
 * list of bars.
 */

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-surface bg-card p-6 lg:p-7", className)}>{children}</div>;
}

/** The Details step's card title: icon tile, serif title, caption. */
function TitleBlock() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="size-12 shrink-0 rounded-control" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
    </div>
  );
}

function Field({ tall = false }: { tall?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-56 max-w-full" />
      <Skeleton className={cn("w-full", tall ? "h-16" : "h-11")} />
    </div>
  );
}

function Footer() {
  return (
    <div className="flex items-center justify-between border-t border-border pt-6">
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-9 w-36" />
    </div>
  );
}

/** Placeholder bar on the dark heroes, which render dark in both themes. */
function DarkBar({ className }: { className: string }) {
  return <Skeleton className={cn("bg-white/10", className)} />;
}

/** The dark hero shell shared by Step 1's setup hero and Step 3's launch hero. */
function HeroSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div
      className={cn(
        "relative rounded-surface border border-white/10 bg-[#0b0c10] p-7 shadow-lg lg:p-9",
        tall ? "min-h-60" : "min-h-44"
      )}
    >
      {tall ? <DarkBar className="absolute inset-e-9 top-6 hidden h-4 w-56 lg:block" /> : null}
      <DarkBar className="h-3 w-40" />
      <DarkBar className="mt-3 h-8 w-80 max-w-full" />
      <DarkBar className="mt-3 h-4 w-[28rem] max-w-full" />
      <div className="mt-6 flex flex-wrap gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <DarkBar className="size-8 rounded-full" />
            <DarkBar className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 2's compact hero: copy on the left, tagline on the right. */
function PopulationHeroSkeleton() {
  return (
    <div className="flex items-center justify-between gap-8 rounded-surface border border-white/10 bg-[#0b0c10] p-6 shadow-lg lg:p-7">
      <div className="w-full max-w-xl">
        <DarkBar className="h-3 w-44" />
        <DarkBar className="mt-2.5 h-7 w-72 max-w-full" />
        <DarkBar className="mt-3 h-4 w-full" />
        <DarkBar className="mt-2 h-4 w-2/3" />
      </div>
      <div className="hidden shrink-0 space-y-2 border-s border-white/10 ps-6 lg:block">
        <DarkBar className="h-3.5 w-28" />
        <DarkBar className="h-3.5 w-36" />
        <DarkBar className="h-3.5 w-32" />
      </div>
    </div>
  );
}

/** A numbered section heading (badge, title, caption) with an optional right-side control. */
function NumberedHeading({ aside }: { aside?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-7 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-52 max-w-full" />
        </div>
      </div>
      {aside}
    </div>
  );
}

export function DetailsStepSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="lg:p-8">
          <TitleBlock />
          <div className="mt-7 space-y-6">
            <Field />
            <Field tall />
          </div>
          <div className="mt-8 border-t border-border/70 pt-7">
            <TitleBlock />
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <Field />
              <Field />
            </div>
          </div>
        </Card>
        <Card className="flex flex-col">
          <TitleBlock />
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Skeleton className="h-24 rounded-surface" />
            <Skeleton className="h-24 rounded-surface" />
          </div>
          <div className="mt-6 border-t border-border/70 pt-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ms-[24%] mt-5 h-8 w-24" />
            <div className="relative mt-3 h-4">
              <Skeleton className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" />
              {["inset-s-0", "inset-s-[24%]", "inset-e-0"].map((pos) => (
                <Skeleton key={pos} className={cn("absolute top-0 size-4 rounded-full", pos)} />
              ))}
            </div>
            <div className="mb-5 mt-3 flex justify-between">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <div className="mt-auto space-y-2.5 border-t border-border/70 pt-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-16 rounded-surface" />
            <Skeleton className="h-16 rounded-surface" />
          </div>
        </Card>
      </div>
      <Footer />
    </div>
  );
}

export function PopulationStepSkeleton() {
  const t = useTranslations("cycleSetup.PopulationStepSkeleton");
  return (
    <div className="space-y-6" aria-busy aria-label={t("resolvingPopulation")}>
      <PopulationHeroSkeleton />

      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* 1 · Population scope */}
      <Card className="lg:p-6">
        <NumberedHeading aside={<Skeleton className="hidden h-9 w-52 rounded-control sm:block" />} />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-surface border border-border px-5 py-4">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Skeleton className="size-12 shrink-0 rounded-control" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-3.5 w-64 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 2 · Resolved population */}
      <Card className="!p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <NumberedHeading aside={<Skeleton className="h-8 w-24" />} />
        </div>
        <div className="grid grid-cols-2 gap-y-6 px-5 py-6 md:grid-cols-4 md:gap-0 md:divide-x md:divide-border xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={cn("flex items-start gap-3 md:px-5 md:first:ps-0", i === 4 && "col-span-2 md:col-span-4 xl:col-span-1")}>
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-7 w-14" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-5 py-3.5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </Card>

      {/* People in scope */}
      <Card className="!p-0 overflow-hidden">
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 shrink-0 rounded-control" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-full sm:w-96" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-control" />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 border-y border-border bg-inlay px-5 py-2.5">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ms-auto hidden h-3 w-24 md:block" />
          <Skeleton className="hidden h-3 w-20 md:block" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-0">
            <Skeleton className="size-4" />
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="w-44 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="ms-auto hidden h-4 w-32 md:block" />
            <Skeleton className="hidden h-4 w-28 md:block" />
            <div className="w-24 space-y-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </Card>

      <Footer />
    </div>
  );
}

/** Summary cards + readiness rail, below the launch hero. */
export function ReviewBodySkeleton() {
  const t = useTranslations("cycleSetup.ReviewBodySkeleton");
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]"
      aria-busy
      aria-label={t("loadingReview")}
    >
      <Card>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        <div className="mt-5 space-y-4">
          {[3, 2, 4].map((facts, i) => (
            <div key={i} className="@container rounded-surface border border-border p-4 sm:p-5">
              <div className="flex items-start gap-4">
                <Skeleton className="size-11 shrink-0 rounded-full sm:size-12" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
                <Skeleton className="h-8 w-16" />
              </div>
              <div
                className={cn(
                  "mt-4 grid gap-4 border-t border-border/70 pt-4",
                  facts === 4 ? "@sm:grid-cols-2 @2xl:grid-cols-4" : facts === 3 ? "@sm:grid-cols-2 @xl:grid-cols-3" : "@sm:grid-cols-2"
                )}
              >
                {Array.from({ length: facts }).map((_, j) => (
                  <div key={j} className="flex items-start gap-3">
                    <Skeleton className="size-5 shrink-0" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  </div>
                ))}
              </div>
              {facts === 2 ? <Skeleton className="mt-4 h-16 rounded-surface" /> : null}
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-6">
        <Card className="space-y-4">
          <Skeleton className="h-5 w-36" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </Card>
        <Skeleton className="h-32 rounded-surface" />
      </div>
    </div>
  );
}

export function ReviewStepSkeleton() {
  return (
    <div className="space-y-6">
      <HeroSkeleton />
      <ReviewBodySkeleton />
      <Footer />
    </div>
  );
}

function SetupStepSkeleton({ step }: { step: SetupStep }) {
  if (step === "population") return <PopulationStepSkeleton />;
  if (step === "review") return <ReviewStepSkeleton />;
  return <DetailsStepSkeleton />;
}

/** The whole setup shell: header, three-node stepper, (Step 1) hero, and the step body. */
export function SetupShellSkeleton({ step, label }: { step: SetupStep; label?: string }) {
  const t = useTranslations("cycleSetup.SetupShellSkeleton");
  return (
    <PageContainer>
      <div aria-busy aria-label={label ?? t("loadingCycleSetup")}>
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="mx-auto mt-7 flex max-w-5xl items-start">
          {[0, 1, 2].map((i) => (
            <div key={i} className="relative flex flex-1 flex-col items-center">
              <Skeleton className="size-9 rounded-full" />
              {i < 2 ? (
                <Skeleton className="absolute top-[17px] inset-s-[calc(50%+30px)] inset-e-[calc(-50%+30px)] h-0.5" />
              ) : null}
              <Skeleton className="mt-3 h-4 w-24" />
              <Skeleton className="mt-1.5 h-3 w-20" />
            </div>
          ))}
        </div>
        {step === "details" ? (
          <div className="mt-7">
            <HeroSkeleton tall />
          </div>
        ) : null}
        <div className="mt-7">
          <SetupStepSkeleton step={step} />
        </div>
      </div>
    </PageContainer>
  );
}

/** The established /cycle surface: heading, milestone rail, population block (Cycle context is in the top bar). */
export function CycleSurfaceSkeleton() {
  const t = useTranslations("cycleSetup.CycleSurfaceSkeleton");
  return (
    <PageContainer>
      <div aria-busy aria-label={t("loadingCycle")} className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-surface" />
      </div>
    </PageContainer>
  );
}
