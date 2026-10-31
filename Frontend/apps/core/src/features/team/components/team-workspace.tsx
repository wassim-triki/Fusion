"use client";

import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@repo/auth";
import { useOrgChartAccess } from "@/features/org-chart/api/use-org-chart-access";
import {
  PageContainer,
  PageHeader,
  PageEmpty,
  PageError,
  Section,
  StatusBadge,
} from "@repo/ds/shell";
import { Button } from "@repo/ds";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamPageSkeleton } from "@/shell/route-skeletons";
import { canAccessTeamWorkspace } from "@/lib/employee-roster-access";
import { ComingUpCard } from "@/features/people/changes/coming-up";
import { useUpcomingChanges } from "@/features/people/changes/use-changes";
import {
  useEmployeeDetailsById,
  useEmployeeReportingLines,
} from "@/features/people/api/use-employees";

/** What is coming in the manager's branch: who joins, leaves or moves in and out. Read only; absent when nothing is. */
function TeamComingUp() {
  const t = useTranslations("changes.coming");
  const upcoming = useUpcomingChanges();
  if (!upcoming.data?.length) return null;
  return (
    <Section id="team-coming-up" title={t("title")}>
      <div className="grid gap-2.5">
      {upcoming.data.map((change) => (
        <ComingUpCard
          key={change.id}
          change={change}
          canChange={false}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/people/${change.person.employeeKey}`}>{t("view")}</Link>
            </Button>
          }
        />
      ))}
      </div>
    </Section>
  );
}

export default function TeamWorkspace() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const orgChart = useOrgChartAccess();
  const t = useTranslations("team");
  const employeeId = user?.employeeId ?? null;
  const canAccess = canAccessTeamWorkspace(user);

  // Reporting lines are keyed by the stable employee key, not the raw employee id
  // (the auth token carries the GUID). Resolve the details record first to obtain
  // the stable key, exactly as the self-profile page does.
  const { data: details, error: detailsError, isLoading: isDetailsLoading } =
    useEmployeeDetailsById(canAccess ? employeeId : null);
  const stableEmployeeKey = details?.stableEmployeeKey ?? null;
  const {
    data,
    error: reportingError,
    isLoading: isReportingLoading,
    isFetching,
    refetch,
  } = useEmployeeReportingLines(stableEmployeeKey);

  const error = detailsError ?? reportingError;
  const directReports = data?.directReports ?? [];

  // A linked employee can always fall back to their own profile; an unlinked
  // admin falls back to the Core overview.
  const exitHref = employeeId ? "/profile" : "/";
  const exitLabel = employeeId ? t("goToProfile") : t("goToOverview");

  if (isAuthLoading) {
    return <TeamPageSkeleton />;
  }

  if (!canAccess || !employeeId) {
    return (
      <PageContainer className="space-y-6">
        <PageHeader title={t("title")} description={t("description")} />
        <PageEmpty
          icon={Users}
          title={t("noTeam.title")}
          description={t("noTeam.description")}
          action={
            <Link
              href={exitHref}
              className="text-sm font-medium text-primary-ink hover:underline"
            >
              {exitLabel}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if ((isDetailsLoading || isReportingLoading) && !data && !error) {
    return <TeamPageSkeleton />;
  }

  if (error && !data) {
    return (
      <PageContainer className="space-y-6">
        <PageHeader title={t("title")} description={t("description")} />
        <PageError
          title={t("error.title")}
          description={t("error.description")}
          onRetry={() => refetch()}
        />
        <div className="text-center">
          <Link
            href={exitHref}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {exitLabel}
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          orgChart.canSee ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/org-chart">{t("showInChart")}</Link>
            </Button>
          ) : undefined
        }
      />

      <TeamComingUp />

      <Card>
        <CardHeader density="compact">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle>{t("directReports")}</CardTitle>
            <StatusBadge tone="neutral">
              {t("count", { count: directReports.length })}
            </StatusBadge>
          </div>
        </CardHeader>
        <CardContent>
          {directReports.length === 0 && !isFetching ? (
            <PageEmpty
              icon={Users}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {directReports.map(({ employee }) => (
                <Link
                  key={employee.id}
                  href={`/people/${employee.stableEmployeeKey}`}
                  className="group rounded-surface border bg-inlay p-4 transition-colors hover:border-primary/40 hover:bg-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-medium">
                        {employee.firstName} {employee.lastName}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {employee.email}
                      </p>
                      {employee.jobTitle ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {employee.jobTitle}
                        </p>
                      ) : null}
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
