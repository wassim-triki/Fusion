"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, RefreshCw, Send, UserPen, type LucideIcon } from "@/lib/icons";
import { Button } from "@repo/ds/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { AsyncButton } from "@repo/ds/shell";
import type { RecoveryAction } from "./api";
import { failureKind } from "./api";
import { useFailureMessage, useTenantWords } from "./language";
import { useInvitationRecovery } from "./queries";
import { isEmailAddress } from "@repo/ds/lib/email";

/**
 * The confirmed recoveries, shared by the tenant detail and the directory's row
 * menu. One implementation so a shortcut cannot state a different consequence
 * from the authoritative page, or skip a confirmation the page requires.
 */

/**
 * Each recovery reads faster with a glyph that matches what it does — resending
 * and reissuing are otherwise easy to confuse in a plain text menu.
 */
export const RECOVERY_ICON: Record<RecoveryAction, LucideIcon> = {
  resend: Send,
  reissue: RefreshCw,
  replace: UserPen,
  revoke: Ban,
};

export function ConfirmRecoveryDialog({
  action,
  tenantId,
  invitationId,
  currentEmail,
  onCompleted,
  onClose,
}: {
  action: Exclude<RecoveryAction, "resend">;
  tenantId: string;
  invitationId: string;
  currentEmail: string;
  /** Fires once the change is recorded, so the caller can state the outcome. */
  onCompleted?: () => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(currentEmail);
  const [emailError, setEmailError] = useState<string | null>(null);
  const recovery = useInvitationRecovery(action);
  const t = useTranslations("tenants.recoveryDialog");
  const words = useTenantWords();

  function confirm() {
    if (action === "replace") {
      const next = email.trim();
      if (!isEmailAddress(next)) {
        setEmailError(t("emailInvalid"));
        return;
      }
      if (next.toLowerCase() === currentEmail.toLowerCase()) {
        setEmailError(t("emailSame"));
        return;
      }
    }

    // The dialog closes only once the change is recorded, so a refused command
    // is answered where it was issued rather than behind a vanished dialog.
    recovery
      .mutateAsync({ tenantId, invitationId, email: email.trim() })
      .then(() => {
        onCompleted?.();
        onClose();
      })
      .catch(() => {
        // Reported inline by the mutation's error state.
      });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${action}.title`)}</DialogTitle>
          <DialogDescription>{t(`${action}.consequence`)}</DialogDescription>
        </DialogHeader>

        {/* The address the action acts on, stated where the decision is made
            rather than left to be remembered from the surface behind. */}
        <div className="rounded-control border border-border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {/* Revoking sends nothing, so it names the invitation rather than
                claiming a destination. */}
            {action === "replace"
              ? t("currentEmail")
              : action === "revoke"
                ? t("invitationFor")
                : t("sendsTo")}
          </span>{" "}
          <span className="font-medium text-foreground [overflow-wrap:anywhere]">
            {currentEmail}
          </span>
        </div>

        {action === "replace" ? (
          <div className="space-y-2">
            <Label htmlFor="replacement-email">{t("newEmail")}</Label>
            <Input
              id="replacement-email"
              type="email"
              value={email}
              autoFocus
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "replacement-email-error" : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
            />
            {emailError ? (
              <p id="replacement-email-error" className="text-sm text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>
        ) : null}

        {recovery.error ? <RecoveryFailure error={recovery.error} /> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={recovery.isLoading}>
            {t("cancel")}
          </Button>
          <AsyncButton
            onClick={confirm}
            pending={recovery.isLoading}
            variant={action === "revoke" ? "destructive" : "default"}
          >
            {words.recovery(action)}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Failures are separated by what the operator can do about them. A stale
 * command, a withdrawn permission and an unreachable service all refuse the
 * same request and need different responses.
 */
export function RecoveryFailure({ error }: { error: Error }) {
  const t = useTranslations("tenants");
  const failureMessage = useFailureMessage();
  const kind = failureKind(error);

  const message =
    kind === "conflict"
      ? t("recoveryDialog.failure.conflict")
      : kind === "permission"
        ? t("common.permissionChanged")
        : kind === "not-found"
          ? t("recoveryDialog.failure.notFound")
          : kind === "unavailable"
            ? t("recoveryDialog.failure.unavailable")
            : failureMessage(error, t("recoveryDialog.failure.unexpected"));

  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
