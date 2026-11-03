import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EmployeeFieldSettingsDto, FusionSettingsSection } from "@repo/api";

const mocks = vi.hoisted(() => ({
  sections: undefined as FusionSettingsSection[] | undefined,
  fields: undefined as EmployeeFieldSettingsDto | undefined,
}));

vi.mock("@repo/api/query", () => ({
  useSettingsSections: () => ({ data: mocks.sections, isError: false, refetch: vi.fn() }),
  useSettingsConflictSaver: () => null,
}));

vi.mock("@/features/settings/api/use-tenant-settings", () => ({
  useOrganizationSettings: () => ({ data: undefined, error: null }),
  useUpdateOrganizationSettings: () => ({ mutateAsync: vi.fn() }),
  useEmployeeFields: () => ({ data: mocks.fields, error: null, refetch: vi.fn() }),
  useUpdateEmployeeFields: () => ({ mutateAsync: vi.fn(), isLoading: false }),
}));
vi.mock("@/features/people/api/use-people", () => ({
  usePeople: () => ({ data: { items: [] } }),
  usePeopleProfile: () => ({ data: undefined }),
  usePeopleFields: () => ({ data: [] }),
}));

import { createTranslator } from "next-intl";
import { IntlTestProvider } from "@repo/ds/testing";
import dsFr from "@repo/ds/messages/fr.json";
import { loadCoreMessages } from "@/i18n/messages";
import type { Say } from "./say";
import { describeChange, isRoleChange, periodOf, roleChange } from "./sections/change-history";
import { invitationsConsequence } from "./sections/sign-in";
import { CoreSettingsSectionHost } from "./section-host";
import { EmployeeFieldsSettings } from "./sections/employee-fields";

const replace = vi.fn();
Object.defineProperty(window, "location", { value: { ...window.location, replace }, writable: true });

afterEach(() => {
  cleanup();
  replace.mockReset();
});

function section(id: string, access: "view" | "manage"): FusionSettingsSection {
  return { id, label: id === "employee-fields" ? "Employee fields" : "Company", order: 1, path: `/core/settings/${id}`, access, lastChange: null };
}

const FIELDS: EmployeeFieldSettingsDto = {
  version: 3,
  fields: [
    { id: "1", key: "about-me", label: "About me", area: "About", type: "Text", changedBy: "Employee", visible: true, visibleToEmployee: true, visibleToManager: true, required: false, builtIn: true, sortOrder: 10, sourceKey: "about", galleryKey: null },
    { id: "2", key: "phone", label: "Phone", area: "Personal", type: "Phone", changedBy: "Employee", visible: true, visibleToEmployee: true, visibleToManager: false, required: false, builtIn: true, sortOrder: 20, sourceKey: "phone", galleryKey: null },
    { id: "3", key: "job-title", label: "Job", area: "Job", type: "Text", changedBy: "DatedChange", visible: true, visibleToEmployee: true, visibleToManager: true, required: false, builtIn: true, sortOrder: 20, sourceKey: "jobTitle", galleryKey: null },
  ],
  gallery: [{ key: "skills", label: "Skills", description: "Tags", area: "About", type: "Tags", changedBy: "Employee" }],
  recordsToComplete: [],
};

