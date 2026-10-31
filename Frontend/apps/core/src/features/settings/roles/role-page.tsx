"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Crown, Lock, MoreHorizontal, Plus, X } from "lucide-react";
import {
  ApiError,
  type FusionSettingsSection,
  type RoleAreaDto,
  type RoleCellDto,
  type RoleConditionDto,
  type RoleConditionKind,
  type RoleDetailDto,
  type RoleHolderKind,
  type RoleLevel,
  type RoleReach,
} from "@repo/api";
import { useTenantSummary } from "@repo/api/query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Input,
  Label,
  PersonAvatar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@repo/ds";
import { LastChange, PageError, ViewOnlyBadge } from "@repo/ds/shell";
import { useDeleteRole, useRole, useRoleCandidates, useSaveRole } from "@/features/settings/api/use-core-access";
import { useSaveFailure, useSettingsSay, type Say } from "@/features/settings/say";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";
import {
  cellOf,
  cellsToSave,
  changedAreas,
  levelsOf,
  reachesOf,
  setCell,
  toCells,
  type Cells,
} from "./role-model";
import { AreaGroupTitle } from "./roles-table";
import { RolePreview } from "./role-preview";
import { useRuleValues, type RuleValue, type RuleValues } from "./role-words";

const GROUPS = ["core", "performance", "company"] as const;
const KINDS: RoleConditionKind[] = ["department", "job", "place", "unit"];

interface ChosenPerson {
  userId: string;
  name: string;
}

/** What one save sends, kept as the page's draft. */
interface Draft {
  name: string;
  cells: Cells;
  holderKind: RoleHolderKind;
  conditions: RoleConditionDto[];
  chosen: ChosenPerson[];
}

function draftOf(detail: RoleDetailDto): Draft {
  return {
    name: detail.role.name,
    cells: toCells(detail.role.cells),
    holderKind: detail.role.holderKind,
    conditions: detail.role.conditions,
    chosen: detail.holders.filter((holder) => holder.isChosen).map((holder) => ({ userId: holder.userId, name: holder.name })),
  };
}

function sameDraft(a: Draft, b: Draft, areas: RoleAreaDto[]): boolean {
  const key = (draft: Draft) =>
    JSON.stringify({
      name: draft.name,
      cells: cellsToSave(areas, draft.cells),
      holderKind: draft.holderKind,
      conditions: [...draft.conditions].map((condition) => `${condition.kind}:${condition.targetId}`).sort(),
      chosen: draft.chosen.map((person) => person.userId).sort(),
    });
  return key(a) === key(b);
}

// ── What it can do ──

// The drawing's chip language (B-216): picks are 30px, condition chips and add buttons 32px, both plain-rounded
// below the radius roles.
// eslint-disable-next-line no-restricted-syntax -- the drawing's pick radius
const PICK = "inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-border bg-inlay ps-2.5 pe-[9px]";
// eslint-disable-next-line no-restricted-syntax -- the drawing's condition chip radius
const CHIP = "inline-flex h-8 max-w-full items-stretch overflow-hidden rounded-[11px] border border-border bg-inlay type-control text-foreground";
// eslint-disable-next-line no-restricted-syntax -- the drawing's add button radius
const ADD = "inline-flex h-8 shrink-0 items-center gap-[5px] rounded-[11px] border border-dashed border-input px-2.5 type-control text-muted-foreground outline-none transition-colors hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:text-foreground";
const SEGMENT = "inline-flex min-w-0 items-center gap-1.5 border-s border-border px-2.5 first:border-s-0";

function Pick({
  label,
  value,
  shown,
  options,
  onChange,
  muted,
  flash,
}: {
  label: string;
  value: string;
  /** What the pick reads when it differs from the option's menu label. */
  shown?: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  muted?: boolean;
  flash?: boolean;
}) {
  const current = shown ?? options.find((option) => option.value === value)?.label ?? value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          PICK,
          "outline-none transition-colors hover:border-input focus-visible:ring-2 focus-visible:ring-ring aria-expanded:border-input",
          muted ? "type-control-label text-muted-foreground" : "type-control-strong text-foreground",
          flash && "animate-pick-flash"
        )}
      >
        {current}
        <ChevronDown aria-hidden className="size-[13px] text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A pick as it reads to someone who can't change it. */
