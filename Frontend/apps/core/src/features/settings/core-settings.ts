import { useSettingsSectionName } from "@repo/ds/shell";

/** Core HR's sections in Fusion Settings, in order (the server decides which a person sees). */
export const CORE_SETTINGS_SECTIONS = [
  { id: "brand", label: "Brand" },
  { id: "details", label: "Details" },
  { id: "employee-fields", label: "Fields" },
  { id: "lists", label: "Lists" },
  { id: "jobs", label: "Jobs" },
  { id: "places", label: "Places" },
  { id: "roles", label: "Roles" },
  { id: "approvals", label: "Changes and approvals" },
  { id: "checklists", label: "Joining and leaving" },
  { id: "sign-in", label: "Sign-in" },
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
  organization: "details",
  "people-data": "employee-fields",
  lists: "lists",
  provisioning: "sign-in",
  "access-permissions": "roles",
  roles: "roles",
  approvals: "approvals",
  notifications: "notifications",
};
