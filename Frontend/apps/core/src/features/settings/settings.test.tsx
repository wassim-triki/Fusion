import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { FusionSettingsSection, PeopleDataSettingsDto } from "@repo/api";

const mocks = vi.hoisted(() => ({
  sections: undefined as FusionSettingsSection[] | undefined,
  peopleData: undefined as PeopleDataSettingsDto | undefined,
}));

vi.mock("@repo/api/query", () => ({
  useSettingsSections: () => ({ data: mocks.sections, isError: false, refetch: vi.fn() }),
  useSettingsConflictSaver: () => null,
}));

vi.mock("@/features/settings/api/use-tenant-settings", () => ({
  usePeopleDataSettings: () => ({ data: mocks.peopleData, error: null, refetch: vi.fn() }),
  useUpdatePeopleDataSettings: () => ({ mutateAsync: vi.fn() }),
}));

import { createTranslator } from "next-intl";
import { IntlTestProvider } from "@repo/ds/testing";
import dsFr from "@repo/ds/messages/fr.json";
import { loadCoreMessages } from "@/i18n/messages";
import type { Say } from "./say";
import { describeChange, isRoleChange, periodOf, roleChange } from "./sections/change-history";
import { invitationsConsequence } from "./sections/invitations";
import { CoreSettingsSectionHost } from "./section-host";
import { EmployeeFieldsSettings, employeeFieldsConsequence, toDraft } from "./sections/employee-fields";

const replace = vi.fn();
Object.defineProperty(window, "location", { value: { ...window.location, replace }, writable: true });

afterEach(() => {
  cleanup();
  replace.mockReset();
});

function section(id: string, access: "view" | "manage"): FusionSettingsSection {
  return { id, label: id === "employee-fields" ? "Employee fields" : "Company", order: 1, path: `/core/settings/${id}`, access, lastChange: null };
}

const PEOPLE_DATA: PeopleDataSettingsDto = {
  version: 3,
  downstreamConsumers: [],
  selfService: { canEditPreferredName: true, canEditPhone: true },
  orgChart: { audience: "Everyone" },
  employeeFieldConfig: {
    firstName: { visible: true, required: true, visibleToEmployee: true, visibleToManager: true },
    lastName: { visible: true, required: true, visibleToEmployee: true, visibleToManager: true },
    email: { visible: true, required: false, visibleToEmployee: true, visibleToManager: true },
    hireDate: { visible: true, required: true, visibleToEmployee: true, visibleToManager: true },
    phone: { visible: true, required: false, visibleToEmployee: true, visibleToManager: false },
    jobTitle: { visible: true, required: false, visibleToEmployee: true, visibleToManager: true },
    workLocation: { visible: true, required: false, visibleToEmployee: true, visibleToManager: true },
    employmentType: { visible: true, required: false, visibleToEmployee: true, visibleToManager: true },
  },
};

describe("Employee fields", () => {
  it("shows a view-only reader every value as text, with no inputs or save bar", () => {
    mocks.peopleData = PEOPLE_DATA;
    render(<EmployeeFieldsSettings section={section("employee-fields", "view")} />);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    const phone = screen.getByRole("row", { name: /Phone/ });
    expect(phone).toHaveTextContent("NoSees itHiddenSees it");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("locks names and gives a manager a checkbox per audience, HR fixed", () => {
    mocks.peopleData = PEOPLE_DATA;
    render(<EmployeeFieldsSettings section={section("employee-fields", "manage")} />);
    expect(screen.getByRole("checkbox", { name: "First name: Required" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Phone: Their manager" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Phone: HR always sees it" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Everyone/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Managers and HR/ })).not.toBeChecked();
  });

  it("shows a view-only reader who sees the org chart", () => {
    mocks.peopleData = { ...PEOPLE_DATA, orgChart: { audience: "ManagersAndHr" } };
    render(<EmployeeFieldsSettings section={section("employee-fields", "view")} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("Managers and HR")).toBeInTheDocument();
  });

  it("names the consequence of a change", () => {
    const saved = toDraft({
      ...PEOPLE_DATA,
      employeeFieldConfig: { ...PEOPLE_DATA.employeeFieldConfig, phone: { ...PEOPLE_DATA.employeeFieldConfig.phone!, visibleToManager: true } },
    });
    const draft = toDraft(PEOPLE_DATA);
    expect(employeeFieldsConsequence(saved, draft)).toBe("Managers stop seeing phone numbers on their team's profiles.");
    expect(
      employeeFieldsConsequence(draft, { ...draft, selfService: { ...draft.selfService, canEditPhone: false } })
    ).toBe("Employees can no longer change their phone number.");
    expect(employeeFieldsConsequence(draft, { ...draft, orgChart: "ManagersAndHr" })).toBe("Only managers and HR see the org chart.");
  });
});

const fr = await loadCoreMessages("fr");
const french = createTranslator({ locale: "fr", messages: fr, namespace: "settings" });
const sayInFrench: Say = (key, values) => french(key as never, values as never);

describe("In French", () => {
  it("renders Employee fields in French, naming the section from the catalogue", () => {
    mocks.peopleData = PEOPLE_DATA;
    render(
      <IntlTestProvider locale="fr" messages={{ ...dsFr, ...fr }}>
        <EmployeeFieldsSettings section={section("employee-fields", "view")} />
      </IntlTestProvider>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Champs collaborateur" })).toBeInTheDocument();
    expect(screen.getByText("Lecture seule")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Téléphone/ })).toHaveTextContent("NonVisibleMasquéVisible");
  });

  it("says what saving does with French agreement", () => {
    const saved = toDraft(PEOPLE_DATA);
    const draft = toDraft({
      ...PEOPLE_DATA,
      employeeFieldConfig: { ...PEOPLE_DATA.employeeFieldConfig, hireDate: { ...PEOPLE_DATA.employeeFieldConfig.hireDate!, required: false } },
    });
    expect(employeeFieldsConsequence(saved, draft, sayInFrench)).toBe("Date d’embauche n’est plus obligatoire.");
    expect(
      invitationsConsequence(
        { inviteExpiryDays: 7, resendCooldownHours: 24, defaultAccessProfileId: null, pendingInviteBehavior: "RefreshExisting" },
        { inviteExpiryDays: 1, resendCooldownHours: 24, defaultAccessProfileId: null, pendingInviteBehavior: "KeepExisting" },
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
