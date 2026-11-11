"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { newClientId, type DirectoryPersonDto, type FeedbackRequestRowDto, type PraiseDto, type PraiseReactionKind, type PraiseSummaryDto } from "@repo/api";
import { useReactToPraise } from "@repo/api/query";
import { Button } from "@repo/ds/components/ui/button";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton, Bar, Said } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { PersonInitials, usePerformanceWords } from "@repo/performance-ui";
import { Search, Sparkles } from "@repo/ds/icons";
import { PRAISE_REACTIONS, PRAISE_REACTION_LABEL } from "@repo/api";
import { useCompanyValues, useDeletePraise, useGivePraise, useNearPeople, usePraisePage } from "../../api/use-conversations";
import { useLanding } from "@/lib/use-landing";
import { ContentUnavailable } from "../content-unavailable";
import { ColleaguePicker, type PickedColleague } from "./colleague-picker";
import { firstName } from "./conversation-parts";
import { REACTION_ICONS } from "./reaction-icons";

const PRAISE_MAX = 500;
const MAX_RECIPIENTS = 10;
const CARD = "rounded-surface bg-card px-6 py-[22px]";

type Person = Pick<PickedColleague, "employeeId" | "displayName">;

/**
 * The Praise tab as drawn (D-36, D-66): the composer on top, the company's week of praise as a wall with reactions,
 * earlier praise below it; beside them the values given this month and what's asked of you. A company with no praise
 * yet sees the wall as ghosts and its starter values, so the first praise needs no setup.
 */
export function PraiseWall({
  summary,
  companyName,
  asked,
  to,
  onOpen,
}: {
  summary: PraiseSummaryDto | undefined;
  companyName: string | null;
  /** Requests waiting on the viewer, newest first. */
  asked: FeedbackRequestRowDto[] | undefined;
  /** Someone to praise, from `?compose=praise&to=` (the top bar search, Team). */
  to?: Person;
  onOpen: (praiseId: string) => void;
}) {
  const t = useTranslations("conversations.PraiseWall");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const first = usePraisePage({ scope: "all", before: null, limit: 20 });
  const none = first.data?.items.length === 0;

  return (
    <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 gap-4">
        <Composer starter={none} to={to} />
        {first.error ? (
          <ContentUnavailable error={first.error} onRetry={first.refetch} />
        ) : !first.data || !summary ? (
          <Ghosts />
        ) : none ? (
          <>
            <WallHeading title={t("thisWeekAt", { company: companyName ?? t("yourCompany") })} meta={t("noPraiseYet")} />
            <Ghosts />
          </>
        ) : (
          <div className="grid gap-4">
            {cursors.map((before, index) => (
              <WallPage
                key={before ?? "first"}
                before={before}
                weekStart={summary.weekStart}
                heading={index === 0 ? { title: t("thisWeekAt", { company: companyName ?? t("yourCompany") }), thisWeek: summary.thisWeek } : null}
                onOpen={onOpen}
                onMore={index === cursors.length - 1 ? (next) => setCursors((current) => [...current, next]) : undefined}
              />
            ))}
          </div>
        )}
      </div>
      <aside className="grid gap-3.5">
        <ValuesThisMonth summary={summary} empty={none} />
        <AskedOfYou asked={asked} />
      </aside>
    </div>
  );
}

function WallHeading({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="type-section text-foreground">{title}</h2>
      <span className="ms-auto type-meta text-muted-foreground">{meta}</span>
    </div>
  );
}

/** One page of the wall: this week's praise under the heading, anything older under "Earlier". */
function WallPage({
  before,
  weekStart,
  heading,
  onOpen,
  onMore,
}: {
  before: string | null;
  weekStart: string;
  heading: { title: string; thisWeek: number } | null;
  onOpen: (id: string) => void;
  onMore?: (next: string) => void;
}) {
  const t = useTranslations("conversations.PraiseWall");
  const page = usePraisePage({ scope: "all", before, limit: 20 });
  useLanding("praise", heading !== null && Boolean(page.data), onOpen);
  if (page.error) return <ContentUnavailable error={page.error} onRetry={page.refetch} />;
  if (!page.data) return <Ghosts />;
  const week = page.data.items.filter((p) => p.givenAt.slice(0, 10) >= weekStart);
  const earlier = page.data.items.filter((p) => p.givenAt.slice(0, 10) < weekStart);
  return (
    <>
      {heading ? (
        <WallHeading title={heading.title} meta={heading.thisWeek > 0 ? t("countThisWeek", { count: heading.thisWeek }) : t("quietWeek")} />
      ) : null}
      {week.length > 0 ? <Wall items={week} onOpen={onOpen} /> : null}
      {earlier.length > 0 ? (
        <>
          {heading || week.length > 0 ? <h3 className="type-label text-muted-foreground">{t("earlier")}</h3> : null}
          <Wall items={earlier} onOpen={onOpen} />
        </>
      ) : null}
      {page.data.next && onMore ? (
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => onMore(page.data!.next!)}>{t("showOlder")}</Button>
      ) : null}
    </>
  );
}

