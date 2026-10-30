"use client";

import { useMemo } from "react";
import type {
  OrganizationHierarchyNodeDto,
  RoleCellDto,
  RoleConditionDto,
  RoleConditionKind,
  RoleSummaryDto,
} from "@repo/api";
import { useJobs, usePlaces } from "@/features/catalog/api/use-catalog";
import { useOrganizationHierarchy } from "@/features/organization/api/use-organization";
import type { Say } from "@/features/settings/say";

/** Core HR's Department type (OrganizationalUnitTypeCatalog.DepartmentId): a department rule picks among these. */
export const DEPARTMENT_TYPE_ID = "44444444-4444-4444-4444-444444444444";

export interface RuleValue {
  id: string;
  name: string;
  /** Where it sits, to tell two units of one name apart. */
  detail: string | null;
}

export type RuleValues = Record<RoleConditionKind, RuleValue[]>;

function flatten(nodes: OrganizationHierarchyNodeDto[], into: OrganizationHierarchyNodeDto[] = []): OrganizationHierarchyNodeDto[] {
  for (const node of nodes) {
    into.push(node);
    flatten(node.children, into);
  }
  return into;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The company's departments, units, jobs and places a rule can name, and every one's name by id. */
export function useRuleValues(enabled = true) {
  const hierarchy = useOrganizationHierarchy(today(), enabled);
  const jobs = useJobs(enabled);
  const places = usePlaces(enabled);

  return useMemo(() => {
    const units = flatten(hierarchy.data?.roots ?? []).map((node) => node.unit);
    const values: RuleValues = {
      department: units
        .filter((unit) => unit.typeId === DEPARTMENT_TYPE_ID)
        .map((unit) => ({ id: unit.id, name: unit.name, detail: unit.parentName })),
      unit: units.map((unit) => ({ id: unit.id, name: unit.name, detail: unit.typeName })),
      job: (jobs.data ?? []).filter((job) => !job.isRetired).map((job) => ({ id: job.id, name: job.title, detail: job.family?.label ?? null })),
      place: (places.data ?? []).filter((place) => !place.isRetired).map((place) => ({ id: place.id, name: place.name, detail: place.city })),
    };
    const names = new Map<string, string>();
    for (const unit of units) names.set(unit.id, unit.name);
    for (const job of jobs.data ?? []) names.set(job.id, job.title);
    for (const place of places.data ?? []) names.set(place.id, place.name);
    return { values, names, loading: hierarchy.isLoading || jobs.isLoading || places.isLoading };
  }, [hierarchy.data, hierarchy.isLoading, jobs.data, jobs.isLoading, places.data, places.isLoading]);
}

/** "See · their team", "Change · everyone", "No access". */
export function settingWords(cell: RoleCellDto, say: Say): string {
  const level = say(`roles.levels.${cell.level}`);
  return cell.reach ? `${level} · ${say(`roles.reaches.${cell.reach}`)}` : level;
}

/** "Department is People & Growth or Finance", one line per kind, joined. */
export function conditionWords(conditions: RoleConditionDto[], names: Map<string, string>, say: Say): string[] {
  const kinds = [...new Set(conditions.map((condition) => condition.kind))];
  return kinds.map((kind) => {
    const values = conditions
      .filter((condition) => condition.kind === kind)
      .map((condition) => names.get(condition.targetId) ?? say("roles.unknownValue"));
    return `${say(`roles.conditionKinds.${kind}`)} ${say("roles.is")} ${values.join(` ${say("roles.or")} `)}`;
  });
}

/** Under a role's name in the table: how people come to have it. */
export function holderSummary(role: RoleSummaryDto, names: Map<string, string>, say: Say): string {
  if (role.isAdministrators) return say("roles.holders.protected");
  switch (role.holderKind) {
    case "everyone":
      return say("roles.holders.everyone");
    case "team":
      return say("roles.holders.team");
    case "rule": {
      const first = role.conditions[0];
      const name = first ? names.get(first.targetId) : undefined;
      if (!name) return say("roles.holders.summaryRule");
      return role.conditions.length > 1 ? `${name} + ${role.conditions.length - 1}` : name;
    }
    default:
      return say("roles.holders.chosen");
  }
}
