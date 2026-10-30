"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import type { PersonRoleDto, PersonRoleReasonDto } from "@repo/api";
import { Button, Skeleton } from "@repo/ds";
import { usePersonRoles } from "@/features/settings/api/use-core-access";
import { useSettingsSay, type Say } from "@/features/settings/say";
import { conditionWords, useRuleValues } from "./role-words";

function reasonWords(reason: PersonRoleReasonDto, names: Map<string, string>, say: Say): string {
  switch (reason.kind) {
    case "everyone":
      return say("roles.access.everyone");
    case "team":
      return say("roles.access.team", { count: reason.directReports ?? 0 });
    case "rule":
      return conditionWords(reason.conditions, names, say).join(", ");
    case "administrator":
      return say("roles.access.administrator");
    default:
      return say("roles.access.chosen");
  }
}

function RoleRow({ role, names, say }: { role: PersonRoleDto; names: Map<string, string>; say: Say }) {
  const name = role.isAdministrators ? say("roles.administrators.name") : role.name;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
      <Link
        href={`/settings/roles/${role.roleId}`}
        aria-label={say("roles.access.open", { role: name })}
        className="rounded-control-sm type-label text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {name}
      </Link>
      <span className="type-meta text-muted-foreground">
        {role.reasons.map((reason) => reasonWords(reason, names, say)).join(" · ")}
      </span>
    </li>
  );
}

/** A person's roles on their Access tab, each with why they have it (D-25). */
export function PersonRoles({ employeeId }: { employeeId: string }) {
  const say = useSettingsSay();
  const roles = usePersonRoles(employeeId);
  const { names } = useRuleValues();

  return (
    <section aria-labelledby="profile-roles">
      <h2 id="profile-roles" className="mb-3 type-section-title">{say("roles.access.title")}</h2>
      {roles.error && !roles.data ? (
        <div className="flex items-center justify-between gap-4 rounded-surface border border-dashed px-5 py-4">
          <p className="type-body text-muted-foreground">{say("roles.access.didNotLoad")}</p>
          <Button variant="ghost" size="sm" onClick={() => void roles.refetch()}>
            <RotateCcw className="size-4" aria-hidden /> {say("roles.reload")}
          </Button>
        </div>
      ) : !roles.data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-5 w-44" />
        </div>
      ) : roles.data.length === 0 ? (
        <p className="type-body text-muted-foreground">{say("roles.access.none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {roles.data.map((role) => (
            <RoleRow key={role.roleId} role={role} names={names} say={say} />
          ))}
        </ul>
      )}
    </section>
  );
}
