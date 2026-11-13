"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { WhoIsInExceptionDto, YearSetupCandidateDto, YearSetupDto } from "@repo/api";
import { usePhotos, useTenantSummary } from "@repo/api/query";
import { cn } from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";
import { DatePicker } from "@repo/ds/components/ui/date-picker";
import { PersonAvatar } from "@repo/ds/components/ui/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ds/components/ui/popover";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { ChevronLeft, ChevronRight, Plus, X } from "@repo/ds/icons";
import { dayMonth, firstName } from "./year-words";

export interface WhoIsIn { leaveOut: string[]; exceptions: WhoIsInExceptionDto[] }

/** A division shows this many faces; the rest are counted. */
const FACES = 60;

/** The first Leave out rule that catches someone, as the server reads it (a unit rule here is always a division). */
export function ruledOutBy(rules: string[], person: YearSetupCandidateDto): string | null {
  return rules.find((rule) => {
    const at = rule.indexOf(":");
    const kind = at < 0 ? rule : rule.slice(0, at);
    const value = at < 0 ? "" : rule.slice(at + 1);
    switch (kind) {
      case "employmentType": return (person.employmentType ?? "").toLowerCase() === value.toLowerCase();
      case "unit": return person.divisionId === value;
      case "startedAfter": return !!person.startedOn && person.startedOn > value;
      case "onLeave": return person.onLeave;
      default: return false;
    }
  }) ?? null;
}

export function isIn(who: WhoIsIn, person: YearSetupCandidateDto): boolean {
  const named = who.exceptions.find((e) => e.employeeId === person.employeeId);
  return named ? named.in : !ruledOutBy(who.leaveOut, person);
}

/**
 * Who's in (D-104): everyone in Core HR by default, the company as faces by division. Leave out rules sit on top as
 * chips with their counts; as one lands, the faces it catches fade and the count ticks. Any face opens a small card to
 * leave that person out or bring them in, with a reason; those exceptions are listed by name with Undo.
 */
