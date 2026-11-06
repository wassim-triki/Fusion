"use client";

import { UnitPageSkeleton as UnitSkeleton } from "@/shell/route-skeletons";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, Network } from "lucide-react";
import type { OrgChartOpenRoleDto, OrgChartPersonDto } from "@repo/api";
import { useAuth, PageRefusal } from "@repo/auth";
import { Alert, AlertDescription, AlertTitle, Button } from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import { canAccessEmployeeRoster } from "@/lib/employee-roster-access";
import { Monogram } from "@/features/people/components/workforce-ui";
import { useUpcomingChanges } from "@/features/people/changes/use-changes";
import { useOrganizationHierarchy, useOrganizationUnit, useOrganizationUpcomingChanges } from "../api/use-organization";
import { useStaffing, useStaffingAccess, useUnitPeople } from "../api/use-staffing";
import { buildOrganizationHierarchy } from "../model/hierarchy";
import { todayCalendarDate } from "../model/workspace-state";
import { PlannedChanges, usePlannedItems } from "./planned-changes";

/** A unit's page (D-17): who leads it, who works in it and the units under it, its open roles and what's planned. */
export default function OrganizationUnitPage({ id }: { id: string }) {
  const t = useTranslations("organization.unitPage");
  const format = useFormat();
  const { user, isLoading } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const today = useMemo(() => todayCalendarDate(), []);
  const asOf = params.get("asOf") || today;
  const access = useStaffingAccess(asOf, today);

  const unit = useOrganizationUnit(id, asOf, access.unitPages);
  const hierarchy = useOrganizationHierarchy(asOf, access.unitPages);
  const staffing = useStaffing(asOf, access.unitPages);
  const page = useUnitPeople(id, asOf, access.unitPages);
  const unitChanges = useOrganizationUpcomingChanges(access.unitPages && asOf === today);
  const peopleChanges = useUpcomingChanges(access.hr && asOf === today);

  const model = useMemo(() => (hierarchy.data ? buildOrganizationHierarchy(hierarchy.data) : null), [hierarchy.data]);
  const subtree = useMemo(() => new Set([id, ...(model?.descendantsById.get(id) ?? [])]), [id, model]);
  const names = useMemo(() => new Set([...subtree].map((unitId) => model?.byId.get(unitId)?.name).filter(Boolean)), [model, subtree]);
  const keys = useMemo(() => new Set(page.data?.people.map((person) => person.employeeKey)), [page.data]);
  const planned = usePlannedItems(
    (peopleChanges.data ?? []).filter((change) => keys.has(change.person.employeeKey)
      || (change.details.unitTo && names.has(change.details.unitTo))),
    (unitChanges.data ?? []).filter((change) => subtree.has(change.orgUnitId)),
    today
  );

  if (isLoading) return <UnitSkeleton />;
  if (!access.unitPages) {
    return (
      <PageContainer width="wide" className="max-w-6xl">
        <PageRefusal />
      </PageContainer>
    );
  }
  if (unit.isLoading || page.isLoading || (!page.data && !page.error)) return <UnitSkeleton />;
  if (unit.error || page.error || !unit.data || !page.data) {
    return (
      <PageContainer width="wide" className="max-w-6xl">
        <Alert variant="destructive" className="max-w-xl">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t("error")}</AlertTitle>
          <AlertDescription>
            {(unit.error ?? page.error)?.message}
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { void unit.refetch(); void page.refetch(); }}>
              {t("retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  const state = unit.data;
  const data = page.data;
  const children = (model?.childrenByParent.get(id) ?? []).map((child) => model!.byId.get(child)!);
  const people = groupByUnit(data.people, id, model?.byId);
  const dateQuery = asOf === today ? "" : `?asOf=${asOf}`;
  const profileHref = (person: OrgChartPersonDto) => (canAccessEmployeeRoster(user) ? `/people/${person.employeeKey}` : null);
  const managerName = (role: OrgChartOpenRoleDto) => data.people.find((person) => person.employeeKey === role.managerKey)?.displayName;

  return (
    <PageContainer width="wide" className="max-w-6xl pb-16">
      <Link href={`/organization${dateQuery}`} className="mb-4 inline-flex items-center gap-1.5 rounded-detail type-meta text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>

      <section aria-labelledby="unit-name" className="rounded-surface bg-section px-6 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 id="unit-name" className="type-display truncate sm:text-[2.25rem]">{state.name}</h1>
            <p className="mt-1.5 type-body text-muted-foreground">
              {state.parentName ? t("typeIn", { type: state.typeName, parent: state.parentName }) : state.typeName}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/organization?unit=${encodeURIComponent(id)}${asOf === today ? "" : `&asOf=${asOf}`}`}>
              <Network className="size-4" aria-hidden />
              {t("onChart")}
            </Link>
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-4">
          {data.head ? (
            <div className="flex items-center gap-2.5">
              <Monogram name={data.head.displayName} photoUrl={data.head.photoUrl} size="md" />
              <span className="min-w-0">
                <span className="block type-meta text-muted-foreground">{t("head")}</span>
                <span className="block truncate type-label">{data.head.displayName}</span>
              </span>
            </div>
          ) : null}
          <Glance label={t("people")} value={String(data.people.length)} />
          {children.length ? <Glance label={t("units")} value={String(children.length)} /> : null}
          {asOf >= today ? <Glance label={t("openRoles")} value={String(data.openRoles.length)} /> : null}
          <Glance label={asOf === today ? t("today") : t("asOf")} value={format.date(asOf, { year: "always" })} />
        </div>
      </section>

      <div className="mt-8 grid gap-6">
        <section className="rounded-surface bg-card p-5" aria-labelledby="unit-people">
          <h2 id="unit-people" className="type-section-title">{t("people")}</h2>
          {data.people.length ? (
            <div className="mt-4 grid gap-6">
              {people.map((group) => (
                <div key={group.unitId}>
                  {people.length > 1 ? <h3 className="mb-2 type-label text-muted-foreground">{group.name}</h3> : null}
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
                    {group.people.map((person) => {
                      const href = profileHref(person);
                      const body = (
                        <>
                          <Monogram name={person.displayName} photoUrl={person.photoUrl} size="md" />
                          <span className="min-w-0">
                            <span className="block truncate type-label">{person.displayName}</span>
                            <span className="block truncate type-meta text-muted-foreground">{person.jobTitle ?? ""}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={person.employeeKey}>
                          {href ? (
                            <Link href={href} className="flex items-center gap-3 rounded-control bg-inlay px-3 py-2.5 outline-none hover:bg-inlay/70 focus-visible:ring-2 focus-visible:ring-ring">{body}</Link>
                          ) : (
                            <div className="flex items-center gap-3 rounded-control bg-inlay px-3 py-2.5">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 type-body text-muted-foreground">{t("nobody")}</p>
          )}
        </section>

        {children.length ? (
          <section className="rounded-surface bg-card p-2" aria-labelledby="unit-children">
            <h2 id="unit-children" className="px-3 pt-2.5 pb-2 type-section-title">{t("units")}</h2>
            <ul className="grid gap-0.5">
              {children.map((child) => {
                const staff = staffing.byUnit?.get(child.id);
                return (
                  <li key={child.id}>
                    <Link href={`/organization/units/${child.id}${dateQuery}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,14rem)_4rem] items-center gap-4 rounded-control px-3 py-2.5 outline-none hover:bg-inlay focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0">
                        <span className="block truncate type-label">{child.name}</span>
                        <span className="block truncate type-meta text-muted-foreground">{child.typeName}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2 type-meta text-muted-foreground">
                        {staff?.head ? <Monogram name={staff.head.displayName} photoUrl={staff.head.photoUrl} size="sm" className="size-6 text-[10px]" /> : null}
                        <span className="truncate">{staff?.head?.displayName ?? (staff?.people === 0 ? t("nobodyYet") : "")}</span>
                      </span>
                      <span className="text-end type-label tabular-nums">{staff?.people ?? ""}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {asOf >= today ? (
          <section className="rounded-surface bg-card p-2" aria-labelledby="unit-roles">
            <h2 id="unit-roles" className="px-3 pt-2.5 pb-2 type-section-title">{t("openRoles")}</h2>
            {data.openRoles.length ? (
              <ul className="grid gap-0.5">
                {data.openRoles.map((role) => (
                  <li key={role.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-control px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate type-label">{role.jobTitle}</span>
                      <span className="block truncate type-meta text-muted-foreground">
                        {[managerName(role) ? t("reportsTo", { name: managerName(role)! }) : null, role.unit?.name, role.placeName].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="type-meta text-muted-foreground">
                      {role.status === "OnHold" ? t("onHold") : role.targetStartDate ? t("startsBy", { date: format.date(role.targetStartDate) }) : t("open")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 pb-3 type-body text-muted-foreground">{t("noRoles")}</p>
            )}
          </section>
        ) : null}

        {asOf === today ? (
          <PlannedChanges items={planned} date={asOf} loading={unitChanges.isLoading || peopleChanges.isLoading} onOpen={(day) => router.push(`/organization?unit=${encodeURIComponent(id)}&asOf=${day}`)} />
        ) : null}
      </div>
    </PageContainer>
  );
}

function Glance({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0">
      <span className="block type-meta text-muted-foreground">{label}</span>
      <span className="block type-label tabular-nums">{value}</span>
    </span>
  );
}

/** People in the unit itself first, then each unit under it by name. */
function groupByUnit(people: OrgChartPersonDto[], unitId: string, units?: Map<string, { name: string }>) {
  const groups = new Map<string, { unitId: string; name: string; people: OrgChartPersonDto[] }>();
  for (const person of people) {
    const key = person.unit?.id ?? unitId;
    const group = groups.get(key) ?? { unitId: key, name: person.unit?.name ?? units?.get(key)?.name ?? "", people: [] };
    group.people.push(person);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.unitId === unitId ? -1 : b.unitId === unitId ? 1 : a.name.localeCompare(b.name)));
}
