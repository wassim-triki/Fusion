"use client";

import { useLocale, useTranslations } from "next-intl";
import { useFusionUpcoming, useFusionWork, useMyCard } from "@repo/api/query";
import { resolveFusionAttentionModules, TopBarPreferences, TopBarSearch, useAuth, ViewingAsBar } from "@repo/auth";
import { Skeleton } from "@repo/ds";
import {
  AppShell,
  HomeAgenda,
  PageContainer,
  Section,
  ThemeProvider,
  TopBar,
  WorkList,
  orderWork,
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

/**
 * The work column, as drawn: Needs you (every module's work in the order things are due, yes-or-no answered in the row)
 * and Coming up (the next two weeks across modules), each one section with its title inside.
 */
export function HomeWork() {
  const t = useTranslations("home");
  const { user } = useAuth();
  const modules = resolveFusionAttentionModules(user);
  const enabled = Boolean(user?.tenantId);
  const work = useFusionWork(modules, { enabled });
  const upcoming = useFusionUpcoming(modules, { enabled });
  const today = new Date();
  const workBusy = work.modules.some((module) => module.status === "loading");
  const datesBusy = upcoming.modules.some((module) => module.status === "loading");

  return (
    <div className="space-y-6">
      <Section id="home-needs" title={t("needsYou")} meta={workBusy ? undefined : work.items.length} flush>
        <WorkList items={orderWork(work.items, today)} modules={work.modules} today={today} renderDecision={(item) => <HomeDecision item={item} />} />
      </Section>
      <Section id="home-coming" title={t("comingUp")} meta={t("nextTwoWeeks")} flush>
        {datesBusy && upcoming.items.length === 0 ? (
          <div aria-label={t("loadingNextTwoWeeks")} className="space-y-3 px-5 py-4">
            <Skeleton className="h-12 w-full rounded-control" />
            <Skeleton className="h-12 w-full rounded-control" />
          </div>
        ) : (
          <HomeAgenda moments={upcoming.items} modules={upcoming.modules} today={today} />
        )}
      </Section>
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
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <HomeWork />
              <aside aria-label={t("sideColumn")} className="space-y-6">
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
