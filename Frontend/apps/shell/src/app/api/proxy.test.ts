import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./[...path]/route";

type NextReqInit = ConstructorParameters<typeof NextRequest>[1];
function req(url: string, init?: NextReqInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shell /api proxy — successful parity", () => {
  it("forwards method, path, query, headers, and body; returns upstream status/headers/body", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const upstreamBody = JSON.stringify({ data: { ok: true }, isSuccess: true });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        captured.url = url;
        captured.init = init;
        return Promise.resolve(
          new Response(upstreamBody, {
            status: 200,
            headers: {
              "content-type": "application/json",
              etag: 'W/"abc"',
              "content-disposition": "attachment; filename=x.json",
            },
          }),
        );
      }),
    );

    const response = await POST(
      req("/api/performance/cycles?take=5", {
        method: "POST",
        headers: { authorization: "Bearer t0ken", "x-tenant-id": "tenant-1" },
        body: JSON.stringify({ name: "Q1" }),
      }),
    );

    // URL: full path + exact query string preserved to the Gateway.
    expect(captured.url).toBe(
      "http://localhost:5000/api/performance/cycles?take=5",
    );
    expect(captured.init?.method).toBe("POST");

    // Authorization and relevant headers round-trip; per-connection headers are stripped.
    const fwd = new Headers(captured.init?.headers);
    expect(fwd.get("authorization")).toBe("Bearer t0ken");
    expect(fwd.get("x-tenant-id")).toBe("tenant-1");
    expect(fwd.get("content-length")).toBeNull();
    expect(fwd.get("host")).toBeNull();

    // Body is forwarded (streamed) with duplex set.
    expect(captured.init?.body).toBeDefined();
    expect((captured.init as { duplex?: string }).duplex).toBe("half");

    // Response: upstream status + headers + body unchanged.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("etag")).toBe('W/"abc"');
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=x.json",
    );
    await expect(response.text()).resolves.toBe(upstreamBody);
  });

  it("sends the Gateway one client address and drops other address claims", async () => {
    const captured: { init?: RequestInit } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        captured.init = init;
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );

    await GET(
      req("/api/identity/sso/discover", {
        headers: { "x-forwarded-for": "203.0.113.9, 127.0.0.1", forwarded: "for=203.0.113.9", "x-real-ip": "203.0.113.9" },
      }),
    );

    const fwd = new Headers(captured.init?.headers);
    expect(fwd.get("x-forwarded-for")).toBe("127.0.0.1");
    expect(fwd.get("forwarded")).toBeNull();
    expect(fwd.get("x-real-ip")).toBeNull();
  });

  it("passes through a 204 No Content unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    const response = await GET(req("/api/performance/context"));
    expect(response.status).toBe(204);
  });

  it("does not send a request body on GET", async () => {
    const captured: { init?: RequestInit } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        captured.init = init;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );

    await GET(req("/api/performance/context"));
    expect(captured.init?.body).toBeUndefined();
  });
});

describe("shell /api proxy — upstream attribution", () => {
  it("maps an unreachable Gateway to a typed 503 with a machine-readable code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    const response = await GET(req("/api/performance/context"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { code?: string; isSuccess?: boolean };
    expect(body.code).toBe("upstream_unavailable");
    expect(body.isSuccess).toBe(false);
  });

  it("does not swallow client cancellation as an upstream failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );

    await expect(GET(req("/api/performance/context"))).rejects.toBeInstanceOf(
      DOMException,
    );
  });

  it("treats a client disconnect (ResponseAborted) as cancellation, not a 503", async () => {
    // Next/undici throw `ResponseAborted` when the browser navigates away
    // mid-request. It must NOT be retried or attributed as upstream-unavailable.
    const aborted = Object.assign(new Error(""), { name: "ResponseAborted" });
    const fetchMock = vi.fn().mockRejectedValue(aborted);
    vi.stubGlobal("fetch", fetchMock);

    await expect(GET(req("/api/corehr/employees"))).rejects.toBe(aborted);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never retried
  });

  it("retries a bodyless GET once on a transient reset, then succeeds", async () => {
    // A stale keep-alive socket / under-load reset to a HEALTHY upstream must not
    // surface as a hard 503 — one retry recovers it.
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(req("/api/corehr/employees"));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when the transient retry also fails (real outage)", async () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi.fn().mockRejectedValue(reset);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(req("/api/corehr/employees"));
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a request with a body (single-use stream)", async () => {
    // Replaying a consumed request-body stream is unsafe, so a POST fails on the
    // first transient error rather than risking a double-send.
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const fetchMock = vi.fn().mockRejectedValue(reset);
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      req("/api/performance/cycles", { method: "POST", body: JSON.stringify({ n: 1 }) }),
    );
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
