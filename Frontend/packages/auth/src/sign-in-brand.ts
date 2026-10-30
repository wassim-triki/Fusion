"use client";

import { useEffect, useState } from "react";
import {
  LAST_COMPANY_KEY,
  createCompanyBrandApi,
  createPlatformApiClient,
  persistLanguageCookie,
  readLanguageCookie,
  type PublicCompanyBrandDto,
} from "@repo/api";
import { applyCompanyColor } from "@repo/ds/brand";

function readLastCompany(): string | null {
  try {
    return window.localStorage.getItem(LAST_COMPANY_KEY);
  } catch {
    return null;
  }
}

function forgetLastCompany(): void {
  try {
    window.localStorage.removeItem(LAST_COMPANY_KEY);
  } catch {
    // Storage may be blocked; the page still shows Fusion's own side.
  }
}

/**
 * The company sign-in wears (B-176): the one the link names (`?company=` in invitation and activation links), else
 * the one this browser last used, else none (Fusion's own). Its colour goes on the page; when this browser has no
 * language yet, the page switches to the company's.
 */
export function useSignInBrand(
  linked: string | null,
  locale: string,
): { value: PublicCompanyBrandDto | null; pending: boolean } {
  const [state, setState] = useState<{ value: PublicCompanyBrandDto | null; pending: boolean }>({
    value: null,
    pending: Boolean(linked),
  });

  useEffect(() => {
    const slug = linked?.trim() || readLastCompany();
    if (!slug) {
      setState({ value: null, pending: false });
      return;
    }
    setState((current) => ({ ...current, pending: true }));
    const controller = new AbortController();
    createCompanyBrandApi(createPlatformApiClient())
      .company(slug, controller.signal)
      .then((brand) => {
        applyCompanyColor(brand.color);
        setState({ value: brand, pending: false });
        if (!readLanguageCookie() && brand.language !== locale) {
          persistLanguageCookie(brand.language);
          // Only when the cookie took: a browser that refuses cookies would otherwise reload forever.
          if (readLanguageCookie() === brand.language) window.location.reload();
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (!linked) forgetLastCompany();
        applyCompanyColor(null);
        setState({ value: null, pending: false });
      });
    return () => controller.abort();
  }, [linked, locale]);

  return state;
}
