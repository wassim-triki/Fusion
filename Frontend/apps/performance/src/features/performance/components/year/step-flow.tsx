"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@repo/ds";
import { StateWord } from "@repo/ds/shell";
import { PersonInitials } from "@repo/performance-ui";

export type FlowTone = "ok" | "pr" | "wa" | "mu";

export interface FlowPerson {
  employeeId: string;
  name: string;
  unitName?: string | null;
}

/** One step people move through (D-55): its count, a share bar, the faces in it. */
export interface FlowColumn {
  key: string;
  label: string;
  tone: FlowTone;
  count: number;
  people: FlowPerson[];
  here?: boolean;
  /** Before anyone reached it (D-56): an outline of where people will go, this many places drawn. */
  ghost?: number;
  /** The label as a state word with its glyph ("Flagged for a look", "To look at"). */
  stateHead?: boolean;
}

const SHARE: Record<FlowTone, string> = { ok: "bg-success", pr: "bg-primary", wa: "bg-primary", mu: "bg-muted-foreground/55" };

/** A titled section of a flow's steps side by side, the way the Year page draws a phase. */
export function FlowSection({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3.5 rounded-surface bg-card px-6 py-[22px]">
      <div className="flex items-center">
        <h2 className="type-section-title text-foreground">{title}</h2>
        {right ? <span className="ms-auto text-sm text-muted-foreground">{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function StepFlow({ columns, total, named = false }: { columns: FlowColumn[]; total: number; named?: boolean }) {
  return (
    <div className="grid auto-cols-[minmax(0,1fr)] grid-flow-col">
      {columns.map((column, index) => (
        <StepColumn key={column.key} column={column} total={total} first={index === 0} named={named} />
      ))}
    </div>
  );
}

function StepColumn({ column, total, first, named }: { column: FlowColumn; total: number; first: boolean; named: boolean }) {
  const t = useTranslations("year.PhaseSteps");
  const ghost = column.ghost !== undefined;
  const share = ghost || !total ? 0 : (column.count / total) * 100;
  const more = column.count - column.people.length;
  return (
    <div className={cn("relative grid content-start gap-3 px-[18px] pb-1 pt-0.5", !first && "shadow-[-1px_0_0_var(--border)]")}>
      {!first ? (
        <span aria-hidden className="absolute -start-[5px] top-3.5 size-2 rotate-45 border-e-[1.5px] border-t-[1.5px] border-muted-foreground bg-card opacity-80 rtl:-rotate-[135deg]" />
      ) : null}
      <div className="grid gap-0.5">
        {column.stateHead && !ghost ? (
          <StateWord tone="warn" className="text-[13px]">{column.label}</StateWord>
        ) : (
          <span className={cn("text-[13px]", column.here ? "font-semibold text-primary-ink" : ghost ? "text-muted-foreground/70" : "text-muted-foreground")}>{column.label}</span>
        )}
        <span className={cn("text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums", column.here ? "text-primary-ink" : ghost ? "text-muted-foreground/70" : "text-foreground")}>
          {column.count}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-inlay">
        <i className={cn("block h-full rounded-full transition-[width] duration-500", SHARE[column.tone])} style={{ width: `${share}%` }} />
      </div>
      {ghost ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-hidden>
          {Array.from({ length: column.ghost! }, (_, i) => (
            <span key={i} className="size-[30px] rounded-full border-[1.5px] border-dashed border-muted-foreground/55" />
          ))}
        </div>
      ) : named ? (
        column.people.length ? (
          <div className="grid">
            {column.people.map((person) => (
              <div key={person.employeeId} className="-mx-2 flex items-center gap-2.5 rounded-xl px-2 py-[7px]">
                <PersonInitials name={person.name} size="md" />
                <div className="grid min-w-0">
                  <b className="truncate text-[13.5px] font-semibold text-foreground">{person.name}</b>
                  {person.unitName ? <span className="truncate text-sm text-muted-foreground">{person.unitName}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null
      ) : column.people.length ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {column.people.map((person) => <PersonInitials key={person.employeeId} name={person.name} size="md" />)}
          </div>
          {more > 0 ? <span className="text-[12.5px] text-muted-foreground">{t("andMore", { count: more })}</span> : null}
        </>
      ) : null}
    </div>
  );
}
