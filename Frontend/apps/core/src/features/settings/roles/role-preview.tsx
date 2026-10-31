"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, EyeOff, UserRoundSearch } from "lucide-react";
import type { RoleAreaDto, RoleAreaId, RoleHolderDto } from "@repo/api";
import {
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  PersonAvatar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@repo/ds";
import { formatDate } from "@repo/ds/lib/dates";
import { useEmployeeDetailsById } from "@/features/people/api/use-employees";
import { useRoleCandidates } from "@/features/settings/api/use-core-access";
import { useSettingsSay, type Say } from "@/features/settings/say";
import { cellOf, type Cells } from "./role-model";

type Relation = "self" | "team" | "elsewhere";

interface Person {
  employeeId: string;
  name: string;
}

/** Whether a cell reaches the page's subject from where the viewer stands. */
function reaches(cells: Cells, area: RoleAreaId, relation: Relation): boolean {
  const cell = cellOf(cells, area);
  if (cell.level === "none") return false;
  if (!cell.reach || cell.reach === "everyone") return true;
  if (cell.reach === "team") return relation !== "elsewhere";
  return relation === "self";
}

function Action({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[26px] shrink-0 items-center rounded-control-sm border border-border bg-card px-[9px] type-meta-strong text-foreground">
      {children}
    </span>
  );
}

/** The drawing's quiet link-style action on a preview row. */
function TextAction({ children }: { children: ReactNode }) {
  return <span className="shrink-0 type-control-label text-foreground">{children}</span>;
}

function Section({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid animate-in gap-0.5 border-t border-border py-3 fade-in-0 duration-300 first:border-t-0">
      <span className="type-meta text-muted-foreground">{label}</span>
      <div className="flex min-h-7 items-center justify-between gap-2.5">
        <span className="min-w-0 truncate type-control text-foreground">{value}</span>
        {action}
      </div>
    </div>
  );
}

function Outside({ children }: { children: ReactNode }) {
  return (
    <p className="flex animate-in items-center gap-2 border-t border-border py-3 type-control text-muted-foreground fade-in-0 duration-300 first:border-t-0">
      <EyeOff aria-hidden className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/** One picker for the preview: who looks (the role's holders) and whose page (anyone who signs in). */
function PeoplePicker({
  viewer,
  subject,
  holders,
  canSearch,
  onViewer,
  onSubject,
  say,
}: {
  viewer: Person;
  subject: Person | null;
  holders: Person[];
  canSearch: boolean;
  onViewer: (person: Person) => void;
  onSubject: (person: Person) => void;
  say: Say;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const candidates = useRoleCandidates(search, open && canSearch);
  const needle = search.trim().toLowerCase();
  const seenBy = holders.filter((person) => !needle || person.name.toLowerCase().includes(needle));
  const pageOf = (candidates.data ?? []).map((candidate) => ({ employeeId: candidate.employeeId, name: candidate.name }));
  const item = (person: Person, current: boolean, pick: (person: Person) => void, key: string) => (
    <CommandItem
      key={key}
      value={key}
      onSelect={() => {
        pick(person);
        setOpen(false);
      }}
    >
      <PersonAvatar name={person.name} size="xs" />
      <span className="truncate">{person.name}</span>
      {current ? <Check aria-hidden className="ms-auto size-3.5" /> : null}
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={say("roles.preview.choose")}
        className="inline-flex h-[34px] min-w-0 shrink-0 items-center gap-2 rounded-control border border-border bg-card px-3 type-control text-foreground outline-none hover:bg-inlay focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-inlay"
      >
        <UserRoundSearch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{(subject ?? viewer).name.split(" ")[0]}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={say("roles.findPerson")} value={search} onValueChange={setSearch} />
          <CommandList>
            {seenBy.length === 0 && pageOf.length === 0 ? <CommandEmpty>{say("roles.nobodyFound")}</CommandEmpty> : null}
            {seenBy.length > 1 ? (
              <CommandGroup heading={say("roles.preview.viewer")}>
                {seenBy.map((person) => item(person, person.employeeId === viewer.employeeId, onViewer, `viewer-${person.employeeId}`))}
              </CommandGroup>
            ) : null}
            {canSearch && pageOf.length ? (
              <CommandGroup heading={say("roles.preview.subject")}>
                {pageOf.map((person) => item(person, person.employeeId === subject?.employeeId, onSubject, `subject-${person.employeeId}`))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A real person's page as one of the role's holders would see it with this role alone, following the draft as it
 * changes: tabs, sections and actions appear and go, and what's out of reach says why.
 */
export function RolePreview({
  roleName,
  areas,
  cells,
  holders,
  canSearch,
  viewerId,
  onViewerId,
}: {
  roleName: string;
  areas: RoleAreaDto[];
  cells: Cells;
  holders: RoleHolderDto[];
  canSearch: boolean;
  /** Who looks, by employee id; the role page keeps it so "See Fusion as" names the same person. */
  viewerId: string | null;
  onViewerId: (employeeId: string) => void;
}) {
  const say = useSettingsSay();
  const defaults = useRoleCandidates("", canSearch);
  // Seen by one of its holders; a role nobody (with a person record) holds yet is previewed as anyone who signs in.
  const people = useMemo(() => {
    const holding = holders.filter((holder) => holder.employeeId).map((holder) => ({ employeeId: holder.employeeId!, name: holder.name }));
    return holding.length ? holding : (defaults.data ?? []).map((candidate) => ({ employeeId: candidate.employeeId, name: candidate.name }));
  }, [holders, defaults.data]);
  const viewer = people.find((person) => person.employeeId === viewerId) ?? people[0] ?? null;
  const [picked, setPicked] = useState<Person | null>(null);
  const fallback = canSearch
    ? (defaults.data ?? [])
        .filter((candidate) => candidate.employeeId !== viewer?.employeeId)
        .map((candidate) => ({ employeeId: candidate.employeeId, name: candidate.name }))[0] ?? null
    : viewer;
  const subject = picked ?? fallback;
  const details = useEmployeeDetailsById(viewer && subject ? subject.employeeId : null);

  const has = (area: RoleAreaId) => areas.some((candidate) => candidate.id === area);
  const relation: Relation = !viewer || !subject
    ? "elsewhere"
    : subject.employeeId === viewer.employeeId
      ? "self"
      : details.data?.currentManager?.managerEmployeeId === viewer.employeeId
        ? "team"
        : "elsewhere";
  const firstName = (person: Person | null) => person?.name.split(" ")[0] ?? "";
  const outside = (area: RoleAreaId) =>
    say("roles.preview.outside", {
      area: say(`roles.areas.${area}.label`),
      subject: firstName(subject),
      where:
        cellOf(cells, area).reach === "self"
          ? say("roles.preview.whereSelf", { viewer: firstName(viewer) })
          : say("roles.preview.whereTeam", { viewer: firstName(viewer) }),
    });
  const on = (area: RoleAreaId) => has(area) && reaches(cells, area, relation);
  const blocked = (area: RoleAreaId) => has(area) && cellOf(cells, area).level !== "none" && !on(area);

  const tabs: { id: string; shown: boolean }[] = [
    { id: "overview", shown: true },
    { id: "job", shown: on("job") },
    { id: "personal", shown: on("personal") },
    { id: "performance", shown: on("plans") },
    { id: "access", shown: on("signin") },
  ];

  const person = details.data;
  const work = person?.currentWorkAssignment;
  const job = cellOf(cells, "job");
  const personal = cellOf(cells, "personal");
  const plans = cellOf(cells, "plans");
  const proposes = cellOf(cells, "approve").level === "propose" && relation === "team";

  const title =
    viewer && subject
      ? relation === "self"
        ? say("roles.preview.titleSelf", { viewer: firstName(viewer) })
        : say("roles.preview.title", { viewer: firstName(viewer), subject: subject.name })
      : say("roles.preview.nobody", { role: roleName });

  return (
    <aside aria-label={say("roles.preview.viewer")} className="grid gap-3 rounded-surface bg-section p-4 lg:sticky lg:top-5">
      <div className="flex min-h-[34px] items-center justify-between gap-3">
        <h2 className="min-w-0 truncate type-subsection-title">{title}</h2>
        {viewer && (people.length > 1 || canSearch) ? (
          <PeoplePicker
            viewer={viewer}
            subject={subject}
            holders={people}
            canSearch={canSearch}
            onViewer={(person) => onViewerId(person.employeeId)}
            onSubject={setPicked}
            say={say}
          />
        ) : null}
      </div>

      <div className="overflow-hidden rounded-menu border border-border bg-background">
        {!viewer ? (
          <p className="px-5 py-10 text-center type-body text-muted-foreground">{say("roles.preview.nobodyLine")}</p>
        ) : details.error && !person ? (
          <p className="px-5 py-10 text-center type-body text-muted-foreground">{say("roles.preview.didNotLoad")}</p>
        ) : !person ? (
          <div className="flex flex-col gap-3 p-[18px]">
            <div className="flex items-center gap-3.5">
              <Skeleton className="size-14 rounded-full" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 bg-section px-[18px] pt-[18px]">
              <PersonAvatar name={person.displayName} size="xl" className="size-14 text-lg" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate type-section-title">{person.displayName}</span>
                <span className="truncate type-meta text-muted-foreground">
                  {[work?.orgUnitName, work?.workLocation].filter(Boolean).join(" · ")}
                </span>
              </div>
              <nav aria-label={say("roles.preview.subject")} className="col-span-full mt-3.5 flex overflow-hidden">
                {tabs
                  .filter((tab) => tab.shown)
                  .map((tab, index) => (
                    <span
                      key={tab.id}
                      className={cn(
                        "relative animate-in px-[9px] pt-2 pb-2.5 type-control-label fade-in-0 duration-300",
                        index === 0
                          ? "text-foreground after:absolute after:inset-x-[9px] after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                          : "text-muted-foreground"
                      )}
                    >
                      {say(`roles.preview.tabs.${tab.id}`)}
                    </span>
                  ))}
              </nav>
            </div>
            <div className="grid px-[18px] pt-1.5 pb-3.5">
              {on("job") ? (
                <Section
                  label={say("roles.preview.job")}
                  value={
                    work
                      ? `${work.jobTitle} · ${say("roles.preview.since", { date: formatDate(new Date(work.effectiveFrom), { year: "always" }) })}`
                      : ""
                  }
                  action={
                    job.level === "change" ? (
                      <Action>{say("roles.preview.makeChange")}</Action>
                    ) : proposes ? (
                      <Action>{say("roles.preview.proposeChange")}</Action>
                    ) : null
                  }
                />
              ) : blocked("job") ? (
                <Outside>{outside("job")}</Outside>
              ) : null}
              {on("approve") && cellOf(cells, "approve").level === "approve" ? (
                <Section label={say("roles.preview.changes")} value={say("roles.preview.approve")} />
              ) : null}
              {on("personal") ? (
                <Section
                  label={say("roles.preview.personal")}
                  value={person.phone ?? say("roles.preview.noPhone")}
                  action={personal.level === "change" ? <TextAction>{say("roles.preview.edit")}</TextAction> : null}
                />
              ) : blocked("personal") ? (
                <Outside>{outside("personal")}</Outside>
              ) : null}
              {on("plans") ? (
                <Section
                  label={say("roles.preview.performance")}
                  value={say("roles.preview.plan")}
                  action={plans.level === "change" ? <TextAction>{say("roles.preview.update")}</TextAction> : null}
                />
              ) : blocked("plans") ? (
                <Outside>{outside("plans")}</Outside>
              ) : null}
              {on("signin") ? (
                <Section
                  label={say("roles.preview.signin")}
                  value={say("roles.preview.signsIn")}
                  action={cellOf(cells, "signin").level === "change" ? <TextAction>{say("roles.preview.manage")}</TextAction> : null}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