function Wall({ items, onOpen }: { items: PraiseDto[]; onOpen: (id: string) => void }) {
  return (
    <ul className="gap-3 sm:columns-2 [&>li]:mb-3 [&>li]:break-inside-avoid">
      {items.map((praise) => (
        <li key={praise.id}>
          <WallCard praise={praise} onOpen={() => onOpen(praise.id)} />
        </li>
      ))}
    </ul>
  );
}

/** One praise on the wall: who gave it to whom and when, their words, the value, the reactions. */
function WallCard({ praise, onOpen }: { praise: PraiseDto; onOpen: () => void }) {
  const t = useTranslations("conversations.PraiseWall");
  const words = usePerformanceWords();
  const react = useReactToPraise();
  const author = praise.author.name ?? t("aColleague");
  const recipients = words.joinNames(praise.recipients.map((r) => firstName(r.name)));
  const recent = Date.now() - new Date(praise.givenAt).getTime() < 60_000;
  return (
    <article
      id={`praise-${praise.id}`}
      className="group/praise grid scroll-mt-24 gap-2.5 rounded-surface bg-card px-5 py-[18px]"
      aria-label={t("praised", { author, recipients })}
    >
      <div className="flex items-center gap-2.5">
        <PersonInitials name={author} size="sm" />
        <p className="min-w-0 type-meta text-muted-foreground">
          <b className="font-semibold text-foreground">{firstName(author)}</b> {t("to")} <b className="font-semibold text-foreground">{recipients}</b>
        </p>
        <time dateTime={praise.givenAt} className="ms-auto shrink-0 type-meta text-muted-foreground">
          {recent ? t("justNow") : words.praiseTime(praise.givenAt)}
        </time>
      </div>
      <button type="button" onClick={onOpen} className="rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Said as="span" className="line-clamp-5 block">{praise.message}</Said>
      </button>
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate type-meta font-semibold text-primary-ink">{praise.value.name}</span>
        <Reactions praise={praise} pending={react.isLoading} onReact={(kind, add) => react.mutate({ praiseId: praise.id, kind, add })} />
      </div>
    </article>
  );
}

/**
 * The reactions people used, with their counts; the others wait on hover or focus, so a quiet card stays quiet. A card
 * nobody reacted to yet offers the applause.
 */
