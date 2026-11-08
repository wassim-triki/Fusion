"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@repo/ds";
import { useAuth } from "../auth-context";
import { loadAuth } from "../auth-service";
import type { AuthUser, LoginFailure } from "../types";
import { resolvePostSignInDestination } from "../routing";
import { useSignInBrand } from "../sign-in-brand";
import { ProviderButton, startSsoFlow, takeSsoRefusal, useSsoRefusalText } from "../sso";
import {
  createPlatformApiClient,
  persistLanguageCookie,
  ssoPaths,
  type SsoProviderKey,
  type SsoRefusalDto,
  type SsoWaysInDto,
  wasSessionExpired,
} from "@repo/api";
import { LanguageMenu, PageStateDrawing } from "@repo/ds/shell";
import { isLocale } from "@repo/i18n/config";

const client = createPlatformApiClient();

export interface SignInPageProps {
  /** Called after successful login or when already authenticated. Defaults to callbackUrl/next or "/" */
  onSuccess?: () => void;
  /** @deprecated Self-service registration is disabled; this is retained for API compatibility. */
  signUpUrl?: string;
}

function intendedDestination(searchParams: Pick<URLSearchParams, "get">): string | null {
  return searchParams.get("callbackUrl") ?? searchParams.get("next");
}

/**
 * What a failed sign-in says. Identity answers wrong credentials with a 401 and no code, so that case is the
 * catalogue's line; any other answer reads as the server wrote it in English, and as a generic line in other
 * languages (server text is translated in a later phase).
 */
function failureMessages(
  failure: LoginFailure,
  locale: string,
  t: ReturnType<typeof useTranslations<"auth.signIn">>,
): string[] {
  if (failure.status === 401) return [t("invalidCredentials")];
  if (locale === "en" && failure.messages.length > 0) return failure.messages;
  return [t("failed")];
}

function navigateToRedirectTarget(target: string, mode: "push" | "replace") {
  if (mode === "replace") {
    window.location.replace(target);
  } else {
    window.location.assign(target);
  }
}

/** The reset request (B-295) for the address already typed, in the same company's brand. */
function forgotPasswordHref(email: string, company: string | null): string {
  const params = new URLSearchParams({ email });
  if (company) params.set("company", company);
  return `/auth/forgot-password?${params.toString()}`;
}

const PASSWORD_ONLY: SsoWaysInDto = { password: true, passwordForAdministratorsOnly: false, providers: [] };

/**
 * Sign-in, email first (B-191): step 1 asks for the address; step 2 offers only the ways in for it, decided by its
 * domain (the company's own provider, Microsoft, Google, the password), never by whether an account exists.
 */