describe("Employee fields", () => {
  it("shows a view-only reader every value as text, with no inputs or save bar", () => {
    mocks.fields = FIELDS;
    render(<EmployeeFieldsSettings section={section("employee-fields", "view")} />);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("You and HR")).toBeInTheDocument();
    expect(screen.getByText("Change through Make a change, with a date")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("groups fields, exposes audiences, and keeps job facts dated", () => {
    mocks.fields = FIELDS;
    render(<EmployeeFieldsSettings section={section("employee-fields", "manage")} />);
    expect(screen.getAllByRole("heading", { name: "About" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New field" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("Change through Make a change, with a date")).toBeInTheDocument();
  });
});

const fr = await loadCoreMessages("fr");
const french = createTranslator({ locale: "fr", messages: fr, namespace: "settings" });
const sayInFrench: Say = (key, values) => french(key as never, values as never);

describe("In French", () => {
  it("renders Employee fields in French, naming the section from the catalogue", () => {
    mocks.fields = FIELDS;
    render(
      <IntlTestProvider locale="fr" messages={{ ...dsFr, ...fr }}>
        <EmployeeFieldsSettings section={section("employee-fields", "view")} />
      </IntlTestProvider>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Champs" })).toBeInTheDocument();
    expect(screen.getByText("Lecture seule")).toBeInTheDocument();
    expect(screen.getByText("Vous et les RH")).toBeInTheDocument();
  });

  it("says what saving does with French agreement", () => {
    expect(
      invitationsConsequence(
        { inviteExpiryDays: 7, resendCooldownHours: 24, defaultAccessProfileId: null, pendingInviteBehavior: "RefreshExisting", remindAfterDays: 3, inviteJoinersOnFirstDay: true },
        { inviteExpiryDays: 1, resendCooldownHours: 24, defaultAccessProfileId: null, pendingInviteBehavior: "KeepExisting", remindAfterDays: 3, inviteJoinersOnFirstDay: true },
        "Employee",
        sayInFrench
      )
    ).toBe("Les invitations envoyées à partir de maintenant expirent après 1 jour. Une nouvelle invitation conserve le premier lien.");
  });

  it("writes change history's lines in French", () => {
    expect(describeChange("employeeFieldConfig.phone.visibleToManager", false, true, sayInFrench)).toEqual({
      label: "Téléphone · son manager",
      before: "Masqué",
      after: "Visible",
      sentence: "Téléphone : les managers le voient désormais",
    });
    expect(describeChange("provisioning.inviteExpiryDays", 7, 14, sayInFrench).after).toBe("14 jours");
    expect(describeChange("team-and-job-changes", "on", "required")).toEqual({
      label: "Team and job change email",
      before: "on",
      after: "required",
      sentence: "Team and job change email is now required",
    });
    expect(describeChange("orgChart.audience", undefined, "ManagersAndHr", sayInFrench)).toEqual({
      label: "Qui voit l’organigramme",
      before: "Tout le monde",
      after: "Managers et RH",
      sentence: "Seuls les managers et les RH voient l’organigramme.",
    });
    expect(periodOf(new Date(2026, 8, 3), new Date(2026, 9, 24), sayInFrench, "fr")).toBe("Septembre");
    expect(periodOf(new Date(2026, 9, 22), new Date(2026, 9, 24), sayInFrench, "fr")).toBe("Cette semaine");
  });
});

const holder = (roles: string[], person = { userId: "u1", fullName: "Khaled Sassi", email: "khaled.sassi@example.test" }) => ({
  ...person,
  accessProfiles: roles.map((name) => ({ id: `id-${name}`, name, type: "Custom", isSystemProtected: false })),
});
const role = (name: string, keys: string[]) => ({ id: "r1", name, grants: keys.map((permissionKey) => ({ permissionKey, scope: "Tenant" })) });
/** A role as Identity records it since B-177: its cells and holders. */
const cells = (name: string, set: Record<string, [string, string | null]>, holderKind = "chosen") => ({
  id: "r1",
  name,
  holderKind,
  conditions: [],
  cells: ["job", "plans"].map((areaId) => ({ areaId, level: set[areaId]?.[0] ?? "none", reach: set[areaId]?.[1] ?? null })),
});
const json = (value: unknown) => JSON.stringify(value);

describe("Role changes in change history", () => {
  it("says who was made or stopped being an administrator, and who saw Fusion as someone (B-178)", () => {
    const person = (name: string) => json({ state: "Tenant Administrator", person: name });
    expect(roleChange("AdministratorAuthorityGranted", json({ state: "None", person: "Nour Ben Ali" }), person("Nour Ben Ali"))?.headline)
      .toBe("Made Nour Ben Ali an administrator");
    expect(roleChange("AdministratorAuthorityRevoked", person("Nour Ben Ali"), json({ state: "None", person: "Nour Ben Ali" }))?.headline)
      .toBe("Removed Nour Ben Ali as an administrator");
    expect(roleChange("AdministratorAuthoritySelfRemoved", null, null)?.headline).toBe("Changed who administers the company");
    expect(roleChange("FusionSeenAs", null, json({ person: "Mariam Gharbi" }))?.headline).toBe("Saw Fusion as Mariam Gharbi");
    expect(isRoleChange({ action: "FusionSeenAs" })).toBe(true);
    expect(isRoleChange({ action: "AdministratorInvitationIssued" })).toBe(false);
    expect(isRoleChange({ action: "toString" })).toBe(false);
  });

  it("says who gained or lost which role", () => {
    const gained = roleChange("access.assignment.updated", json(holder(["Employee"])), json(holder(["Employee", "Performance lead"])));
    expect(gained).toEqual({
      headline: "Gave Khaled Sassi the Performance lead role",
      lines: [{ label: "Khaled Sassi · Performance lead", before: "Not held", after: "Held", sentence: "Gave Khaled Sassi the Performance lead role" }],
    });
    expect(
      roleChange("access.assignment.updated", json(holder(["Employee", "Recruiter"])), json(holder(["Employee", "Performance lead"])))?.headline
    ).toBe("Gave Khaled Sassi the Performance lead role, and 1 more");
    expect(
      roleChange("access.assignment.updated", json(holder(["Recruiter"])), json(holder([])))?.lines[0]?.sentence
    ).toBe("Took the Recruiter role from Khaled Sassi");
  });

  it("names a first assignment, a person without a name, and each person of a bulk change", () => {
    expect(roleChange("access.assignment.updated", null, json(holder(["Employee"])))?.headline).toBe("Gave Khaled Sassi the Employee role");
    const unnamed = { userId: "u2", fullName: null, email: "rim@example.test" };
    expect(roleChange("access.assignment.updated", null, json(holder(["Employee"], unnamed as never)))?.headline).toBe(
      "Gave rim@example.test the Employee role"
    );
    const bulk = roleChange(
      "access.assignment.bulkUpdated",
      json([holder([]), holder([], unnamed as never)]),
      json([holder(["Recruiter"]), holder(["Recruiter"], unnamed as never)])
    );
    expect(bulk?.lines.map((line) => line.sentence)).toEqual([
      "Gave Khaled Sassi the Recruiter role",
      "Gave rim@example.test the Recruiter role",
    ]);
  });

  it("says what a role was created, renamed or changed to do", () => {
    const created = roleChange("access.profile.created", null, json(cells("Performance lead", { plans: ["see", "everyone"] })));
    expect(created?.headline).toBe("Created the Performance lead role");
    expect(created?.lines).toEqual([
      {
        label: "Plans and check-ins",
        before: "No access",
        after: "See · everyone",
        sentence: "Set Plans and check-ins to See · everyone for Performance lead",
      },
    ]);
    expect(roleChange("access.profile.deleted", json(cells("Recruiter", {})), null)).toEqual({ headline: "Deleted the Recruiter role", lines: [] });
    expect(
      roleChange("access.profile.updated", json(cells("Recruiter", {})), json(cells("Talent", { job: ["see", "team"] })))?.headline
    ).toBe("Renamed the Recruiter role to Talent, and 1 more");
    expect(
      roleChange("access.profile.updated", json(cells("Talent", { job: ["see", "team"] })), json(cells("Talent", {})))?.lines[0]?.sentence
    ).toBe("Set Jobs and history to no access for Talent");
    expect(
      roleChange("access.profile.updated", json(cells("Talent", {})), json(cells("Talent", {}, "everyone")))?.lines[0]?.sentence
    ).toBe("Changed who has Talent");
    // Records from before the roles model carry grants only.
    expect(
      roleChange("access.profile.updated", json(role("Talent", [])), json(role("Talent", ["performance.goal.view"])))
    ).toEqual({ headline: "Changed what the Talent role can do", lines: [] });
  });

  it("leaves what it can't read to the fallback", () => {
    expect(roleChange("access.assignment.updated", "{not json", "{not json")).toBeNull();
    expect(roleChange("access.profile.updated", null, null)).toBeNull();
    expect(roleChange("access.invitation.sent", null, json(holder(["Employee"])))).toBeNull();
    expect(roleChange("access.assignment.updated", json(holder(["Employee"])), json(holder(["Employee"])))).toBeNull();
  });

  it("says it in French and Arabic", async () => {
    const ar = await loadCoreMessages("ar");
    const arabic = createTranslator({ locale: "ar", messages: ar, namespace: "settings" });
    const sayInArabic: Say = (key, values) => arabic(key as never, values as never);
    const gave = ["access.assignment.updated", json(holder([])), json(holder(["Performance lead"]))] as const;
    expect(roleChange(...gave, sayInFrench)?.headline).toBe("A attribué le rôle « Performance lead » à Khaled Sassi");
    expect(roleChange(...gave, sayInArabic)?.headline).toBe("منح Khaled Sassi دور Performance lead");
    expect(
      roleChange("access.profile.updated", json(cells("Recruteur", {})), json(cells("Recruteur", { plans: ["see", "everyone"] })), sayInFrench)
        ?.lines[0]
    ).toEqual({
      label: "Plans et points d'étape",
      before: "Aucun accès",
      after: "Voir · tout le monde",
      sentence: "Plans et points d'étape : Voir · tout le monde pour Recruteur",
    });
  });
});

describe("Opening a section", () => {
  it("sends a person who can't view the section to their first allowed one", () => {
    mocks.sections = [section("employee-fields", "view")];
    render(<CoreSettingsSectionHost id="roles" render={() => <p>Roles content</p>} />);
    expect(replace).toHaveBeenCalledWith("/core/settings/employee-fields");
    expect(screen.queryByText("Roles content")).not.toBeInTheDocument();
  });

  it("sends someone with no Core HR section to Preferences", () => {
    mocks.sections = [];
    render(<CoreSettingsSectionHost id="company" render={() => <p>Company</p>} />);
    expect(replace).toHaveBeenCalledWith("/settings");
  });

  it("opens an allowed section", () => {
    mocks.sections = [section("company", "manage")];
    render(<CoreSettingsSectionHost id="company" render={(open) => <p>{open.label} open</p>} />);
    expect(screen.getByText("Company open")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
