/**
 * A company's colour as Fusion's theme (B-176). One `#rrggbb` becomes the primary tokens for both themes: the colour
 * itself on buttons and selection, white or near-black text on it (whichever reads better), and an "ink" shade for
 * text and icons in the colour that stays readable on the page. Dark mode lifts a colour too dark to see on dark
 * surfaces. State colours never follow (D-08): `--warning` stays Fusion's amber whatever the brand.
 */

export type BrandMode = "light" | "dark";

/** Fusion's own primary tokens, as `tokens.css` defines them, for previews that show "Fusion's" over a saved brand. */
const FUSION_TOKENS: Record<BrandMode, BrandTokens> = {
  light: {
    primary: "oklch(0.852 0.199 91.936)",
    primaryForeground: "oklch(0.421 0.095 57.708)",
    primaryInk: "oklch(0.78 0.18 91.936)",
    sidebarPrimary: "oklch(0.681 0.162 75.834)",
    sidebarPrimaryForeground: "oklch(0.987 0.026 102.212)",
  },
  dark: {
    primary: "oklch(0.795 0.184 86.047)",
    primaryForeground: "oklch(0.421 0.095 57.708)",
    primaryInk: "oklch(0.795 0.184 86.047)",
    sidebarPrimary: "oklch(0.795 0.184 86.047)",
    sidebarPrimaryForeground: "oklch(0.987 0.026 102.212)",
  },
};

/** Fusion's amber, which `--warning` keeps in each theme. */
const FUSION_WARNING: Record<BrandMode, string> = {
  light: FUSION_TOKENS.light.primary,
  dark: FUSION_TOKENS.dark.primary,
};

/** The surfaces text in the colour sits on: white cards in light mode, the dark card in dark mode. */
const SURFACE: Record<BrandMode, string> = { light: "#ffffff", dark: "#18181b" };
const WHITE = "#ffffff";
const INK = "#09090b";

/** WCAG's bar for body text, and for a control against what surrounds it. */
export const TEXT_CONTRAST = 4.5;
export const CONTROL_CONTRAST = 3;

/** Colours Fusion offers besides its own amber (null). */
export const FUSION_COLORS = ["#2f5fd0", "#17804a", "#c8364a", "#7c4dcc"] as const;

