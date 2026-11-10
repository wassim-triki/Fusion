"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@repo/ds/icons";
import { Button } from "@repo/ds/components/ui/button";
import { useTranslations } from "next-intl";

/**
 * Shared setup footer bar: a left affordance (Back to the previous step, or Cancel out of the
 * flow on the first step), an optional centered status message, and the step's primary action on
 * the right.
 */
export function SetupStepFooter({
  backHref,
  cancelHref,
  center,
  children,
}: {
  backHref?: string;
  cancelHref?: string;
  center?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations("cycleSetup.SetupStepFooter");
  return (
    <div className="mt-8 flex items-center justify-between gap-4 border-t border-border pt-6">
      {backHref ? (
        <Button variant="ghost" asChild>
          <Link href={backHref}>
            <ArrowLeft className="size-4" data-icon="inline-start" />
            {t("back")}
          </Link>
        </Button>
      ) : cancelHref ? (
        <Button variant="outline" asChild>
          <Link href={cancelHref}>{t("cancel")}</Link>
        </Button>
      ) : (
        <span />
      )}
      {center ? <div className="min-w-0 flex-1 text-center">{center}</div> : null}
      {children}
    </div>
  );
}
