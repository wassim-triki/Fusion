"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChartNoAxesColumn, Lock, Plus, Users } from "lucide-react";
import { MINIMUM_ADMINISTRATORS, type FusionSettingsSection, type RoleAreaDto, type RoleCellDto, type RoleSummaryDto } from "@repo/api";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PersonAvatar,
} from "@repo/ds";
import { PageError, SettingsPage, useSettingsSectionName } from "@repo/ds/shell";
import { useCreateRole, useRoles } from "@/features/settings/api/use-core-access";
import { useSaveFailure, useSettingsSay, type Say } from "@/features/settings/say";
import { cellOf, toCells, weightOf } from "./role-model";
import { ADMINISTRATORS_PATH } from "./paths";
import { holderSummary, useRuleValues } from "./role-words";

const GROUPS = ["core", "performance", "company"] as const;

/** Two marks: one for a look (see, propose), both for acting (change, approve). */
export function LevelPips({ cell }: { cell: RoleCellDto }) {
  const weight = weightOf(cell.level);
  return (
    <span aria-hidden className="inline-flex shrink-0 gap-[3px]">
      {[1, 2].map((step) => (
        <span
          key={step}
          className={cn(
            // eslint-disable-next-line no-restricted-syntax -- the drawing's 12×8 pip, a mark below the radius roles
            "h-2 w-3 rounded-[3px] border",
            step <= weight ? "border-transparent bg-foreground/78" : "border-input bg-inlay"
          )}
        />
      ))}
    </span>
  );
}

