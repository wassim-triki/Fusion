"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { PageContainer, PageHeader } from "@repo/ds/shell";
import {
  canImportCoreEmployees,
  canManageCoreEmployees,
  canManageWorkforceAccess,
  useAuth,
} from "@repo/auth";
import type {
  WorkforceChangeDto,
  OrganizationHierarchyNodeDto,
  PeopleEmploymentState,
  PeopleOrganizationScope,
  PeopleQueryParams,
  PeopleRowDto,
  PeopleSortDirection,
  PeopleSortField,
} from "@repo/api";
import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  MoreHorizontal,
  Upload,
  UserRoundPlus,
  UserRoundX,
  Workflow,
  X,
} from "lucide-react";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { OrganizationTree } from "@/features/organization/components/organization-tree";
import { usePeople } from "../api/use-people";
import { useChangeSheet } from "../changes/change-sheet";
import { ChangeBadge } from "../changes/coming-up";
import { useChangeRights, useUpcomingChanges } from "../changes/use-changes";
import type { ChangeKind } from "../changes/change-panel";
import {
  EmployeeIdentity,
  EmploymentStatus,
  OrgPath,
  useWorkforceDate,
} from "./workforce-ui";
import { formatCount } from "@repo/ds/lib/numbers";

const PAGE_SIZE = 10;
const EMPLOYMENT_STATES: PeopleEmploymentState[] = ["Active", "Scheduled", "Former", "Incomplete"];

function todayCalendarDate() {
  return new Date().toISOString().slice(0, 10);
}

function useEmploymentLabel() {
  const t = useTranslations("people.employment");
  const workforceDate = useWorkforceDate();
  return (person: PeopleRowDto) => {
    if (person.employmentState === "Scheduled") return t("starts", { date: workforceDate(person.employmentStart) });
    if (person.employmentState === "Former")
      return person.employmentEnd ? t("ended", { date: workforceDate(person.employmentEnd) }) : t("former");
    if (person.employmentState === "Incomplete") return t("unavailable");
    return t("since", { date: workforceDate(person.employmentStart) });
  };
}

const STATE_DOT: Record<PeopleEmploymentState, string> = {
  Active: "bg-success",
  Scheduled: "bg-info",
  Former: "bg-muted-foreground/50",
  Incomplete: "bg-warning",
};

/**
 * Roster employment state — a quiet dot + label + date rather than a filled pill on
 * every single row. Reserving the pill treatment for the profile keeps the directory
 * calm (§33.8) while still non-color-only.
 */
function EmploymentCell({ person }: { person: PeopleRowDto }) {
  const states = useTranslations("people.states");
  const employmentLabel = useEmploymentLabel();
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 type-body">
        <span aria-hidden className={cn("size-1.5 rounded-full", STATE_DOT[person.employmentState])} />
        {states(person.employmentState)}
      </p>
      <p className="mt-1 ps-3.5 type-meta text-muted-foreground">{employmentLabel(person)}</p>
    </div>
  );
}

type OrganizationChoice = {
  id: string;
  name: string;
  path: string;
  depth: number;
};

function flattenOrganization(
  nodes: OrganizationHierarchyNodeDto[],
  depth = 0,
): OrganizationChoice[] {
  return nodes.flatMap((node) => [
    { id: node.unit.id, name: node.unit.name, path: node.unit.path, depth },
    ...flattenOrganization(node.children, depth + 1),
  ]);
}

function OrganizationFilter({
  roots,
  selectedId,
  scope,
  onSelect,
  onScopeChange,
}: {
  roots: OrganizationHierarchyNodeDto[];
  selectedId: string | null;
  scope: PeopleOrganizationScope;
  onSelect: (id: string | null) => void;
  onScopeChange: (scope: PeopleOrganizationScope) => void;
}) {
  const t = useTranslations("people.orgFilter");
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => flattenOrganization(roots).find((choice) => choice.id === selectedId), [roots, selectedId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("max-w-64 justify-between gap-2 font-normal", selected && "border-foreground/25")}
        >
          <Building2 className="size-4 text-muted-foreground" />
          <span className="truncate">{selected?.name ?? t("all")}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        {selectedId ? (
          <div className="border-b border-border p-3">
            <Segmented
              fill
              label={t("scope")}
              value={scope}
              onChange={onScopeChange}
              options={[
                { value: "Subtree", label: t("subtree") },
                { value: "Direct", label: t("direct") },
              ]}
            />
          </div>
        ) : null}
        <OrganizationTree
          roots={roots}
          selectedId={selectedId}
          onSelect={(id) => {
            onSelect(id);
            if (id === null) setOpen(false);
          }}
          allOption={{ label: t("all") }}
          emptyLabel={t("noMatch")}
        />
      </PopoverContent>
    </Popover>
  );
}

