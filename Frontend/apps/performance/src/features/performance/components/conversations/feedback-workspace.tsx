"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@repo/auth";
import type { FeedbackDto, FeedbackRequestRowDto, FeedbackSummaryDto, FeedbackView, PraiseScope, PraiseSummaryDto } from "@repo/api";
import { useReactToPraise } from "@repo/api/query";
import { Button } from "@repo/ds/components/ui/button";
import { FilterChips } from "@repo/ds/choice";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@repo/ds/components/ui/tabs";
import { PageContainer, PageHeader, StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, PersonInitials, PraiseList, VALUE_TONE, ValueChip, useValueTones } from "@repo/performance-ui";
import { ChevronRight, MessageSquare, Send, Star, Target } from "@/lib/icons";
import {
  useCompanyValues,
  useFeedbackList,
  useFeedbackRequests,
  useFeedbackSummary,
  useOneOnOnes,
  usePraisePage,
  usePraiseSummary,
} from "../../api/use-conversations";

import { formatDay } from "../one-on-ones/one-on-one-lib";
import { ContentUnavailable } from "../content-unavailable";
import { PlanDocument, SidebarSection } from "../plan/plan-layout";
import { FeedbackComposer, PraiseComposer, RequestComposer, type FixedObjective } from "./composers";
import { ByMonth, DueBlock, SubjectChip, firstName } from "./conversation-parts";
import { FeedbackDrawer, PraiseDrawer } from "./drawers";
import { REACTION_ICONS } from "./reaction-icons";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useLanding } from "@/lib/use-landing";

type Tab = "received" | "given" | "requests" | "praise" | "team";
const TABS: readonly { value: Tab }[] = [{ value: "received" }, { value: "given" }, { value: "requests" }, { value: "praise" }];

type Composing = { kind: "feedback" } | { kind: "request"; objective?: FixedObjective } | { kind: "praise"; value?: string } | null;

/**
 * The Feedback workspace (S-12): Received · Given · Requests · Praise, each in the address so notifications and other
 * modules open the exact place. Received leads with the year in feedback and where to ask next; Requests leads with
 * what's asked of you; Praise is a wall. Feedback and praise open in drawers; nothing here follows the cycle.
 */
export function FeedbackWorkspace() {
  const tr = useTranslations("conversations.FeedbackWorkspace");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const feedbackId = params.get("feedback");
  const praiseId = params.get("praise");
  const requestedTab = TABS.find((t) => t.value === params.get("tab"))?.value ?? (params.get("tab") === "team" ? "team" : null);
  const [composing, setComposing] = useState<Composing>(params.get("compose") === "praise" ? { kind: "praise" } : null);
  const summary = useFeedbackSummary();
  const oneOnOnes = useOneOnOnes();
  const managesPeople = (oneOnOnes.data?.reports.length ?? 0) + (oneOnOnes.data?.startWithReports.length ?? 0) > 0;
  const toAnswer = summary.data?.toAnswer ?? 0;
  // Feedback about a manager's people is its own tab, beside theirs, for those who manage people.
  const tabs = managesPeople ? [...TABS, { value: "team" as const }] : TABS;
  const tab: Tab = requestedTab === "team" && !managesPeople ? "received" : (requestedTab ?? (praiseId ? "praise" : "received"));

  const update = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    query.delete("compose");
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  };
  const ask = (objective?: FixedObjective) => setComposing({ kind: "request", objective });

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4"
        title={tr("feedback")}
        actions={
          <>
            <Button variant="outline" onClick={() => ask()}>{tr("askForFeedback")}</Button>
            <Button onClick={() => setComposing({ kind: "feedback" })}>
              <Send className="size-4" data-icon="inline-start" /> {tr("giveFeedback")}
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(value) => update({ tab: value, feedback: null, praise: null })} className="mt-4">
        <TabsList aria-label={tr("feedback")}>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-3">
              {tr(`tabs.${t.value}`)}
              {t.value === "requests" && toAnswer > 0 ? (
                <span className="type-meta-strong tabular-nums text-primary-ink" aria-label={tr("toAnswer", { toAnswer })}>{toAnswer}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-6">
        {tab === "received" ? (
          <ReceivedTab
            summary={summary.data}
            onOpen={(id) => update({ feedback: id })}
            onAsk={ask}
            onAnswer={() => update({ tab: "requests" })}
          />
        ) : tab === "team" ? (
          <FeedbackFeed view="team" onOpen={(id) => update({ feedback: id })} empty={<EmptyLine text={tr("noFeedbackAboutYourTeam")} />} />
        ) : tab === "given" ? (
          <FeedbackFeed view="given" onOpen={(id) => update({ feedback: id })} empty={<EmptyLine text={tr("youHaventGivenFeedbackYet")} />} />
        ) : tab === "requests" ? (
          <RequestsTab />
        ) : (
          <PraiseTab
            employeeId={params.get("employee")}
            scope={(params.get("scope") as PraiseScope | null) ?? "all"}
            onScope={(scope) => update({ scope: scope === "all" ? null : scope, employee: null })}
            onOpen={(id) => update({ praise: id })}
            onGive={(value) => setComposing({ kind: "praise", value })}
          />
        )}
      </div>
      <FeedbackDrawer feedbackId={feedbackId} onClose={() => update({ feedback: null })} />
      <PraiseDrawer praiseId={praiseId} onClose={() => update({ praise: null })} />
      {composing?.kind === "feedback" ? <FeedbackComposer onClose={() => setComposing(null)} /> : null}
      {composing?.kind === "request" ? (
        <RequestComposer objective={composing.objective} onClose={() => setComposing(null)} onSent={(id) => router.push(`/feedback/requests/${id}`)} />
      ) : null}
      {composing?.kind === "praise" ? <PraiseComposer initialValue={composing.value} onClose={() => setComposing(null)} /> : null}
    </PageContainer>
  );
}

