"use client";

import { useLocale, useTranslations } from "next-intl";
import { FUSION_ATTENTION_MODULES } from "@repo/api";
import { useFusionUpcoming, useFusionWork, useMyCard } from "@repo/api/query";
import { resolveFusionAttentionModules, TopBarPreferences, TopBarSearch, useAuth, ViewingAsBar } from "@repo/auth";
import { Skeleton } from "@repo/ds";
import {
  AppShell,
  HomeAgenda,
  LeadFocus,
  PageContainer,
  ThemeProvider,
  TopBar,
  WorkList,
  selectLead,
} from "@repo/ds/shell";
import { FusionSidebar } from "./fusion-sidebar";
import { HomeDecision } from "./home-decision";
import { HomePraise } from "./home-praise";
import { ShellNotificationBell } from "./shell-notification-bell";
import { YourYear } from "./your-year";
import { dateFormatter } from "@repo/ds/lib/dates";

function greeting(now: Date): "morning" | "afternoon" | "evening" {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function firstName(fullName: string | undefined): string | null {
  return fullName?.trim().split(/\s+/)[0] || null;
}

const DAY = { weekday: "long", day: "numeric", month: "long" } as const;

/** French writes weekdays in lower case; the day line starts the line, so it starts with a capital. */
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * "Tuesday 20 October · QA Automation Engineer, Consulting A" ("mardi 20 octobre · …"): the day, and the job and unit
 * when Core HR has them.
 */
function DayLine({ now }: { now: Date }) {
  const locale = useLocale();
  const card = useMyCard();
  const job = [card.data?.jobTitle, card.data?.orgUnitName].filter(Boolean).join(", ");
  return (
    <p className="type-body-secondary text-muted-foreground">
      {capitalized(dateFormatter(DAY, locale).format(now).replace(",", ""))}
      {job ? ` · ${job}` : ""}
    </p>
  );
}

const labelOf = (key: string) => FUSION_ATTENTION_MODULES.find((module) => module.key === key)?.label ?? key;

/**
 * The work column: the one thing that matters most (or, with no work, what's next), everything else that needs the
 * person, and their next two weeks across modules.
 */
export function HomeWork() {
  const t = useTranslations("home");
  const { user } = useAuth();
  const modules = resolveFusionAttentionModules(user);
  const enabled = Boolean(user?.tenantId);
  const work = useFusionWork(modules, { enabled });
  const upcoming = useFusionUpcoming(modules, { enabled });
  const today = new Date();
  // A yes or no is answered in its row, never as the one big thing on top.
  const lead = selectLead(work.items.filter((item) => !item.decision), upcoming.items, today);
  const rest = lead?.kind === "work" ? work.items.filter((item) => item.id !== lead.item.id) : work.items;
  const workBusy = work.modules.some((module) => module.status === "loading");
  const datesBusy = upcoming.modules.some((module) => module.status === "loading");

  return (
    <div className="space-y-10">
      {(workBusy || (!lead && datesBusy)) && lead?.kind !== "work" ? (
        <Skeleton aria-label={t("loadingWork")} className="h-36 w-full rounded-surface" />
      ) : (
        <LeadFocus lead={lead} moduleLabel={labelOf} today={today} />
      )}

      {rest.length > 0 || work.failedModules.length > 0 || (workBusy && lead?.kind === "work") ? (
        <section aria-labelledby="home-work-heading" className="space-y-3">
          <h2 id="home-work-heading" className="type-section-title text-foreground">
            {t("alsoNeedsYou")}
          </h2>
          <WorkList items={rest} modules={work.modules} today={today} renderDecision={(item) => <HomeDecision item={item} />} />
        </section>
      ) : null}

      <section aria-labelledby="home-agenda-heading" className="space-y-3">
        <h2 id="home-agenda-heading" className="type-section-title text-foreground">
          {t("nextTwoWeeks")}
        </h2>
        {datesBusy && upcoming.items.length === 0 ? (
          <Skeleton aria-label={t("loadingNextTwoWeeks")} className="h-24 w-full rounded-surface" />
        ) : (
          <HomeAgenda work={work.items} moments={upcoming.items} lead={lead} modules={upcoming.modules} today={today} />
        )}
      </section>
    </div>
  );
}

/**
 * The Fusion home at the shell root (D-31, B-077): the frame, a greeting with the day and the person's job, the work
 * column, and a side column with their year and the company's praise. Without Performance there's no second job, so
 * the work sits in one column.
 */
export function FusionHome() {
  const t = useTranslations("home");
  const { user } = useAuth();
  const name = firstName(user?.fullName);
  const now = new Date();
  const performance = resolveFusionAttentionModules(user).includes("performance");
  return (
    <ThemeProvider>
      <AppShell
        sidebar={<FusionSidebar />}
        notice={<ViewingAsBar />}
        header={
          <TopBar>
            <TopBarSearch />
            <ShellNotificationBell />
          <TopBarPreferences />
          </TopBar>
        }
      >
        <PageContainer className="space-y-8">
          <div className="space-y-2">
            <h1 className="type-display text-foreground">
              {name
                ? t("greetingNamed", { greeting: t(`greeting.${greeting(now)}`), name })
                : t(`greeting.${greeting(now)}`)}
            </h1>
            <DayLine now={now} />
          </div>
          {performance ? (
            <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_352px]">
              <HomeWork />
              <aside aria-label={t("sideColumn")} className="space-y-10">
                <YourYear employeeId={user?.employeeId} enabled={performance} />
                <HomePraise />
              </aside>
            </div>
          ) : (
            <HomeWork />
          )}
        </PageContainer>
      </AppShell>
    </ThemeProvider>
  );
}
