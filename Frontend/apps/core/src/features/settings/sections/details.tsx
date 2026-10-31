"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  visibleFusionModules,
  type FusionSettingsSection,
} from "@repo/api";
import { useTenantSummary } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import {
  FUSION_MODULE_ICONS,
  PageError,
  SettingsBlock,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsValue,
  useSettingsSectionName,
} from "@repo/ds/shell";
import { dateFormatter } from "@repo/ds/lib/dates";

/**
 * "English (United States)" for "en-US", named in the person's language ("Anglais (États-Unis)"); the code itself
 * when the browser can't name it.
 */
export function languageName(locale: string, language = "en"): string {
  try {
    const name = new Intl.DisplayNames([language], { type: "language", languageDisplay: "standard" }).of(locale) ?? locale;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return locale;
  }
}

/** "Africa/Tunis · UTC+1": the zone and its current offset. */
export function timeZoneLabel(timeZone: string, now: Date = new Date(), language?: string): string {
  try {
    const offset = dateFormatter({ timeZone, timeZoneName: "shortOffset" }, language)
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${timeZone} · ${offset.replace("GMT", "UTC") || "UTC"}` : timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Settings › Details: the company's facts set when it joined Fusion and changed by the Fusion provider (workspace,
 * industry, time zone), and the modules that are on. Nothing here is editable; the name and language are in Brand.
 */
export function DetailsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.details");
  const describe = useTranslations("ds.sidebar.moduleDescriptions");
  const locale = useLocale();
  const title = useSettingsSectionName()(section);
  const { viewer } = useFusionViewer();
  const tenant = useTenantSummary();
  const modules = useMemo(
    () => visibleFusionModules(viewer).filter((module) => module.entitlement),
    [viewer]
  );

  if (tenant.error) {
    return (
      <SettingsPage title={title}>
        <PageError title={t("didNotLoad")} onRetry={() => void tenant.refetch()} />
      </SettingsPage>
    );
  }

  const facts = tenant.data;
  return (
    <SettingsPage
      title={title}
      note={facts ? t("note", { name: facts.name }) : undefined}
      loading={!facts}
    >
      {facts ? (
        <>
          <SettingsRows>
            {facts.slug ? (
              <SettingsRow label={t("workspace")}>
                <SettingsValue className="type-code">{facts.slug}</SettingsValue>
              </SettingsRow>
            ) : null}
            {facts.industry ? (
              <SettingsRow label={t("industry")}>
                <SettingsValue>{facts.industry}</SettingsValue>
              </SettingsRow>
            ) : null}
            {facts.timeZone ? (
              <SettingsRow label={t("timeZone")} description={t("timeZoneDetail")}>
                <SettingsValue>{timeZoneLabel(facts.timeZone, undefined, locale)}</SettingsValue>
              </SettingsRow>
            ) : null}
          </SettingsRows>

          <SettingsBlock title={t("modules")} meta={t("modulesOn", { count: modules.length })}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {modules.map((module) => {
                const Icon = FUSION_MODULE_ICONS[module.key];
                return (
                  <li key={module.key} className="flex items-center gap-3 rounded-surface bg-card px-4 py-3.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-control bg-primary-tint text-primary-ink">
                      {Icon ? <Icon aria-hidden className="size-4" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="type-label font-semibold text-foreground">{module.label}</span>
                      <span className="truncate type-meta text-muted-foreground">
                        {describe.has(module.key as never) ? describe(module.key as never) : module.description}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </SettingsBlock>
        </>
      ) : null}
    </SettingsPage>
  );
}
