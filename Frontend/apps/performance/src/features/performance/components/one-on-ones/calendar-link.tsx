"use client";

import { useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { AsyncButton } from "@repo/ds/shell";
import { Copy } from "@repo/ds/icons";
import { useCalendarFeed, useCalendarFeedCommands } from "../../api/use-conversations";
import { reportPerformanceFailure } from "../../api/performance-failure";

/**
 * Every 1:1 reaches both people as a calendar invite (D-39); this is the personal link that keeps all of them in a
 * calendar app. The link shows once, when it's made; a new one replaces it and turning it off stops it.
 */
export function CalendarLink({ trigger }: { trigger: ReactElement }) {
  const t = useTranslations("oneOnOnes.CalendarLink");
  const feed = useCalendarFeed();
  const commands = useCalendarFeedCommands();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const on = url !== null || feed.data?.on === true;

  const make = async () => {
    try {
      const made = await commands.create.mutateAsync();
      setUrl(made.url);
      setCopied(false);
    } catch (error) {
      reportPerformanceFailure(error);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="grid w-[22rem] gap-3">
        <p className="type-label text-foreground">{t("title")}</p>
        {url ? (
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label={t("link")} onFocus={(event) => event.target.select()} className="h-8 flex-1 text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                setCopied(true);
              }}
            >
              <Copy className="size-4" data-icon="inline-start" />{copied ? t("copied") : t("copy")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{on ? t("on") : t("off")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <AsyncButton size="sm" variant={on ? "outline" : "default"} pending={commands.create.isLoading} onClick={() => void make()}>
            {on ? t("newLink") : t("getLink")}
          </AsyncButton>
          {on ? (
            <AsyncButton
              size="sm"
              variant="ghost"
              pending={commands.revoke.isLoading}
              onClick={() => commands.revoke.mutateAsync().then(() => setUrl(null), reportPerformanceFailure)}
            >
              {t("turnOff")}
            </AsyncButton>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
