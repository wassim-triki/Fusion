import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleGate } from "../components/module-gate";

const state = vi.hoisted(() => ({
  auth: { user: null as null | { tenantId: string; moduleEntitlements: string[] }, isLoading: false },
  pathname: "/",
}));

vi.mock("../auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

const replace = vi.fn();

function member(...moduleEntitlements: string[]) {
  return { tenantId: "tenant-1", moduleEntitlements };
}

function show(module: "Learning" | null = "Learning", publicPaths: string[] = ["/verify"]) {
  render(
    <ModuleGate module={module} publicPaths={publicPaths}>
      <p>inside</p>
    </ModuleGate>,
  );
}

describe("ModuleGate", () => {
  beforeEach(() => {
    replace.mockClear();
    vi.stubGlobal("location", { ...window.location, replace });
    state.auth = { user: null, isLoading: false };
    state.pathname = "/";
  });

  it("lets in a person whose company has the module", () => {
    state.auth.user = member("CoreHR", "Learning");
    show();
    expect(screen.getByText("inside")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a person whose company doesn't have it Home, showing nothing", () => {
    state.auth.user = member("CoreHR");
    show();
    expect(screen.queryByText("inside")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("sends everyone Home from a retired module", () => {
    state.auth.user = member("CoreHR", "Learning");
    show(null, []);
    expect(screen.queryByText("inside")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("shows nothing and decides nothing until the session is known", () => {
    state.auth = { user: member("CoreHR"), isLoading: true };
    show();
    expect(screen.queryByText("inside")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("leaves someone not signed in to the app", () => {
    show();
    expect(screen.getByText("inside")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(["/verify", "/verify/CERT-1"])("keeps public %s open, signed in or still loading", (path) => {
    state.pathname = path;
    state.auth.user = member("CoreHR");
    show();
    expect(screen.getByText("inside")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("doesn't take a look-alike for a public path", () => {
    state.pathname = "/verifying";
    state.auth.user = member("CoreHR");
    show();
    expect(replace).toHaveBeenCalledWith("/");
  });
});
