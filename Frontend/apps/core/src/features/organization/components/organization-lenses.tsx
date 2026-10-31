"use client";

import { useTranslations } from "next-intl";
import { LinkTabs } from "@repo/ds/shell";

export type OrganizationLens = "structure" | "jobs" | "places";

const LENSES: { id: OrganizationLens; href: string }[] = [
  { id: "structure", href: "/organization" },
  { id: "jobs", href: "/organization/jobs" },
  { id: "places", href: "/organization/places" },
];

/** The Organization area's sibling pages: the organization itself, the company's jobs, and the places people work. */
export function OrganizationLenses({ active }: { active: OrganizationLens }) {
  const t = useTranslations("organization");
  return (
    <LinkTabs
      label={t("lenses")}
      current={active}
      tabs={LENSES.map((lens) => ({ key: lens.id, href: lens.href, label: t(`lens.${lens.id}`) }))}
    />
  );
}
