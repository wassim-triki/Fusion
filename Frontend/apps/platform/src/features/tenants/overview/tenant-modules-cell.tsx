"use client";

import { useTranslations } from "next-intl";
import { ChevronDown } from "@repo/ds/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ds/components/ui/popover";
import type { TenantModule } from "../api";
import { isModuleMandatory, moduleLabel } from "../language";

/**
 * Entitlements as a count that opens.
 *
 * Naming every module inline stops fitting the moment a tenant holds several,
 * and the platform expects to grow past two. The count holds one line at any
 * size; the names stay one click or one keypress away rather than behind a
 * hover, which a keyboard or touch operator would never reach.
 */
export function TenantModulesCell({ modules }: { modules: TenantModule[] }) {
  const t = useTranslations("tenants.modules");
  if (modules.length === 0) {
    // Truthful: a tenant with no entitlement recorded is not "0 enabled"
    // dressed up as a working disclosure.
    return <span className="text-sm text-muted-foreground">{t("none")}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("show", { count: modules.length })}
          className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.rich("enabledCount", {
            count: modules.length,
            n: (chunks) => <span className="tabular-nums">{chunks}</span>,
          })}
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-60 p-3">
        <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("enabled")}
        </p>
        <ul className="space-y-2">
          {modules.map((module) => (
            <li key={module} className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground">{moduleLabel(module)}</span>
              {/* Entitlement language only. Whether a module has been set up
                  inside the tenant is Core HR's business, not the platform's. */}
              <span className="shrink-0 text-xs text-muted-foreground">
                {isModuleMandatory(module) ? t("included") : t("enabledOne")}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
