"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import type { RoleAreaDto, RoleAreaId, RoleHolderDto } from "@repo/api";
import {
  cn,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  NativeSelect,
  NativeSelectOption,
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
    <span className="inline-flex h-7 shrink-0 items-center rounded-control-sm border border-border bg-card px-2.5 type-meta-strong text-foreground">
      {children}
    </span>
  );
}

function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex animate-in items-center gap-3 py-3 fade-in-0 duration-200">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-meta text-muted-foreground">{label}</span>
        <span className="truncate type-body text-foreground">{value}</span>
      </div>
      {action}
    </div>
  );
}

function Outside({ children }: { children: ReactNode }) {
  return (
    <p className="flex animate-in items-center gap-2 py-3 type-meta text-muted-foreground fade-in-0 duration-200">
      <EyeOff aria-hidden className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

function SubjectPicker({ subject, onPick, say }: { subject: Person | null; onPick: (person: Person) => void; say: Say }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const candidates = useRoleCandidates(search, open);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-control border border-border bg-card px-2.5 type-meta-strong text-foreground outline-none hover:bg-inlay focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">{subject?.name ?? say("roles.preview.subject")}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={say("roles.findPerson")} value={search} onValueChange={setSearch} />
          <CommandList>
            {candidates.data && candidates.data.length === 0 ? <CommandEmpty>{say("roles.nobodyFound")}</CommandEmpty> : null}
            {(candidates.data ?? []).map((candidate) => (
              <CommandItem
                key={candidate.userId}
                value={candidate.userId}
                onSelect={() => {
                  onPick({ employeeId: candidate.employeeId, name: candidate.name });
                  setOpen(false);
                }}
              >
                <PersonAvatar name={candidate.name} size="xs" />
                <span className="truncate">{candidate.name}</span>
              </CommandItem>
            ))}
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
}: {
  roleName: string;
  areas: RoleAreaDto[];
  cells: Cells;
  holders: RoleHolderDto[];
  canSearch: boolean;
}) {
  const say = useSettingsSay();
  const defaults = useRoleCandidates("", canSearch);
  // Seen by one of its holders; a role nobody (with a person record) holds yet is previewed as anyone who signs in.
  const people = useMemo(() => {
    const holding = holders.filter((holder) => holder.employeeId).map((holder) => ({ employeeId: holder.employeeId!, name: holder.name }));
    return holding.length ? holding : (defaults.data ?? []).map((candidate) => ({ employeeId: candidate.employeeId, name: candidate.name }));
  }, [holders, defaults.data]);
  const [viewerId, setViewerId] = useState<string | null>(null);
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

  return (
    <aside aria-label={say("roles.preview.viewer")} className="flex flex-col gap-3 lg:sticky lg:top-6">
      <div className="flex flex-col gap-3">
        <h2 className="type-section-title">
          {viewer && subject
            ? relation === "self"
              ? say("roles.preview.titleSelf", { viewer: firstName(viewer) })
              : say("roles.preview.title", { viewer: firstName(viewer), subject: subject.name })
            : say("roles.preview.nobody", { role: roleName })}
        </h2>
        {viewer ? (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              aria-label={say("roles.preview.viewer")}
              value={viewer.employeeId}
              onChange={(event) => setViewerId(event.target.value)}
              className="max-w-48"
            >
              {people.map((option) => (
                <NativeSelectOption key={option.employeeId} value={option.employeeId}>
                  {option.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {canSearch ? <SubjectPicker subject={subject} onPick={setPicked} say={say} /> : null}
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-surface border border-border bg-card">
        {!viewer ? (
          <p className="px-5 py-10 text-center type-body text-muted-foreground">{say("roles.preview.nobodyLine")}</p>
        ) : details.error && !person ? (
          <p className="px-5 py-10 text-center type-body text-muted-foreground">{say("roles.preview.didNotLoad")}</p>
        ) : !person ? (
          <div className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-3">
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
            <div className="flex flex-col gap-4 bg-inlay px-5 pt-5">
              <div className="flex items-center gap-3">
                <PersonAvatar name={person.displayName} size="lg" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate type-panel-title">{person.displayName}</span>
                  <span className="truncate type-meta text-muted-foreground">
                    {[work?.orgUnitName, work?.workLocation].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              <nav aria-label={say("roles.preview.subject")} className="-mb-px flex gap-4 overflow-hidden">
                {tabs
                  .filter((tab) => tab.shown)
                  .map((tab, index) => (
                    <span
                      key={tab.id}
                      className={cn(
                        "animate-in border-b-2 pb-2.5 type-meta-strong fade-in-0 duration-200",
                        index === 0 ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
                      )}
                    >
                      {say(`roles.preview.tabs.${tab.id}`)}
                    </span>
                  ))}
              </nav>
            </div>
            <div className="flex flex-col divide-y divide-border px-5">
              {on("job") ? (
                <Row
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
              {on("personal") ? (
                <Row
                  label={say("roles.preview.personal")}
                  value={person.phone ?? say("roles.preview.noPhone")}
                  action={personal.level === "change" ? <Action>{say("roles.preview.edit")}</Action> : null}
                />
              ) : blocked("personal") ? (
                <Outside>{outside("personal")}</Outside>
              ) : null}
              {on("plans") ? (
                <Row
                  label={say("roles.preview.performance")}
                  value={say("roles.preview.plan")}
                  action={plans.level === "change" ? <Action>{say("roles.preview.update")}</Action> : null}
                />
              ) : blocked("plans") ? (
                <Outside>{outside("plans")}</Outside>
              ) : null}
              {on("approve") && cellOf(cells, "approve").level === "approve" ? (
                <Row label={say("roles.preview.changes")} value={say("roles.preview.approve")} />
              ) : null}
              {on("signin") ? (
                <Row
                  label={say("roles.preview.signin")}
                  value={say("roles.preview.signsIn")}
                  action={cellOf(cells, "signin").level === "change" ? <Action>{say("roles.preview.manage")}</Action> : null}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
