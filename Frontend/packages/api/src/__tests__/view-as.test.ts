import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginViewAs, createPlatformApiClient, finishViewAs, readViewAs, type RefreshResponse, type ViewAsMarker } from "../platform";

// Seeing Fusion as someone (B-178): the administrator's session goes aside and comes back, never lost.

let storage: Record<string, string>;
let assigned: string[];

const home = {
  accessToken: "admin-token",
  refreshToken: "admin-refresh",
  accessTokenExpiration: "2099-01-01T00:00:00Z",
  user: { userId: "amira", fullName: "Amira Khelifi" },
};

const theirs = {
  userId: "leila",
  tenantId: "carthage",
  tenantMembershipId: "m-leila",
  moduleEntitlements: ["CoreHR"],
  email: "leila@example.test",
  fullName: "Leila Baccouche",
  roles: [],
  accessToken: "view-token",
  refreshToken: "",
  accessTokenExpiration: "2099-01-01T00:00:00Z",
} as RefreshResponse;

const marker: ViewAsMarker = {
  sessionId: "s-1",
  viewerName: "Amira Khelifi",
  personName: "Leila Baccouche",
  roles: ["Employees"],
  returnTo: "/core/settings/roles/r-1",
  expiresAt: "2099-01-01T00:00:00Z",
};

beforeEach(() => {
  storage = { ey_hr_auth: JSON.stringify(home) };
  assigned = [];
  vi.stubGlobal("window", { dispatchEvent: () => true, location: { assign: (url: string) => assigned.push(url) } });
  vi.stubGlobal("document", { cookie: "" });
  vi.stubGlobal("CustomEvent", class { constructor(public type: string) {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("seeing Fusion as someone", () => {
  it("keeps the administrator's session aside while the person's read-only one is in use", () => {
    beginViewAs(theirs, marker);

    expect(JSON.parse(storage.ey_hr_auth!).accessToken).toBe("view-token");
    expect(readViewAs()).toEqual(marker);
    expect(JSON.parse(storage.ey_hr_auth_home!).accessToken).toBe("admin-token");
  });

  it("never nests a view inside a view", () => {
    beginViewAs(theirs, marker);
    beginViewAs({ ...theirs, accessToken: "second-view" }, { ...marker, sessionId: "s-2" });

    expect(JSON.parse(storage.ey_hr_auth_home!).accessToken).toBe("admin-token");
    expect(readViewAs()?.sessionId).toBe("s-1");
  });

  it("brings the administrator back where the view started", () => {
    beginViewAs(theirs, marker);

    expect(finishViewAs()).toBe("/core/settings/roles/r-1");
    expect(JSON.parse(storage.ey_hr_auth!).accessToken).toBe("admin-token");
    expect(storage.ey_hr_auth_home).toBeUndefined();
    expect(readViewAs()).toBeNull();
    expect(finishViewAs()).toBeNull();
  });

  it("answers an ended or expired view by going back, not by signing the administrator out", async () => {
    beginViewAs(theirs, marker);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "authority-revoked", reason: "view-ended" }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createPlatformApiClient().get("/corehr/workforce/me")).rejects.toBeTruthy();

    // No refresh was tried with the view's empty refresh token; the administrator's session is back.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/identity/auth/refresh"))).toBe(false);
    expect(JSON.parse(storage.ey_hr_auth!).accessToken).toBe("admin-token");
    expect(assigned).toEqual(["/core/settings/roles/r-1"]);
  });
});
