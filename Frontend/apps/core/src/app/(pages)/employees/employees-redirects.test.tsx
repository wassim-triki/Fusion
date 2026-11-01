// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import EmployeesListRedirect from "./page";
import EmployeeDetailRedirect from "./[id]/page";
import EmployeeImportRedirect from "./import/page";

function sp(params: Record<string, string | string[]>) {
  return Promise.resolve(params);
}

beforeEach(() => mockRedirect.mockReset());

describe("legacy /employees compatibility routes redirect to canonical /people", () => {
  it("redirects the list route, preserving query state", async () => {
    await EmployeesListRedirect({ searchParams: sp({ q: "ada", status: "Active" }) });
    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const target = mockRedirect.mock.calls[0]![0] as string;
    expect(target.startsWith("/people?")).toBe(true);
    expect(target).toContain("q=ada");
    expect(target).toContain("status=Active");
  });

  it("redirects the detail route on the stable employee key", async () => {
    await EmployeeDetailRedirect({ params: Promise.resolve({ id: "E-KEY-1" }), searchParams: sp({}) });
    expect(mockRedirect).toHaveBeenCalledWith("/people/E-KEY-1");
  });

  it("redirects the import route", async () => {
    EmployeeImportRedirect();
    expect(mockRedirect).toHaveBeenCalledWith("/import");
  });
});
