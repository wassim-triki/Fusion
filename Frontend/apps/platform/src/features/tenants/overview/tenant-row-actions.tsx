"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, History, MoreHorizontal, UserPen } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
import { Spinner } from "@repo/ds/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ds/components/ui/tooltip";
import type { IconComponent } from "@repo/ds/icons";
import type { RecoveryAction, TenantOverviewRow } from "../api";
import { useTenantWords } from "../language";
import { useInvitationRecovery } from "../queries";
import { ConfirmRecoveryDialog, RECOVERY_ICON } from "../recovery-dialog";

/**
 * One menu, in the same place on every row.
 *
 * The alternative — a Resend button here, a history icon there — makes the
 * operator re-read each row to find out what it offers. A single trailing menu
 * means the position is learned once and the contents answer the question.
 *
 * What it contains comes from the row's own `allowedActions`, which the service
 * derives from the invitation state. Nothing here re-decides what is permitted,
 * so the menu cannot offer a recovery the service would then refuse. An
 * accepted or replaced invitation permits nothing, and correctly shows only the
 * way into the tenant.
 */
export function TenantRowActions({
  row,
  onActionFailed,
}: {
  row: TenantOverviewRow;
  /**
   * Resend runs without a dialog, so a refusal has no dialog to report in. The
   * row is too narrow to hold the explanation without disturbing every other
   * row's height, so the workspace shows it once, above the directory.
   */
  onActionFailed: (error: Error | null) => void;
}) {
  const [pendingAction, setPendingAction] = useState<Exclude<
    RecoveryAction,
    "resend"
  > | null>(null);
  // The dialog opens from a menu item rather than a trigger, so there is
  // nothing for it to hand focus back to on close without this.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const resend = useInvitationRecovery("resend");
  const t = useTranslations("tenants.rowActions");
  const words = useTenantWords();

  const invitationId = row.bootstrapInvitationId;
  const recoveries = invitationId ? row.allowedActions : [];

  // A lapsed invitation is exactly where replacing the address would be wanted,
  // and exactly where the service does not yet allow it.
  const showsPlannedReplace =
    recoveries.includes("reissue") && !recoveries.includes("replace");

  const resendError = resend.error;
  useEffect(() => {
    if (resendError) onActionFailed(resendError);
  }, [resendError, onActionFailed]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-sm"
            aria-label={t("actionsFor", { name: row.name })}
            className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            {resend.isLoading ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <MoreHorizontal aria-hidden="true" className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem asChild className="gap-2">
            <Link href={`/tenants/${row.tenantId}`}>
              <ExternalLink aria-hidden="true" className="size-4" />
              {t("viewTenant")}
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem asChild className="gap-2">
            <Link href={`/tenants/${row.tenantId}/activity`}>
              <History aria-hidden="true" className="size-4" />
              {t("viewActivity")}
            </Link>
          </DropdownMenuItem>

          {recoveries.length > 0 || showsPlannedReplace ? (
            <DropdownMenuSeparator />
          ) : null}

          {recoveries.map((action) => {
            const Icon = RECOVERY_ICON[action];

            return (
              <DropdownMenuItem
                key={action}
                className="gap-2"
                // Revoking deliberately leaves the tenant with no way in, so it
                // is marked as the destructive choice.
                variant={action === "revoke" ? "destructive" : "default"}
                onSelect={() => {
                  if (action === "resend") {
                    // Resend neither invalidates nor creates anything, so it
                    // runs straight away rather than asking twice.
                    onActionFailed(null);
                    resend.mutate({
                      tenantId: row.tenantId,
                      invitationId: invitationId!,
                    });
                    return;
                  }
                  setPendingAction(action);
                }}
              >
                <Icon aria-hidden="true" className="size-4" />
                {words.recovery(action)}
              </DropdownMenuItem>
            );
          })}

          {/* Replacing the invited address on a lapsed invitation is the
              expected next capability, but the service accepts only a reissue
              in this state. It is shown unavailable rather than omitted, so the
              gap stays visible instead of being rediscovered later. */}
          {showsPlannedReplace ? (
            <NotConnectedItem
              icon={UserPen}
              label={words.recovery("replace")}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {pendingAction && invitationId ? (
        <ConfirmRecoveryDialog
          action={pendingAction}
          tenantId={row.tenantId}
          invitationId={invitationId}
          currentEmail={row.initialAdministratorEmail ?? ""}
          onClose={() => {
            setPendingAction(null);
            // Deferred past the dialog's own close sequence, which otherwise
            // moves focus after this handler and undoes the restore.
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

/**
 * An action the finished product will offer that this build cannot perform yet.
 *
 * Showing it unavailable rather than hiding it keeps the intended shape of the
 * menu legible, and keeps the remaining work visible where it will be needed
 * instead of only in a task list. It states plainly that it is not connected,
 * so it can never be mistaken for a real business restriction on this tenant.
 *
 * It is marked `aria-disabled` rather than `disabled`, because Radix removes a
 * disabled item from keyboard traversal — which would put the explanation out
 * of reach of exactly the people most likely to need it. Selection is
 * suppressed instead, so it is reachable and readable but cannot fire.
 */
function NotConnectedItem({
  icon: Icon,
  label,
}: {
  icon: IconComponent;
  label: string;
}) {
  const t = useTranslations("tenants.rowActions");
  const words = useTenantWords();
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            aria-disabled="true"
            // Keeps the menu open and the action unfired, while leaving the
            // item in the roving focus order.
            onSelect={(event) => event.preventDefault()}
            // Focus still has to be visible for keyboard users, but the accent
            // highlight the menu gives real items would read as actionable, so
            // the item keeps a quieter one.
            className="gap-2 text-muted-foreground! data-[highlighted]:bg-muted!"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
            <span className="ms-auto whitespace-nowrap text-xs text-muted-foreground/70">
              {t("notAvailable")}
            </span>
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{words.notConnected}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
