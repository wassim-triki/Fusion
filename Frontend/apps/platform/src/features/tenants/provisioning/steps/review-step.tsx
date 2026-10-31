"use client";

import { useMemo, type ComponentType, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Globe,
  LayoutGrid,
  Pencil,
  User,
} from "@/lib/icons";
import { Button } from "@repo/ds/components/ui/button";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { useProvisionableModules } from "../../queries";
import {
  buildModuleOptions,
  type ProvisioningModuleOption,
} from "../module-catalogue";
import { adminRoleByValue } from "../admin-role-options";
import {
  PLATFORM_DEFAULT_LOCALE,
  labelForLocale,
  labelForTimeZone,
  timeZoneOffset,
} from "../provisioning-options";
import { countryLabel as labelForCountry, dateFormatLabel } from "../regional-presentation-options";
import { industryLabel } from "../industry-options";
import { SubmissionFailure } from "../step-navigation";
import type { ProvisioningStepProps } from "./types";

/** Step indices the Edit links jump back to, mirroring PROVISIONING_STEPS. */
const ORGANIZATION_STEP = 0;
const REGION_STEP = 1;
const ADMIN_STEP = 2;

type ReviewStepProps = ProvisioningStepProps & {
  /** Jumps back to a step so a summarised value can be corrected in place. */
  onEditStep?: (step: number) => void;
  /** Commits the tenant — the wizard's terminal action lives in this panel. */
  onProvision?: () => void;
  /** Whether the draft is valid and the catalogue is loaded. */
  canProvision?: boolean;
  provisionPending?: boolean;
  provisionFailure?: Error | null;
};

/**
 * The last surface before the tenant is created. The left column restates every
 * decision, each card able to send the operator back to the step that owns it;
 * the right column is where the commitment is made, naming what provisioning
 * will do before it does it. Nothing here is editable in place — a summary that
 * could be edited would be a fourth copy of three forms — so correction is a
 * jump back, not an inline field.
 */
