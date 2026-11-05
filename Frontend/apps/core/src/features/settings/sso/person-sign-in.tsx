"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createPlatformApiClient, ssoPaths } from "@repo/api";
import { ProviderMark } from "@repo/auth";
import { Button } from "@repo/ds";
import { useSsoLinks, useSsoSettings } from "./use-sso";

/**
 * Person › Access › Signs in with (B-191): the provider links on the person's account. An administrator can remove
 * one, for a mailbox that changed hands. Shown only to those Identity lets read them.
 */
export function PersonSignInLinks({ userId }: { userId: string | null | undefined }) {
  const t = useTranslations("profile.fusionAccess");
  const links = useSsoLinks(userId);
  const settings = useSsoSettings(Boolean(userId));
  const [removing, setRemoving] = useState<string | null>(null);
  if (!userId || links.error || !links.data) return null;

  const canRemove = settings.data?.canManage === true;
  const remove = async (linkId: string) => {
    setRemoving(linkId);
    try {
      await createPlatformApiClient().delete(ssoPaths.link(linkId));
      await links.refetch();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="min-w-0">
      <dt className="type-label text-muted-foreground">{t("signsInWith")}</dt>
      <dd className="mt-1 grid gap-2">
        {links.data.length === 0 ? <p className="type-body text-muted-foreground">{t("passwordOnly")}</p> : null}
        {links.data.map((link) => (
          <div key={link.id} className="flex items-center gap-2.5">
            <ProviderMark provider={link.provider} label={link.label} />
            <span className="min-w-0 flex-1">
              <span className="block truncate type-body text-foreground">{link.label}</span>
              <span className="block truncate type-meta text-muted-foreground">{link.email}</span>
            </span>
            {canRemove ? (
              <Button size="sm" variant="ghost" disabled={removing === link.id} onClick={() => void remove(link.id)}>
                {t("removeLink")}
              </Button>
            ) : null}
          </div>
        ))}
      </dd>
    </div>
  );
}
