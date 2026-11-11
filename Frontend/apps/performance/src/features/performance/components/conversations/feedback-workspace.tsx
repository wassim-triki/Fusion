"use client";

import { FeedSkeleton } from "@/shell/workspace-skeletons";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FeedbackDto, FeedbackRequestRowDto, FeedbackSummaryDto, FeedbackView } from "@repo/api";
import { useTenantSummary } from "@repo/api/query";
import { Button } from "@repo/ds/components/ui/button";
import { FilterChips } from "@repo/ds/choice";
import { LinkTabs, PageContainer, Section, StatusBadge, Said, type LinkTab } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, PersonInitials, VALUE_TONE, useValueTones } from "@repo/performance-ui";
import { ChevronRight, Clapping, Inbox, MessageSquare, Send, Target } from "@repo/ds/icons";
import { useFeedbackList, useFeedbackRequests, useFeedbackSummary, useOneOnOnes, usePraiseSummary } from "../../api/use-conversations";
import { usePersonSummary } from "../../api/use-performance";

import { formatDay } from "../one-on-ones/one-on-one-lib";
import { ContentUnavailable } from "../content-unavailable";
import { PlanDocument, SidebarSection } from "../plan/plan-layout";
import type { PickedColleague } from "./colleague-picker";
import { FeedbackComposer, RequestComposer, type FixedObjective } from "./composers";
import { ByMonth, DueBlock, SubjectChip, firstName } from "./conversation-parts";
import { FeedbackDrawer, PraiseDrawer, RequestDrawer } from "./drawers";
import { PraiseWall } from "./praise-wall";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useLanding } from "@/lib/use-landing";

type Tab = "praise" | "asked" | "yours";
type View = "received" | "given" | "requests" | "team";

type Composing = { kind: "feedback"; to?: string } | { kind: "request"; objective?: FixedObjective; to?: string } | null;

/**
 * Feedback as drawn (D-36, D-66): Praise · Asked of you · Yours, each in the address so notifications and other
 * modules open the exact place. Praise is the company's wall with the composer on top; Asked of you is what colleagues
 * want from you; Yours is your feedback (received, given, your requests, and your team's for managers). Feedback and
 * praise open in drawers; nothing here follows the cycle.
 */
export function FeedbackWorkspace() {
  const tr = useTranslations("conversations.FeedbackWorkspace");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const feedbackId = params.get("feedback");
  const praiseId = params.get("praise");
  const requested = params.get("tab");
  const tab: Tab = requested === "asked" || requested === "yours" ? requested : "praise";
  // `?give=<employeeId>` opens feedback for that person: the person page's "Give feedback" lands here (B-180).
  const giveTo = params.get("give");
  // `?compose=praise|ask&to=<employeeId>` starts praise or a request for that person: the top bar search lands here (B-211).
  const composeTo = params.get("to") ?? undefined;
  const praiseTo = params.get("compose") === "praise" ? composeTo : undefined;
  const [composing, setComposing] = useState<Composing>(
    giveTo ? { kind: "feedback", to: giveTo } : params.get("compose") === "ask" ? { kind: "request", to: composeTo } : null,
  );
  const tenant = useTenantSummary();
  const summary = useFeedbackSummary();
  const praise = usePraiseSummary();
  const requests = useFeedbackRequests();
  const oneOnOnes = useOneOnOnes();
  const managesPeople = (oneOnOnes.data?.reports.length ?? 0) + (oneOnOnes.data?.startWithReports.length ?? 0) > 0;
  const waiting = requests.data?.toAnswer.filter((r) => r.state === "Open" && r.myStatus === "Waiting");

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
  const tabHref = (value: Tab) => {
    const query = new URLSearchParams();
    if (value !== "praise") query.set("tab", value);
    const text = query.toString();
    return text ? `${pathname}?${text}` : pathname;
  };
  const ask = (objective?: FixedObjective) => setComposing({ kind: "request", objective });
  const tabs: LinkTab[] = [
    { key: "praise", label: tr("tabs.praise"), href: tabHref("praise"), icon: Clapping },
    { key: "asked", label: tr("tabs.asked"), href: tabHref("asked"), icon: Inbox, count: waiting?.length || undefined },
    { key: "yours", label: tr("tabs.yours"), href: tabHref("yours"), icon: MessageSquare },
  ];

  return (
    <PageContainer width="wide">
      <div className="mx-auto grid max-w-[1120px] gap-[18px]">
        <header className="flex flex-wrap items-end gap-3 pt-2">
          <div className="grid gap-2.5">
            <h1 className="type-display text-foreground">{tr("feedback")}</h1>
            <LinkTabs label={tr("feedback")} tabs={tabs} current={tab} />
          </div>
          {tab !== "praise" ? (
            <div className="ms-auto flex items-center gap-2">
              <Button variant="outline" onClick={() => ask()}>{tr("askForFeedback")}</Button>
              <Button onClick={() => setComposing({ kind: "feedback" })}>
                <Send className="size-4" data-icon="inline-start" /> {tr("giveFeedback")}
              </Button>
            </div>
          ) : null}
        </header>
        {tab === "praise" ? (
          <PraiseTo employeeId={praiseTo}>
            {(to) => (
              <PraiseWall summary={praise.data} companyName={tenant.data?.name ?? null} asked={waiting} to={to} onOpen={(id) => update({ praise: id })} />
            )}
          </PraiseTo>
        ) : tab === "asked" ? (
          <AskedTab />
        ) : (
          <YoursTab
            view={(["given", "requests", "team"] as const).find((v) => v === params.get("view") && (v !== "team" || managesPeople)) ?? "received"}
            managesPeople={managesPeople}
            summary={summary.data}
            onView={(view) => update({ view: view === "received" ? null : view, feedback: null })}
            onOpen={(id) => update({ feedback: id })}
            onAsk={ask}
          />
        )}
      </div>
      <FeedbackDrawer feedbackId={feedbackId} onClose={() => update({ feedback: null })} />
      <PraiseDrawer praiseId={praiseId} onClose={() => update({ praise: null })} />
      {composing?.kind === "feedback" ? (
        composing.to ? (
          <FeedbackTo employeeId={composing.to} onClose={() => setComposing(null)} />
        ) : (
          <FeedbackComposer onClose={() => setComposing(null)} />
        )
      ) : null}
      {composing?.kind === "request" ? (
        <ComposeFor employeeId={composing.to}>
          {(people) => (
            <RequestComposer objective={composing.objective} people={people} onClose={() => setComposing(null)} onSent={(id) => router.push(`/feedback/requests/${id}`)} />
          )}
        </ComposeFor>
      ) : null}
    </PageContainer>
  );
}