function PeopleSkeleton() {
  const t = useTranslations("people");
  return (
    <div className="overflow-hidden rounded-surface border" aria-label={t("loading")}>
      <div className="flex items-center gap-6 border-b bg-inlay px-4 py-3">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-3 w-24" />)}
      </div>
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
          <Skeleton className="size-9 rounded-control" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></div>
          <div className="hidden flex-1 space-y-2 sm:block"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-44" /></div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function PersonMobileRow({ person }: { person: PeopleRowDto }) {
  const t = useTranslations("people");
  const employmentLabel = useEmploymentLabel();
  return (
    <article className="border-b py-4 last:border-b-0 sm:hidden">
      <div className="flex items-start justify-between gap-3">
        <EmployeeIdentity
          name={person.displayName}
          photoUrl={person.photoUrl}
          employeeNumber={person.employeeNumber}
          href={`/people/${person.employeeKey}`}
        />
        <EmploymentStatus state={person.employmentState} />
      </div>
      <div className="mt-3 space-y-2 ps-12">
        <div>
          <p className="type-body">{person.work?.jobTitle ?? t("workUnavailable")}</p>
          {person.work ? (
            <OrgPath name={person.work.organizationName} path={person.work.organizationPath} showAncestry={false} />
          ) : (
            <p className="type-meta text-muted-foreground">{t("noOrganization")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 type-meta text-muted-foreground">
          <span>{person.primaryManager?.displayName ?? t("noManager")}</span>
          {person.work?.location ? <span>{person.work.location}</span> : null}
          <span>{employmentLabel(person)}</span>
        </div>
      </div>
    </article>
  );
}

/** What a row offers: the change panel's entry points and the person's next coming change. */
interface RowChanges {
  coming: Map<string, WorkforceChangeDto>;
  canLines: boolean;
  canAll: boolean;
  onChange: (employeeKey: string, kind: ChangeKind) => void;
}

function RowMenu({ person, changes }: { person: PeopleRowDto; changes: RowChanges }) {
  const t = useTranslations("changes.menu");
  if (!changes.canLines || person.employmentState === "Former") return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t("more")}><MoreHorizontal className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => changes.onChange(person.employeeKey, "job")}>
          <ArrowLeftRight className="size-4" /> {changes.canAll ? t("changeJob") : t("changeManager")}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/org-chart?focus=${encodeURIComponent(person.employeeKey)}`}><Workflow className="size-4" /> {t("showInChart")}</Link>
        </DropdownMenuItem>
        {changes.canAll ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => changes.onChange(person.employeeKey, "end")}>
              <UserRoundX className="size-4" /> {t("endEmployment")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PeopleTable({ people, emptyState, changes }: { people: PeopleRowDto[]; emptyState?: ReactNode; changes: RowChanges }) {
  const t = useTranslations("people");
  // Location is optional workforce data; a whole column of dashes is dead weight, so
  // the column only exists when at least one person on the page actually has a location.
  const showLocation = people.some((person) => Boolean(person.work?.location));
  // An empty roster keeps the table frame — column headers on top, the placeholder
  // inside the body — rather than swapping the whole page for a centered state. Rendered
  // once (header hidden on mobile) so the placeholder text isn't duplicated across the
  // responsive desktop/mobile split.
  if (people.length === 0) {
    return (
      <div className="overflow-hidden rounded-surface border">
        <Table>
          <TableHeader className="max-sm:hidden">
            <TableRow className="bg-inlay hover:bg-inlay">
              <TableHead className="h-10 w-[28%] type-eyebrow text-muted-foreground">{t("columns.employee")}</TableHead>
              <TableHead className="w-[34%] type-eyebrow text-muted-foreground">{t("columns.work")}</TableHead>
              <TableHead className="w-[20%] type-eyebrow text-muted-foreground max-lg:hidden">{t("columns.manager")}</TableHead>
              <TableHead className="w-[16%] type-eyebrow text-muted-foreground">{t("columns.employment")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="p-0">{emptyState}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }
  return (
    <>
      <div className="hidden overflow-hidden rounded-surface border sm:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-inlay hover:bg-inlay">
              <TableHead className="h-10 w-[28%] type-eyebrow text-muted-foreground">{t("columns.employee")}</TableHead>
              <TableHead className={cn("type-eyebrow text-muted-foreground", showLocation ? "w-[28%]" : "w-[34%]")}>{t("columns.work")}</TableHead>
              <TableHead className="w-[20%] type-eyebrow text-muted-foreground max-lg:hidden">{t("columns.manager")}</TableHead>
              {showLocation ? <TableHead className="w-[14%] type-eyebrow text-muted-foreground max-xl:hidden">{t("columns.location")}</TableHead> : null}
              <TableHead className="w-[16%] type-eyebrow text-muted-foreground">{t("columns.employment")}</TableHead>
              {changes.canLines ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((person) => (
              <TableRow key={person.employeeKey} className="h-[4.5rem]">
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <EmployeeIdentity
                      name={person.displayName}
                      photoUrl={person.photoUrl}
                      employeeNumber={person.employeeNumber}
                      href={`/people/${person.employeeKey}`}
                    />
                    {changes.coming.get(person.employeeKey) ? <ChangeBadge change={changes.coming.get(person.employeeKey)!} /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <p className="type-body truncate">{person.work?.jobTitle ?? t("workUnavailable")}</p>
                  {person.work ? (
                    <OrgPath
                      name={person.work.organizationName}
                      path={person.work.organizationPath}
                      className="mt-0.5"
                      showAncestry={false}
                    />
                  ) : (
                    <p className="mt-0.5 type-meta text-muted-foreground">{t("noOrganization")}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 type-meta text-muted-foreground lg:hidden">
                    <span>{person.primaryManager?.displayName ?? t("noManager")}</span>
                    {showLocation && person.work?.location ? <span className="xl:hidden">{person.work.location}</span> : null}
                  </div>
                </TableCell>
                <TableCell className="max-lg:hidden">
                  {person.primaryManager ? (
                    <p className="type-body truncate">{person.primaryManager.displayName}</p>
                  ) : (
                    <span className="type-meta text-muted-foreground">{t("noManager")}</span>
                  )}
                </TableCell>
                {showLocation ? (
                  <TableCell className="max-xl:hidden">
                    {person.work?.location ? (
                      <p className="type-body truncate">{person.work.location}</p>
                    ) : (
                      <span className="type-meta text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell><EmploymentCell person={person} /></TableCell>
                {changes.canLines ? <TableCell className="text-end"><RowMenu person={person} changes={changes} /></TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="sm:hidden">{people.map((person) => <PersonMobileRow key={person.employeeKey} person={person} />)}</div>
    </>
  );
}

function EstablishAction({
  href,
  icon: Icon,
  label,
  tone,
  disabled,
}: {
  href: string;
  icon: typeof Upload;
  label: string;
  tone: "primary" | "default" | "quiet";
  disabled?: boolean;
}) {
  if (disabled) return null;
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-4 rounded-surface border p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        tone === "primary"
          ? "border-primary/40 bg-primary/[0.06] hover:bg-primary/10"
          : tone === "default"
            ? "hover:bg-muted/50"
            : "border-transparent hover:bg-muted/40",
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-control",
          tone === "primary" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="type-label font-semibold">{label}</span>
      <ArrowRight className="ms-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

function EstablishWorkforce({ canManage, canImport }: { canManage: boolean; canImport: boolean }) {
  const t = useTranslations("people.empty");
  return (
    <section aria-label={t("label")} className="mx-auto grid max-w-lg gap-2.5 py-16 sm:py-24">
      <p className="type-eyebrow text-muted-foreground">{t("label")}</p>
      <h2 className="type-page-title mb-4 text-balance">{t("title")}</h2>
      <EstablishAction href="/people/import" icon={Upload} label={t("import")} tone="primary" disabled={!canImport} />
      <EstablishAction href="/people/add-existing" icon={UserRoundPlus} label={t("addExisting")} tone="default" disabled={!canManage} />
      <EstablishAction href="/people/hire" icon={Plus} label={t("hire")} tone="quiet" disabled={!canManage} />
    </section>
  );
}

export default function PeopleWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const t = useTranslations("people");
  const canManage = canManageCoreEmployees(user);
  const canImport = canImportCoreEmployees(user);
  const canManageAccess = canManageWorkforceAccess(user);
  const rights = useChangeRights();
  const changeSheet = useChangeSheet();
  const upcoming = useUpcomingChanges();
  const rowChanges = useMemo<RowChanges>(() => {
    const coming = new Map<string, WorkforceChangeDto>();
    for (const change of upcoming.data ?? []) if (!coming.has(change.person.employeeKey)) coming.set(change.person.employeeKey, change);
    return { coming, canLines: rights.lines, canAll: rights.people, onChange: changeSheet.start };
  }, [upcoming.data, rights.lines, rights.people, changeSheet.start]);
  const q = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const stateParam = searchParams.get("status");
  const state = EMPLOYMENT_STATES.includes(stateParam as PeopleEmploymentState) ? stateParam as PeopleEmploymentState : null;
  const orgUnitId = searchParams.get("orgUnitId");
  const scope = searchParams.get("scope") === "Direct" ? "Direct" : "Subtree";
  const sort = (["Name", "EmployeeNumber", "EmploymentDate"] as const).includes(searchParams.get("sort") as PeopleSortField)
    ? searchParams.get("sort") as PeopleSortField
    : "Name";
  const direction = searchParams.get("direction") === "Desc" ? "Desc" : "Asc";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const importBatch = searchParams.get("importBatch");

  const updateUrl = useCallback((updates: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    const href = `${pathname}${next.size ? `?${next.toString()}` : ""}`;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => updateUrl({ q: search.trim() || null, page: null }, true), 250);
    return () => window.clearTimeout(timer);
  }, [q, search, updateUrl]);

  const query = useMemo<PeopleQueryParams>(() => ({
    q: q || null,
    state,
    orgUnitId,
    organizationScope: scope,
    sort,
    direction,
    page,
    pageSize: PAGE_SIZE,
    importBatch: importBatch || null,
  }), [direction, orgUnitId, page, q, scope, sort, state, importBatch]);
  const people = usePeople(query);
  const organization = useOrganizationHierarchy(todayCalendarDate());
  const hasFilters = Boolean(q || state || orgUnitId || importBatch);
  const items = people.data?.items ?? [];
  const cohortCount = importBatch ? people.data?.totalCount ?? items.length : 0;
  const isTrueEmpty = Boolean(people.data) && !people.error && !hasFilters && items.length === 0;

  const clearFilters = useCallback(() => {
    setSearch("");
    router.push(pathname, { scroll: false });
  }, [pathname, router]);

  const headerActions = canManage ? (
    <div className="flex items-center gap-2">
      {canImport ? (
        <Button variant="outline" asChild>
          <Link href="/people/import"><Upload className="size-4" /> {t("actions.import")}</Link>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button><Plus className="size-4" /> {t("actions.addEmployee")} <ChevronDown className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><Link href="/people/hire">{t("actions.hire")}</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/people/add-existing">{t("actions.addExisting")}</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  return (
    <PageContainer width="wide" className="pb-12">
      <PageHeader title={t("title")} actions={headerActions} />

      {importBatch ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-surface bg-card px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="type-panel-title text-foreground">
              <span className="tabular-nums">{people.data ? cohortCount : "…"}</span>{" "}
              {t("cohort.added", { count: cohortCount })}
            </p>
            <button
              type="button"
              onClick={() => updateUrl({ importBatch: null, page: null }, true)}
              className="inline-flex items-center gap-1.5 type-meta font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t("cohort.addedInImport")}
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          {canManageAccess ? (
            <Button asChild>
              <Link href={`/workforce-access?importBatch=${importBatch}`}>
                {t("cohort.reviewAccess")}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <section aria-label={t("filters.label")} className="mb-5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[15rem] flex-1 md:max-w-xs">
              <Search className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("filters.search")} aria-label={t("filters.searchLabel")} className="ps-9 pe-9" />
              {search ? (
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("filters.clearSearch")} className="absolute inset-e-2 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <NativeSelect value={state ?? ""} onChange={(event) => updateUrl({ status: event.target.value || null, page: null })} aria-label={t("filters.state")} className="w-36">
              <NativeSelectOption value="">{t("filters.allStates")}</NativeSelectOption>
              {EMPLOYMENT_STATES.map((item) => <NativeSelectOption key={item} value={item}>{t(`states.${item}`)}</NativeSelectOption>)}
            </NativeSelect>
            <OrganizationFilter
              roots={organization.data?.roots ?? []}
              selectedId={orgUnitId}
              scope={scope}
              onSelect={(id) => updateUrl({ orgUnitId: id, page: null })}
              onScopeChange={(value) => updateUrl({ scope: value === "Subtree" ? null : value, page: null })}
            />
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <RotateCcw className="size-4" /> {t("filters.clear")}
              </Button>
            ) : null}
            <div className="ms-auto flex items-center gap-2 text-muted-foreground">
              <label htmlFor="people-sort" className="type-meta max-sm:sr-only">{t("filters.sort")}</label>
              <NativeSelect id="people-sort" value={`${sort}:${direction}`} onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":") as [PeopleSortField, PeopleSortDirection];
                updateUrl({ sort: nextSort === "Name" ? null : nextSort, direction: nextDirection === "Asc" ? null : nextDirection, page: null });
              }} aria-label={t("filters.sortLabel")} className="w-40 border-transparent bg-inlay text-foreground">
                <NativeSelectOption value="Name:Asc">{t("filters.nameAsc")}</NativeSelectOption>
                <NativeSelectOption value="Name:Desc">{t("filters.nameDesc")}</NativeSelectOption>
                <NativeSelectOption value="EmployeeNumber:Asc">{t("filters.number")}</NativeSelectOption>
                <NativeSelectOption value="EmploymentDate:Desc">{t("filters.newest")}</NativeSelectOption>
              </NativeSelect>
            </div>
          </section>

      {people.isLoading && !people.data ? <PeopleSkeleton /> : people.error ? (
        <Empty className="min-h-72 rounded-surface border">
          <EmptyMedia variant="icon"><RotateCcw /></EmptyMedia>
          <EmptyHeader><EmptyTitle>{t("error")}</EmptyTitle></EmptyHeader>
          <EmptyContent><Button variant="outline" onClick={() => void people.refetch()}>{t("retry")}</Button></EmptyContent>
        </Empty>
      ) : (
        <PeopleTable
          people={items}
          changes={rowChanges}
          emptyState={
            isTrueEmpty ? (
              <EstablishWorkforce canManage={canManage} canImport={canImport} />
            ) : (
              <Empty className="min-h-72">
                <EmptyMedia variant="icon"><Search /></EmptyMedia>
                <EmptyHeader><EmptyTitle>{t("noMatch")}</EmptyTitle></EmptyHeader>
                <EmptyContent><Button variant="outline" onClick={clearFilters}>{t("filters.clear")}</Button></EmptyContent>
              </Empty>
            )
          }
        />
      )}

      {changeSheet.element}
      {people.data && people.data.totalCount > 0 ? (
        <PeoplePagination
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={people.data.totalCount}
          onPageChange={(next) => updateUrl({ page: next <= 1 ? null : String(next) })}
        />
      ) : null}
    </PageContainer>
  );
}

/**
 * Roster pagination — the same grammar as the Platform tenant directory: a bordered
 * footer bar whose range ("Showing X–Y of N") is always present because it answers
 * "how many are there?", with numbered page controls added once there is more than one
 * page. The number run keeps a stable width via a first/last + windowed-neighbours set.
 */
function PeoplePagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (next: number) => void;
}) {
  const t = useTranslations("people.pagination");
  const locale = useLocale();
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  // A dataset that fits on one page gets no pager chrome — just a quiet count.
  if (pageCount <= 1) {
    return (
      <p className="mt-4 type-meta text-muted-foreground">
        <span className="tabular-nums text-foreground">{formatCount(totalCount, locale)}</span> {t("count", { count: totalCount })}
      </p>
    );
  }

  return (
    <nav
      aria-label={t("label")}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border px-4 py-3"
    >
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {t.rich("showing", {
          from: formatCount(from, locale),
          to: formatCount(to, locale),
          total: formatCount(totalCount, locale),
          count: totalCount,
          n: (chunks) => <span className="tabular-nums text-foreground">{chunks}</span>,
        })}
      </p>

      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft aria-hidden className="size-4" />
            {t("previous")}
          </Button>

          <ol className="flex items-center gap-1">
            {pageNumbers(page, pageCount).map((entry, index) =>
              entry === "gap" ? (
                <li key={`gap-${index}`} aria-hidden className="px-1 text-sm text-muted-foreground">…</li>
              ) : (
                <li key={entry}>
                  <Button
                    variant={entry === page ? "default" : "ghost"}
                    size="sm"
                    aria-label={t("page", { page: entry })}
                    aria-current={entry === page ? "page" : undefined}
                    onClick={() => onPageChange(entry)}
                    className="min-w-9 tabular-nums"
                  >
                    {entry}
                  </Button>
                </li>
              )
            )}
          </ol>

          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            {t("next")}
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

/** First page, last page, and a stable-width window around the current one. */
function pageNumbers(page: number, pageCount: number): Array<number | "gap"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const window = new Set([1, pageCount, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((entry) => window.add(entry));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((entry) => window.add(entry));

  const pages = [...window].filter((entry) => entry >= 1 && entry <= pageCount).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  let previous = 0;
  for (const entry of pages) {
    if (previous && entry - previous > 1) result.push("gap");
    result.push(entry);
    previous = entry;
  }
  return result;
}
