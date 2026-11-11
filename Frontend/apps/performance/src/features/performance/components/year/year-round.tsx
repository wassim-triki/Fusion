"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { YearMoveDto, YearPersonDto, YearReviewerDto, YearReviewRoundDto } from "@repo/api";
import { cn } from "@repo/ds";
import { Button } from "@repo/ds/components/ui/button";
import { Bell } from "@repo/ds/icons";
import { AsyncButton, StateWord } from "@repo/ds/shell";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { day, firstName } from "./year-words";

/** How many manager rows show before "and N more managers on pace". */
const SHOWN = 6;

/**
 * What opens with the round (D-74), under "The review round opens by itself": a self-review for everyone, three peers
 * asked for each, each manager's reviews drafted from the year, the goals graded from their measures.
 */
export function RoundOpens({ move }: { move: YearMoveDto }) {
  const t = useTranslations("year.Round");
  const locale = useLocale();
  const opens = move.opens!;
  const rows = [
    opens.selfReview ? { key: "everyone" as const, count: opens.people, faces: opens.peopleFaces, text: t("selfReviewDue", { day: day(opens.selfDue!, locale) }) } : null,
    opens.peerInput ? { key: "peers" as const, count: opens.peers, faces: [], text: t("peersAsked") } : null,
    { key: "managers" as const, count: opens.managers, faces: opens.managerFaces, text: t("managersDue", { day: day(opens.managerDue, locale) }) },
    { key: "goals" as const, count: opens.goals, faces: [], text: t("goalsGraded"), mark: t("readOnTheDay") },
  ].filter((row) => row !== null);
  return (
    <>
      <div>
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[140px_64px_minmax(0,1fr)] items-center gap-4 border-t border-border py-2.5 first:border-t-0">
            <b className="text-sm font-semibold text-foreground">{t(`opens.${row.key}`)}</b>
            <span className="text-xl font-semibold tabular-nums text-foreground">{row.count}</span>
            <span className="flex min-w-0 items-center gap-2.5 text-sm text-foreground">
              {row.faces.length ? <AvatarStack names={row.faces} size="sm" max={3} /> : null}
              <span className="truncate">{row.text}</span>
              {row.mark ? <span className="ms-auto shrink-0 text-xs text-muted-foreground">{row.mark}</span> : null}
            </span>
          </div>
        ))}
      </div>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bell aria-hidden className="size-[15px]" />
        {t("oneNotificationEach")}
      </span>
    </>
  );
}

/** The round just opened today: everyone told, nothing for HR to do yet. */
export function RoundOpened({ review }: { review: YearReviewRoundDto }) {
  const t = useTranslations("year.Round");
  return (
    <span className="flex items-center gap-2.5 text-sm text-foreground">
      <Bell aria-hidden className="size-4" />
      {t("toldToday", { count: review.total })}
    </span>
  );
}

/**
 * The round under way, by manager (D-74): furthest behind first, each with what they've written, what's theirs to write
 * and what waits on a self-review, a Nudge each; a row opens on the people in each part.
 */
