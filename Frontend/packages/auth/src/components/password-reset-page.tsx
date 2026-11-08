"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Lock, Mail, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Spinner,
} from "@repo/ds";
import { LanguageMenu, PageStateDrawing, PasswordStrengthField, passwordRuleChecks } from "@repo/ds/shell";
import {
  ApiError,
  createPlatformApiClient,
  passwordResetPaths,
  persistLanguageCookie,
  type AccountPasswordRequirementsDto,
  type PasswordResetLinkDto,
  type PasswordResetState,
} from "@repo/api";
import { isLocale } from "@repo/i18n/config";
import { useSignInBrand } from "../sign-in-brand";
import { SignInFrame } from "./signin-page";

const client = createPlatformApiClient();

/** Sign-in or the reset request for the same company, keeping its brand. */
function authHref(path: string, company: string | null, email?: string): string {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (company) params.set("company", company);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function ResetFrame({ company, children }: { company: string | null; children: React.ReactNode }) {
  const locale = useLocale();
  const brand = useSignInBrand(company, locale);
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
      {children}
    </SignInFrame>
  );
}

function Heading({ title, body }: { title: string; body?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="type-page-title text-foreground">{title}</h1>
      {body ? <p className="type-body text-muted-foreground">{body}</p> : null}
    </div>
  );
}

function AddressRow({ email }: { email: string }) {
  return (
    <div className="flex h-12 items-center gap-3 rounded-control border border-border bg-card px-3.5">
      <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate type-label">{email}</span>
    </div>
  );
}

function Failure({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
      <AlertDescription className="text-destructive">{children}</AlertDescription>
    </Alert>
  );
}

/**
 * Step one of a password reset (B-295): the address to send a link to. The answer is the same whether or not the
 * address has an account, so the page never says which.
 */
export function ForgotPasswordPage() {
  const t = useTranslations("auth.passwordReset");
  const searchParams = useSearchParams();
  const company = searchParams.get("company");
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const address = email.trim();
    try {
      await client.post(passwordResetPaths.request(), { email: address }, { skipAuth: true });
      setSentTo(address);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 429 ? t("tooMany") : t("sendFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <ResetFrame company={company}>
        <Heading title={t("sentTitle")} body={t.rich("sentBody", { email: () => <span className="text-foreground">{sentTo}</span> })} />
        <div className="mt-8 grid gap-2.5">
          <Button asChild size="lg" className="h-11 w-full text-sm">
            <a href={authHref("/auth/signin", company)}>
              <ArrowLeft />
              {t("backToSignIn")}
            </a>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="justify-self-center" onClick={() => setSentTo(null)}>
            {t("otherAddress")}
          </Button>
        </div>
      </ResetFrame>
    );
  }

  return (
    <ResetFrame company={company}>
      <Heading title={t("requestTitle")} body={t("requestBody")} />
      <form onSubmit={send} className="mt-8">
        <FieldGroup>
          {error ? <Failure>{error}</Failure> : null}
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
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </InputGroup>
          </Field>
          <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={isSubmitting}>
            {isSubmitting ? t("sending") : t("send")}
            {isSubmitting ? null : <ArrowRight />}
          </Button>
          <a
            href={authHref("/auth/signin", company)}
            className="justify-self-center type-meta font-medium text-primary-ink hover:underline"
          >
            {t("backToSignIn")}
          </a>
        </FieldGroup>
      </form>
    </ResetFrame>
  );
}

type ResetPhase =
  | { kind: "loading" }
  | { kind: "form"; email: string; requirements: AccountPasswordRequirementsDto }
  | { kind: "done"; email: string | null }
  | { kind: "ended"; state: Exclude<PasswordResetState, "ready" | "done"> };

/** The required rules as checkable rows, from what the service says it enforces. */
function requirementChecks(
  password: string,
  requirements: AccountPasswordRequirementsDto,
  t: ReturnType<typeof useTranslations<"auth.passwordReset">>,
) {
  return passwordRuleChecks(password, requirements, (rule, count) => t(`rules.${rule}`, { count }));
}

/**
 * Step two (B-295): the emailed link opens here to choose the new password. The token is read once and taken out of
 * the address bar, so it doesn't stay in history or travel on as a referrer.
 */