function EmptyLine({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-dashed border-border px-5 py-4">
      <p className="type-body-secondary text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

// ── Received ───────────────────────────────────────────────────────────────────

function ReceivedTab({
  summary,
  onOpen,
  onAsk,
  onAnswer,
}: {
  summary: FeedbackSummaryDto | undefined;
  onOpen: (id: string) => void;
  onAsk: (objective?: FixedObjective) => void;
  onAnswer: () => void;
}) {
  const t = useTranslations("conversations.ReceivedTab");
  const askFirst = summary?.askAbout[0];
  const empty = askFirst ? (
    <div className="flex flex-wrap items-center gap-4 rounded-surface bg-card px-5 py-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-control border border-primary-ring bg-primary-tint text-primary-ink" aria-hidden>
        <MessageSquare className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-label text-foreground">{t("noFeedbackYet")}</p>
        <p className="truncate type-meta text-muted-foreground">{t("askAbout", { title: askFirst.title })}</p>
      </div>
      <Button size="sm" onClick={() => onAsk({ cycleId: askFirst.cycleId, objectiveId: askFirst.objectiveId, title: askFirst.title })}>
        {t("askForFeedback")}
      </Button>
    </div>
  ) : (
    <EmptyLine text={t("noFeedbackYet")} action={<Button size="sm" variant="outline" onClick={() => onAsk()}>{t("askForFeedback")}</Button>} />
  );

  return (
    <div className="space-y-6">
      {summary && summary.received > 0 ? <ReceivedBand summary={summary} onAnswer={onAnswer} /> : null}
      <PlanDocument
        main={<FeedbackFeed view="received" onOpen={onOpen} empty={empty} />}
        sidebar={summary && (summary.received > 0 || summary.given > 0) ? <ReceivedSidebar summary={summary} onAsk={onAsk} /> : undefined}
      />
    </div>
  );
}

/** The year in feedback at a glance: how much, from whom, about what, and what's waiting on you. */
function ReceivedBand({ summary, onAnswer }: { summary: FeedbackSummaryDto; onAnswer: () => void }) {
  const t = useTranslations("conversations.ReceivedBand");
  const toneOf = useValueTones();
  const total = summary.subjects.reduce((sum, s) => sum + s.count, 0) || 1;
  const fill = (s: FeedbackSummaryDto["subjects"][number]) =>
    s.kind === "Competency" && s.competencyId ? VALUE_TONE[toneOf(s.competencyId)].fill : s.kind === "Objective" ? "bg-primary" : "bg-muted-foreground/40";
  return (
    <section aria-label={t("yourFeedbackAtAGlance")} className="grid items-center gap-6 rounded-surface bg-card p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-10 md:px-6">
      <div className="flex items-center gap-4">
        <span className="type-display tabular-nums text-foreground">{summary.received}</span>
        <div className="space-y-1.5">
          <p className="type-meta text-muted-foreground">{t("fromColleague", { fromCount: summary.fromCount })}{summary.fromCount === 1 ? "" : t("s")}</p>
          <AvatarStack names={summary.from.map((p) => p.name)} size="xs" max={5} />
        </div>
      </div>
      <div className="min-w-0 space-y-2.5">
        {/* A share needs at least two parts; one subject is just its line below. */}
        {summary.subjects.length > 1 ? <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {summary.subjects.map((s) => (
            <span key={`${s.kind}-${s.objectiveId ?? s.competencyId ?? "none"}`} className={cn("h-full first:rounded-s-full last:rounded-e-full", fill(s))} style={{ width: `${(s.count / total) * 100}%` }} />
          ))}
        </div> : null}
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {summary.subjects.slice(0, 5).map((s) => (
            <li key={`${s.kind}-${s.objectiveId ?? s.competencyId ?? "none"}`} className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", fill(s))} />
              <span className="max-w-56 truncate">{s.label ?? t("nothingSpecific")}</span>
              <span className="tabular-nums">{s.count}</span>
            </li>
          ))}
        </ul>
      </div>
      {summary.toAnswer > 0 ? (
        <button type="button" onClick={onAnswer} className="group flex items-center gap-3 rounded-control bg-inlay px-4 py-3 text-start hover:bg-inlay/70">
          <span className="grid size-9 place-items-center rounded-control border border-primary-ring bg-primary-tint text-primary-ink" aria-hidden>
            <MessageSquare className="size-4" />
          </span>
          <span>
            <span className="block type-label text-foreground">{t("toAnswer", { toAnswer: summary.toAnswer })}</span>
            <span className="block type-meta text-muted-foreground">{t("requestsWaitingOnYou")}</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

function ReceivedSidebar({ summary, onAsk }: { summary: FeedbackSummaryDto; onAsk: (objective: FixedObjective) => void }) {
  const t = useTranslations("conversations.ReceivedSidebar");
  const praise = usePraiseSummary();
  return (
    <>
      {summary.askAbout.length > 0 ? (
        <SidebarSection label={t("askAbout")}>
          <ul className="mt-3.5 space-y-2">
            {summary.askAbout.map((objective) => (
              <li key={objective.objectiveId} className="flex items-center gap-3 rounded-surface bg-card px-4 py-3">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-control border",
                    objective.status === "AtRisk" || objective.status === "OffTrack" ? "border-primary-ring bg-primary-tint text-primary-ink" : "border-border bg-inlay text-muted-foreground",
                  )}
                >
                  <Target className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate type-label text-foreground">{objective.title}</span>
                  <span className="block type-meta text-muted-foreground">
                    {objective.feedback === 0 ? t("noFeedbackYet") : (objective.feedback === 1 ? t("pieceOfFeedback", { feedback: objective.feedback }) : t("piecesOfFeedback", { feedback: objective.feedback }))}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onAsk({ cycleId: objective.cycleId, objectiveId: objective.objectiveId, title: objective.title })}>
                  {t("ask")}
                </Button>
              </li>
            ))}
          </ul>
        </SidebarSection>
      ) : null}
      {summary.given > 0 || (praise.data?.given ?? 0) > 0 ? <SidebarSection label={t("givenByYou")}>
        <div className="mt-3.5 flex gap-8">
          <div>
            <p className="type-metric text-foreground">{summary.given}</p>
            <p className="type-meta text-muted-foreground">{t("feedback")}</p>
          </div>
          {praise.data ? (
            <div>
              <p className="type-metric text-foreground">{praise.data.given}</p>
              <p className="type-meta text-muted-foreground">{t("praise")}</p>
            </div>
          ) : null}
        </div>
      </SidebarSection> : null}
    </>
  );
}

/** Feedback, newest first, grouped by month, fifty at a time (keyset paging from the server). */
function FeedbackFeed({ view, onOpen, empty }: { view: FeedbackView; onOpen: (id: string) => void; empty: ReactNode }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  return (
    <div className="space-y-8">
      {cursors.map((before, index) => (
        <FeedbackPage
          key={before ?? "first"}
          view={view}
          before={before}
          onOpen={onOpen}
          empty={index === 0 ? empty : null}
          onMore={index === cursors.length - 1 ? (next) => setCursors((current) => [...current, next]) : undefined}
        />
      ))}
    </div>
  );
}

function FeedbackPage({
  view,
  before,
  onOpen,
  empty,
  onMore,
}: {
  view: FeedbackView;
  before: string | null;
  onOpen: (id: string) => void;
  empty: ReactNode;
  onMore?: (next: string) => void;
}) {
  const t = useTranslations("conversations.FeedbackPage");
  const page = useFeedbackList({ view, before, limit: 50 });
  // A notification lands on its card in the newest page; an older one opens in the drawer.
  useLanding("feedback", before === null && Boolean(page.data), onOpen);
  if (page.error) return <ContentUnavailable error={page.error} onRetry={page.refetch} subject={t("feedback")} />;
  if (!page.data) return <FeedSkeleton />;
  if (page.data.items.length === 0) return <>{empty}</>;
  return (
    <>
      <ByMonth items={page.data.items} at={(f) => f.sentAt} render={(f) => <FeedbackCard key={f.id} feedback={f} view={view} onOpen={onOpen} />} />
      {page.data.next && onMore ? <Button variant="ghost" size="sm" onClick={() => onMore(page.data!.next!)}>{t("showOlder")}</Button> : null}
    </>
  );
}

/** One piece of feedback as its person and their words; the subject and provenance stay quiet beside them. */
export function FeedbackCard({
  feedback,
  view,
  onOpen,
  hideSubject = false,
}: {
  feedback: FeedbackDto;
  view: FeedbackView;
  onOpen: (id: string) => void;
  /** Where the list is already about one subject (an objective's record). */
  hideSubject?: boolean;
}) {
  const format = useFormat();
  const t = useTranslations("conversations.FeedbackCard");
  const person = view === "given" ? feedback.receiver : feedback.author;
  const subject = hideSubject ? null : feedback.subject;
  return (
    <li>
      <button
        type="button"
        id={`feedback-${feedback.id}`}
        onClick={() => onOpen(feedback.id)}
        className="flex w-full scroll-mt-24 flex-col gap-3.5 rounded-surface bg-card p-5 text-start transition-colors hover:bg-inlay/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex w-full items-center gap-3">
          <PersonInitials name={person.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate type-label text-foreground">
              {view === "team" ? (
                <>
                  {feedback.author.name} <span className="text-muted-foreground">{t("to")}</span> {feedback.receiver.name}
                </>
              ) : view === "given" ? (
                <>
                  <span className="text-muted-foreground">{t("to2")}</span> {feedback.receiver.name}
                </>
              ) : (
                feedback.author.name ?? t("aColleague")
              )}
            </span>
            <span className="block type-meta text-muted-foreground">{formatDay(feedback.sentAt, format.locale)}</span>
          </span>
          {feedback.visibility === "ManagerOnly" ? <StatusBadge tone="neutral">{t("managerOnly")}</StatusBadge> : null}
          {subject ? <SubjectChip subject={subject} className="hidden max-w-60 sm:inline-flex" /> : null}
        </span>
        <span className="block type-narrative line-clamp-4 text-foreground">{feedback.message}</span>
        {subject ? <SubjectChip subject={subject} className="sm:hidden" /> : null}
        {feedback.requestQuestion ? (
          <span className="block truncate type-meta text-muted-foreground">{t("answerTo", { requestQuestion: feedback.requestQuestion })}</span>
        ) : null}
      </button>
    </li>
  );
}

// ── Requests ───────────────────────────────────────────────────────────────────

function RequestsTab() {
  const t = useTranslations("conversations.RequestsTab");
  const requests = useFeedbackRequests();
  if (requests.error) return <ContentUnavailable error={requests.error} onRetry={requests.refetch} subject={t("feedbackRequests")} />;
  if (!requests.data) return <FeedSkeleton />;
  const waiting = requests.data.toAnswer.filter((r) => r.state === "Open" && r.myStatus === "Waiting");
  const mineOpen = requests.data.mine.filter((r) => r.state === "Open");
  const closed = [
    ...requests.data.toAnswer.filter((r) => !(r.state === "Open" && r.myStatus === "Waiting")).map((row) => ({ row, asked: true })),
    ...requests.data.mine.filter((r) => r.state !== "Open").map((row) => ({ row, asked: false })),
  ].sort((a, b) => b.row.requestedAt.localeCompare(a.row.requestedAt));
  const lastAnswered = requests.data.toAnswer.find((r) => r.myStatus === "Answered");

  return (
    <div className="max-w-4xl space-y-10">
      <section aria-labelledby="asked-of-you">
        <h2 id="asked-of-you" className="mb-4 type-section-title text-foreground">{t("askedOfYou")}</h2>
        {waiting.length === 0 ? (
          <p className="type-body-secondary text-muted-foreground">
            {t("nothingToAnswer")}{lastAnswered ? " " + t("lastAnsweredFor", { name: lastAnswered.requester.name ?? "" }) : ""}
          </p>
        ) : (
          <ul className="space-y-3">{waiting.map((row) => <AskedOfYou key={row.id} row={row} />)}</ul>
        )}
      </section>

      <section aria-labelledby="your-requests">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="your-requests" className="flex items-baseline gap-2 type-section-title text-foreground">
            {t("yours")} {mineOpen.length > 0 ? <span className="type-meta tabular-nums text-muted-foreground">{t("open", { length: mineOpen.length })}</span> : null}
          </h2>
        </div>
        {mineOpen.length === 0 ? (
          <p className="type-body-secondary text-muted-foreground">{t("noOpenRequests")}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-surface bg-card">{mineOpen.map((row) => <YourRequest key={row.id} row={row} />)}</ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section aria-labelledby="closed-requests">
          <h2 id="closed-requests" className="mb-3 flex items-baseline gap-2 type-subsection-title text-muted-foreground">
            {t("closed")} <span className="type-meta tabular-nums">{closed.length}</span>
          </h2>
          <ul className="space-y-2">
            {closed.map(({ row, asked }) => (
              <li key={row.id}>
                <Link href={`/feedback/requests/${row.id}`} className="group flex items-center gap-3 rounded-control bg-inlay px-4 py-3 hover:bg-inlay/70">
                  <span className="min-w-0 flex-1 truncate type-body text-foreground">
                    {asked ? <span className="text-muted-foreground">{t("asked", { name: firstName(row.requester.name) })} </span> : null}
                    {row.question}
                  </span>
                  <span className="shrink-0 type-meta tabular-nums text-muted-foreground">
                    {asked
                      ? row.myStatus === "Answered" ? t("answered") : row.myStatus === "Declined" ? t("declined") : t("closed")
                      : (row.answered === 1 ? t("answer", { answered: row.answered }) : t("answers", { answered: row.answered }))}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A question asked of you: the clock, who asked, the question in their words, and Answer. */
function AskedOfYou({ row }: { row: FeedbackRequestRowDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.AskedOfYou");
  return (
    <li className="flex flex-wrap items-center gap-5 rounded-surface border border-primary-ring bg-card p-5 sm:flex-nowrap">
      <DueBlock date={row.dueDate} overdue={row.overdue} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex items-center gap-2 type-meta text-muted-foreground">
          <PersonInitials name={row.requester.name} size="xs" />
          <span><span className="type-label text-foreground">{row.requester.name}</span> {t("askedYou", { requestedAt: formatDay(row.requestedAt, format.locale) })}</span>
        </p>
        <p className="type-narrative text-foreground">{row.question}</p>
        {row.subject ? <SubjectChip subject={row.subject} /> : null}
      </div>
      <Button asChild>
        <Link href={`/feedback/requests/${row.id}`}>{t("answer")}</Link>
      </Button>
    </li>
  );
}

/** One of your open requests: what you asked, who has answered, and the latest answer. */
function YourRequest({ row }: { row: FeedbackRequestRowDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.YourRequest");
  const invitees = row.invitees ?? [];
  return (
    <li>
      <Link href={`/feedback/requests/${row.id}`} className="grid gap-4 px-5 py-4 hover:bg-inlay/40 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {row.subject ? <SubjectChip subject={row.subject} /> : null}
            <span className={cn("type-meta tabular-nums", row.overdue ? "text-destructive" : "text-muted-foreground")}>
              {row.overdue ? t("overdue") : t("due")} {format.date(row.dueDate)}
            </span>
          </div>
          <p className="type-label text-foreground">{row.question}</p>
          {row.latestAnswer ? (
            <p className="truncate type-body-secondary text-muted-foreground">
              <span className="text-foreground">{firstName(row.latestAnswer.author.name)}:</span> &ldquo;{row.latestAnswer.message}&rdquo;
            </p>
          ) : (
            <p className="type-meta text-muted-foreground">{t("noAnswersYet")}</p>
          )}
        </div>
        <div className="flex flex-col gap-2.5 md:items-end">
          <ul className="flex gap-3" aria-label={t("asked")}>
            {invitees.map((invitee) => (
              <li key={invitee.person.id} className="flex flex-col items-center gap-1" title={`${invitee.person.name}: ${invitee.status.toLowerCase()}`}>
                <PersonInitials
                  name={invitee.person.name}
                  size="sm"
                  className={cn(
                    "ring-2 ring-offset-2 ring-offset-card",
                    invitee.status === "Answered" ? "ring-success" : invitee.status === "Declined" ? "opacity-50 ring-transparent" : "ring-border",
                  )}
                />
                <span className="type-meta text-muted-foreground">{invitee.status === "Answered" ? t("answered") : invitee.status === "Declined" ? t("declined") : t("waiting")}</span>
              </li>
            ))}
          </ul>
          <div className="flex w-full items-center gap-2.5 md:w-48">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-inlay" aria-hidden>
              <span className="block h-full rounded-full bg-success" style={{ width: `${row.invited ? (row.answered / row.invited) * 100 : 0}%` }} />
            </div>
            <span className="type-meta tabular-nums text-muted-foreground">{t("ofAnswered", { answered: row.answered, invited: row.invited })}</span>
          </div>
        </div>
      </Link>
    </li>
  );
}

// ── Praise ─────────────────────────────────────────────────────────────────────

const PRAISE_FILTERS: readonly { value: PraiseScope }[] = [{ value: "all" }, { value: "forMe" }, { value: "byMe" }];

function PraiseTab({
  employeeId,
  scope,
  onScope,
  onOpen,
  onGive,
}: {
  employeeId: string | null;
  scope: PraiseScope;
  onScope: (scope: PraiseScope) => void;
  onOpen: (id: string) => void;
  onGive: (value?: string) => void;
}) {
  const t = useTranslations("conversations.PraiseTab");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const summary = usePraiseSummary();
  const forMe = summary.data?.received ?? 0;
  return (
    <div className="space-y-6">
      <GivePraiseBar onGive={onGive} />
      <PlanDocument
        main={
          <section aria-label={t("praise")}>
            {/* No chip is on while a person's praise is shown; picking one goes back to a scope. */}
            <FilterChips
              type="single"
              clearable
              className="mb-4"
              label={t("showPraise")}
              value={employeeId ? null : scope}
              onChange={(next) => {
                if (!next) return;
                setCursors([null]);
                onScope(next);
              }}
              options={PRAISE_FILTERS.map((filter) => ({
                value: filter.value,
                label: t(`filters.${filter.value}`),
                count: filter.value === "forMe" && forMe > 0 ? forMe : undefined,
              }))}
            />
            <div className="space-y-3">
              {cursors.map((before, index) => (
                <PraisePage
                  key={`${scope}:${employeeId}:${before ?? "first"}`}
                  query={{ scope: employeeId ? undefined : scope, employeeId, before, limit: 20 }}
                  first={index === 0}
                  onOpen={onOpen}
                  onGive={onGive}
                  onMore={index === cursors.length - 1 ? (next) => setCursors((current) => [...current, next]) : undefined}
                />
              ))}
            </div>
          </section>
        }
        sidebar={summary.data ? <PraiseSidebar summary={summary.data} /> : undefined}
      />
    </div>
  );
}

/** Giving praise is one line away: start blank, or from a value. */
function GivePraiseBar({ onGive }: { onGive: (value?: string) => void }) {
  const t = useTranslations("conversations.GivePraiseBar");
  const { user } = useAuth();
  const values = useCompanyValues();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-surface bg-card py-3 pe-3 ps-4">
      <PersonInitials name={user?.fullName} />
      <button type="button" onClick={() => onGive()} className="min-w-40 flex-1 text-start type-body text-muted-foreground hover:text-foreground">
        {t("praiseAColleagueFor")}
      </button>
      <div className="hidden flex-wrap gap-1.5 lg:flex">
        {(values.data ?? []).slice(0, 3).map((v) => (
          <button key={v.id} type="button" onClick={() => onGive(v.id)} aria-label={t("praiseSomeoneFor", { name: v.name })} className="rounded-control-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ValueChip value={v} className="cursor-pointer" />
          </button>
        ))}
      </div>
      <Button onClick={() => onGive()}>
        <Star className="size-4" data-icon="inline-start" /> {t("givePraise")}
      </Button>
    </div>
  );
}

function PraiseSidebar({ summary }: { summary: PraiseSummaryDto }) {
  const t = useTranslations("conversations.PraiseSidebar");
  const toneOf = useValueTones();
  // Each value's share of the window's praise, so three values praised once each read as thirds, not three full bars.
  const total = summary.values.reduce((sum, value) => sum + value.count, 0);
  return (
    <>
      {summary.values.length > 0 ? (
        <SidebarSection label={t("whatWeCelebrateLastDays", { windowDays: summary.windowDays })}>
          <ul className="mt-4 space-y-3.5">
            {summary.values.slice(0, 6).map((value) => (
              <li key={value.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate type-body text-foreground">{value.name}</span>
                  <span className="type-meta tabular-nums text-muted-foreground">{value.count}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-inlay" aria-hidden>
                  <span className={cn("block h-full rounded-full", VALUE_TONE[toneOf(value.id)].fill)} style={{ width: `${total ? (value.count / total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </SidebarSection>
      ) : null}
      <SidebarSection label={t("yourPraise")}>
        <div className="mt-3.5 flex gap-8">
          <div>
            <p className="type-metric text-foreground">{summary.received}</p>
            <p className="type-meta text-muted-foreground">{t("received")}</p>
          </div>
          <div>
            <p className="type-metric text-foreground">{summary.given}</p>
            <p className="type-meta text-muted-foreground">{t("given")}</p>
          </div>
        </div>
      </SidebarSection>
    </>
  );
}

function PraisePage({
  query,
  first,
  onOpen,
  onGive,
  onMore,
}: {
  query: { scope?: PraiseScope; employeeId: string | null; before: string | null; limit: number };
  first: boolean;
  onOpen: (id: string) => void;
  onGive: (value?: string) => void;
  onMore?: (next: string) => void;
}) {
  const t = useTranslations("conversations.PraisePage");
  const page = usePraisePage(query);
  useLanding("praise", first && Boolean(page.data), onOpen);
  const react = useReactToPraise();
  if (page.error) return <ContentUnavailable error={page.error} onRetry={page.refetch} subject={t("praise")} />;
  if (!page.data) return <FeedSkeleton />;
  const everyone = !query.employeeId && (query.scope ?? "all") === "all";
  return (
    <>
      <PraiseList
        wall
        reading
        items={page.data.items}
        reactionIcons={REACTION_ICONS}
        onReact={(praise, kind, add) => react.mutate({ praiseId: praise.id, kind, add })}
        onOpen={(praise) => onOpen(praise.id)}
        empty={
          first ? (
            everyone ? (
              <div className="flex flex-col items-center gap-3 rounded-surface border border-dashed border-border px-6 py-12 text-center">
                <span className="grid size-11 place-items-center rounded-control border border-border bg-inlay text-muted-foreground" aria-hidden><Star className="size-5" /></span>
                <p className="type-label text-foreground">{t("noPraiseYet")}</p>
                <Button size="sm" onClick={() => onGive()}>{t("giveTheFirst")}</Button>
              </div>
            ) : (
              <EmptyLine text={query.scope === "forMe" ? t("noPraiseForYouYet") : t("youHaventGivenPraiseYet")} />
            )
          ) : null
        }
      />
      {page.data.next && onMore ? <Button variant="ghost" size="sm" onClick={() => onMore(page.data!.next!)}>{t("showOlder")}</Button> : null}
    </>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-32 w-full rounded-surface" />
      <Skeleton className="h-32 w-full rounded-surface" />
    </div>
  );
}

