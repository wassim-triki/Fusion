"use client";

import { CoreSettingsSectionHost } from "@/features/settings/section-host";
import { RolesSettings } from "@/features/settings/roles/roles-table";

/** Settings › Roles: every role side by side. */
export default function RolesSettingsPage() {
  return <CoreSettingsSectionHost id="roles" render={(section) => <RolesSettings section={section} />} />;
}