function Fixed({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <span className={cn(PICK, muted ? "type-control-label text-muted-foreground" : "type-control-strong text-foreground")}>{children}</span>;
}

function Sentence({
  area,
  cell,
  role,
  editable,
  flash,
  onChange,
  say,
}: {
  area: RoleAreaDto;
  cell: RoleCellDto;
  role: string;
  editable: boolean;
  flash: boolean;
  onChange: (cell: RoleCellDto) => void;
  say: Say;
}) {
  const what = say(`roles.areas.${area.id}.what`);
  const row = "flex min-h-[54px] flex-wrap items-center gap-2 border-t border-border py-2 type-body first:border-t-0";
  if (area.administratorsOnly) {
    return (
      <li className={row}>
        <Fixed muted>
          <Lock aria-hidden className="size-[13px]" />
          {say("roles.administratorsOnly")}
        </Fixed>
        <span className="text-muted-foreground">{what}</span>
      </li>
    );
  }

  const off = cell.level === "none";
  const reaches = reachesOf(area, cell.level);
  const chooseLevel = (level: string) => {
    const options = reachesOf(area, level as RoleLevel);
    const reach = options.length === 0 ? null : options.includes(cell.reach as RoleReach) ? cell.reach : options[options.length - 1]!;
    onChange({ areaId: area.id, level: level as RoleLevel, reach });
  };

  return (
    <li className={row}>
      {editable ? (
        <Pick
          label={say("roles.levelOf", { role, what })}
          value={cell.level}
          muted={off}
          flash={flash}
          options={levelsOf(area).map((level) => ({ value: level, label: say(`roles.levels.${level}`) }))}
          onChange={chooseLevel}
        />
      ) : (
        <Fixed muted={off}>{say(`roles.levels.${cell.level}`)}</Fixed>
      )}
      <span className={off ? "text-muted-foreground" : "text-foreground"}>{what}</span>
      {!off && cell.reach ? (
        <>
          <span className="text-muted-foreground">{say("roles.for")}</span>
          {editable && reaches.length > 1 ? (
            <Pick
              label={say("roles.reachOf", { what })}
              value={cell.reach}
              flash={flash}
              options={reaches.map((reach) => ({ value: reach, label: say(`roles.reaches.${reach}`) }))}
              onChange={(reach) => onChange({ ...cell, reach: reach as RoleReach })}
            />
          ) : (
            <Fixed>{say(`roles.reaches.${cell.reach}`)}</Fixed>
          )}
        </>
      ) : null}
    </li>
  );
}

// ── Who has it ──

/** The values a condition matches, toggled in one list; the last one out removes the condition. */
function ValueToggle({
  kind,
  values,
  chosen,
  editable,
  names,
  onToggle,
  say,
}: {
  kind: RoleConditionKind;
  values: RuleValue[];
  chosen: string[];
  editable: boolean;
  names: Map<string, string>;
  onToggle: (id: string) => void;
  say: Say;
}) {
  const [open, setOpen] = useState(false);
  const kindWord = say(`roles.conditionKinds.${kind}`).toLowerCase();
  const shown = (
    <>
      {chosen.map((id, index) => (
        <span key={id} className="inline-flex min-w-0 items-center gap-1.5">
          {index > 0 ? <span className="text-muted-foreground">{say("roles.or")}</span> : null}
          <b className="truncate font-semibold">{names.get(id) ?? say("roles.unknownValue")}</b>
        </span>
      ))}
    </>
  );
  if (!editable) return <span className={SEGMENT}>{shown}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={say("roles.addValue", { kind: kindWord })}
        className={cn(SEGMENT, "outline-none hover:bg-card focus-visible:bg-card aria-expanded:bg-card")}
      >
        {shown}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={say("roles.findValue", { kind: kindWord })} />
          <CommandList>
            <CommandEmpty>{say("roles.noValues")}</CommandEmpty>
            {values.map((value) => (
              <CommandItem key={value.id} value={`${value.name} ${value.detail ?? ""} ${value.id}`} onSelect={() => onToggle(value.id)}>
                <span className="truncate">{value.name}</span>
                {value.detail ? <span className="ms-auto truncate type-meta text-muted-foreground">{value.detail}</span> : null}
                <Check aria-hidden className={cn("size-3.5 shrink-0", value.detail ? "" : "ms-auto", chosen.includes(value.id) ? "opacity-100" : "opacity-0")} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RemoveSegment({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onRemove}
      className="inline-flex items-center border-s border-border px-2 text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:bg-card"
    >
      <X aria-hidden className="size-[13px]" />
    </button>
  );
}

function PersonPicker({ taken, onPick, say }: { taken: Set<string>; onPick: (person: ChosenPerson) => void; say: Say }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const candidates = useRoleCandidates(search, open);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={ADD}>
        <Plus aria-hidden className="size-[13px]" />
        {say("roles.person")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={say("roles.findPerson")} value={search} onValueChange={setSearch} />
          <CommandList>
            {candidates.data && candidates.data.length === 0 ? <CommandEmpty>{say("roles.nobodyFound")}</CommandEmpty> : null}
            {(candidates.data ?? [])
              .filter((candidate) => !taken.has(candidate.userId))
              .map((candidate) => (
                <CommandItem
                  key={candidate.userId}
                  value={candidate.userId}
                  onSelect={() => {
                    onPick({ userId: candidate.userId, name: candidate.name });
                    setOpen(false);
                  }}
                >
                  <PersonAvatar name={candidate.name} size="xs" />
                  <span className="truncate">{candidate.name}</span>
                  {candidate.email ? <span className="ms-auto truncate type-meta text-muted-foreground">{candidate.email}</span> : null}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One part of "Who has it": a short muted label (or the holder kind's pick) in the shared first column, then its chips. */
function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex min-h-8 items-center">
        {typeof label === "string" ? <span className="type-meta text-muted-foreground">{label}</span> : label}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </>
  );
}

const HOLDER_KINDS = ["everyone", "team", "rule", "chosen"] as const;

function WhoHasIt({
  detail,
  draft,
  editable,
  dirtyHolders,
  values,
  names,
  onChange,
  say,
}: {
  detail: RoleDetailDto;
  draft: Draft;
  editable: boolean;
  dirtyHolders: boolean;
  values: RuleValues;
  names: Map<string, string>;
  onChange: (change: Partial<Draft>) => void;
  say: Say;
}) {
  const [showAll, setShowAll] = useState(false);
  const kindsInRule = KINDS.filter((kind) => draft.conditions.some((condition) => condition.kind === kind));
  const ruleCount = detail.holders.filter((holder) => holder.byRule).length;
  const chosenCount = detail.holders.filter((holder) => holder.isChosen).length;
  const chosenIds = new Set(draft.chosen.map((person) => person.userId));

  const kindLabel = (kind: RoleHolderKind) => (kind === "rule" ? say("roles.rule") : say(`roles.holders.${kind}`));
  const setKind = (kind: RoleHolderKind) =>
    onChange({
      holderKind: kind,
      conditions: kind === "rule" ? draft.conditions : [],
      chosen: kind === "everyone" ? [] : draft.chosen,
    });
  const toggleValue = (kind: RoleConditionKind, targetId: string) => {
    const has = draft.conditions.some((condition) => condition.kind === kind && condition.targetId === targetId);
    onChange({
      conditions: has
        ? draft.conditions.filter((condition) => !(condition.kind === kind && condition.targetId === targetId))
        : [...draft.conditions, { kind, targetId }],
    });
  };

  const kindPick = editable ? (
    <Pick
      label={say("roles.holderKind", { kind: kindLabel(draft.holderKind) })}
      value={draft.holderKind}
      shown={kindLabel(draft.holderKind)}
      options={HOLDER_KINDS.map((kind) => ({ value: kind, label: say(`roles.holders.${kind}`) }))}
      onChange={(kind) => setKind(kind as RoleHolderKind)}
    />
  ) : (
    <span className="shrink-0 type-meta text-muted-foreground">{kindLabel(draft.holderKind)}</span>
  );

  const people = (
    <>
      {draft.chosen.map((person) => (
        <span key={person.userId} className={CHIP}>
          <span className={SEGMENT}>
            <PersonAvatar name={person.name} size="xs" className="size-5" />
            <b className="truncate font-semibold">{person.name}</b>
          </span>
          {editable ? (
            <RemoveSegment
              label={say("roles.remove", { name: person.name })}
              onRemove={() => onChange({ chosen: draft.chosen.filter((item) => item.userId !== person.userId) })}
            />
          ) : null}
        </span>
      ))}
      {editable ? <PersonPicker taken={chosenIds} say={say} onPick={(person) => onChange({ chosen: [...draft.chosen, person] })} /> : null}
    </>
  );

  return (
    <section aria-labelledby="role-holders" className="grid gap-3.5">
      <h2 id="role-holders" className="type-section-title">{say("roles.whoHasIt")}</h2>
      <div className="grid gap-4 rounded-surface bg-card px-[22px] py-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-4">
        <Line label={kindPick}>
          {draft.holderKind === "rule" ? (
            <>
              {kindsInRule.map((kind, index) => {
                const inKind = draft.conditions.filter((condition) => condition.kind === kind).map((condition) => condition.targetId);
                const kindName = say(`roles.conditionKinds.${kind}`);
                return (
                  <span key={kind} className="inline-flex max-w-full items-center gap-2">
                    {index > 0 ? <span className="type-control text-muted-foreground">{say("roles.and")}</span> : null}
                    <span className={CHIP}>
                      <span className={cn(SEGMENT, "text-muted-foreground")}>{kindName}</span>
                      <span className={cn(SEGMENT, "text-muted-foreground")}>{say("roles.is")}</span>
                      <ValueToggle
                        kind={kind}
                        values={values[kind]}
                        chosen={inKind}
                        editable={editable}
                        names={names}
                        onToggle={(id) => toggleValue(kind, id)}
                        say={say}
                      />
                      {editable ? (
                        <RemoveSegment
                          label={say("roles.remove", { name: kindName })}
                          onRemove={() => onChange({ conditions: draft.conditions.filter((condition) => condition.kind !== kind) })}
                        />
                      ) : null}
                    </span>
                  </span>
                );
              })}
              {editable && kindsInRule.length < KINDS.length ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className={ADD}>
                    <Plus aria-hidden className="size-[13px]" />
                    {say("roles.condition")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {KINDS.filter((kind) => !kindsInRule.includes(kind)).map((kind) => (
                      <ValueMenu key={kind} kind={kind} values={values[kind]} say={say}
                        onPick={(targetId) => onChange({ conditions: [...draft.conditions, { kind, targetId }] })} />
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : draft.holderKind === "chosen" ? (
            people
          ) : null}
        </Line>

        {(draft.holderKind === "rule" || draft.holderKind === "team") && (editable || draft.chosen.length > 0) ? (
          <Line label={say("roles.also")}>{people}</Line>
        ) : null}
        </div>

        <div className={cn("grid gap-3 border-t border-border pt-3.5", dirtyHolders && "opacity-60")}>
          <div className="flex flex-wrap items-center gap-3">
            {detail.holders.length ? (
              <span className="flex">
                {detail.holders.slice(0, 6).map((holder, index) => (
                  <PersonAvatar key={holder.userId} name={holder.name} size="sm" className={cn("size-7 ring-2 ring-card", index > 0 && "-ms-2")} />
                ))}
              </span>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="type-label text-foreground">{say("roles.people", { count: detail.holders.length })}</span>
              {dirtyHolders ? (
                <span className="type-meta text-muted-foreground">{say("roles.updatesOnSave")}</span>
              ) : ruleCount || chosenCount ? (
                <span className="type-meta text-muted-foreground">
                  {say("roles.fromRule", { rule: ruleCount, chosen: chosenCount, both: ruleCount && chosenCount ? "yes" : "no" })}
                </span>
              ) : null}
            </div>
            {detail.holders.length ? (
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((value) => !value)}
                className="inline-flex items-center gap-1 rounded-control-sm type-control-label text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showAll ? say("roles.hideThem") : say("roles.showThem")}
                <ArrowRight aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform rtl:rotate-180", showAll && "rotate-90 rtl:rotate-90")} />
              </button>
            ) : null}
          </div>
          {showAll ? (
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {detail.holders.map((holder) => (
                <li key={holder.userId} className="flex min-w-0 items-center gap-2">
                  <PersonAvatar name={holder.name} size="xs" />
                  <span className="truncate type-body text-foreground">{holder.name}</span>
                  <span className="ms-auto shrink-0 type-meta text-muted-foreground">
                    {[holder.byRule ? say("roles.byRule") : null, holder.isChosen ? say("roles.chosenTag") : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** "+ Condition": a kind, then its value, in one menu. */
function ValueMenu({ kind, values, onPick, say }: { kind: RoleConditionKind; values: RuleValue[]; onPick: (id: string) => void; say: Say }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setOpen(true); }}>
          {say(`roles.conditionKinds.${kind}`)}
        </DropdownMenuItem>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={say("roles.findValue", { kind: say(`roles.conditionKinds.${kind}`).toLowerCase() })} />
          <CommandList>
            <CommandEmpty>{say("roles.noValues")}</CommandEmpty>
            {values.map((value) => (
              <CommandItem key={value.id} value={`${value.name} ${value.detail ?? ""} ${value.id}`} onSelect={() => { onPick(value.id); setOpen(false); }}>
                <span className="truncate">{value.name}</span>
                {value.detail ? <span className="ms-auto truncate type-meta text-muted-foreground">{value.detail}</span> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── The page ──

function RenameDialog({ open, name, onOpenChange, onRename, say }: { open: boolean; name: string; onOpenChange: (open: boolean) => void; onRename: (name: string) => void; say: Say }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name, open]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) {
      onRename(value.trim());
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{say("roles.renameTitle", { role: name })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-name">{say("roles.name")}</Label>
            <Input id="role-name" value={value} maxLength={100} autoFocus onChange={(event) => setValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{say("roles.cancel")}</Button>
            <Button type="submit" disabled={!value.trim()}>{say("roles.renameAction")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Frame({ back, title, meta, aside, children }: { back: string; title: ReactNode; meta?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-6 pt-8 pb-16">
      <Link href="/settings/roles" className="mb-3 inline-flex items-center gap-1.5 rounded-control-sm type-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft aria-hidden className="size-3.5 rtl:rotate-180" />
        {back}
      </Link>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="type-page-title">{title}</h1>
          {meta}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2">{aside}</div>
      </header>
      {children}
    </div>
  );
}

function AdministratorsRole({ detail, say, editable }: { detail: RoleDetailDto; say: Say; editable: boolean }) {
  const company = useTenantSummary().data?.name;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="admins-who" className="flex flex-col gap-3">
        <h2 id="admins-who" className="type-section-title">{say("roles.whoHasIt")}</h2>
        <ul className="flex flex-col divide-y divide-border rounded-surface bg-card">
          {detail.holders.map((holder) => (
            <li key={holder.userId} className="flex items-center gap-3 px-5 py-3.5">
              <PersonAvatar name={holder.name} size="md" />
              <span className="type-label text-foreground">{holder.name}</span>
            </li>
          ))}
        </ul>
        {editable ? (
          <a href="/core/access" className="self-start type-label text-primary underline-offset-4 hover:underline">
            {say("roles.administrators.manage")}
          </a>
        ) : null}
      </section>
      <section aria-labelledby="admins-what" className="flex flex-col gap-3">
        <h2 id="admins-what" className="type-section-title">{say("roles.whatItCanDo", { role: say("roles.administrators.name") })}</h2>
        <div className="flex items-center gap-4 rounded-surface bg-card px-5 py-4">
          <span className="grid size-10 place-items-center rounded-control bg-inlay text-foreground">
            <Crown aria-hidden className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="type-label text-foreground">
              {company ? say("roles.administrators.everythingAt", { company }) : say("roles.administrators.everything")}
            </span>
            <span className="type-meta text-muted-foreground">{say("roles.administrators.line")}</span>
          </div>
          <Lock aria-hidden className="size-4 text-muted-foreground" />
        </div>
      </section>
    </div>
  );
}

function RoleEditor({ roleId, section }: { roleId: string; section: FusionSettingsSection }) {
  const say = useSettingsSay();
  const failure = useSaveFailure();
  const router = useRouter();
  const role = useRole(roleId);
  const save = useSaveRole(roleId);
  const remove = useDeleteRole(roleId, { onSuccess: () => router.push("/settings/roles") });
  const { values, names } = useRuleValues();
  const detail = role.data;
  useBreadcrumbLabel(roleId, detail ? (detail.role.isAdministrators ? say("roles.administrators.name") : detail.role.name) : undefined);
  const editable = section.access === "manage" && Boolean(detail) && !detail!.role.isAdministrators && !detail!.role.isLocked;

  const saved = useMemo(() => (detail ? draftOf(detail) : null), [detail]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  if (role.error && !detail) {
    const missing = role.error instanceof ApiError && role.error.status === 404;
    return (
      <Frame back={say("roles.back")} title={say("roles.title")}>
        <PageError title={missing ? say("roles.notFound") : say("roles.didNotLoad")} onRetry={missing ? undefined : () => void role.refetch()} />
      </Frame>
    );
  }

  if (!detail || !draft || !saved) {
    return (
      <Frame back={say("roles.back")} title={<Skeleton className="h-9 w-48" />}>
        <div className="grid gap-[30px] lg:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex flex-col gap-6">
            <Skeleton className="h-40 w-full rounded-surface" />
            <Skeleton className="h-96 w-full rounded-surface" />
          </div>
          <Skeleton className="h-[28rem] w-full rounded-surface" />
        </div>
      </Frame>
    );
  }

  const areas = detail.areas;
  const roleName = detail.role.isAdministrators ? say("roles.administrators.name") : draft.name;
  const dirty = !sameDraft(draft, saved, areas);
  const dirtyHolders =
    draft.holderKind !== saved.holderKind
    || JSON.stringify(draft.conditions) !== JSON.stringify(saved.conditions)
    || JSON.stringify(draft.chosen) !== JSON.stringify(saved.chosen);
  const update = (change: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...change } : current));
  const changeCell = (cell: RoleCellDto) => {
    const next = setCell(areas, draft.cells, cell);
    const moved = changedAreas(draft.cells, next).filter((id) => id !== cell.areaId);
    update({ cells: next });
    if (moved.length) {
      setFlash(new Set(moved));
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(new Set()), 1600);
    }
  };
  const stale = save.error instanceof ApiError && save.error.status === 409;
  const submit = () =>
    save.mutate({
      version: detail.role.version,
      input: {
        name: draft.name,
        description: detail.role.description,
        cells: cellsToSave(areas, draft.cells),
        holderKind: draft.holderKind,
        conditions: draft.holderKind === "rule" ? draft.conditions : [],
        chosenUserIds: draft.holderKind === "everyone" ? [] : draft.chosen.map((person) => person.userId),
      },
    });

  const actions = editable ? (
    <>
      {dirty ? <span className="type-meta text-muted-foreground">{say("roles.unsaved")}</span> : null}
      {dirty ? (
        <Button variant="ghost" disabled={save.isLoading} onClick={() => { save.reset(); setDraft(saved); }}>
          {say("roles.discard")}
        </Button>
      ) : null}
      <Button disabled={!dirty || save.isLoading || (draft.holderKind === "rule" && draft.conditions.length === 0)} onClick={submit}>
        {save.isLoading ? say("roles.saving") : say("roles.save")}
      </Button>
      {!detail.role.isBuiltIn ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={say("roles.more")}>
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>{say("roles.rename")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>{say("roles.delete")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  ) : section.access !== "manage" ? (
    <ViewOnlyBadge />
  ) : null;

  return (
    <Frame
      back={say("roles.back")}
      title={roleName}
      meta={section.lastChange ? <LastChange change={section.lastChange} /> : null}
      aside={actions}
    >
      {save.error ? (
        <div role="alert" className="-mt-4 mb-6 flex flex-wrap items-center gap-3 type-body text-destructive">
          {stale ? say("roles.stale") : failure(save.error, say("roles.notSaved"))}
          {stale ? (
            <Button variant="outline" size="sm" onClick={() => { save.reset(); void role.refetch(); }}>
              {say("roles.reload")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {detail.role.isAdministrators ? (
        <AdministratorsRole detail={detail} say={say} editable={section.access === "manage"} />
      ) : (
        <div className="grid items-start gap-[30px] lg:grid-cols-[minmax(0,1fr)_440px]">
          <div className="grid min-w-0 gap-7">
            <WhoHasIt
              detail={detail}
              draft={draft}
              editable={editable}
              dirtyHolders={dirtyHolders}
              values={values}
              names={names}
              onChange={update}
              say={say}
            />
            <section aria-labelledby="role-areas" className="grid gap-3.5">
              <h2 id="role-areas" className="type-section-title">{say("roles.whatItCanDo", { role: roleName })}</h2>
              <div className="rounded-surface bg-card py-1.5">
                {GROUPS.map((group) => {
                  const rows = areas.filter((area) => area.group === group);
                  if (!rows.length) return null;
                  return (
                    <div key={group}>
                      <div className="px-[22px] pt-4">
                        <AreaGroupTitle group={group} say={say} />
                      </div>
                      <ul className="grid px-[22px] pt-1 pb-1.5">
                        {rows.map((area) => (
                          <Sentence
                            key={area.id}
                            area={area}
                            cell={cellOf(draft.cells, area.id)}
                            role={roleName}
                            editable={editable}
                            flash={flash.has(area.id)}
                            onChange={changeCell}
                            say={say}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          <RolePreview roleName={roleName} areas={areas} cells={draft.cells} holders={detail.holders} canSearch={section.access === "manage"} />
        </div>
      )}

      {editable ? (
        <>
          <RenameDialog open={renaming} name={draft.name} onOpenChange={setRenaming} onRename={(name) => update({ name })} say={say} />
          <AlertDialog open={deleting} onOpenChange={setDeleting}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{say("roles.deleteTitle", { role: draft.name })}</AlertDialogTitle>
                <AlertDialogDescription>{say("roles.deleteBody", { count: detail.holders.length })}</AlertDialogDescription>
              </AlertDialogHeader>
              {remove.error ? <p role="alert" className="type-meta text-destructive">{failure(remove.error, say("roles.notDeleted"))}</p> : null}
              <AlertDialogFooter>
                <AlertDialogCancel>{say("roles.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={(event) => {
                    event.preventDefault();
                    remove.mutate();
                  }}
                >
                  {say("roles.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </Frame>
  );
}

/** Settings › Roles › one role: who has it, what it can do as sentences, and a real person's page as they'd see it. */
export function RolePage({ roleId, section }: { roleId: string; section: FusionSettingsSection }) {
  return <RoleEditor roleId={roleId} section={section} />;
}
