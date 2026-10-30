import { useSettingsSectionName } from "@repo/ds/shell";

/** Core HR's sections in Fusion Settings, in order (the server decides which a person sees). */
export const CORE_SETTINGS_SECTIONS = [
  { id: "company", label: "Company" },
  { id: "employee-fields", label: "Employee fields" },
  { id: "lists", label: "Lists" },
  { id: "roles", label: "Roles" },
  { id: "invitations", label: "Invitations" },
  { id: "notifications", label: "Notifications" },
  { id: "change-history", label: "Change history" },
] as const;

export type CoreSettingsSectionId = (typeof CORE_SETTINGS_SECTIONS)[number]["id"];

export function isCoreSettingsSectionId(value: string): value is CoreSettingsSectionId {
  return CORE_SETTINGS_SECTIONS.some((section) => section.id === value);
}

/** A Core HR section's name in the person's language, before the server's list arrives. */
export function useCoreSettingsLabel(): (id: string) => string {
  const name = useSettingsSectionName();
  return (id) => name({ id, label: CORE_SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "Settings" });
}

/** The settings section an audit entry belongs to, by the audit's own section id. */
export const AUDIT_SECTION_IDS: Record<string, CoreSettingsSectionId> = {
  organization: "company",
  "people-data": "employee-fields",
  lists: "lists",
  provisioning: "invitations",
  "access-permissions": "roles",
  roles: "roles",
  notifications: "notifications",
};
