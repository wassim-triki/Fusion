"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, ArrowRight } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import { AsyncButton } from "@repo/ds/shell";
import { failureKind } from "../api";
import { useFailureMessage } from "../language";

/**
 * The controls that move through provisioning, shared by every step so the
 * commitment always sits in the same place. Back is quiet; the forward action
 * carries the weight and becomes the commit on the final step. Any refusal of
 * that commit is shown here, beside the action it concerns.
 */
export function StepNavigation({
  isFirst,
  isLast,
  onBack,
  onPrimary,
  primaryDisabled,
  primaryPending,
  failure,
}: {
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onPrimary: () => void;
  primaryDisabled: boolean;
  primaryPending: boolean;
  failure: Error | null;
}) {
  const t = useTranslations("provisioning");
  return (
    <div className="mt-6">
      {failure ? <SubmissionFailure error={failure} /> : null}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isFirst || primaryPending}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("navigation.back")}
        </Button>

        <AsyncButton
          type="button"
          size="lg"
          onClick={onPrimary}
          disabled={primaryDisabled}
          pending={primaryPending}
        >
          {isLast ? t("title") : t("navigation.continue")}
          {!isLast ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
        </AsyncButton>
      </div>
    </div>
  );
}

/**
 * What a refused submission actually tells the operator.
 *
 * The distinction that matters is whether the outcome is known. Provisioning
 * commits the tenant before the response returns, so a timeout or gateway
 * failure can arrive after the tenant exists — claiming "no tenant was created"
 * there is a guarantee this page cannot make. Validation and permission
 * failures are refused before anything is committed, so they can safely say so;
 * the ambiguous ones ask for an unchanged retry, which reuses the idempotency
 * key and cannot create a second tenant.
 */
export function SubmissionFailure({ error }: { error: Error }) {
  const t = useTranslations("provisioning.failure");
  const failureMessage = useFailureMessage();
  const kind = failureKind(error);
  const message =
    kind === "permission"
      ? t("permission")
      : kind === "validation"
        ? failureMessage(error, t("validation"))
        : kind === "conflict"
          ? failureMessage(error, t("conflict"))
          : kind === "unavailable"
            ? t("unavailable")
            : failureMessage(error, t("unexpected"));

  return (
    <p
      role="alert"
      className="mb-4 flex items-start gap-2 text-sm text-destructive"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