export function ReviewStep({
  draft,
  onEditStep,
  onProvision,
  canProvision = false,
  provisionPending = false,
  provisionFailure = null,
}: ReviewStepProps) {
  const t = useTranslations("provisioning");
  const say = useSay("provisioning");
  const language = useLocale();
  const catalogue = useProvisionableModules();
  const options = useMemo(
    () => buildModuleOptions(catalogue.data ?? [], say),
    [catalogue.data, say]
  );

  const included = useMemo(
    () => options.filter((option) => option.availability === "included"),
    [options]
  );
  const selected = useMemo(
    () =>
      options.filter(
        (option) =>
          option.availability === "selectable" &&
          draft.selectedModuleKeys.includes(option.key)
      ),
    [options, draft.selectedModuleKeys]
  );

  const offset = useMemo(
    () => timeZoneOffset(draft.timeZone),
    [draft.timeZone]
  );
  const role = adminRoleByValue(draft.adminRole, say);
  const countryLabel = useMemo(
    () => labelForCountry(draft.country, language),
    [draft.country, language]
  );

  const languageLabel =
    draft.locale === PLATFORM_DEFAULT_LOCALE
      ? t("review.platformDefault")
      : labelForLocale(draft.locale, language);
  const timeZoneLabel = `${labelForTimeZone(draft.timeZone)} (${offset})`;

  const adminName = [draft.firstName.trim(), draft.lastName.trim()]
    .filter(Boolean)
    .join(" ");
  const enabledProducts = [...included, ...selected];
  const enabledKeys = new Set(enabledProducts.map((option) => option.key));
  const restProducts = options.filter((option) => !enabledKeys.has(option.key));

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <SummaryCard
          icon={Building2}
          title={t("organization.title")}
          onEdit={onEditStep ? () => onEditStep(ORGANIZATION_STEP) : undefined}
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:flex justify-between">
            <Fact label={t("organization.name")} value={draft.name} />
            <Fact label={t("organization.slug")} value={draft.tenantSlug} />
            <Fact label={t("review.legalEntity")} value={draft.legalEntityName} />
            <Fact label={t("review.industry")} value={industryLabel(draft.industry, say)} />
          </dl>
          {/* <dl className="mt-4">
            <Fact label="Short description" value={draft.shortDescription} />
          </dl> */}
        </SummaryCard>

        <SummaryCard
          icon={Globe}
          title={t("review.region")}
          onEdit={onEditStep ? () => onEditStep(REGION_STEP) : undefined}
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:flex justify-between">
            <Fact label={t("region.country")} value={countryLabel} />
            <Fact label={t("region.timeZone")} value={timeZoneLabel} />
            <Fact label={t("region.language")} value={languageLabel} />
            <Fact label={t("region.dateFormat")} value={dateFormatLabel(draft.dateFormat, language)} />
          </dl>
        </SummaryCard>

        <SummaryCard
          icon={BarChart3}
          title={t("region.products.title")}
          onEdit={onEditStep ? () => onEditStep(REGION_STEP) : undefined}
        >
          {catalogue.data ? (
            <div className="space-y-3">
              {/* What the tenant gets reads first, along one row; what it does
                  not sits together below, quiet. */}
              {enabledProducts.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {enabledProducts.map((option) => (
                    <ProductChip
                      key={option.key}
                      option={option}
                      selected
                      className="min-w-[10rem] flex-1"
                    />
                  ))}
                </div>
              ) : null}
              {restProducts.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {restProducts.map((option) => (
                    <ProductChip
                      key={option.key}
                      option={option}
                      selected={false}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {t("review.productsLoading")}
            </p>
          )}
        </SummaryCard>

        <SummaryCard
          icon={User}
          title={t("admin.title")}
          onEdit={onEditStep ? () => onEditStep(ADMIN_STEP) : undefined}
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Fact label={t("review.name")} value={adminName} />
            <Fact label={t("admin.email")} value={draft.administratorEmail} />
            <Fact label={t("admin.role")} value={role.label} />
            <Fact
              label={t("review.invitation")}
              value={draft.sendInvitation ? t("review.sendNow") : t("review.sendLater")}
            />
          </dl>
        </SummaryCard>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="space-y-6 rounded-surface bg-card p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink">
              {canProvision ? (
                <CheckCircle2 aria-hidden="true" className="size-5" />
              ) : (
                <AlertCircle aria-hidden="true" className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <h3 className="type-subsection-title text-foreground">
                {canProvision ? t("review.ready") : t("review.almostReady")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {canProvision ? t("review.readyBody") : t("review.almostReadyBody")}
              </p>
            </div>
          </div>

          <div className="border-t border-border" />

          <div>
            <p className="type-eyebrow mb-3 text-muted-foreground">
              {t("review.happen.title")}
            </p>
            <ul className="space-y-2.5">
              {[
                t("review.happen.workspace"),
                t("review.happen.defaults"),
                t("review.happen.products"),
                t("review.happen.administrator"),
                draft.sendInvitation
                  ? t("review.happen.send")
                  : t("review.happen.prepare"),
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm">
                  <Check
                    aria-hidden="true"
                    className="size-4 shrink-0 text-success"
                  />
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-border" />

          <div>
            <p className="type-eyebrow mb-3 text-muted-foreground">{t("review.summary")}</p>
            <div className="space-y-2.5">
              <SummaryTile
                icon={LayoutGrid}
                title={t("review.enabledProducts", { count: enabledProducts.length })}
                detail={enabledProducts
                  .map((option) => option.label)
                  .join(", ")}
              />
              <SummaryTile
                icon={Globe}
                title={t("review.regionLine", { country: countryLabel })}
                detail={timeZoneLabel}
              />
              <SummaryTile
                icon={User}
                title={t("review.administrators", { count: 1 })}
                detail={
                  adminName || draft.administratorEmail.trim() || t("review.notSet")
                }
              />
            </div>
          </div>

          {provisionFailure ? (
            <SubmissionFailure error={provisionFailure} />
          ) : null}

          <div>
            <AsyncButton
              type="button"
              size="lg"
              className="w-full"
              onClick={onProvision}
              disabled={!canProvision}
              pending={provisionPending}
            >
              {t("title")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </AsyncButton>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {t("review.later")}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** A summarised section with the icon, title, and jump-back Edit of its step. */
function SummaryCard({
  icon: Icon,
  title,
  onEdit,
  children,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("provisioning.review");
  return (
    <section className="rounded-surface bg-card p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink">
            <Icon aria-hidden={true} className="size-5" />
          </span>
          <h3 className="type-section-title text-foreground">{title}</h3>
        </div>
        {onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-me-2 shrink-0 text-muted-foreground"
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            {t("edit")}
          </Button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** One summarised value: a quiet label over the value the operator entered. */
function Fact({ label, value }: { label: string; value: string }) {
  const t = useTranslations("provisioning.review");
  const isEmpty = value.trim().length === 0;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm [overflow-wrap:anywhere]",
          isEmpty
            ? "italic text-muted-foreground"
            : "font-medium text-foreground"
        )}
      >
        {isEmpty ? t("notSet") : value}
      </dd>
    </div>
  );
}

/** A compact recap line in the commit panel: an icon, a headline, its detail. */
function SummaryTile({
  icon: Icon,
  title,
  detail,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-surface border border-border bg-inlay p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink">
        <Icon aria-hidden={true} className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {detail || "—"}
        </p>
      </div>
    </div>
  );
}

/**
 * A product as it stands in the summary: the foundation and each enabled product
 * carry their colour, while anything off or unavailable recedes — the same
 * grammar as the products step, without a switch to throw.
 */
function ProductChip({
  option,
  selected,
  className,
}: {
  option: ProvisioningModuleOption;
  selected: boolean;
  className?: string;
}) {
  const t = useTranslations("provisioning");
  const Icon = option.icon;
  const included = option.availability === "included";
  const enabled = option.availability === "selectable" && selected;

  return (
    <div
      className={cn(
        "rounded-surface border p-3",
        included
          ? "border-primary/60 bg-primary/[0.06]"
          : enabled
            ? "border-success/50 bg-success/10"
            : "border-border opacity-60",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            included
              ? "text-primary-ink"
              : enabled
                ? "text-success"
                : "text-muted-foreground"
          )}
        />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {option.label}
        </span>
        {included ? (
          <span className=" inline-block rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary-ink">
            {t("region.products.required")}
          </span>
        ) : enabled ? (
          <span className="inline-block rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
            {t("review.enabled")}
          </span>
        ) : null}
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {option.description}
      </p>
    </div>
  );
}
