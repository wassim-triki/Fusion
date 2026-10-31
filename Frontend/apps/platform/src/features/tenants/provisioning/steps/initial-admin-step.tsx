"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import { CheckCircle2, Mail, ShieldCheck } from "@/lib/icons";
import { Input } from "@repo/ds/components/ui/input";
import { Switch } from "@repo/ds/components/ui/switch";
import { Field, describedBy } from "../field";
import { adminRoleByValue, adminRoleOptions } from "../admin-role-options";
import { SearchableSelect } from "../searchable-select";
import { StepPanel } from "./step-panel";
import type { ProvisioningStepProps } from "./types";

/**
 * Who establishes access to the tenant. The left column captures the person and
 * the role they receive; the right restates, in plain terms, what provisioning
 * will actually do for them — so the commitment is legible before it is made.
 */
export function InitialAdminStep({
  draft,
  errors,
  update,
  validateField,
}: ProvisioningStepProps) {
  const t = useTranslations("provisioning.admin");
  const say = useSay("provisioning");
  const role = adminRoleByValue(draft.adminRole, say);

  const roleOptions = useMemo(
    () =>
      adminRoleOptions(say).map((option) => ({
        value: option.value,
        label: option.label,
        keywords: `${option.label} ${option.summary}`,
      })),
    [say]
  );

  return (
    <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <StepPanel
        title={t("title")}
        description={t("description")}
        className="h-full"
      >
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="admin-first-name"
              label={t("firstName")}
              required
              error={errors.firstName}
            >
              <Input
                id="admin-first-name"
                value={draft.firstName}
                placeholder={t("firstNamePlaceholder")}
                autoComplete="given-name"
                onChange={(event) => update("firstName", event.target.value)}
                onBlur={() => validateField("firstName")}
                aria-invalid={Boolean(errors.firstName)}
                aria-describedby={describedBy(
                  "admin-first-name",
                  Boolean(errors.firstName)
                )}
              />
            </Field>

            <Field
              id="admin-last-name"
              label={t("lastName")}
              required
              error={errors.lastName}
            >
              <Input
                id="admin-last-name"
                value={draft.lastName}
                placeholder={t("lastNamePlaceholder")}
                autoComplete="family-name"
                onChange={(event) => update("lastName", event.target.value)}
                onBlur={() => validateField("lastName")}
                aria-invalid={Boolean(errors.lastName)}
                aria-describedby={describedBy(
                  "admin-last-name",
                  Boolean(errors.lastName)
                )}
              />
            </Field>
          </div>

          <Field
            id="administrator-email"
            label={t("email")}
            required
            hint={t("emailHint")}
            error={errors.administratorEmail}
          >
            <Input
              id="administrator-email"
              type="email"
              value={draft.administratorEmail}
              placeholder={t("emailPlaceholder")}
              autoComplete="email"
              // Validated on blur, never while typing: an address is invalid for
              // most of the time it is being entered.
              onBlur={() => validateField("administratorEmail")}
              onChange={(event) =>
                update("administratorEmail", event.target.value)
              }
              aria-invalid={Boolean(errors.administratorEmail)}
              aria-describedby={describedBy(
                "administrator-email",
                Boolean(errors.administratorEmail)
              )}
            />
          </Field>

          <Field id="admin-role" label={t("role")} hint={role.hint}>
            <SearchableSelect
              id="admin-role"
              options={roleOptions}
              value={draft.adminRole}
              placeholder={t("rolePlaceholder")}
              searchPlaceholder={t("roleSearch")}
              emptyMessage={t("roleEmpty")}
              onChange={(value) => update("adminRole", value)}
            />
          </Field>

          <label className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            <span className="type-label text-foreground">{t("sendNow")}</span>
            <Switch
              checked={draft.sendInvitation}
              onCheckedChange={(next) => update("sendInvitation", next)}
              aria-label={t("sendNow")}
            />
            <span className="text-xs text-muted-foreground">
              {draft.sendInvitation ? t("sendOn") : t("sendOff")}
            </span>
          </label>
        </div>
      </StepPanel>

      <div className="flex h-full flex-col gap-6 rounded-surface bg-card p-6">
        <div>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink">
              <Mail aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="type-subsection-title text-foreground">
                {t("receive.title")}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("receive.subtitle")}
              </p>
            </div>
          </div>

          <ul className="mt-4 space-y-3">
            {[
              draft.sendInvitation ? t("receive.send") : t("receive.prepare"),
              t("receive.access"),
              t("receive.role"),
              t("receive.continue"),
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-0.5 size-6 shrink-0 text-success"
                />
                <span className="text-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto">
          <p className="type-eyebrow mb-2 text-muted-foreground">
            {t("roleSummary")}
          </p>
          <div className="flex items-start gap-3 rounded-surface border border-border bg-inlay p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h4 className="type-subsection-title text-foreground">
                {role.label}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {role.summary}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
