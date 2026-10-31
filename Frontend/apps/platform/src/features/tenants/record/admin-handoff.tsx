"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSay, type Say } from "@repo/ds/lib/say";
import { toast } from "sonner";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Mail,
  TriangleAlert,
  UsersRound,
  type LucideIcon,
} from "@/lib/icons";
import { Button } from "@repo/ds/components/ui/button";
import { cn } from "@repo/ds/lib/utils";
import { personHueProps } from "@repo/ds/components/ui/person-avatar";
import type {
  RecoveryAction,
  TenantContinuityHealth,
  TenantDetail,
} from "../api";
import {
  useFailureDetail,
  useTenantWords,
  type TenantWords,
} from "../language";
import { useInvitationRecovery, useTenantContinuityHealth } from "../queries";
import { destinationHref } from "./record-routes";
import { useTenantRecord } from "./record-shell";

/**
 * The administrative handoff.
 *
 * A freshly provisioned tenant exists but is not yet under customer control —
 * this card is the platform's view of that transfer: who it is going to, how far
 * it has got, and the one action that moves it forward. It shows a single state
 * derived from the invitation and administrative-continuity truth, never a
 * checklist of every possibility, so the operator reads the situation at a
 * glance rather than assembling it.
 *
 * Recovery is the exception it points at rather than performs: a stranded tenant
 * is resolved through the Access destination, which owns the verified recovery
 * flow, so those states link there instead of duplicating the dialog.
 */
export function AdminHandoff() {
  const { tenant, query } = useTenantRecord();
  const { data: continuity } = useTenantContinuityHealth(tenant.tenantId);
  const say = useSay("record.handoff");
  const words = useTenantWords();
  // An archived tenant can never be activated or recovered: nobody signing in
  // is expected, not a continuity problem, so the card states where the handoff
  // stopped and offers nothing.
  const resolved = resolveHandoff(
    tenant,
    tenant.isArchived ? undefined : continuity,
    say,
    words
  );
  const view =
    tenant.isArchived && resolved.action?.type !== "complete"
      ? { ...resolved, action: null }
      : resolved;
  const person = handoffPerson(tenant, continuity, say);

  return (
    <section className="rounded-surface bg-card p-5">
      <div className="flex items-center gap-3">
        <UsersRound
          aria-hidden="true"
          className="size-8 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {say("title")}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {view.description}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-4 rounded-surface border border-border bg-inlay px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar identity={person.identity} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {person.identity}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {person.role}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium",
              TONE_TEXT[view.status.tone]
            )}
          >
            <view.status.icon aria-hidden="true" className="size-4" />
            {view.status.label}
          </span>
          {view.meta ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{view.meta}</p>
          ) : null}
        </div>

        <div className="ms-auto">
          <HandoffAction
            action={view.action}
            accessHref={`${destinationHref(tenant.tenantId, "access")}${query}`}
          />
        </div>
      </div>
    </section>
  );
}

const TONE_TEXT: Record<HandoffTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

function HandoffAction({
  action,
  accessHref,
}: {
  action: HandoffView["action"];
  accessHref: string;
}) {
  const recovery = useInvitationRecovery(
    action?.type === "mutate" ? action.recovery : "resend"
  );
  // The action stays busy across the whole task, not just the request: the
  // mutation invalidates the record, and the button should not become
  // actionable again until that refetched result has settled and the card can
  // re-derive its state. `mutateAsync` resolves only after the awaited
  // invalidation, so it is the honest signal for that whole span.
  const [running, setRunning] = useState(false);
  const t = useTranslations("record.handoff");
  const failureDetail = useFailureDetail();

  if (!action) return null;

  if (action.type === "complete") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <CircleCheck aria-hidden="true" className="size-4" />
        {t("complete")}
      </span>
    );
  }

  if (action.type === "navigate") {
    return (
      <Button
        asChild
        size="sm"
        variant={action.destructive ? "destructive" : "outline"}
      >
        <Link href={accessHref}>{action.label}</Link>
      </Button>
    );
  }

  const busy = running || recovery.isLoading;

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        const reissue = action.recovery === "reissue";
        setRunning(true);
        try {
          await recovery.mutateAsync({
            tenantId: action.tenantId,
            invitationId: action.invitationId,
          });
          toast.success(reissue ? t("toast.newSent") : t("toast.resent"), {
            description: reissue
              ? t("toast.newSentDescription")
              : t("toast.resentDescription"),
          });
        } catch (error) {
          toast.error(
            reissue ? t("toast.newFailed") : t("toast.resendFailed"),
            { description: failureDetail(error) }
          );
        } finally {
          setRunning(false);
        }
      }}
    >
      {busy ? t("working") : action.label}
    </Button>
  );
}

function PersonAvatar({ identity }: { identity: string }) {
  const hue = personHueProps(identity);
  return (
    <span
      aria-hidden="true"
      style={hue.style}
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold", hue.className)}
    >
      {personInitials(identity)}
    </span>
  );
}

// ── State derivation ───────────────────────────────────

type HandoffTone = "info" | "success" | "warning" | "danger";

