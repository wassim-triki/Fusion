"use client";

import { use } from "react";
import { CoreSettingsSectionHost } from "@/features/settings/section-host";
import { ApprovalsSettings } from "@/features/settings/sections/approvals";
import { ChecklistsSettings } from "@/features/settings/sections/checklists";
import { ChangeHistorySettings } from "@/features/settings/sections/change-history";
import { BrandSettings } from "@/features/settings/sections/brand";
import { DetailsSettings } from "@/features/settings/sections/details";
import { EmployeeFieldsSettings } from "@/features/settings/sections/employee-fields";
import { SignInSettings } from "@/features/settings/sections/sign-in";
import { ListsSettings } from "@/features/settings/sections/lists";
import { NotificationsSettings } from "@/features/settings/sections/notifications";
import { RolesSettings } from "@/features/settings/roles/roles-table";
import { JobsWorkspace } from "@/features/catalog/components/jobs-workspace";
import { PlacesWorkspace } from "@/features/catalog/components/places-workspace";

/** One Core HR settings section, shown once the server says the person may see it. */
export default function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: id } = use(params);
  return (
    <CoreSettingsSectionHost
      id={id}
      render={(section) => {
        switch (section.id) {
          case "brand":
            return <BrandSettings section={section} />;
          case "details":
            return <DetailsSettings section={section} />;
          case "employee-fields":
            return <EmployeeFieldsSettings section={section} />;
          case "lists":
            return <ListsSettings section={section} />;
          case "jobs":
            return <JobsWorkspace section={section} />;
          case "places":
            return <PlacesWorkspace section={section} />;
          case "roles":
            return <RolesSettings section={section} />;
          case "approvals":
            return <ApprovalsSettings section={section} />;
          case "checklists":
            return <ChecklistsSettings section={section} />;
          case "sign-in":
            return <SignInSettings section={section} />;
          case "notifications":
            return <NotificationsSettings section={section} />;
          default:
            return <ChangeHistorySettings section={section} />;
        }
      }}
    />
  );
}
