"use client";

import { SeriesSkeleton } from "./one-on-one-skeletons";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  newClientId,
  type ObjectiveStatus,
  type OneOnOneActionDto,
  type OneOnOneAgendaItemDto,
  type OneOnOneCadence,
  type OneOnOneMeetingDto,
  type OneOnOnePersonDto,
  type OneOnOneSeriesDto,
  type OneOnOneSuggestionDto,
} from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/ds/components/ui/collapsible";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ds/components/ui/select";
import { AsyncButton, Bar, PageContainer, Said, StateWord, type BarTone } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, PersonInitials } from "@repo/performance-ui";
import { CalendarCheck, Check, ChevronDown, Clapping, MessageSquare, Plus, Send, Sparkles, Target, TriangleAlert, Users } from "@repo/ds/icons";
import { useOneOnOne, useOneOnOneCommands } from "../../api/use-conversations";
import { useLanding } from "@/lib/use-landing";
import { ContentUnavailable } from "../content-unavailable";
import { GoalState } from "../objective-record/goal-state";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import { usePersonSummary } from "../../api/use-performance";
import { appHref, dayMonth, daysBetween, firstName, fullDay } from "../year/year-words";
import { CalendarLink } from "./calendar-link";
import { NotesEditor } from "./notes-editor";
import { CADENCES, TIME_SLOTS, localDate, localTime, toInstant, useAgendaText, useOneOnOneWords } from "./one-on-one-lib";
import { useRecentRecord } from "@repo/api/react";

const BAR: Record<ObjectiveStatus, BarTone> = { OnTrack: "ok", AtRisk: "warn", OffTrack: "bad" };

/** A line on the agenda: an item already on it, or a suggestion from the year that a note puts there (D-66). */
type Entry =
  | { key: string; kind: "item"; item: OneOnOneAgendaItemDto }
  | { key: string; kind: "suggestion"; suggestion: OneOnOneSuggestionDto };

/** Items and suggestions about the same source share a key, so writing on a suggestion keeps its place open. */
const sourceKey = (kind: string, id: string) => `${kind}:${id}`;
const keyOf = (item: OneOnOneAgendaItemDto) =>
  item.sourceKind && item.sourceKind !== "Starter" && item.sourceId ? sourceKey(item.sourceKind, item.sourceId) : item.id;

/** What needs talking about first comes first: goals in trouble, late actions, requests; then what people added; then recognition. */
export function agendaEntries(meeting: OneOnOneMeetingDto): Entry[] {
  const offered = (kinds: string[]) =>
    meeting.suggestions.filter((s) => kinds.includes(s.kind))
      .map((s): Entry => ({ key: sourceKey(s.kind, s.sourceId), kind: "suggestion", suggestion: s }));
  return [
    ...offered(["Objective", "Action", "UpdateRequest"]),
    ...meeting.agenda.map((item): Entry => ({ key: keyOf(item), kind: "item", item })),
    ...offered(["Feedback", "Praise"]),
  ];
}

/**
 * A 1:1 where the meeting is the page (D-66): the agenda from the year, each line saying where it came from; a note on
 * a line marks it talked about and the rest carries to the next meeting (D-64); actions for either person from any
 * line; in both calendars (D-39). Beside it, the report's goals, the actions between the two, and the latest praise.
 */
export function SeriesRecord({ seriesId }: { seriesId: string }) {
  const query = useOneOnOne(seriesId);
  if (query.error) return <ContentUnavailable list="oneOnOnes" error={query.error} onRetry={query.refetch} />;
  if (!query.data) return <SeriesSkeleton />;
  return <MeetingPage series={query.data} />;
}

