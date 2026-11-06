import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPlatformApiClient, isBrowser, wasSessionExpired } from "../platform";

// ── Setup ────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: { ok: true }, errors: [], isSuccess: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("createPlatformApiClient", () => {
  it("defaults baseUrl to /api when no env var is set", async () => {
    const api = createPlatformApiClient({ getToken: () => null });
    await api.get("/test");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/test");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL env var when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://gateway:5000/api");

    const api = createPlatformApiClient({ getToken: () => null });
    await api.get("/test");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://gateway:5000/api/test");
  });

  it("explicit baseUrl overrides env var", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://gateway:5000/api");

    const api = createPlatformApiClient({
      baseUrl: "/custom",
      getToken: () => null,
    });
    await api.get("/test");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/custom/test");
  });

  it("injects token from default localStorage strategy", async () => {
    // Simulate browser environment
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const stored = JSON.stringify({
      accessToken: "jwt-abc",
      refreshToken: "rt",
      accessTokenExpiration: "2099-01-01",
      user: {},
    });
    const storage: Record<string, string> = { ey_hr_auth: stored };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
    });

    const api = createPlatformApiClient();
    await api.get("/protected");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer jwt-abc");
  });

  it("uses custom getToken when provided", async () => {
    const api = createPlatformApiClient({
      getToken: () => "custom-token",
    });
    await api.get("/protected");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer custom-token");
  });

  it("does not infer a tenant header from browser auth state", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          accessToken: "jwt-abc",
          refreshToken: "rt",
          accessTokenExpiration: "2099-01-01",
          user: {
            tenantId: "customer-tenant",
            roles: ["PlatformAdmin"],
          },
        }),
    });

    const api = createPlatformApiClient();
    await api.get("/protected");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Tenant-Id"]).toBeUndefined();
  });

  it("attaches a tenant header only from an explicit resolver", async () => {
    const api = createPlatformApiClient({
      getToken: () => null,
      getTenantId: () => "customer-tenant",
    });

    await api.get("/tenant-scoped");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Tenant-Id"]).toBe("customer-tenant");
  });

  it("refreshes an expired stored session before sending the request", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("document", { cookie: "" });

    const storage: Record<string, string> = {
      ey_hr_auth: JSON.stringify({
        accessToken: "expired-token",
        refreshToken: "refresh-token-1",
        accessTokenExpiration: new Date(Date.now() - 5_000).toISOString(),
        user: {
          userId: "user-1",
          email: "jane@example.com",
          fullName: "Jane Doe",
          roles: ["HRAdmin"],
          employeeId: "employee-1",
        },
      }),
    };

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    });

    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              userId: "user-1",
              tenantId: "tenant-1",
              tenantMembershipId: "membership-1",
              moduleEntitlements: ["CoreHR"],
              email: "jane@example.com",
              fullName: "Jane Doe",
              roles: ["HRAdmin"],
              employeeId: "employee-1",
              accessToken: "fresh-token",
              refreshToken: "refresh-token-2",
              accessTokenExpiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
            errors: [],
            isSuccess: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { ok: true }, errors: [], isSuccess: true }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const api = createPlatformApiClient();
    await api.get("/protected");

    const [refreshUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe("/api/identity/auth/refresh");

    const [, protectedInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    const headers = protectedInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fresh-token");
    expect(JSON.parse(storage.ey_hr_auth!).user).toMatchObject({
      tenantId: "tenant-1",
      tenantMembershipId: "membership-1",
      moduleEntitlements: ["CoreHR"],
      employeeId: "employee-1",
    });
  });

  it("retries once after a 401 by refreshing the stored session", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("document", { cookie: "" });

    const storage: Record<string, string> = {
      ey_hr_auth: JSON.stringify({
        accessToken: "stale-token",
        refreshToken: "refresh-token-1",
        accessTokenExpiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        user: {
          userId: "user-1",
          email: "jane@example.com",
          fullName: "Jane Doe",
          roles: ["HRAdmin"],
          employeeId: "employee-1",
        },
      }),
    };

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    });

    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: null, errors: ["Unauthorized"], isSuccess: false }),
          { status: 401, statusText: "Unauthorized", headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              userId: "user-1",
              tenantId: "tenant-1",
              tenantMembershipId: "membership-1",
              moduleEntitlements: ["CoreHR"],
              email: "jane@example.com",
              fullName: "Jane Doe",
              roles: ["HRAdmin"],
              employeeId: "employee-1",
              accessToken: "fresh-token",
              refreshToken: "refresh-token-2",
              accessTokenExpiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
            errors: [],
            isSuccess: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { ok: true }, errors: [], isSuccess: true }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const api = createPlatformApiClient();
    await api.get("/protected");

    const [, retryInit] = fetchSpy.mock.calls[2] as [string, RequestInit];
    const headers = retryInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fresh-token");
    expect(JSON.parse(storage.ey_hr_auth!).user).toMatchObject({
      tenantId: "tenant-1",
      tenantMembershipId: "membership-1",
      moduleEntitlements: ["CoreHR"],
    });
  });
});

