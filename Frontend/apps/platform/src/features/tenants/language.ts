import { useCallback, useMemo } from "react";
import { useLocale } from "next-intl";
import type { StatusTone } from "@repo/ds/shell";
import { dateFormatter } from "@repo/ds/lib/dates";
import { englishSay, useSay, type Say } from "@repo/ds/lib/say";
import { englishMessages } from "@/i18n/messages";
import { failureMessage } from "./api";
import type {
  DeliveryOutcomeValue,
  InvitationStateValue,
  TenantActivationStatus,
  TenantModule,
} from "./api";

/**
 * The single terminology source for the Platform tenant journey.
 *
 * Domain vocabulary and user-facing wording differ on purpose in a few places —
 * a `Superseded` invitation reads as `Replaced` — so every screen resolves its
 * words here instead of formatting enum names locally. The words live in the
 * `tenants` catalogue; {@link tenantWords} binds them to a language, English by
 * default, and {@link useTenantWords} to the person's.
 */

/** The `tenants` catalogue in English, for pure helpers' defaults and tests. */
export const sayTenantsInEnglish: Say = englishSay(englishMessages, "tenants");

/** The `tenants` catalogue in the person's language. */
export function useTenantsSay(): Say {
  return useSay("tenants");
}

export const TENANT_STATUS_TONE: Record<TenantActivationStatus, StatusTone> = {
  AwaitingAdministratorActivation: "info",
  Active: "success",
};

/**
 * What each invitation state means for the tenant, not merely whether it is
 * still open.
 *
 * Acceptance is the outcome the whole invitation exists to produce, so it reads
 * as resolved rather than as a problem. Expiry is the only state nobody chose —
 * it is what happens when the invitation was simply left — so it is the one that
 * asks for attention. Revocation and replacement were deliberate acts and settle
 * quietly into history.
 */
export const INVITATION_TONE: Record<InvitationStateValue, StatusTone> = {
  Pending: "info",
  Accepted: "success",
  Expired: "warning",
  Revoked: "muted",
  Superseded: "muted",
};

interface ModuleEntry {
  id: TenantModule;
  /** A product name, the same in every language. */
  label: string;
  /**
   * Core HR is the workforce truth every other module reads, so it is granted
   * with the tenant rather than chosen. The list says so instead of presenting
   * it as an entitlement someone selected.
   */
  mandatory: boolean;
}

/**
 * The supported module catalogue, keyed by the stable identifier the service
 * stores. Filtering and export use these identifiers; only the display layer
 * uses the labels.
 */
export const MODULE_CATALOGUE: ModuleEntry[] = [
  { id: "CoreHR", label: "Core HR", mandatory: true },
  { id: "Performance", label: "Performance", mandatory: false },
  { id: "Learning", label: "Learning", mandatory: false },
  { id: "Recruitment", label: "Recruitment", mandatory: false },
  { id: "Interview", label: "Interview", mandatory: false },
];

export const MODULE_IDS: TenantModule[] = MODULE_CATALOGUE.map(
  (entry) => entry.id
);

const MODULE_LABEL: Record<TenantModule, string> = Object.fromEntries(
  MODULE_CATALOGUE.map((entry) => [entry.id, entry.label])
) as Record<TenantModule, string>;

/**
 * A module the catalogue does not know yet still has to render truthfully — a
 * tenant entitled to something this build has no label for is a real state, not
 * a reason to show a blank.
 */
export function moduleLabel(id: string): string {
  return MODULE_LABEL[id as TenantModule] ?? id;
}

export function isModuleMandatory(id: string): boolean {
  return MODULE_CATALOGUE.find((entry) => entry.id === id)?.mandatory ?? false;
}

/**
 * The events with a title of their own, shared by the tenant record's timeline
 * and the directory's activity feed so the two cannot come to call the same
 * event different things.
 */
const TITLED_EVENTS = new Set([
  "TenantProvisioned",
  "InvitationResent",
  "InvitationRevoked",
  "InvitationReplaced",
  "InvitationReissued",
  "ActivationRejected",
  "BootstrapCompleted",
  "TenantDeactivated",
  "TenantReactivated",
  "TenantProfileChanged",
  "TenantArchived",
  "ProductEnabled",
  "ProductDisabled",
]);

const RECOVERY_ACTIONS = new Set(["resend", "revoke", "replace", "reissue"]);

/**
 * The outcomes the service records as success.
 *
 * There are two words, not one: most events settle as `Succeeded`, but a
 * delivery attempt settles as `Sent` or `Failed`. Testing for `Succeeded` alone
 * silently reported every delivered invitation as a bounce.
 */
