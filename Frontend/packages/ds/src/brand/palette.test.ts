import { describe, expect, it } from "vitest";
import { colorFromBrandCookie } from "./brand-style";
import {
  CONTROL_CONTRAST,
  TEXT_CONTRAST,
  brandCss,
  brandTokens,
  contrastRatio,
  logoColors,
  previewScope,
  readableText,
} from "./palette";

describe("brand palette", () => {
  it("measures contrast the WCAG way", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("puts white text on a dark colour and dark text on a light one", () => {
    expect(readableText("#2f5fd0")).toMatchObject({ text: "#ffffff", readable: true });
    expect(readableText("#ffd84d")).toMatchObject({ text: "#09090b", readable: true });
  });

  it("keeps the colour on buttons and deepens its ink until text in it reads on white", () => {
    const light = brandTokens("#ffd84d", "light");
    expect(light.primary).toBe("#ffd84d");
    expect(contrastRatio(light.primaryInk, "#ffffff")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it("lifts a colour too dark to see on dark surfaces", () => {
    const dark = brandTokens("#14213d", "dark");
    expect(contrastRatio(dark.primary, "#18181b")).toBeGreaterThanOrEqual(CONTROL_CONTRAST);
    expect(contrastRatio(dark.primaryInk, "#18181b")).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrastRatio(dark.primary, dark.primaryForeground)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it("never lets states follow the brand", () => {
    const css = brandCss("#c8364a");
    expect(css).toContain("--primary:#c8364a");
    expect(css).toContain("--warning:oklch(0.852 0.199 91.936)");
    expect(css).toContain("--warning:oklch(0.795 0.184 86.047)");
  });

  it("writes nothing globally for Fusion's own colour, but Fusion's tokens inside a preview", () => {
    expect(brandCss(null)).toBe("");
    expect(brandCss("not a colour")).toBe("");
    const preview = brandCss(null, previewScope("home"));
    expect(preview).toContain("--primary:oklch(0.852 0.199 91.936)");
    expect(preview.startsWith('[data-brand-preview="home"]'.repeat(4))).toBe(true);
  });

  it("outranks forced-dark parts like the sidebar", () => {
    expect(brandCss("#2f5fd0")).toContain(":root:root .dark{");
    expect(previewScope('x"]{}*{')).toBe('[data-brand-preview="x"]'.repeat(4));
  });

  it("reads only a colour from the cookie", () => {
    expect(colorFromBrandCookie("2F5FD0")).toBe("#2f5fd0");
    expect(colorFromBrandCookie("2f5fd0;}body{display:none")).toBeNull();
    expect(colorFromBrandCookie(undefined)).toBeNull();
  });

  it("finds a logo's colours, most used first, skipping white, black, grey and transparent", () => {
    const pixel = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
    const pixels = new Uint8ClampedArray([
      ...Array.from({ length: 50 }, () => pixel(255, 255, 255)).flat(),
      ...Array.from({ length: 40 }, () => pixel(10, 10, 10)).flat(),
      ...Array.from({ length: 30 }, () => pixel(128, 128, 128)).flat(),
      ...Array.from({ length: 30 }, () => pixel(0, 0, 255, 0)).flat(),
      ...Array.from({ length: 20 }, () => pixel(142, 42, 110)).flat(),
      ...Array.from({ length: 10 }, () => pixel(15, 124, 120)).flat(),
      ...Array.from({ length: 5 }, () => pixel(146, 44, 112)).flat(),
    ]);
    const colors = logoColors(pixels);
    expect(colors).toHaveLength(2);
    expect(colors[0]).toMatch(/^#8[ef]2[a-c]6[e-f]$/);
    expect(colors[1]).toBe("#0f7c78");
  });
});
