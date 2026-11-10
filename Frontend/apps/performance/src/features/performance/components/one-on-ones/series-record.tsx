"use client";

import { SeriesSkeleton } from "./one-on-one-skeletons";

import { useState } from "react";
import Link from "next/link";
import {
  newClientId,
  type OneOnOneActionDto,
  type OneOnOneAgendaItemDto,
  type OneOnOneCadence,
  type OneOnOneMeetingDto,
  type OneOnOnePersonDto,
  type OneOnOneSeriesDto,
  type OneOnOneSuggestionDto,
} from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Checkbox } from "@repo/ds/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@repo/ds/components/ui/collapsible";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ds/components/ui/select";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { AsyncButton, PageContainer, PageHeader, Section, StatusBadge, Said } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { AvatarStack, ObjectiveStatusBadge, PersonInitials, PlanDial } from "@repo/performance-ui";
import { CalendarDays, Check, ChevronDown, Flag, Plus, X } from "@repo/ds/icons";
import { useOneOnOne, useOneOnOneCommands } from "../../api/use-conversations";
import { usePersonSummary } from "../../api/use-performance";
import { useLanding } from "@/lib/use-landing";
import { ContentUnavailable } from "../content-unavailable";
import { PlanDocument, SectionTitle, SidebarSection } from "../plan/plan-layout";
import { NotesEditor } from "./notes-editor";
import {
  CADENCES,
  TIME_SLOTS,
  formatDay,
  localDate,
  localTime,
  nextOccurrences,
  shortDay,
  toInstant,
  useOneOnOneWords,
} from "./one-on-one-lib";
import { SourceWell } from "./one-on-one-parts";
import { useRecentRecord } from "@repo/api/react";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import type { Say } from "@/i18n/say";

/** The app's own routes drop the basePath the server's hrefs carry. */
const appHref = (href: string) => href.replace(/^\/performance/, "");

type Names = Map<string, string>;

/**
 * R7, one 1:1 series (D-12). The series reads as a track of meetings; the next one is the page: what to talk about
 * (with talking points ready from the report's year), the actions between the two people, and the notes, shared and
 * private. The report's year sits beside it so the conversation has context. An ended series is its history.
 */
export function SeriesRecord({ seriesId }: { seriesId: string }) {
  const query = useOneOnOne(seriesId);
  if (query.error) return <ContentUnavailable list="oneOnOnes" error={query.error} onRetry={query.refetch} />;
  if (!query.data) return <SeriesSkeleton />;
  return <SeriesView series={query.data} />;
}

