"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatWorkWeek,
  visibleFusionModules,
  type FusionSettingsSection,
} from "@repo/api";
import { useTenantSummary } from "@repo/api/query";
import { useStagedSettings, useFusionViewer } from "@repo/api/react";
import {
  FUSION_MODULE_ICONS,
  PageError,
  SettingsBlock,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsValue,
  SettingsSaveBar,
  useSettingsSectionName,
} from "@repo/ds/shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ds";
import { FilterChips } from "@repo/ds/choice";
import { useSettingsConflictSaver } from "@repo/api/query";
import { useOrganizationSettings, useUpdateOrganizationSettings } from "../api/use-tenant-settings";
import { useSaveFailure } from "../say";
import { dateFormatter } from "@repo/ds/lib/dates";

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7];
const COMMON_WEEKS = [
  { key: "weekdays", days: [1, 2, 3, 4, 5] },
  { key: "sundayWeek", days: [1, 2, 3, 4, 7] },
  { key: "everyDay", days: WEEK_DAYS },
] as const;

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
 * industry, time zone), the work week and the modules that are on. The name and language are in Brand.
 */
export function DetailsSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.details");
  const describe = useTranslations("ds.sidebar.moduleDescriptions");
  const locale = useLocale();
  const title = useSettingsSectionName()(section);
  const { viewer } = useFusionViewer();
  const tenant = useTenantSummary();
  const query = useOrganizationSettings();
  const update = useUpdateOrganizationSettings();
  const editable = section.access === "manage";
  const failure = useSaveFailure();
  const staged = useStagedSettings(query.data?.workingDays,
    (workingDays) => update.mutateAsync({ expectedVersion: query.data?.version ?? null, workingDays }),
    { leaveMessage: t("leave"), onReload: () => void query.refetch() });
  const saver = useSettingsConflictSaver("core", [section.id], staged.conflict);
  const draft = staged.draft;
  const preset = COMMON_WEEKS.find((week) => week.days.join() === draft?.join())?.key ?? "customWeek";
  const dayName = (day: number, weekday: "long" | "short" = "long") =>
    dateFormatter({ weekday, timeZone: "UTC" }, locale).format(new Date(Date.UTC(2026, 0, 4 + day)));
  const daysOff = WEEK_DAYS.filter((day) => !draft?.includes(day));
  const modules = useMemo(() => visibleFusionModules(viewer), [viewer]);

  if ((tenant.error && !tenant.data) || (query.error && !query.data)) {
    return (
      <SettingsPage title={title}>
        <PageError title={t("didNotLoad")} onRetry={() => { void tenant.refetch(); void query.refetch(); }} />
      </SettingsPage>
    );
  }

  const facts = tenant.data;
  return (
    <SettingsPage
      title={title}
      lastChange={section.lastChange}
      viewOnly={!editable}
      loading={!facts || !draft}
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

          {draft ? (
            <SettingsBlock title={t("workWeek")} action={editable ? (
              <Select value={preset} disabled={staged.saving} dir={locale === "ar" ? "rtl" : "ltr"}
                onValueChange={(key) => {
                  const week = COMMON_WEEKS.find((value) => value.key === key);
                  if (week) staged.update(() => [...week.days]);
                }}>
                <SelectTrigger aria-label={t("commonWeeks")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_WEEKS.map((week) => <SelectItem key={week.key} value={week.key}>{t(week.key)}</SelectItem>)}
                  <SelectItem value="customWeek" disabled>{t("customWeek")}</SelectItem>
                </SelectContent>
              </Select>
            ) : undefined}>
              {editable ? (
                <>
                  <FilterChips type="multiple" size="lg" label={t("workWeek")}
                    className="grid grid-cols-4 gap-2 sm:grid-cols-7" disabled={staged.saving}
                    value={draft.map(String)} onChange={(days) => { if (days.length) staged.update(() => days.map(Number)); }}
                    options={WEEK_DAYS.map((day) => ({
                      value: String(day), hint: dayName(day),
                      label: <><span aria-hidden>{dayName(day, "short")}</span><span className="sr-only">{dayName(day)}</span></>,
                      disabled: draft.length === 1 && draft.includes(day),
                    }))} />
                  <div aria-live="polite" className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="type-label text-foreground">{t("workingDays", { count: draft.length })}</p>
                    <p className="type-meta text-muted-foreground">{daysOff.length
                      ? t("daysOff", { days: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(daysOff.map((day) => dayName(day))) })
                      : t("noDaysOff")}</p>
                  </div>
                  {draft.length <= 1 ? <p className="mt-3 type-meta text-muted-foreground">{t("chooseDay")}</p> : null}
                </>
              ) : <SettingsValue>{formatWorkWeek(draft, locale)}</SettingsValue>}
            </SettingsBlock>
          ) : null}

          <SettingsBlock title={t("modules")} meta={t("modulesOn", { count: modules.length })}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {modules.map((module) => {
                const Icon = FUSION_MODULE_ICONS[module.key];
                return (
                  <li key={module.key} className="flex items-center gap-3 rounded-control bg-inlay px-4 py-3.5">
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
          {editable && draft ? <SettingsSaveBar changes={staged.changes} saving={staged.saving}
            saveLabel={t("saveChanges")}
            error={failure(staged.error, t("notSaved"))} conflict={saver} conflictPending={staged.conflict && !saver}
            onDiscard={staged.discard} onSave={() => { if (draft.length > 0) void staged.submit(); }} onReload={staged.reload} /> : null}
        </>
      ) : null}
    </SettingsPage>
  );
}
