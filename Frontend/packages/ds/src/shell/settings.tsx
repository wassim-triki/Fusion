"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, Eye } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "../lib/utils";
import { formatDate, formatRelative, recencyOf } from "../lib/dates";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { useSettingsSectionName } from "./fusion-sidebar";
import { Section } from "./section";

// ── Fusion Settings page parts (B-071 D4) ──
//
// Every settings section is one centred column: the title in Lora, who changed it last, then blocks of rows.
// A view-only reader gets the same rows with values as text, and no save bar.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** "a minute ago" within a day, else "on 2 Sep 2026". */
export function settingsWhen(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  if (now.getTime() - date.getTime() < 86_400_000) {
    const relative = formatRelative(date, now);
    return relative === "Just now" ? "just now" : relative;
  }
  return `on ${formatDate(date, { year: "always", now })}`;
}

/**
 * {@link settingsWhen} in the person's language, to end a sentence: "just now", "12 min ago", "on 2 Sep 2026" or
 * "à l’instant", "il y a 12 min", "le 2 sept. 2026".
 */
export function useSettingsWhen(): (at: string, now?: Date) => string {
  const t = useTranslations("ds.settings.when");
  const locale = useLocale();
  return (at, now = new Date()) => {
    const date = new Date(at);
    const recency = now.getTime() - date.getTime() < 86_400_000 ? recencyOf(date, now) : null;
    switch (recency?.unit) {
      case "now":
        return t("now");
      case "minutes":
        return t("minutes", { count: recency.count });
      case "hours":
        return t("hours", { count: recency.count });
      case "yesterday":
        return t("yesterday");
      default:
        return t("on", { date: formatDate(date, { year: "always", now, locale }) });
    }
  };
}

export interface SettingsLastChangeValue {
  at: string;
  actorName: string;
}

/** Who changed the section last and when, or when it was set up. Nothing while neither is known. */
export function LastChange({
  change,
  setUpAt,
  now,
}: {
  change?: SettingsLastChangeValue | null;
  setUpAt?: string | null;
  now?: Date;
}) {
  const t = useTranslations("ds.settings");
  const locale = useLocale();
  const when = useSettingsWhen();
  if (change) {
    return (
      <p lang={locale} className="flex items-center gap-2 type-meta text-muted-foreground">
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-full bg-inlay text-[9px] font-semibold text-foreground/85 ring-1 ring-border"
        >
          {initials(change.actorName)}
        </span>
        <span>
          {t.rich("changedBy", {
            actor: change.actorName,
            when: when(change.at, now),
            b: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
          })}
        </span>
      </p>
    );
  }
  if (setUpAt) {
    return (
      <p lang={locale} className="type-meta text-muted-foreground">
        {t("setUp", { when: when(setUpAt, now) })}
      </p>
    );
  }
  return null;
}

/** The quiet "View only" mark on a section a person can read but not change. */
export function ViewOnlyBadge({ className }: { className?: string }) {
  const t = useTranslations("ds.settings");
  const locale = useLocale();
  return (
    <span
      lang={locale}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control border border-border bg-inlay px-2 py-1 type-meta text-muted-foreground",
        className,
      )}
    >
      <Eye aria-hidden className="size-3.5" />
      {t("viewOnly")}
    </span>
  );
}

/** "Saved", shown for a moment after a personal setting saves on change. */
export function SettingsSaved({ at }: { at: number | null }) {
  const t = useTranslations("ds.settings");
  const locale = useLocale();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (at === null) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [at]);
  return (
    <span
      lang={locale}
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control bg-success-subtle px-2 py-1 type-meta font-semibold text-success transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <Check aria-hidden className="size-3.5" />
      {visible ? t("saved") : null}
    </span>
  );
}

export interface SettingsPageProps {
  title: string;
  /** Under the title: who changed it last (or when it was set up). */
  lastChange?: SettingsLastChangeValue | null;
  setUpAt?: string | null;
  /** Under the title instead of a last change, for a section nobody here changes. */
  note?: ReactNode;
  /** The section is view-only for this person. */
  viewOnly?: boolean;
  /** Right of the title, such as `SettingsSaved`. */
  aside?: ReactNode;
  /** Roles: a list beside the role it opens needs 960px. */
  wide?: boolean;
  /** Brand: the controls beside a live preview need the full width. */
  studio?: boolean;
  /** Values still loading: the title shows, the rows wait. */
  loading?: boolean;
  children?: ReactNode;
}

