"use client";

import { useTranslations } from "next-intl";
import { ChoiceMatrix } from "../choice/choice";

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
 * A company's email mode per notification group (B-002 N7) as a {@link ChoiceMatrix}: Required, On (people may turn it
 * off) or Off (people may turn it on), each said once in the header. A view-only reader sees the choices, disabled.
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
  const modeOf = new Map(groups.map((group) => [group.key, group.mode]));
  return (
    <ChoiceMatrix
      rowHeader={t("group")}
      rows={groups.map((group) => ({
        key: group.key,
        label: named(group.key, "name", group.label),
        description: named(group.key, "summary", group.summary),
      }))}
      columns={MODES.map((mode) => ({ value: mode, label: t(mode), description: t(`${mode}Short`), hint: t(`${mode}Hint`) }))}
      valueOf={(key) => modeOf.get(key) ?? "on"}
      onChange={(key, mode) => onChange(key, mode)}
      editable={editable}
      disabled={disabled}
    />
  );
}