function SeriesView({ series }: { series: OneOnOneSeriesDto }) {
  const w = useOneOnOneWords();
  const format = useFormat();
  const t = useTranslations("oneOnOnes.SeriesView");
  const commands = useOneOnOneCommands(series.id);
  // A notification about an action assigned to you lands on it.
  useLanding("action", true);
  const [rescheduling, setRescheduling] = useState(false);
  const isManager = series.viewerRole === "Manager";
  const other = isManager ? series.report : series.manager;
  const me = isManager ? series.manager : series.report;
  useRecentRecord("performance", { label: t("n11With", { displayName: other.displayName }), kind: "1:1", href: `/performance/one-on-ones/${series.id}` });
  const upcoming = series.upcoming;
  const names: Names = new Map([
    [series.manager.employeeId, series.manager.displayName],
    [series.report.employeeId, series.report.displayName],
  ]);
  const subtitle = series.ended
    ? (series.endReason === "PersonInactive" ? t("someoneLeftTheCompanyYou", { toLowerCase: w.cadence[series.cadence].toLowerCase(), startedAt: shortDay(series.startedAt, format.locale), value: series.endedAt ? shortDay(series.endedAt, format.locale) : "" }) : t("theReportingLineChangedYou", { toLowerCase: w.cadence[series.cadence].toLowerCase(), startedAt: shortDay(series.startedAt, format.locale), value: series.endedAt ? shortDay(series.endedAt, format.locale) : "" }))
    : [other.jobTitle, t("since", { value: w.cadence[series.cadence], startedAt: shortDay(series.startedAt, format.locale) })].filter(Boolean).join(" · ");

  return (
    <PageContainer width="wide">
      <PageHeader className="mb-4"
        back={{ href: "/one-on-ones", label: "1:1s" }}
        leading={<AvatarStack names={[me.displayName, other.displayName]} size="xl" className={series.ended ? "opacity-80" : undefined} />}
        eyebrow={series.ended ? <StatusBadge tone="muted">{t("ended")} {series.endedAt ? shortDay(series.endedAt, format.locale) : ""}</StatusBadge> : undefined}
        title={other.displayName}
        description={subtitle}
        actions={
          upcoming && series.can.complete ? (
            <>
              <Button variant="outline" onClick={() => setRescheduling(true)}>{t("reschedule")}</Button>
              <AsyncButton
                pending={commands.complete.isLoading}
                onClick={() => commands.complete.mutate({ meetingId: upcoming.id, expectedVersion: upcoming.version })}
              >
                <Check className="size-4" data-icon="inline-start" /> {t("completeMeeting")}
              </AsyncButton>
            </>
          ) : null
        }
      />
      <MeetingTrack series={series} />
      <div className="mt-10">
        <PlanDocument
          main={
            series.ended || !upcoming ? (
              <History series={series} names={names} />
            ) : (
              <div className="space-y-6">
                <UpcomingMeeting series={series} meeting={upcoming} me={me} other={other} names={names} />
                {series.past.length > 0 ? <EarlierMeetings series={series} meetings={series.past} names={names} title={t("earlierMeetings")} /> : null}
              </div>
            )
          }
          sidebar={
            <SeriesSidebar
              series={series}
              onCadence={(cadence) => commands.changeCadence.mutate({ cadence, expectedVersion: series.version })}
            />
          }
        />
      </div>
      {rescheduling && upcoming ? (
        <RescheduleDialog
          meeting={upcoming}
          pending={commands.reschedule.isLoading}
          onClose={() => setRescheduling(false)}
          onSave={async (scheduledAt) => {
            await commands.reschedule.mutateAsync({ meetingId: upcoming.id, scheduledAt, expectedVersion: upcoming.version });
            setRescheduling(false);
          }}
        />
      ) : null}
    </PageContainer>
  );
}

// ── The series as a track ──────────────────────────────────────────────────────

type Stop = { key: string; at: string; kind: "held" | "missed" | "next" | "ahead" | "ended"; detail?: string };