/** Praise started for one named person waits for their name, then opens the composer with them chosen. */
function PraiseTo({ employeeId, children }: { employeeId?: string; children: (to: PickedColleague | undefined) => ReactNode }) {
  return <ComposeFor employeeId={employeeId}>{(people) => children(people?.[0])}</ComposeFor>;
}

const VIEWS: readonly View[] = ["received", "given", "requests"];

/** Your own feedback: what you received (with the year at a glance), what you gave, your requests, your team's. */
function YoursTab({
  view,
  managesPeople,
  summary,
  onView,
  onOpen,
  onAsk,
}: {
  view: View;
  managesPeople: boolean;
  summary: FeedbackSummaryDto | undefined;
  onView: (view: View) => void;
  onOpen: (id: string) => void;
  onAsk: (objective?: FixedObjective) => void;
}) {
  const tr = useTranslations("conversations.FeedbackWorkspace");
  const views = managesPeople ? [...VIEWS, "team" as const] : VIEWS;
  return (
    <div className="grid gap-4">
      <FilterChips
        type="single"
        label={tr("show")}
        value={view}
        onChange={(next) => { if (next) onView(next); }}
        options={views.map((value) => ({ value, label: tr(`views.${value}`) }))}
      />
      {view === "received" ? (
        <ReceivedTab summary={summary} onOpen={onOpen} onAsk={onAsk} />
      ) : view === "team" ? (
        <FeedbackFeed view="team" onOpen={onOpen} empty={<EmptyLine text={tr("noFeedbackAboutYourTeam")} />} />
      ) : view === "given" ? (
        <FeedbackFeed view="given" onOpen={onOpen} empty={<EmptyLine text={tr("youHaventGivenFeedbackYet")} />} />
      ) : (
        <YourRequestsView />
      )}
    </div>
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
}: {
  summary: FeedbackSummaryDto | undefined;
  onOpen: (id: string) => void;
  onAsk: (objective?: FixedObjective) => void;
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
      <Button writes size="sm" onClick={() => onAsk({ cycleId: askFirst.cycleId, objectiveId: askFirst.objectiveId, title: askFirst.title })}>
        {t("askForFeedback")}
      </Button>
    </div>
  ) : (
    <EmptyLine text={t("noFeedbackYet")} action={<Button size="sm" variant="outline" onClick={() => onAsk()}>{t("askForFeedback")}</Button>} />
  );

  return (
    <div className="space-y-6">
      {summary && summary.received > 0 ? <ReceivedBand summary={summary} /> : null}
      <PlanDocument
        main={<FeedbackFeed view="received" onOpen={onOpen} empty={empty} />}
        sidebar={summary && (summary.received > 0 || summary.given > 0) ? <ReceivedSidebar summary={summary} onAsk={onAsk} /> : undefined}
      />
    </div>
  );
}

