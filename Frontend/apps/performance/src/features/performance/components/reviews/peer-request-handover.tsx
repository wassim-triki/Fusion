"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageSkeleton } from "@repo/ds/shell";

/**
 * A peer answers on Home, in place (D-74). Links to a request (the bell, an email) land here and hand over to Home with
 * that request open; Home sits outside this app, so the hand-over is a full navigation.
 */
export function PeerRequestHandover() {
  const t = useTranslations("reviews.Handover");
  const { requestId } = useParams<{ requestId: string }>();
  useEffect(() => {
    window.location.replace(`/?peer=${encodeURIComponent(requestId)}`);
  }, [requestId]);
  return <PageSkeleton rows={2} label={t("openingOnHome")} />;
}
