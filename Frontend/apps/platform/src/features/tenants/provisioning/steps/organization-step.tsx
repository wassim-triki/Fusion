"use client";

import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import { Building2, Lightbulb } from "@/lib/icons";
import { Input } from "@repo/ds/components/ui/input";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { Field, describedBy } from "../field";
import { industryOptions } from "../industry-options";
import { SearchableSelect } from "../searchable-select";
import { StepPanel } from "./step-panel";
import type { ProvisioningStepProps } from "./types";

const DESCRIPTION_LIMIT = 500;

/** A URL-safe slug derived from a display name. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Who the tenant is. The left column captures its identity; the right explains
 * what a tenant is and how to name it well, so the operator is not guessing at
 * conventions the platform relies on.
 */
export function OrganizationStep({
  draft,
  errors,
  update,
  validateField,
}: ProvisioningStepProps) {
  // The slug follows the name until the operator writes their own, at which
  // point it is theirs to control and the suggestion stops overwriting it.
  const slugEdited = useRef(draft.tenantSlug.length > 0);
  const t = useTranslations("provisioning.organization");
  const say = useSay("provisioning");
  const industries = useMemo(() => industryOptions(say), [say]);

  function onNameChange(value: string) {
    update("name", value);
    if (!slugEdited.current) {
      update("tenantSlug", slugify(value));
    }
  }

  function onSlugChange(value: string) {
    slugEdited.current = true;
    update("tenantSlug", value);
  }

  const descriptionLength = draft.shortDescription.length;

  return (
    <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <StepPanel
        title={t("title")}
        description={t("description")}
        className="h-full"
      >
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="tenant-name"
              label={t("name")}
              required
              error={errors.name}
            >
              <Input
                id="tenant-name"
                value={draft.name}
                placeholder={t("namePlaceholder")}
                autoComplete="organization"
                onChange={(event) => onNameChange(event.target.value)}
                onBlur={() => validateField("name")}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={describedBy(
                  "tenant-name",
                  Boolean(errors.name)
                )}
              />
            </Field>

            <Field
              id="tenant-slug"
              label={t("slug")}
              required
              error={errors.tenantSlug}
            >
              <Input
                id="tenant-slug"
                value={draft.tenantSlug}
                placeholder={t("slugPlaceholder")}
                spellCheck={false}
                onChange={(event) => onSlugChange(event.target.value)}
                onBlur={() => validateField("tenantSlug")}
                aria-invalid={Boolean(errors.tenantSlug)}
                aria-describedby={describedBy(
                  "tenant-slug",
                  Boolean(errors.tenantSlug)
                )}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="legal-entity-name" label={t("legalEntity")}>
              <Input
                id="legal-entity-name"
                value={draft.legalEntityName}
                placeholder={t("legalEntityPlaceholder")}
                onChange={(event) =>
                  update("legalEntityName", event.target.value)
                }
              />
            </Field>

            <Field id="tenant-industry" label={t("industry")}>
              <SearchableSelect
                id="tenant-industry"
                options={industries}
                value={draft.industry}
                placeholder={t("industryPlaceholder")}
                searchPlaceholder={t("industrySearch")}
                emptyMessage={t("industryEmpty")}
                onChange={(value) => update("industry", value)}
              />
            </Field>
          </div>

          <Field id="short-description" label={t("shortDescription")}>
            <div className="relative">
              <Textarea
                id="short-description"
                value={draft.shortDescription}
                placeholder={t("shortDescriptionPlaceholder")}
                rows={3}
                maxLength={DESCRIPTION_LIMIT}
                className="resize-none pb-6"
                onChange={(event) =>
                  update("shortDescription", event.target.value)
                }
              />
              <span className="pointer-events-none absolute bottom-2 inset-e-3 text-xs tabular-nums text-muted-foreground">
                {descriptionLength}/{DESCRIPTION_LIMIT}
              </span>
            </div>
          </Field>
        </div>
      </StepPanel>

      <div className="flex h-full flex-col gap-5 rounded-surface bg-card p-6">
        <div>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="type-subsection-title text-foreground">
                {t("about.title")}
              </h3>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{t("about.body")}</p>
        </div>

        <div className="border-t border-border" />

        <div>
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb aria-hidden="true" className="size-6 text-primary-ink" />
            <h3 className="type-subsection-title text-foreground">
              {t("naming.title")}
            </h3>
          </div>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {[
              t("naming.clear"),
              t("naming.unique"),
              t("naming.characters"),
              t("naming.later"),
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1 shrink-0 rounded-full bg-primary"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
