// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type * as AuthModule from "@repo/auth";
import { renderWithIntl } from "@/test/intl";
import SsoCompletePage from "./page";

const persistAuth = vi.fn();
vi.mock("@repo/auth", async () => {
  const actual = await vi.importActual<typeof AuthModule>("@repo/auth");
  return { ...actual, persistAuth: (...args: unknown[]) => persistAuth(...args) };
});

function answer(status: number, data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(status < 300 ? { isSuccess: true, data, errors: [] } : { isSuccess: false, data: null, errors: ["x"] }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

const session = {
  userId: "u1",
  tenantId: "t1",
  tenantMembershipId: "m1",
  moduleEntitlements: ["CoreHR"],
  email: "aicha@carthagedigital.tn",
  fullName: "Aicha Bouazizi",
  roles: [],
  effectivePermissions: [],
  accessToken: "access",
  refreshToken: "refresh",
  accessTokenExpiration: new Date(Date.now() + 3_600_000).toISOString(),
};

describe("coming back from a provider", () => {
  let replace: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    persistAuth.mockReset();
    window.sessionStorage.clear();
    replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
  });

  it("keeps the session and opens the page the person asked for", async () => {
    window.sessionStorage.setItem("fusion_sso_origin", "/auth/signin");
    window.sessionStorage.setItem("fusion_sso_next", "/core/people");
    answer(200, { session, refusal: null });

    renderWithIntl(<SsoCompletePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/core/people"));
    expect(persistAuth).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "access", refreshToken: "refresh" }));
    expect(window.sessionStorage.getItem("fusion_sso_next")).toBeNull();
  });

  it("goes back where it started with the refusal, and creates no session", async () => {
    window.sessionStorage.setItem("fusion_sso_origin", "/invite/accept?token=abc");
    const refusal = { code: "invitation_mismatch", provider: "google", company: null, email: "aicha.b@gmail.com" };
    answer(200, { session: null, refusal });

    renderWithIntl(<SsoCompletePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/invite/accept?token=abc"));
    expect(persistAuth).not.toHaveBeenCalled();
    expect(JSON.parse(window.sessionStorage.getItem("fusion_sso_refusal")!)).toEqual(refusal);
  });

  it("treats a result that is gone as having taken too long", async () => {
    answer(404, null);

    renderWithIntl(<SsoCompletePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/auth/signin"));
    expect(JSON.parse(window.sessionStorage.getItem("fusion_sso_refusal")!).code).toBe("expired");
  });
});
