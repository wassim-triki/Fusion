"use client";

import { CoreSettingsSectionHost } from "@/features/settings/section-host";
import { AdministratorsPage } from "@/features/settings/roles/administrators-page";

/** Settings › Roles › Administrators: who, what they can do, and every grant kept. */
export default function AdministratorsSettingsPage() {
  return <CoreSettingsSectionHost id="roles" render={(section) => <AdministratorsPage section={section} />} />;
}
