import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("retired setup routes", () => {
  it("sends /getting-started and /setup to Home, where the setup guide lives", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    for (const source of ["/getting-started", "/setup", "/core/getting-started"]) {
      expect(redirects).toEqual(expect.arrayContaining([expect.objectContaining({ source, destination: "/", permanent: false })]));
    }
  });

  it("no longer serves either route from Core", async () => {
    const configured = await nextConfig.rewrites?.();
    const beforeFiles =
      (configured && !Array.isArray(configured) && "beforeFiles" in configured ? configured.beforeFiles : []) ?? [];
    expect(beforeFiles.some((rule) => rule.source === "/getting-started" || rule.source === "/setup")).toBe(false);
  });
});
