"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Mail, ShieldAlert, ShieldCheck } from "@/lib/icons";
import { Button } from "@repo/ds/components/ui/button";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { useFormat } from "@repo/ds/lib/use-format";
import { StatusBadge, type StatusTone } from "@repo/ds/shell";
import type {
  BootstrapInvitationSummary,
  RecoveryAction,
  RecoveryStatusValue,
  TenantDetail,
} from "../api";
import { INVITATION_TONE, useFailureDetail, useTenantWords } from "../language";
import { useInvitationRecovery, useTenantContinuityHealth } from "../queries";
import { ConfirmRecoveryDialog, RECOVERY_ICON } from "../recovery-dialog";
import { AdministratorRecoveryDialog } from "./administrator-recovery-dialog";
import { useTenantRecord } from "./record-shell";

/**
 * Who can administer this tenant, and how they got there.
 *
 * Access owns the Platform-side identity picture: the initial administrator's
 * invitation with every recovery its state permits, and how many customer
 * administrators can sign in today. It is not the Core HR employee directory
 * and never becomes one.
 *
 * Routine administration (inviting, suspending, removing authority) belongs to
 * the customer and happens in their own workspace. The only thing Platform may
 * do beyond the invitation is restore administration to a tenant that has lost
 * all of it, which hands control back to the customer rather than taking it.
 */
export function TenantAccessDestination() {
  const { tenant } = useTenantRecord();

  return (
    <div className="space-y-3">
      <InitialAdministrator tenant={tenant} />
      <Administrators tenant={tenant} />
    </div>
  );
}

function InitialAdministrator({ tenant }: { tenant: TenantDetail }) {
  const t = useTranslations("record.access.invitation");
  const words = useTenantWords();
  const invitation = tenant.bootstrapInvitation;

  return (
    <Card
      icon={
        <Mail
          aria-hidden="true"
          className="size-8 shrink-0 text-muted-foreground"
        />
      }
      title={t("title")}
      action={
        invitation && invitation.allowedActions.length > 0 ? (
          <InvitationActions tenant={tenant} invitation={invitation} />
        ) : null
      }
    >
      {invitation ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-surface border border-border bg-inlay px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {invitation.email}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t("role")}
              </p>
            </div>
            <StatusBadge tone={INVITATION_TONE[invitation.state]} dot>
              {words.invitation(invitation.state)}
            </StatusBadge>
          </div>
          <InvitationFacts tenant={tenant} invitation={invitation} />
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t("none")}</p>
      )}
    </Card>
  );
}

function InvitationFacts({
  tenant,
  invitation,
}: {
  tenant: TenantDetail;
  invitation: BootstrapInvitationSummary;
}) {
  const t = useTranslations("record.access.invitation");
  const words = useTenantWords();
  const format = useFormat();
  const accepted = tenant.history.find(
    (entry) => entry.eventType === "BootstrapCompleted"
  );
  const delivery = invitation.lastDelivery;
  const open = invitation.state === "Pending" || invitation.state === "Expired";

  return (
    <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-3">
      <Fact label={t("sent")}>
        {format.dateTime(invitation.createdAt, { year: "always" })}
      </Fact>
      {invitation.state === "Accepted" && accepted ? (
        <Fact label={t("accepted")}>
          {format.dateTime(accepted.occurredAt, { year: "always" })}
        </Fact>
      ) : open ? (
        <Fact
          label={invitation.state === "Expired" ? t("expired") : t("expires")}
        >
          {format.date(invitation.expiresAt, { year: "always" })}
        </Fact>
      ) : null}
      <Fact label={t("lastDelivery")}>
        {delivery ? (
          <span
            className={
              delivery.outcome === "Failed" ? "text-destructive" : undefined
            }
          >
            {t("delivery", {
              outcome: words.delivery(delivery.outcome),
              date: format.dateTime(delivery.attemptedAt, { year: "always" }),
            })}
          </span>
        ) : (
          t("noDelivery")
        )}
      </Fact>
    </dl>
  );
}

/**
 * Exactly the recoveries the invitation's state permits, as the service reports
 * them. Resend changes nothing but the link, so it runs straight away; the rest
 * confirm in the shared dialog the directory's row menu also uses.
 */
