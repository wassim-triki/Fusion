"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { newClientId, type OneOnOneCadence, type OneOnOnePersonDto, type OneOnOneSuggestionDto } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Checkbox } from "@repo/ds/components/ui/checkbox";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ds/components/ui/select";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { ObjectiveStatusBadge, PersonInitials } from "@repo/performance-ui";
import { OneOnOnes, PencilLine, Plus, X } from "@/lib/icons";
import { useOneOnOneStart, useStartOneOnOne } from "../../api/use-conversations";
import { Segmented } from "@repo/ds/choice";
import { CADENCES, TIME_SLOTS, defaultFirstMeeting, localDate, nextOccurrences, shortDay, toInstant, useOneOnOneWords } from "./one-on-one-lib";
import { SourceWell } from "./one-on-one-parts";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";

/** Suggestions offered for the first agenda; the server takes up to ten talking points at start. */
const MAX_PICKS = 8;
const MAX_OWN = 2;

function suggestionKey(s: OneOnOneSuggestionDto) {
  return `${s.kind}:${s.sourceId}`;
}

/**
 * Starting 1:1s is one act: how often, the first meeting, and the first agenda, which is already half-written from
 * the year so far (risky objectives, update requests, feedback and praise). Every suggestion starts picked.
 */
function StartForm({
  person,
  defaultCadence,
  layout,
  onCancel,
}: {
  person: OneOnOnePersonDto;
  defaultCadence: OneOnOneCadence;
  layout: "page" | "dialog";
  onCancel?: () => void;
}) {
  const w = useOneOnOneWords();
  const format = useFormat();
  const t = useTranslations("oneOnOnes.StartForm");
  const router = useRouter();
  const start = useStartOneOnOne();
  const options = useOneOnOneStart(person.employeeId);
  const first = useMemo(() => defaultFirstMeeting(), []);
  const [cadence, setCadence] = useState<OneOnOneCadence>(defaultCadence);
  const [date, setDate] = useState(first.date);
  const [time, setTime] = useState(first.time);
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const suggestions = (options.data?.suggestions ?? []).slice(0, MAX_PICKS);

  const picked = suggestions.filter((s) => !unpicked.has(suggestionKey(s)));
  const then = date && time ? nextOccurrences(toInstant(date, time), cadence, 2).map((d) => shortDay(d, format.locale)).join(", ") : null;
  const today = new Date();
  const lastDay = new Date(today);
  lastDay.setFullYear(today.getFullYear() + 1);

  const toggle = (s: OneOnOneSuggestionDto) =>
    setUnpicked((current) => {
      const next = new Set(current);
      if (next.has(suggestionKey(s))) next.delete(suggestionKey(s));
      else next.add(suggestionKey(s));
      return next;
    });
  const addOwn = () => {
    const text = draft.trim();
    if (!text || own.length >= MAX_OWN) return;
    setOwn((current) => [...current, text]);
    setDraft("");
  };

  async function submit() {
    try {
      const series = await start.mutateAsync({
        withEmployeeId: person.employeeId,
        cadence,
        firstMeetingAt: toInstant(date, time),
        agenda: [
          ...picked.map((s) => ({ id: newClientId(), sourceKind: s.kind, sourceId: s.sourceId })),
          ...own.map((text) => ({ id: newClientId(), text })),
        ],
      });
      router.push(`/one-on-ones/${series.id}`);
    } catch {
      /* shown below */
    }
  }

  const schedule = (
    <div className={cn("grid gap-5", layout === "page" && "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]")}>
      <div className="space-y-2">
        <p className="type-label text-foreground">{t("howOften")}</p>
        <Segmented
          label={t("howOften")}
          value={cadence}
          onChange={setCadence}
          options={CADENCES.map((value) => ({ value, label: w.cadence[value] }))}
          fill
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`start-date-${person.employeeId}`}>{t("firstMeeting")}</Label>
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
          <DatePicker id={`start-date-${person.employeeId}`} value={date} min={localDate(today)} max={localDate(lastDay)} onChange={setDate} />
          <Select value={time} onValueChange={setTime}>
            <SelectTrigger aria-label={t("time")} className="w-full tabular-nums">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_SLOTS.map((slot) => (
                <SelectItem key={slot} value={slot}>{slot}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  const agenda = (
    <section aria-labelledby={`first-agenda-${person.employeeId}`}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 id={`first-agenda-${person.employeeId}`} className="type-subsection-title text-foreground">{t("firstAgenda")}</h3>
        {suggestions.length > 0 ? (
          <span className="type-meta tabular-nums text-muted-foreground">{t("picked", { value: picked.length + own.length })}</span>
        ) : null}
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
        {options.isLoading
          ? [0, 1].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-9 rounded-control" />
                <Skeleton className="h-4 w-2/3" />
              </li>
            ))
          : null}
        {suggestions.map((s) => {
          const on = !unpicked.has(suggestionKey(s));
          return (
            <li key={suggestionKey(s)}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-inlay/60">
                <Checkbox checked={on} onCheckedChange={() => toggle(s)} aria-label={t("putOnTheFirstAgenda", { label: s.label })} />
                <SourceWell kind={s.kind} status={s.status} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate type-label", on ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                  <span className="block type-meta text-muted-foreground">
                    {w.source[s.kind]}
                    {s.at ? ` · ${shortDay(s.at, format.locale)}` : ""}
                  </span>
                </span>
                {s.status ? <ObjectiveStatusBadge status={s.status} /> : null}
              </label>
            </li>
          );
        })}
        {own.map((text, index) => (
          <li key={`${text}-${index}`} className="flex items-center gap-3 px-4 py-3">
            <span className="size-4 shrink-0" aria-hidden />
            <span className="grid size-9 shrink-0 place-items-center rounded-control border border-border bg-inlay text-muted-foreground" aria-hidden>
              <PencilLine className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate type-label text-foreground">{text}</span>
            <Button variant="ghost" size="icon-sm" aria-label={t("remove", { text })} onClick={() => setOwn((current) => current.filter((_, i) => i !== index))}>
              <X className="size-4" />
            </Button>
          </li>
        ))}
        {own.length < MAX_OWN ? (
          <li className="flex items-center gap-3 px-4 py-2">
            <span className="size-4 shrink-0" aria-hidden />
            <span className="grid size-9 shrink-0 place-items-center rounded-control border border-dashed border-border text-muted-foreground" aria-hidden>
              <Plus className="size-4" />
            </span>
            <Input
              aria-label={t("addYourOwnTalkingPoint")}
              placeholder={t("addYourOwn")}
              value={draft}
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOwn();
                }
              }}
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {draft.trim() ? <Button size="sm" variant="ghost" onClick={addOwn}>{t("add")}</Button> : null}
          </li>
        ) : null}
      </ul>
    </section>
  );

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="type-meta tabular-nums text-muted-foreground">{then ? `${w.then[cadence]}: ${then}` : ""}</span>
      <div className="flex items-center gap-2">
        {onCancel ? <Button variant="ghost" onClick={onCancel} disabled={start.isLoading}>{t("cancel")}</Button> : null}
        <AsyncButton pending={start.isLoading} disabled={!date || !time} onClick={() => void submit()}>
          {t("start11s")}
        </AsyncButton>
      </div>
    </div>
  );

  return (
    <div className="space-y-7">
      {schedule}
      {agenda}
      {start.error ? <p className="type-body text-destructive" role="alert">{start.error.message}</p> : null}
      {footer}
    </div>
  );
}