/** The year in feedback at a glance: how much, from whom, about what, and what's waiting on you. */
function ReceivedBand({ summary }: { summary: FeedbackSummaryDto }) {
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
        <Link href="/feedback?tab=asked" className="group flex items-center gap-3 rounded-control bg-inlay px-4 py-3 text-start hover:bg-inlay/70">
          <span className="grid size-9 place-items-center rounded-control border border-primary-ring bg-primary-tint text-primary-ink" aria-hidden>
            <MessageSquare className="size-4" />
          </span>
          <span>
            <span className="block type-label text-foreground">{t("toAnswer", { toAnswer: summary.toAnswer })}</span>
            <span className="block type-meta text-muted-foreground">{t("requestsWaitingOnYou")}</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </Link>
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
                <Button writes size="sm" variant="outline" onClick={() => onAsk({ cycleId: objective.cycleId, objectiveId: objective.objectiveId, title: objective.title })}>
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
  if (page.error) return <ContentUnavailable error={page.error} onRetry={page.refetch} />;
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
        <Said as="span" className="line-clamp-4">{feedback.message}</Said>
        {subject ? <SubjectChip subject={subject} className="sm:hidden" /> : null}
        {feedback.requestQuestion ? (
          <span className="block truncate type-meta text-muted-foreground">{t("answerTo", { requestQuestion: feedback.requestQuestion })}</span>
        ) : null}
      </button>
    </li>
  );
}

// ── Requests ───────────────────────────────────────────────────────────────────