interface HandoffView {
  description: string;
  status: { label: string; icon: LucideIcon; tone: HandoffTone };
  meta?: string;
  action:
    | {
        type: "mutate";
        label: string;
        recovery: RecoveryAction;
        tenantId: string;
        invitationId: string;
      }
    | { type: "navigate"; label: string; destructive?: boolean }
    | { type: "complete" }
    | null;
}

/**
 * The single state the handoff is in, in strict precedence: a stranded tenant
 * needing recovery outranks a completed handoff, which outranks the invitation's
 * own progress. Everything the card shows is one of these — it never blends two.
 */
function resolveHandoff(
  tenant: TenantDetail,
  continuity: TenantContinuityHealth | undefined,
  say: Say,
  words: TenantWords
): HandoffView {
  const recovery = continuity?.recoveryStatus;

  if (recovery === "Required" || recovery === "Failed") {
    return {
      description: say("recoveryRequired.description"),
      status: {
        label: say("recoveryRequired.label"),
        icon: TriangleAlert,
        tone: "warning",
      },
      meta: say("recoveryRequired.meta"),
      action: {
        type: "navigate",
        label: say("recoveryRequired.action"),
        destructive: true,
      },
    };
  }

  if (recovery === "Pending") {
    const recipient = continuity?.latestRecoveryAttempt?.recipientEmail;
    return {
      description: say("recoveryPending.description"),
      status: {
        label: say("recoveryPending.label"),
        icon: Clock,
        tone: "warning",
      },
      meta: recipient ? say("recoveryPending.meta", { recipient }) : undefined,
      action: { type: "navigate", label: say("recoveryPending.action") },
    };
  }

  if (tenant.administratorActivationStatus === "Active") {
    return {
      description: say("active.description"),
      status: {
        label: say("active.label"),
        icon: CircleCheck,
        tone: "success",
      },
      meta: acceptedMeta(tenant, say, words),
      action: { type: "complete" },
    };
  }

  const invitation = tenant.bootstrapInvitation;

  if (invitation) {
    const failed = invitation.lastDelivery?.outcome === "Failed";

    if (invitation.state === "Pending" && failed) {
      return {
        description: say("deliveryFailed.description"),
        status: {
          label: say("deliveryFailed.label"),
          icon: CircleAlert,
          tone: "danger",
        },
        meta: invitation.lastDelivery
          ? say("deliveryFailed.meta", {
              date: words.dateTime(invitation.lastDelivery.attemptedAt),
            })
          : undefined,
        action: resend(tenant.tenantId, invitation.invitationId, words),
      };
    }

    if (invitation.state === "Pending") {
      return {
        description: say("pending.description"),
        status: { label: say("pending.label"), icon: Mail, tone: "warning" },
        meta: say("pending.meta", {
          ago: words.relative(invitation.createdAt),
        }),
        action: resend(tenant.tenantId, invitation.invitationId, words),
      };
    }

    if (invitation.state === "Expired") {
      return {
        description: say("expired.description"),
        status: { label: say("expired.label"), icon: Clock, tone: "warning" },
        meta: say("expired.meta", { date: words.date(invitation.expiresAt) }),
        action: {
          type: "mutate",
          label: say("sendNew"),
          recovery: "reissue",
          tenantId: tenant.tenantId,
          invitationId: invitation.invitationId,
        },
      };
    }

    if (invitation.state === "Revoked") {
      return {
        description: say("revoked.description"),
        status: {
          label: say("revoked.label"),
          icon: CircleAlert,
          tone: "danger",
        },
        action: {
          type: "mutate",
          label: say("sendNew"),
          recovery: "reissue",
          tenantId: tenant.tenantId,
          invitationId: invitation.invitationId,
        },
      };
    }
  }

  // Awaiting activation with nothing actionable on the invitation itself — the
  // Access destination is where the administrator picture is resolved.
  return {
    description: say("awaiting.description"),
    status: { label: say("awaiting.label"), icon: Clock, tone: "info" },
    action: { type: "navigate", label: say("awaiting.action") },
  };
}

function resend(
  tenantId: string,
  invitationId: string,
  words: TenantWords
): HandoffView["action"] {
  return {
    type: "mutate",
    label: words.recovery("resend"),
    recovery: "resend",
    tenantId,
    invitationId,
  };
}

/** The activation moment, read from the bootstrap history rather than invented. */
function acceptedMeta(
  tenant: TenantDetail,
  say: Say,
  words: TenantWords
): string | undefined {
  const completed = tenant.history.find(
    (entry) => entry.eventType === "BootstrapCompleted"
  );
  return completed
    ? say("active.meta", { date: words.date(completed.occurredAt) })
    : undefined;
}

function handoffPerson(
  tenant: TenantDetail,
  continuity: TenantContinuityHealth | undefined,
  say: Say
): { identity: string; role: string } {
  const identity =
    tenant.bootstrapInvitation?.email ??
    continuity?.latestRecoveryAttempt?.recipientEmail ??
    say("person.fallback");
  return { identity, role: say("person.role") };
}

function personInitials(identity: string): string {
  const local = identity.split("@")[0] ?? identity;
  const parts = local.split(/[.\-_+]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toLocaleUpperCase();
  }
  return local.slice(0, 2).toLocaleUpperCase();
}
