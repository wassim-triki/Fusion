import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "../lib/utils";

/**
 * The Fusion brand mark for the public invitation surface: an amber monogram
 * tile beside the wordmark. The tile is the one amber accent the left panel
 * shares with the primary action on the form panel, tying the two halves of the
 * split together.
 */
export function InvitationWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-control bg-primary font-heading text-base font-bold text-primary-foreground"
      >
        F
      </span>
      <span className="font-heading text-[1.0625rem] font-semibold tracking-tight">
        Fusion
      </span>
    </span>
  );
}

/**
 * The quiet decorative field behind the invitation's brand panel: a soft amber
 * bloom and a set of concentric arcs sweeping out of one corner. Geometry and
 * light only — it never carries meaning, and it sits behind the content.
 */
function BrandBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <span className="absolute -top-32 -inset-s-24 h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-[130px]" />
      <span className="absolute top-1/2 inset-e-[-22rem] aspect-square w-[52rem] -translate-y-1/2 rounded-full border border-white/[0.06]" />
      <span className="absolute top-1/2 inset-e-[-16rem] aspect-square w-[40rem] -translate-y-1/2 rounded-full border border-white/[0.05]" />
      <span className="absolute top-1/2 inset-e-[-10rem] aspect-square w-[28rem] -translate-y-1/2 rounded-full border border-white/[0.04]" />
    </div>
  );
}

/**
 * Shared public transaction frame for every Fusion invitation purpose. The
 * context panel establishes who issued the invitation; the quiet task surface
 * keeps account creation focused. Purpose-specific copy and fields stay with
 * the owning journey.
 *
 * The whole surface is held dark in every theme: an invitation arrives cold,
 * from an organization the recipient may not yet recognise, and a fixed dark
 * canvas gives the page one centre of gravity that reads the same whichever
 * theme the recipient's browser asks for.
 */
export function InvitationTransactionFrame({
  context,
  children,
}: {
  context: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="dark min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[44fr_56fr]">
      <div className="relative isolate overflow-hidden border-b border-border bg-[oklch(0.18_0.018_264)] px-6 py-10 sm:px-10 lg:border-b-0 lg:border-e lg:py-12">
        <BrandBackdrop />
        <div className="relative h-full">{context}</div>
      </div>
      <div className="relative flex items-center justify-center bg-background px-6 py-10 sm:px-10 lg:py-12">
        <div className="relative w-full max-w-[34rem] lg:max-w-[30rem]">
          {children}
        </div>
      </div>
    </main>
  );
}

/** Shared token-resolution state. It preserves the split transaction geometry
 * while the server determines which invitation journey is safe to show. */
export function InvitationTransactionLoading() {
  const t = useTranslations("ds.invitation");
  return (
    <InvitationTransactionFrame
      context={
        <div className="mx-auto flex h-full max-w-[34rem] flex-col lg:max-w-[33rem]" aria-hidden="true">
          <InvitationWordmark />
          <div className="mt-12 animate-pulse motion-reduce:animate-none lg:mt-16">
            <div className="h-4 w-28 rounded-detail bg-white/[0.06]" />
            <div className="mt-5 h-12 w-full rounded-control bg-white/[0.1]" />
            <div className="mt-3 h-12 w-2/3 rounded-control bg-white/[0.08]" />
            <div className="mt-8 h-4 w-5/6 rounded-detail bg-white/[0.06]" />
            <div className="mt-10 h-40 w-full rounded-surface bg-white/[0.05]" />
          </div>
        </div>
      }
    >
      <div className="animate-pulse space-y-5 motion-reduce:animate-none" aria-label={t("loading")}>
        <div className="h-8 w-3/4 rounded-control bg-muted" />
        <div className="grid grid-cols-2 gap-5">
          <div className="h-11 rounded-control bg-muted" />
          <div className="h-11 rounded-control bg-muted" />
        </div>
        <div className="h-11 rounded-control bg-muted" />
        <div className="h-11 rounded-control bg-muted" />
        <div className="h-11 rounded-control bg-muted" />
        <div className="h-11 rounded-control bg-muted" />
      </div>
    </InvitationTransactionFrame>
  );
}

/** Shared terminal-state composition for invitations that cannot reveal tenant context. */
export function InvitationTransactionTerminalFrame({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="dark flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground sm:px-10">
      <div className="w-full max-w-[29rem]">
        <InvitationWordmark />
        <div className="mt-8 rounded-surface bg-card p-7 shadow-overlay sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
