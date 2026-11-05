"use client";

import { startSsoFlow } from "@repo/auth";
import { SSO_CONFIRMED_PARAM, type SsoProviderKey } from "@repo/api";

const PENDING_KEY = "fusion_sso_pending";

/** What the page was about to do when it left to confirm through the provider. Never holds a secret. */
export type PendingConfirmation =
  | { action: "removeConnection" }
  | { action: "removeDomain"; domain: string }
  | { action: "requirementOff" }
  | { action: "saveConnection"; form: Record<string, string> }
  | { action: "setPassword" }
  | { action: "addAdministrator"; userId: string; name: string };

/**
 * Leaves to sign in again with the provider (B-191 D12); the provider sends the browser back here with
 * `confirmed=sso`, and the change goes through once, within five minutes.
 */
export async function confirmThroughProvider(provider: SsoProviderKey, pending: PendingConfirmation): Promise<string | null> {
  try {
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Without storage the page can't resume the change; the confirmation still holds for a retry.
  }
  return startSsoFlow({ purpose: "confirm", provider, returnTo: window.location.pathname }, { withSession: true });
}

/** On return: whether the provider confirmed it's them, and what they were doing. Clears both. */
export function takeConfirmation(): { confirmed: boolean; pending: PendingConfirmation | null } | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const result = url.searchParams.get(SSO_CONFIRMED_PARAM);
  if (!result) return null;
  url.searchParams.delete(SSO_CONFIRMED_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  let pending: PendingConfirmation | null = null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    pending = raw ? (JSON.parse(raw) as PendingConfirmation) : null;
  } catch {
    pending = null;
  }
  return { confirmed: result === "sso", pending };
}
