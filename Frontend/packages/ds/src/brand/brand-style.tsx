import { brandCss, isBrandColor } from "./palette";

/** The cookie that carries the company colour to the server, so a page renders in it from the first paint. */
export const BRAND_COOKIE = "fusion-brand";

/** The id of the global brand stylesheet, which `useCompanyColor` updates in place. */
export const BRAND_STYLE_ID = "fusion-brand";

/** The colour a {@link BRAND_COOKIE} value names (`rrggbb`, no hash), or null for anything else. */
export function colorFromBrandCookie(value: string | null | undefined): string | null {
  const color = `#${value ?? ""}`;
  return isBrandColor(color) ? color.toLowerCase() : null;
}

/**
 * The company colour as a stylesheet. Rendered by each app's root layout from {@link BRAND_COOKIE}; renders nothing
 * for Fusion's own colour or a value that isn't a colour (the cookie is client-written, so it is checked here).
 */
export function BrandStyle({ cookie }: { cookie: string | null | undefined }) {
  const color = colorFromBrandCookie(cookie);
  const css = color ? brandCss(color) : "";
  return <style id={BRAND_STYLE_ID} dangerouslySetInnerHTML={{ __html: css }} />;
}
