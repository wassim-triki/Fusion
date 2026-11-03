"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  Spinner,
  cn,
} from "@repo/ds";
import {
  InvitationContextPanel,
  InvitationTerminalCard,
  InvitationTransactionFrame,
  InvitationTransactionLoading,
  InvitationTransactionTerminalFrame,
  PasswordStrengthField,
} from "@repo/ds/shell";
import { login, persistAuth } from "@repo/auth";
import { OptionCards } from "@repo/ds/choice";
import { createPlatformApiClient, type AccessProfileAssignmentSummaryDto, type EffectivePermissionGrantDto } from "@repo/api";
import {
  ArrowRight,
  Ban,
  Building2,
  Check,
  CircleCheck,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Mail,
  RefreshCw,
  TriangleAlert,
  UserX,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  BOOTSTRAP_JOURNEY,
  journeyTerminalState,
  type ActivationEntry,
  type ActivationJourney,
  type ActivationFieldError,
  type ActivationForm,
  type ActivationOutcome,
  errorFor,
  passwordChecks,
  useActivationSay,
  validateForm,
} from "../../lib/activation";

type Phase =
  | { kind: "loading" }
  | { kind: "form"; entry: ActivationEntry }
  | { kind: "terminal"; outcome: ActivationOutcome };

/**
 * The one administrator-account journey, shared by the tenant's first
 * activation, an invitation from an existing administrator, and Platform
 * recovery. The variant supplies the endpoint and the words; the credential
 * handling, account creation, and session handoff are identical by design.
 */
