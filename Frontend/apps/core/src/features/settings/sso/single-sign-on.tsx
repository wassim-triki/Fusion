"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Check, Copy, Lock } from "lucide-react";
import { ApiError, type SsoConfirmation, type SsoProviderKey, type SsoSettingsDto } from "@repo/api";
import { ProviderMark, startSsoFlow, PageFailure } from "@repo/auth";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  FieldSeparator,
  Input,
  PersonAvatar,
  Switch,
} from "@repo/ds";
import { formatDate, formatDateTime } from "@repo/ds/lib/dates";
import { SettingsBlock, SettingsRows, StatusBadge } from "@repo/ds/shell";
import { OptionCards } from "@repo/ds/choice";
import { useSaveFailure, useSettingsSay, type Say } from "@/features/settings/say";
import { confirmThroughProvider, takeConfirmation, type PendingConfirmation } from "./confirmation";
import { useSsoCommands, useSsoSettings } from "./use-sso";

type Kind = "MicrosoftEntra" | "OpenIdConnect";

interface ConnectionForm {
  kind: Kind;
  displayName: string;
  entraTenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
}

/** A change that asks the person to confirm it's them, and what it says. */
type Confirming =
  | { action: "requirementOff" }
  | { action: "removeConnection" }
  | { action: "removeDomain"; domain: string }
  | { action: "saveConnection"; form: ConnectionForm };

const EMPTY_FORM: ConnectionForm = { kind: "MicrosoftEntra", displayName: "", entraTenantId: "", issuer: "", clientId: "", clientSecret: "" };

function problemCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as { code?: unknown } | null;
  return typeof details?.code === "string" ? details.code : error.code;
}

/** A row of the block: what it is, its state, and its actions (the explorer's three columns). */
function Row({ label, children, actions, top }: { label: ReactNode; children?: ReactNode; actions?: ReactNode; top?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[200px_minmax(0,1fr)_auto] gap-6 px-5 py-3.5", top ? "items-start" : "items-center")}>
      <div className="type-label font-semibold text-foreground">{label}</div>
      <div className="grid min-w-0 gap-1">{children}</div>
      <div className="flex items-center justify-end gap-2">{actions}</div>
    </div>
  );
}

