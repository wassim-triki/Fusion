import { describe, expect, it } from "vitest";
import { buildResponseHeaders } from "./proxy-headers";

describe("the /api proxy's response headers", () => {
  it("passes every cookie the upstream sets, not only the last", () => {
    const upstream = new Response(null, { status: 302 });
    upstream.headers.append("set-cookie", "fusion_sso=a; Path=/api/identity/sso; HttpOnly; SameSite=Lax");
    upstream.headers.append("set-cookie", "other=b; Path=/");
    upstream.headers.set("location", "https://login.example/authorize");
    upstream.headers.set("content-length", "0");

    const headers = buildResponseHeaders(upstream);

    expect(headers.getSetCookie()).toEqual([
      "fusion_sso=a; Path=/api/identity/sso; HttpOnly; SameSite=Lax",
      "other=b; Path=/",
    ]);
    expect(headers.get("location")).toBe("https://login.example/authorize");
    expect(headers.get("content-length")).toBeNull();
  });
});
