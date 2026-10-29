"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { fusionAttentionQueryKeys } from "@repo/api";
import { type Locale } from "@repo/i18n/config";
import { useLanguage } from "@repo/auth";
import {
  cn,
} from "@repo/ds";
import { OptionCards, Segmented } from "@repo/ds/choice";
import {
  SettingsBlock,
  SettingsPage,
  SettingsRow,
  SettingsRows,
  SettingsSaved,
  useTheme,
} from "@repo/ds/shell";

type Appearance = "dark" | "light" | "system";

const APPEARANCES: { value: Appearance; icon: LucideIcon }[] = [
  { value: "dark", icon: Moon },
  { value: "light", icon: Sun },
  { value: "system", icon: Monitor },
];

/** Each language names itself, whatever the page's language. */
const LANGUAGES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ar", label: "العربية" },
];

/**
 * A small picture of Fusion in one appearance. It shows that appearance's own colours whatever the page's theme,
 * so its fills are fixed rather than theme tokens.
 */
function Miniature({ tone }: { tone: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-1",
        dark ? "bg-zinc-950" : "bg-zinc-50"
      )}
    >
      <div
        className={cn(
          "flex w-1/4 flex-col gap-1.5 p-2",
          dark ? "bg-zinc-900" : "bg-zinc-200"
        )}
      >
        <span className="h-1.5 w-5 rounded-full bg-primary" />
        <span
          className={cn(
            "h-1 w-full rounded-full",
            dark ? "bg-zinc-700" : "bg-zinc-300"
          )}
        />
        <span
          className={cn(
            "h-1 w-full rounded-full",
            dark ? "bg-zinc-700" : "bg-zinc-300"
          )}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <span
          className={cn(
            "h-2 w-1/2 rounded-full",
            dark ? "bg-zinc-200" : "bg-zinc-800"
          )}
        />
        <span
          className={cn(
            "h-1 w-5/6 rounded-full",
            dark ? "bg-zinc-700" : "bg-zinc-300"
          )}
        />
        <span
          className={cn(
            "h-1 w-2/3 rounded-full",
            dark ? "bg-zinc-700" : "bg-zinc-300"
          )}
        />
      </div>
    </div>
  );
}

function AppearancePreview({ value }: { value: Appearance }) {
  return (
    <div
      aria-hidden
      className="flex h-28 overflow-hidden rounded-control border border-border"
    >
      {value === "system" ? (
        <>
          <Miniature tone="dark" />
          <Miniature tone="light" />
        </>
      ) : (
        <Miniature tone={value} />
      )}
    </div>
  );
}

/**
 * Settings › Preferences, in the person's language: appearance, kept on this device, and language, kept on their
 * account. Both save the moment they change.
 */
export function Preferences() {
  const t = useTranslations("settings.preferences");
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const [language, setLanguage, savingLanguage] = useLanguage();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [languageFailed, setLanguageFailed] = useState(false);
  useEffect(() => setMounted(true), []);

  const appearance =
    mounted && (theme === "dark" || theme === "light" || theme === "system")
      ? theme
      : undefined;

  const chooseLanguage = async (next: Locale) => {
    setLanguageFailed(false);
    try {
      await setLanguage(next);
      // Notifications are worded by the server in the language a request reads in.
      void queryClient.invalidateQueries({
        queryKey: fusionAttentionQueryKeys.all(),
      });
      setSavedAt(Date.now());
    } catch {
      setLanguageFailed(true);
    }
  };

  return (
    <div lang={locale} className="contents">
      <SettingsPage title={t("title")} aside={<SettingsSaved at={savedAt} />}>
        <SettingsBlock title={t("appearance")} meta={t("thisDevice")}>
          <OptionCards
            label={t("appearance")}
            value={appearance}
            onChange={(next) => {
              setTheme(next);
              setSavedAt(Date.now());
            }}
            options={APPEARANCES.map((option) => {
              const Icon = option.icon;
              return {
                value: option.value,
                label: t(option.value),
                icon: <Icon aria-hidden />,
                preview: <AppearancePreview value={option.value} />,
              };
            })}
          />
        </SettingsBlock>

        <SettingsBlock title={t("language")} meta={t("yourAccount")}>
          <SettingsRows>
            <SettingsRow
              label={t("language")}
              description={
                languageFailed ? (
                  <span role="alert" className="text-destructive">
                    {t("languageNotSaved")}
                  </span>
                ) : undefined
              }
            >
              <Segmented
                label={t("language")}
                value={language}
                disabled={!mounted || savingLanguage}
                onChange={(next) => {
                  if (next !== language) void chooseLanguage(next);
                }}
                options={LANGUAGES.map((option) => ({
                  value: option.value,
                  label: <span lang={option.value}>{option.label}</span>,
                }))}
              />
            </SettingsRow>
          </SettingsRows>
        </SettingsBlock>
      </SettingsPage>
    </div>
  );
}
