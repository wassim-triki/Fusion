"use client";

import { useTranslations } from "next-intl";
import {
  ApiError,
  createPlatformApiClient,
  ssoPaths,
  type SsoFlowStartedDto,
  type SsoProviderKey,
  type SsoRefusalDto,
  type SsoWayInDto,
  type StartSsoFlowRequest,
} from "@repo/api";
import { Button } from "@repo/ds";

const client = createPlatformApiClient();

/** Where the provider round trip started and where the person meant to go, kept in this tab only. */
const ORIGIN_KEY = "fusion_sso_origin";
const NEXT_KEY = "fusion_sso_next";
const REFUSAL_KEY = "fusion_sso_refusal";

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Starts a round trip to a provider (B-191) and leaves for it. Answers the refusal code when Fusion won't start one
 * (a switched-off provider, a closed invitation). The page it starts from is where a refusal comes back to.
 */
export async function startSsoFlow(
  request: StartSsoFlowRequest,
  options: { next?: string | null; withSession?: boolean; origin?: string } = {},
): Promise<string | null> {
  try {
    const started = await client.post<SsoFlowStartedDto>(ssoPaths.flows(), request, {
      skipAuth: !options.withSession,
    });
    // Only ever leave for a web address; the server already refuses anything else.
    const target = new URL(started.authorizeUrl);
    if (target.protocol !== "https:" && target.protocol !== "http:") return "provider_failed";
    const store = session();
    store?.setItem(ORIGIN_KEY, options.origin ?? `${window.location.pathname}${window.location.search}`);
    if (options.next) store?.setItem(NEXT_KEY, options.next);
    else store?.removeItem(NEXT_KEY);
    window.location.assign(target.toString());
    return null;
  } catch (error) {
    return error instanceof ApiError ? (error.code ?? "provider_failed") : "provider_failed";
  }
}

/** Called by the landing page with what the round trip ended in. */
export function finishSsoFlow(refusal: SsoRefusalDto | null): { origin: string; next: string | null } {
  const store = session();
  const origin = store?.getItem(ORIGIN_KEY) ?? "/auth/signin";
  const next = store?.getItem(NEXT_KEY) ?? null;
  store?.removeItem(ORIGIN_KEY);
  store?.removeItem(NEXT_KEY);
  if (refusal) store?.setItem(REFUSAL_KEY, JSON.stringify(refusal));
  const inside = origin.startsWith("/") && !origin.startsWith("//") && !origin.includes("\\");
  return { origin: inside ? origin : "/auth/signin", next };
}

/** The refusal a round trip came back with, once. */
export function takeSsoRefusal(): SsoRefusalDto | null {
  const store = session();
  const raw = store?.getItem(REFUSAL_KEY);
  store?.removeItem(REFUSAL_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SsoRefusalDto;
  } catch {
    return null;
  }
}

/** The person-facing explanation of a refusal: a line saying what happened, and one saying what to do. */
export function useSsoRefusalText() {
  const t = useTranslations("auth.sso");
  return (refusal: Pick<SsoRefusalDto, "code"> & Partial<SsoRefusalDto>, context?: { invitedEmail?: string }) => {
    const provider =
      refusal.provider === "microsoft"
        ? "Microsoft"
        : refusal.provider === "google"
          ? "Google"
          : (refusal.company ?? t("yourProvider"));
    const values = {
      provider,
      company: refusal.company ?? t("yourCompany"),
      email: refusal.email ?? "",
      invited: context?.invitedEmail ?? "",
    };
    const known = [
      "no_account",
      "email_not_verified",
      "linked_to_someone_else",
      "company_requires",
      "provider_off",
      "invitation_mismatch",
      "invitation_closed",
      "existing_account",
      "operator",
      "access_paused",
      "expired",
    ];
    const code = known.includes(refusal.code) ? refusal.code : "provider_failed";
    // Keys built from the code; every code has a title, some a second line.
    const say = t as unknown as { (key: string, values: Record<string, string>): string; has(key: string): boolean };
    const title = say(`refusals.${code}.title`, values);
    const more = say.has(`refusals.${code}.more`) ? say(`refusals.${code}.more`, values) : null;
    return { title, more };
  };
}

/** Microsoft's and Google's own marks; the company's initial in its colour. */
export function ProviderMark({ provider, label }: { provider: SsoProviderKey; label: string }) {
  if (provider === "microsoft") {
    return (
      <svg viewBox="0 0 18 18" aria-hidden="true" className="size-[18px] shrink-0">
        <rect x="0" y="0" width="8.5" height="8.5" fill="#f25022" />
        <rect x="9.5" y="0" width="8.5" height="8.5" fill="#7fba00" />
        <rect x="0" y="9.5" width="8.5" height="8.5" fill="#00a4ef" />
        <rect x="9.5" y="9.5" width="8.5" height="8.5" fill="#ffb900" />
      </svg>
    );
  }
  if (provider === "google") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" className="size-[18px] shrink-0">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-[22px] shrink-0 place-items-center rounded-detail bg-primary-foreground text-xs font-bold text-primary"
    >
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** One way in, as a full-width button: the company's own provider leads in the company's colour. */
export function ProviderButton({
  way,
  primary = false,
  disabled,
  onClick,
  verb = "continue",
}: {
  way: SsoWayInDto;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  verb?: "continue" | "confirm";
}) {
  const t = useTranslations("auth.sso");
  return (
    <Button
      type="button"
      variant={primary ? "default" : "outline"}
      size="lg"
      className="h-11 w-full text-sm"
      disabled={disabled}
      onClick={onClick}
    >
      <ProviderMark provider={way.key} label={way.label} />
      {verb === "confirm" ? t("confirmWith", { provider: way.label }) : t("continueWith", { provider: way.label })}
    </Button>
  );
}
