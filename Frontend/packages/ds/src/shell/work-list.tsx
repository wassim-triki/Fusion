import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "../lib/utils";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Skeleton } from "../components/ui/skeleton";

export interface WorkListItem {
  id: string;
  module: string;
  title: string;
  context?: string | null;
  /** ISO date (`yyyy-mm-dd`). */
  dueOn?: string | null;
  href: string;
  subject?: { displayName: string } | null;
  /** The path the work belongs to, when its module composes one. */
  steps?: { label: string; detail?: string | null; state: "done" | "current" | "upcoming" }[] | null;
  /** What the item's button does; "Open" when the module doesn't say. */
  actionLabel?: string | null;
}

export interface WorkListModule {
  key: string;
  label: string;
  status: "loading" | "ready" | "error";
}

/** Renders a link to an item's path; defaults to a plain anchor (a full navigation across apps). */
export type RenderWorkLink = (props: { href: string; className: string; children: ReactNode }) => ReactNode;

const defaultLink: RenderWorkLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / DAY_MS;
}

/** Whole days from `today` to `dueOn`: negative when overdue. */
export function daysUntil(dueOn: string, today: Date): number {
  const todayNumber = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY_MS;
  return dayNumber(dueOn) - todayNumber;
}

/** The words of a due line, in one language. */
export interface DueWords {
  late: (days: number) => string;
  today: string;
  tomorrow: string;
  left: (days: number) => string;
}

const ENGLISH_DUE: DueWords = {
  late: (days) => (days === 1 ? "1 day late" : `${days} days late`),
  today: "Due today",
  tomorrow: "Due tomorrow",
  left: (days) => `${days} days left`,
};

export function dueLabel(dueOn: string, today: Date, words: DueWords = ENGLISH_DUE): string {
  const days = daysUntil(dueOn, today);
  if (days < 0) return words.late(-days);
  if (days === 0) return words.today;
  if (days === 1) return words.tomorrow;
  return words.left(days);
}

/** {@link DueWords} in the person's language. */
export function useDueWords(): DueWords {
  const t = useTranslations("ds.work.due");
  return {
    late: (count) => t("late", { count }),
    today: t("today"),
    tomorrow: t("tomorrow"),
    left: (count) => t("left", { count }),
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export interface WorkListProps {
  items: WorkListItem[];
  modules: WorkListModule[];
  today?: Date;
  renderLink?: RenderWorkLink;
  /** Shown when nothing needs the person and nothing is loading or failed. */
  emptyLabel?: string;
  className?: string;
}

/**
 * Everything else that needs the person, earliest due first, each row opening its path. A module
 * still loading keeps placeholder rows; a module that failed is named in one quiet line.
 */
export function WorkList({
  items,
  modules,
  today,
  renderLink = defaultLink,
  emptyLabel,
  className,
}: WorkListProps) {
  const t = useTranslations("ds.work");
  const locale = useLocale();
  const dueWords = useDueWords();
  const reference = today ?? new Date();
  const labels = new Map(modules.map((module) => [module.key, module.label]));
  const loading = modules.filter((module) => module.status === "loading");
  const failed = modules.filter((module) => module.status === "error");

  return (
    <div lang={locale} className={cn("space-y-2", className)}>
      {items.length === 0 && loading.length === 0 && failed.length === 0 ? (
        <p className="py-2 type-body-secondary text-muted-foreground">{emptyLabel ?? t("empty")}</p>
      ) : null}
      {items.length > 0 || loading.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-surface bg-card">
          {items.map((item) => {
            const days = item.dueOn ? daysUntil(item.dueOn, reference) : null;
            const moduleLabel = labels.get(item.module) ?? item.module;
            return (
              <li key={item.id}>
                {renderLink({
                  href: item.href,
                  className:
                    "group flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  children: (
                    <>
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback hue={item.subject?.displayName} className="text-xs">
                          {item.subject ? initials(item.subject.displayName) : moduleLabel.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate type-body font-medium text-foreground">{item.title}</span>
                        <span className="block truncate type-meta text-muted-foreground">{item.context ?? moduleLabel}</span>
                      </span>
                      {item.dueOn && days !== null ? (
                        <span className={cn("shrink-0 type-meta", days < 0 ? "text-warning" : "text-muted-foreground")}>
                          {dueLabel(item.dueOn, reference, dueWords)}
                        </span>
                      ) : null}
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
                    </>
                  ),
                })}
              </li>
            );
          })}
          {loading.map((module) => (
            <li key={`loading-${module.key}`} aria-busy aria-label={t("loadingModule", { module: module.label })} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {failed.map((module) => (
        <p key={module.key} role="status" className="type-meta text-muted-foreground">
          {t("moduleFailed", { module: module.label })}
        </p>
      ))}
    </div>
  );
}
