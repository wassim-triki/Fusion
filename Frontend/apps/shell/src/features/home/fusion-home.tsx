"use client";

import { useLocale, useTranslations } from "next-intl";
import { useFusionUpcoming, useFusionWork, useMyManager, useTenantSummary } from "@repo/api/query";
import { canAccessCoreTeam, resolveFusionAttentionModules, useAuth } from "@repo/auth";
import { Skeleton } from "@repo/ds";
import {
  HomeAgenda,
  PageContainer,
  Section,
  WorkList,
  orderWork,
} from "@repo/ds/shell";
import { HomeSkeleton } from "./home-skeleton";
import { FirstWeekCard, YourManagerCard, YourTeamCard } from "./home-cards";
import { CompanyCard, SetupGuideCard, useHomeSetup } from "./setup-guide";
import { HomeDecision } from "./home-decision";
import { HomePeerInput, peerRequestId } from "./home-peer-input";
import { HomeWorkInPlace, answersInPlace } from "./home-work-in-place";
import { HomePraise } from "./home-praise";
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

/** "Friday 30 October · Carthage Digital Group" ("vendredi 30 octobre · …"): the day and the company (D-09, D-12). */
function DayLine({ now }: { now: Date }) {
  const locale = useLocale();
  const company = useTenantSummary().data?.name;
  return (
    <p className="type-body-secondary text-muted-foreground">
      {capitalized(dateFormatter(DAY, locale).format(now).replace(",", ""))}
      {company ? ` · ${company}` : ""}
    </p>
  );
}

/**
 * The work column, as drawn: Needs you (every module's work in the order things are due, yes-or-no answered in the row)
 * and Coming up (the next two weeks across modules), each one section with its title inside.
 */
function HomeWork({ quietWhenEmpty = false, work, upcoming }: {
  quietWhenEmpty?: boolean;
  work: ReturnType<typeof useFusionWork>;
  upcoming: ReturnType<typeof useFusionUpcoming>;
}) {
  const t = useTranslations("home");
  const today = new Date();
  const workBusy = work.modules.some((module) => module.status === "loading");
  const datesBusy = upcoming.modules.some((module) => module.status === "loading");
  // Beside the setup guide, empty lists say nothing: day one has no work yet.
  if (quietWhenEmpty && (workBusy || datesBusy || (work.items.length === 0 && upcoming.items.length === 0))) return null;

  return (
    <div className="space-y-6">
      <Section id="home-needs" title={t("needsYou")} meta={workBusy ? undefined : work.items.length} flush>
        <WorkList items={orderWork(work.items, today)} modules={work.modules} today={today} renderDecision={(item) => <HomeDecision item={item} />}
          renderInPlace={(item) => {
            if (answersInPlace(item)) return <HomeWorkInPlace item={item} />;
            const id = peerRequestId(item);
            if (!id) return null;
            // Opened from its notification (`/?peer={id}`), the request starts open.
            const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("peer");
            return <HomePeerInput item={item} initiallyOpen={asked === id} />;
          }} />
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
 * The Fusion home at the shell root (D-31, B-077), one page for every role (D-12): a greeting with the day and the
 * company, then the viewer's day. An administrator's Home opens on the company's setup guide (D-09) until it's done or
 * hidden, with the company and its people beside it; everyone else's side column is their team, year and praise.
 */
export function FusionHomeContent() {
  const t = useTranslations("home");
  const { user } = useAuth();
  const name = firstName(user?.fullName);
  const now = new Date();
  const modules = resolveFusionAttentionModules(user);
  const performance = modules.includes("performance");
  const work = useFusionWork(modules, { enabled: Boolean(user?.tenantId) });
  const upcoming = useFusionUpcoming(modules, { enabled: Boolean(user?.tenantId) });
  const team = canAccessCoreTeam(user) && Boolean(user?.employeeId);
  const setup = useHomeSetup();
  const manager = useMyManager();
  const showManager = Boolean(user?.employeeId && (manager.isLoading || manager.error || manager.data?.isFirstWeek));
  if (setup.guide.pending) return <HomeSkeleton />;
  return (
    <PageContainer className="space-y-8">
      <div className="space-y-2">
        <h1 className="type-display text-foreground">
          {name
            ? t("greetingNamed", { greeting: t(`greeting.${greeting(now)}`), name })
            : t(`greeting.${greeting(now)}`)}
        </h1>
        <DayLine now={now} />
      </div>
      {setup.show ? (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
            <SetupGuideCard guide={setup.guide} onHide={setup.hide} />
            <HomeWork work={work} upcoming={upcoming} quietWhenEmpty />
          </div>
          <aside aria-label={t("sideColumn")} className="space-y-5">
            <CompanyCard guide={setup.guide} />
          </aside>
        </div>
      ) : performance || team || showManager ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <FirstWeekCard />
            <HomeWork work={work} upcoming={upcoming} />
          </div>
          <aside aria-label={t("sideColumn")} className="space-y-6">
            {showManager ? <YourManagerCard query={manager} /> : null}
            {team ? <YourTeamCard /> : null}
            {performance ? <YourYear employeeId={user?.employeeId} enabled={performance} /> : null}
            {performance ? <HomePraise /> : null}
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <FirstWeekCard />
          <HomeWork work={work} upcoming={upcoming} />
        </div>
      )}
    </PageContainer>
  );
}
