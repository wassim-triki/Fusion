"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { QuickPicks } from "@repo/ds/choice";
import { Button, DatePicker, Popover, PopoverContent, PopoverTrigger, cn } from "@repo/ds";
import { useFormat } from "@repo/ds/lib/use-format";
import type { ChangePersonRef, PeopleProfileDto } from "@repo/api";
import { Plus } from "lucide-react";
import { useRefusal } from "@/i18n/words";
import { Monogram } from "../components/workforce-ui";
import { DottedMark, PersonPicker } from "./change-panel";
import { useChangeMutations } from "./use-changes";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const firstOfNextMonth = () => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

/**
 * Dotted lines sit on the reporting line itself, under the solid one: each with End, and Add as a small popover
 * (a person and a date, today by default). They change on their own, never through a change of job.
 */
export function DottedLines({ person, canEdit }: { person: PeopleProfileDto; canEdit: boolean }) {
  const t = useTranslations("changes.dotted");
  const format = useFormat();
  const refusal = useRefusal();
  const { dottedLine } = useChangeMutations(person.identity.employeeKey);
  const [adding, setAdding] = useState(false);
  const lines = person.dottedLineManagers;
  if (!lines.length && !canEdit) return null;

  const end = async (managerEmployeeId: string) => {
    try {
      await dottedLine.mutateAsync({ effectiveDate: todayIso(), managerEmployeeId, end: true });
      toast.success(t("ended"));
    } catch (caught) {
      toast.error(refusal(caught, t("failed")));
    }
  };

  return (
    <ul className="mt-1 grid">
      {lines.map((line) => (
        <li key={line.employeeKey} className="grid min-h-[54px] grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 border-t">
          <span className="grid place-items-center text-muted-foreground"><DottedMark /></span>
          <Link href={`/people/${line.employeeKey}`} className="group flex min-w-0 items-center gap-2.5">
            <Monogram name={line.displayName} photoUrl={line.photoUrl} size="sm" />
            <span className="min-w-0">
              <span className="block truncate type-label font-semibold group-hover:underline">{line.displayName}</span>
              <span className="block truncate type-meta text-muted-foreground">{t("since", { date: format.date(line.since, { year: "always" }) })}</span>
            </span>
          </Link>
          {canEdit ? (
            <Button type="button" variant="ghost" size="sm" disabled={dottedLine.isLoading} onClick={() => void end(line.employeeId)}>{t("end")}</Button>
          ) : <span />}
        </li>
      ))}
      {canEdit ? (
        <li
          className={cn(
            "grid items-center gap-3",
            lines.length > 0
              ? "grid-cols-[26px_minmax(0,1fr)] border-t pt-2"
              : "min-h-14 grid-cols-[minmax(0,1fr)_auto] rounded-surface border border-dashed px-5 py-2"
          )}
        >
          {lines.length > 0 ? <span /> : <span className="type-body text-muted-foreground">{t("none")}</span>}
          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="justify-self-start px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                <Plus className="size-3.5" /> {t("add")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[360px] p-4">
              {adding ? <AddDottedLine person={person} onDone={() => setAdding(false)} /> : null}
            </PopoverContent>
          </Popover>
        </li>
      ) : null}
    </ul>
  );
}

function AddDottedLine({ person, onDone }: { person: PeopleProfileDto; onDone: () => void }) {
  const t = useTranslations("changes");
  const format = useFormat();
  const refusal = useRefusal();
  const { dottedLine } = useChangeMutations(person.identity.employeeKey);
  const [manager, setManager] = useState<ChangePersonRef | null>(null);
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();
  const options = [today, firstOfNextMonth()];
  const taken = new Set([person.primaryManager?.employeeKey, ...person.dottedLineManagers.map((line) => line.employeeKey)]);

  const add = async () => {
    if (!manager) return;
    setError(null);
    try {
      await dottedLine.mutateAsync({ effectiveDate: date, managerEmployeeId: manager.employeeId, end: false });
      toast.success(t("dotted.added"));
      onDone();
    } catch (caught) {
      setError(refusal(caught, t("dotted.failed")));
    }
  };

  return (
    <div className="grid gap-3">
      <p className="type-label font-semibold">{t("dotted.addTitle")}</p>
      <PersonPicker date={date} value={manager} onChange={(next) => setManager(next && !taken.has(next.employeeKey) ? next : null)} excludeKey={person.identity.employeeKey} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <DatePicker value={date} min={today} onChange={(next) => { if (next) setDate(next); }} placeholder={t("when.otherDate")} />
        </div>
        <QuickPicks
          label={t("when.from")}
          value={date}
          onPick={setDate}
          options={options.map((option) => ({ value: option, label: option === today ? t("when.today") : format.date(option) }))}
        />
      </div>
      {error ? <p role="alert" className="type-meta text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="button" size="sm" disabled={!manager || dottedLine.isLoading} onClick={() => void add()}>{t("dotted.add")}</Button>
      </div>
    </div>
  );
}
