"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import { toast } from "sonner";
import { Spinner, cn } from "@repo/ds";

export type MappingStatus = "mapped" | "ignored" | "needs-review";

/**
 * Column rhythm of the mapping tables: what the file says, its evidence, Fusion meaning, state.
 * The meaning and state columns keep their size and the source side gives way: on a narrow
 * table the evidence folds under the label instead of claiming a column of its own.
 */
export const COLUMN_GRID =
  "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)_minmax(12.5rem,1.2fr)_8rem] @2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(12.5rem,14rem)_8rem]";
export const TYPE_GRID =
  "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)_minmax(11rem,1.2fr)_8rem] @2xl:grid-cols-[minmax(0,1.3fr)_6rem_minmax(11rem,14rem)_8rem]";

export function MappingSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-surface bg-card p-4">
      <header className="px-1">
        <h2 id={id} className="type-section-title text-foreground">
          {title}
        </h2>
        {description ? <p className="mt-0.5 type-meta text-muted-foreground">{description}</p> : null}
      </header>
      <div className="@container mt-3 overflow-x-auto rounded-control border border-border">
        <div role="table" aria-labelledby={id} className="min-w-[30rem]">
          {children}
        </div>
      </div>
    </section>
  );
}

export function MappingHead({
  grid,
  labels,
}: {
  grid: string;
  /** The second column folds into the first on narrow tables. */
  labels: [string, string, string, string];
}) {
  return (
    <div role="row" className={cn(grid, "type-eyebrow bg-inlay px-4 py-2.5 text-muted-foreground")}>
      {labels.map((label, index) => (
        <span
          key={label}
          role="columnheader"
          className={cn("truncate", index === 1 && "hidden @2xl:block")}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

const STATUS = {
  mapped: {
    label: "mapped",
    Icon: CircleCheck,
    pill: "bg-success-subtle text-success",
    icon: "fill-success stroke-card",
  },
  ignored: {
    label: "ignored",
    Icon: CircleMinus,
    pill: "bg-muted text-muted-foreground",
    icon: "fill-muted-foreground stroke-card",
  },
  "needs-review": {
    label: "needs-review",
    Icon: CircleAlert,
    pill: "bg-primary/15 text-primary-foreground dark:text-primary",
    icon: "fill-primary stroke-card",
  },
} as const;

export function MappingStatusPill({ status, pending }: { status: MappingStatus; pending?: boolean }) {
  const t = useTranslations("dataImport");
  if (pending)
    return (
      <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground">
        <Spinner className="size-3.5" aria-hidden />
        {t("status.saving")}
      </span>
    );
  const { label, Icon, pill, icon } = STATUS[status];
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full py-0.5 pe-2.5 ps-1 type-meta font-medium", pill)}>
      <Icon aria-hidden className={cn("size-4", icon)} strokeWidth={2.25} />
      {t(`status.${label}`)}
    </span>
  );
}

/**
 * Edits Match one row at a time. The chosen value shows at once while the server settles it; the
 * response is the new truth. A failure keeps the last authoritative value and says so briefly.
 * Edits are serialized so each one lands on the version it was made against.
 */
export type MatchEdits<C> = {
  edit: (key: string, value: string, change: C) => Promise<boolean>;
  busy: boolean;
  pendingValue: (key: string) => string | undefined;
};

export function useMatchEdit<C>(save: (change: C) => Promise<unknown>, describeError: (error: unknown) => string): MatchEdits<C> {
  const t = useTranslations("dataImport");
  const [pending, setPending] = useState<{ key: string; value: string } | null>(null);

  async function edit(key: string, value: string, change: C) {
    if (pending) return false;
    setPending({ key, value });
    try {
      await save(change);
      return true;
    } catch (error) {
      toast.error(t("notSaved"), { description: describeError(error) });
      return false;
    } finally {
      setPending(null);
    }
  }

  return {
    edit,
    busy: pending !== null,
    pendingValue: (key: string) => (pending?.key === key ? pending.value : undefined),
  };
}
