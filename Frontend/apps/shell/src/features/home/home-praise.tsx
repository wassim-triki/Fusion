"use client";

import { ChevronRight, HeartHandshake, Lightbulb, PartyPopper, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePraiseFeed, useReactToPraise } from "@repo/api/query";
import { resolveFusionAttentionModules, useAuth } from "@repo/auth";
import { Skeleton } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Section } from "@repo/ds/shell";
import { PraiseList, type PraiseReactionIcons } from "@repo/performance-ui";

/** The shell's own glyphs for praise reactions; the shared parts carry none. */
const REACTION_ICONS: PraiseReactionIcons = {
  Applause: <ThumbsUp />,
  Celebrate: <PartyPopper />,
  Insightful: <Lightbulb />,
  ThankYou: <HeartHandshake />,
};

const PRAISE_TAB = "/performance/feedback?tab=praise";

/**
 * The company's latest praise in the home's side column (D-14, D-31): the two newest as quoted boxes, praise to the
 * viewer marked, and the way to all of it. It's Performance's, so it shows only to people who can enter Performance, and a failure there
 * never touches the home.
 */
export function HomePraise() {
  const t = useTranslations("home.praise");
  const { user } = useAuth();
  const entitled = resolveFusionAttentionModules(user).includes("performance");
  const feed = usePraiseFeed({ scope: "all", limit: 2 }, { enabled: entitled && Boolean(user?.tenantId) });
  const react = useReactToPraise();
  if (!entitled) return null;

  return (
    <Section
      id="home-praise"
      title={t("title")}
      action={<Button asChild variant="ghost" size="sm"><a href={`${PRAISE_TAB}&compose=praise`}>{t("give")}</a></Button>}
    >
      {feed.error ? (
        <p className="type-body-secondary text-muted-foreground">{t("failed")}</p>
      ) : !feed.data ? (
        <div aria-label={t("loading")} className="space-y-3">
          <Skeleton className="h-28 w-full rounded-control" />
          <Skeleton className="h-28 w-full rounded-control" />
        </div>
      ) : (
        <PraiseList
          items={feed.data.items.slice(0, 2)}
          reactionIcons={REACTION_ICONS}
          quote
          viewerEmployeeId={user?.employeeId}
          onReact={(praise, kind, add) => react.mutate({ praiseId: praise.id, kind, add })}
          // Praise opens in Performance's drawer; it's another app, so this is a full navigation.
          onOpen={(praise) => window.location.assign(`${PRAISE_TAB}&praise=${praise.id}`)}
          empty={<p className="type-body-secondary text-muted-foreground">{t("empty")}</p>}
        />
      )}
      <a href={PRAISE_TAB} className="mt-3 inline-flex items-center gap-0.5 type-label font-semibold text-foreground hover:text-primary">
        {t("all")} <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
      </a>
    </Section>
  );
}