// ── SSR safety ───────────────────────────────────────────────────────
// The platform client must never crash when imported or called on the
// server (Node.js / Edge), where window and localStorage don't exist.

describe("SSR safety", () => {
  it("isBrowser returns false in Node (no window/document)", () => {
    // vitest runs in Node — window, document are NOT defined by default
    // (unless previously stubbed; afterEach clears stubs)
    expect(isBrowser()).toBe(false);
  });

  it("isBrowser returns true when window and document exist", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    expect(isBrowser()).toBe(true);
  });

  it("createPlatformApiClient() does not crash on server import", () => {
    // Simply creating the client on the server must not throw
    expect(() => createPlatformApiClient()).not.toThrow();
  });

  it("server-side request proceeds without auth (no localStorage access)", async () => {
    // No window, no document, no localStorage — pure Node environment.
    // The default getToken must return null without crashing.
    const api = createPlatformApiClient();
    await api.get("/public");

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("server-side request uses NEXT_PUBLIC_API_BASE_URL for absolute URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:5000/api");

    const api = createPlatformApiClient();
    await api.get("/training/courses");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5000/api/training/courses");
  });

  describe("a session that ended on its own", () => {
    function signedInBrowser(refreshToken: string | null) {
      const session: Record<string, string> = {};
      const local: Record<string, string> = {
        ey_hr_auth: JSON.stringify({
          accessToken: "expired-token",
          refreshToken,
          accessTokenExpiration: new Date(Date.now() - 5_000).toISOString(),
          user: { userId: "user-1", email: "jane@example.com", fullName: "Jane Doe", roles: [] },
        }),
      };
      const storage = (values: Record<string, string>) => ({
        getItem: (key: string) => values[key] ?? null,
        setItem: (key: string, value: string) => {
          values[key] = value;
        },
        removeItem: (key: string) => {
          delete values[key];
        },
      });
      vi.stubGlobal("window", { dispatchEvent: vi.fn() });
      vi.stubGlobal("document", { cookie: "" });
      vi.stubGlobal("localStorage", storage(local));
      vi.stubGlobal("sessionStorage", storage(session));
    }

    it("is marked when the refresh is refused", async () => {
      signedInBrowser("refresh-token");
      fetchSpy.mockResolvedValue(new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }));
      await createPlatformApiClient().get("/corehr/x").catch(() => undefined);
      expect(wasSessionExpired()).toBe(true);
    });

    it("is not marked when there was nothing to refresh, or the server just failed", async () => {
      signedInBrowser(null);
      fetchSpy.mockResolvedValue(new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }));
      await createPlatformApiClient().get("/corehr/x").catch(() => undefined);
      expect(wasSessionExpired()).toBe(false);

      signedInBrowser("refresh-token");
      fetchSpy.mockResolvedValue(new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }));
      await createPlatformApiClient().get("/corehr/x").catch(() => undefined);
      expect(wasSessionExpired()).toBe(false);
    });
  });
});
