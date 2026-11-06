"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";

/** A failure's code, for someone to copy and send to their administrator. */
export function ReferenceCode({ code }: { code: string }) {
  const t = useTranslations("ds.states");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1100);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={t("copyCode")}
      className="inline-flex items-center gap-2 rounded-inset border border-border px-2.5 py-1 font-mono text-xs font-medium text-muted-foreground transition-colors hover:border-input hover:text-foreground"
    >
      {copied ? t("copied") : code}
      {copied ? null : <Copy aria-hidden className="size-3" />}
    </button>
  );
}