/** What colleagues asked of you: waiting first, with Answer; what you already answered, declined or saw closed below. */
function AskedTab() {
  const t = useTranslations("conversations.RequestsTab");
  const requests = useFeedbackRequests();
  if (requests.error) return <ContentUnavailable error={requests.error} onRetry={requests.refetch} />;
  if (!requests.data) return <FeedSkeleton />;
  const waiting = requests.data.toAnswer.filter((r) => r.state === "Open" && r.myStatus === "Waiting");
  const done = requests.data.toAnswer.filter((r) => !(r.state === "Open" && r.myStatus === "Waiting"));
  return (
    <div className="grid max-w-4xl gap-5">
      <Section id="asked-of-you" title={t("askedOfYou")} meta={waiting.length || undefined} flush={waiting.length > 0}>
        {waiting.length === 0 ? (
          <p className="type-body-secondary text-muted-foreground">{t("nothingAskedOfYou")}</p>
        ) : (
          <ul className="divide-y divide-border">{waiting.map((row) => <AskedOfYou key={row.id} row={row} />)}</ul>
        )}
      </Section>
      {done.length > 0 ? (
        <Section id="answered-requests" title={t("earlier")} meta={done.length} flush>
          <ul className="divide-y divide-border">
            {done.map((row) => (
              <li key={row.id}>
                <Link href={`/feedback/requests/${row.id}`} className={cn(LIST_ROW, "flex w-full items-center gap-3 text-start")}>
                  <span className="min-w-0 flex-1 truncate type-body text-foreground">
                    <span className="text-muted-foreground">{t("asked", { name: firstName(row.requester.name) })} </span>
                    {row.question}
                  </span>
                  <span className="shrink-0 type-meta text-muted-foreground">
                    {row.myStatus === "Answered" ? t("answered") : row.myStatus === "Declined" ? t("declined") : t("closed")}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground rtl:-scale-x-100" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

/** Your requests: the open ones with who answered, then the closed ones; each opens beside the list. */
function YourRequestsView() {
  const t = useTranslations("conversations.RequestsTab");
  const requests = useFeedbackRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  if (requests.error) return <ContentUnavailable error={requests.error} onRetry={requests.refetch} />;
  if (!requests.data) return <FeedSkeleton />;
  const open = requests.data.mine.filter((r) => r.state === "Open");
  const closed = requests.data.mine.filter((r) => r.state !== "Open");
  return (
    <div className="grid max-w-4xl gap-5">
      <Section id="your-requests" title={t("openRequests")} meta={open.length || undefined} flush={open.length > 0}>
        {open.length === 0 ? (
          <p className="type-body-secondary text-muted-foreground">{t("noOpenRequests")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {open.map((row) => <YourRequest key={row.id} row={row} active={openId === row.id} onOpen={() => setOpenId(row.id)} />)}
          </ul>
        )}
      </Section>
      {closed.length > 0 ? (
        <Section id="closed-requests" title={t("closed")} meta={closed.length} flush>
          <ul className="divide-y divide-border">
            {closed.map((row) => (
              <li key={row.id}>
                {/* eslint-disable-next-line no-restricted-syntax -- the row opens this request in the side panel; pressed marks the one open */}
                <button type="button" aria-pressed={openId === row.id} onClick={() => setOpenId(row.id)}
                  className={cn(LIST_ROW, "flex w-full items-center gap-3 text-start", openId === row.id && LIST_ROW_ACTIVE)}>
                  <span className="min-w-0 flex-1 truncate type-body text-foreground">{row.question}</span>
                  <span className="shrink-0 type-meta tabular-nums text-muted-foreground">
                    {row.answered === 1 ? t("answer", { answered: row.answered }) : t("answers", { answered: row.answered })}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground rtl:-scale-x-100" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <RequestDrawer requestId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** A list row inside a section: edge to edge, a quiet hover, focus kept inside the frame. */
const LIST_ROW = "group px-5 py-3.5 transition-colors hover:bg-inlay/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
/** The row whose detail is open beside the list. */
const LIST_ROW_ACTIVE = "bg-inlay/50 ring-1 ring-inset ring-primary-ring";

/** A question asked of you: who asked and when, the question in their words, the clock, and Answer. */
function AskedOfYou({ row }: { row: FeedbackRequestRowDto }) {
  const format = useFormat();
  const t = useTranslations("conversations.AskedOfYou");
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:flex-nowrap">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex items-center gap-2 type-meta text-muted-foreground">
          <PersonInitials name={row.requester.name} size="xs" />
          <span><span className="type-label text-foreground">{row.requester.name}</span> {t("askedYou", { requestedAt: formatDay(row.requestedAt, format.locale) })}</span>
        </p>
        <Said>{row.question}</Said>
        {row.subject ? <SubjectChip subject={row.subject} /> : null}
      </div>
      <DueBlock date={row.dueDate} overdue={row.overdue} />
      <Button asChild>
        <Link href={`/feedback/requests/${row.id}`}>{t("answer")}</Link>
      </Button>
    </li>
  );
}

/** One of your open requests as a row: what you asked and by when, who was asked and how many answered. It opens beside the list. */
function YourRequest({ row, active, onOpen }: { row: FeedbackRequestRowDto; active: boolean; onOpen: () => void }) {
  const format = useFormat();
  const t = useTranslations("conversations.YourRequest");
  const invitees = row.invitees ?? [];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        // eslint-disable-next-line no-restricted-syntax -- the row opens this request in the side panel; pressed marks the one open
        aria-pressed={active}
        className={cn(LIST_ROW, "grid w-full gap-3 text-start md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8", active && LIST_ROW_ACTIVE)}
      >
        <span className="min-w-0 space-y-1">
          <span className="block type-label text-foreground">{row.question}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("type-meta tabular-nums", row.overdue ? "text-destructive" : "text-muted-foreground")}>
              {row.overdue ? t("overdue") : t("due")} {format.date(row.dueDate)}
            </span>
            {row.subject ? <SubjectChip subject={row.subject} /> : null}
          </span>
        </span>
        <span className="flex items-center gap-3">
          {invitees.length > 0 ? <AvatarStack names={invitees.map((i) => i.person.name)} size="sm" max={4} /> : null}
          <span className="type-meta tabular-nums text-muted-foreground">{t("ofAnswered", { answered: row.answered, invited: row.invited })}</span>
          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground rtl:-scale-x-100" aria-hidden />
        </span>
      </button>
    </li>
  );
}

/** A composer started for one person: waits for their name, then opens with them chosen. */
function ComposeFor({ employeeId, children }: { employeeId?: string; children: (people: PickedColleague[] | undefined) => ReactNode }) {
  const person = usePersonSummary(employeeId ?? "", null, Boolean(employeeId));
  if (!employeeId) return <>{children(undefined)}</>;
  if (person.isLoading && !person.data) return null;
  const data = person.data;
  return <>{children(data?.displayName ? [{ employeeId: data.employeeId, displayName: data.displayName, subtitle: data.jobTitle }] : undefined)}</>;
}

function FeedbackTo({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const person = usePersonSummary(employeeId);
  if (person.isLoading && !person.data) return null;
  const data = person.data;
  return (
    <FeedbackComposer
      receiver={data?.displayName ? { employeeId: data.employeeId, displayName: data.displayName, subtitle: data.jobTitle } : undefined}
      onClose={onClose}
    />
  );
}
