"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Lock, Plus } from "lucide-react";
import type { FusionSettingsSection, RoleAreaDto, RoleCellDto, RoleSummaryDto } from "@repo/api";
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
import { holderSummary, useRuleValues } from "./role-words";

const GROUPS = ["core", "performance", "company"] as const;

/** Two marks: one for a look (see, propose), both for acting (change, approve). */
export function LevelPips({ cell, quiet }: { cell: RoleCellDto; quiet?: boolean }) {
  const weight = weightOf(cell.level);
  return (
    <span aria-hidden className="inline-flex shrink-0 gap-0.5">
      {[1, 2].map((step) => (
        <span
          key={step}
          className={cn(
            "h-2.5 w-1.5 rounded-detail",
            step <= weight ? (quiet ? "bg-muted-foreground" : "bg-foreground") : "bg-border"
          )}
        />
      ))}
    </span>
  );
}

function Cell({ cell, say, quiet }: { cell: RoleCellDto; say: Say; quiet?: boolean }) {
  if (cell.level === "none") {
    return <span aria-label={say("roles.levels.none")} className="mt-2.5 block h-px w-3 bg-border" />;
  }
  return (
    <span className="flex items-start gap-2">
      <span className="pt-1">
        <LevelPips cell={cell} quiet={quiet} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("type-meta-strong", quiet ? "text-muted-foreground" : "text-foreground")}>{say(`roles.levels.${cell.level}`)}</span>
        {cell.reach ? <span className="type-meta text-muted-foreground">{say(`roles.reaches.${cell.reach}`)}</span> : null}
      </span>
    </span>
  );
}

function Faces({ role }: { role: RoleSummaryDto }) {
  return (
    <span className="flex items-center gap-2">
      {role.faces.length ? (
        <span className="flex -space-x-1.5">
          {role.faces.map((face) => (
            <PersonAvatar key={face.userId} name={face.name} size="xs" className="ring-2 ring-card" />
          ))}
        </span>
      ) : null}
      <span className="type-meta text-muted-foreground tabular-nums">{role.holderCount}</span>
    </span>
  );
}

function RoleHeader({ role, names, say }: { role: RoleSummaryDto; names: Map<string, string>; say: Say }) {
  return (
    <Link
      href={`/settings/roles/${role.id}`}
      className="group flex min-w-32 flex-col gap-1.5 rounded-control px-2 py-2 text-start outline-none transition-colors hover:bg-inlay focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center gap-1.5 type-label text-foreground">
        {role.isAdministrators ? say("roles.administrators.name") : role.name}
        {role.isAdministrators ? <Lock aria-hidden className="size-3.5 text-muted-foreground" /> : null}
        <ChevronRight aria-hidden className="ms-auto size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
      </span>
      <span className="type-meta text-muted-foreground">{holderSummary(role, names, say)}</span>
      <Faces role={role} />
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

function Matrix({ areas, roles, say, names }: { areas: RoleAreaDto[]; roles: RoleSummaryDto[]; say: Say; names: Map<string, string> }) {
  const cells = roles.map((role) => toCells(role.cells));
  return (
    <div className="overflow-x-auto rounded-surface border border-border bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border align-bottom">
            <th scope="col" className="sticky start-0 z-10 min-w-52 bg-card px-5 py-3">
              <span className="sr-only">{say("roles.title")}</span>
            </th>
            {roles.map((role) => (
              <th key={role.id} scope="col" className={cn("px-2 py-2 font-normal", role.isAdministrators && "bg-inlay")}>
                <RoleHeader role={role} names={names} say={say} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((group) => {
            const rows = areas.filter((area) => area.group === group);
            if (!rows.length) return null;
            return [
              <tr key={group}>
                <th scope="colgroup" colSpan={roles.length + 1} className="sticky start-0 bg-card px-5 pt-6 pb-2 text-start font-normal">
                  <span className="type-subsection-title">{say(`roles.groups.${group}`)}</span>
                </th>
              </tr>,
              ...rows.map((area) => (
                <tr key={area.id} className="border-t border-border first:border-t-0">
                  <th scope="row" className="sticky start-0 z-10 bg-card px-5 py-3 text-start font-normal">
                    <span className="whitespace-nowrap type-label text-foreground">{say(`roles.areas.${area.id}.label`)}</span>
                  </th>
                  {roles.map((role, index) => (
                    <td key={role.id} className={cn("px-4 py-3 align-top", role.isAdministrators && "bg-inlay")}>
                      {area.administratorsOnly && !role.isAdministrators ? (
                        <span aria-label={say("roles.administratorsOnly")} className="mt-2.5 block h-px w-3 bg-border" />
                      ) : (
                        <Cell cell={cellOf(cells[index]!, area.id)} say={say} quiet={role.isAdministrators} />
                      )}
                    </td>
                  ))}
                </tr>
              )),
            ];
          })}
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
