"use client";

import { Button } from "@repo/ds";
import { PageStateDrawing, type PageStateDrawingKind } from "@repo/ds/shell";
import { useTranslations } from "next-intl";
import { InvitationFrame } from "./invitation-frame";

/**
 * Where an invitation link stops, on the sign-in layout (B-302). The service never names the company here, so a wrong
 * link can't be used to find out which ones exist; the page wears only the brand the link itself names (B-205). A stop
 * that went well carries no drawing and leads with its action.
 */
export function InvitationEnd({
  company = null,
  drawing,
  title,
  detail,
  action,
}: {
  /** The company's slug from the link. */
  company?: string | null;
  drawing?: PageStateDrawingKind;
  title: string;
  detail: string;
  action?: { label: string; href: string };
}) {
  const t = useTranslations("auth.signIn");
  const href = action?.href ?? "/auth/signin";
  // Sign-in keeps the company the link named.
  const signIn = href === "/auth/signin" && company ? `${href}?company=${encodeURIComponent(company)}` : href;
  return (
    <InvitationFrame company={company}>
      <div className="flex flex-col gap-1.5">
        {drawing ? <PageStateDrawing kind={drawing} size="small" className="mb-2.5 -ms-[15px]" /> : null}
        <h1 className="type-page-title text-foreground">{title}</h1>
        <p className="type-body text-pretty text-muted-foreground">{detail}</p>
      </div>
      <Button asChild size="lg" variant={action ? "default" : "outline"} className="mt-7 h-11 w-full text-sm">
        <a href={signIn}>{action?.label ?? t("goToSignIn")}</a>
      </Button>
    </InvitationFrame>
  );
}