function InvitationActions({
  tenant,
  invitation,
}: {
  tenant: TenantDetail;
  invitation: BootstrapInvitationSummary;
}) {
  const [confirming, setConfirming] = useState<Exclude<
    RecoveryAction,
    "resend"
  > | null>(null);
  const [resending, setResending] = useState(false);
  const resend = useInvitationRecovery("resend");
  const words = useTenantWords();
  const t = useTranslations("record.handoff.toast");
  const failureDetail = useFailureDetail();

  return (
    <div className="flex flex-wrap gap-2">
      {invitation.allowedActions.map((action) => {
        const Icon = RECOVERY_ICON[action];
        const busy = action === "resend" && (resending || resend.isLoading);
        return (
          <Button
            key={action}
            variant="outline"
            size="sm"
            disabled={busy}
            className={
              action === "revoke"
                ? "text-destructive hover:text-destructive"
                : undefined
            }
            onClick={async () => {
              if (action !== "resend") {
                setConfirming(action);
                return;
              }
              setResending(true);
              try {
                await resend.mutateAsync({
                  tenantId: tenant.tenantId,
                  invitationId: invitation.invitationId,
                });
                toast.success(t("resent"), {
                  description: t("resentDescription"),
                });
              } catch (error) {
                toast.error(t("resendFailed"), {
                  description: failureDetail(error),
                });
              } finally {
                setResending(false);
              }
            }}
          >
            <Icon aria-hidden="true" />
            {words.recovery(action)}
          </Button>
        );
      })}

      {confirming ? (
        <ConfirmRecoveryDialog
          action={confirming}
          tenantId={tenant.tenantId}
          invitationId={invitation.invitationId}
          currentEmail={invitation.email}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </div>
  );
}

const RECOVERY_TONE: Record<RecoveryStatusValue, StatusTone> = {
  NotRequired: "success",
  AwaitingAdministratorActivation: "info",
  Required: "danger",
  Pending: "info",
  Completed: "success",
  Failed: "warning",
};

/**
 * How many customer administrators can sign in, and the one exceptional action
 * Platform may take when none can. Read-only otherwise: offering more here would
 * quietly make Platform a co-administrator of every tenant.
 */
function Administrators({ tenant }: { tenant: TenantDetail }) {
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const health = useTenantContinuityHealth(tenant.tenantId);
  const t = useTranslations("record.access.administrators");
  const format = useFormat();
  const words = useTenantWords();
  const data = health.data;
  // Nobody signing in to an archived tenant is expected, not a continuity problem.
  const recoveryStatus = tenant.isArchived ? null : data?.recoveryStatus;
  const needsRecovery =
    recoveryStatus === "Required" || recoveryStatus === "Failed";
  const attempt = data?.latestRecoveryAttempt;

  return (
    <Card
      icon={
        needsRecovery ? (
          <ShieldAlert
            aria-hidden="true"
            className="size-8 shrink-0 text-destructive"
          />
        ) : (
          <ShieldCheck
            aria-hidden="true"
            className="size-8 shrink-0 text-muted-foreground"
          />
        )
      }
      title={t("title")}
      action={
        recoveryStatus ? (
          <StatusBadge tone={RECOVERY_TONE[recoveryStatus]} dot>
            {t(`status.${recoveryStatus}`)}
          </StatusBadge>
        ) : null
      }
    >
      {health.isLoading ? (
        <div aria-busy className="mt-4 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-surface" />
          ))}
        </div>
      ) : null}

      {!health.isLoading && (health.error || !data) ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("failed")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void health.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {data ? (
        <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <Count
              label={t("usable")}
              value={format.count(data.usableAdministrators)}
            />
            <Count
              label={t("suspended")}
              value={format.count(data.suspendedAdministrators)}
            />
            <Count
              label={t("pending")}
              value={format.count(data.pendingAdministratorInvitations)}
            />
          </dl>

          {needsRecovery ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-destructive/30 bg-destructive/5 px-4 py-3.5">
              <p className="text-sm font-medium text-foreground">
                {t("noneCanSignIn")}
              </p>
              <Button size="sm" onClick={() => setRecoveryOpen(true)}>
                {t("startRecovery")}
              </Button>
            </div>
          ) : null}

          {attempt ? (
            <div className="mt-4 border-t border-border pt-4">
              <h4 className="text-xs font-medium text-muted-foreground">
                {t("lastRecovery")}
              </h4>
              <dl className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-3">
                <Fact label={t("recipient")}>
                  <span className="[overflow-wrap:anywhere]">
                    {attempt.recipientEmail}
                  </span>
                </Fact>
                <Fact label={t("started")}>
                  {format.dateTime(attempt.initiatedAt, { year: "always" })}
                </Fact>
                <Fact label={t("invitation")}>
                  {attempt.deliveryStatus === "Failed"
                    ? words.delivery("Failed")
                    : words.invitation(attempt.state)}
                </Fact>
              </dl>
            </div>
          ) : null}
        </>
      ) : null}

      <AdministratorRecoveryDialog
        tenantId={tenant.tenantId}
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        onInitiated={() => {
          toast.success(t("recoverySent"));
          void health.refetch();
        }}
      />
    </Card>
  );
}

function Card({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-surface bg-card p-5">
      <header className="flex flex-wrap items-center gap-3">
        {icon}
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-foreground">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-surface border border-border bg-inlay px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 type-metric text-foreground">{value}</dd>
    </div>
  );
}