function shortId(value: string | null): string {
  return value && value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : (value ?? "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Settings › Sign-in › Single sign-on (B-191): Microsoft and Google for everyone, switchable; the company's own
 * provider, tested by signing in through it; the domains it proves; who keeps a password; and requiring it.
 * Anyone who can see Sign-in settings reads it; only administrators change it.
 */
export function SingleSignOnBlock() {
  const say = useSettingsSay();
  const locale = useLocale();
  const failure = useSaveFailure();
  const query = useSsoSettings();
  const commands = useSsoCommands();
  const settings = query.data;

  const [editing, setEditing] = useState<"new" | "edit" | "secret" | null>(null);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const [confirmedBySso, setConfirmedBySso] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [settingPassword, setSettingPassword] = useState<{ sso: boolean } | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resumed = useRef(false);

  const run = async (work: () => Promise<unknown>, fallback = say("sso.errors.generic")) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (caught) {
      const code = problemCode(caught);
      setError(
        code && ["password-incorrect", "password-locked", "confirmation-required"].includes(code)
          ? say(`sso.errors.${code}`)
          : failure(caught, fallback),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Back from the provider: a test (the block reloads), or a confirmation to finish the change it was for.
  useEffect(() => {
    if (resumed.current || !settings) return;
    resumed.current = true;
    const url = new URL(window.location.href);
    if (url.searchParams.has("sso")) {
      url.searchParams.delete("sso");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }

    const back = takeConfirmation();
    if (!back) return;
    if (!back.confirmed || !back.pending) {
      setError(say("sso.errors.confirmFailed"));
      return;
    }
    const pending = back.pending;
    const proof: SsoConfirmation = { sso: true };
    if (pending.action === "requirementOff") void run(() => commands.setRequirement(false, proof));
    else if (pending.action === "removeConnection") void run(() => commands.removeConnection(proof));
    else if (pending.action === "removeDomain") void run(() => commands.removeDomain(pending.domain, proof));
    else if (pending.action === "setPassword") setSettingPassword({ sso: true });
    else if (pending.action === "saveConnection") {
      setForm({ ...EMPTY_FORM, ...(pending.form as Partial<ConnectionForm>), clientSecret: "" });
      setEditing(settings.connection ? "edit" : "new");
      setConfirmedBySso(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the settings first arrive
  }, [settings]);

  if (query.error && !settings) {
    return <PageFailure error={query.error} onRetry={() => void query.refetch()} size="card" title={say("sso.didNotLoad")} />;
  }
  if (!settings) return null;

  const manage = settings.canManage;
  const connection = settings.connection;
  const required = Boolean(connection?.requiredAt);
  const proved = settings.domains.filter((domain) => domain.provedAt);
  const domainList = (proved.length > 0 ? proved : settings.domains).map((domain) => domain.domain).join(", ");
  const withPassword = settings.administrators.filter((admin) => admin.hasPassword);
  const withoutPassword = settings.administrators.filter((admin) => !admin.hasPassword);
  const checks = settings.checks;
  const ready = checks.tested && checks.domainProved && checks.freshOwnLink && checks.administratorWithPassword;
  const when = (iso: string) => formatDateTime(iso, { locale });
  const day = (iso: string) => formatDate(iso, { locale });

  const openForm = (mode: "new" | "edit" | "secret") => {
    setError(null);
    setConfirmedBySso(false);
    setForm(
      connection
        ? {
            kind: connection.kind,
            displayName: connection.displayName,
            entraTenantId: connection.entraTenantId ?? "",
            issuer: connection.kind === "OpenIdConnect" ? connection.issuer : "",
            clientId: connection.clientId,
            clientSecret: "",
          }
        : EMPTY_FORM,
    );
    setEditing(mode);
  };

  const save = async (draft: ConnectionForm, proof: SsoConfirmation) => {
    const saved = await run(() =>
      commands.saveConnection({
        kind: draft.kind,
        displayName: draft.displayName.trim(),
        entraTenantId: draft.kind === "MicrosoftEntra" ? draft.entraTenantId.trim() : undefined,
        issuer: draft.kind === "OpenIdConnect" ? draft.issuer.trim() : undefined,
        clientId: draft.clientId.trim(),
        clientSecret: draft.clientSecret.trim() || undefined,
        ...proof,
      }),
    );
    if (!saved) return;
    setEditing(null);
    setConfirming(null);
    setConfirmedBySso(false);
    // "Save and test": sign in through it as yourself straight away.
    if (!required) await test();
  };

  const test = async () => {
    setError(null);
    const refused = await startSsoFlow({ purpose: "test", provider: "company" }, { withSession: true });
    if (refused) setError(say("sso.errors.generic"));
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (confirmedBySso) void save(form, { sso: true });
    else setConfirming({ action: "saveConnection", form });
  };

  const confirmed = async (proof: SsoConfirmation) => {
    if (!confirming) return;
    if (confirming.action === "saveConnection") return save(confirming.form, proof);
    const done = await run(() =>
      confirming.action === "requirementOff"
        ? commands.setRequirement(false, proof)
        : confirming.action === "removeConnection"
          ? commands.removeConnection(proof)
          : commands.removeDomain(confirming.domain, proof),
    );
    if (done) setConfirming(null);
  };

  const pendingFor = (item: Confirming): PendingConfirmation => {
    if (item.action !== "saveConnection") return item;
    // Never the secret: it is typed again after the provider confirms.
    const { clientSecret: _secret, ...rest } = item.form;
    return { action: "saveConnection", form: rest };
  };

  const connectionSummary = connection
    ? connection.kind === "MicrosoftEntra"
      ? say("sso.summary.entra", { directory: shortId(connection.entraTenantId) })
      : say("sso.summary.oidc", { host: hostOf(connection.issuer) })
    : null;

  return (
    <SettingsBlock
      title={say("sso.title")}
      action={
        required && connection?.requiredAt ? (
          <StatusBadge tone="success">
            <Check aria-hidden className="size-3" />
            {say("sso.requiredSince", { date: day(connection.requiredAt) })}
          </StatusBadge>
        ) : null
      }
    >
      {error ? (
        <p role="alert" className="mb-3 type-meta text-destructive">
          {error}
        </p>
      ) : null}
      <SettingsRows>
        {settings.microsoftAvailable ? (
          <Row
            label={
              <span className="flex items-center gap-2.5">
                <ProviderMark provider="microsoft" label="Microsoft" />
                {say("sso.microsoft")}
              </span>
            }
            actions={
              <Switch
                aria-label={say("sso.microsoft")}
                checked={settings.allowMicrosoft}
                disabled={!manage || busy}
                onCheckedChange={(checked) => void run(() => commands.setProviders(checked, settings.allowGoogle))}
              />
            }
          />
        ) : null}
        {settings.googleAvailable ? (
          <Row
            label={
              <span className="flex items-center gap-2.5">
                <ProviderMark provider="google" label="Google" />
                {say("sso.google")}
              </span>
            }
            actions={
              <Switch
                aria-label={say("sso.google")}
                checked={settings.allowGoogle}
                disabled={!manage || busy}
                onCheckedChange={(checked) => void run(() => commands.setProviders(settings.allowMicrosoft, checked))}
              />
            }
          />
        ) : null}

        {editing && manage ? (
          <Row label={say("sso.provider")} top>
            <ConnectionFormView
              say={say}
              form={form}
              mode={editing}
              redirectUri={settings.redirectUri}
              secretSetAt={connection?.secretSetAt ?? null}
              locked={required}
              confirmedBySso={confirmedBySso}
              busy={busy}
              onChange={(change) => setForm((current) => ({ ...current, ...change }))}
              onSubmit={submitForm}
              onCancel={() => {
                setEditing(null);
                setConfirmedBySso(false);
              }}
            />
          </Row>
        ) : connection ? (
          <Row
            label={
              <span className="flex items-center gap-2.5">
                <ProviderMark provider="company" label={connection.displayName} />
                {connection.displayName}
              </span>
            }
            actions={
              manage ? (
                required ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openForm("secret")}>
                      {say("sso.replaceSecret")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void test()}>
                      {say("sso.testAgain")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant={connection.lastTestOutcome === "failed" ? "default" : "outline"}
                      onClick={() => void test()}
                    >
                      {connection.lastTestAt ? say("sso.testAgain") : say("sso.test")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openForm("edit")}>
                      {say("sso.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming({ action: "removeConnection" })}>
                      {say("sso.remove")}
                    </Button>
                  </>
                )
              ) : null
            }
          >
            <span className="type-body text-foreground">{connectionSummary}</span>
            {required ? (
              <span className="type-meta text-muted-foreground">
                {say("sso.secretSet", { date: day(connection.secretSetAt) })}
                {connection.lastSignInAt ? ` · ${say("sso.lastSignIn", { when: when(connection.lastSignInAt) })}` : ""}
              </span>
            ) : connection.lastTestOutcome === "succeeded" && connection.lastTestAt ? (
              <span className="type-meta text-success">
                {say("sso.tested", { when: when(connection.lastTestAt), email: connection.lastTestEmail ?? "" })}
              </span>
            ) : connection.lastTestOutcome === "failed" && connection.lastTestAt ? (
              <span className="type-meta text-destructive">
                {say("sso.testFailed", { when: when(connection.lastTestAt), message: connection.lastTestMessage ?? "" })}
              </span>
            ) : (
              <span className="type-meta text-muted-foreground">{say("sso.notTested")}</span>
            )}
          </Row>
        ) : (
          <Row
            label={say("sso.provider")}
            actions={
              manage ? (
                <Button variant="outline" onClick={() => openForm("new")}>
                  {say("sso.connect")}
                </Button>
              ) : null
            }
          >
            <span className="type-body text-muted-foreground">{say("sso.notConnected")}</span>
          </Row>
        )}

        {connection ? (
          <Row label={say("sso.domains")} top>
            <div className="grid">
              {settings.domains.map((domain) => (
                <div key={domain.domain} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-border py-2 last:border-b-0">
                  <span className="font-mono text-[0.8125rem]">{domain.domain}</span>
                  {domain.provedAt ? (
                    <StatusBadge tone="success">
                      <Check aria-hidden className="size-3" />
                      {say("sso.proved", { date: day(domain.provedAt) })}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{say("sso.unproved")}</StatusBadge>
                  )}
                  {manage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        domain.provedAt
                          ? setConfirming({ action: "removeDomain", domain: domain.domain })
                          : void run(() => commands.removeDomain(domain.domain, {}))
                      }
                    >
                      {say("sso.remove")}
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {manage ? (
                <form
                  className="flex items-center gap-2 pt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => commands.addDomain(newDomain.trim())).then((ok) => ok && setNewDomain(""));
                  }}
                >
                  <Input
                    aria-label={say("sso.addDomain")}
                    placeholder={say("sso.addDomain")}
                    value={newDomain}
                    onChange={(event) => setNewDomain(event.target.value)}
                    className="h-9"
                  />
                  <Button writes type="submit" size="sm" variant="outline" disabled={busy || newDomain.trim().length === 0}>
                    {say("sso.add")}
                  </Button>
                </form>
              ) : null}
            </div>
          </Row>
        ) : null}

        {connection ? (
          <Row
            label={say("sso.passwordAdmins")}
            actions={
              settings.you.isAdministrator && !settings.you.hasPassword && manage ? (
                <Button size="sm" variant="outline" onClick={() => setSettingPassword({ sso: false })}>
                  {say("sso.setPassword")}
                </Button>
              ) : null
            }
          >
            {withPassword.length > 0 ? (
              <span className="flex items-center gap-2.5">
                <span className="flex">
                  {withPassword.slice(0, 4).map((admin, index) => (
                    <PersonAvatar
                      key={admin.userId}
                      name={admin.name}
                      className={cn("size-7 text-[0.625rem] ring-2 ring-card", index > 0 && "-ms-2")}
                    />
                  ))}
                </span>
                <span className="type-body">{withPassword.map((admin) => admin.name).join(", ")}</span>
              </span>
            ) : (
              <span className="type-body text-muted-foreground">{say("sso.nobodyHasPassword")}</span>
            )}
            {withoutPassword.length > 0 ? (
              <span className="type-meta text-muted-foreground">
                {say("sso.noPassword", { names: withoutPassword.map((admin) => admin.name).join(", ") })}
              </span>
            ) : null}
          </Row>
        ) : null}

        {connection ? (
          <Row
            label={say("sso.require", { name: connection.displayName })}
            top={!required && checks.tested}
            actions={
              <Switch
                aria-label={say("sso.require", { name: connection.displayName })}
                checked={required}
                disabled={!manage || busy || (!required && !ready)}
                onCheckedChange={(checked) =>
                  checked ? void run(() => commands.setRequirement(true)) : setConfirming({ action: "requirementOff" })
                }
              />
            }
          >
            {required && connection.requiredAt ? (
              <>
                <span className="type-body">
                  {say("sso.requiredOn", {
                    domains: domainList,
                    name: connection.requiredByName ?? "",
                    date: day(connection.requiredAt),
                    count: connection.requiredEndedSessions ?? 0,
                  })}
                </span>
                <span className="type-meta text-muted-foreground">{say("sso.requiredLocked")}</span>
              </>
            ) : !checks.tested ? (
              <span className="type-body text-muted-foreground">{say("sso.availableAfterTest")}</span>
            ) : (
              <>
                <span className="type-body">
                  {say("sso.requireExplain", { domains: domainList || "–", name: connection.displayName })}
                </span>
                <span className="mt-1 grid gap-1.5">
                  <Check_ ok={checks.tested} label={say("sso.check.tested")} />
                  <Check_ ok={checks.domainProved} label={say("sso.check.domain")} />
                  <Check_ ok={checks.freshOwnLink} label={say("sso.check.fresh")} />
                  <Check_ ok={checks.administratorWithPassword} label={say("sso.check.admin")} />
                </span>
              </>
            )}
          </Row>
        ) : null}
      </SettingsRows>

      {confirming ? (
        <ConfirmDialog
          say={say}
          settings={settings}
          confirming={confirming}
          domains={domainList}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirming(null);
            setError(null);
          }}
          onConfirm={(proof) => void confirmed(proof)}
          onProvider={(provider) => void confirmThroughProvider(provider, pendingFor(confirming))}
        />
      ) : null}

      {settingPassword ? (
        <SetPasswordDialog
          say={say}
          settings={settings}
          confirmedBySso={settingPassword.sso}
          onClose={() => setSettingPassword(null)}
          onSaved={() => {
            setSettingPassword(null);
            void commands.refresh();
          }}
          setPassword={(password) => commands.setPassword(password, { sso: true })}
        />
      ) : null}
    </SettingsBlock>
  );
}

function Check_({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("flex items-center gap-2 type-meta", ok ? "text-success" : "text-muted-foreground")}>
      {ok ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden className="size-3.5 rounded-full border border-current" />}
      {label}
    </span>
  );
}

function ConnectionFormView({
  say,
  form,
  mode,
  redirectUri,
  secretSetAt,
  locked,
  confirmedBySso,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  say: Say;
  form: ConnectionForm;
  mode: "new" | "edit" | "secret";
  redirectUri: string;
  secretSetAt: string | null;
  locked: boolean;
  confirmedBySso: boolean;
  busy: boolean;
  onChange: (change: Partial<ConnectionForm>) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const entra = form.kind === "MicrosoftEntra";
  const fixed = locked || mode === "secret";
  const needsSecret = mode === "new" || mode === "secret";
  const ready =
    form.displayName.trim() &&
    form.clientId.trim() &&
    (entra ? form.entraTenantId.trim() : form.issuer.trim()) &&
    (!needsSecret || form.clientSecret.trim());

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-inset bg-inlay p-5">
      {!fixed ? (
        <OptionCards
          columns={2}
          label={say("sso.provider")}
          value={form.kind}
          onChange={(value) => onChange({ kind: value as Kind })}
          options={(["MicrosoftEntra", "OpenIdConnect"] as const).map((kind) => ({ value: kind, label: say(`sso.kind.${kind}`) }))}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="sso-name">{say("sso.form.name")}</FieldLabel>
          <Input id="sso-name" value={form.displayName} disabled={fixed} onChange={(event) => onChange({ displayName: event.target.value })} />
        </Field>
        {entra ? (
          <Field>
            <FieldLabel htmlFor="sso-directory">{say("sso.form.directory")}</FieldLabel>
            <Input
              id="sso-directory"
              className="font-mono text-[0.8125rem]"
              value={form.entraTenantId}
              disabled={fixed}
              onChange={(event) => onChange({ entraTenantId: event.target.value })}
            />
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="sso-issuer">{say("sso.form.issuer")}</FieldLabel>
            <Input
              id="sso-issuer"
              className="font-mono text-[0.8125rem]"
              placeholder="https://"
              value={form.issuer}
              disabled={fixed}
              onChange={(event) => onChange({ issuer: event.target.value })}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="sso-client">{say("sso.form.clientId")}</FieldLabel>
          <Input
            id="sso-client"
            className="font-mono text-[0.8125rem]"
            value={form.clientId}
            disabled={fixed}
            onChange={(event) => onChange({ clientId: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="sso-secret">{say("sso.form.secret")}</FieldLabel>
          <Input
            id="sso-secret"
            type="password"
            autoComplete="off"
            placeholder="••••••••••••••••"
            value={form.clientSecret}
            onChange={(event) => onChange({ clientSecret: event.target.value })}
          />
          {secretSetAt && !needsSecret ? (
            <span className="type-meta text-muted-foreground">
              {say("sso.form.secretKept", { date: formatDate(secretSetAt, { locale }) })}
            </span>
          ) : null}
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="sso-redirect">{say("sso.form.redirect")}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input id="sso-redirect" readOnly value={redirectUri} className="h-9 font-mono text-[0.8125rem]" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(redirectUri);
              setCopied(true);
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? say("sso.form.copied") : say("sso.form.copy")}
          </Button>
        </div>
        <span className="type-meta text-muted-foreground">{say(entra ? "sso.form.redirectHintEntra" : "sso.form.redirectHint")}</span>
      </Field>
      {confirmedBySso ? <p className="type-meta text-success">{say("sso.form.confirmed")}</p> : null}
      <div className="flex gap-2">
        <Button writes type="submit" disabled={busy || !ready}>
          {locked ? say("sso.form.save") : say("sso.form.saveAndTest")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {say("sso.form.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** One confirmation for every sensitive change: the password, or signing in again through the provider. */
function ConfirmDialog({
  say,
  settings,
  confirming,
  domains,
  busy,
  error,
  onCancel,
  onConfirm,
  onProvider,
}: {
  say: Say;
  settings: SsoSettingsDto;
  confirming: Confirming;
  domains: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (proof: SsoConfirmation) => void;
  onProvider: (provider: SsoProviderKey) => void;
}) {
  const [password, setPassword] = useState("");
  const action = confirming.action;
  const name = settings.connection?.displayName ?? "";
  const values = { domains, name, domain: confirming.action === "removeDomain" ? confirming.domain : "" };
  const providers = settings.you.confirmWith;
  const label = (key: SsoProviderKey) => (key === "microsoft" ? "Microsoft" : key === "google" ? "Google" : name);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[480px]">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm({ password });
          }}
        >
          <DialogHeader>
            <DialogTitle>{say(`sso.confirm.${action}.title`, values)}</DialogTitle>
            <DialogDescription>{say(`sso.confirm.${action}.body`, values)}</DialogDescription>
          </DialogHeader>
          {settings.you.hasPassword ? (
            <Field>
              <FieldLabel htmlFor="sso-confirm-password">{say("sso.confirm.yourPassword")}</FieldLabel>
              <div className="relative">
                <Lock aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="sso-confirm-password"
                  type="password"
                  autoComplete="current-password"
                  className="h-11 ps-9"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </Field>
          ) : null}
          {settings.you.hasPassword && providers.length > 0 ? <FieldSeparator>{say("sso.confirm.or")}</FieldSeparator> : null}
          {providers.map((key) => (
            <Button key={key} type="button" variant="outline" className="h-11 w-full" disabled={busy} onClick={() => onProvider(key)}>
              <ProviderMark provider={key} label={label(key)} />
              {say("sso.confirm.with", { provider: label(key) })}
            </Button>
          ))}
          {error ? (
            <p role="alert" className="type-meta text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {say("sso.form.cancel")}
            </Button>
            {settings.you.hasPassword ? (
              <Button writes type="submit" variant={action === "saveConnection" ? "default" : "destructive"} disabled={busy || !password}>
                {say(`sso.confirm.${action}.action`, values)}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** An administrator who joined through a provider sets a password, confirming through it first. */
function SetPasswordDialog({
  say,
  settings,
  confirmedBySso,
  onClose,
  onSaved,
  setPassword,
}: {
  say: Say;
  settings: SsoSettingsDto;
  confirmedBySso: boolean;
  onClose: () => void;
  onSaved: () => void;
  setPassword: (password: string) => Promise<unknown>;
}) {
  const failure = useSaveFailure();
  const [password, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = settings.connection?.displayName ?? "";
  const label = (key: SsoProviderKey) => (key === "microsoft" ? "Microsoft" : key === "google" ? "Google" : name);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            setPassword(password)
              .then(onSaved)
              .catch((caught) => setError(failure(caught, say("sso.errors.generic"))))
              .finally(() => setBusy(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>{say("sso.password.title")}</DialogTitle>
            <DialogDescription>{say(confirmedBySso ? "sso.password.body" : "sso.password.confirmFirst")}</DialogDescription>
          </DialogHeader>
          {confirmedBySso ? (
            <Field>
              <FieldLabel htmlFor="sso-new-password">{say("sso.password.new")}</FieldLabel>
              <Input
                id="sso-new-password"
                type="password"
                autoComplete="new-password"
                className="h-11"
                value={password}
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          ) : (
            settings.you.confirmWith.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                className="h-11 w-full"
                onClick={() => void confirmThroughProvider(key, { action: "setPassword" })}
              >
                <ProviderMark provider={key} label={label(key)} />
                {say("sso.confirm.with", { provider: label(key) })}
              </Button>
            ))
          )}
          {error ? (
            <p role="alert" className="type-meta text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {say("sso.form.cancel")}
            </Button>
            {confirmedBySso ? (
              <Button writes type="submit" disabled={busy || password.length === 0}>
                {say("sso.password.set")}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
