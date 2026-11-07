import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CoreSearchDto, CoreSearchPersonDto, PerformanceSearchDto } from "@repo/api";
import { IntlTestProvider } from "@repo/ds/testing";
import { openTopBarSearch } from "@repo/ds/shell";
import dsEn from "@repo/ds/messages/en.json";
import authEn from "../messages/en.json";
import { TopBarSearch } from "../components/top-bar-search";
import { personActions, readVerb, searchRights } from "../components/top-bar-search-model";

const grant = (permissionKey: string, scope: string) => ({ permissionKey, scope, label: "", group: "", helperText: null, allowedScopes: [] });

const state = vi.hoisted(() => ({
  user: null as unknown,
  core: undefined as CoreSearchDto | undefined,
  performance: undefined as PerformanceSearchDto | undefined,
  asked: [] as string[],
}));

vi.mock("../auth-context", () => ({ useAuth: () => ({ user: state.user, isLoading: false }) }));
vi.mock("@repo/api/react", async (original) => ({
  ...(await original<object>()),
  useFusionViewer: () => ({
    viewer: { userId: "u-1", tenantId: "t-1", fullName: "Mariam Gharbi", employeeId: "e-mariam", accountLabel: "", moduleEntitlements: ["CoreHR", "Performance"], enterableModules: ["core", "performance"], canOpenOwnProfile: true },
    isLoading: false,
  }),
}));
vi.mock("@repo/api/query", async (original) => ({
  ...(await original<object>()),
  useFusionSearch: (q: string, options: { open: boolean }) => {
    if (options.open) state.asked.push(q);
    const result = <T,>(data: T | undefined) => ({ data, error: null, isLoading: false, isFetching: false });
    return { core: result(state.core), performance: result(q ? state.performance : undefined) };
  },
}));

const person = (displayName: string, relation: CoreSearchPersonDto["relation"] = null): CoreSearchPersonDto => ({
  employeeKey: `E-${displayName.split(" ")[0]}`,
  employeeId: `id-${displayName.split(" ")[0]}`,
  displayName,
  photoUrl: null,
  jobTitle: "QA Engineer",
  unitName: "Product",
  place: "Sfax",
  relation,
});

const manager = {
  userId: "u-1",
  tenantId: "t-1",
  moduleEntitlements: ["CoreHR", "Performance"],
  roles: [] as string[],
  employeeId: "e-mariam",
  effectivePermissions: [
    grant("core.employee.view", "DirectReports"),
    grant("core.team.view", "DirectReports"),
    grant("core.orgchart.view", "Tenant"),
    grant("performance.cycle.view", "DirectReports"),
  ],
};

function show() {
  render(
    <IntlTestProvider locale="en" messages={{ ...dsEn, ...authEn }}>
      <TopBarSearch />
    </IntlTestProvider>,
  );
  return screen.getByRole("combobox");
}

describe("TopBarSearch", () => {
  beforeEach(() => {
    state.user = manager;
    state.asked = [];
    state.core = { people: [person("Aicha Bouazizi", "Report"), person("Omar Mansour")], peopleTotal: 2, units: [], places: [], jobs: [], reports: [], orgChart: true };
    state.performance = { objectives: [], oneOnOnes: [], reviewRounds: [], cycles: [] };
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    localStorage.clear();
  });

  it("opens from Ctrl K or a page, and before typing shows your people and places to go", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByText("Your people")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Aicha Bouazizi" })).toBeTruthy();
    expect(screen.getByText("Go to")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => openTopBarSearch());
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("finds people with what they are to you and opens the highlighted one", async () => {
    const input = show();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "aic" } });
    await waitFor(() => expect(state.asked).toContain("aic"));
    expect(screen.getByRole("group", { name: "People" })).toBeTruthy();
    expect(screen.getByText("Reports to you")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.location.assign).toHaveBeenCalledWith("/core/people/E-Aicha");
  });

  it("names an action in the row's line and runs it from the keyboard", async () => {
    const input = show();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "aicha" } });
    await waitFor(() => expect(screen.getByLabelText("Give Aicha praise")).toBeTruthy());
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getAllByText("Give Aicha praise").length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.location.assign).toHaveBeenCalledWith("/performance/feedback?compose=praise&to=id-Aicha");
  });

  it("strips a verb before asking who, and offers the action first", async () => {
    const input = show();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "praise aicha" } });
    await waitFor(() => expect(screen.getByText("Do")).toBeTruthy());
    expect(state.asked).toContain("aicha");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.location.assign).toHaveBeenCalledWith("/performance/feedback?compose=praise&to=id-Aicha");
  });

  it("says when nothing matches", async () => {
    state.core = { ...state.core!, people: [], peopleTotal: 0 };
    const input = show();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeTruthy());
  });
});

describe("search rights", () => {
  it("offers only what the viewer may do with a person", () => {
    const employee = { ...manager, effectivePermissions: [grant("core.employee.view", "Self"), grant("performance.objective.self.manage", "Self")] };
    const rights = searchRights(employee as never, true, false);
    expect(personActions(person("Omar Mansour"), rights).map((a) => a.id)).toEqual(["praise", "feedback"]);
    expect(personActions(person("Aicha Bouazizi", "Self"), rights)).toEqual([]);

    const managerRights = searchRights(manager as never, true, true);
    expect(personActions(person("Aicha Bouazizi", "Report"), managerRights).map((a) => a.id)).toEqual(["orgChart", "praise", "feedback", "oneOnOne"]);
  });

  it("reads a verb only before a name", () => {
    const words = { praise: "praise thank", feedback: "feedback ask", oneOnOne: "1:1", hire: "hire" };
    expect(readVerb("praise mariam", words)).toMatchObject({ verb: "praise", rest: "mariam" });
    expect(readVerb("praise", words)).toMatchObject({ verb: null, bare: "praise" });
    expect(readVerb("pra", words)).toMatchObject({ verb: null, bare: null });
  });
});