export interface BrandTokens {
  primary: string;
  primaryForeground: string;
  primaryInk: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isBrandColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  const part = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const fromLinear = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

type Oklch = [number, number, number];

function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklchToLinear([L, C, H]: Oklch): Rgb {
  const A = C * Math.cos((H * Math.PI) / 180);
  const B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The colour at this lightness and hue, its chroma reduced until it fits sRGB. */
function oklchToHex([L, C, H]: Oklch): string {
  let chroma = C;
  for (let step = 0; step < 24; step += 1) {
    const rgb = oklchToLinear([L, chroma, H]);
    if (rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005)) return rgbToHex(rgb.map(fromLinear) as Rgb);
    chroma *= 0.85;
  }
  return rgbToHex(oklchToLinear([L, 0, H]).map(fromLinear) as Rgb);
}

/**
 * The colour, moved lighter or darker (keeping its hue) until it reaches `ratio` against `surface`; unchanged when it
 * already does.
 */
function reachContrast(hex: string, surface: string, ratio: number, direction: "lighter" | "darker"): string {
  if (contrastRatio(hex, surface) >= ratio) return hex;
  const [L, C, H] = hexToOklch(hex);
  let candidate = hex;
  for (let lightness = L; lightness >= 0 && lightness <= 1; lightness += direction === "lighter" ? 0.01 : -0.01) {
    candidate = oklchToHex([lightness, C, H]);
    if (contrastRatio(candidate, surface) >= ratio) return candidate;
  }
  return candidate;
}

/** The text that reads best on the colour (white or near-black), and how well. */
export function readableText(color: string): { text: string; ratio: number; readable: boolean } {
  const onWhite = contrastRatio(color, WHITE);
  const onInk = contrastRatio(color, INK);
  const text = onWhite >= onInk ? WHITE : INK;
  const ratio = Math.max(onWhite, onInk);
  return { text, ratio, readable: ratio >= TEXT_CONTRAST };
}

/** The primary tokens for a company colour in one theme; Fusion's own when the colour is null. */
export function brandTokens(color: string | null, mode: BrandMode): BrandTokens {
  if (!isBrandColor(color)) return FUSION_TOKENS[mode];
  const hex = color.toLowerCase();
  const primary = mode === "dark" ? reachContrast(hex, SURFACE.dark, CONTROL_CONTRAST, "lighter") : hex;
  const foreground = readableText(primary).text;
  const primaryInk = reachContrast(hex, SURFACE[mode], TEXT_CONTRAST, mode === "dark" ? "lighter" : "darker");
  return {
    primary,
    primaryForeground: foreground,
    primaryInk,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: foreground,
  };
}

function declarations(color: string | null, mode: BrandMode): string {
  const tokens = brandTokens(color, mode);
  const tint = mode === "dark" ? [10, 20] : [22, 42];
  return [
    `--primary:${tokens.primary}`,
    `--primary-foreground:${tokens.primaryForeground}`,
    `--primary-ink:${tokens.primaryInk}`,
    `--primary-tint:color-mix(in oklab, var(--primary) ${tint[0]}%, transparent)`,
    `--primary-ring:color-mix(in oklab, var(--primary) ${tint[1]}%, transparent)`,
    `--sidebar-primary:${tokens.sidebarPrimary}`,
    `--sidebar-primary-foreground:${tokens.sidebarPrimaryForeground}`,
    `--warning:${FUSION_WARNING[mode]}`,
    `--warning-subtle:color-mix(in oklab, var(--warning) 15%, transparent)`,
  ].join(";");
}

/**
 * The stylesheet that puts a company colour on everything under `scope`. The global sheet (`:root`) outranks the
 * tokens' `:root` and `.dark` rules, forced-dark parts included (the sidebar, sign-in). A preview passes its own
 * scope, stronger still, so a draft shows over the saved brand; there a null colour writes Fusion's own tokens.
 * Without a colour the global sheet is empty: the tokens already are Fusion's.
 */
export function brandCss(color: string | null, scope?: string): string {
  if (!scope && !isBrandColor(color)) return "";
  const root = scope ?? ":root:root";
  const dark = scope ? `${root}.dark,${root} .dark,.dark ${root}` : `${root}.dark,${root} .dark`;
  return `${root}{${declarations(color, "light")}}${dark}{${declarations(color, "dark")}}`;
}

/** The scope selector for a preview frame, strong enough to sit over the saved brand. */
export function previewScope(id: string): string {
  const attribute = `[data-brand-preview="${id.replace(/[^a-z0-9-]/gi, "")}"]`;
  return attribute.repeat(4);
}

/**
 * Up to `limit` distinct colours a logo is made of, most used first: transparent, near-white, near-black and grey
 * pixels skipped, similar shades counted together, slivers under 3% of the logo ignored. RGBA pixels as a canvas gives them.
 */
export function logoColors(pixels: Uint8ClampedArray, limit = 3): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 128) continue;
    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  const picked: { hex: string; lab: Oklch }[] = [];
  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  // Edges blend neighbouring colours into shades of their own; a colour must cover enough of the logo to count.
  const opaque = ranked.reduce((sum, bucket) => sum + bucket.count, 0);
  for (const bucket of ranked) {
    if (bucket.count < opaque * 0.03) break;
    const hex = rgbToHex([bucket.r / bucket.count / 255, bucket.g / bucket.count / 255, bucket.b / bucket.count / 255]);
    const lab = hexToOklch(hex);
    const [L, C] = lab;
    if (L > 0.94 || L < 0.18 || C < 0.04) continue;
    const distinct = picked.every(({ lab: other }) => {
      const hueGap = Math.min(Math.abs(lab[2] - other[2]), 360 - Math.abs(lab[2] - other[2]));
      return hueGap > 24 || Math.abs(lab[0] - other[0]) > 0.18;
    });
    if (!distinct) continue;
    picked.push({ hex, lab });
    if (picked.length === limit) break;
  }
  return picked.map(({ hex }) => hex);
}