function MeetingPage({ series }: { series: OneOnOneSeriesDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const w = useOneOnOneWords();
  const commands = useOneOnOneCommands(series.id);
  // A notification about an action assigned to you lands on it.
  useLanding("action", true);
  const [moving, setMoving] = useState(false);
  const isManager = series.viewerRole === "Manager";
  const other = isManager ? series.report : series.manager;
  const me = isManager ? series.manager : series.report;
  useRecentRecord("performance", { label: t("title", { name: firstName(other.displayName) }), kind: "1:1", href: `/performance/one-on-ones/${series.id}` });
  const upcoming = series.upcoming;
  // The meeting just held stays open for notes until the next one; shown only when it had something on it.
  const lastWritable = series.past.find((m) => m.state === "Completed" && m.notesWritable && m.agenda.length > 0) ?? null;

  return (
    <PageContainer width="wide">
      <div className="mx-auto grid max-w-[1120px] gap-5">
        <header className="flex flex-wrap items-end gap-4 pt-2">
          <AvatarStack names={[me.displayName, other.displayName]} size="xl" className={series.ended ? "opacity-80" : undefined} />
          <div className="grid min-w-0 gap-1">
            <h1 className="type-page-title text-foreground">{t("title", { name: firstName(other.displayName) })}</h1>
            <p className="text-muted-foreground">
              {series.ended
                ? t(series.endReason === "PersonInactive" ? "endedLeft" : "endedLine", { day: series.endedAt ? fullDay(series.endedAt, locale) : "" })
                : upcoming
                  ? <MeetingWhen meeting={upcoming} first={series.first} cadence={w.cadence[series.cadence]} />
                  : null}
            </p>
          </div>
          {upcoming && !series.ended ? (
            <div className="ms-auto grid justify-items-end gap-1.5">
              <CalendarLink trigger={
                <button type="button" className="rounded-control hover:underline">
                  <Mark tone="ok" icon={<CalendarCheck className="size-3.5" />}>{t("inBothCalendars")}</Mark>
                </button>
              } />
              {series.can.write ? (
                <button type="button" className="text-sm text-foreground underline-offset-4 hover:underline" onClick={() => setMoving(true)}>
                  {t("moveIt")}
                </button>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-[18px]">
            {upcoming && !series.ended ? (
              <>
                <section className="grid gap-1.5 rounded-surface bg-card px-6 py-[22px]">
                  <div className="mb-1.5 flex items-center gap-3">
                    <h2 className="type-section-title text-foreground">{t("agenda")}</h2>
                    <span className="ms-auto">
                      <Mark icon={<Sparkles className="size-3.5" />}>{series.first ? t("starterAgenda") : t("fromTheYear")}</Mark>
                    </span>
                  </div>
                  <AgendaList series={series} meeting={upcoming} me={me} other={other} writable={series.can.write} />
                  {series.can.write ? (
                    <AddToAgenda
                      onAdd={(text) => commands.addAgendaItem.mutate({ meetingId: upcoming.id, request: { id: newClientId(), text } })}
                      carries={!series.first && series.carriesTo ? dayMonth(series.carriesTo, locale) : null}
                    />
                  ) : null}
                </section>
                <PrivateNote series={series} meeting={upcoming} />
              </>
            ) : null}
            {lastWritable && !series.ended ? (
              <section className="grid gap-1.5 rounded-surface bg-card px-6 py-[22px]">
                <div className="mb-1.5 flex items-center gap-3">
                  <h2 className="type-section-title text-foreground">{t("lastTime", { day: dayMonth(lastWritable.scheduledAt, locale) })}</h2>
                  <span className="ms-auto text-sm text-muted-foreground">{t("stillOpen")}</span>
                </div>
                <AgendaList series={series} meeting={lastWritable} me={me} other={other} writable={series.can.write} />
              </section>
            ) : null}
            <Earlier meetings={series.past.filter((m) => m !== lastWritable || series.ended)} />
          </div>

          <aside className="grid gap-3">
            <GoalsCard series={series} other={other} />
            <GrowthCard series={series} other={other} />
            <ActionsCard series={series} />
            <AboutCard series={series} other={other} />
          </aside>
        </div>
      </div>
      {moving && upcoming ? (
        <MoveDialog
          meeting={upcoming}
          cadence={series.cadence}
          pending={commands.reschedule.isLoading || commands.changeCadence.isLoading}
          onClose={() => setMoving(false)}
          onSave={async (scheduledAt, cadence) => {
            if (cadence !== series.cadence) await commands.changeCadence.mutateAsync({ cadence, expectedVersion: series.version });
            if (scheduledAt !== new Date(upcoming.scheduledAt).toISOString())
              await commands.reschedule.mutateAsync({ meetingId: upcoming.id, scheduledAt, expectedVersion: upcoming.version });
            setMoving(false);
          }}
        />
      ) : null}
    </PageContainer>
  );
}

/** "Today, 10 Nov, 11:00 to 11:30, every two weeks", or a first meeting's day with "your first". */
function MeetingWhen({ meeting, first, cadence }: { meeting: OneOnOneMeetingDto; first: boolean; cadence: string }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + 30 * 60_000);
  const time = (at: Date) => at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const today = new Date();
  const days = daysBetween(localDate(today), localDate(start));
  const day = days === 0 ? t("todayDay", { day: dayMonth(meeting.scheduledAt, locale) })
    : days === 1 ? t("tomorrowDay", { day: dayMonth(meeting.scheduledAt, locale) })
    : fullDay(meeting.scheduledAt, locale);
  return <>{t(first ? "whenFirst" : "when", { day, start: time(start), end: time(end), cadence: cadence.toLowerCase() })}</>;
}

/** A quiet label with its glyph: Fusion saying how something came about. */
function Mark({ icon, children, tone = "muted" }: { icon: ReactNode; children: ReactNode; tone?: "muted" | "ok" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium", tone === "ok" ? "text-success" : "text-muted-foreground")}>
      <span aria-hidden className="shrink-0">{icon}</span>
      {children}
    </span>
  );
}

// ── The agenda ─────────────────────────────────────────────────────────────────

function AgendaList({ series, meeting, me, other, writable }: {
  series: OneOnOneSeriesDto;
  meeting: OneOnOneMeetingDto;
  me: OneOnOnePersonDto;
  other: OneOnOnePersonDto;
  writable: boolean;
}) {
  const t = useTranslations("oneOnOnes.Meeting");
  const entries = agendaEntries(meeting);
  const [open, setOpen] = useState<string | null>(null);
  if (entries.length === 0) return <p className="px-3.5 py-3 text-sm text-muted-foreground">{t("nothingOnIt")}</p>;
  return (
    <div className="grid">
      {entries.map((entry, i) => (
        <AgendaRow
          key={entry.key}
          entry={entry}
          first={i === 0}
          open={open === entry.key}
          onOpen={() => setOpen(open === entry.key ? null : entry.key)}
          series={series}
          meeting={meeting}
          me={me}
          other={other}
          writable={writable && meeting.notesWritable}
        />
      ))}
    </div>
  );
}

function AgendaRow({ entry, first, open, onOpen, series, meeting, me, other, writable }: {
  entry: Entry;
  first: boolean;
  open: boolean;
  onOpen: () => void;
  series: OneOnOneSeriesDto;
  meeting: OneOnOneMeetingDto;
  me: OneOnOnePersonDto;
  other: OneOnOnePersonDto;
  writable: boolean;
}) {
  const t = useTranslations("oneOnOnes.Meeting");
  const commands = useOneOnOneCommands(series.id);
  const item = entry.kind === "item" ? entry.item : null;
  const noted = Boolean(item?.discussed);
  const kind = item ? item.sourceKind : entry.kind === "suggestion" ? entry.suggestion.kind : null;
  const revisionOf = (dto: OneOnOneSeriesDto, key: string) => {
    const saved = [dto.upcoming, ...dto.past].find((m) => m?.id === meeting.id);
    return saved?.agenda.find((i) => keyOf(i) === key)?.noteRevision ?? 0;
  };
  const save = async (text: string, expectedRevision: number) => {
    if (item) return revisionOf(await commands.setAgendaNote.mutateAsync({ meetingId: meeting.id, itemId: item.id, text, expectedRevision }), entry.key);
    if (entry.kind !== "suggestion" || !text.trim()) return 0;
    const s = entry.suggestion;
    return revisionOf(await commands.addAgendaItem.mutateAsync({
      meetingId: meeting.id, request: { id: newClientId(), sourceKind: s.kind, sourceId: s.sourceId, note: text },
    }), entry.key);
  };

  return (
    <div
      className={cn(
        "grid grid-cols-[30px_minmax(0,1fr)_auto] items-start gap-3 px-3.5 py-[13px]",
        open ? "rounded-inset bg-inlay" : "cursor-pointer",
        !first && !open && "border-t border-border",
      )}
      onClick={open ? undefined : onOpen}
    >
      <span aria-hidden className={cn("grid size-[30px] place-items-center rounded-[9px] text-muted-foreground", open ? "bg-card" : "bg-inlay",
        kind === "Objective" && entry.kind === "suggestion" && "text-warning")}>
        <SourceIcon kind={kind} entry={entry} />
      </span>
      <div className="grid min-w-0 gap-[3px]">
        <button type="button" className="text-start text-[14.5px] text-foreground" onClick={open ? onOpen : undefined} aria-expanded={open}>
          <EntryTitle entry={entry} />
        </button>
        <EntrySource entry={entry} series={series} me={me} />
        {open ? (
          <div className="mt-2 grid gap-1.5" onClick={(event) => event.stopPropagation()}>
            <div className="rounded-inset bg-card px-3.5 py-2.5">
              <NotesEditor
                id={`note-${meeting.id}-${entry.key}`}
                label={t("notesBoth")}
                text={item?.note ?? ""}
                revision={item?.noteRevision ?? 0}
                writable={writable}
                reading
                compact
                save={save}
              />
            </div>
            {writable && meeting.state === "Upcoming" ? <ActionFrom series={series} me={me} other={other} /> : null}
          </div>
        ) : null}
      </div>
      {noted ? <Mark tone="ok" icon={<Check className="size-3.5" />}>{t("noted")}</Mark> : <span />}
    </div>
  );
}

function SourceIcon({ kind, entry }: { kind: string | null; entry: Entry }) {
  const icon = "size-4";
  if (kind === "Starter" && entry.kind === "item") {
    const starter = entry.item.text;
    if (starter === "theYearsPlan") return <Target className={icon} />;
    if (starter === "feedbackStyle") return <MessageSquare className={icon} />;
    if (starter === "whatWouldHelp") return <Users className={icon} />;
    return <Sparkles className={icon} />;
  }
  switch (kind) {
    case "Objective": return entry.kind === "suggestion" ? <TriangleAlert className={icon} /> : <Target className={icon} />;
    case "Action": return <Check className={icon} />;
    case "UpdateRequest": return <Send className={icon} />;
    case "Feedback": return <MessageSquare className={icon} />;
    case "Praise": return <Clapping className={icon} />;
    default: return <Plus className={icon} />;
  }
}

function EntryTitle({ entry }: { entry: Entry }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const text = useAgendaText();
  if (entry.kind === "item") return <>{text(entry.item)}</>;
  const s = entry.suggestion;
  if (s.kind === "Objective")
    return <><span className="font-editorial text-[15px]">{s.label}</span> {t(s.status === "OffTrack" ? "isOffTrack" : "isAtRisk")}</>;
  return <>{s.label}</>;
}

/** Where a line came from, in a few words: the source, who, and when. */
function EntrySource({ entry, series, me }: { entry: Entry; series: OneOnOneSeriesDto; me: OneOnOnePersonDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const nameOf = (id: string | null | undefined) => (id === series.manager.employeeId ? series.manager.displayName : id === series.report.employeeId ? series.report.displayName : null);
  const you = (id: string | null | undefined) => id === me.employeeId;
  let by: string | null = null;
  let line: string;
  if (entry.kind === "suggestion") {
    const s = entry.suggestion;
    switch (s.kind) {
      case "Objective":
        line = s.percent !== null ? t("fromGoal", { percent: Math.round(s.percent), day: s.at ? dayMonth(s.at, locale) : "" }) : t("fromGoalNoProgress");
        break;
      case "Action": {
        by = s.by;
        const late = s.dueDate ? daysBetween(s.dueDate, localDate(new Date())) : 0;
        line = t("fromAction", { day: s.at ? dayMonth(s.at, locale) : "", who: you(s.by) ? t("you") : firstName(nameOf(s.by)), late });
        break;
      }
      case "UpdateRequest":
        by = s.by;
        line = you(s.by) ? t("youAsked", { day: s.at ? dayMonth(s.at, locale) : "" }) : t("theyAsked", { name: firstName(nameOf(s.by)), day: s.at ? dayMonth(s.at, locale) : "" });
        break;
      case "Praise":
        line = t("fromPraise", { day: s.at ? dayMonth(s.at, locale) : "" });
        break;
      default:
        line = t("fromFeedback", { day: s.at ? dayMonth(s.at, locale) : "" });
    }
  } else {
    const item = entry.item;
    if (item.sourceKind === "Starter") line = t("starter");
    else if (item.carriedFromAt) line = t("carriedFrom", { day: dayMonth(item.carriedFromAt, locale) });
    else {
      by = item.authorEmployeeId;
      line = you(item.authorEmployeeId) ? t("youAdded") : t("theyAdded", { name: firstName(nameOf(item.authorEmployeeId)) });
    }
  }
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
      {by && nameOf(by) ? <PersonInitials name={nameOf(by)} size="xs" className="size-4 text-[0.5rem]" /> : null}
      {line}
    </span>
  );
}

/** "Action for Aicha" / "Action for you" under an open line: the action is written in place, with an optional day. */
function ActionFrom({ series, me, other }: { series: OneOnOneSeriesDto; me: OneOnOnePersonDto; other: OneOnOnePersonDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const commands = useOneOnOneCommands(series.id);
  const [owner, setOwner] = useState<OneOnOnePersonDto | null>(null);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const add = () => {
    if (!owner || !text.trim()) return;
    commands.addAction.mutate({ id: newClientId(), text: text.trim(), ownerEmployeeId: owner.employeeId, dueDate: due || null });
    setOwner(null);
    setText("");
    setDue("");
  };
  if (!owner) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOwner(other)}>
          <Plus className="size-4" data-icon="inline-start" />{t("actionFor", { name: firstName(other.displayName) })}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOwner(me)}>{t("actionForYou")}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PersonInitials name={owner.displayName} size="xs" />
      <Input
        autoFocus
        aria-label={owner === me ? t("actionForYou") : t("actionFor", { name: firstName(owner.displayName) })}
        placeholder={owner === me ? t("whatYouWillDo") : t("whatTheyWillDo", { name: firstName(owner.displayName) })}
        value={text}
        maxLength={200}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); add(); }
          if (event.key === "Escape") setOwner(null);
        }}
        className="h-8 min-w-48 flex-1"
      />
      <DatePicker value={due} onChange={setDue} min={localDate(new Date())} placeholder={t("byWhen")} className="h-8 w-36" />
      <Button size="sm" onClick={add} disabled={!text.trim()}>{t("add")}</Button>
    </div>
  );
}