export function ResetPasswordPage() {
  const t = useTranslations("auth.passwordReset");
  const searchParams = useSearchParams();
  const company = searchParams.get("company");
  const [token] = useState(() => searchParams.get("token") ?? "");
  const [phase, setPhase] = useState<ResetPhase>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", authHref("/auth/reset-password", company));
  }, [company]);

  useEffect(() => {
    let cancelled = false;
    client
      .post<PasswordResetLinkDto>(passwordResetPaths.inspect(), { token }, { skipAuth: true })
      .then((link) => {
        if (cancelled) return;
        if (link.state === "ready" && link.email) {
          setPhase({ kind: "form", email: link.email, requirements: link.passwordRequirements });
        } else {
          setPhase({ kind: "ended", state: link.state === "ready" || link.state === "done" ? "invalid" : link.state });
        }
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: "ended", state: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (phase.kind === "loading") {
    return (
      <ResetFrame company={company}>
        <div className="flex justify-center py-16" role="status" aria-label={t("checking")}>
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </ResetFrame>
    );
  }

  if (phase.kind === "done") {
    return (
      <ResetFrame company={company}>
        <span className="mb-5 grid size-12 place-items-center rounded-full bg-success/15 text-success">
          <Check className="size-6" aria-hidden="true" />
        </span>
        <Heading title={t("doneTitle")} body={t("doneBody")} />
        <Button asChild size="lg" className="mt-8 h-11 w-full text-sm">
          <a href={authHref("/auth/signin", company)}>
            {t("signIn")}
            <ArrowRight />
          </a>
        </Button>
      </ResetFrame>
    );
  }

  if (phase.kind === "ended") {
    const providerRequired = phase.state === "provider_required";
    return (
      <ResetFrame company={company}>
        <PageStateDrawing kind={providerRequired ? "refused" : "gone"} size="small" className="mb-2.5 -ms-[15px]" />
        <Heading title={t(`ended.${phase.state}.title`)} body={t(`ended.${phase.state}.body`)} />
        <Button asChild size="lg" className="mt-8 h-11 w-full text-sm">
          <a href={authHref(providerRequired ? "/auth/signin" : "/auth/forgot-password", company)}>
            {providerRequired ? t("signIn") : t("askAgain")}
            <ArrowRight />
          </a>
        </Button>
      </ResetFrame>
    );
  }

  const checks = requirementChecks(password, phase.requirements, t);
  const matches = confirm.length > 0 && confirm === password;
  const ready = checks.every((check) => check.satisfied) && matches;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await client.post<PasswordResetLinkDto>(
        passwordResetPaths.complete(),
        { token, newPassword: password },
        { skipAuth: true },
      );
      setPhase({ kind: "done", email: result.email });
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : null;
      if (code === "expired" || code === "used" || code === "invalid" || code === "provider_required") {
        setPhase({ kind: "ended", state: code });
      } else if (code === "invalid-password") {
        setError(t("passwordRefused"));
      } else if (failure instanceof ApiError && failure.status === 429) {
        setError(t("tooMany"));
      } else {
        setError(t("saveFailed"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ResetFrame company={company}>
      <Heading title={t("chooseTitle")} />
      <form onSubmit={save} className="mt-8">
        <FieldGroup>
          <AddressRow email={phase.email} />
          {error ? <Failure>{error}</Failure> : null}
          <PasswordStrengthField
            id="new-password"
            label={t("newPassword")}
            value={password}
            onChange={setPassword}
            checks={checks}
          />
          <Field>
            <FieldLabel htmlFor="confirm-password">{t("confirmPassword")}</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupAddon>
                <Lock />
              </InputGroupAddon>
              <InputGroupInput
                id="confirm-password"
                type={revealConfirm ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  onClick={() => setRevealConfirm((shown) => !shown)}
                  aria-label={revealConfirm ? t("hideCharacters") : t("showCharacters")}
                >
                  {revealConfirm ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {confirm.length > 0 ? (
              <p className={`flex items-center gap-1.5 text-xs ${matches ? "text-success" : "text-muted-foreground"}`}>
                {matches ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
                {matches ? t("matches") : t("doesNotMatch")}
              </p>
            ) : null}
          </Field>
          <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={!ready || isSubmitting}>
            {isSubmitting ? t("saving") : t("save")}
          </Button>
        </FieldGroup>
      </form>
    </ResetFrame>
  );
}
