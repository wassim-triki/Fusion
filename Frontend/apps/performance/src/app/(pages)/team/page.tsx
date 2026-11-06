"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageContainer, Section, TeamBand, TeamBandSkeleton } from "@repo/ds/shell";
import { useTeamBand } from "@repo/api/query";
import { Button } from "@repo/ds/components/ui/button";
import { ArrowRight, Users } from "@/lib/icons";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { TeamDirection } from "@/features/performance/components/team/team-direction";
import { TeamWorkspaceSkeleton } from "@/shell/workspace-skeletons";
import type { YourPeopleQuery } from "@repo/api";
import {
  DEFAULT_PEOPLE_QUERY,
  YourPeople,
  leadAction,
} from "@/features/performance/components/team/your-people";
import { TeamResultsPanel, TeamSummary, teamSubtitle } from "@/features/performance/components/team/team-summary";
import { useCurrentCycle, useTeamResults, useYourPeople } from "@/features/performance/api/use-performance";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import { useFormat } from "@repo/ds/lib/use-format";

/**
 * The Team page's Performance tab (B-185, D-19): the shared band over My Team, unchanged inside. Overview and Org chart
 * are Core HR's tabs, a full navigation away.
 */
export default function TeamPerformancePage() {
  const band = useTeamBand();
  const context = useWorkspaceContext();
  const detail = useCurrentCycle(Boolean(context.data));
  const team = band.team.data;
  if (context.isLoading || detail.isLoading) return <TeamWorkspaceSkeleton />;
  return (
    <PageContainer width="wide" className="max-w-6xl pb-16">
      {team ? (
        <TeamBand
          manager={{ name: team.manager.displayName, jobTitle: team.manager.jobTitle, photo: band.managerPhoto }}
          people={band.members.map((person) => ({ ...person, href: `/people/${person.employeeId}` }))}
          tabs={[
            { key: "overview", href: "/core/team", external: true },
            { key: "performance", href: "/team" },
            { key: "orgChart", href: "/core/team/org-chart", external: true },
          ]}
          current="performance"
          praiseHref={band.members.length > 0 ? "/performance/feedback?compose=praise" : undefined}
        />
      ) : band.team.isLoading ? (
        <TeamBandSkeleton />
      ) : null}
      <div className="mt-8">
        <MyTeam context={context} detail={detail} />
      </div>
    </PageContainer>
  );
}

/**
 * My Team: the people the user is the recorded reviewer of in the selected Cycle, grouped by what needs them in
 * the phase, with the phase's facts above. Once a round's results are released, the team's results lead the page.
 * Team objectives follow while plans are made and executed.
 */
function MyTeam({ context, detail }: { context: ReturnType<typeof useWorkspaceContext>; detail: ReturnType<typeof useCurrentCycle> }) {
  const t = useTranslations("team.MyTeamPage");
  const peopleWords = useSay("team.people");
  const summaryWords = useSay("team.summary");
  const format = useFormat();
  const canReview = context.data?.destinations.team ?? false;
  // The organization-direction link is offered only to actors who can enter that workspace.
  const canViewOrgDirection = context.data?.capabilities.canViewOrgDirection ?? false;

  const cycle = detail.data?.cycle ?? null;
  // Overview's "Review plans" lands here already on the view that needs the manager.
  const opensOnReview = useSearchParams().get("view") === "needs-review";
  const [peopleQuery, setPeopleQuery] = useState<YourPeopleQuery>(() =>
    opensOnReview ? { ...DEFAULT_PEOPLE_QUERY, filter: "NeedsReview" } : DEFAULT_PEOPLE_QUERY
  );
  const people = useYourPeople(cycle?.id ?? null, peopleQuery, canReview);
  const phase = people.data?.phase;
  const results = useTeamResults(cycle?.id ?? null, canReview && (phase === "Review" || phase === "Closed"));
  // The plan filter only exists in Planning and Execution: a link's filter must not keep applying, hidden, in a round.
  const filterHidden = phase !== undefined && phase !== "Planning" && phase !== "Execution";
  useEffect(() => {
    if (filterHidden && peopleQuery.filter !== DEFAULT_PEOPLE_QUERY.filter) setPeopleQuery((query) => ({ ...query, filter: DEFAULT_PEOPLE_QUERY.filter }));
  }, [filterHidden, peopleQuery.filter]);

  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (detail.error) return <ContentUnavailable error={detail.error} onRetry={detail.refetch} />;
  if (!canReview || !cycle) return <NoReports cycleName={cycle?.name ?? null} />;

  const lead = cycle ? leadAction(cycle.id, people.data, peopleWords) : null;
  const showObjectives = phase === "Planning" || phase === "Execution";

  return (
    <div className="space-y-8">
      <Section
        title={t("yourPeople")}
        meta={people.data ? teamSubtitle(people.data, summaryWords, format.locale) : undefined}
        action={
          lead ? (
            <Button asChild size="sm">
              <Link href={lead.href}>
                {lead.label}
                <ArrowRight className="size-4" data-icon="inline-end" aria-hidden />
              </Link>
            </Button>
          ) : null
        }
      >
        <div className="space-y-6">
          {people.data ? <TeamSummary data={people.data} /> : null}
          <YourPeople cycleId={cycle.id} people={people} query={peopleQuery} onQueryChange={setPeopleQuery} />
        </div>
      </Section>
      {results.data ? <TeamResultsPanel results={results.data} /> : null}
      {showObjectives ? <TeamDirection cycle={cycle} canViewOrgDirection={canViewOrgDirection} /> : null}
    </div>
  );
}

/** An old link or bookmark without responsibility in this cycle: say so and lead back to Overview. */
function NoReports({ cycleName }: { cycleName: string | null }) {
  const t = useTranslations("team.NoReports");
  return (
    <>
      <div className="flex flex-col items-center rounded-surface bg-card px-6 py-16 text-center ring-1 ring-inset ring-border">
        <Users className="size-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 type-section-title text-foreground">
          {cycleName ? t("noOneReportsToYou", { cycleName }) : t("noOneReportsToYou2")}
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/">{t("goToOverview")}</Link>
        </Button>
      </div>
    </>
  );
}
