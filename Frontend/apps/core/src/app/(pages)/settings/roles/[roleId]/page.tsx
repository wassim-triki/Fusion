"use client";

import { use } from "react";
import { CoreSettingsSectionHost } from "@/features/settings/section-host";
import { RolePage } from "@/features/settings/roles/role-page";

/** Settings › Roles › one role. */
export default function RoleSettingsPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = use(params);
  return <CoreSettingsSectionHost id="roles" render={(section) => <RolePage roleId={roleId} section={section} />} />;
}
