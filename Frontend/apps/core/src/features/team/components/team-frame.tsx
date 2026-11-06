"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useAuth, canEnterPerformance, PageFailure } from "@repo/auth";
import { useTeamBand } from "@repo/api/query";
import { PageContainer, PageEmpty, TeamBand, TeamBandSkeleton } from "@repo/ds/shell";
import { Users } from "lucide-react";

export type TeamTab = "overview" | "orgChart";
export type TeamBandData = ReturnType<typeof useTeamBand>;

/**
 * The Team page (B-185, D-27): the band with the team as a small chart and the page's tabs, then the tab. Overview
 * and Org chart are Core HR's; Performance is Performance's own page under the same band (D-19).
 */
export function TeamFrame({ tab, children }: { tab: TeamTab; children: (band: TeamBandData) => ReactNode }) {
  const t = useTranslations("team");
  const { user } = useAuth();
  const performance = canEnterPerformance(user);
  const band = useTeamBand({ performance });
  const team = band.team;

  if (team.isLoading && !team.data) {
    return (
      <PageContainer width="wide" className="max-w-6xl pb-16">
        <TeamBandSkeleton />
      </PageContainer>
    );
  }
  if (!team.data) {
    return (
      <PageContainer width="wide" className="max-w-6xl pb-16">
        <PageFailure error={team.error} onRetry={() => void team.refetch()} />
      </PageContainer>
    );
  }

  const tabs = [
    { key: "overview" as const, href: "/team" },
    ...(performance ? [{ key: "performance" as const, href: "/performance/team", external: true }] : []),
    { key: "orgChart" as const, href: "/team/org-chart" },
  ];
  const { manager } = team.data;
  return (
    <PageContainer width="wide" className="max-w-6xl pb-16">
      <TeamBand
        manager={{ name: manager.displayName, jobTitle: manager.jobTitle, photo: band.managerPhoto }}
        people={band.members.map((person) => ({ ...person, href: `/people/${person.employeeKey}` }))}
        tabs={tabs}
        current={tab}
        praiseHref={performance && band.members.length > 0 ? "/performance/feedback?compose=praise" : undefined}
      />
      {band.members.length === 0 ? (
        <PageEmpty className="mt-8" icon={Users} title={t("noTeam")} />
      ) : (
        children(band)
      )}
    </PageContainer>
  );
}
