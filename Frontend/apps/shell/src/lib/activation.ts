import { formatDateTime } from "@repo/ds/lib/dates";
import { englishSay, useSay, type Say } from "@repo/ds/lib/say";
import en from "../../messages/en.json";

/**
 * The public activation surface's vocabulary and rules, kept out of the
 * component so they can be tested without rendering and so every state has one
 * definition rather than a string written twice. The words live in the shell's
 * `activation` catalogue; every function takes the person's {@link Say}, English
 * by default.
 */

export type { Say };

/** The catalogue in English, for code outside a translated tree (and tests). */
export const sayInEnglish: Say = englishSay(en, "activation");

/** The catalogue in the person's language, for the activation surface's components. */
export function useActivationSay(): Say {
  return useSay("activation");
}

export type ActivationEntryState =
  | "account_creation"
  | "invalid"
  | "expired"
  | "revoked"
  | "superseded"
  | "already_accepted"
  | "existing_account";

export interface PasswordRequirements {
  minimumLength: number;
  /** Upper bound; advisory on the client, enforced by the service. */
  maximumLength?: number;
  /** At least one letter of either case. */
  requiresLetter?: boolean;
  requiresDigit: boolean;
  requiresLowercase: boolean;
  requiresUppercase: boolean;
  requiresSymbol: boolean;
}

export interface ActivationEntry {
  state: ActivationEntryState;
  tenantName: string | null;
  invitedEmail: string | null;
  expiresAt: string | null;
  /** Pre-filled from the invitation when it captured them; still editable. */
  firstName?: string | null;
  lastName?: string | null;
  /** The access this invitation grants, for the context panel. */
  role?: string | null;
  passwordRequirements: PasswordRequirements | null;
}

export interface ActivationFieldError {
  field: string;
  message: string;
}

/** Every way the page can stop, including the three the entry state cannot reach. */
export type ActivationOutcome =
  | ActivationEntryState
  | "session_unavailable"
  /**
   * The service revalidates under a lock, so an invitation revoked, replaced or
   * expired between rendering the form and submitting it refuses here rather
   * than at entry. It is terminal: treating it as a retryable failure told the
   * recipient to try again at a link that will never work again.
   */
  | "not_activatable"

  /**
   * The administrator and recovery journeys' equivalent of `not_activatable`:
   * revalidation under the lock found the invitation no longer acceptable.
   */
  | "not_acceptable"
  | "unavailable";

export interface TerminalState {
  title: string;
  detail: string;
  /** The one real recovery, when one exists. */
  action?: { label: string; href: string };
}

/** Each stopping point's lines in the catalogue (`terminal.<group>`); anything unrecognised is the neutral refusal. */
const TERMINAL_GROUP: Partial<Record<ActivationOutcome, string>> = {
  expired: "expired",
  revoked: "revoked",
  superseded: "superseded",
  already_accepted: "alreadyAccepted",
  existing_account: "existingAccount",
  // Activation committed. Saying anything that implies otherwise would send the
  // recipient back to repeat work that already succeeded.
  session_unavailable: "sessionUnavailable",
};

/** The stopping points whose one real recovery is signing in. */
const SIGN_IN_OUTCOMES = new Set<ActivationOutcome>(["already_accepted", "session_unavailable"]);

function terminalLines(group: string, outcome: ActivationOutcome, say: Say): TerminalState {
  return {
    title: say(`${group}.title`),
    detail: say(`${group}.detail`),
    ...(SIGN_IN_OUTCOMES.has(outcome) ? { action: { label: say("signIn"), href: "/auth/signin" } } : {}),
  };
}

/**
 * What each stopping point says.
 *
 * Every one of these states the recipient can do nothing about alone, so each
 * says what happened, whether an account or access was created, and who to go
 * to. None of them names a service, a status code or an identifier.
 */
export function terminalState(outcome: ActivationOutcome, say: Say = sayInEnglish): TerminalState {
  return terminalLines(`terminal.${TERMINAL_GROUP[outcome] ?? "invalid"}`, outcome, say);
}

export interface PasswordCheck {
  label: string;
  satisfied: boolean;
}

/**
 * The requirements as checkable state rather than a sentence, so the recipient
 * can see which one is outstanding while typing instead of after submitting.
 */
export function passwordChecks(
  password: string,
  requirements: PasswordRequirements | null,
  say: Say = sayInEnglish
): PasswordCheck[] {
  if (!requirements) return [];

  const checks: PasswordCheck[] = [
    {
      label: say("password.minimumLength", { count: requirements.minimumLength }),
      satisfied: password.length >= requirements.minimumLength,
    },
  ];

  if (requirements.requiresLetter) {
    checks.push({ label: say("password.letter"), satisfied: /[a-zA-Z]/.test(password) });
  }
  if (requirements.requiresUppercase) {
    checks.push({ label: say("password.uppercase"), satisfied: /[A-Z]/.test(password) });
  }
  if (requirements.requiresLowercase) {
    checks.push({ label: say("password.lowercase"), satisfied: /[a-z]/.test(password) });
  }
  if (requirements.requiresDigit) {
    checks.push({ label: say("password.number"), satisfied: /[0-9]/.test(password) });
  }
  if (requirements.requiresSymbol) {
    checks.push({
      label: say("password.symbol"),
      satisfied: /[^a-zA-Z0-9]/.test(password),
    });
  }

  return checks;
}

