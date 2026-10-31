"use client";

import type { ReactNode } from "react";
import type { FusionSettingsSection } from "@repo/api";
import { SettingsPage, useSettingsSectionName } from "@repo/ds/shell";

/** Settings › Jobs and Settings › Places: the company's catalogues, read by whoever works with the structure. */
export function CatalogFrame({
  section,
  actions,
  children,
}: {
  section: FusionSettingsSection;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const title = useSettingsSectionName()(section);
  return (
    <SettingsPage title={title} lastChange={section.lastChange} setUpAt={section.setUpAt} viewOnly={section.access !== "manage"} aside={actions} wide>
      {children}
    </SettingsPage>
  );
}

/** Who holds a job or place today: a figure, or a faint dash for nobody. */
export function CountCell({ value }: { value: number }) {
  return value > 0 ? (
    <span className="type-body tabular-nums text-foreground">{value}</span>
  ) : (
    <span className="type-body text-muted-foreground/60" aria-label="0">–</span>
  );
}