export function ActivateInvitation({
  journey = BOOTSTRAP_JOURNEY,
}: {
  journey?: ActivationJourney;
} = {}) {
  const searchParams = useSearchParams();
  const locale = useLocale();

  // Read once and held. Scrubbing the address bar changes the search params, so
  // reading them on every render would hand the request an empty credential the
  // moment the credential is removed from the URL.
  const [credential] = useState(() => searchParams.get("credential") ?? "");

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function inspect() {
      try {
        const response = await fetch(
          `${journey.inspectPath}?credential=${encodeURIComponent(credential)}`,
          { headers: { Accept: "application/json" }, cache: "no-store" }
        );
        const body = await response.json();
        const entry = body?.data as ActivationEntry | undefined;

        if (cancelled) return;

        if (!entry) {
          setPhase({ kind: "terminal", outcome: "unavailable" });
          return;
        }

        setPhase(
          entry.state === "account_creation"
            ? { kind: "form", entry }
            : { kind: "terminal", outcome: entry.state }
        );
      } catch {
        if (!cancelled) setPhase({ kind: "terminal", outcome: "unavailable" });
      }
    }

    void inspect();
    return () => {
      cancelled = true;
    };
  }, [credential, journey.inspectPath]);

  // A terminal invitation carries no tenant name — the service withholds it so a
  // wrong credential cannot be used to discover which tenants exist. With nothing
  // to put in the context panel, those states use the focused single column
  // instead of a split with an empty half.
  if (phase.kind === "terminal") {
    return (
      <div lang={locale} className="contents">
        <InvitationTransactionTerminalFrame>
          <Terminal outcome={phase.outcome} journey={journey} />
        </InvitationTransactionTerminalFrame>
      </div>
    );
  }

  if (phase.kind === "loading") {
    return <InvitationTransactionLoading />;
  }

  return (
    <div lang={locale} className="contents">
      <InvitationTransactionFrame
        context={<TenantContext entry={phase.entry} journey={journey} />}
      >
        <AccountForm
          entry={phase.entry}
          credential={credential}
          journey={journey}
          onTerminal={(outcome) => setPhase({ kind: "terminal", outcome })}
        />
      </InvitationTransactionFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Context panel                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The invitation as an orientation, not a form: who invited the recipient, into
 * which organization, with which access, sent to which address. Each fact is
 * stated once, plainly, so the recipient can check the invitation is theirs
 * before choosing a password on the other half of the split.
 */
function TenantContext({
  entry,
  journey,
}: {
  entry: ActivationEntry;
  journey: ActivationJourney;
}) {
  const say = useActivationSay();
  const locale = useLocale();
  const tenantName = entry.tenantName ?? say("yourOrganization");
  // Prefer the role the invitation carries when it is a presentable label;
  // fall back to the journey's default rather than surfacing a raw role key.
  // The service names roles in English, so other languages use the journey's.
  const role =
    locale === "en" && entry.role && entry.role.includes(" ")
      ? entry.role
      : say(`journeys.${journey.key}.role`);

  return (
    <InvitationContextPanel
      eyebrow={say("context.eyebrow")}
      // The organization carries the display size: it is what the recipient
      // is checking, so the tenant is the hero.
      heading={say("context.heading", { tenant: tenantName })}
      lead={say("context.lead", { tenant: tenantName })}
      rows={[
        { icon: Building2, label: say("context.organization"), value: tenantName },
        { icon: Users, label: say("context.role"), value: role },
        ...(entry.invitedEmail
          ? [
              {
                icon: Mail,
                label: say("context.sentTo"),
                value: entry.invitedEmail,
              },
            ]
          : []),
      ]}
      securityNote={say("context.security")}
      footerLabel={say("context.footer")}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Terminal states                                                            */
/* -------------------------------------------------------------------------- */

/** One semantic glyph per stopping point, so the state reads before the words do. */
const TERMINAL_ICON: Record<string, LucideIcon> = {
  expired: Clock,
  revoked: Ban,
  superseded: RefreshCw,
  already_accepted: CircleCheck,
  existing_account: UserX,
  session_unavailable: CircleCheck,
};

/** Only the two states where activation actually succeeded read as resolved. */
const RESOLVED = new Set(["already_accepted", "session_unavailable"]);

function Terminal({
  outcome,
  journey,
}: {
  outcome: ActivationOutcome;
  journey: ActivationJourney;
}) {
  const say = useActivationSay();
  const state = journeyTerminalState(journey, outcome, say);

  return (
    <InvitationTerminalCard
      variant={RESOLVED.has(outcome) ? "resolved" : "error"}
      icon={TERMINAL_ICON[outcome] ?? TriangleAlert}
      title={state.title}
      detail={state.detail}
      action={state.action}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Account form                                                               */
/* -------------------------------------------------------------------------- */

function AccountForm({
  entry,
  credential,
  journey,
  onTerminal,
}: {
  entry: ActivationEntry;
  credential: string;
  journey: ActivationJourney;
  onTerminal: (outcome: ActivationOutcome) => void;
}) {
  const say = useActivationSay();
  const t = useTranslations("activation.form");
  const locale = useLocale();
  const [form, setForm] = useState<ActivationForm>(() => ({
    firstName: entry.firstName ?? "",
    lastName: entry.lastName ?? "",
    password: "",
    confirmPassword: "",
  }));
  const [errors, setErrors] = useState<ActivationFieldError[]>([]);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [retryable, setRetryable] = useState<string | null>(null);
  // D-10: the company's first administrator says whether they work there; yes makes them its first person.
  const asksWorkHere = journey.key === BOOTSTRAP_JOURNEY.key;
  const [worksHere, setWorksHere] = useState(true);
  const [jobTitle, setJobTitle] = useState("");

  const summaryRef = useRef<HTMLDivElement>(null);
  const checks = passwordChecks(form.password, entry.passwordRequirements, say);
  const passwordsMatch =
    Boolean(form.password) && form.confirmPassword === form.password;
  const passwordError = errorFor(errors, "password");
  const confirmError = errorFor(errors, "confirmPassword");
  const tenantName = entry.tenantName ?? say("yourOrganization");
  const lead = say(`journeys.${journey.key}.lead`, { tenant: tenantName });

  // The CTA is only actionable once every field the recipient controls is
  // valid; the service still revalidates on submit.
  const canSubmit =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.password.length > 0 &&
    checks.every((check) => check.satisfied) &&
    passwordsMatch &&
    (!asksWorkHere || !worksHere || jobTitle.trim().length > 0);

  const update = useCallback(
    (field: keyof ActivationForm, value: string) =>
      setForm((current) => ({ ...current, [field]: value })),
    []
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateForm(form, entry.passwordRequirements, say);
    setErrors(found);
    setRetryable(null);
    if (found.length > 0) return;

    setPending(true);
    try {
      const response = await fetch(journey.acceptPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          credential,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          password: form.password,
        }),
      });

      const body = await response.json().catch(() => null);

      if (response.ok && body?.data?.accessToken) {
        persistSession(body.data);

        if (asksWorkHere && worksHere) {
          // Their record comes after the account; if it can't be made now, Home still opens on the setup guide.
          try {
            await createPlatformApiClient().post("/corehr/me/first-person", {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              jobTitle: jobTitle.trim(),
              companyName: entry.tenantName,
            });
            // Linking the record ends the account's sessions (an authority change), so they sign in again here.
            persistSession(await login({ email: body.data.email, password: form.password }));
          } catch {
            // Home's guide carries on without it.
          }
        }

        // A full document load, so the shell and Core start from the new
        // tenant-scoped session rather than from state this page was holding.
        window.location.assign(journey.destination);
        return;
      }

      const reason = body?.data?.reason as string | undefined;

      if (reason === "invalid_details") {
        const fields = (body?.data?.fieldErrors ??
          []) as ActivationFieldError[];
        // The service words its field errors in English; other languages say
        // which field it refused in their own words.
        const notAccepted = (field: string) =>
          say(field === "password" ? "errors.passwordNotAccepted" : "errors.valueNotAccepted");
        setErrors(
          fields.length > 0
            ? fields.map((error) =>
                locale === "en" ? error : { ...error, message: notAccepted(error.field) }
              )
            : [{ field: "password", message: say("errors.passwordNotAccepted") }]
        );
        setPending(false);
        summaryRef.current?.focus();
        return;
      }

      if (
        reason === "existing_account" ||
        reason === "already_accepted" ||
        reason === "expired" ||
        reason === "revoked" ||
        reason === "superseded" ||
        reason === "invalid" ||
        // The invitation stopped being usable between rendering this form and
        // submitting it. Terminal, not retryable — offering the form again would
        // send the recipient back to a link that cannot work.
        reason === "not_activatable" ||
        reason === "not_acceptable" ||
        reason === "session_unavailable"
      ) {
        onTerminal(reason);
        return;
      }

      // Nothing about the invitation changed, so the recipient keeps their form
      // and can try again without retyping.
      setRetryable(say("errors.retry"));
      setPending(false);
    } catch {
      setRetryable(say("errors.retry"));
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <header>
        <h2 className="font-heading text-[1.875rem] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
          {say(`journeys.${journey.key}.heading`)}
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">
          {lead}
        </p>
      </header>

      {retryable ? (
        <Alert
          ref={summaryRef}
          tabIndex={-1}
          variant="destructive"
          className="mt-6 border-destructive/30 bg-destructive/10"
        >
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="text-destructive">
            {retryable}
          </AlertDescription>
        </Alert>
      ) : (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="sr-only" />
      )}

      <FieldGroup className="mt-6 gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="firstName"
            label={say("form.firstName")}
            autoComplete="given-name"
            value={form.firstName}
            error={errorFor(errors, "firstName")}
            onChange={(value) => update("firstName", value)}
          />
          <TextField
            id="lastName"
            label={say("form.lastName")}
            autoComplete="family-name"
            value={form.lastName}
            error={errorFor(errors, "lastName")}
            onChange={(value) => update("lastName", value)}
          />
        </div>

        {entry.invitedEmail ? (
          <Field>
            <FieldLabel htmlFor="workEmail">{say("form.workEmail")}</FieldLabel>
            {/* The invited address as a fact, not a field to change. It is shown
                so the recipient can confirm the invitation is theirs and see the
                address they will sign in with. */}
            <InputGroup className="h-11 bg-inlay dark:bg-inlay">
              <InputGroupInput
                id="workEmail"
                type="email"
                value={entry.invitedEmail}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                autoComplete="email"
                className="text-muted-foreground"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="text-[0.6875rem] font-medium uppercase tracking-[0.1em]">
                  {say("form.readOnly")}
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        ) : null}

        <PasswordStrengthField
          id="password"
          label={say("form.createPassword")}
          value={form.password}
          checks={checks}
          error={passwordError}
          onChange={(value) => update("password", value)}
        />

        <Field data-invalid={confirmError ? true : undefined}>
          <FieldLabel htmlFor="confirmPassword">{say("form.confirmPassword")}</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <Lock />
            </InputGroupAddon>
            <InputGroupInput
              id="confirmPassword"
              type={revealConfirm ? "text" : "password"}
              autoComplete="new-password"
              value={form.confirmPassword}
              aria-invalid={Boolean(confirmError)}
              onChange={(event) =>
                update("confirmPassword", event.target.value)
              }
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                onClick={() => setRevealConfirm((shown) => !shown)}
                aria-label={
                  revealConfirm ? say("form.hideCharacters") : say("form.showCharacters")
                }
              >
                {revealConfirm ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {/* A quiet match indicator, shown once the recipient starts confirming. */}
          {form.confirmPassword.length > 0 ? (
            <p
              className={cn(
                "flex items-center gap-2 text-xs",
                passwordsMatch ? "text-success" : "text-muted-foreground"
              )}
            >
              {passwordsMatch ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <X aria-hidden="true" className="size-3.5 text-muted-foreground/60" />
              )}
              {passwordsMatch ? say("form.passwordsMatch") : say("form.passwordsDoNotMatch")}
            </p>
          ) : null}
          {confirmError ? <FieldError>{confirmError}</FieldError> : null}
        </Field>

        {asksWorkHere ? (
          <WorkHere
            company={tenantName}
            worksHere={worksHere}
            jobTitle={jobTitle}
            onWorksHere={setWorksHere}
            onJobTitle={setJobTitle}
          />
        ) : null}

        <Button
          type="submit"
          size="lg"
          disabled={pending || !canSubmit}
          aria-busy={pending}
          aria-label={pending ? say("form.submit") : undefined}
          className="relative h-12 w-full text-[0.9375rem] font-semibold"
        >
          <span
            className={cn("inline-flex items-center gap-2", pending && "invisible")}
            aria-hidden={pending}
          >
            {say("form.submit")}
            <ArrowRight />
          </span>
          {pending ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner aria-hidden="true" />
            </span>
          ) : null}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {t.rich("haveAccount", {
            signIn: (chunks) => (
              <a href="/auth/signin" className="font-medium text-primary hover:underline">
                {chunks}
              </a>
            ),
          })}
        </p>
      </FieldGroup>
    </form>
  );
}

/** "Do you work at …?" as two choice cards; yes reveals the job title they hold. */
function WorkHere({
  company,
  worksHere,
  jobTitle,
  onWorksHere,
  onJobTitle,
}: {
  company: string;
  worksHere: boolean;
  jobTitle: string;
  onWorksHere: (value: boolean) => void;
  onJobTitle: (value: string) => void;
}) {
  const say = useActivationSay();
  return (
    <>
      <Field>
        <FieldLabel id="worksHere">{say("form.worksHere", { tenant: company })}</FieldLabel>
        <OptionCards
          label={say("form.worksHere", { tenant: company })}
          value={worksHere ? "yes" : "no"}
          onChange={(value) => onWorksHere(value === "yes")}
          columns={2}
          options={[
            { value: "yes", label: say("form.worksHereYes") },
            { value: "no", label: say("form.worksHereNo") },
          ]}
        />
      </Field>
      {worksHere ? (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          <TextField
            id="jobTitle"
            label={say("form.jobTitle")}
            autoComplete="organization-title"
            value={jobTitle}
            onChange={onJobTitle}
          />
        </div>
      ) : null}
    </>
  );
}

/** Keeps a session the service issued, the same shape for activation and sign-in. */
function persistSession(session: {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiration: string;
  userId: string;
  tenantId?: string | null;
  tenantMembershipId?: string | null;
  moduleEntitlements?: string[];
  email: string;
  fullName: string;
  roles?: string[];
  employeeId?: string | null;
  accessProfiles?: AccessProfileAssignmentSummaryDto[];
  effectivePermissions?: EffectivePermissionGrantDto[];
}) {
  persistAuth({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiration: session.accessTokenExpiration,
    user: {
      userId: session.userId,
      tenantId: session.tenantId ?? null,
      tenantMembershipId: session.tenantMembershipId ?? null,
      moduleEntitlements: session.moduleEntitlements ?? [],
      email: session.email,
      fullName: session.fullName,
      roles: session.roles ?? [],
      employeeId: session.employeeId ?? null,
      accessProfiles: session.accessProfiles ?? [],
      effectivePermissions: session.effectivePermissions ?? [],
    },
  });
}

function TextField({
  id,
  label,
  value,
  error,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        className="h-11"
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