export function ReviewersBehind({ review, nudged, onNudge, pending }: {
  review: YearReviewRoundDto;
  nudged: ReadonlySet<string>;
  onNudge: (reviewer: YearReviewerDto) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useTranslations("year.Round");
  const [open, setOpen] = useState<string | null>(review.reviewers.find((r) => !r.onPace && r.people <= 12)?.employeeId ?? null);
  const [all, setAll] = useState(false);
  const shown = all ? review.reviewers : review.reviewers.slice(0, Math.max(SHOWN, review.reviewers.filter((r) => !r.onPace).length));
  const more = review.reviewers.length - shown.length;
  return (
    <>
      <div className="grid">
        {shown.map((reviewer) => (
          <ReviewerRow key={reviewer.employeeId} reviewer={reviewer} open={open === reviewer.employeeId} nudged={nudged.has(reviewer.employeeId)}
            pending={pending} onToggle={() => setOpen(open === reviewer.employeeId ? null : reviewer.employeeId)} onNudge={() => onNudge(reviewer)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          <Key tone="bg-success">{t("key.written")}</Key>
          <Key tone="bg-primary">{t("key.toWrite")}</Key>
          <Key tone="bg-muted-foreground/35">{t("key.waiting")}</Key>
        </span>
        {more > 0 ? (
          <button type="button" className="ms-auto text-sm font-medium text-primary-ink hover:underline" onClick={() => setAll(true)}>
            {t("moreOnPace", { count: more })}
          </button>
        ) : null}
      </div>
    </>
  );
}

function Key({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><i aria-hidden className={cn("size-2 rounded-full", tone)} />{children}</span>;
}

function ReviewerRow({ reviewer, open, nudged, pending, onToggle, onNudge }: {
  reviewer: YearReviewerDto;
  open: boolean;
  nudged: boolean;
  pending: boolean;
  onToggle: () => void;
  onNudge: () => Promise<unknown>;
}) {
  const t = useTranslations("year.Round");
  const behind = !reviewer.onPace;
  const name = firstName(reviewer.name);
  const right = behind
    ? nudged
      ? <span className="justify-self-end text-sm text-muted-foreground">{t("nudgedToday")}</span>
      : <AsyncButton size="sm" variant="outline" className="justify-self-end" pending={pending} onClick={(event) => { event.stopPropagation(); void onNudge(); }}>{t("nudge")}</AsyncButton>
    : <span className="justify-self-end"><StateWord tone="ok">{reviewer.written === reviewer.people ? t("allWritten") : t("onPace")}</StateWord></span>;
  const parts: { key: string; label: string; people: YearPersonDto[] }[] = [
    { key: "written", label: t("parts.written"), people: reviewer.writtenPeople },
    { key: "toWrite", label: t("parts.toWrite", { name }), people: reviewer.toWritePeople },
    { key: "waiting", label: t("parts.waiting"), people: reviewer.waitingPeople },
  ];
  return (
    <>
      <div role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onToggle(); } }}
        className="-mx-2 grid cursor-pointer grid-cols-[36px_minmax(0,1.2fr)_minmax(0,1fr)_110px_120px] items-center gap-3.5 rounded-xl border-t border-border px-2 py-2.5 outline-none first:border-t-0 hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring">
        <PersonInitials name={reviewer.name} size="md" />
        <div className="grid min-w-0">
          <b className="truncate text-sm font-semibold text-foreground">{reviewer.name}</b>
          <span className="truncate text-[13px] text-muted-foreground">{[reviewer.unitName, t("people", { count: reviewer.people })].filter(Boolean).join(", ")}</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-inlay" aria-hidden>
          <i className="block bg-success" style={{ flexGrow: reviewer.written }} />
          <i className="block bg-primary" style={{ flexGrow: reviewer.toWrite }} />
          <i className="block bg-muted-foreground/35" style={{ flexGrow: reviewer.waitingOnSelf }} />
        </div>
        <span className="text-sm font-semibold tabular-nums text-foreground">{t("written", { written: reviewer.written, count: reviewer.people })}</span>
        {right}
      </div>
      {open ? (
        <div className="mb-2 grid gap-2 rounded-inset bg-inlay px-3.5 py-3 animate-in fade-in-0 duration-200 sm:grid-cols-3">
          {parts.map((part) => (
            <div key={part.key} className="grid gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">{part.label}</span>
              {part.people.length ? (
                <div className="flex flex-wrap gap-1.5">{part.people.map((person) => <span key={person.employeeId} title={person.name}><PersonInitials name={person.name} size="md" /></span>)}</div>
              ) : <span className="text-sm text-muted-foreground">–</span>}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** "Open it today": launches the drafted round now instead of on its day. */
export function OpenItToday({ pending, onOpen }: { pending: boolean; onOpen: () => Promise<unknown> }) {
  const t = useTranslations("year.Round");
  return (
    <Button variant="outline" disabled={pending} onClick={() => void onOpen()}>
      {t("openItToday")}
    </Button>
  );
}
