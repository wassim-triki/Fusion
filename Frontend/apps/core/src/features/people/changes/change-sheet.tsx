"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@repo/ds";
import type { WorkforceChangeDto } from "@repo/api";
import { ChangePanel, type ChangeKind } from "./change-panel";

type Open = { employeeKey: string; kind: ChangeKind; editing: WorkforceChangeDto | null };

const KINDS: Record<string, ChangeKind> = { job: "job", end: "end", start: "start" };

/**
 * The change panel as a right-hand sheet, for pages that aren't the chart. `?change=job|end|start` on a profile
 * opens it (old change-page links land there), then leaves the address.
 */
export function useChangeSheet(deepLinkKey?: string) {
  const t = useTranslations("changes.kind");
  const params = useSearchParams();
  const [open, setOpen] = useState<Open | null>(null);

  const requested = params.get("change");
  useEffect(() => {
    if (!deepLinkKey || !requested || !KINDS[requested]) return;
    setOpen({ employeeKey: deepLinkKey, kind: KINDS[requested], editing: null });
    const next = new URLSearchParams(params.toString());
    next.delete("change");
    // The browser's path keeps the app's base path (/core); Next's pathname leaves it out, so a refresh would land
    // outside Core HR (B-168).
    const path = window.location.pathname;
    window.history.replaceState(window.history.state, "", next.size ? `${path}?${next}` : path);
  }, [deepLinkKey, requested, params]);

  const start = useCallback((employeeKey: string, kind: ChangeKind) => setOpen({ employeeKey, kind, editing: null }), []);
  /** Edit reopens the change's own kind, filled in. */
  const edit = useCallback((change: WorkforceChangeDto) => setOpen({
    employeeKey: change.person.employeeKey,
    kind: change.kind === "EndEmployment" ? "end" : change.kind === "Join" ? "start" : "job",
    editing: change,
  }), []);

  const element = (
    <Sheet open={Boolean(open)} onOpenChange={(next) => { if (!next) setOpen(null); }}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 data-[side=right]:w-[480px] data-[side=right]:sm:max-w-[480px]">
        <SheetTitle className="sr-only">{open ? t(open.kind) : ""}</SheetTitle>
        {open ? (
          <ChangePanel key={`${open.employeeKey}-${open.kind}-${open.editing?.id ?? "new"}`}
            employeeKey={open.employeeKey} kind={open.kind} editing={open.editing} onClose={() => setOpen(null)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );

  return { start, edit, element };
}
