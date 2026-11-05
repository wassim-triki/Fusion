// Single sign-on (B-191): sign in with Microsoft, Google or the company's own provider.

import type { RefreshResponse } from "./platform";

export const ssoPaths = {
  discover: (email: string, company?: string | null) =>
    `/identity/sso/discover?email=${encodeURIComponent(email)}${company ? `&company=${encodeURIComponent(company)}` : ""}`,
  flows: () => "/identity/sso/flows",
  result: () => "/identity/sso/result",
  settings: () => "/identity/sso/settings",
  providers: () => "/identity/sso/settings/providers",
  connection: () => "/identity/sso/settings/connection",
  domains: () => "/identity/sso/settings/domains",
  domain: (domain: string) => `/identity/sso/settings/domains/${encodeURIComponent(domain)}`,
  requirement: () => "/identity/sso/settings/requirement",
  links: (userId: string) => `/identity/sso/links?userId=${encodeURIComponent(userId)}`,
  link: (linkId: string) => `/identity/sso/links/${encodeURIComponent(linkId)}`,
  password: () => "/identity/account/password",
} as const;

/** `microsoft`, `google`, or `company` (the company's own provider). */
export type SsoProviderKey = "microsoft" | "google" | "company";

export interface SsoWayInDto {
  key: SsoProviderKey;
  label: string;
}

/** The ways in Fusion offers an address, decided by its domain, never by whether an account exists. */
export interface SsoWaysInDto {
  password: boolean;
  /** Only the company's administrators keep a password here. */
  passwordForAdministratorsOnly: boolean;
  providers: SsoWayInDto[];
}

export type SsoFlowPurpose = "signIn" | "invitation" | "test" | "confirm";
export type SsoInvitationKind = "workforce" | "administrator" | "bootstrap";

export interface StartSsoFlowRequest {
  purpose: SsoFlowPurpose;
  provider: SsoProviderKey;
  email?: string;
  invitation?: { kind: SsoInvitationKind; credential: string };
  /** A path inside Fusion to come back to (confirmations). */
  returnTo?: string;
}

export interface SsoFlowStartedDto {
  authorizeUrl: string;
}

export type SsoRefusalCode =
  | "no_account"
  | "email_not_verified"
  | "linked_to_someone_else"
  | "company_requires"
  | "provider_off"
  | "invitation_mismatch"
  | "invitation_closed"
  | "existing_account"
  | "operator"
  | "access_paused"
  | "provider_failed"
  | "expired";

export interface SsoRefusalDto {
  code: SsoRefusalCode;
  provider: SsoProviderKey | null;
  /** The company or its provider's name, when the refusal names one. */
  company: string | null;
  /** The address the provider returned. */
  email: string | null;
}

export interface SsoResultDto {
  /** The same session sign-in returns. */
  session: (RefreshResponse & { notificationPopups?: boolean; notificationSound?: boolean }) | null;
  refusal: SsoRefusalDto | null;
}

export interface SsoConnectionDto {
  id: string;
  kind: "MicrosoftEntra" | "OpenIdConnect";
  displayName: string;
  issuer: string;
  entraTenantId: string | null;
  clientId: string;
  secretSetAt: string;
  status: "Draft" | "Tested";
  lastTestAt: string | null;
  lastTestOutcome: "succeeded" | "failed" | null;
  lastTestEmail: string | null;
  lastTestMessage: string | null;
  requiredAt: string | null;
  requiredByName: string | null;
  requiredEndedSessions: number | null;
  lastSignInAt: string | null;
}

export interface SsoSettingsDto {
  canManage: boolean;
  allowMicrosoft: boolean;
  allowGoogle: boolean;
  microsoftAvailable: boolean;
  googleAvailable: boolean;
  /** The redirect address to register with the company's provider, known before the first save. */
  redirectUri: string;
  connection: SsoConnectionDto | null;
  domains: { domain: string; provedAt: string | null }[];
  administrators: { userId: string; name: string; hasPassword: boolean }[];
  you: { hasPassword: boolean; isAdministrator: boolean; confirmWith: SsoProviderKey[]; connectionLinkUsedAt: string | null };
  checks: { tested: boolean; domainProved: boolean; freshOwnLink: boolean; administratorWithPassword: boolean };
}

/** How someone confirms a sensitive change: their password, or a fresh sign-in through their provider. */
export interface SsoConfirmation {
  password?: string;
  sso?: boolean;
}

export interface SaveSsoConnectionRequest extends SsoConfirmation {
  kind: SsoConnectionDto["kind"];
  displayName: string;
  issuer?: string;
  entraTenantId?: string;
  clientId: string;
  /** Required when connecting; leave empty to keep the stored one. */
  clientSecret?: string;
}

export interface SsoLinkDto {
  id: string;
  provider: SsoProviderKey;
  label: string;
  email: string;
  linkedAt: string;
  lastUsedAt: string;
}

/** Problem codes a confirmation answers with. */
export const SSO_CONFIRMATION_CODES = ["password-incorrect", "password-locked", "confirmation-required"] as const;

/** Where a confirmation through the provider sends the browser back to: the page adds `confirmed=sso` or `confirmed=failed`. */
export const SSO_CONFIRMED_PARAM = "confirmed";
