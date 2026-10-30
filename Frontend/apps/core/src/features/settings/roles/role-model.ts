import type {
  PermissionScope,
  RoleAreaDto,
  RoleAreaId,
  RoleAreaOptionDto,
  RoleCellDto,
  RoleGrantDto,
  RoleLevel,
  RoleReach,
} from "@repo/api";

// The roles model on the page (B-177). Identity owns it; this mirrors its two rules so the editor shows what saving
// does before saving: a role is at the strongest option whose defining grants it holds, and saving writes each cell's
// defining and companion grants. Jobs and Personal details share Core HR's record today, so changing one can move
// the other; the editor shows that move instead of hiding it.

export type Cells = Partial<Record<RoleAreaId, RoleCellDto>>;

const RANK: Record<PermissionScope, number> = {
  None: 0,
  Self: 1,
  DirectReports: 2,
  OrgUnit: 2,
  Tenant: 3,
  Module: 3,
  Platform: 4,
};

/** The levels an area offers, weakest first, after "none". */
export function levelsOf(area: RoleAreaDto): RoleLevel[] {
  return ["none", ...new Set(area.options.map((option) => option.level))];
}

/** The reaches an area offers at a level, narrowest first; empty when the area has no reach. */
export function reachesOf(area: RoleAreaDto, level: RoleLevel): RoleReach[] {
  return area.options.filter((option) => option.level === level && option.reach).map((option) => option.reach!);
}

export function optionOf(area: RoleAreaDto, cell: RoleCellDto | undefined): RoleAreaOptionDto | undefined {
  if (!cell || cell.level === "none") return undefined;
  return area.options.find((option) => option.level === cell.level && option.reach === cell.reach);
}

export function toCells(cells: RoleCellDto[]): Cells {
  return Object.fromEntries(cells.map((cell) => [cell.areaId, cell]));
}

export function cellOf(cells: Cells, areaId: RoleAreaId): RoleCellDto {
  return cells[areaId] ?? { areaId, level: "none", reach: null };
}

type Held = Map<string, number>;

function compose(areas: RoleAreaDto[], cells: Cells): Held {
  const held: Held = new Map();
  for (const area of areas) {
    const option = optionOf(area, cells[area.id]);
    for (const grant of option ? [...option.defining, ...option.companions] : []) {
      held.set(grant.key, Math.max(held.get(grant.key) ?? 0, RANK[grant.scope]));
    }
  }
  return held;
}

const covers = (held: Held, grant: RoleGrantDto) => (held.get(grant.key) ?? 0) >= RANK[grant.scope];

function read(areas: RoleAreaDto[], held: Held): Cells {
  return Object.fromEntries(
    areas.map((area) => {
      const option = [...area.options].reverse().find((candidate) => candidate.defining.every((grant) => covers(held, grant)));
      return [area.id, { areaId: area.id, level: option?.level ?? "none", reach: option?.reach ?? null }];
    })
  );
}

const same = (a: RoleCellDto, b: RoleCellDto) => a.level === b.level && a.reach === b.reach;

/**
 * Sets one area and returns every cell as saving would leave it. Raising an area can raise a linked one; lowering it
 * lowers a linked area that would otherwise hold it up.
 */
export function setCell(areas: RoleAreaDto[], cells: Cells, next: RoleCellDto): Cells {
  const area = areas.find((candidate) => candidate.id === next.areaId);
  if (!area) return cells;
  const target: Cells = { ...cells, [next.areaId]: next };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = read(areas, compose(areas, target));
    if (same(cellOf(result, next.areaId), next)) return result;
    // Grants that would lift this area above what was asked: whichever other area carries them steps down.
    const index = area.options.findIndex((option) => option.level === next.level && option.reach === next.reach);
    const lifting = area.options.slice(index + 1).flatMap((option) => option.defining);
    const lifts = (option: RoleAreaOptionDto) => {
      const own: Held = new Map();
      for (const grant of [...option.defining, ...option.companions]) own.set(grant.key, Math.max(own.get(grant.key) ?? 0, RANK[grant.scope]));
      return lifting.some((grant) => covers(own, grant));
    };
    for (const other of areas) {
      if (other.id === area.id) continue;
      const option = optionOf(other, target[other.id]);
      if (!option || !lifts(option)) continue;
      const lower = [...other.options].reverse().find((candidate) => !lifts(candidate));
      target[other.id] = { areaId: other.id, level: lower?.level ?? "none", reach: lower?.reach ?? null };
    }
  }
  return read(areas, compose(areas, target));
}

/** The cells a save sends: every area the company has, in order. */
export function cellsToSave(areas: RoleAreaDto[], cells: Cells): RoleCellDto[] {
  return areas.filter((area) => !area.administratorsOnly).map((area) => cellOf(cells, area.id));
}

/** The areas whose cell differs between two states, for a flash on what moved. */
export function changedAreas(before: Cells, after: Cells): RoleAreaId[] {
  return (Object.keys(after) as RoleAreaId[]).filter((id) => !same(cellOf(before, id), cellOf(after, id)));
}

/** Pips for a level: 0 for none, 1 for a look (see, propose), 2 for acting (change, approve). */
export function weightOf(level: RoleLevel): 0 | 1 | 2 {
  return level === "none" ? 0 : level === "see" || level === "propose" ? 1 : 2;
}
