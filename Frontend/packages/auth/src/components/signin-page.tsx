"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Landmark, Lock, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Label,
} from "@repo/ds";
import { useAuth } from "../auth-context";
import { loadAuth } from "../auth-service";
import type { AuthUser, LoginFailure } from "../types";
import {
  landingRequiresOrganizationReadiness,
  resolvePostSignInDestination,
  sanitizeInternalReturnPath,
  type OrganizationReadinessSignal,
} from "../routing";
import { fetchOrganizationReadySignal } from "../organization-ready-landing";
import { useSignInBrand } from "../sign-in-brand";
import { persistLanguageCookie } from "@repo/api";
import { LanguageMenu } from "@repo/ds/shell";
import { isLocale } from "@repo/i18n/config";

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

export function SignInPage({
  onSuccess,
}: SignInPageProps) {
  const t = useTranslations("auth.signIn");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { login, user, isLoading: authLoading, isAuthenticated } = useAuth();
  const intended = intendedDestination(searchParams);
  const brand = useSignInBrand(searchParams.get("company"), locale);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resolve the landing for the just-authenticated user. A safe callback decides
  // the destination on its own and needs no readiness read; only the
  // Tenant Administrator foundation fallback consults canonical Organization
  // readiness, which fails closed to Getting Started when it cannot be read.
  const finishSignIn = useCallback(
    async (nextUser: AuthUser | null, mode: "push" | "replace") => {
      if (onSuccess) {
        onSuccess();
        return;
      }

      let organizationReady: OrganizationReadinessSignal;
      if (
        !sanitizeInternalReturnPath(intended) &&
        landingRequiresOrganizationReadiness(nextUser)
      ) {
        organizationReady = await fetchOrganizationReadySignal();
      }

      navigateToRedirectTarget(
        resolvePostSignInDestination({
          intendedDestination: intended,
          user: nextUser,
          organizationReady,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setIsSubmitting(true);

    try {
      const result = await login({ email, password });
      if (result) {
        setErrors(failureMessages(result, locale, t));
      } else {
        await finishSignIn(loadAuth()?.user ?? null, "push");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <h1 className="type-page-title text-foreground">{t("title")}</h1>
        <p className="type-body text-muted-foreground">
          {brand.value ? t("to", { company: brand.value.name }) : t("subtitle")}
        </p>
      </div>
          <form onSubmit={handleSubmit} className="mt-8">
            <FieldGroup>
              {errors.length > 0 && (
                <Alert
                  variant="destructive"
                  className="border-destructive/30 bg-destructive/10"
                >
                  <AlertDescription className="text-destructive">
                    {errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

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
                    autoComplete="email"
                  />
                </InputGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="password" className="text-card-foreground">
                  {t("password")}
                </FieldLabel>
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
                    autoComplete="current-password"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-sm"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword ? t("hideCharacters") : t("showCharacters")
                      }
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>

              <div className="flex items-center justify-between">
                <Label
                  htmlFor="remember-me"
                  className="flex items-center gap-2 font-normal text-muted-foreground"
                >
                  <Checkbox
                    id="remember-me"
                    checked={rememberMe}
                    onCheckedChange={(value) => setRememberMe(value === true)}
                  />
                  {t("rememberMe")}
                </Label>
                <button
                  type="button"
                  className="type-label text-primary transition-colors hover:text-primary/80 focus-visible:underline focus-visible:outline-none"
                >
                  {t("forgotPassword")}
                </button>
              </div>

              <Button
                type="submit"
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

              <FieldSeparator className="[&_[data-slot=field-separator-content]]:bg-card">
                {t("or")}
              </FieldSeparator>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full text-sm"
              >
                <Landmark />
                {t("sso")}
              </Button>
            </FieldGroup>
          </form>
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
    </SignInFrame>
  );
}

/** The company a sign-in page carries, as far as it is known. */
export interface SignInBrand {
  name: string;
  logoUrl: string | null;
}

/**
 * Sign-in's frame (D-02): the company's side (logo and name, in a wash of its colour) beside the form; Fusion's own
 * side when no company is named. Forced dark like every page before sign-in. The brand studio previews this frame.
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
      <aside className="hidden flex-col justify-between bg-[color-mix(in_oklab,var(--primary)_16%,var(--section))] px-16 py-14 lg:flex">
        <div className="flex flex-col gap-7">
          {pending ? (
            <>
              <span className="size-[84px] animate-pulse rounded-surface bg-inlay" />
              <span className="h-12 w-80 animate-pulse rounded-control bg-inlay" />
            </>
          ) : brand ? (
            <>
              <BrandLogo name={brand.name} logoUrl={brand.logoUrl} />
              <h2 className="max-w-[32rem] font-editorial text-5xl font-medium leading-[1.1] tracking-tight">{brand.name}</h2>
            </>
          ) : (
            <Wordmark />
          )}
        </div>
        <p className="type-meta text-muted-foreground">Fusion</p>
      </aside>
      <main className="relative flex items-center justify-center px-6 py-16">
        {language ? <div className="absolute end-8 top-8">{language}</div> : null}
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
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
