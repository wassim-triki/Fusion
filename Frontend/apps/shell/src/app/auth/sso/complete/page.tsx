"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPlatformApiClient, ApiError, ssoPaths, type SsoResultDto } from "@repo/api";
import { finishSsoFlow, persistAuth, resolvePostSignInDestination, SignInFrame, type AuthUser } from "@repo/auth";
import { Spinner } from "@repo/ds/components/ui/spinner";

const client = createPlatformApiClient();

/**
 * Where a provider sends the browser back (B-191). It collects the outcome once, with the cookie that started the
 * round trip, then opens Home or the page the person asked for; a refusal goes back to the page it started from,
 * which says why. No code or token is ever in this address.
 */
export default function SsoCompletePage() {
  const t = useTranslations("auth.sso");
  const started = useRef(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timer = window.setTimeout(() => setSlow(true), 400);

    void (async () => {
      let result: SsoResultDto;
      try {
        result = await client.post<SsoResultDto>(ssoPaths.result(), undefined, { skipAuth: true });
      } catch (error) {
        result = {
          session: null,
          refusal: {
            code: error instanceof ApiError && error.status === 404 ? "expired" : "provider_failed",
            provider: null,
            company: null,
            email: null,
          },
        };
      }

      const { origin, next } = finishSsoFlow(result.session ? null : result.refusal);
      const session = result.session;
      if (!session) {
        window.location.replace(origin);
        return;
      }

      const user: AuthUser = {
        userId: session.userId,
        tenantId: session.tenantId ?? null,
        tenantMembershipId: session.tenantMembershipId ?? null,
        moduleEntitlements: session.moduleEntitlements ?? [],
        email: session.email,
        fullName: session.fullName,
        roles: session.roles ?? [],
        employeeId: session.employeeId ?? null,
        // The same session sign-in returns, typed more loosely on the shared refresh shape.
        accessProfiles: (session.accessProfiles ?? []) as AuthUser["accessProfiles"],
        effectivePermissions: (session.effectivePermissions ?? []) as AuthUser["effectivePermissions"],
        language: session.language,
        notificationPopups: session.notificationPopups,
        notificationSound: session.notificationSound,
      };
      persistAuth({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        accessTokenExpiration: session.accessTokenExpiration,
        user,
      });
      window.location.replace(resolvePostSignInDestination({ intendedDestination: next, user }) ?? "/");
    })().finally(() => window.clearTimeout(timer));
  }, []);

  return (
    <SignInFrame brand={null}>
      {slow ? (
        <div className="grid justify-items-center gap-4 text-center">
          <Spinner className="size-5" />
          <h1 className="type-page-title text-foreground">{t("signingIn")}</h1>
        </div>
      ) : null}
    </SignInFrame>
  );
}