function Cell({ cell, say }: { cell: RoleCellDto; say: Say }) {
  if (cell.level === "none") {
    return (
      <span aria-label={say("roles.levels.none")} className="type-control text-muted-foreground">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[9px] whitespace-nowrap type-control-label text-foreground">
      <LevelPips cell={cell} />
      {say(`roles.levels.${cell.level}`)}
      {cell.reach ? <span className="font-normal text-muted-foreground">{say(`roles.reaches.${cell.reach}`)}</span> : null}
    </span>
  );
}

function Faces({ role, say }: { role: RoleSummaryDto; say: Say }) {
  const short = role.isAdministrators && role.holderCount < MINIMUM_ADMINISTRATORS;
  return (
    <span className="flex items-center gap-2">
      {role.faces.length ? (
        <span className="flex -space-x-2">
          {role.faces.map((face) => (
            <PersonAvatar key={face.userId} name={face.name} size="xs" className="ring-2 ring-card" />
          ))}
        </span>
      ) : null}
      <span className={cn("type-meta tabular-nums", short ? "text-warning" : "text-muted-foreground")}>
        {short
          ? say("roles.administrators.progressShort", { count: role.holderCount, minimum: MINIMUM_ADMINISTRATORS })
          : role.holderCount}
      </span>
    </span>
  );
}

function RoleHeader({ role, names, say }: { role: RoleSummaryDto; names: Map<string, string>; say: Say }) {
  return (
    <Link
      href={role.isAdministrators ? ADMINISTRATORS_PATH : `/settings/roles/${role.id}`}
      className="-m-3 grid gap-2 rounded-menu border border-transparent p-3 text-start outline-none transition-colors hover:bg-inlay focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-1.5 type-panel-title text-foreground" title={role.isAdministrators ? undefined : role.name}>
        <span className="truncate">{role.isAdministrators ? say("roles.administrators.name") : role.name}</span>
        {role.isAdministrators ? <Lock aria-hidden className="size-3.5 text-muted-foreground" /> : null}
      </span>
      <span className="truncate type-meta text-muted-foreground">{holderSummary(role, names, say)}</span>
      <Faces role={role} say={say} />
    </Link>
  );
}

function NewRoleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const say = useSettingsSay();
  const failure = useSaveFailure();
  const router = useRouter();
  const [name, setName] = useState("");
  const create = useCreateRole({ onSuccess: (role) => router.push(`/settings/roles/${role.role.id}`) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{say("roles.newRole")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-role-name">{say("roles.name")}</Label>
            <Input id="new-role-name" value={name} maxLength={100} autoFocus onChange={(event) => setName(event.target.value)} />
            {create.error ? <p role="alert" className="type-meta text-destructive">{failure(create.error, say("roles.notCreated"))}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {say("roles.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isLoading}>
              {say("roles.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const GROUP_ICON = { core: Users, performance: ChartNoAxesColumn, company: Building2 } as const;

/** A group's heading: a small amber tile and the group's name. */
export function AreaGroupTitle({ group, say }: { group: (typeof GROUPS)[number]; say: Say }) {
  const Icon = GROUP_ICON[group];
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-6 place-items-center rounded-control-sm bg-primary-tint text-primary-ink">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="type-subsection-title text-foreground">{say(`roles.groups.${group}`)}</span>
    </span>
  );
}

function Matrix({ areas, roles, say, names }: { areas: RoleAreaDto[]; roles: RoleSummaryDto[]; say: Say; names: Map<string, string> }) {
  const cells = roles.map((role) => toCells(role.cells));
  const groups = GROUPS.map((group) => ({ group, rows: areas.filter((area) => area.group === group) })).filter((g) => g.rows.length);
  return (
    <div className="overflow-x-auto rounded-surface bg-card px-1.5 pt-1 pb-1.5">
      <table className="w-full min-w-max table-fixed border-collapse">
        <colgroup>
          <col className="w-[230px]" />
          {roles.map((role) => (
            <col key={role.id} className="w-[180px]" />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="sticky start-0 z-10 bg-card px-3 pt-[22px] pb-3.5 ps-5 align-bottom">
              <span className="sr-only">{say("roles.title")}</span>
            </th>
            {roles.map((role) => (
              <th key={role.id} scope="col" className={cn("px-3 pt-[22px] pb-3.5 align-bottom font-normal", role.isAdministrators && "opacity-70")}>
                <RoleHeader role={role} names={names} say={say} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(({ group, rows }, groupIndex) => [
            <tr key={group} className="border-b border-border">
              <th scope="colgroup" colSpan={roles.length + 1} className="sticky start-0 h-[52px] bg-card px-3 ps-5 text-start align-middle font-normal">
                <AreaGroupTitle group={group} say={say} />
              </th>
            </tr>,
            ...rows.map((area, rowIndex) => (
              <tr
                key={area.id}
                className={cn("border-b border-border", groupIndex === groups.length - 1 && rowIndex === rows.length - 1 && "border-b-0")}
              >
                <th scope="row" className="sticky start-0 z-10 h-[50px] bg-card px-3 ps-5 text-start align-middle font-normal">
                  <span className="block truncate py-0.5 type-label text-foreground">{say(`roles.areas.${area.id}.label`)}</span>
                </th>
                {roles.map((role, index) => (
                  <td key={role.id} className={cn("h-[50px] px-3 align-middle", role.isAdministrators && "opacity-70")}>
                    {area.administratorsOnly && !role.isAdministrators ? (
                      <span aria-label={say("roles.administratorsOnly")} className="type-control text-muted-foreground">
                        —
                      </span>
                    ) : (
                      <Cell cell={cellOf(cells[index]!, area.id)} say={say} />
                    )}
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

/** Settings › Roles: every role and what it can do, side by side (D-25). */
export function RolesSettings({ section }: { section: FusionSettingsSection }) {
  const say = useSettingsSay();
  const sectionName = useSettingsSectionName();
  const title = sectionName(section);
  const editable = section.access === "manage";
  const roles = useRoles();
  const { names } = useRuleValues();
  const [creating, setCreating] = useState(false);

  if (roles.error && !roles.data) {
    return (
      <SettingsPage title={title} studio>
        <PageError title={say("roles.didNotLoad")} onRetry={() => void roles.refetch()} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={title}
      studio
      loading={!roles.data}
      lastChange={section.lastChange}
      setUpAt={section.setUpAt}
      viewOnly={!editable}
      aside={
        editable ? (
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            {say("roles.newRole")}
          </Button>
        ) : null
      }
    >
      {roles.data ? <Matrix areas={roles.data.areas} roles={roles.data.roles} say={say} names={names} /> : null}
      {editable ? <NewRoleDialog open={creating} onOpenChange={setCreating} /> : null}
    </SettingsPage>
  );
}