function Reactions({ praise, pending, onReact }: { praise: PraiseDto; pending: boolean; onReact: (kind: PraiseReactionKind, add: boolean) => void }) {
  const t = useTranslations("conversations.PraiseWall");
  const byKind = new Map(praise.reactions.map((r) => [r.kind, r]));
  const used = PRAISE_REACTIONS.filter((kind) => (byKind.get(kind)?.count ?? 0) > 0);
  return (
    <div className="ms-auto flex flex-wrap justify-end gap-1" role="group" aria-label={t("reactions")}>
      {PRAISE_REACTIONS.map((kind) => {
        const reaction = byKind.get(kind) ?? { kind, count: 0, mine: false };
        const shown = reaction.count > 0 || (used.length === 0 && kind === "Applause");
        return (
          <button
            key={kind}
            type="button"
            // eslint-disable-next-line no-restricted-syntax -- a reaction is one toggle: you reacted or you did not
            aria-pressed={reaction.mine}
            aria-label={reaction.count > 0 ? `${PRAISE_REACTION_LABEL[kind]}, ${reaction.count}` : PRAISE_REACTION_LABEL[kind]}
            title={PRAISE_REACTION_LABEL[kind]}
            disabled={pending}
            onClick={() => onReact(kind, !reaction.mine)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full bg-inlay px-2.5 type-meta text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[15px]",
              reaction.mine && "text-primary-ink ring-1 ring-inset ring-primary-ring",
              !shown && "hidden group-hover/praise:inline-flex group-focus-within/praise:inline-flex",
            )}
          >
            <span aria-hidden className="flex">{REACTION_ICONS[kind]}</span>
            {reaction.count > 0 ? <span className="tabular-nums">{reaction.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The wall before there is praise: four outlines with a face and lines, never an empty box. */
function Ghosts() {
  return (
    <ul aria-hidden className="gap-3 sm:columns-2 [&>li]:mb-3 [&>li]:break-inside-avoid">
      {[40, 52, 34, 46].map((width, index) => (
        <li key={index} className="grid gap-2.5 rounded-surface px-5 py-[18px] ring-[1.5px] ring-inset ring-border">
          <span className="flex items-center gap-2.5">
            <span className="size-7 rounded-full bg-inlay" />
            <span className="h-2.5 rounded-full bg-inlay" style={{ width: `${width}%` }} />
          </span>
          <span className="h-2.5 w-[92%] rounded-full bg-inlay" />
          <span className="h-2.5 rounded-full bg-inlay" style={{ width: `${[60, 74, 48, 66][index]}%` }} />
        </li>
      ))}
    </ul>
  );
}

/** Praise someone: the people you work with one tap away, anyone else by search, a value, their words. */
function Composer({ starter, to }: { starter: boolean; to?: Person }) {
  const t = useTranslations("conversations.PraiseWall");
  const near = useNearPeople();
  const values = useCompanyValues();
  const give = useGivePraise();
  const remove = useDeletePraise();
  const [id, setId] = useState(newClientId);
  const [extra, setExtra] = useState<Person[]>(to ? [to] : []);
  const [chosen, setChosen] = useState<string[]>(to ? [to.employeeId] : []);
  const [value, setValue] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);

  const people: Person[] = [
    ...(near.data ?? []).map((p: DirectoryPersonDto) => ({ employeeId: p.employeeId, displayName: p.displayName })),
    ...extra.filter((p) => !(near.data ?? []).some((n) => n.employeeId === p.employeeId)),
  ];
  const picked = people.filter((p) => chosen.includes(p.employeeId));
  const toggle = (employeeId: string) =>
    setChosen((current) => (current.includes(employeeId) ? current.filter((c) => c !== employeeId) : current.length < MAX_RECIPIENTS ? [...current, employeeId] : current));
  const ready = picked.length > 0 && value !== null && message.trim().length > 0;
  const name = picked.length === 1 ? firstName(picked[0]!.displayName) : null;

  const send = async () => {
    if (!value) return;
    const sent = await give.mutateAsync({ id, recipientEmployeeIds: picked.map((p) => p.employeeId), valueId: value, message: message.trim() }).catch(() => null);
    if (!sent) return;
    const names = picked.map((p) => firstName(p.displayName)).join(", ");
    setMessage("");
    setChosen([]);
    setId(newClientId());
    toast.success(t("sentTo", { names }), {
      action: { label: t("undo"), onClick: () => void remove.mutateAsync(sent.id).catch(() => toast.error(t("couldNotUndo"))) },
    });
  };

  return (
    <section className={cn(CARD, "grid gap-3.5")} aria-labelledby="praise-someone">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="praise-someone" className="type-section text-foreground">{t("praiseSomeone")}</h2>
        {starter ? (
          <span className="ms-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            {t("starterValues")}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("who")}>
        {people.map((person) => {
          const on = chosen.includes(person.employeeId);
          return (
            <button
              key={person.employeeId}
              type="button"
              // eslint-disable-next-line no-restricted-syntax -- several people can be praised at once; each face is its own toggle
              aria-pressed={on}
              onClick={() => toggle(person.employeeId)}
              className={cn(
                "inline-flex items-center gap-[7px] rounded-full bg-inlay py-[3px] pe-3 ps-[3px] type-label text-foreground transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on && "ring-[1.5px] ring-inset ring-primary",
              )}
            >
              <PersonInitials name={person.displayName} size="xs" />
              {firstName(person.displayName)}
            </button>
          );
        })}
        {searching ? (
          <div className="w-64">
            <ColleaguePicker
              value={null}
              exclude={people.map((p) => p.employeeId)}
              placeholder={t("searchAnyone")}
              onChange={(person) => {
                setExtra((current) => [...current, person]);
                setChosen((current) => (current.length < MAX_RECIPIENTS ? [...current, person.employeeId] : current));
                setSearching(false);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-inlay px-3 py-[3px] type-label text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="size-[15px]" aria-hidden />
            {t("anyone")}
          </button>
        )}
      </div>
      {/* eslint-disable-next-line no-restricted-syntax -- the company's values as pills, the chosen one in the brand, as drawn */}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("value")}>
        {(values.data ?? []).map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={value === v.id}
            onClick={() => setValue(v.id)}
            className={cn(
              "rounded-full px-[13px] py-1.5 type-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === v.id ? "bg-primary font-semibold text-primary-foreground" : "bg-inlay text-muted-foreground hover:text-foreground",
            )}
          >
            {v.name}
          </button>
        ))}
      </div>
      <Textarea
        voice="narrative"
        aria-label={t("whatTheyDid")}
        placeholder={name ? t("whatDidNameDo", { name }) : t("whatDidTheyDo")}
        className="min-h-24 resize-y"
        maxLength={PRAISE_MAX}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      {give.error ? <p className="type-body text-destructive" role="alert">{give.error.message}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <span className="type-meta text-muted-foreground">
          {name ? t("managerHears", { name }) : picked.length > 1 ? t("managersHear") : t("everyoneSees")}
        </span>
        <AsyncButton className="ms-auto" pending={give.isLoading} disabled={!ready} onClick={send}>
          {t("sendPraise")}
        </AsyncButton>
      </div>
    </section>
  );
}

/** Each value with how often it was named this month; before any praise, the bars wait striped. */
function ValuesThisMonth({ summary, empty }: { summary: PraiseSummaryDto | undefined; empty: boolean }) {
  const t = useTranslations("conversations.PraiseWall");
  const values = summary?.values ?? [];
  const max = Math.max(1, ...values.map((v) => v.count));
  return (
    <section className="grid gap-3 rounded-surface bg-card px-5 py-[18px]">
      <h2 className="type-section text-foreground">{t("valuesThisMonth")}</h2>
      {values.map((v) => (
        <div key={v.id} className="grid grid-cols-[minmax(0,1fr)_30px] items-center gap-x-2.5 gap-y-1">
          <span className="truncate type-meta text-foreground">{v.name}</span>
          <span className="text-end type-meta tabular-nums text-muted-foreground">{empty ? "" : v.count}</span>
          <Bar className="col-span-2" size="sm" value={(v.count / max) * 100} label={v.name} />
        </div>
      ))}
    </section>
  );
}

/** What colleagues asked of the viewer, the newest first, with Answer one click away. */
function AskedOfYou({ asked }: { asked: FeedbackRequestRowDto[] | undefined }) {
  const t = useTranslations("conversations.PraiseWall");
  const words = usePerformanceWords();
  const shown = (asked ?? []).slice(0, 2);
  return (
    <section className="grid gap-2.5 rounded-surface bg-card px-5 py-[18px]">
      <div className="flex items-baseline gap-2">
        <h2 className="type-section text-foreground">{t("askedOfYou")}</h2>
        {(asked?.length ?? 0) > shown.length ? (
          <Link href="/feedback?tab=asked" className="ms-auto type-meta text-muted-foreground hover:text-foreground">{t("seeAll", { count: asked!.length })}</Link>
        ) : null}
      </div>
      {asked && asked.length === 0 ? <p className="type-meta text-muted-foreground">{t("nothingAskedOfYou")}</p> : null}
      {shown.map((row) => (
        <div key={row.id} className="flex items-start gap-2.5">
          <PersonInitials name={row.requester.name} size="sm" />
          <div className="grid min-w-0 gap-1.5">
            <span className="type-meta text-muted-foreground">
              <b className="font-semibold text-foreground">{row.requester.name}</b> {t("askedForYourFeedback")}
            </span>
            <Said className="text-[14.5px]">{row.question}</Said>
            <div className="flex items-center gap-2.5">
              <Button size="sm" asChild>
                <Link href={`/feedback/requests/${row.id}`}>{t("answer")}</Link>
              </Button>
              <span className="type-meta text-muted-foreground">{t("askedOn", { day: words.date(row.requestedAt.slice(0, 10)) })}</span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
