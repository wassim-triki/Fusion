"use client";

import { PageFailure } from "@repo/auth";
import { useTranslations } from "next-intl";

const LISTS = { reviews: "/performance/reviews", oneOnOnes: "/performance/one-on-ones", feedback: "/performance/feedback" } as const;

/**
 * A Performance content region that didn't load, inside the module frame. A record's page names the `list` it belongs
 * to, where its link goes when the record is gone.
 */
export function ContentUnavailable({
  error,
  onRetry,
  list,
  size,
  title,
}: {
  error: Error;
  onRetry: () => unknown;
  list?: keyof typeof LISTS;
  size?: "card";
  title?: string;
}) {
  const nav = useTranslations("common.nav");
  return (
    <PageFailure
      error={error}
      onRetry={onRetry}
      size={size}
      title={title}
      back={list ? { href: LISTS[list], label: nav(list) } : undefined}
    />
  );
}
