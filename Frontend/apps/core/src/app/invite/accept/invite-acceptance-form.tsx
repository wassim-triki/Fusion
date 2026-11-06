"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, type AccountPasswordRequirementsDto, type SsoProviderKey, type SsoRefusalDto } from "@repo/api";
import { InvitationEnd, login as apiLogin, persistAuth, ProviderButton, startSsoFlow, takeSsoRefusal, useSsoRefusalText } from "@repo/auth";
import type { AuthUser, StoredAuth } from "@repo/auth";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
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
  InvitationTransactionFrame,
  InvitationTransactionLoading,
  PasswordStrengthField,
  type PasswordCheck,
} from "@repo/ds/shell";
import type { PageStateDrawingKind } from "@repo/ds/shell";
import {
  ArrowRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import {
  useValidateInvite,
  useAcceptInvite,
  type AcceptInvitePayload,
} from "./use-invite";
import { resolveInviteAcceptanceDestination } from "./invite-acceptance-routing";

type InviteT = ReturnType<typeof useTranslations<"invite">>;

// ---------------------------------------------------------------------------
// Password requirements → checkable state
// ---------------------------------------------------------------------------

/**
 * The service's password policy as checkable rows the recipient can watch while
 * typing, in the shared field's shape. The service remains the authority; these
 * only mirror it so the outstanding rule is visible before submitting.
 */
function passwordChecks(
  password: string,
  requirements: AccountPasswordRequirementsDto | null | undefined,
  t: InviteT
): PasswordCheck[] {
  if (!requirements) return [];

  const checks: PasswordCheck[] = [
    {
      label: t("password.minimumLength", { count: requirements.minimumLength }),
      satisfied: password.length >= requirements.minimumLength,
    },
  ];
  if (requirements.requiresUppercase) {
    checks.push({
      label: t("password.uppercase"),
      satisfied: /[A-Z]/.test(password),
    });
  }
  if (requirements.requiresLowercase) {
    checks.push({
      label: t("password.lowercase"),
      satisfied: /[a-z]/.test(password),
    });
  }
  if (requirements.requiresDigit) {
    checks.push({ label: t("password.number"), satisfied: /[0-9]/.test(password) });
  }
  if (requirements.requiresSymbol) {
    checks.push({ label: t("password.symbol"), satisfied: /[^a-zA-Z0-9]/.test(password) });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Terminal states — the stopping points that share one card composition
// ---------------------------------------------------------------------------

/** A stopping point: its lines are `invite.terminal.<state>`, the detail sometimes replaced by a sharper one. */
interface TerminalDescriptor {
  drawing: PageStateDrawingKind;
  state: "invalid" | "expired" | "revoked" | "used" | "verifyFailed";
  /** `invite.terminal.<detail>` in place of the state's own detail. */
  detail?: "askForNew" | "checkConnection" | "refreshOrRetry" | "refresh";
  /** Offers sign-in as the way on, not just the way out. */
  signIn?: boolean;
}

const INVALID_LINK: TerminalDescriptor = { drawing: "gone", state: "invalid" };

const EXPIRED: TerminalDescriptor = { drawing: "gone", state: "expired" };

const REVOKED: TerminalDescriptor = { drawing: "gone", state: "revoked" };

const ALREADY_USED: TerminalDescriptor = { drawing: "gone", state: "used", signIn: true };

const VERIFY_FAILED: TerminalDescriptor = { drawing: "crash", state: "verifyFailed" };

function hasErrorMessage(error: ApiError, fragment: string): boolean {
  return error.errors.some((message) =>
    message.toLowerCase().includes(fragment.toLowerCase())
  );
}

/** Maps a validation failure to the stopping point it represents. */
function validationTerminal(error: unknown): TerminalDescriptor | null {
  if (!error) return null;

  if (!(error instanceof ApiError)) {
    return { ...VERIFY_FAILED, detail: "checkConnection" };
  }

  if (error.status === 404) {
    return { ...INVALID_LINK, detail: "askForNew" };
  }
  if (error.status === 410 && hasErrorMessage(error, "used")) return ALREADY_USED;
  if (error.status === 410 && hasErrorMessage(error, "expired")) return EXPIRED;
  if (error.status === 410 && hasErrorMessage(error, "revoked")) return REVOKED;
  if (error.status >= 500) return VERIFY_FAILED;

  return { ...VERIFY_FAILED, detail: "refreshOrRetry" };
}

/**
 * Submit-time failures the recipient sees inline, keeping their form intact. The service words other refusals in
 * English: they read as sent in English and as a plain line in other languages.
 */
function submitErrorMessages(
  error: unknown,
  step: "accept" | "sign-in",
  t: InviteT,
  english: boolean
): string[] {
  if (!(error instanceof ApiError)) {
    return [t("errors.connection")];
  }

  if (step === "sign-in") {
    return [t(error.status === 401 || error.status === 403 ? "errors.signInRefused" : "errors.signInFailed")];
  }

  if (error.status === 410 && hasErrorMessage(error, "used")) {
    return [t("errors.used")];
  }
  if (error.status === 410 && hasErrorMessage(error, "expired")) {
    return [t("errors.expired")];
  }
  if (error.status === 410 && hasErrorMessage(error, "revoked")) {
    return [t("errors.revoked")];
  }
  if (
    error.status === 400 &&
    hasErrorMessage(error, "email is already registered")
  ) {
    return [t("errors.registered")];
  }
  // The account or the employee record was claimed since this invitation was
  // issued. Recoverable only through an administrator, never by creating a
  // duplicate here.
  if (error.status === 409) {
    return [t("errors.claimed")];
  }
  if (error.errors.length > 0 && error.status < 500) {
    return english ? error.errors : [t("errors.notAccepted")];
  }

  return [t("errors.failed")];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FormValues {
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

export function InviteAcceptanceForm({ token }: { token: string | null }) {
  const {
    data: invite,
    isLoading: isValidating,
    error: validateError,
  } = useValidateInvite(token);

  const isInviteLoading = !!token && (isValidating || (!invite && !validateError));

  const screen = (() => {
    if (!token) return <TerminalScreen descriptor={INVALID_LINK} />;
    if (isInviteLoading) return <InvitationTransactionLoading />;
    const validationTerminalState = validationTerminal(validateError);
    if (validationTerminalState) return <TerminalScreen descriptor={validationTerminalState} />;
    if (!invite) return <TerminalScreen descriptor={{ ...VERIFY_FAILED, detail: "refresh" }} />;
    if (invite.isExpired) return <TerminalScreen descriptor={EXPIRED} />;
    if (invite.isUsed) return <TerminalScreen descriptor={ALREADY_USED} />;
    return <AcceptanceForm token={token} invite={invite} />;
  })();

  return screen;
}

function TerminalScreen({ descriptor }: { descriptor: TerminalDescriptor }) {
  const t = useTranslations("invite.terminal");
  return (
    <InvitationEnd
      drawing={descriptor.drawing}
      title={t(`${descriptor.state}.title`)}
      detail={descriptor.detail ? t(descriptor.detail) : t(`${descriptor.state}.detail`)}
      action={descriptor.signIn ? { label: t("signIn"), href: "/auth/signin" } : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// The acceptance form — a valid, unclaimed invitation
// ---------------------------------------------------------------------------

type Progress = "idle" | "creating" | "signing-in" | "opening";

function AcceptanceForm({
  token,
  invite,
}: {
  token: string;
  // Narrowed to the validated invite shape the form needs.
  invite: NonNullable<ReturnType<typeof useValidateInvite>["data"]>;
}) {
  const t = useTranslations("invite");
  const english = useLocale() === "en";
  const router = useRouter();
  const accept = useAcceptInvite();

  // A workforce recipient's name is owned by their employee record, so they set
  // a password only. Administrator invitations create a new account and collect
  // the name here.
  const isWorkforce = invite.role === "Employee" || invite.role === "Manager";
  const accessLabel = t(invite.role === "Manager" ? "workforce.roles.Manager" : "workforce.roles.Employee");
  const tenantName = invite.tenantName || t("yourOrganization");

  const [form, setForm] = useState<FormValues>(() => ({
    firstName: invite.firstName ?? "",
    lastName: invite.lastName ?? "",
    password: "",
    confirmPassword: "",
  }));
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [progress, setProgress] = useState<Progress>("idle");
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const update = useCallback(
    (field: keyof FormValues, value: string) =>
      setForm((current) => ({ ...current, [field]: value })),
    []
  );

  const checks = useMemo(
    () => passwordChecks(form.password, invite.passwordRequirements, t),
    [form.password, invite.passwordRequirements, t]
  );
  const passwordsMatch =
    Boolean(form.password) && form.confirmPassword === form.password;

  const nameReady =
    isWorkforce ||
    (form.firstName.trim().length > 0 && form.lastName.trim().length > 0);
  const canSubmit =
    nameReady &&
    form.password.length > 0 &&
    checks.length > 0 &&
    checks.every((check) => check.satisfied) &&
    passwordsMatch;

  const pending = progress !== "idle";

  // B-191: the providers the invited address can accept with; where the company requires its own, only that.
  const refusalText = useSsoRefusalText();
  const [refusal, setRefusal] = useState<SsoRefusalDto | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setRefusal(takeSsoRefusal()), []);
  const providers = invite.waysIn?.providers ?? [];
  const passwordOffered = invite.waysIn?.password !== false;
  const refusalMessage = refusal ? refusalText(refusal, { invitedEmail: invite.email }) : null;

  async function continueWith(provider: SsoProviderKey) {
    setRefusal(null);
    setLeaving(true);
    const refused = await startSsoFlow(
      { purpose: "invitation", provider, invitation: { kind: "workforce", credential: token } },
      { origin: `${window.location.pathname}?token=${encodeURIComponent(token)}` },
    );
    if (refused) {
      setLeaving(false);
      setRefusal({ code: refused as SsoRefusalDto["code"], provider, company: null, email: null });
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !canSubmit) return;

    setServerErrors([]);
    setProgress("creating");
    let step: "accept" | "sign-in" = "accept";

    try {
      // 1. Accept the invitation (creates the user account). Workforce recipients
      //    keep the canonical names the invitation carried.
      await accept.mutateAsync({
        token,
        request: {
          password: form.password,
          firstName: isWorkforce
            ? invite.firstName ?? null
            : form.firstName.trim() || invite.firstName || null,
          lastName: isWorkforce
            ? invite.lastName ?? null
            : form.lastName.trim() || invite.lastName || null,
        },
      } satisfies AcceptInvitePayload);

      // 2. Sign in with the credentials just created.
      setProgress("signing-in");
      step = "sign-in";
      const authResponse = await apiLogin({
        email: invite.email,
        password: form.password,
      });

      // 3. Persist the session (localStorage + cookie).
      const user: AuthUser = {
        userId: authResponse.userId,
        tenantId: authResponse.tenantId ?? null,
        tenantMembershipId: authResponse.tenantMembershipId ?? null,
        moduleEntitlements: authResponse.moduleEntitlements ?? [],
        employeeId: authResponse.employeeId ?? null,
        email: authResponse.email,
        fullName: authResponse.fullName,
        roles: authResponse.roles,
        accessProfiles: authResponse.accessProfiles ?? [],
        effectivePermissions: authResponse.effectivePermissions ?? [],
      };
      persistAuth({
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
        accessTokenExpiration: authResponse.accessTokenExpiration,
        user,
      } satisfies StoredAuth);

      // Let the shared auth provider consume its same-tab storage event before
      // resolving a protected route, so the first authenticated render does not
      // race the session that was just issued.
      setProgress("opening");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      router.replace(resolveInviteAcceptanceDestination(user));
    } catch (err) {
      setProgress("idle");
      setServerErrors(submitErrorMessages(err, step, t, english));
    }
  }

  return (
    <InvitationTransactionFrame
      context={
        isWorkforce ? (
          <InvitationContextPanel
            eyebrow={t("workforce.eyebrow")}
            heading={tenantName}
            lead={t("workforce.lead")}
            rows={[
              { icon: Building2, label: t("organization"), value: tenantName },
              { icon: Users, label: t("workforce.access"), value: accessLabel },
              { icon: Mail, label: t("workforce.accountEmail"), value: invite.email },
            ]}
            securityNote={t("workforce.security")}
            footerLabel={t("footer")}
          />
        ) : (
          <InvitationContextPanel
            eyebrow={t("administrator.eyebrow")}
            heading={t("administrator.heading", { tenant: tenantName })}
            lead={t("administrator.lead", { tenant: tenantName })}
            rows={[
              { icon: Building2, label: t("organization"), value: tenantName },
              { icon: Users, label: t("administrator.role"), value: t("administrator.roleValue") },
              { icon: Mail, label: t("administrator.sentTo"), value: invite.email },
            ]}
            securityNote={t("administrator.security")}
            footerLabel={t("footer")}
          />
        )
      }
    >
      <form onSubmit={submit} noValidate>
        <header>
          <h2 className="font-heading text-[1.875rem] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
            {isWorkforce ? t("workforce.heading") : t("administrator.formHeading")}
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">
            {isWorkforce
              ? t(passwordOffered ? "workforce.formLead" : "workforce.formLeadProvider", { tenant: tenantName })
              : t("administrator.formLead", { tenant: tenantName })}
          </p>
        </header>

        {serverErrors.length > 0 ? (
          <Alert
            variant="destructive"
            className="mt-6 border-destructive/30 bg-destructive/10"
          >
            <TriangleAlert aria-hidden="true" />
            <AlertDescription className="text-destructive">
              {[...new Set(serverErrors)].map((message) => (
                <p key={message}>{message}</p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        {refusalMessage ? (
          <Alert variant="destructive" className="mt-6 border-destructive/30 bg-destructive/10">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription className="text-destructive">
              <p className="font-medium">{refusalMessage.title}</p>
              {refusalMessage.more ? <p className="text-foreground">{refusalMessage.more}</p> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {providers.length > 0 ? (
          <div className="mt-6 grid gap-2.5">
            {providers.map((way) => (
              <ProviderButton
                key={way.key}
                way={way}
                primary={way.key === "company"}
                disabled={leaving || pending}
                onClick={() => void continueWith(way.key)}
              />
            ))}
            {passwordOffered ? (
              <FieldSeparator className="mt-2 [&_[data-slot=field-separator-content]]:bg-background">
                {t("orCreatePassword")}
              </FieldSeparator>
            ) : null}
          </div>
        ) : null}

        {passwordOffered ? (
        <FieldGroup className="mt-6 gap-4">
          {!isWorkforce ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="firstName"
                label={t("firstName")}
                autoComplete="given-name"
                value={form.firstName}
                disabled={pending}
                onChange={(value) => update("firstName", value)}
              />
              <TextField
                id="lastName"
                label={t("lastName")}
                autoComplete="family-name"
                value={form.lastName}
                disabled={pending}
                onChange={(value) => update("lastName", value)}
              />
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="workEmail">
              {isWorkforce ? t("workforce.email") : t("administrator.email")}
            </FieldLabel>
            {/* The invited address as a fact, not a field to change: the recipient
                confirms the invitation is theirs and sees the address they will
                sign in with. */}
            <InputGroup className="h-11 bg-inlay dark:bg-inlay">
              <InputGroupInput
                id="workEmail"
                type="email"
                value={invite.email}
                readOnly
                tabIndex={-1}
                aria-readonly="true"
                autoComplete="email"
                className="text-muted-foreground"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="text-[0.6875rem] font-medium uppercase tracking-[0.1em]">
                  {t("readOnly")}
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </Field>

          <PasswordStrengthField
            id="password"
            label={t("createPassword")}
            value={form.password}
            checks={checks}
            onChange={(value) => update("password", value)}
          />

          <Field>
            <FieldLabel htmlFor="confirmPassword">{t("confirmPassword")}</FieldLabel>
            <InputGroup className="h-11">
              <InputGroupAddon>
                <Lock />
              </InputGroupAddon>
              <InputGroupInput
                id="confirmPassword"
                type={revealConfirm ? "text" : "password"}
                autoComplete="new-password"
                value={form.confirmPassword}
                disabled={pending}
                onChange={(event) =>
                  update("confirmPassword", event.target.value)
                }
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  onClick={() => setRevealConfirm((shown) => !shown)}
                  aria-label={
                    revealConfirm ? t("hideCharacters") : t("showCharacters")
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
                  <X
                    aria-hidden="true"
                    className="size-3.5 text-muted-foreground/60"
                  />
                )}
                {passwordsMatch ? t("passwordsMatch") : t("passwordsDoNotMatch")}
              </p>
            ) : null}
          </Field>

          <Button
            type="submit"
            size="lg"
            disabled={pending || !canSubmit}
            aria-busy={pending}
            className="relative h-12 w-full text-[0.9375rem] font-semibold"
          >
            {pending ? (
              <span className="inline-flex items-center gap-2">
                <Spinner aria-hidden="true" />
                {progress === "signing-in"
                  ? t("signingIn")
                  : progress === "opening"
                    ? t("opening")
                    : isWorkforce
                      ? t("workforce.submitting")
                      : t("administrator.submitting")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                {isWorkforce ? t("workforce.submit") : t("administrator.submit")}
                <ArrowRight />
              </span>
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {t.rich("haveAccount", {
              signIn: (chunks) => (
                <a href="/auth/signin" className="font-medium text-primary-ink hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </FieldGroup>
        ) : null}
      </form>
    </InvitationTransactionFrame>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        autoComplete={autoComplete}
        disabled={disabled}
        className="h-11"
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
