"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@repo/ds";

export type OrganizationLens = "structure" | "jobs" | "places";

const LENSES: { id: OrganizationLens; href: string }[] = [
  { id: "structure", href: "/organization" },
  { id: "jobs", href: "/organization/jobs" },
  { id: "places", href: "/organization/places" },
];

/** The Organization area's sibling views: its structure, the company's jobs, and the places people work. */
export function OrganizationLenses({ active }: { active: OrganizationLens }) {
  const t = useTranslations("organization");
  return (
    <nav aria-label={t("lenses")} className="flex items-center gap-6 border-b">
      {LENSES.map((lens) => (
        <Link
          key={lens.id}
          href={lens.href}
          aria-current={lens.id === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 pb-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            lens.id === active
              ? "border-primary font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`lens.${lens.id}`)}
        </Link>
      ))}
    </nav>
  );
}
