"use client";

import { useEffect } from "react";
import { BRAND_COOKIE, BRAND_STYLE_ID } from "./brand-style";
import { brandCss, isBrandColor } from "./palette";

/** Puts the colour on the page now and in the cookie the next page renders from. */
export function applyCompanyColor(color: string | null): void {
  const value = isBrandColor(color) ? color.toLowerCase() : "";
  let style = document.getElementById(BRAND_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = BRAND_STYLE_ID;
    document.body.appendChild(style);
  }
  const css = value ? brandCss(value) : "";
  if (style.textContent !== css) style.textContent = css;
  document.cookie = value
    ? `${BRAND_COOKIE}=${value.slice(1)}; path=/; max-age=31536000; samesite=lax`
    : `${BRAND_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Keeps the page in the company's colour once it is known (`undefined` while it loads leaves the page as the server
 * rendered it, from the cookie).
 */
export function useCompanyColor(color: string | null | undefined): void {
  useEffect(() => {
    if (color === undefined) return;
    applyCompanyColor(color);
  }, [color]);
}