export function WhosIn({ setup, startDate, who, onWho, joinersJoin, onJoiners }: {
  setup: YearSetupDto;
  startDate: string;
  who: WhoIsIn;
  onWho: (who: WhoIsIn) => void;
  joinersJoin: boolean;
  onJoiners: (value: boolean) => void;
}) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const company = useTenantSummary().data?.name;
  const photos = usePhotos(setup.everyone.map((p) => p.photoUrl));
  const [card, setCard] = useState<string | null>(null);
  const everyone = setup.everyone;
  const count = everyone.filter((p) => isIn(who, p)).length;
  const shown = useTicker(count);
  const byId = new Map(everyone.map((p) => [p.employeeId, p]));
  const divisionName = new Map(setup.divisions.map((d) => [d.id, d.name]));
  const groups = [
    ...setup.divisions.map((d) => ({ id: d.id, name: d.name, people: everyone.filter((p) => p.divisionId === d.id) })),
    ...(everyone.some((p) => !p.divisionId) ? [{ id: "none", name: t("noUnit"), people: everyone.filter((p) => !p.divisionId) }] : []),
  ];

  const ruleLabel = (rule: string) => {
    const [kind, ...rest] = rule.split(":");
    const value = rest.join(":");
    if (kind === "employmentType") return value;
    if (kind === "onLeave") return t("rule.onLeave", { day: dayMonth(startDate, locale) });
    if (kind === "unit") return divisionName.get(value) ?? t("rule.aUnit");
    return t("rule.startedAfter", { day: dayMonth(value, locale) });
  };
  const caught = (rule: string) => everyone.filter((p) => ruledOutBy([rule], p)).length;
  const why = (person: YearSetupCandidateDto) => {
    const named = who.exceptions.find((e) => e.employeeId === person.employeeId);
    if (named) return named.in ? t("inByName", { why: named.reason }) : t("outByName", { why: named.reason });
    const rule = ruledOutBy(who.leaveOut, person);
    return rule ? t("leftOutBy", { rule: ruleLabel(rule) }) : t("in");
  };

  const addRule = (rule: string) => onWho({ ...who, leaveOut: [...who.leaveOut.filter((r) => r !== rule), rule] });
  const removeRule = (rule: string) => onWho({ ...who, leaveOut: who.leaveOut.filter((r) => r !== rule) });
  const setException = (employeeId: string, brought: boolean, reason: string) =>
    onWho({ ...who, exceptions: [...who.exceptions.filter((e) => e.employeeId !== employeeId), { employeeId, in: brought, reason }] });
  const undo = (employeeId: string) => onWho({ ...who, exceptions: who.exceptions.filter((e) => e.employeeId !== employeeId) });

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-[18px]">
        <span className="font-editorial text-[46px] font-medium leading-none tabular-nums" aria-live="polite">
          {shown}
          <small className="ms-2 font-sans text-sm font-medium text-muted-foreground">
            {company ? t("ofAt", { total: everyone.length, company, day: dayMonth(startDate, locale) }) : t("ofOn", { total: everyone.length, day: dayMonth(startDate, locale) })}
          </small>
        </span>
        <span className="ms-auto text-xs text-muted-foreground">{t("fromCoreHrKept")}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-[13px] text-muted-foreground">{t("leaveOut")}</span>
        {who.leaveOut.length === 0 ? <span className="me-1 text-[12.5px] text-muted-foreground">{t("nobodyOut")}</span> : null}
        {who.leaveOut.map((rule) => (
          <span key={rule} className="inline-flex h-[34px] items-center gap-2 rounded-control bg-inlay pe-1.5 ps-3 text-[13.5px] font-semibold animate-in fade-in-0 zoom-in-95 duration-200">
            {ruleLabel(rule)}
            <span className="font-medium tabular-nums text-muted-foreground">{caught(rule)}</span>
            <button type="button" onClick={() => removeRule(rule)} aria-label={t("removeRule", { rule: ruleLabel(rule) })} title={t("bringBack")}
              className="grid size-6 place-items-center rounded-detail text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground">
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}
        <AddRule setup={setup} startDate={startDate} rules={who.leaveOut} onAdd={addRule} />
      </div>

      <div className="grid grid-cols-1 gap-x-[22px] gap-y-[18px] md:grid-cols-3">
        {groups.map((group) => {
          const inCount = group.people.filter((p) => isIn(who, p)).length;
          return (
            <div key={group.id} className="grid content-start gap-2">
              <div className="flex items-baseline gap-2 text-[13px]">
                <b className="font-semibold">{group.name}</b>
                <span className="tabular-nums text-muted-foreground">{t("inOf", { count: inCount, total: group.people.length })}</span>
              </div>
              <div className="flex flex-wrap gap-[5px]">
                {group.people.slice(0, FACES).map((person) => {
                  const named = who.exceptions.find((e) => e.employeeId === person.employeeId);
                  const inYear = isIn(who, person);
                  return (
                    <Face key={person.employeeId} person={person} photo={person.photoUrl ? photos.get(person.photoUrl) : null}
                      inYear={inYear} named={named ?? null} open={card === person.employeeId} title={`${person.name}, ${why(person)}`}
                      onOpen={(open) => setCard(open ? person.employeeId : null)}>
                      <FaceCard person={person} photo={person.photoUrl ? photos.get(person.photoUrl) : null} inYear={inYear} named={named ?? null}
                        detail={[person.divisionId ? divisionName.get(person.divisionId) : null,
                          !named && ruledOutBy(who.leaveOut, person) ? ruleLabel(ruledOutBy(who.leaveOut, person)!).toLowerCase() : null].filter(Boolean).join(", ")}
                        onDecide={(brought, reason) => { setException(person.employeeId, brought, reason); setCard(null); }}
                        onUndo={() => { undo(person.employeeId); setCard(null); }}
                        onCancel={() => setCard(null)} />
                    </Face>
                  );
                })}
                {group.people.length > FACES ? <span className="ms-1 self-center text-[12.5px] text-muted-foreground">{t("andMore", { count: group.people.length - FACES })}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {who.exceptions.length > 0 ? (
        <div className="grid gap-0.5">
          <span className="px-2.5 pb-1 text-[12.5px] text-muted-foreground">{t("byName")}</span>
          {who.exceptions.map((named) => {
            const person = byId.get(named.employeeId);
            if (!person) return null;
            return (
              <div key={named.employeeId} className="flex items-center gap-3 rounded-inset px-2.5 py-2 hover:bg-inlay animate-in fade-in-0 duration-200">
                <PersonAvatar name={person.name} photo={person.photoUrl ? photos.get(person.photoUrl) : null} size="sm" />
                <div className="grid flex-1 gap-px text-[13.5px]">
                  <b className="font-semibold">
                    {person.name} <span className="font-medium text-muted-foreground">{named.in ? t("isIn") : t("isLeftOut")}</span>
                  </b>
                  <span className="text-[12.5px] text-muted-foreground">“{named.reason}”</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => undo(named.employeeId)}>{t("undo")}</Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {setup.cannotBeIn.length > 0 ? (
        <span className="text-[13px] text-muted-foreground">
          {t("cannotBeIn", { count: setup.cannotBeIn.length })} {setup.cannotBeIn.slice(0, 3).map((p) => p.name).join(", ")}
        </span>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 pt-1 text-[13.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-2.5">
          {t("joiners")}
          <Segmented size="sm" tone="quiet" label={t("joiners")} value={joinersJoin ? "in" : "next"} onChange={(value) => onJoiners(value === "in")}
            options={[{ value: "in", label: t("joinersIn") }, { value: "next", label: t("joinersNextYear") }]} />
        </span>
        <span className="inline-flex items-center gap-2.5">
          {t("whoLeaves")}
          <span className="text-foreground">{t("leaversOut")}</span>
        </span>
      </div>
    </div>
  );
}

function Face({ person, photo, inYear, named, open, title, onOpen, children }: {
  person: YearSetupCandidateDto;
  photo: string | null | undefined;
  inYear: boolean;
  named: WhoIsInExceptionDto | null;
  open: boolean;
  title: string;
  onOpen: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpen}>
      <PopoverTrigger asChild>
        <button type="button" title={title} aria-label={title}
          className={cn("rounded-full outline-none transition-[opacity,filter,transform] duration-[450ms] ease-out hover:scale-[1.12] hover:opacity-100 hover:grayscale-0 focus-visible:ring-2 focus-visible:ring-primary",
            !inYear && "scale-[0.86] opacity-20 grayscale",
            named?.in && "shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_var(--primary)]",
            named && !named.in && "shadow-[0_0_0_2px_var(--card),0_0_0_3.5px_color-mix(in_oklab,var(--muted-foreground)_60%,transparent)]")}>
          <PersonAvatar name={person.name} photo={photo} size="sm" className="size-7 text-[10px]" />
        </button>
      </PopoverTrigger>
      {children}
    </Popover>
  );
}

/** A face's card: leave them out or bring them in with a reason, or undo what was decided by name. */
function FaceCard({ person, photo, inYear, named, detail, onDecide, onUndo, onCancel }: {
  person: YearSetupCandidateDto;
  photo: string | null | undefined;
  inYear: boolean;
  named: WhoIsInExceptionDto | null;
  detail: string;
  onDecide: (brought: boolean, reason: string) => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("year.YearSetup");
  const [reason, setReason] = useState("");
  const first = firstName(person.name);
  return (
    <PopoverContent align="start" className="grid w-[290px] gap-2.5 rounded-[18px] p-3.5">
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={person.name} photo={photo} size="md" />
        <div className="grid">
          <b className="font-semibold">{person.name}</b>
          {detail ? <span className="text-[12.5px] text-muted-foreground">{detail}</span> : null}
        </div>
      </div>
      {named ? (
        <>
          <span className="text-[13px]">{named.in ? t("inByName", { why: named.reason }) : t("outByName", { why: named.reason })}</span>
          <Button size="sm" variant="secondary" onClick={onUndo}>{t("undo")}</Button>
        </>
      ) : (
        <>
          <Textarea rows={2} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)}
            placeholder={inYear ? t("whyOut") : t("whyIn")} aria-label={inYear ? t("whyOut") : t("whyIn")} className="min-h-0 resize-none" />
          <div className="flex gap-2">
            <Button size="sm" disabled={!reason.trim()} onClick={() => onDecide(!inYear, reason.trim())}>
              {inYear ? t("leaveOutPerson", { name: first }) : t("bringInPerson", { name: first })}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>{t("cancel")}</Button>
          </div>
        </>
      )}
    </PopoverContent>
  );
}

/** "Leave out…": a rule by employment type, leave on day one, a division, or a start date; one person is a face's card. */
function AddRule({ setup, startDate, rules, onAdd }: { setup: YearSetupDto; startDate: string; rules: string[]; onAdd: (rule: string) => void }) {
  const t = useTranslations("year.YearSetup");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "unit" | "started">("menu");
  const [after, setAfter] = useState("");
  const everyone = setup.everyone;
  const counted = (rule: string) => everyone.filter((p) => ruledOutBy([rule], p)).length;
  const types = [...new Set(everyone.map((p) => p.employmentType).filter((x): x is string => !!x))]
    .map((type) => `employmentType:${type}`).filter((rule) => !rules.includes(rule) && counted(rule) > 0);
  const add = (rule: string) => { onAdd(rule); setOpen(false); };
  const item = "grid gap-px rounded-inset px-2.5 py-[9px] text-start text-[13.5px] font-medium hover:bg-inlay focus-visible:bg-inlay outline-none";

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setView("menu"); setAfter(""); } }}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-[34px] items-center gap-1.5 rounded-control px-3 text-[13.5px] font-semibold text-primary-ink shadow-[inset_0_0_0_1px_var(--border)] hover:bg-inlay">
          <Plus aria-hidden className="size-[15px]" />
          {t("leaveOutMore")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-[300px] gap-0 rounded-[16px] p-1.5">
        {view === "menu" ? (
          <>
            {types.map((rule) => (
              <button key={rule} type="button" className={item} onClick={() => add(rule)}>
                <span>{rule.slice("employmentType:".length)}</span>
                <small className="text-xs text-muted-foreground">{t("rule.byType", { count: counted(rule) })}</small>
              </button>
            ))}
            {!rules.includes("onLeave") && counted("onLeave") > 0 ? (
              <button type="button" className={item} onClick={() => add("onLeave")}>
                <span>{t("rule.onLeave", { day: dayMonth(startDate, locale) })}</span>
                <small className="text-xs text-muted-foreground">{t("rule.byLeave", { count: counted("onLeave") })}</small>
              </button>
            ) : null}
            <button type="button" className={cn(item, "flex items-center justify-between")} onClick={() => setView("unit")}>
              <span className="grid gap-px"><span>{t("rule.aUnit")}</span><small className="text-xs text-muted-foreground">{t("rule.aUnitHint")}</small></span>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground rtl:rotate-180" />
            </button>
            <button type="button" className={cn(item, "flex items-center justify-between")} onClick={() => setView("started")}>
              <span className="grid gap-px"><span>{t("rule.started")}</span><small className="text-xs text-muted-foreground">{t("rule.byStart")}</small></span>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground rtl:rotate-180" />
            </button>
            <button type="button" className={item} onClick={() => setOpen(false)}>
              <span>{t("rule.byName")}</span>
              <small className="text-xs text-muted-foreground">{t("rule.byNameHint")}</small>
            </button>
          </>
        ) : view === "unit" ? (
          <>
            <Back onClick={() => setView("menu")} label={t("rule.aUnit")} />
            {setup.divisions.filter((d) => !rules.includes(`unit:${d.id}`)).map((division) => (
              <button key={division.id} type="button" className={cn(item, "flex items-center justify-between")} onClick={() => add(`unit:${division.id}`)}>
                <span>{division.name}</span>
                <small className="text-xs tabular-nums text-muted-foreground">{t("people", { count: counted(`unit:${division.id}`) })}</small>
              </button>
            ))}
          </>
        ) : (
          <div className="grid gap-2.5 p-1">
            <Back onClick={() => setView("menu")} label={t("rule.started")} />
            <DatePicker value={after} onChange={setAfter} max={startDate} placeholder={t("rule.pickDate")} />
            <Button size="sm" disabled={!after || counted(`startedAfter:${after}`) === 0} onClick={() => add(`startedAfter:${after}`)}>
              {after ? t("rule.leaveOutCount", { count: counted(`startedAfter:${after}`) }) : t("rule.pickDate")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Back({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded-inset px-2 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-inlay">
      <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />
      {label}
    </button>
  );
}

/** A number that counts its way to a new value, so a rule landing reads as people leaving the year. */
function useTicker(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const share = Math.min(1, (now - began) / 450);
      const next = Math.round(start + (value - start) * (1 - (1 - share) ** 3));
      from.current = next;
      setShown(next);
      if (share < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}
