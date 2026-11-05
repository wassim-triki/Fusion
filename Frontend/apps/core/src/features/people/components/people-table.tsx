"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  cn,
} from "@repo/ds";
import {
  DataTable,
  DataTableCellEmpty,
  DataTableExport,
  createDataTableColumnHelper,
  useDataTable,
  type DataTableFilterField,
  type DataTableFilterState,
  type SortingState,
} from "@repo/ds/data-table";
import { LinkTabs, StatusBadge } from "@repo/ds/shell";
import { canManageWorkforceAccess, ProviderMark, useAuth } from "@repo/auth";
import { useTenantSummary } from "@repo/api/query";
import type {
  OrganizationHierarchyNodeDto,
  PeopleQueryParams,
  PeopleRowDto,
  PeopleView,
  PeopleViewCountsDto,
  WorkforceChangeDto,
} from "@repo/api";
import { toast } from "sonner";
import { ArrowLeftRight, Building2, Briefcase, MapPin, Mail, MoreHorizontal, Tags, UserRound, UserRoundX, Workflow } from "lucide-react";
import { useJobs, usePlaces } from "@/features/catalog/api/use-catalog";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import { usePeople } from "../api/use-people";
import { useInvitationMutations, usePeopleDirectory, usePeopleExport } from "../api/use-people-directory";
import { useChangeSheet } from "../changes/change-sheet";
import { ChangeBadge } from "../changes/coming-up";
import { useChangeRights, useUpcomingChanges } from "../changes/use-changes";
import { Monogram, useWorkforceDate } from "./workforce-ui";
import { LayoutSwitch } from "./people-layout";
import { PeoplePendingContent } from "./people-page-skeleton";

const PAGE_SIZES = [10, 25, 50];

/** Each view's address and the server's name for it. */
type ViewSlug = "everyone" | "starting-soon" | "leaving" | "not-signed-in" | "left";

export const VIEWS: { slug: ViewSlug; view: PeopleView; count: keyof PeopleViewCountsDto }[] = [
  { slug: "everyone", view: "Everyone", count: "everyone" },
  { slug: "starting-soon", view: "StartingSoon", count: "startingSoon" },
  { slug: "leaving", view: "Leaving", count: "leaving" },
  { slug: "not-signed-in", view: "NotSignedIn", count: "notSignedIn" },
  { slug: "left", view: "Left", count: "left" },
];

function flattenUnits(nodes: OrganizationHierarchyNodeDto[]): { value: string; label: string }[] {
  return nodes.flatMap((node) => [{ value: node.unit.id, label: node.unit.name }, ...flattenUnits(node.children)]);
}

/** Whole years, or months under a year, from the first day to today. */
function tenure(start: string | null): { years: number; months: number } | null {
  if (!start) return null;
  const from = new Date(start);
  const now = new Date();
  let months = (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + now.getUTCMonth() - from.getUTCMonth();
  if (now.getUTCDate() < from.getUTCDate()) months -= 1;
  return months < 0 ? null : { years: Math.floor(months / 12), months };
}

function useAgo() {
  const locale = useLocale();
  return useCallback(
    (iso: string) => {
      const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
      const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      return Math.abs(days) < 30 ? format.format(days, "day") : format.format(Math.round(days / 30), "month");
    },
    [locale]
  );
}

/** "Signs in", with the mark of each provider the person uses (B-191). */
function SignsInWith({ methods, label }: { methods: string[]; label: string }) {
  const company = useTenantSummary().data?.name ?? "";
  const providers = methods.filter((method): method is "microsoft" | "google" | "company" =>
    method === "microsoft" || method === "google" || method === "company");
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {providers.map((provider) => (
        <span
          key={provider}
          title={provider === "company" ? company : provider === "microsoft" ? "Microsoft" : "Google"}
          className="inline-flex [&>*]:size-3.5 [&>span]:text-[0.5rem]"
        >
          <ProviderMark provider={provider} label={company || "C"} />
        </span>
      ))}
    </span>
  );
}

function SignInCell({ person }: { person: PeopleRowDto }) {
  const t = useTranslations("people.signIn");
  const ago = useAgo();
  const signIn = person.signIn;
  if (!signIn) return <DataTableCellEmpty />;
  const dot = (tone: string, label: ReactNode) => (
    <span className="inline-flex items-center gap-2 type-body">
      <span aria-hidden className={cn("size-1.5 rounded-full", tone)} />
      {label}
    </span>
  );
  switch (signIn.state) {
    case "SignsIn":
      return dot("bg-success", <SignsInWith methods={signIn.methods ?? []} label={t("signsIn")} />);
    case "Invited":
      return dot("bg-info", signIn.at ? t("invitedAgo", { when: ago(signIn.at) }) : t("invited"));
    case "Expired":
      return dot("bg-warning", t("expired"));
    case "Suspended":
      return <span className="type-meta text-muted-foreground">{t("suspended")}</span>;
    case "NoEmail":
      return <span className="type-meta text-muted-foreground">{t("noEmail")}</span>;
    default:
      return <span className="type-meta text-muted-foreground">{t("notInvited")}</span>;
  }
}