function AddToAgenda({ onAdd, carries }: { onAdd: (text: string) => void; carries: string | null }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const [draft, setDraft] = useState("");
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };
  return (
    <div className="flex items-center gap-3 px-3.5 pt-2.5 text-muted-foreground">
      <Plus className="size-4 shrink-0" aria-hidden />
      <Input
        aria-label={t("addToAgenda")}
        placeholder={t("addToAgenda")}
        value={draft}
        maxLength={200}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
        className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {carries ? <Mark icon={<Sparkles className="size-3.5" />}>{t("carriesTo", { day: carries })}</Mark> : null}
    </div>
  );
}

function PrivateNote({ series, meeting }: { series: OneOnOneSeriesDto; meeting: OneOnOneMeetingDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const commands = useOneOnOneCommands(series.id);
  return (
    <section className="grid gap-2 rounded-surface bg-card px-6 py-[22px]">
      <h2 className="type-section-title text-foreground">{t("onlyYou")}</h2>
      <NotesEditor
        id={`private-${meeting.id}`}
        label={t("privateNotes")}
        isPrivate
        compact
        text={meeting.privateNote.text}
        revision={meeting.privateNote.revision}
        writable={meeting.notesWritable && series.can.write}
        save={async (text, expectedRevision) => {
          const saved = await commands.setPrivateNotes.mutateAsync({ meetingId: meeting.id, text, expectedRevision });
          return [saved.upcoming, ...saved.past].find((m) => m?.id === meeting.id)?.privateNote.revision ?? 0;
        }}
      />
    </section>
  );
}

// ── Earlier meetings ───────────────────────────────────────────────────────────

/** Meetings before this one, newest first: what was noted, item by item. */
function Earlier({ meetings }: { meetings: OneOnOneMeetingDto[] }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const text = useAgendaText();
  if (meetings.length === 0) return null;
  return (
    <section className="grid gap-1 rounded-surface bg-card px-6 py-[22px]">
      <h2 className="mb-1.5 type-section-title text-foreground">{t("earlier")}</h2>
      {meetings.map((meeting, i) => {
        const noted = meeting.agenda.filter((item) => item.discussed);
        return (
          <Collapsible key={meeting.id} className={cn(i > 0 && "border-t border-border")}>
            <CollapsibleTrigger
              disabled={meeting.state === "NotHeld" || noted.length === 0}
              className="group flex w-full items-center gap-3 py-3 text-start disabled:cursor-default"
            >
              <span className="w-24 shrink-0 text-sm tabular-nums text-foreground">{dayMonth(meeting.scheduledAt, locale)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {meeting.state === "NotHeld" ? t("notHeld") : noted.length === 0 ? t("nothingNoted") : noted.map((item) => text(item)).join(" · ")}
              </span>
              {noted.length > 0 ? <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden /> : null}
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-3 pb-4 ps-[108px]">
              {noted.map((item) => (
                <div key={item.id} className="grid gap-1">
                  <span className="text-sm font-medium text-foreground">{text(item)}</span>
                  <Said className="text-[14px]">{item.note}</Said>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </section>
  );
}

// ── Beside the meeting ─────────────────────────────────────────────────────────

/** The report's growth goals for the year, each with where it stands, so a 1:1 can talk about them; none, no card. */
function GrowthCard({ series, other }: { series: OneOnOneSeriesDto; other: OneOnOnePersonDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const mine = series.viewerRole === "Report";
  const summary = usePersonSummary(series.report.employeeId);
  const goals = summary.data?.development?.goals ?? [];
  if (goals.length === 0) return null;
  return (
    <section className="grid gap-2.5 rounded-surface bg-card px-5 py-[18px]">
      <h2 className="type-section-title text-foreground">{mine ? t("yourGrowth") : t("theirGrowth", { name: firstName(other.displayName) })}</h2>
      {goals.map((goal, index) => (
        <div key={`${goal.title}-${index}`} className="grid gap-0.5">
          <span className="font-editorial text-[14px] text-foreground">{goal.title}</span>
          <span className="text-sm text-muted-foreground">
            {[t(`growth.${goal.status}`), goal.targetDate && goal.status !== "Done" ? t("growthBy", { day: dayMonth(goal.targetDate, locale) }) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      ))}
    </section>
  );
}

function GoalsCard({ series, other }: { series: OneOnOneSeriesDto; other: OneOnOnePersonDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const record = useObjectiveRecord();
  const context = series.context;
  const mine = series.viewerRole === "Report";
  const title = mine ? t("yourGoals") : t("theirGoals", { name: firstName(other.displayName) });
  const goals = context?.goals ?? [];
  return (
    <section className="grid gap-3 rounded-surface bg-card px-5 py-[18px]">
      <h2 className="type-section-title text-foreground">{title}</h2>
      {goals.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          {context?.planDue ? t("noPlanDue", { day: dayMonth(context.planDue, locale) }) : t("noPlan")}
        </span>
      ) : (
        goals.map((goal) => (
          <button
            key={goal.id}
            type="button"
            className="grid gap-1.5 text-start"
            onClick={() => record.open({ cycleId: goal.cycleId, objectiveId: goal.id })}
          >
            <span className="font-editorial text-[14px] text-foreground hover:underline">{goal.title}</span>
            {context?.planApproved ? (
              <span className="flex items-center gap-2.5">
                {goal.status ? <GoalState status={goal.status} /> : <StateWord tone="muted">{t("noUpdate")}</StateWord>}
                <span className="flex-1"><Bar value={goal.percent ?? 0} tone={goal.status ? BAR[goal.status] : "muted"} size="sm" label={goal.title} /></span>
                <span className="text-sm tabular-nums text-muted-foreground">{Math.round(goal.percent ?? 0)}%</span>
              </span>
            ) : null}
          </button>
        ))
      )}
    </section>
  );
}

function ActionsCard({ series }: { series: OneOnOneSeriesDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const commands = useOneOnOneCommands(series.id);
  const actions: OneOnOneActionDto[] = series.upcoming?.actions ?? [];
  const nameOf = (id: string) => (id === series.manager.employeeId ? series.manager.displayName : series.report.displayName);
  const today = localDate(new Date());
  return (
    <section className="grid gap-2.5 rounded-surface bg-card px-5 py-[18px]">
      <h2 className="type-section-title text-foreground">{t("actions")}</h2>
      {actions.length === 0 ? <span className="text-sm text-muted-foreground">{t("noActions")}</span> : (
        <div className="grid">
          {actions.map((action, i) => {
            const late = !action.done && action.dueDate ? daysBetween(action.dueDate, today) : 0;
            return (
              <div key={action.id} id={`action-${action.id}`}
                className={cn("group grid scroll-mt-24 grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 py-[9px]", i > 0 && "border-t border-border")}>
                <PersonInitials name={nameOf(action.ownerEmployeeId)} size="xs" />
                <span className={cn("text-sm", action.done ? "text-muted-foreground line-through" : "text-foreground")}>{action.text}</span>
                {series.can.write && !action.done ? (
                  <button
                    type="button"
                    className="whitespace-nowrap"
                    aria-label={t("markDone", { text: action.text })}
                    onClick={() => commands.setActionDone.mutate({ actionId: action.id, done: true })}
                  >
                    <ActionState late={late} due={action.dueDate} locale={locale} />
                  </button>
                ) : action.done ? (
                  <StateWord tone="ok">{t("doneOn", { day: action.doneAt ? dayMonth(action.doneAt, locale) : "" })}</StateWord>
                ) : (
                  <ActionState late={late} due={action.dueDate} locale={locale} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** An open action's state; on hover, the button it sits in offers to mark it done. */
function ActionState({ late, due, locale }: { late: number; due: string | null; locale: string }) {
  const t = useTranslations("oneOnOnes.Meeting");
  return (
    <>
      <span className="group-hover:hidden">
        {late > 0 ? <StateWord tone="bad">{t("daysLate", { count: late })}</StateWord>
          : due ? <StateWord tone="muted">{t("due", { day: dayMonth(due, locale) })}</StateWord>
          : <StateWord tone="muted">{t("open")}</StateWord>}
      </span>
      <span className="hidden text-[13px] font-semibold text-success group-hover:inline-flex group-hover:items-center group-hover:gap-1">
        <Check className="size-3.5" aria-hidden />{t("done")}
      </span>
    </>
  );
}

/** The latest praise once there's history; for a first 1:1, who the person is. */
function AboutCard({ series, other }: { series: OneOnOneSeriesDto; other: OneOnOnePersonDto }) {
  const t = useTranslations("oneOnOnes.Meeting");
  const locale = useLocale();
  const context = series.context;
  const praise = context?.latestPraise ?? null;
  const report = series.report;
  if (series.first && series.viewerRole === "Manager") {
    const props: [string, string | null][] = [
      [t("joined"), context?.joinedOn ? fullDay(context.joinedOn, locale) : null],
      [t("job"), report.jobTitle],
      [t("unit"), context?.unit ?? null],
    ];
    return (
      <section className="grid gap-2.5 rounded-surface bg-card px-5 py-[18px]">
        <h2 className="type-section-title text-foreground">{t("about", { name: firstName(other.displayName) })}</h2>
        <dl className="grid gap-2">
          {props.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-end font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (!praise) return null;
  return (
    <section className="grid gap-2.5 rounded-surface bg-card px-5 py-[18px]">
      <h2 className="type-section-title text-foreground">{t("lately")}</h2>
      <Link href={appHref(`/performance/feedback?tab=praise&praise=${praise.id}`)} className="flex items-start gap-3">
        <PersonInitials name={praise.authorName} size="sm" />
        <span className="grid gap-0.5">
          <span className="text-sm text-muted-foreground">
            {t("praised", { author: firstName(praise.authorName), name: firstName(report.displayName), day: dayMonth(praise.at, locale) })}
          </span>
          <Said className="text-[14.5px]">{praise.message}</Said>
        </span>
      </Link>
    </section>
  );
}

// ── Moving the meeting ─────────────────────────────────────────────────────────

/** Move this meeting, or change how often you meet; both calendars follow. */
function MoveDialog({ meeting, cadence, pending, onClose, onSave }: {
  meeting: OneOnOneMeetingDto;
  cadence: OneOnOneCadence;
  pending: boolean;
  onClose: () => void;
  onSave: (scheduledAt: string, cadence: OneOnOneCadence) => Promise<void>;
}) {
  const t = useTranslations("oneOnOnes.Meeting");
  const w = useOneOnOneWords();
  const current = new Date(meeting.scheduledAt);
  const [date, setDate] = useState(localDate(current));
  const [time, setTime] = useState(TIME_SLOTS.includes(localTime(current)) ? localTime(current) : "10:00");
  const [rhythm, setRhythm] = useState(cadence);
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent className="w-[min(28rem,calc(100vw-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{t("moveTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="move-date">{t("date")}</Label>
            <DatePicker id="move-date" value={date} min={localDate(new Date())} onChange={setDate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="move-time">{t("time")}</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger id="move-time" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{TIME_SLOTS.map((slot) => <SelectItem key={slot} value={slot}>{slot}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="move-rhythm">{t("howOften")}</Label>
          <Select value={rhythm} onValueChange={(value) => setRhythm(value as OneOnOneCadence)}>
            <SelectTrigger id="move-rhythm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{CADENCES.map((c) => <SelectItem key={c} value={c}>{w.cadence[c]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t("cancel")}</Button>
          <AsyncButton pending={pending} onClick={() => onSave(toInstant(date, time), rhythm).catch(() => undefined)}>{t("move")}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
