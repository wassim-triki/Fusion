"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton } from "@repo/ds";
import { ChartNoAxesColumn, ChevronRight, FileText, Users } from "@repo/ds/icons";
import { LinkTabs, PageContainer, Section } from "@repo/ds/shell";
import { canAdministerPerformanceYears, canViewCoreReports, useAuth } from "@repo/auth";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

export type InsightsTab = "people" | "performance" | "reports";

/** The tabs this person has, in the drawing's order (D-88). */
export function useInsightsTabs(): { tabs: InsightsTab[]; pending: boolean } {
  const { user, isLoading } = useAuth();
  const tabs: InsightsTab[] = [];
  if (canViewCoreReports(user)) tabs.push("people");
  if (canAdministerPerformanceYears(user)) tabs.push("performance");
  if (canViewCoreReports(user)) tabs.push("reports");
  return { tabs, pending: isLoading };
}

const ICONS = { people: Users, performance: ChartNoAxesColumn, reports: FileText } as const;

/** Insights, Fusion's one dashboard (D-88): the title, the tabs, and the tab's pickers on the right. */
export function InsightsFrame({ tab, controls, children }: { tab: InsightsTab; controls?: ReactNode; children: ReactNode }) {
  const t = useTranslations("insights");
  const { tabs, pending } = useInsightsTabs();
  return (
    <PageContainer width="wide" className="space-y-5 pb-10">
      <header className="flex flex-wrap items-end gap-4 pt-2">
        <div className="space-y-3">
          <h1 className="type-page-title">{t("title")}</h1>
          {pending ? (
            <Skeleton className="h-9 w-80" />
          ) : (
            <LinkTabs
              label={t("title")}
              current={tab}
              tabs={tabs.map((key) => ({ key, href: `/insights/${key}`, label: t(`tabs.${key}`), icon: ICONS[key] }))}
            />
          )}
        </div>
        {controls ? <div className="ms-auto flex flex-wrap items-center gap-2">{controls}</div> : null}
      </header>
      {!pending && !tabs.includes(tab) ? (
        <Section title={t("noAccess.title")}>
          <p className="px-5 pb-5 type-body text-muted-foreground">{t("noAccess.body")}</p>
        </Section>
      ) : (
        children
      )}
    </PageContainer>
  );
}

/** A chart's card: its title, what's on the right of it (keys or a note), the chart. */
export function ChartCard({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-4 rounded-surface bg-card p-5 ${className ?? ""}`}>
      <div className="flex min-h-7 flex-wrap items-center gap-3">
        <h2 className="type-section-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export interface SheetPerson {
  key: string;
  name: string;
  sub?: string | null;
  href?: string | null;
}

/** The people behind a figure (D-84), each opening their page. */
export function PeopleSheet({
  open, onOpenChange, title, description, people, total, loading, error, onMore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  people: SheetPerson[];
  total: number;
  loading?: boolean;
  error?: boolean;
  onMore?: () => void;
}) {
  const t = useTranslations("insights.sheet");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description ?? t("count", { count: total })}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {loading && people.length === 0 ? (
            <div className="space-y-2 pt-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <p role="alert" className="px-2 pt-2 type-body text-muted-foreground">
              {t("failed")}
            </p>
          ) : people.length === 0 ? (
            <p className="px-2 pt-2 type-body text-muted-foreground">{t("nobody")}</p>
          ) : (
            <ul className="flex flex-col">
              {people.map((person) => {
                const body = (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate type-label font-semibold">{person.name}</span>
                      {person.sub ? <span className="truncate type-caption text-muted-foreground">{person.sub}</span> : null}
                    </span>
                    {person.href ? <ChevronRight aria-hidden className="size-4 text-muted-foreground rtl:rotate-180" /> : null}
                  </>
                );
                return (
                  <li key={person.key}>
                    {person.href ? (
                      person.href.startsWith("/core/") ? (
                        <Link href={person.href.slice("/core".length)} className="flex items-center gap-3 rounded-inset px-2 py-2.5 outline-none hover:bg-inlay/60 focus-visible:ring-2 focus-visible:ring-ring">
                          {body}
                        </Link>
                      ) : (
                        <a href={person.href} className="flex items-center gap-3 rounded-inset px-2 py-2.5 outline-none hover:bg-inlay/60 focus-visible:ring-2 focus-visible:ring-ring">
                          {body}
                        </a>
                      )
                    ) : (
                      <div className="flex items-center gap-3 px-2 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {onMore && people.length < total ? (
            <button type="button" onClick={onMore} className="mt-3 px-2 type-label font-semibold text-primary-ink hover:underline">
              {t("more", { count: total - people.length })}
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