function PersonCell({ person, coming }: { person: PeopleRowDto; coming?: WorkforceChangeDto }) {
  const t = useTranslations("people.table");
  const day = useWorkforceDate();
  const leaving = person.employmentState === "Active" && person.employmentEnd;
  const starting = person.employmentState === "Scheduled" && person.employmentStart;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Monogram name={person.displayName} photoUrl={person.photoUrl} size="sm" />
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2">
          <Link
            href={`/people/${person.employeeKey}`}
            className="truncate type-label font-semibold underline-offset-4 outline-none hover:underline focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring"
          >
            {person.displayName}
          </Link>
          {leaving ? <StatusBadge tone="warning">{t("leaves", { date: day(person.employmentEnd) })}</StatusBadge> : null}
          {starting ? <StatusBadge tone="info">{t("starts", { date: day(person.employmentStart) })}</StatusBadge> : null}
          {coming && !leaving && !starting ? <ChangeBadge change={coming} /> : null}
        </p>
        <p className="truncate type-meta text-muted-foreground">
          {[person.work?.jobTitle, person.work?.organizationName].filter(Boolean).join(" · ") || t("noJob")}
        </p>
      </div>
    </div>
  );
}

function RowMenu({
  person,
  canLines,
  canAll,
  canInvite,
  onChange,
  onInvite,
}: {
  person: PeopleRowDto;
  canLines: boolean;
  canAll: boolean;
  canInvite: boolean;
  onChange: (employeeKey: string, kind: "job" | "end") => void;
  onInvite: (person: PeopleRowDto) => void;
}) {
  const t = useTranslations("changes.menu");
  const own = useTranslations("people.table");
  const invitable = canInvite && person.employmentState !== "Former" && person.signIn
    && ["NotInvited", "Invited", "Expired"].includes(person.signIn.state);
  const changeable = canLines && person.employmentState !== "Former";
  if (!invitable && !changeable) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t("more")}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {invitable ? (
          <DropdownMenuItem onSelect={() => onInvite(person)}>
            <Mail className="size-4" /> {person.signIn?.state === "NotInvited" ? own("invite") : own("inviteAgain")}
          </DropdownMenuItem>
        ) : null}
        {changeable ? (
          <>
            <DropdownMenuItem onSelect={() => onChange(person.employeeKey, "job")}>
              <ArrowLeftRight className="size-4" /> {canAll ? t("changeJob") : t("changeManager")}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/organization?view=people&focus=${encodeURIComponent(person.employeeKey)}`}>
                <Workflow className="size-4" /> {t("showInChart")}
              </Link>
            </DropdownMenuItem>
            {canAll ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onChange(person.employeeKey, "end")}>
                  <UserRoundX className="size-4" /> {t("endEmployment")}
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const column = createDataTableColumnHelper<PeopleRowDto>();

/** People for HR (D-13): views, faces, sign-in, filters on the company's own fields, Export. */
export function PeopleTable({ header }: { header: (count: number | null) => ReactNode }) {
  const t = useTranslations("people.table");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const canInvite = canManageWorkforceAccess(user);
  const rights = useChangeRights();
  const changeSheet = useChangeSheet();
  const upcoming = useUpcomingChanges();
  const invitations = useInvitationMutations();
  const day = useWorkforceDate();

  const viewSlug = searchParams.get("view") ?? "everyone";
  const current = VIEWS.find((item) => item.slug === viewSlug) ?? VIEWS[0]!;
  const sortParam = searchParams.get("sort") ?? "name";
  const query = useMemo<PeopleQueryParams>(() => {
    const fields: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key.startsWith("f.")) fields[key.slice(2)] = value;
    });
    return {
      view: current.view,
      q: searchParams.get("q") || null,
      orgUnitId: searchParams.get("unit"),
      placeId: searchParams.get("place"),
      jobId: searchParams.get("job"),
      manager: searchParams.get("manager"),
      fields: Object.keys(fields).length ? fields : null,
      importBatch: searchParams.get("importBatch"),
      sort: sortParam.replace("-", "") === "start" ? "EmploymentDate" : "Name",
      direction: sortParam.startsWith("-") ? "Desc" : "Asc",
      page: Math.max(1, Number(searchParams.get("page")) || 1),
      pageSize: PAGE_SIZES.includes(Number(searchParams.get("size"))) ? Number(searchParams.get("size")) : 10,
    };
  }, [current.view, searchParams, sortParam]);

  // Changes build on the last address asked for: the URL catches up asynchronously.
  const pending = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    pending.current = null;
  }, [searchParams]);
  const update = useCallback(
    (changes: Record<string, string | null>, keepPage = false) => {
      const next = new URLSearchParams((pending.current ?? searchParams).toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!keepPage) next.delete("page");
      pending.current = next;
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const people = usePeople(query);
  const data = people.data;
  const jobs = useJobs();
  const places = usePlaces();
  const units = useOrganizationHierarchy(new Date().toISOString().slice(0, 10));
  const directory = usePeopleDirectory();
  const exportPeople = usePeopleExport(query);

  const managers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const person of directory.data?.people ?? []) if (person.manager) seen.set(person.manager.employeeKey, person.manager.displayName);
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [directory.data]);

  const filterFields = useMemo<DataTableFilterField<PeopleRowDto>[]>(
    () => [
      { id: "unit", label: t("filters.unit"), icon: Building2, type: "options", single: true, options: flattenUnits(units.data?.roots ?? []) },
      { id: "place", label: t("filters.place"), icon: MapPin, type: "options", single: true, options: (places.data ?? []).map((place) => ({ value: place.id, label: place.name })) },
      { id: "job", label: t("filters.job"), icon: Briefcase, type: "options", single: true, options: (jobs.data ?? []).map((job) => ({ value: job.id, label: job.title })) },
      { id: "manager", label: t("filters.manager"), icon: UserRound, type: "options", single: true, options: managers },
      ...(data?.facets ?? []).map((facet) => ({
        id: `f.${facet.key}`,
        label: facet.label,
        icon: Tags,
        type: "options" as const,
        single: true,
        options: facet.values.map((value) => ({ value, label: value })),
      })),
    ],
    [t, units.data, places.data, jobs.data, managers, data?.facets]
  );

  const filterState = useMemo<DataTableFilterState>(() => {
    const state: DataTableFilterState = {};
    for (const field of filterFields) {
      const key = field.id;
      const value = searchParams.get(key);
      state[key] = value ? [value] : undefined;
    }
    return state;
  }, [filterFields, searchParams]);

  const coming = useMemo(() => {
    const map = new Map<string, WorkforceChangeDto>();
    for (const change of upcoming.data ?? []) if (!map.has(change.person.employeeKey)) map.set(change.person.employeeKey, change);
    return map;
  }, [upcoming.data]);

  const invite = useCallback(
    async (person: PeopleRowDto) => {
      if (!person.employeeId) return;
      try {
        const result = await invitations.send.mutateAsync({ audience: "Chosen", employeeIds: [person.employeeId] });
        toast.success(result.invited + result.linked > 0 ? t("invitedOne", { name: person.firstName }) : t("notSent", { name: person.firstName }));
      } catch {
        toast.error(t("notSent", { name: person.firstName }));
      }
    },
    [invitations.send, t]
  );

  const showSignIn = Boolean(data?.items.some((row) => row.signIn));
  const columns = useMemo(
    () => [
      column.accessor("displayName", {
        id: "name",
        header: t("columns.person"),
        cell: ({ row }) => <PersonCell person={row.original} coming={coming.get(row.original.employeeKey)} />,
        meta: {
          width: "36%",
          skeleton: (
            <div className="flex w-full items-center gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="w-full space-y-1.5"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3 w-56" /></div>
            </div>
          ),
        },
      }),
      column.display({
        id: "manager",
        header: t("columns.manager"),
        cell: ({ row }) => {
          const manager = row.original.primaryManager;
          return manager ? (
            <span className="flex min-w-0 items-center gap-2">
              <Monogram name={manager.displayName} photoUrl={manager.photoUrl} size="xs" />
              <span className="truncate type-body">{manager.displayName}</span>
            </span>
          ) : (
            <DataTableCellEmpty />
          );
        },
        meta: { hideBelow: "md", skeleton: <Skeleton className="h-4 w-28" /> },
      }),
      column.display({
        id: "place",
        header: t("columns.place"),
        cell: ({ row }) => (row.original.work?.location ? <span className="truncate type-body">{row.original.work.location}</span> : <DataTableCellEmpty />),
        meta: { hideBelow: "lg", skeleton: <Skeleton className="h-4 w-20" /> },
      }),
      column.accessor("employmentStart", {
        id: "start",
        header: t("columns.tenure"),
        cell: ({ row }) => {
          const person = row.original;
          if (person.employmentState === "Scheduled") return <span className="type-meta text-muted-foreground">{t("startsOn", { date: day(person.employmentStart) })}</span>;
          if (person.employmentState === "Former") return <span className="type-meta text-muted-foreground">{t("leftOn", { date: day(person.employmentEnd) })}</span>;
          const span = tenure(person.employmentStart);
          if (!span) return <DataTableCellEmpty />;
          return <span className="type-body tabular-nums">{span.years >= 1 ? t("years", { count: span.years }) : t("months", { count: Math.max(1, span.months) })}</span>;
        },
        meta: { hideBelow: "lg", width: "9rem", skeleton: <Skeleton className="h-4 w-16" /> },
      }),
      ...(showSignIn
        ? [
            column.display({
              id: "signIn",
              header: t("columns.signIn"),
              cell: ({ row }) => <SignInCell person={row.original} />,
              meta: { width: "11rem", skeleton: <Skeleton className="h-4 w-24" /> },
            }),
          ]
        : []),
      column.display({
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row }) => (
          <RowMenu
            person={row.original}
            canLines={rights.lines}
            canAll={rights.people}
            canInvite={canInvite}
            onChange={changeSheet.start}
            onInvite={(person) => void invite(person)}
          />
        ),
        meta: { align: "end", width: "3.5rem", skeleton: <Skeleton className="size-8 rounded-control" /> },
      }),
    ],
    [t, day, coming, showSignIn, rights.lines, rights.people, canInvite, changeSheet.start, invite]
  );

  const sorting: SortingState = [{ id: sortParam.replace("-", "") === "start" ? "start" : "name", desc: sortParam.startsWith("-") }];
  const model = useDataTable({
    data: data?.items,
    columns,
    getRowId: (row) => row.employeeKey,
    manual: { rowCount: data?.totalCount ?? 0 },
    filters: filterFields,
    filterState,
    onFilterStateChange: (next) =>
      update(Object.fromEntries(filterFields.map((field) => [field.id, (next[field.id] as string[] | undefined)?.[0] ?? null]))),
    searchQuery: query.q ?? "",
    onSearchQueryChange: (q) => update({ q: q || null }),
    sorting,
    onSortingChange: (next) => {
      const [first] = next;
      update({ sort: !first ? null : `${first.desc ? "-" : ""}${first.id}` === "name" ? null : `${first.desc ? "-" : ""}${first.id}` }, true);
    },
    pagination: { pageIndex: (query.page ?? 1) - 1, pageSize: query.pageSize ?? 10 },
    onPaginationChange: (next) =>
      next.pageSize !== query.pageSize ? update({ size: String(next.pageSize) }) : update({ page: next.pageIndex <= 0 ? null : String(next.pageIndex + 1) }, true),
  });

  const views = data?.views;
  const tabs = VIEWS.filter((item) => {
    const count = views?.[item.count];
    if (item.slug === "everyone") return true;
    if (count === null || count === undefined) return false;
    return item.slug !== "left" || count > 0;
  }).map((item) => {
    const next = new URLSearchParams();
    if (item.slug !== "everyone") next.set("view", item.slug);
    const layout = searchParams.get("layout");
    if (layout) next.set("layout", layout);
    const count = views?.[item.count];
    return {
      key: item.slug,
      label: t(`views.${item.slug}`),
      href: next.size ? `${pathname}?${next}` : pathname,
      count: typeof count === "number" ? count : undefined,
    };
  });

  if (people.isLoading && !data) return <PeoplePendingContent />;

  return (
    <>
      {header(views?.everyone ?? null)}
      <LinkTabs label={t("views.label")} tabs={tabs} current={current.slug} className="mb-4" />
      <DataTable
        model={model}
        isLoading={people.isLoading && !data}
        isRefreshing={people.isFetching && Boolean(data)}
        skeletonRows={query.pageSize}
        searchPlaceholder={t("search")}
        actions={
          <div className="flex items-center gap-2">
            <LayoutSwitch value="table" />
            <DataTableExport onExport={exportPeople} disabled={!data || data.totalCount === 0} />
          </div>
        }
        error={
          people.error && !data ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="type-body text-muted-foreground">{t("error")}</p>
              <Button variant="outline" size="sm" onClick={() => void people.refetch()}>{t("retry")}</Button>
            </div>
          ) : null
        }
        emptyState={<p className="py-12 text-center type-body text-muted-foreground">{t(`empty.${current.slug}`)}</p>}
        noResults={t("noResults")}
        noun={[t("noun.one"), t("noun.other")]}
        pageSizes={PAGE_SIZES}
        onRowClick={(row) => router.push(`/people/${row.employeeKey}`)}
        minWidth="720px"
      />
      {changeSheet.element}
    </>
  );
}
