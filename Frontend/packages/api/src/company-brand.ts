import type { ApiClient } from "./types";
import type { FusionTenantSummaryDto } from "./fusion-navigation";

/** The languages a company can speak by default. */
export type CompanyLanguage = "en" | "fr" | "ar";

/** What the save does with the logo: keep the current one, replace it with `logoPng`, or remove it. */
export type LogoChange = "keep" | "replace" | "remove";

/** The brand studio's one save (B-176); nothing changes for anyone until it succeeds. */
export interface SaveCompanyBrandRequest {
  name: string;
  /** `#rrggbb`, or null for Fusion's own colour. */
  color: string | null;
  language: CompanyLanguage;
  logo: LogoChange;
  /** A PNG as base64 (a data URL is fine), read only when `logo` is "replace". */
  logoPng?: string | null;
}

export interface BrandEmailPreviewRequest {
  name: string;
  color: string | null;
  language: CompanyLanguage;
  hasLogo: boolean;
}

/** The real invitation email in the draft brand; the logo shows as `cid:<logoContentId>`. */
export interface BrandEmailPreviewDto {
  subject: string;
  html: string;
  logoContentId: string;
}

/** A company's brand as its sign-in page shows it, before anyone signs in. */
export interface PublicCompanyBrandDto {
  name: string;
  slug: string;
  color: string | null;
  logoUrl: string | null;
  language: CompanyLanguage;
}

/** Where the browser remembers the last company signed in to, so its sign-in page wears that company's brand. */
export const LAST_COMPANY_KEY = "fusion:last-company";

export const companyBrandPaths = {
  save: () => "/identity/brand",
  emailPreview: () => "/identity/brand/email-preview",
  company: (slug: string) => `/identity/brand/companies/${encodeURIComponent(slug)}`,
} as const;

export const companyBrandQueryKeys = {
  company: (slug: string) => ["company-brand", "public", slug] as const,
  emailPreview: (request: BrandEmailPreviewRequest) => ["company-brand", "email-preview", request] as const,
};

export function createCompanyBrandApi(client: ApiClient) {
  return {
    save: (request: SaveCompanyBrandRequest) => client.put<FusionTenantSummaryDto>(companyBrandPaths.save(), request),
    emailPreview: (request: BrandEmailPreviewRequest, signal?: AbortSignal) =>
      client.post<BrandEmailPreviewDto>(companyBrandPaths.emailPreview(), request, { signal }),
    company: (slug: string, signal?: AbortSignal) =>
      client.get<PublicCompanyBrandDto>(companyBrandPaths.company(slug), { signal }),
  };
}

export type CompanyBrandApi = ReturnType<typeof createCompanyBrandApi>;
