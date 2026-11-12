"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageContainer, PageEmpty, TeamBand, TeamBandSkeleton } from "@repo/ds/shell";
import { useTeamBand } from "@repo/api/query";
import { PageFailure } from "@repo/auth";
import { ContentUnavailable } from "@/features/performance/components/content-unavailable";
import { TeamPeople, TeamTree } from "@/features/performance/components/team/team-year";
import { useObjectiveRecord } from "@/features/performance/components/objective-record/use-objective-record";
import { TeamWorkspaceSkeleton } from "@/shell/workspace-skeletons";
import { useCurrentCycle } from "@/features/performance/api/use-performance";
import { useWorkspaceContext } from "@/features/performance/api/use-workspace";

/**
 * The Team page's Performance tab (D-79): the shared band, then the team's goals under the manager's and each person's
 * year with the one thing due from the manager, answered in the row. The team is Core HR's (B-383).
 */
export default function TeamPerformancePage() {
  const t = useTranslations("team.TeamYear");
  const band = useTeamBand();
  const context = useWorkspaceContext();
  const detail = useCurrentCycle(Boolean(context.data));
  const record = useObjectiveRecord();
  const team = band.team.data;
  const year = band.perf.year;
  const cycle = detail.data?.cycle ?? null;
  const photos = useMemo(() => new Map(band.members.map((member) => [member.employeeId, member.photo])), [band.members]);

  if (context.isLoading || detail.isLoading || band.team.isLoading) return <TeamWorkspaceSkeleton />;
  if (context.error) return <ContentUnavailable error={context.error} onRetry={context.refetch} />;
  if (detail.error) return <ContentUnavailable error={detail.error} onRetry={detail.refetch} />;

  let body;
  if (!team || team.members.length === 0) body = <PageEmpty title={t("noReports")} />;
  else if (!cycle || cycle.state === "Draft") body = <PageEmpty title={t("noYear")} />;
  else if (year.error) body = <PageFailure error={year.error} onRetry={year.refetch} />;
  else if (!year.data) body = <div aria-busy className="h-72 animate-pulse rounded-surface bg-card" />;
  else {
    body = (
      <>
        <TeamTree year={year.data} onOpen={(objectiveId) => record.open({ cycleId: cycle.id, objectiveId })} />
        <TeamPeople year={year.data} photos={photos} cycleId={cycle.id} />
      </>
    );
  }

  return (
    <PageContainer width="wide" className="max-w-6xl pb-16">
      {team ? (
        <TeamBand
          manager={{ name: team.manager.displayName, jobTitle: team.manager.jobTitle, photo: band.managerPhoto }}
          people={band.members.map((person) => ({
            ...person,
            href: `/core/people/${encodeURIComponent(person.employeeKey)}?tab=performance`,
            external: true,
          }))}
          tabs={[
            { key: "overview", href: "/core/team", external: true },
            { key: "performance", href: "/team" },
            { key: "orgChart", href: "/core/team/org-chart", external: true },
          ]}
          current="performance"
          praiseHref={band.members.length > 0 ? "/performance/feedback?compose=praise" : undefined}
        />
      ) : (
        <TeamBandSkeleton />
      )}
      <div className="mt-[18px] grid gap-[18px]">{body}</div>
    </PageContainer>
  );
}