export function SignInPage({ onSuccess }: SignInPageProps) {
  const t = useTranslations("auth.signIn");
  const ts = useTranslations("auth.sso");
  const refusalText = useSsoRefusalText();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { login, user, isLoading: authLoading, isAuthenticated } = useAuth();
  const intended = intendedDestination(searchParams);
  const companySlug = searchParams.get("company");
  const brand = useSignInBrand(companySlug, locale);

  const [email, setEmail] = useState("");
  const [ways, setWays] = useState<SsoWaysInDto | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<SsoRefusalDto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [expired, setExpired] = useState(false);

  // Read once the session has settled: restoring it is what finds out that it ended.
  useEffect(() => {
    if (!authLoading) setExpired(wasSessionExpired());
  }, [authLoading]);

  // Resolve the landing for the just-authenticated user: a safe callback, else the product's default.
  const finishSignIn = useCallback(
    async (nextUser: AuthUser | null, mode: "push" | "replace") => {
      if (onSuccess) {
        onSuccess();
        return;
      }

      navigateToRedirectTarget(
        resolvePostSignInDestination({
          intendedDestination: intended,
          user: nextUser,
        }) ?? "/",
        mode
      );
    },
    [intended, onSuccess]
  );

  // Redirect an already-authenticated visitor away from the sign-in form.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      void finishSignIn(user, "replace");
    }
  }, [authLoading, isAuthenticated, user, finishSignIn]);

  const discover = useCallback(
    async (address: string): Promise<SsoWaysInDto> => {
      try {
        return await client.get<SsoWaysInDto>(ssoPaths.discover(address, companySlug), { skipAuth: true });
      } catch {
        // Without an answer the password still works.
        return PASSWORD_ONLY;
      }
    },
    [companySlug],
  );

  // Back from a provider that refused: step 2 for the same address, saying why.
  useEffect(() => {
    const returned = takeSsoRefusal();
    if (!returned) return;
    setRefusal(returned);
    if (returned.email) {
      setEmail(returned.email);
      void discover(returned.email).then(setWays);
    }
  }, [discover]);

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setRefusal(null);
    setIsSubmitting(true);
    try {
      setWays(await discover(email.trim()));
      setPasswordOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setRefusal(null);
    setIsSubmitting(true);

    try {
      const result = await login({ email: email.trim(), password });
      if (result) {
        setErrors(failureMessages(result, locale, t));
      } else {
        await finishSignIn(loadAuth()?.user ?? null, "push");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWith = async (provider: SsoProviderKey) => {
    setErrors([]);
    setRefusal(null);
    setLeaving(true);
    const refused = await startSsoFlow({ purpose: "signIn", provider, email: email.trim() }, { next: intended });
    if (refused) {
      setLeaving(false);
      setRefusal({ code: refused as SsoRefusalDto["code"], provider, company: null, email: email.trim() });
    }
  };

  const changeAddress = () => {
    setWays(null);
    setPassword("");
    setErrors([]);
    setRefusal(null);
  };

  const companyWay = ways?.providers.find((way) => way.key === "company") ?? null;
  const otherWays = ways?.providers.filter((way) => way.key !== "company") ?? [];
  const showPasswordForm = ways !== null && (ways.password || passwordOpen);
  const message = refusal ? refusalText(refusal) : null;

  return (
    <SignInFrame
      brand={brand.value}
      pending={brand.pending}
      language={
        <LanguageMenu
          value={isLocale(locale) ? locale : "en"}
          onChange={(next) => {
            persistLanguageCookie(next);
            window.location.reload();
          }}
        />
      }
    >
      <div className="flex flex-col gap-1">
        {expired ? <PageStateDrawing kind="refused" size="small" className="mb-2.5 -ms-[15px]" /> : null}
        <h1 className="type-page-title text-foreground">{expired ? t("expiredTitle") : t("title")}</h1>
        <p className="type-body text-muted-foreground">
          {expired ? t("expiredBody") : brand.value ? t("to", { company: brand.value.name }) : t("subtitle")}
        </p>
      </div>

      {ways === null ? (
        <form onSubmit={handleContinue} className="mt-8">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email" className="text-card-foreground">
                {t("email")}
              </FieldLabel>
              <InputGroup className="h-11">
                <InputGroupAddon>
                  <Mail />
                </InputGroupAddon>
                <InputGroupInput
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                />
              </InputGroup>
            </Field>
            <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={isSubmitting || authLoading}>
              {t("continue")}
              <ArrowRight />
            </Button>
          </FieldGroup>
          <p className="mt-6 type-meta text-muted-foreground">
            {t.rich("agreement", {
              terms: (chunks) => (
                <a href="#" className="text-primary-ink hover:underline">
                  {chunks}
                </a>
              ),
              privacy: (chunks) => (
                <a href="#" className="text-primary-ink hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8">
          <FieldGroup>
            <div className="flex h-12 items-center gap-3 rounded-control border border-border bg-card ps-3.5 pe-1.5">
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate type-label">{email.trim()}</span>
              <Button type="button" variant="ghost" size="sm" onClick={changeAddress}>
                {t("change")}
              </Button>
            </div>

            {message ? (
              <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
                <AlertDescription className="text-destructive">
                  <p className="font-medium">{message.title}</p>
                  {message.more ? <p className="text-foreground">{message.more}</p> : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {errors.length > 0 && (
              <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
                <AlertDescription className="text-destructive">
                  {errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {companyWay || otherWays.length > 0 ? (
              <div className="grid gap-2.5">
                {companyWay ? (
                  <ProviderButton way={companyWay} primary disabled={leaving} onClick={() => void continueWith("company")} />
                ) : null}
                {otherWays.map((way) => (
                  <ProviderButton key={way.key} way={way} disabled={leaving} onClick={() => void continueWith(way.key)} />
                ))}
              </div>
            ) : null}

            {ways.passwordForAdministratorsOnly && !passwordOpen ? (
              <p className="text-center type-meta text-muted-foreground">
                {ts("administrator")}{" "}
                <button
                  type="button"
                  className="font-medium text-primary-ink hover:underline focus-visible:underline focus-visible:outline-none"
                  onClick={() => setPasswordOpen(true)}
                >
                  {ts("usePassword")}
                </button>
              </p>
            ) : null}

            {showPasswordForm ? (
              <>
                {ways.providers.length > 0 ? (
                  <FieldSeparator className="[&_[data-slot=field-separator-content]]:bg-background">
                    {t("or")}
                  </FieldSeparator>
                ) : null}
                <Field>
                  <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="password" className="text-card-foreground">
                      {t("password")}
                    </FieldLabel>
                    <a
                      href={forgotPasswordHref(email.trim(), companySlug)}
                      className="type-meta font-medium text-primary-ink hover:underline focus-visible:underline focus-visible:outline-none"
                    >
                      {t("forgot")}
                    </a>
                  </div>
                  <InputGroup className="h-11">
                    <InputGroupAddon>
                      <Lock />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={ways.providers.length === 0 || passwordOpen}
                      autoComplete="current-password"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-sm"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? t("hideCharacters") : t("showCharacters")}
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Button
                  type="submit"
                  variant={companyWay ? "outline" : "default"}
                  size="lg"
                  className="h-11 w-full text-sm"
                  disabled={isSubmitting || authLoading}
                >
                  {isSubmitting ? (
                    t("submitting")
                  ) : (
                    <>
                      {t("submit")}
                      <ArrowRight />
                    </>
                  )}
                </Button>
              </>
            ) : null}
          </FieldGroup>
        </form>
      )}
    </SignInFrame>
  );
}

/** The company a sign-in page carries, as far as it is known. */
export interface SignInBrand {
  name: string;
  logoUrl: string | null;
  /** The company's own sentence under its name (B-210). */
  welcomeLine?: string | null;
}

/**
 * Sign-in's frame (D-02, B-210): the company's side (logo, name and its welcome line, in a wash of its colour, with a
 * ring shape drawn in that colour behind them) beside the form; Fusion's own side when no company is named. Forced dark like every page before sign-in. The brand studio previews this frame.
 */
export function SignInFrame({
  brand,
  pending = false,
  language,
  className,
  children,
}: {
  brand: SignInBrand | null;
  pending?: boolean;
  language?: React.ReactNode;
  /** The studio's preview sizes the frame to its own box instead of the screen. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`dark grid bg-background text-foreground lg:grid-cols-2 ${className ?? "min-h-screen"}`}>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[color-mix(in_oklab,var(--primary)_16%,var(--section))] px-16 py-14 lg:flex">
        {pending ? null : <BrandMark />}
        <div className="relative flex flex-col items-start gap-7">
          {pending ? (
            <>
              <span className="size-[84px] animate-pulse rounded-surface bg-inlay" />
              <span className="h-12 w-80 animate-pulse rounded-control bg-inlay" />
            </>
          ) : brand ? (
            <>
              <BrandLogo name={brand.name} logoUrl={brand.logoUrl} />
              <h2 className="max-w-[30rem] font-editorial text-5xl font-medium leading-[1.1] tracking-tight">{brand.name}</h2>
              {brand.welcomeLine ? (
                <p className="max-w-[26rem] font-editorial text-xl leading-normal text-foreground/80">{brand.welcomeLine}</p>
              ) : null}
            </>
          ) : (
            <Wordmark />
          )}
        </div>
        <p className="relative type-meta text-muted-foreground">Fusion</p>
      </aside>
      <main className="relative flex items-center justify-center px-6 py-16">
        {language ? <div className="absolute end-8 top-8">{language}</div> : null}
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}

/** The column's shape: the rings of the logo's circle, in the company colour, running off the corner. */
function BrandMark() {
  return (
    <svg
      viewBox="0 0 760 760"
      aria-hidden
      className="pointer-events-none absolute -bottom-[220px] -end-[180px] size-[760px] text-primary"
    >
      <g fill="none" stroke="currentColor" strokeOpacity={0.22}>
        <circle cx="380" cy="380" r="300" strokeWidth="70" />
        <circle cx="380" cy="380" r="170" strokeWidth="2" />
        <circle cx="380" cy="380" r="370" strokeWidth="2" />
      </g>
      <rect x="350" y="80" width="60" height="150" rx="14" fill="currentColor" fillOpacity={0.18} />
    </svg>
  );
}

function BrandLogo({ name, logoUrl }: SignInBrand) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className="size-[84px] rounded-surface bg-card object-contain" />;
  }
  return (
    <span className="grid size-[84px] place-items-center rounded-surface bg-primary font-heading text-4xl font-bold text-primary-foreground">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Wordmark() {
  return (
    <div className="flex flex-col gap-7">
      <span className="grid size-[84px] place-items-center rounded-surface bg-primary font-heading text-4xl font-bold text-primary-foreground">
        F
      </span>
      <h2 className="font-editorial text-5xl font-medium leading-[1.1] tracking-tight">Fusion</h2>
    </div>
  );
}
