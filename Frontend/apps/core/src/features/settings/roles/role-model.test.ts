import { describe, expect, it } from "vitest";
import type { RoleAreaDto } from "@repo/api";
import { cellOf, cellsToSave, setCell, toCells } from "./role-model";

const grant = (key: string, scope: "Self" | "DirectReports" | "Tenant") => ({ key, scope });

// Jobs and Personal details as Identity's contract sends them since B-214: their own keys, no shared grant.
const AREAS: RoleAreaDto[] = [
  {
    id: "job",
    group: "core",
    administratorsOnly: false,
    options: [
      { level: "see", reach: "self", defining: [grant("core.employee.view", "Self")], companions: [] },
      { level: "see", reach: "team", defining: [grant("core.employee.view", "DirectReports")], companions: [grant("core.team.view", "DirectReports")] },
      { level: "see", reach: "everyone", defining: [grant("core.employee.view", "Tenant")], companions: [] },
      { level: "change", reach: "everyone", defining: [grant("core.employee.manage", "Tenant")], companions: [grant("core.employee.view", "Tenant")] },
    ],
  },
  {
    id: "personal",
    group: "core",
    administratorsOnly: false,
    options: [
      { level: "see", reach: "self", defining: [grant("core.profile.self.view", "Self")], companions: [] },
      { level: "change", reach: "self", defining: [grant("core.profile.self.update", "Self")], companions: [grant("core.profile.self.view", "Self")] },
      { level: "see", reach: "team", defining: [grant("core.personal.view", "DirectReports")], companions: [grant("core.profile.self.view", "Self"), grant("core.profile.self.update", "Self")] },
      { level: "see", reach: "everyone", defining: [grant("core.personal.view", "Tenant")], companions: [] },
      { level: "change", reach: "everyone", defining: [grant("core.personal.manage", "Tenant")], companions: [grant("core.personal.view", "Tenant")] },
    ],
  },
  {
    id: "roles",
    group: "company",
    administratorsOnly: true,
    options: [{ level: "change", reach: null, defining: [grant("access.profiles.manage", "Tenant")], companions: [] }],
  },
];

describe("the roles model on the page", () => {
  it("sets Personal details for everyone without touching Jobs", () => {
    const next = setCell(AREAS, toCells([{ areaId: "job", level: "see", reach: "self" }]), { areaId: "personal", level: "change", reach: "everyone" });

    expect(cellOf(next, "personal")).toEqual({ areaId: "personal", level: "change", reach: "everyone" });
    expect(cellOf(next, "job")).toEqual({ areaId: "job", level: "see", reach: "self" });
  });

  it("lowers Jobs and leaves Personal details where they were", () => {
    const hr = setCell(AREAS, {}, { areaId: "personal", level: "change", reach: "everyone" });
    const next = setCell(AREAS, setCell(AREAS, hr, { areaId: "job", level: "change", reach: "everyone" }), { areaId: "job", level: "see", reach: "team" });

    expect(cellOf(next, "job")).toEqual({ areaId: "job", level: "see", reach: "team" });
    expect(cellOf(next, "personal")).toEqual({ areaId: "personal", level: "change", reach: "everyone" });
  });

  it("leaves unlinked areas alone", () => {
    const start = toCells([{ areaId: "personal", level: "change", reach: "self" }]);
    const next = setCell(AREAS, start, { areaId: "job", level: "see", reach: "self" });

    expect(cellOf(next, "personal")).toEqual({ areaId: "personal", level: "change", reach: "self" });
  });

  it("never sends an administrators-only area", () => {
    const sent = cellsToSave(AREAS, toCells([{ areaId: "roles", level: "change", reach: null }]));

    expect(sent.map((cell) => cell.areaId)).toEqual(["job", "personal"]);
  });
});
