"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { createPlatformApiClient, fusionAttentionQueryKeys, getFusionAttentionModule, type FusionAttentionModuleKey } from "@repo/api";
import { Button, Textarea } from "@repo/ds";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import type { WorkListItem } from "@repo/ds/shell";

/**
 * Approve or decline in place (D-12, D-15): one click says yes; no asks for a reason first. The item leaves Needs you
 * once its module answers.
 */
export function HomeDecision({ item }: { item: WorkListItem }) {
  const t = useTranslations("home.decision");
  const client = useMemo(() => createPlatformApiClient(), []);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!item.decision) return null;
  const base = getFusionAttentionModule(item.module as FusionAttentionModuleKey).apiBase;

  // Done means the row leaves Needs you; a refusal (someone answered first, the person changed) shows beside it.
  const send = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      await client.post(`${base}${path}`, body);
      setAsking(false);
      await queryClient.invalidateQueries({ queryKey: fusionAttentionQueryKeys.all() });
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {error ? <span role="alert" className="max-w-56 truncate type-meta text-destructive" title={error}>{error}</span> : null}
      <Popover open={asking} onOpenChange={setAsking}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="ghost" disabled={busy}>{t("decline")}</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid w-80 gap-2.5">
          <label htmlFor={`why-${item.id}`} className="type-label font-semibold">{t("why")}</label>
          <Textarea id={`why-${item.id}`} autoFocus rows={3} maxLength={500} value={why} onChange={(event) => setWhy(event.target.value)}
            placeholder={t("whyPlaceholder")} className="resize-none" />
          <Button type="button" variant="destructive" className="justify-self-end" disabled={!why.trim() || busy}
            onClick={() => void send(item.decision!.declinePath, { reason: why.trim() })}>
            {t("decline")}
          </Button>
        </PopoverContent>
      </Popover>
      <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={() => void send(item.decision!.approvePath, {})}>
        {t("approve")}
      </Button>
    </div>
  );
}
