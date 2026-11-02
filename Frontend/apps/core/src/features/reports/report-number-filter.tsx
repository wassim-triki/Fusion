"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger } from "@repo/ds";

export function ReportNumberFilter({ label, from, to, disabled, onChange }: {
  label: string;
  from?: string;
  to?: string;
  disabled?: boolean;
  onChange: (range?: { from?: string; to?: string }) => void;
}) {
  const t = useTranslations("reports");
  const [open, setOpen] = useState(false);
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const active = from !== undefined || to !== undefined;
  const invalid = (lower !== "" && (!/^\d+(\.\d+)?$/.test(lower) || Number(lower) > 300)) ||
    (upper !== "" && (!/^\d+(\.\d+)?$/.test(upper) || Number(upper) > 300)) ||
    (lower !== "" && upper !== "" && Number(lower) > Number(upper));
  const description = from !== undefined && to !== undefined ? t("numberBetween", { from, to }) :
    from !== undefined ? t("numberFrom", { from }) : t("numberTo", { to: to ?? "" });
  return (
    <div className={active ? "inline-flex h-8 items-stretch rounded-control border border-border bg-inlay text-sm" : "inline-flex h-8 items-stretch rounded-control border border-dashed border-input text-sm"}>
      <Popover open={open} onOpenChange={(next) => { if (next) { setLower(from ?? ""); setUpper(to ?? ""); } setOpen(next); }}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} aria-label={active ? `${label}: ${description}` : t("filterBy", { field: label })} className="inline-flex items-center gap-1.5 px-2.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
            {!active && <Plus className="size-3.5" aria-hidden />}{label}{active && <span className="text-foreground">{description}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3">
          <p className="type-label">{t("years")}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="report-number-from">{t("from")}</Label><Input id="report-number-from" type="number" min="0" max="300" step="0.1" value={lower} onChange={e => setLower(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="report-number-to">{t("to")}</Label><Input id="report-number-to" type="number" min="0" max="300" step="0.1" value={upper} onChange={e => setUpper(e.target.value)} /></div>
          </div>
          {invalid && <p role="alert" className="type-meta text-destructive">{t("invalidRange")}</p>}
          <Button disabled={invalid} onClick={() => { onChange(lower || upper ? { from: lower || undefined, to: upper || undefined } : undefined); setOpen(false); }}>{t("apply")}</Button>
        </PopoverContent>
      </Popover>
      {active && <button type="button" aria-label={t("removeFilter", { field: label })} onClick={() => onChange()} className="flex w-7 items-center justify-center border-s border-border text-muted-foreground hover:text-foreground"><X className="size-3.5" aria-hidden /></button>}
    </div>
  );
}
