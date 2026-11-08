import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPublicRoute, middleware } from "./middleware";

const ORIGIN = "http://localhost:3000";

function request(path: string, sessionHint = false) {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: sessionHint ? { cookie: "ey_hr_authenticated=true" } : undefined,
  });
}

describe("Shell middleware", () => {
  it("returns an unauthenticated protected route to sign-in with its query", () => {
    const response = middleware(request("/core/people?view=not-signed-in"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/auth/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/core/people?view=not-signed-in");
  });

  it.each([
    "/activate-invitation",
    "/recover-administrator-access",
    "/invite/accept",
    "/core/invite/accept",
    "/auth/sso/complete",
  ])("allows the declared public route %s", (path) => {
    expect(middleware(request(path)).headers.get("location")).toBeNull();
  });

  it.each([
    "/activate-invitation-old",
    "/recover-administrator-access-old",
    "/invite-anything",
    "/core/invitation",
  ])("does not make false-prefix route %s public", (path) => {
    expect(middleware(request(path)).headers.get("location")).toContain("/auth/signin");
    expect(isPublicRoute(path)).toBe(false);
  });

  it("treats the cookie as an admission hint, not a destination decision", () => {
    expect(middleware(request("/core/people", true)).headers.get("location")).toBeNull();
  });

  it("does not retain the dead force-sign-in convention", () => {
    const response = middleware(request("/auth/signin?force=1", true));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });
});