/** Up to four meetings behind, the next one, two ahead on the rhythm; an ended series closes with its end. */
function MeetingTrack({ series }: { series: OneOnOneSeriesDto }) {
  const w = useOneOnOneWords();
  const format = useFormat();
  const t = useTranslations("oneOnOnes.MeetingTrack");
  const behind = [...series.past].reverse().slice(series.ended || !series.upcoming ? -7 : -4);
  const stops: Stop[] = behind.map((m) => ({
    key: m.id,
    at: m.scheduledAt,
    kind: m.state === "Completed" ? "held" : "missed",
    detail: m.state === "Completed" ? (m.agenda.length === 1 ? t("point", { length: m.agenda.length }) : t("points", { length: m.agenda.length })) : t("notHeld"),
  }));
  if (series.upcoming) {
    stops.push({ key: series.upcoming.id, at: series.upcoming.scheduledAt, kind: "next", detail: w.howSoon(series.upcoming.scheduledAt) });
    nextOccurrences(series.upcoming.scheduledAt, series.cadence, 2).forEach((date) =>
      stops.push({ key: date.toISOString(), at: date.toISOString(), kind: "ahead" }));
  } else if (series.ended && series.endedAt) {
    stops.push({ key: "ended", at: series.endedAt, kind: "ended", detail: t("ended") });
  }
  if (stops.length < 2) return null;

  return (
    <ol className="relative mt-6 grid" style={{ gridTemplateColumns: `repeat(${stops.length}, minmax(0, 1fr))` }} aria-label={t("meetings")}>
      <span
        aria-hidden
        className="absolute top-2.5 h-px bg-border"
        style={{ left: `${50 / stops.length}%`, right: `${50 / stops.length}%` }}
      />
      {stops.map((stop) => (
        <li key={stop.key} className="relative flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden
            className={cn(
              "grid size-5 place-items-center rounded-full",
              stop.kind === "held" && "bg-success text-background",
              stop.kind === "missed" && "border-2 border-muted-foreground/60 bg-background",
              stop.kind === "next" && "border-2 border-primary bg-background ring-4 ring-primary-tint",
              stop.kind === "ahead" && "border border-dashed border-muted-foreground/50 bg-background",
              stop.kind === "ended" && "rounded-detail border border-border bg-inlay text-muted-foreground",
            )}
          >
            {stop.kind === "held" ? <Check className="size-3" /> : null}
            {stop.kind === "next" ? <span className="size-2 rounded-full bg-primary" /> : null}
            {stop.kind === "ended" ? <Flag className="size-3" /> : null}
          </span>
          <span className="min-w-0">
            <span className={cn("block type-label tabular-nums", stop.kind === "next" ? "text-primary-ink" : stop.kind === "ahead" ? "text-muted-foreground" : "text-foreground")}>
              {stop.kind === "next" ? w.meetingTime(stop.at) : shortDay(stop.at, format.locale)}
            </span>
            {stop.detail ? <span className="block type-meta text-muted-foreground">{stop.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── The next meeting ───────────────────────────────────────────────────────────

function UpcomingMeeting({
  series,
  meeting,
  me,
  other,
  names,
}: {
  series: OneOnOneSeriesDto;
  meeting: OneOnOneMeetingDto;
  me: OneOnOnePersonDto;
  other: OneOnOnePersonDto;
  names: Names;
}) {
  const t = useTranslations("oneOnOnes.UpcomingMeeting");
  const commands = useOneOnOneCommands(series.id);
  const writable = series.can.write;
  const reportFirstName = series.report.displayName.split(" ")[0];
  const open = meeting.actions.filter((a) => !a.done).length;
  return (
    <>
      <Section id="talking-points" title={<SectionTitle label={t("talkingPoints")} count={meeting.agenda.length} />} flush>
        <TalkingPoints
          items={meeting.agenda}
          myId={me.employeeId}
          names={names}
          writable={writable}
          onAdd={(text) => commands.addAgendaItem.mutate({ meetingId: meeting.id, request: { id: newClientId(), text } })}
          onDiscussed={(item, discussed) => commands.setDiscussed.mutate({ meetingId: meeting.id, itemId: item.id, discussed })}
          onRemove={(item) => commands.removeAgendaItem.mutate({ meetingId: meeting.id, itemId: item.id })}
        />
      </Section>

      {writable && meeting.suggestions.length > 0 ? (
        <Section
          id="from-the-year"
          title={<SectionTitle label={series.viewerRole === "Manager" ? t("fromSYear", { reportFirstName: reportFirstName ?? "" }) : t("fromYourYear")} count={meeting.suggestions.length} />}
        >
          <Suggestions
            suggestions={meeting.suggestions}
            onAdd={(s) => commands.addAgendaItem.mutate({ meetingId: meeting.id, request: { id: newClientId(), sourceKind: s.kind, sourceId: s.sourceId } })}
          />
        </Section>
      ) : null}

      <Section id="actions" title={<SectionTitle label={t("actions")} count={open} />} flush>
        <Actions
          actions={meeting.actions}
          names={names}
          people={[other, me]}
          writable={writable}
          onDone={(action, done) => commands.setActionDone.mutate({ actionId: action.id, done })}
          onAdd={(text, ownerEmployeeId, dueDate) => commands.addAction.mutate({ id: newClientId(), text, ownerEmployeeId, dueDate })}
        />
      </Section>

      <Section id="notes" title={t("notes")}>
        <MeetingNotes series={series} meeting={meeting} otherName={other.displayName} />
      </Section>
    </>
  );
}

function TalkingPoints({
  items,
  myId,
  names,
  writable,
  onAdd,
  onDiscussed,
  onRemove,
}: {
  items: OneOnOneAgendaItemDto[];
  myId: string;
  names: Names;
  writable: boolean;
  onAdd: (text: string) => void;
  onDiscussed: (item: OneOnOneAgendaItemDto, discussed: boolean) => void;
  onRemove: (item: OneOnOneAgendaItemDto) => void;
}) {
  const w = useOneOnOneWords();
  const t = useTranslations("oneOnOnes.TalkingPoints");
  const [draft, setDraft] = useState("");
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };
  return (
    <ul className="divide-y divide-border">
      {items.length === 0 && !writable ? <li className="px-5 py-4 type-body-secondary text-muted-foreground">{t("nothingOnTheAgenda")}</li> : null}
      {items.map((item) => (
        <li key={item.id} className="group flex min-h-16 items-center gap-4 px-5 py-3">
          {item.sourceKind ? <SourceWell kind={item.sourceKind} /> : <PersonInitials name={names.get(item.authorEmployeeId)} size="sm" className="mx-1" />}
          <div className="min-w-0 flex-1">
            {item.href ? (
              <Link href={appHref(item.href)} className={cn("type-label hover:underline", item.discussed ? "text-muted-foreground line-through" : "text-foreground")}>
                {item.text}
              </Link>
            ) : (
              <p className={cn("type-label break-words", item.discussed ? "text-muted-foreground line-through" : "text-foreground")}>{item.text}</p>
            )}
            <p className="type-meta text-muted-foreground">
              {item.sourceKind ? w.source[item.sourceKind] : t("addedBy", { value: item.authorEmployeeId === myId ? "you" : names.get(item.authorEmployeeId)?.split(" ")[0] ?? "them" })}
            </p>
          </div>
          {writable && item.authorEmployeeId === myId ? (
            <Button writes
              variant="ghost"
              size="icon-sm"
              aria-label={t("remove", { text: item.text })}
              onClick={() => onRemove(item)}
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-4" />
            </Button>
          ) : null}
          <Checkbox
            checked={item.discussed}
            disabled={!writable}
            onCheckedChange={(checked) => onDiscussed(item, checked === true)}
            aria-label={t("talkedAbout", { text: item.text })}
            className="size-5"
          />
        </li>
      ))}
      {writable ? (
        <li className="flex items-center gap-4 px-5 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-control border border-dashed border-border text-muted-foreground" aria-hidden>
            <Plus className="size-4" />
          </span>
          <Input
            aria-label={t("addATalkingPoint")}
            placeholder={t("addATalkingPoint")}
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {draft.trim() ? <Button size="sm" variant="ghost" onClick={submit}>{t("add")}</Button> : null}
        </li>
      ) : null}
    </ul>
  );
}

/** What the report's year offers since the last meeting, told apart by kind; one click puts it on the agenda. */
function Suggestions({ suggestions, onAdd }: { suggestions: OneOnOneSuggestionDto[]; onAdd: (s: OneOnOneSuggestionDto) => void }) {
  const w = useOneOnOneWords();
  const format = useFormat();
  const t = useTranslations("oneOnOnes.Suggestions");
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {suggestions.map((s) => (
        <li key={`${s.kind}:${s.sourceId}`} className="flex flex-col gap-3 rounded-inset bg-inlay p-4">
          <div className="flex items-center gap-2.5">
            <SourceWell kind={s.kind} status={s.status} size="sm" />
            <span className="type-meta text-muted-foreground">
              {w.source[s.kind]}
              {s.at ? ` · ${shortDay(s.at, format.locale)}` : ""}
            </span>
          </div>
          <p className="type-label text-foreground">{s.label}</p>
          <div className="mt-auto flex items-center justify-between gap-2">
            <Button writes size="sm" variant="outline" onClick={() => onAdd(s)} aria-label={t("addToTheTalkingPoints", { label: s.label })}>
              <Plus className="size-4" data-icon="inline-start" /> {t("add")}
            </Button>
            {s.status ? <ObjectiveStatusBadge status={s.status} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Actions({
  actions,
  names,
  people,
  writable,
  onDone,
  onAdd,
}: {
  actions: OneOnOneActionDto[];
  names: Names;
  people: OneOnOnePersonDto[];
  writable: boolean;
  onDone: (action: OneOnOneActionDto, done: boolean) => void;
  onAdd: (text: string, ownerEmployeeId: string, dueDate: string | null) => void;
}) {
  const format = useFormat();
  const t = useTranslations("oneOnOnes.Actions");
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(people[0]!.employeeId);
  const [due, setDue] = useState("");
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), owner, due || null);
    setText("");
    setDue("");
  };
  return (
    <ul className="divide-y divide-border">
      {actions.length === 0 && !writable ? <li className="px-5 py-4 type-body-secondary text-muted-foreground">{t("noActions")}</li> : null}
      {actions.map((action) => (
        <li key={action.id} id={`action-${action.id}`} className="flex min-h-14 scroll-mt-24 items-center gap-4 px-5 py-3">
          <Checkbox
            checked={action.done}
            disabled={!writable}
            onCheckedChange={(checked) => onDone(action, checked === true)}
            aria-label={t("done", { text: action.text })}
            className="size-5"
          />
          <div className="min-w-0 flex-1">
            <p className={cn("type-label break-words", action.done ? "text-muted-foreground line-through" : "text-foreground")}>{action.text}</p>
            {action.carriedOver ? <p className="type-meta text-muted-foreground">{t("from", { createdInMeetingAt: shortDay(action.createdInMeetingAt, format.locale) })}</p> : null}
          </div>
          {action.dueDate && !action.done ? (
            <StatusBadge tone={action.overdue ? "danger" : "neutral"}>{action.overdue ? t("overdue") : t("due")} {format.date(action.dueDate)}</StatusBadge>
          ) : null}
          <PersonInitials name={names.get(action.ownerEmployeeId)} size="xs" />
        </li>
      ))}
      {writable ? (
        <li className="flex flex-wrap items-center gap-3 px-5 py-2.5">
          <span className="size-5 shrink-0 rounded-detail border border-dashed border-border" aria-hidden />
          <Input
            aria-label={t("newAction")}
            placeholder={t("addAnAction")}
            value={text}
            maxLength={200}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            className="h-9 min-w-40 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger aria-label={t("owner")} size="sm" className="w-auto gap-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.employeeId} value={person.employeeId}>{person.displayName.split(" ")[0]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DatePicker value={due} onChange={setDue} min={localDate(new Date())} placeholder={t("dueDate")} className="h-8 w-36" />
          {text.trim() ? <Button size="sm" onClick={add}>{t("add")}</Button> : null}
        </li>
      ) : null}
    </ul>
  );
}

/** The shared notes read as the meeting's record; the private note sits apart, for the writer only. */
function MeetingNotes({ series, meeting, otherName }: { series: OneOnOneSeriesDto; meeting: OneOnOneMeetingDto; otherName: string }) {
  const t = useTranslations("oneOnOnes.MeetingNotes");
  const commands = useOneOnOneCommands(series.id);
  const revisionOf = (dto: OneOnOneSeriesDto, field: "shared" | "private") => {
    const saved = [dto.upcoming, ...dto.past].find((m) => m?.id === meeting.id);
    return field === "shared" ? saved?.sharedNotesRevision ?? 0 : saved?.privateNote.revision ?? 0;
  };
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="rounded-inset bg-inlay p-5">
        <NotesEditor
          id={`shared-${meeting.id}`}
          label={t("sharedWith", { value: (otherName.split(" ")[0]) ?? "" })}
          text={meeting.sharedNotes}
          revision={meeting.sharedNotesRevision}
          writable={meeting.notesWritable}
          reading
          save={async (text, expectedRevision) =>
            revisionOf(await commands.setSharedNotes.mutateAsync({ meetingId: meeting.id, text, expectedRevision }), "shared")}
        />
      </div>
      <div className="rounded-inset border border-border p-5">
        <NotesEditor
          id={`private-${meeting.id}`}
          label={t("onlyYou")}
          isPrivate
          text={meeting.privateNote.text}
          revision={meeting.privateNote.revision}
          writable={meeting.notesWritable}
          save={async (text, expectedRevision) =>
            revisionOf(await commands.setPrivateNotes.mutateAsync({ meetingId: meeting.id, text, expectedRevision }), "private")}
        />
      </div>
    </div>
  );
}

// ── History ────────────────────────────────────────────────────────────────────

/** An ended series, or one between meetings: the last meeting open, the rest a list. */
function History({ series, names }: { series: OneOnOneSeriesDto; names: Names }) {
  const t = useTranslations("oneOnOnes.History");
  const last = series.past.find((m) => m.state === "Completed");
  const earlier = series.past.filter((m) => m !== last);
  return (
    <div className="space-y-6">
      {last ? (
        <Section id="last-meeting" title={t("lastMeeting")}>
          <MeetingDetail series={series} meeting={last} names={names} bare />
        </Section>
      ) : (
        <p className="type-body-secondary text-muted-foreground">{t("noMeetingWasHeld")}</p>
      )}
      {earlier.length > 0 ? <EarlierMeetings series={series} meetings={earlier} names={names} title={last ? t("earlierMeetings") : t("meetings")} /> : null}
    </div>
  );
}

function EarlierMeetings({ series, meetings, names, title }: { series: OneOnOneSeriesDto; meetings: OneOnOneMeetingDto[]; names: Names; title: string }) {
  const t = useTranslations("oneOnOnes.EarlierMeetings");
  return (
    <Section id="earlier-meetings" title={<SectionTitle label={title} count={meetings.length} />} flush>
      <ul className="divide-y divide-border">
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Collapsible>
              <CollapsibleTrigger
                disabled={meeting.state === "NotHeld"}
                className="group flex w-full items-center gap-4 px-5 py-3.5 text-start hover:bg-inlay/50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <DateBlock iso={meeting.scheduledAt} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate type-label", meeting.state === "NotHeld" ? "text-muted-foreground" : "text-foreground")}>
                    {meeting.state === "NotHeld" ? t("notHeld") : meeting.agenda[0]?.text ?? t("noTalkingPoints")}
                  </span>
                  <span className="block type-meta text-muted-foreground">{meetingFacts(meeting, (key, values) => t(key as "notes", values as never))}</span>
                </span>
                {meeting.state === "NotHeld" ? (
                  <StatusBadge tone="muted">{t("missed")}</StatusBadge>
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border bg-inlay/40 px-5 py-5">
                <MeetingDetail series={series} meeting={meeting} names={names} bare />
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function meetingFacts(meeting: OneOnOneMeetingDto, say: Say): string {
  if (meeting.state === "NotHeld") return "";
  const extra = meeting.agenda.length - 1;
  const created = meeting.actions.length;
  return [
    extra > 0 ? say("talkingPoints", { count: extra }) : null,
    created > 0 ? say("actions", { count: created }) : null,
    meeting.sharedNotes ? say("notes") : null,
  ].filter(Boolean).join(" · ");
}

function DateBlock({ iso }: { iso: string }) {
  const format = useFormat();
  const at = new Date(iso);
  return (
    <span className="flex w-12 shrink-0 flex-col items-center rounded-control bg-inlay py-1.5">
      <span className="type-eyebrow text-muted-foreground">{format.parts(at, { month: "short" })}</span>
      <span className="type-label tabular-nums text-foreground">{at.getDate()}</span>
    </span>
  );
}

/** One past meeting: what was talked about, the actions it produced, and the notes. */
function MeetingDetail({ series, meeting, names, bare = false }: { series: OneOnOneSeriesDto; meeting: OneOnOneMeetingDto; names: Names; bare?: boolean }) {
  const t = useTranslations("oneOnOnes.MeetingDetail");
  const other = series.viewerRole === "Manager" ? series.report : series.manager;
  return (
    <div className={cn("grid gap-8 md:grid-cols-2", !bare && "rounded-surface bg-card p-6")}>
      <div className="min-w-0 space-y-6">
        <div>
          <p className="type-meta text-muted-foreground">{t("talkedAbout")}</p>
          {meeting.agenda.length === 0 ? (
            <p className="mt-2 type-body-secondary text-muted-foreground">{t("noTalkingPoints")}</p>
          ) : (
            <ul className="mt-2.5 space-y-2">
              {meeting.agenda.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5">
                  <Mark on={item.discussed} />
                  <span className={cn("min-w-0 flex-1 type-body", item.discussed ? "text-foreground" : "text-muted-foreground")}>{item.text}</span>
                  {item.discussed ? null : <span className="type-meta text-muted-foreground">{t("notReached")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {meeting.actions.length > 0 ? (
          <div>
            <p className="type-meta text-muted-foreground">{t("actions")}</p>
            <ul className="mt-2.5 space-y-2">
              {meeting.actions.map((action) => (
                <li key={action.id} className="flex items-center gap-2.5">
                  <Mark on={action.done} />
                  <span className={cn("min-w-0 flex-1 type-body", action.done ? "text-foreground" : "text-muted-foreground")}>{action.text}</span>
                  <PersonInitials name={names.get(action.ownerEmployeeId)} size="xs" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="min-w-0 space-y-6">
        {meeting.notesWritable ? (
          <MeetingNotesStacked series={series} meeting={meeting} otherName={other.displayName} />
        ) : (
          <>
            <div>
              <p className="type-meta text-muted-foreground">{t("notes")}</p>
              {meeting.sharedNotes ? (
                <Said className="mt-2.5">{meeting.sharedNotes}</Said>
              ) : (
                <p className="mt-2 type-body-secondary text-muted-foreground">{t("none")}</p>
              )}
            </div>
            {meeting.privateNote.text ? (
              <div>
                <p className="type-meta text-muted-foreground">{t("onlyYou")}</p>
                <p className="mt-2.5 type-body whitespace-pre-wrap text-foreground">{meeting.privateNote.text}</p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The last completed meeting's notes stay editable until the next one is held. */
function MeetingNotesStacked({ series, meeting, otherName }: { series: OneOnOneSeriesDto; meeting: OneOnOneMeetingDto; otherName: string }) {
  const t = useTranslations("oneOnOnes.MeetingNotesStacked");
  const commands = useOneOnOneCommands(series.id);
  const revisionOf = (dto: OneOnOneSeriesDto, field: "shared" | "private") => {
    const saved = [dto.upcoming, ...dto.past].find((m) => m?.id === meeting.id);
    return field === "shared" ? saved?.sharedNotesRevision ?? 0 : saved?.privateNote.revision ?? 0;
  };
  return (
    <>
      <NotesEditor
        id={`shared-${meeting.id}`}
        label={t("sharedWith", { value: (otherName.split(" ")[0]) ?? "" })}
        text={meeting.sharedNotes}
        revision={meeting.sharedNotesRevision}
        writable
        reading
        save={async (text, expectedRevision) =>
          revisionOf(await commands.setSharedNotes.mutateAsync({ meetingId: meeting.id, text, expectedRevision }), "shared")}
      />
      <NotesEditor
        id={`private-${meeting.id}`}
        label={t("onlyYou")}
        isPrivate
        text={meeting.privateNote.text}
        revision={meeting.privateNote.revision}
        writable
        save={async (text, expectedRevision) =>
          revisionOf(await commands.setPrivateNotes.mutateAsync({ meetingId: meeting.id, text, expectedRevision }), "private")}
      />
    </>
  );
}

function Mark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-detail",
        on ? "bg-success text-background" : "border border-border",
      )}
    >
      {on ? <Check className="size-3" /> : null}
    </span>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function SeriesSidebar({ series, onCadence }: { series: OneOnOneSeriesDto; onCadence: (cadence: OneOnOneCadence) => void }) {
  const w = useOneOnOneWords();
  const format = useFormat();
  const t = useTranslations("oneOnOnes.SeriesSidebar");
  const report = series.report;
  const isManager = series.viewerRole === "Manager";
  const summary = usePersonSummary(report.employeeId);
  const cycle = summary.data?.currentCycle?.isParticipant ? summary.data.currentCycle : null;
  const atRisk = cycle?.objectives.filter((o) => o.status === "AtRisk" || o.status === "OffTrack").length ?? 0;
  const held = series.past.filter((m) => m.state === "Completed").length;
  const meetings = series.past.length;
  const doneActions = series.past.flatMap((m) => m.actions).filter((a) => a.done).length;
  const allActions = new Set(series.past.flatMap((m) => m.actions).map((a) => a.id)).size;

  return (
    <>
      {series.ended ? (
        <SidebarSection label={t("overTheSeries")}>
          <div className="mt-3.5 grid grid-cols-2 gap-4">
            <Figure value={held} of={meetings} label={t("meetingsHeld")} />
            <Figure value={doneActions} of={allActions} label={t("actionsDone")} />
          </div>
        </SidebarSection>
      ) : null}

      <SidebarSection label={t("year", { value: isManager ? `${report.displayName.split(" ")[0]}'s` : "Your", value2: cycle ? ` · ${cycle.cycleName}` : "" })}>
        {summary.isLoading ? (
          <Skeleton className="mt-3 h-20 w-full" />
        ) : cycle ? (
          <>
            <div className="mt-3.5 flex items-center gap-4">
              <PlanDial cycle={cycle} />
              <div className="min-w-0">
                {cycle.objectives.length > 0 ? (
                  <>
                    <p className="type-label text-foreground">{t("objective", { length: cycle.objectives.length })}{cycle.objectives.length === 1 ? "" : t("s")}</p>
                    {atRisk > 0 ? <p className="type-meta text-primary-ink">{t("atRisk", { atRisk })}</p> : <p className="type-meta text-muted-foreground">{t("noneAtRisk")}</p>}
                  </>
                ) : (
                  // A plan not put forward yet shows no objectives to anyone else: say where it stands, not "0 objectives".
                  <p className="type-label text-foreground">{t(`unshared.${cycle.planStatus ?? "NotStarted"}`)}</p>
                )}
                {cycle.planHref ? (
                  <Link href={appHref(cycle.planHref)} className="mt-1 inline-block type-meta text-foreground hover:underline">
                    {t("open")} {isManager ? t("their") : t("your")} {t("plan")}
                  </Link>
                ) : null}
              </div>
            </div>
            <ul className="mt-4 space-y-2.5">
              {/* A 1:1's two people always reach the objective's record; only an Observer's summary has no links. */}
              {cycle.objectives.flatMap((objective) => (objective.href ? [{ ...objective, href: objective.href }] : [])).map((objective) => (
                <li key={objective.objectiveId}>
                  <Link href={appHref(objective.href)} className="flex items-center gap-2.5 hover:underline">
                    <span className="min-w-0 flex-1 truncate type-body text-foreground">{objective.title}</span>
                    {objective.status ? <ObjectiveStatusBadge status={objective.status} /> : null}
                    <span className="w-9 text-end type-meta tabular-nums text-muted-foreground">
                      {objective.progress !== null ? `${Math.round(objective.progress)}%` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 type-body-secondary text-muted-foreground">{t("noPlanInTheCurrent")}</p>
        )}
      </SidebarSection>

      {summary.data && (summary.data.feedback || summary.data.praise) ? (
        <SidebarSection label={t("recognition")}>
          <div className="mt-3.5 flex gap-8">
            {summary.data.feedback ? <Figure value={summary.data.feedback.total} label="feedback" /> : null}
            {summary.data.praise ? <Figure value={summary.data.praise.total} label="praise" /> : null}
          </div>
        </SidebarSection>
      ) : null}

      <SidebarSection label={t("rhythm")}>
        {series.can.write ? (
          <Select value={series.cadence} onValueChange={(value) => onCadence(value as OneOnOneCadence)}>
            <SelectTrigger aria-label={t("howOften")} className="mt-3 w-full">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CADENCES.map((cadence) => <SelectItem key={cadence} value={cadence}>{w.cadence[cadence]}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <p className="mt-3 type-body text-foreground">{w.cadence[series.cadence]}</p>
        )}
        <p className="mt-2.5 type-meta text-muted-foreground">
          {meetings > 0 ? t("heldOf", { held, meetings }) + " " : ""}{t("since", { startedAt: formatDay(series.startedAt, format.locale) })}
        </p>
      </SidebarSection>
    </>
  );
}

function Figure({ value, of, label }: { value: number; of?: number; label: string }) {
  return (
    <div>
      <p className="type-metric text-foreground">
        {value}
        {of !== undefined ? <span className="type-meta text-muted-foreground"> / {of}</span> : null}
      </p>
      <p className="type-meta text-muted-foreground">{label}</p>
    </div>
  );
}

function RescheduleDialog({
  meeting,
  pending,
  onClose,
  onSave,
}: {
  meeting: OneOnOneMeetingDto;
  pending: boolean;
  onClose: () => void;
  onSave: (scheduledAt: string) => Promise<void>;
}) {
  const t = useTranslations("oneOnOnes.RescheduleDialog");
  const current = new Date(meeting.scheduledAt);
  const [date, setDate] = useState(localDate(current));
  const [time, setTime] = useState(TIME_SLOTS.includes(localTime(current)) ? localTime(current) : "10:00");
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="w-[min(26rem,calc(100vw-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{t("moveTheNextMeeting")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-date">{t("date")}</Label>
            <DatePicker id="reschedule-date" value={date} min={localDate(new Date())} onChange={setDate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-time">{t("time")}</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger id="reschedule-time" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_SLOTS.map((slot) => <SelectItem key={slot} value={slot}>{slot}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t("cancel")}</Button>
          <AsyncButton pending={pending} onClick={() => onSave(toInstant(date, time)).catch(() => undefined)}>{t("moveMeeting")}</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