/** The page's whole job when someone has no 1:1s with their manager yet. */
export function StartWithManager({ me, manager, defaultCadence }: { me: string; manager: OneOnOnePersonDto; defaultCadence: OneOnOneCadence }) {
  const t = useTranslations("oneOnOnes.StartWithManager");
  return (
    <section aria-labelledby="start-with-manager" className="rounded-surface border border-primary-ring bg-card p-6 md:p-7">
      <div className="flex items-center gap-2.5" aria-hidden>
        <PersonInitials name={me} size="xl" />
        <span className="h-px w-10 border-t border-dashed border-border" />
        <span className="grid size-10 place-items-center rounded-control border border-primary-ring bg-primary-tint text-primary-ink">
          <OneOnOnes className="size-5" />
        </span>
        <span className="h-px w-10 border-t border-dashed border-border" />
        <PersonInitials name={manager.displayName} size="xl" />
      </div>
      <h2 id="start-with-manager" className="mt-5 type-display text-foreground">{t("n11sWith", { displayName: manager.displayName })}</h2>
      <p className="mt-1 type-meta text-muted-foreground">{t("yourManager")}{manager.jobTitle ? ` · ${manager.jobTitle}` : ""}</p>
      <div className="mt-7">
        <StartForm person={manager} defaultCadence={defaultCadence} layout="page" />
      </div>
    </section>
  );
}

/** A manager starting with a report from the team list: the same form in a dialog. */
export function StartOneOnOnesDialog({
  person,
  defaultCadence,
  onClose,
}: {
  person: OneOnOnePersonDto;
  defaultCadence: OneOnOneCadence;
  onClose: () => void;
}) {
  const t = useTranslations("oneOnOnes.StartOneOnOnesDialog");
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(38rem,calc(100vw-2rem))] max-w-none sm:max-w-none overflow-y-auto">
        <DialogHeader className="min-w-0">
          <div className="flex items-center gap-3">
            <PersonInitials name={person.displayName} size="lg" />
            <div className="min-w-0">
              <DialogTitle className="break-words">{t("n11sWith", { displayName: person.displayName })}</DialogTitle>
              {person.jobTitle ? <p className="type-meta text-muted-foreground">{person.jobTitle}</p> : null}
            </div>
          </div>
        </DialogHeader>
        <StartForm person={person} defaultCadence={defaultCadence} layout="dialog" onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
