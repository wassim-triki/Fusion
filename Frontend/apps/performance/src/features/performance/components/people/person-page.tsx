"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { canEnterCoreHr, useAuth } from "@repo/auth";
import { Button, Skeleton } from "@repo/ds";
import { PageContainer, PageHeader } from "@repo/ds/shell";
import { PersonPerformanceSummary, type RenderSummaryLink } from "@repo/performance-ui";
import { useReactToPraise } from "@repo/api/query";
import { usePersonSummary } from "../../api/use-performance";
import { REACTION_ICONS } from "../conversations/reaction-icons";
import { FeedbackComposer } from "../conversations/composers";
import { useEffect, useState } from "react";
import { useRecentRecord } from "@repo/api/react";
import { useTranslations } from "next-intl";

const BASE_PATH = "/performance";

/** Performance paths open with the router; anything else is another app and needs a full navigation. */
export const renderPerformanceLink: RenderSummaryLink = ({ href, className, children }) =>
  href === BASE_PATH || href.startsWith(`${BASE_PATH}/`) ? (
    <Link href={href.slice(BASE_PATH.length) || "/"} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );

/**
 * One person inside Performance (D-32). The person page is one page across modules (B-180): whoever can open Core HR
 * goes to its Performance tab; this stays for anyone who can't.
 */
export function PersonPage({ employeeId }: { employeeId: string }) {
  const t = useTranslations("common.PersonPage");
  const { user } = useAuth();
  const router = useRouter();
  const react = useReactToPraise();
  const summary = usePersonSummary(employeeId);
  const [giving, setGiving] = useState(false);
  const person = summary.data;
  useRecentRecord(
    "performance",
    person?.displayName ? { label: person.displayName, kind: "Person", href: `/performance/people/${employeeId}` } : null,
  );
  const coreRecord = person?.stableEmployeeKey && canEnterCoreHr(user) ? `/core/people/${person.stableEmployeeKey}` : null;
  const onePage = coreRecord ? (person?.relation === "Self" ? "/core/profile?tab=performance" : `${coreRecord}?tab=performance`) : null;
  useEffect(() => {
    if (onePage) window.location.replace(onePage);
  }, [onePage]);
  const context = [person?.jobTitle, person?.orgUnitName].filter(Boolean);

  return (
    <PageContainer width="wide">
      {person && !onePage ? (
        <PageHeader className="mb-4"
          title={person.displayName ?? t("person")}
          description={context.length ? context.join(", ") : undefined}
          actions={
            <>
              {coreRecord ? (
                <Button asChild variant="outline">
                  <a href={coreRecord}>{t("openCoreHrRecord")}</a>
                </Button>
              ) : null}
              {person.relation !== "Self" ? <Button onClick={() => setGiving(true)}>{t("giveFeedback")}</Button> : null}
            </>
          }
        />
      ) : summary.error ? (
        <PageHeader className="mb-4" title={t("person")} />
      ) : (
        <div className="mb-4 space-y-2" aria-hidden>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}
      <div className="mt-6">
        <PersonPerformanceSummary
          renderLink={renderPerformanceLink}
          reactionIcons={REACTION_ICONS}
          onReact={(praise, kind, add) => react.mutate({ praiseId: praise.id, kind, add })}
          onOpenPraise={(praise) => router.push(`/feedback?tab=praise&praise=${praise.id}`)}
          state={
            person && !onePage
              ? { status: "ready", summary: person }
              : summary.error
                ? { status: "error", onRetry: () => void summary.refetch() }
                : { status: "loading" }
          }
        />
      </div>
      {giving && person ? (
        <FeedbackComposer
          receiver={{ employeeId: person.employeeId, displayName: person.displayName ?? "This colleague", subtitle: person.jobTitle }}
          onClose={() => setGiving(false)}
        />
      ) : null}
    </PageContainer>
  );
}