const SUCCESS_OUTCOMES = new Set(["succeeded", "sent"]);

/**
 * Whether a recorded event represents a failure.
 *
 * An outcome this build does not recognise counts as a failure. That is the
 * conservative direction: an unexplained event shown as a problem invites a
 * look, whereas one shown as success is a false success — the thing the record
 * must never claim.
 */
export function isFailureOutcome(outcome: string): boolean {
  return !SUCCESS_OUTCOMES.has(outcome.trim().toLowerCase());
}

/**
 * Both formatters are built once per language rather than per call: they are
 * called inside timeline and table row loops. Created lazily so nothing is fixed
 * at module-evaluation time on the server.
 */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  let format = cache.get(locale);
  if (!format) {
    format = dateFormatter(options, locale);
    cache.set(locale, format);
  }
  return format;
}

/** "20 Oct 2026", "20 oct. 2026". */
export function formatDate(value: string, locale = "en"): string {
  return cachedFormatter(dateFormats, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

/** "20 Oct 2026, 11:00", "20 oct. 2026, 11:00". */
export function formatDateTime(value: string, locale = "en"): string {
  return cachedFormatter(dateTimeFormats, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Whole days from now, negative once the moment has passed. */
export function daysUntil(value: string): number {
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/**
 * The tenant journey's words in one language: statuses, events, recoveries,
 * absences and dates. Pure helpers take one, English by default; components use
 * {@link useTenantWords}.
 */
export function tenantWords(say: Say = sayTenantsInEnglish, locale = "en") {
  return {
    say,
    locale,
    status: (status: TenantActivationStatus) => say(`status.${status}`),
    invitation: (state: InvitationStateValue) => say(`invitation.${state}`),
    delivery: (outcome: DeliveryOutcomeValue) => say(`delivery.${outcome}`),
    /**
     * A delivery attempt is the only event whose meaning depends on its outcome:
     * the same record is either a sent invitation or a bounced one, and
     * "delivery attempted" tells the reader neither. An event this build has no
     * wording for is still real; it reports what it can rather than leaking the
     * stored name.
     */
    eventTitle: (eventType: string, failed: boolean) => {
      if (eventType === "InvitationDeliveryAttempted") {
        return say(failed ? "event.deliveryFailed" : "event.deliverySent");
      }
      return say(
        TITLED_EVENTS.has(eventType) ? `event.${eventType}` : "event.unknown"
      );
    },
    /** Null actor means the platform acted; the interface says so rather than blank. */
    eventActor: (actorName: string | null) =>
      actorName?.trim() || "Fusion Platform",
    recovery: (action: string) =>
      RECOVERY_ACTIONS.has(action) ? say(`recovery.${action}`) : action,
    /** The behaviour does not exist yet. */
    notAvailable: say("availability.notAvailable"),
    /** The behaviour is accepted and its source exists, but nothing is wired up. */
    notConnected: say("availability.notConnected"),
    date: (value: string) => formatDate(value, locale),
    dateTime: (value: string) => formatDateTime(value, locale),
    /**
     * A short "how long ago" phrase for recent moments, falling back to an
     * absolute date once it is old enough that the elapsed time stops being the
     * useful fact.
     */
    relative: (value: string) => {
      const seconds = Math.round(
        (Date.now() - new Date(value).getTime()) / 1000
      );
      if (seconds < 45) return say("ago.moments");
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return say("ago.minutes", { count: minutes });
      const hours = Math.round(minutes / 60);
      if (hours < 24) return say("ago.hours", { count: hours });
      const days = Math.round(hours / 24);
      if (days < 30) return say("ago.days", { count: days });
      return formatDate(value, locale);
    },
  };
}

export type TenantWords = ReturnType<typeof tenantWords>;

/**
 * A refusal in one line. The service words its refusals in English, so they read
 * as sent in English and as the screen's own line in other languages.
 */
export function useFailureMessage(): (
  error: unknown,
  fallback: string
) => string {
  const locale = useLocale();
  return useCallback(
    (error, fallback) =>
      locale === "en" ? (failureMessage(error) ?? fallback) : fallback,
    [locale]
  );
}

/** The service's own refusal, as a toast's optional detail: shown in English, left out in other languages. */
export function useFailureDetail(): (error: unknown) => string | undefined {
  const failureMessage = useFailureMessage();
  return useCallback(
    (error) => failureMessage(error, "") || undefined,
    [failureMessage]
  );
}

/** The tenant journey's words in the person's language. */
export function useTenantWords(): TenantWords {
  const say = useTenantsSay();
  const locale = useLocale();
  return useMemo(() => tenantWords(say, locale), [say, locale]);
}
