"use client";

import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { SettingsRow, SettingsRows, SettingsValue } from "./settings";

export type NotificationModeValue = "required" | "on" | "off";

export interface NotificationModeGroup {
  key: string;
  /** The module's English name, used when the catalogue doesn't know the group. */
  label: string;
  summary: string;
  mode: NotificationModeValue;
}

const MODES: readonly NotificationModeValue[] = ["required", "on", "off"];

/**
 * A company's email mode per notification group (B-002 N7): Required, On (people may turn it off) or Off (people may
 * turn it on). A view-only reader sees the mode as text.
 */
export function NotificationModeList({
  groups,
  editable,
  disabled,
  onChange,
}: {
  groups: readonly NotificationModeGroup[];
  editable: boolean;
  disabled?: boolean;
  onChange: (key: string, mode: NotificationModeValue) => void;
}) {
  const t = useTranslations("ds.settings.notificationModes");
  const named = (key: string, part: "name" | "summary", sent: string) => {
    const path = `groups.${key}.${part}` as Parameters<typeof t>[0];
    return t.has(path) ? t(path) : sent;
  };
  return (
    <SettingsRows>
      {groups.map((group) => {
        const label = named(group.key, "name", group.label);
        return (
          <SettingsRow
            key={group.key}
            label={label}
            description={named(group.key, "summary", group.summary)}
          >
            {editable ? (
              <ToggleGroup
                type="single"
                value={group.mode}
                onValueChange={(next) => {
                  const mode = MODES.find((value) => value === next);
                  if (mode) onChange(group.key, mode);
                }}
                aria-label={t("emailFor", { group: label })}
                disabled={disabled}
                className="rounded-control border bg-inlay p-0.5"
              >
                {MODES.map((mode) => (
                  <ToggleGroupItem
                    key={mode}
                    value={mode}
                    title={t(`${mode}Hint`)}
                    className="px-3 type-body text-muted-foreground data-[state=on]:bg-foreground! data-[state=on]:text-background! data-[state=on]:shadow-raised"
                  >
                    {t(mode)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : (
              <SettingsValue>{t(group.mode)}</SettingsValue>
            )}
          </SettingsRow>
        );
      })}
    </SettingsRows>
  );
}
