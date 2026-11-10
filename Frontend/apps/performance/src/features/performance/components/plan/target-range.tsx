import { ArrowRight, TrendingDown, TrendingUp } from "@repo/ds/icons";
import { formatMeasureValue, isSymbolUnit } from "./plan-lib";
import { useTranslations } from "next-intl";

/**
 * Baseline → target for a numeric measure. The connector carries the improvement direction itself (a
 * rising or falling trend instead of a plain arrow), so the row never has to spell out "Increase".
 * Symbol units ride on both numbers; a worded unit is free text of any length, so it is read once on a
 * quiet label after the target and truncates instead of stretching the figures apart.
 */
export function TargetRange({
  baseline,
  target,
  unit,
  direction,
}: {
  baseline: number | null;
  target: number | null;
  unit: string | null;
  direction?: "Increase" | "Decrease" | null;
}) {
  const t = useTranslations("plan.TargetRange");
  const Icon = direction === "Decrease" ? TrendingDown : direction === "Increase" ? TrendingUp : ArrowRight;
  const label = unit?.trim() || null;
  const inline = label && isSymbolUnit(label) ? label : null;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 tabular-nums">
      <span className="shrink-0">{formatMeasureValue(baseline, inline)}</span>
      <Icon className="size-4.5 shrink-0 text-[var(--type-accent,var(--primary))]" aria-hidden />
      {direction ? <span className="sr-only">{direction === "Decrease" ? t("decreaseTo") : t("increaseTo")}</span> : null}
      <span className="shrink-0">{formatMeasureValue(target, inline)}</span>
      {label && !inline ? (
        <span className="min-w-0 max-w-48 truncate text-muted-foreground" title={label}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
