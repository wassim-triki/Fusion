"use client";

import { ADMINISTRATORS_PATH } from "@/features/settings/roles/paths";
import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CircleAlert,
  ClipboardList,
  Gauge,
  Network,
  PartyPopper,
  Plus,
  Settings2,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import {
  canAccessCoreOverview,
  canAccessCoreAccess,
  canAccessCoreSettings,
  canManageCoreAccessProfiles,
  canViewTenantAdministration,
  type AuthUser,
  useAuth,
} from "@repo/auth";
import {
  PageContainer,
  PageHeader,
  PageLoading,
  PagePermissionNotice,
  KpiStat,
  KpiGrid,
  DashboardPanel,
  DashboardSection,
  DonutChart,
  BarChartMini,
  ColumnChart,
  ProgressMeter,
  CHART_TONES,
  CHART_PALETTE,
  type DonutDatum,
} from "@repo/ds/shell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  canAccessEmployeeRoster,
  canAccessSelfEmployeeProfile,
  canAccessTeamWorkspace,
} from "@/lib/employee-roster-access";
import { OverviewPageSkeleton } from "@/shell/route-skeletons";
import {
  useEmployeeRoster,
  useWorkforceReadinessSummary,
} from "@/features/people/api/use-employees";
import {
  useWorkforceMe,
  useWorkforceTeam,
  type WorkforceMeContext,
} from "@/features/overview/api/use-workforce-me";
import type { EmployeeRosterItem } from "@/features/people/api/employee-roster.types";
import { formatDateParts } from "@repo/ds/lib/dates";
import { useFormat, type Format } from "@repo/ds/lib/use-format";
import { useTranslations } from "next-intl";
import { useStatusWord } from "@/i18n/words";

// ── Shared helpers ──────────────────────────────────────────────────────────

type HrefFn = (href: string) => string;

type OverviewWords = ReturnType<typeof useTranslations<"overview">>;

