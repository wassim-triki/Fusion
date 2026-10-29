"use client";

import { useSay } from "@repo/ds/lib/say";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, CircleAlert, CircleCheck, CircleMinus, Fingerprint, Network, UserRound, UsersRound } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  cn,
} from "@repo/ds";
import { OptionCards } from "@repo/ds/choice";
import type { WorkforceImportField, WorkforceImportMatch, WorkforceMatchUpdateRequest } from "@repo/api";
import {
  COLUMN_GRID,
  MappingHead,
  MappingSection,
  MappingStatusPill,
  TYPE_GRID,
  type MatchEdits,
} from "@/features/data-import/components/match-table";
import {
  LIFECYCLE_OPTIONS,
  MAPPABLE_FIELDS,
  columnFieldChange,
  columnName,
  deriveColumnRows,
  deriveInterpretation,
  deriveLifecycleRows,
  fieldLabel,
  missingRequiredFields,
  readDate,
  sampleDate,
  type InterpretationItem,
  type InterpretationState,
} from "../model/match-view";

type Edits = MatchEdits<WorkforceMatchUpdateRequest>;

const IGNORE = "Ignored";

/** What each source column means in Fusion. Resolved rows stay quiet and correctable. */
export function WorkforceColumnMapping({ match, edits, locked }: { match: WorkforceImportMatch; edits: Edits; locked: boolean }) {
  const t = useTranslations("wfImport.match");
  const say = useSay("wfImport");
  const rows = deriveColumnRows(match);
  const missing = missingRequiredFields(match);
  const { edit, busy, pendingValue } = edits;

  async function choose(columnIndex: number, label: string, field: WorkforceImportField) {
    const { change, displaced } = columnFieldChange(match, columnIndex, field);
    const saved = await edit(`column:${columnIndex}`, field, change);
    if (saved && displaced)
      toast(t("columns.now", { field: fieldLabel(field, say), column: label }), {
        description: t("columns.ignoredNow", { column: columnName(displaced, say) }),
      });
  }

  return (
    <MappingSection id="match-columns-title" title={t("columns.title")}>
      <MappingHead grid={COLUMN_GRID} labels={[t("columns.source"), t("columns.samples"), t("columns.field"), t("columns.status")]} />
      <div role="rowgroup" className="divide-y divide-border">
        {rows.map((row) => {
          const key = `column:${row.columnIndex}`;
          const pending = pendingValue(key);
          const samples = row.samples.length ? row.samples.join(", ") : "—";
          const attention = row.status === "needs-review" && pending === undefined;
          const extra = row.field !== IGNORE && !MAPPABLE_FIELDS.some((f) => f.value === row.field);
          return (
            <div
              key={row.columnIndex}
              role="row"
              className={cn(COLUMN_GRID, "px-4 py-2", attention && "relative z-10 rounded-control bg-primary/[0.07] ring-1 ring-primary/70 ring-inset")}
            >
              <span role="rowheader" className="min-w-0">
                <span className="block truncate type-label font-semibold text-foreground" title={row.label}>
                  {row.label}
                </span>
                <span aria-hidden className="block truncate type-meta text-muted-foreground @2xl:hidden" title={samples}>
                  {samples}
                </span>
              </span>
              <span role="cell" className="hidden truncate type-meta text-muted-foreground @2xl:block" title={samples}>
                {samples}
              </span>
              <span role="cell">
                <Select
                  value={pending ?? row.field}
                  disabled={busy || locked}
                  onValueChange={(value) => void choose(row.columnIndex, row.label, value as WorkforceImportField)}
                >
                  <SelectTrigger aria-label={t("columns.fieldFor", { column: row.label })} className={cn("w-full", attention && "border-primary/70")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {extra ? <SelectItem value={row.field}>{fieldLabel(row.field, say)}</SelectItem> : null}
                    {MAPPABLE_FIELDS.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {fieldLabel(field.value, say)}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={IGNORE}>{t("columns.ignore")}</SelectItem>
                  </SelectContent>
                </Select>
              </span>
              <span role="cell">
                <MappingStatusPill status={row.status} pending={pending !== undefined} />
              </span>
            </div>
          );
        })}
        {missing.map((field) => (
          <div key={field} role="row" className="flex items-center gap-2 bg-primary/[0.06] px-4 py-2.5 type-meta text-primary-foreground dark:text-primary">
            <CircleAlert aria-hidden className="size-4 shrink-0 fill-primary stroke-card" strokeWidth={2.25} />
            <span role="cell">
              {t.rich("columns.missing", { field: fieldLabel(field, say), b: (chunks) => <span className="font-semibold">{chunks}</span> })}
            </span>
          </div>
        ))}
      </div>
    </MappingSection>
  );
}

/**
 * What each distinct employment status in the file means: an active employee is imported, a
 * former one is not. One decision per value covers every row carrying it.
 */
export function WorkforceStatusMeaning({ match, edits, locked }: { match: WorkforceImportMatch; edits: Edits; locked: boolean }) {
  const t = useTranslations("wfImport.match");
  const rows = deriveLifecycleRows(match);
  const { edit, busy, pendingValue } = edits;
  if (rows.length === 0) return null;

  return (
    <MappingSection
      id="match-status-meaning-title"
      title={t("statuses.title")}
      description={t("statuses.description")}
    >
      <MappingHead grid={TYPE_GRID} labels={[t("statuses.source"), t("statuses.people"), t("statuses.fusion"), t("statuses.status")]} />
      <div role="rowgroup" className="divide-y divide-border">
        {rows.map((row) => {
          const key = `status:${row.sourceValue}`;
          const pending = pendingValue(key);
          const attention = row.status === "needs-review" && pending === undefined;
          return (
            <div
              key={row.sourceValue}
              role="row"
              className={cn(TYPE_GRID, "px-4 py-2", attention && "relative z-10 rounded-control bg-primary/[0.07] ring-1 ring-primary/70 ring-inset")}
            >
              <span role="rowheader" className="flex min-w-0 items-center gap-2">
                {attention ? <CircleAlert aria-hidden className="size-4.5 shrink-0 fill-primary stroke-card" strokeWidth={2.25} /> : null}
                <span className="min-w-0">
                  <span className="block truncate type-label font-semibold text-foreground" title={row.sourceValue}>
                    {row.sourceValue}
                  </span>
                  <span aria-hidden className="block type-meta text-muted-foreground tabular-nums @2xl:hidden">
                    {row.occurrences} {row.occurrences === 1 ? "person" : "people"}
                  </span>
                </span>
              </span>
              <span role="cell" className="hidden type-meta text-foreground tabular-nums @2xl:block">
                {row.occurrences}
              </span>
              <span role="cell">
                <Select
                  value={pending ?? row.meaning ?? ""}
                  disabled={busy || locked}
                  onValueChange={(meaning) => void edit(key, meaning, { lifecycleVocabulary: { [row.sourceValue]: meaning as "Active" | "Former" } })}
                >
                  <SelectTrigger aria-label={t("statuses.stateFor", { value: row.sourceValue })} className={cn("w-full", attention && "border-primary/70")}>
                    <SelectValue placeholder={t("statuses.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(`statuses.${option.value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
              <span role="cell">
                <MappingStatusPill status={row.status} pending={pending !== undefined} />
              </span>
            </div>
          );
        })}
      </div>
    </MappingSection>
  );
}

const ITEM_ICON: Record<InterpretationItem["key"], typeof Fingerprint> = {
  identity: Fingerprint,
  names: UserRound,
  organization: Network,
  manager: UsersRound,
  dates: CalendarDays,
};

/**
 * How Fusion reads the workforce concepts the file carries. Each concept states what it is using;
 * one that needs the administrator hosts its own decision in place.
 */
export function WorkforceInterpretationPanel({ match, edits, locked }: { match: WorkforceImportMatch; edits: Edits; locked: boolean }) {
  const t = useTranslations("wfImport.match");
  const say = useSay("wfImport");
  // Settled concepts pair up; a concept hosting a decision takes the full width after them, and an
  // unpaired settled concept widens so the grid never leaves an empty cell.
  const all = deriveInterpretation(match, say);
  const settled = all.filter((item) => !item.decision);
  const deciding = all.filter((item) => item.decision);
  return (
    <section aria-labelledby="match-interpretation-title" className="rounded-surface border border-border bg-card p-4">
      <header className="px-1">
        <h2 id="match-interpretation-title" className="type-section-title text-foreground">
          {t("interpretation.title")}
        </h2>
      </header>
      <ul className="mt-3 grid gap-px overflow-hidden rounded-control border border-border bg-border md:grid-cols-2">
        {[...settled, ...deciding].map((item, index) => (
          <InterpretationRow
            key={item.key}
            item={item}
            wide={Boolean(item.decision) || (settled.length % 2 === 1 && index === settled.length - 1)}
            match={match}
            edits={edits}
            locked={locked}
          />
        ))}
      </ul>
    </section>
  );
}

function InterpretationRow({
  item,
  wide,
  match,
  edits,
  locked,
}: {
  item: InterpretationItem;
  wide: boolean;
  match: WorkforceImportMatch;
  edits: Edits;
  locked: boolean;
}) {
  const Icon = ITEM_ICON[item.key];
  const attention = item.state === "needs-review";
  return (
    <li className={cn("flex gap-3 bg-card px-3 py-3", wide && "md:col-span-2", attention && "bg-primary/[0.05]")}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4.5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 type-label font-semibold text-foreground">{item.title}</p>
          <InterpretationPill state={item.state} />
        </div>
        <p className="mt-0.5 type-meta text-muted-foreground">{item.detail}</p>
        {item.decision ? <InterpretationDecision kind={item.decision} match={match} edits={edits} locked={locked} /> : null}
      </div>
    </li>
  );
}

const PILL: Record<InterpretationState, { Icon: typeof CircleCheck; tone: string; icon: string }> = {
  understood: { Icon: CircleCheck, tone: "text-success", icon: "fill-success stroke-card" },
  "needs-review": {
    Icon: CircleAlert,
    tone: "text-primary-foreground dark:text-primary",
    icon: "fill-primary stroke-card",
  },
  optional: { Icon: CircleMinus, tone: "text-muted-foreground", icon: "fill-muted-foreground stroke-card" },
};

function InterpretationPill({ state }: { state: InterpretationState }) {
  const t = useTranslations("wfImport.match.pill");
  const { Icon, tone, icon } = PILL[state];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 type-meta font-medium", tone)}>
      <Icon aria-hidden className={cn("size-4", icon)} strokeWidth={2.25} />
      {t(state)}
    </span>
  );
}

function InterpretationDecision({
  kind,
  match,
  edits,
  locked,
}: {
  kind: NonNullable<InterpretationItem["decision"]>;
  match: WorkforceImportMatch;
  edits: Edits;
  locked: boolean;
}) {
  const t = useTranslations("wfImport.match");
  const say = useSay("wfImport");
  const locale = useLocale();
  const { edit, busy, pendingValue } = edits;
  const disabled = busy || locked;

  if (kind === "identity") {
    const candidates = match.columns.filter((c) => c.nonEmptyCount > 0 && (!c.resolved || c.field === "Ignored"));
    const pending = pendingValue("identity");
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select
          value={pending ?? ""}
          disabled={disabled || candidates.length === 0}
          onValueChange={(index) => void edit("identity", index, { columnMappings: { [Number(index)]: "EmployeeNumber" } })}
        >
          <SelectTrigger aria-label={t("interpretation.identifierColumn")} className="w-full max-w-xs border-primary/70">
            <SelectValue placeholder={candidates.length ? t("interpretation.chooseIdentifier") : t("interpretation.noUnused")} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((c) => (
              <SelectItem key={c.columnIndex} value={String(c.columnIndex)}>
                {columnName(c, say)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {match.generateAllAllowed ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void edit("identity", "generate", { identityStrategy: "GenerateAll" })}>
            {t("interpretation.generate")}
          </Button>
        ) : null}
      </div>
    );
  }

  const sample = kind === "date-format" ? sampleDate(match) : null;
  const choices =
    kind === "date-format"
      ? [
          { key: "DayMonthYear", primary: t("interpretation.dayMonthYear"), reading: readDate(sample, "DayMonthYear", locale), change: { dateFormat: "DayMonthYear" } as const },
          { key: "MonthDayYear", primary: t("interpretation.monthDayYear"), reading: readDate(sample, "MonthDayYear", locale), change: { dateFormat: "MonthDayYear" } as const },
        ]
      : [
          { key: "LastCommaFirst", primary: t("interpretation.lastCommaFirst"), reading: "Doe, John", change: { nameFormat: "LastCommaFirst" } as const },
          { key: "FirstLast", primary: t("interpretation.firstLast"), reading: "John Doe", change: { nameFormat: "FirstLast" } as const },
        ];
  const pending = pendingValue(kind);
  return (
    <div className="mt-3">
      {sample ? (
        <p className="mb-2 type-meta text-muted-foreground">
          {t.rich("interpretation.inYourFile", { sample, b: (chunks) => <span className="font-medium text-foreground tabular-nums">{chunks}</span> })}
        </p>
      ) : null}
      <OptionCards
        columns={2}
        className="max-w-md"
        label={kind === "date-format" ? t("interpretation.dateFormat") : t("interpretation.nameFormat")}
        value={pending}
        disabled={disabled}
        onChange={(key) => {
          const choice = choices.find((item) => item.key === key);
          if (choice) void edit(kind, choice.key, choice.change);
        }}
        options={choices.map((choice) => ({ value: choice.key, label: choice.primary, description: choice.reading }))}
      />
    </div>
  );
}
