import { englishSay, type Say } from "@repo/ds/lib/say";
import { englishMessages } from "@/i18n/messages";
import type {
  OrganizationHierarchyDto,
  OrganizationHierarchyNodeDto,
  OrganizationUnitStateDto,
} from "@repo/api";

export interface OrganizationHierarchyModel {
  asOf: string;
  roots: string[];
  units: OrganizationUnitStateDto[];
  byId: Map<string, OrganizationUnitStateDto>;
  childrenByParent: Map<string | null, string[]>;
  parentById: Map<string, string | null>;
  depthById: Map<string, number>;
  pathById: Map<string, string[]>;
  descendantsById: Map<string, Set<string>>;
}

export interface VisibleOrganizationRow {
  unit: OrganizationUnitStateDto;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export function buildOrganizationHierarchy(
  hierarchy: OrganizationHierarchyDto
): OrganizationHierarchyModel {
  const units: OrganizationUnitStateDto[] = [];
  const byId = new Map<string, OrganizationUnitStateDto>();
  const childrenByParent = new Map<string | null, string[]>();
  const parentById = new Map<string, string | null>();
  const depthById = new Map<string, number>();
  const pathById = new Map<string, string[]>();

  function visit(node: OrganizationHierarchyNodeDto, depth: number, ancestors: string[]) {
    const { unit } = node;
    units.push(unit);
    byId.set(unit.id, unit);
    parentById.set(unit.id, unit.parentId);
    depthById.set(unit.id, depth);
    pathById.set(unit.id, [...ancestors, unit.id]);
    const childIds = node.children.map((child) => child.unit.id);
    childrenByParent.set(unit.id, childIds);
    for (const child of node.children) visit(child, depth + 1, [...ancestors, unit.id]);
  }

  const roots = hierarchy.roots.map((root) => root.unit.id);
  childrenByParent.set(null, roots);
  for (const root of hierarchy.roots) visit(root, 0, []);

  const descendantsById = new Map<string, Set<string>>();
  function descendants(id: string): Set<string> {
    const cached = descendantsById.get(id);
    if (cached) return cached;
    const result = new Set<string>();
    for (const childId of childrenByParent.get(id) ?? []) {
      result.add(childId);
      for (const descendant of descendants(childId)) result.add(descendant);
    }
    descendantsById.set(id, result);
    return result;
  }
  for (const unit of units) descendants(unit.id);

  return {
    asOf: hierarchy.asOf,
    roots,
    units,
    byId,
    childrenByParent,
    parentById,
    depthById,
    pathById,
    descendantsById,
  };
}

export function revealOrganizationUnit(collapsed: ReadonlySet<string>, model: OrganizationHierarchyModel, id: string) {
  const next = new Set(collapsed);
  for (const ancestor of model.pathById.get(id) ?? []) next.delete(ancestor);
  return next;
}

const ENGLISH = englishSay(englishMessages, "organization");

export function organizationAccessibleName(model: OrganizationHierarchyModel, id: string, say: Say = ENGLISH) {
  const unit = model.byId.get(id);
  if (!unit) return say("unit");
  const ancestors = (model.pathById.get(id) ?? [])
    .slice(0, -1)
    .map((ancestorId) => model.byId.get(ancestorId)?.name)
    .filter(Boolean);
  const facts = { name: unit.name, type: unit.typeName, code: unit.code };
  return ancestors.length
    ? say("accessible.under", { ...facts, path: ancestors.join(" / ") })
    : say("accessible.root", facts);
}

export function isInvalidMoveTarget(model: OrganizationHierarchyModel, sourceId: string, targetId: string) {
  return sourceId === targetId || model.descendantsById.get(sourceId)?.has(targetId) === true;
}

/**
 * Deterministic actionable leaf beneath a unit whose Inactivate is blocked by
 * active descendants. Follows the first-child chain (stable hierarchy order) to
 * the bottom so the recovery lands on a unit that can be inactivated immediately
 * rather than another blocked intermediate parent. Returns null for a leaf.
 */
export function deepestBlockingUnit(model: OrganizationHierarchyModel, id: string): string | null {
  let current = id;
  for (;;) {
    const children = model.childrenByParent.get(current) ?? [];
    if (children.length === 0) return current === id ? null : current;
    current = children[0]!;
  }
}