function formatCompactDate(value: string, format: Format, unavailable: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return unavailable;
  return format.parts(parsed, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getNewHireLabel(hireDate: string, t: OverviewWords) {
  const parsed = new Date(hireDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffInDays = Math.ceil(
    (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (diffInDays > 0) {
    return diffInDays === 1 ? t("startsTomorrow") : t("startsIn", { count: diffInDays });
  }
  if (diffInDays >= -30) {
    const days = Math.abs(diffInDays);
    return days <= 1 ? t("startedRecently") : t("startedAgo", { count: days });
  }
  return null;
}

// Shared with the route loading boundary and guard hold (route-skeletons.tsx)
// so every loading surface for "/" renders the identical skeleton.
const LoadingSkeleton = OverviewPageSkeleton;

function QuickLink({ href, icon: Icon, children }: { href: string; icon: typeof Plus; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-muted/10"
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1">{children}</span>
      <ArrowRight className="size-3.5 text-muted-foreground/50" />
    </Link>
  );
}

// ── Workforce dashboard (HR admin + platform-admin tenant context) ──────────

const TENURE_BUCKETS = [
  { name: "underOne", min: 0, max: 1 },
  { name: "oneToThree", min: 1, max: 3 },
  { name: "threeToFive", min: 3, max: 5 },
  { name: "fivePlus", min: 5, max: Infinity },
] as const;

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildWorkforceAnalytics(items: EmployeeRosterItem[], t: OverviewWords, unassigned: string, locale: string) {
  const now = new Date();
  const today = startOfToday();
  const dept = new Map<string, number>();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, name: formatDateParts(d, { month: "short" }, undefined, locale), value: 0 };
  });
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  const tenure = TENURE_BUCKETS.map((b) => ({ name: t(`tenure.${b.name}`), value: 0 }));
  let managers = 0;
  let newHires90 = 0;

  for (const e of items) {
    dept.set(e.orgUnitName?.trim() || unassigned, (dept.get(e.orgUnitName?.trim() || unassigned) ?? 0) + 1);
    if (e.directReportCount > 0) managers++;
    const hire = new Date(e.hireDate);
    if (Number.isNaN(hire.getTime())) continue;
    const mi = monthIndex.get(`${hire.getFullYear()}-${hire.getMonth()}`);
    const month = mi !== undefined ? months[mi] : undefined;
    if (month) month.value++;
    const days = (Date.now() - hire.getTime()) / 86_400_000;
    if (days >= 0 && days <= 90) newHires90++;
    const years = days / 365.25;
    if (years >= 0) {
      const bi = TENURE_BUCKETS.findIndex((b) => years >= b.min && years < b.max);
      const bucket = bi >= 0 ? tenure[bi] : undefined;
      if (bucket) bucket.value++;
    }
  }

  const byDept = [...dept.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);

  const attention = items
    .filter((e) => e.readiness.hasEmployeeStateIssues)
    .map((e) => {
      const issues = e.readiness.employeeStateIssues.map((i) => ({
        label: i.label,
        blocker: i.severity === "Blocker",
      }));
      return { employee: e, blocking: issues.some((i) => i.blocker), issues };
    })
    .sort((a, b) => Number(b.blocking) - Number(a.blocking))
    .slice(0, 6);

  const anniversaries = items
    .map((e) => {
      const hire = new Date(e.hireDate);
      if (Number.isNaN(hire.getTime())) return null;
      let next = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
      if (next < today) next = new Date(now.getFullYear() + 1, hire.getMonth(), hire.getDate());
      const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
      const years = next.getFullYear() - hire.getFullYear();
      if (days < 0 || days > 45 || years < 1) return null;
      return { employee: e, years, days, dateLabel: formatDateParts(next, { day: "numeric", month: "short" }, undefined, locale) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  return { byDept, hiringTrend: months, tenure, managers, newHires90, attention, anniversaries };
}

function WorkforceDashboard({
  title,
  description,
  actions,
  toHref,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  toHref: HrefFn;
}) {
  const { data: rs, isLoading: isRsLoading } = useWorkforceReadinessSummary();
  const { data: roster, isLoading: isRosterLoading } = useEmployeeRoster({
    sortBy: "HireDate",
    sortDir: "Desc",
    page: 1,
    pageSize: 200,
  });

  const t = useTranslations("overview");
  const common = useTranslations("common");
  const format = useFormat();
  const items: EmployeeRosterItem[] = useMemo(() => roster?.items ?? [], [roster]);
  const analytics = useMemo(
    () => buildWorkforceAnalytics(items, t, common("unassigned"), format.locale),
    [items, t, common, format.locale]
  );
  const totalWorkforce = roster?.totalCount ?? items.length;
  const active = rs?.activeEmployeeCount ?? 0;
  const inactive = Math.max(totalWorkforce - active, 0);
  const readyCount = rs?.readyEmployeeCount ?? 0;
  const readinessPct = active > 0 ? Math.round((readyCount / active) * 100) : 0;
  const needsAttention = rs?.employeesNeedingAttention ?? 0;
  const recentHires = items.slice(0, 5);
  const compositionData: DonutDatum[] = [
    { name: t("admin.active"), value: active, color: CHART_TONES.success },
    { name: t("admin.inactive"), value: inactive, color: CHART_TONES.muted },
  ];

  if ((isRsLoading && !rs) || (isRosterLoading && !roster)) {
    return <LoadingSkeleton />;
  }

  return (
    <PageContainer width="wide" className="space-y-5">
      <PageHeader title={title} description={description} actions={actions} />

      <KpiGrid>
        <KpiStat
          label={t("admin.activeHeadcount")}
          value={active}
          icon={Users}
          hint={t("admin.activeHint", { total: totalWorkforce, inactive })}
          href={toHref("/people?status=Active")}
        />
        <KpiStat
          label={t("admin.readiness")}
          value={format.percent(readinessPct / 100)}
          tone={readinessPct >= 90 ? "success" : readinessPct >= 70 ? "warning" : "danger"}
          icon={Gauge}
          hint={t("admin.readinessHint", { ready: readyCount, active })}
          href={toHref("/people")}
        />
        <KpiStat
          label={t("admin.needsAttention")}
          value={needsAttention}
          tone={needsAttention > 0 ? "warning" : "success"}
          icon={TriangleAlert}
          hint={needsAttention > 0 ? t("admin.attentionHint") : t("admin.healthyHint")}
          href={toHref("/people")}
        />
        <KpiStat
          label={t("admin.newHires")}
          value={analytics.newHires90}
          icon={TrendingUp}
          hint={t("admin.managersHint", { count: analytics.managers })}
          href={toHref("/people")}
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel className="lg:col-span-2">
          <DashboardSection
            title={t("admin.byDepartment")}
            description={t("admin.byDepartmentDescription")}
            action={
              <Link
                href={toHref("/organization")}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:text-primary/80"
              >
                {t("admin.organization")} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            {analytics.byDept.length > 0 ? (
              <BarChartMini
                data={analytics.byDept}
                height={Math.max(170, analytics.byDept.length * 30)}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("admin.noUnits")}</p>
            )}
          </DashboardSection>
        </DashboardPanel>

        <DashboardPanel>
          <DashboardSection title={t("admin.composition")} description={t("admin.compositionDescription")}>
            <DonutChart centerLabel={t("admin.people")} total={totalWorkforce} data={compositionData} />
            <div className="mt-4">
              <ProgressMeter
                label={t("admin.recordsReady")}
                value={readinessPct}
                valueLabel={format.percent(readinessPct / 100)}
                tone={readinessPct >= 90 ? CHART_TONES.success : CHART_TONES.warning}
              />
            </div>
          </DashboardSection>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel className="lg:col-span-2">
          <DashboardSection title={t("admin.hiringTrend")} description={t("admin.hiringTrendDescription")}>
            <ColumnChart data={analytics.hiringTrend} />
          </DashboardSection>
        </DashboardPanel>

        <DashboardPanel>
          <DashboardSection title={t("admin.tenure")} description={t("admin.tenureDescription")}>
            <BarChartMini data={analytics.tenure} height={170} color={CHART_PALETTE[2]} />
          </DashboardSection>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel className="lg:col-span-2">
          <DashboardSection
            title={t("admin.attention")}
            description={t("admin.attentionDescription")}
            action={
              <Link
                href={toHref("/people")}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:text-primary/80"
              >
                {t("admin.reviewAll")} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            {analytics.attention.length > 0 ? (
              <ul className="divide-y divide-border">
                {analytics.attention.map(({ employee, blocking, issues }) => (
                  <li key={employee.id}>
                    <Link
                      href={toHref(`/people/${employee.stableEmployeeKey}`)}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary-ink"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {blocking ? (
                          <TriangleAlert className="size-4 shrink-0 text-destructive" />
                        ) : (
                          <CircleAlert className="size-4 shrink-0 text-primary-ink" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {employee.firstName} {employee.lastName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {employee.jobTitle || employee.orgUnitName || employee.email}
                          </span>
                        </span>
                      </span>
                      <span className="hidden shrink-0 flex-wrap items-center justify-end gap-1 sm:flex">
                        {issues.slice(0, 2).map((iss, idx) => (
                          <span
                            key={idx}
                            className={
                              iss.blocker
                                ? "rounded-detail bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive"
                                : "rounded-detail bg-primary-tint px-1.5 py-0.5 text-[11px] font-medium text-primary-ink"
                            }
                          >
                            {iss.label}
                          </span>
                        ))}
                        {issues.length > 2 ? (
                          <span className="text-[11px] text-muted-foreground">+{issues.length - 2}</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-surface border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                <UserCheck className="size-5 text-emerald-600" />
                {t("admin.allHealthy")}
              </div>
            )}
          </DashboardSection>
        </DashboardPanel>

        <DashboardPanel>
          <DashboardSection
            title={t("admin.anniversaries")}
            description={t("admin.anniversariesDescription")}
          >
            {analytics.anniversaries.length > 0 ? (
              <ul className="divide-y divide-border">
                {analytics.anniversaries.map(({ employee, years, dateLabel }) => (
                  <li
                    key={employee.id}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PartyPopper className="size-4 shrink-0 text-primary-ink" />
                      <span className="truncate font-medium text-foreground">
                        {employee.firstName} {employee.lastName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("admin.years", { count: years })} · {dateLabel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("admin.noAnniversaries")}
              </p>
            )}
          </DashboardSection>
        </DashboardPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel className="lg:col-span-2">
          <DashboardSection
            title={t("admin.recentHires")}
            description={t("admin.recentHiresDescription")}
            action={
              <Link
                href={toHref("/people")}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:text-primary/80"
              >
                {t("admin.allEmployees")} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            {recentHires.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentHires.map((employee) => (
                  <li key={employee.id}>
                    <Link
                      href={toHref(`/people/${employee.stableEmployeeKey}`)}
                      className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary-ink"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {employee.firstName} {employee.lastName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {employee.jobTitle || employee.orgUnitName || employee.email}
                        </span>
                      </span>
                      <span className="shrink-0 text-end text-xs text-muted-foreground">
                        <span className="block">
                          {formatCompactDate(employee.hireDate, format, common("dateUnavailable"))}
                        </span>
                        {getNewHireLabel(employee.hireDate, t) ? (
                          <span className="block">{getNewHireLabel(employee.hireDate, t)}</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-surface border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t("admin.noRecentHires")}
              </div>
            )}
          </DashboardSection>
        </DashboardPanel>

        <DashboardPanel>
          <DashboardSection title={t("admin.quickActions")}>
            <div className="flex flex-col gap-2">
              <QuickLink href={toHref("/people/hire")} icon={Plus}>
                {t("admin.addEmployee")}
              </QuickLink>
              <QuickLink href={toHref(ADMINISTRATORS_PATH)} icon={ShieldCheck}>
                {t("admin.manageAccess")}
              </QuickLink>
              <QuickLink href={toHref("/organization")} icon={Network}>
                {t("admin.openOrganization")}
              </QuickLink>
              <QuickLink href={toHref("/getting-started")} icon={ClipboardList}>
                {t("admin.gettingStarted")}
              </QuickLink>
            </div>
          </DashboardSection>
        </DashboardPanel>
      </div>
    </PageContainer>
  );
}

function HRAdminDashboard() {
  const t = useTranslations("overview");
  return (
    <WorkforceDashboard
      title={t("dashboard")}
      description={t("admin.description")}
      toHref={(h) => h}
    />
  );
}

function ManagerDashboard({ me }: { me: WorkforceMeContext }) {
  const emp = me.employee!;
  const t = useTranslations("overview");
  const statusWord = useStatusWord();
  const { data: team, isLoading: isTeamLoading } = useWorkforceTeam(emp.employeeId);
  const teamList = team ?? [];
  const directReportCount = emp.directReportCount;
  const teamActive = teamList.filter((member) => member.isActive).length;
  const teamAttention = teamList.filter((member) => member.dataQuality.hasEmployeeStateIssues).length;

  return (
    <PageContainer width="wide" className="space-y-5">
      <PageHeader
        title={t("dashboard")}
        description={t("manager.description", { name: emp.firstName })}
      />

      <KpiGrid>
        <KpiStat label={t("manager.directReports")} value={directReportCount} icon={Users} href="/team" />
        <KpiStat
          label={t("manager.teamActive")}
          value={teamActive}
          tone="success"
          icon={UserCheck}
          hint={t("manager.ofDirect", { count: directReportCount })}
        />
        <KpiStat
          label={t("manager.needsAttention")}
          value={teamAttention}
          tone={teamAttention > 0 ? "warning" : "success"}
          icon={TriangleAlert}
          hint={teamAttention > 0 ? t("manager.attentionHint") : t("manager.healthyHint")}
        />
        <KpiStat
          label={t("manager.myStatus")}
          value={statusWord(emp.employmentStatus)}
          tone={emp.isActive ? "success" : "default"}
          icon={UserCheck}
          hint={emp.jobTitle ?? undefined}
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel className="lg:col-span-2">
          <DashboardSection
            title={t("manager.myTeam")}
            description={t("manager.teamSummary", { count: directReportCount, active: teamActive })}
            action={
              <Link
                href="/team"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:text-primary/80"
              >
                {t("manager.openTeam")} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            {isTeamLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-control" />
                ))}
              </div>
            ) : teamList.length > 0 ? (
              <ul className="divide-y divide-border">
                {teamList.map((member) => {
                  const attn = member.dataQuality.hasEmployeeStateIssues;
                  return (
                    <li key={member.employeeId}>
                      <Link
                        href={`/people/${member.stableEmployeeKey}`}
                        className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary-ink"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${member.isActive ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {member.displayName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {member.jobTitle || member.workEmail}
                            </span>
                          </span>
                        </span>
                        {attn ? (
                          <span className="shrink-0 rounded-detail bg-primary-tint px-1.5 py-0.5 text-[11px] font-medium text-primary-ink">
                            {t("manager.needsAttention")}
                          </span>
                        ) : (
                          <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-surface border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t("manager.noReports")}
              </div>
            )}
          </DashboardSection>
        </DashboardPanel>

        <DashboardPanel>
          <DashboardSection title={t("manager.reportingContext")}>
            <dl className="space-y-2">
              {[
                [t("manager.myStatus"), statusWord(emp.employmentStatus)],
                [t("manager.reportsTo"), emp.manager?.displayName ?? "—"],
                [t("manager.orgUnit"), emp.orgUnit?.name ?? "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-control border border-border px-3 py-2 text-sm"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate ps-2 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-col gap-2">
              <QuickLink href="/team" icon={Users}>
                {t("manager.openMyTeam")}
              </QuickLink>
              <QuickLink href="/organization" icon={Network}>
                {t("manager.organization")}
              </QuickLink>
              <QuickLink href="/profile" icon={User}>
                {t("manager.myProfile")}
              </QuickLink>
            </div>
          </DashboardSection>
        </DashboardPanel>
      </div>
    </PageContainer>
  );
}

function EmployeeDashboard({ me }: { me: WorkforceMeContext }) {
  const emp = me.employee!;
  const t = useTranslations("overview");
  const statusWord = useStatusWord();

  return (
    <PageContainer width="wide" className="space-y-5">
      <PageHeader
        title={t("dashboard")}
        description={emp.firstName ? t("employee.welcomeNamed", { name: emp.firstName }) : t("employee.welcome")}
      />

      <KpiGrid>
        <KpiStat
          label={t("employee.status")}
          value={statusWord(emp.employmentStatus)}
          tone={emp.isActive ? "success" : "default"}
          icon={UserCheck}
        />
        <KpiStat
          label={t("employee.jobTitle")}
          value={emp.jobTitle ? t("employee.set") : "—"}
          hint={emp.jobTitle ?? t("employee.notSet")}
          icon={ClipboardList}
        />
        <KpiStat
          label={t("employee.orgUnit")}
          value={emp.orgUnit ? t("employee.assigned") : "—"}
          hint={emp.orgUnit?.name ?? t("employee.noOrgUnit")}
          icon={Building2}
        />
        <KpiStat
          label={t("employee.manager")}
          value={emp.manager ? t("employee.assigned") : "—"}
          hint={emp.manager?.displayName ?? t("employee.noManager")}
          icon={Network}
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel className="lg:col-span-2">
          <DashboardSection
            title={t("employee.myProfile")}
            description={`${emp.fullName}${emp.jobTitle ? ` · ${emp.jobTitle}` : ""}`}
            action={
              <Link
                href="/profile"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:text-primary/80"
              >
                {t("employee.openProfile")} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            <dl className="grid gap-2 sm:grid-cols-2">
              {[
                [t("employee.status"), statusWord(emp.employmentStatus)],
                [t("employee.manager"), emp.manager?.displayName ?? "—"],
                [t("employee.orgUnit"), emp.orgUnit?.name ?? "—"],
                [t("employee.preferredName"), emp.preferredName ?? "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-control border border-border px-3 py-2 text-sm"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate ps-2 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </DashboardSection>
        </DashboardPanel>

        <DashboardPanel>
          <DashboardSection title={t("employee.quickActions")}>
            <div className="flex flex-col gap-2">
              <QuickLink href="/profile" icon={User}>
                {t("employee.viewProfile")}
              </QuickLink>
              <QuickLink href="/profile" icon={Settings2}>
                {t("employee.editPreferences")}
              </QuickLink>
            </div>
          </DashboardSection>
        </DashboardPanel>
      </div>
    </PageContainer>
  );
}

// ── Generic fallback (role with overview but no specific dashboard) ──────────

function CoreOperationsDashboard() {
  const { user } = useAuth();
  const t = useTranslations("overview");
  const moduleHref: HrefFn = (h) => h;

  const workspaces = [
    canAccessCoreAccess(user)
      ? { href: moduleHref(ADMINISTRATORS_PATH), title: t("workspace.access"), icon: ShieldCheck }
      : canManageCoreAccessProfiles(user)
        ? { href: moduleHref("/settings?tab=access-permissions"), title: t("workspace.settings"), icon: ShieldCheck }
        : null,
    canViewTenantAdministration(user)
      ? { href: moduleHref("/getting-started"), title: t("workspace.gettingStarted"), icon: ClipboardList }
      : null,
    canAccessCoreSettings(user)
      ? { href: moduleHref("/settings"), title: t("workspace.settings"), icon: Settings2 }
      : null,
    canAccessEmployeeRoster(user)
      ? { href: moduleHref("/people"), title: t("workspace.people"), icon: Users }
      : null,
    canAccessTeamWorkspace(user)
      ? { href: moduleHref("/team"), title: t("workspace.myTeam"), icon: Users }
      : null,
    canAccessSelfEmployeeProfile(user)
      ? { href: moduleHref("/profile"), title: t("workspace.myProfile"), icon: User }
      : null,
  ].filter((w): w is { href: string; title: string; icon: typeof Plus } => w !== null);

  return (
    <PageContainer width="wide" className="space-y-6">
      <PageHeader title={t("dashboard")} description={t("operations.description")} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((w) => (
          <QuickLink key={w.title} href={w.href} icon={w.icon}>
            {w.title}
          </QuickLink>
        ))}
      </div>
    </PageContainer>
  );
}

function CoreWorkspaceRedirect({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const t = useTranslations("overview");
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return (
    <PageContainer width="wide" className="space-y-6">
      <PageHeader title={t("dashboard")} description={t("operations.redirecting", { label })} />
      <PageLoading rows={4} label={t("operations.redirectingTo", { href })} />
    </PageContainer>
  );
}

type WorkspaceKey = "access" | "settings" | "gettingStarted" | "people" | "myTeam" | "myProfile";

function getFallbackWorkspace(user: AuthUser | null): { href: string; label: WorkspaceKey } | null {
  if (canAccessCoreAccess(user)) return { href: ADMINISTRATORS_PATH, label: "access" };
  if (canManageCoreAccessProfiles(user))
    return { href: "/settings?tab=access-permissions", label: "settings" };
  if (canViewTenantAdministration(user)) return { href: "/getting-started", label: "gettingStarted" };
  if (canAccessCoreSettings(user)) return { href: "/settings", label: "settings" };
  if (canAccessEmployeeRoster(user)) return { href: "/people", label: "people" };
  if (canAccessTeamWorkspace(user)) return { href: "/team", label: "myTeam" };
  if (canAccessSelfEmployeeProfile(user)) return { href: "/profile", label: "myProfile" };
  return null;
}

export default function OverviewWorkspace() {
  const { user, isLoading } = useAuth();
  const t = useTranslations("overview");
  const canSeeOverview = canAccessCoreOverview(user);
  const isHrAdmin = canAccessEmployeeRoster(user);

  // Personal (self / team) dashboard is driven by the workforce hierarchy, not a static
  // profile: any workforce-linked user gets a dashboard, and having direct reports promotes
  // them from the self view to the team view (cascading up the org). `workforce/me` is
  // permissioned for own-profile/team scope, so it resolves without roster access.
  const wantsPersonalDashboard = !!user && !isHrAdmin;
  const { data: me, isLoading: isMeLoading } = useWorkforceMe(wantsPersonalDashboard);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (canSeeOverview && isHrAdmin) {
    return <HRAdminDashboard />;
  }

  if (wantsPersonalDashboard) {
    if (isMeLoading && !me) {
      return <LoadingSkeleton />;
    }
    if (me?.isWorkforceLinked && me.employee) {
      return me.employee.directReportCount > 0 ? (
        <ManagerDashboard me={me} />
      ) : (
        <EmployeeDashboard me={me} />
      );
    }
  }

  if (canSeeOverview) {
    return <CoreOperationsDashboard />;
  }

  const fallbackWorkspace = getFallbackWorkspace(user);
  if (fallbackWorkspace) {
    return (
      <CoreWorkspaceRedirect href={fallbackWorkspace.href} label={t(`workspace.${fallbackWorkspace.label}`)} />
    );
  }

  return (
    <PageContainer width="wide" className="space-y-6">
      <PagePermissionNotice
        title={t("operations.none")}
        description={t("operations.noneDescription")}
      />
    </PageContainer>
  );
}