export interface ActivationForm {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

/**
 * Client-side checks only where the client is the authority. The password policy
 * itself is the service's, which is why only the confirmation mismatch and empty
 * fields are decided here — anything stricter would be a second policy free to
 * disagree with the one that actually applies.
 */
export function validateForm(
  form: ActivationForm,
  requirements: PasswordRequirements | null,
  say: Say = sayInEnglish
): ActivationFieldError[] {
  const errors: ActivationFieldError[] = [];

  if (!form.firstName.trim()) {
    errors.push({ field: "firstName", message: say("errors.firstName") });
  }
  if (!form.lastName.trim()) {
    errors.push({ field: "lastName", message: say("errors.lastName") });
  }
  if (!form.password) {
    errors.push({ field: "password", message: say("errors.password") });
  } else if (passwordChecks(form.password, requirements, say).some((check) => !check.satisfied)) {
    errors.push({ field: "password", message: say("errors.passwordRequirements") });
  }
  if (form.password && form.confirmPassword !== form.password) {
    errors.push({ field: "confirmPassword", message: say("errors.confirmPassword") });
  }

  return errors;
}

export function errorFor(
  errors: ActivationFieldError[],
  field: string
): string | undefined {
  return errors.find((error) => error.field === field)?.message;
}

/**
 * The tenant's initials, as an identity aid beside its name.
 *
 * Two letters from the first and last significant word, one when there is only
 * one word. Purely presentational: it never stands in for the tenant name, which
 * is always shown in full next to it.
 */
export function monogramFor(tenantName: string | null): string {
  const words = (tenantName ?? "")
    .split(/[\s\-_/]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();

  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * The expiry as a date the recipient can act on. Falls back to nothing rather
 * than to an invented value.
 */
export function formatExpiry(value: string | null, locale?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return formatDateTime(parsed, { year: "always", locale });
}

/**
 * Removes the credential from the address bar once it has been read.
 *
 * The raw credential is reusable until the invitation is accepted, and it would
 * otherwise sit in browser history, in a screen share, and in anything the
 * recipient copies out of the address bar.
 */
export function scrubbedUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (!url.searchParams.has("credential")) return null;
    url.searchParams.delete("credential");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}


/**
 * What differs between the three ways someone arrives at an administrator
 * account: the tenant's first activation, an invitation from an existing
 * administrator, and Platform-assisted recovery.
 *
 * They share one journey deliberately. The recipient's task is identical —
 * prove the link, create an account, land in the tenant — and giving each its
 * own authentication design would mean three places for a security-relevant
 * flow to drift apart. Only the words and the endpoint change.
 */
export interface ActivationJourney {
  /** Its words in the catalogue: `journeys.<key>` (role, heading, lead with `{tenant}`). */
  key: "bootstrap" | "administrator" | "recovery";

  /** Read-only inspection of the credential (GET, with `?credential=`). */
  inspectPath: string;

  /** Account creation and session handoff (POST). */
  acceptPath: string;

  /** Where the new administrator lands once the session is established. */
  destination: string;

  /**
   * Stopping points where this journey says something different from the
   * tenant's first activation (`journeys.<key>.terminal`). Anything else falls
   * through to the shared wording.
   */
  terminalOverrides?: readonly ActivationOutcome[];
}

/** The tenant's first administrator, from Platform provisioning. */
export const BOOTSTRAP_JOURNEY: ActivationJourney = {
  key: "bootstrap",
  inspectPath: "/api/identity/tenant-activation",
  acceptPath: "/api/identity/tenant-activation",
  // Canonical tenant-foundation orientation, reached only after the
  // tenant-scoped session exists — this is the handoff, not a success screen.
  // Getting Started reads canonical Organization readiness and shows the
  // truthful state; a brand-new tenant is not yet Ready.
  destination: "/getting-started",
};

/** An additional administrator, invited by an existing one. */
export const ADMINISTRATOR_JOURNEY: ActivationJourney = {
  key: "administrator",
  inspectPath: "/api/identity/tenant-access/invitations/inspect",
  acceptPath: "/api/identity/tenant-access/invitations/accept",
  destination: "/core/settings/roles/administrators",
  terminalOverrides: ["expired", "revoked", "existing_account"],
};

/**
 * Platform-assisted recovery, when a tenant has lost every administrator.
 *
 * The recipient needs to understand two things the ordinary journey does not
 * say: that this restores administration the customer controls, and that
 * Platform operators get nothing from it.
 */
export const RECOVERY_JOURNEY: ActivationJourney = {
  key: "recovery",
  inspectPath: "/api/identity/tenant-access/invitations/inspect",
  acceptPath: "/api/identity/tenant-access/invitations/accept",
  destination: "/getting-started",
  terminalOverrides: ["expired", "revoked", "already_accepted", "existing_account"],
};

/** The stopping-point copy for one journey, with its overrides applied. */
export function journeyTerminalState(
  journey: ActivationJourney,
  outcome: ActivationOutcome,
  say: Say = sayInEnglish
): TerminalState {
  return journey.terminalOverrides?.includes(outcome)
    ? terminalLines(`journeys.${journey.key}.terminal.${TERMINAL_GROUP[outcome]}`, outcome, say)
    : terminalState(outcome, say);
}