/** One settings section: title, last change, then its blocks. The frame and title render before the values. */
export function SettingsPage({ title, lastChange, setUpAt, note, viewOnly, aside, wide, studio, loading, children }: SettingsPageProps) {
  return (
    <div className={cn("mx-auto w-full px-6 pt-10 pb-16", studio ? "max-w-[1240px]" : wide ? "max-w-[960px]" : "max-w-[760px]")}>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="type-page-title">{title}</h1>
          {note ? (
            <p className="type-meta text-muted-foreground">{note}</p>
          ) : loading && !lastChange && !setUpAt ? (
            <Skeleton className="h-4 w-60" />
          ) : (
            <LastChange change={lastChange} setUpAt={setUpAt} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-2">
          {viewOnly ? <ViewOnlyBadge /> : null}
          {aside}
        </div>
      </header>
      {loading ? <SettingsSkeleton /> : <div className="flex flex-col gap-10">{children}</div>}
    </div>
  );
}

/** Stable placeholders while a section's values load. */
export function SettingsSkeleton({ rows = 4 }: { rows?: number }) {
  const t = useTranslations("ds.settings");
  return (
    <div aria-busy aria-label={t("loading")} className="flex flex-col gap-3">
      <Skeleton className="h-5 w-32" />
      <div className="overflow-hidden rounded-surface bg-card">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-b-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ms-auto h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SettingsBlockProps {
  title?: ReactNode;
  /** Beside the title, quiet: "This device", "2 on". */
  meta?: ReactNode;
  /** At the end of the title line, such as an add action. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A group of related settings: one frame with its heading inside (B-225). */
export function SettingsBlock({ title, meta, action, children, className }: SettingsBlockProps) {
  return (
    <Section size="card" title={title} meta={meta} action={action} className={className}>
      {children}
    </Section>
  );
}

/** The rows of a block: one object, rows separated by hairlines. */
export function SettingsRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // Inside a padded section the rows run edge to edge under a hairline; on their own they're a card.
    <div
      data-slot="settings-rows"
      className={cn(
        "overflow-hidden rounded-surface bg-card in-data-padded:-mx-5 in-data-padded:-mb-5 in-data-padded:rounded-none in-data-padded:border-t in-data-padded:border-border in-data-padded:bg-transparent",
        className
      )}
    >
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  /** Only for a real constraint or consequence; never a restated label. */
  description?: ReactNode;
  /** The control, or the value as text for a view-only reader. */
  children?: ReactNode;
  /** Id of the control the label names. */
  htmlFor?: string;
  className?: string;
}

/** One setting: its label on the left, its control or value on the right. */
export function SettingsRow({ label, description, children, htmlFor, className }: SettingsRowProps) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div className={cn("flex min-h-[62px] items-center gap-6 px-5 py-3", className)}>
      <Label htmlFor={htmlFor} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-label font-semibold text-foreground">{label}</span>
        {description ? <span className="type-meta text-muted-foreground">{description}</span> : null}
      </Label>
      {children !== undefined ? <div className="flex shrink-0 items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

/** A value read, not edited. */
export function SettingsValue({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-end text-sm font-semibold text-foreground", className)}>{children}</span>;
}

export interface SettingsConflict {
  /** Who saved first, and when. */
  actorName: string;
  at: string;
  /** The section they saved, as the module named it. */
  section: string;
  /** Its id, which names it in the person's language. */
  sectionId?: string;
}

export interface SettingsSaveBarProps {
  changes: number;
  /** What saving does, in one sentence. */
  consequence?: ReactNode;
  saving?: boolean;
  /** The save failed for another reason: what happened, in one line. */
  error?: string | null;
  conflict?: SettingsConflict | null;
  /** Someone saved first, but who isn't known yet. */
  conflictPending?: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onReload: () => void;
  /** Label of the save action ("Save", "Save version 2"). */
  saveLabel?: string;
}

/**
 * Staged edits wait here: how many, what saving does, Discard and Save. When someone saved the section first, it
 * names them and offers Reload instead.
 */
export function SettingsSaveBar({
  changes,
  consequence,
  saving = false,
  error,
  conflict,
  conflictPending = false,
  onDiscard,
  onSave,
  onReload,
  saveLabel,
}: SettingsSaveBarProps) {
  const t = useTranslations("ds.settings");
  const locale = useLocale();
  const when = useSettingsWhen();
  const sectionName = useSettingsSectionName();
  const conflicted = Boolean(conflict) || conflictPending;
  if (changes === 0 && !conflicted) return null;
  return (
    <div lang={locale} className="sticky bottom-6 z-10 mt-10">
      <div
        role="region"
        aria-label={t("unsavedChanges")}
        className={cn(
          "flex items-center gap-4 rounded-surface border bg-popover px-5 py-3.5 shadow-overlay",
          conflicted ? "border-destructive/40" : "border-border",
        )}
      >
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", conflicted ? "bg-destructive" : "bg-primary")} />
        {conflicted ? (
          <p className="min-w-0 flex-1 text-sm text-foreground/85" role="alert">
            {conflict ? (
              <span className="font-semibold text-foreground">
                {t("conflictBy", {
                  actor: conflict.actorName,
                  section: conflict.sectionId
                    ? sectionName({ id: conflict.sectionId, label: conflict.section })
                    : conflict.section,
                  when: when(conflict.at),
                })}
              </span>
            ) : (
              <span className="font-semibold text-foreground">{t("conflictSomeone")}</span>
            )}{" "}
            {t("conflictReload")}
          </p>
        ) : (
          <>
            <span className="shrink-0 text-sm font-semibold text-foreground">
              {t("changes", { count: changes })}
            </span>
            <p className={cn("min-w-0 flex-1 text-sm", error ? "text-destructive" : "text-foreground/85")} role={error ? "alert" : undefined}>
              {error ?? consequence}
            </p>
          </>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {conflicted ? (
            <Button size="sm" onClick={onReload}>
              {t("reload")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>
                {t("discard")}
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving}>
                {saving ? <Spinner className="size-3.5" /> : null}
                {saveLabel ?? t("save")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Settings › Core HR › Company": where the person is inside Settings. Earlier steps are quiet text. */
export function SettingsBreadcrumb({ trail }: { trail: readonly string[] }) {
  const t = useTranslations("ds.settings");
  const locale = useLocale();
  return (
    <nav aria-label={t("breadcrumb")}>
      <ol className="flex min-w-0 items-center gap-2 text-sm">
        <li lang={locale}>
          <a href="/settings" className="text-muted-foreground transition-colors hover:text-foreground">
            {t("title")}
          </a>
        </li>
        {trail.map((step, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${step}-${index}`} className="flex min-w-0 items-center gap-2">
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span
                aria-current={last ? "page" : undefined}
                className={cn("truncate", last ? "font-semibold text-foreground" : "text-muted-foreground")}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
