"use client";

import { Button } from "@repo/ds";
import { PageStateDrawing, type PageStateDrawingKind } from "@repo/ds/shell";
import { useTranslations } from "next-intl";
import { SignInFrame } from "./signin-page";

/**
 * Where an invitation link stops, on the sign-in layout (B-302). It names no company: the service withholds it so a
 * wrong link can't be used to find out which ones exist. A stop that went well carries no drawing and leads with its action.
 */
export function InvitationEnd({
  drawing,
  title,
  detail,
  action,
}: {
  drawing?: PageStateDrawingKind;
  title: string;
  detail: string;
  action?: { label: string; href: string };
}) {
  const t = useTranslations("auth.signIn");
  return (
    <SignInFrame brand={null}>
      <div className="flex flex-col gap-1.5">
        {drawing ? <PageStateDrawing kind={drawing} size="small" className="mb-2.5 -ms-[15px]" /> : null}
        <h1 className="type-page-title text-foreground">{title}</h1>
        <p className="type-body text-pretty text-muted-foreground">{detail}</p>
      </div>
      <Button asChild size="lg" variant={action ? "default" : "outline"} className="mt-7 h-11 w-full text-sm">
        <a href={action?.href ?? "/auth/signin"}>{action?.label ?? t("goToSignIn")}</a>
      </Button>
    </SignInFrame>
  );
}
