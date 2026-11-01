"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button, PersonAvatar } from "@repo/ds";
import { PageContainer, Section } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import type { CompanyImportDto, CompanyImportProgressDto } from "@repo/api";
import { AlertTriangle, Check, CheckCircle2, Clock, File as FileGlyph, Loader2, Mail, MapPin, Network, PencilLine, RefreshCw } from "lucide-react";
import { useImportChange } from "../api/use-company-import";
import { leftSummary } from "./understood";

type FactState = "done" | "now" | "wait";

/** How far along the bring-in is, from what has really been created: units, then jobs, then people, then reporting lines. */
export function bringFraction(progress: CompanyImportProgressDto | null, people: number, lines: number): number {
  if (!progress) return 0;
  switch (progress.phase) {
    case "waiting": return 0.02;
    case "units": return 0.06;
    case "jobs": return 0.12;
    case "people": return 0.15 + 0.7 * (people ? progress.people / people : 1);
    case "lines": return 0.85 + 0.12 * (lines ? progress.reportingLines / lines : 1);
    case "saving": return 0.98;
  }
}

/**
 * Bringing in and Brought in, one centred frame (D-29): the company's people fill into their departments as they're
 * created, one line of facts and a bar underneath; finished, the same frame with the counts, the next step and what's
 * worth a look. Nothing waits half-empty.
 */
export function BringFrame({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.bring");
  const format = useFormatter();
  const tStop = useTranslations("companyImport.stopped");
  const done = data.status === "BroughtIn";
  const stopped = data.status === "Stopped" ? data.stopped : null;
  const result = data.result;
  const progress = data.progress;
  const total = done ? (result?.people ?? 0) : data.counts.people;
  const lines = done ? (result?.reportingLines ?? 0) : data.counts.reportingLines;
  const created = done ? total : progress?.phase === "lines" || progress?.phase === "saving" ? total : (progress?.people ?? 0);
  const fileNames = done ? (result?.fileNames ?? data.files.map((file) => file.name)) : data.files.map((file) => file.name);
  const files = format.list(fileNames, { type: "conjunction" });

  const state = (phase: CompanyImportProgressDto["phase"], after: CompanyImportProgressDto["phase"][]): FactState => {
    const current = progress?.phase ?? "waiting";
    if (current === phase) return "now";
    return after.includes(current) ? "done" : "wait";
  };

  let offset = 0;
  const groups = data.wall.map((group) => {
    const filled = Math.max(0, Math.min(group.count, created - offset));
    offset += group.count;
    return { ...group, filled };
  });

  return (
    <PageContainer width="wide" className="pb-12">
      <div className="mx-auto grid max-w-[60rem] gap-6">
        <header className="grid justify-items-center gap-2 pt-2 text-center">
          <p className="inline-flex items-center gap-1.5 type-meta text-muted-foreground">
            {done ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : stopped ? <AlertTriangle className="size-4 text-warning" aria-hidden /> : <FileGlyph className="size-4" aria-hidden />}
            {done && result
              ? t("doneMeta", { time: format.dateTime(new Date(result.broughtInAt), { hour: "2-digit", minute: "2-digit" }), files })
              : stopped ? <span className="text-warning">{tStop("meta")}</span> : files}
          </p>
          <h1 className="type-display text-balance text-foreground">
            {done ? t("doneTitle", { company: data.companyName })
              : stopped ? (stopped.row ? tStop("title", { row: stopped.row }) : tStop("titleLines"))
              : t("title", { company: data.companyName })}
          </h1>
        </header>

        <section className="grid gap-6 rounded-surface bg-section px-8 pb-7 pt-8" aria-busy={!done && !stopped} aria-live="polite">
          <div className="flex flex-wrap items-start justify-center gap-x-8 gap-y-6">
            {groups.map((group) => (
              <div key={group.name} className="grid max-w-[15rem] gap-2">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="type-label truncate text-foreground">{group.name}</span>
                  <b className="type-meta tabular-nums text-muted-foreground">{group.filled}</b>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.people.map((name, i) => (
                    <span key={`${name}-${i}`} className={cn("transition-[opacity,transform,filter] duration-500", i < group.filled ? "opacity-100" : "scale-90 opacity-20 grayscale")}>
                      <PersonAvatar name={name} size="xs" />
                    </span>
                  ))}
                  {group.count > group.people.length ? (
                    <span className="grid h-6 place-items-center rounded-full bg-inlay px-2 type-meta tabular-nums text-muted-foreground">
                      +{group.count - group.people.length}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {done && result ? (
            <div className="flex flex-wrap justify-center gap-x-9 gap-y-3 border-t border-border pt-5 animate-in fade-in-0">
              {(
                [
                  ["people", result.people],
                  ["units", result.units],
                  ["jobs", result.jobs],
                  ["places", result.places],
                  ["lines", result.reportingLines],
                  ["changed", result.changed],
                  ["ended", result.ended],
                ] as const
              ).filter(([key, value]) => value > 0 || (key !== "changed" && key !== "ended" && result.changed === 0)).map(([key, value]) => (
                <div key={key} className="grid justify-items-center">
                  <b className="type-metric text-foreground">{value}</b>
                  <span className="type-meta text-muted-foreground">
                    {key === "changed" ? t("doneChanged", { count: value }) : key === "ended" ? t("doneEnded", { count: value }) : t(`counts.${key}`, { count: value })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3.5">
              <div className="h-2 overflow-hidden rounded-full bg-inlay">
                <i className={cn("block h-full rounded-full transition-[width] duration-500", stopped ? "bg-warning" : "bg-primary")} style={{ width: `${Math.round(bringFraction(progress, total, lines) * 100)}%` }} />
              </div>
              <div className="flex flex-wrap justify-center gap-x-7 gap-y-2">
                <Fact state={state("units", ["jobs", "people", "lines", "saving"])}>{t("facts.units", { count: data.counts.newUnits })}</Fact>
                <Fact state={state("jobs", ["people", "lines", "saving"])}>{t("facts.jobs", { count: data.counts.jobs })}</Fact>
                <Fact state={state("people", ["lines", "saving"])}>{t("facts.people", { count: created, of: total })}</Fact>
                <Fact state={state("lines", ["saving"])}>{t("facts.lines", { count: progress?.reportingLines ?? 0, of: lines })}</Fact>
              </div>
              {stopped ? null : <p className="text-center type-meta text-muted-foreground">{t("leave")}</p>}
            </div>
          )}
        </section>

        {done && result ? <Finished data={data} /> : null}
        {stopped ? <Stopped data={data} stopped={stopped} /> : null}
      </div>
    </PageContainer>
  );
}

/** Stopped partway (D-29): the same frame with what's in, what isn't, nobody invited, and Try again from the row. */
function Stopped({ data, stopped }: { data: CompanyImportDto; stopped: NonNullable<CompanyImportDto["stopped"]> }) {
  const t = useTranslations("companyImport.stopped");
  const change = useImportChange(data.id);
  const facts: [string, string][] = [
    [t("in"), t("inValue", { units: stopped.units, jobs: stopped.jobs, people: stopped.people })],
    [t("notYet"), t("notYetValue", { count: stopped.peopleLeft })],
    [t("invited"), t("nobody")],
  ];
  return (
    <section className="flex flex-wrap items-center gap-x-10 gap-y-5 rounded-surface bg-card px-6 py-5">
      <dl className="flex flex-1 flex-wrap gap-x-10 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="type-meta text-muted-foreground">{label}</dt>
            <dd className="type-label text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <Button onClick={() => void change.run("resume", (api, version) => api.resume(data.id, version))} disabled={change.pending !== null}>
        <RefreshCw className="size-4" aria-hidden /> {stopped.row ? t("retry", { row: stopped.row }) : t("retryLines")}
      </Button>
      {change.error ? <p className="w-full type-meta text-destructive">{change.error}</p> : null}
    </section>
  );
}

function Fact({ state, children }: { state: FactState; children: ReactNode }) {
  const Icon = state === "done" ? Check : state === "now" ? Loader2 : Clock;
  return (
    <span className={cn("inline-flex items-center gap-1.5 type-label tabular-nums", state === "wait" ? "text-muted-foreground" : "text-foreground")}>
      <Icon className={cn("size-4", state === "now" && "animate-spin text-primary-ink", state === "done" && "text-success")} aria-hidden />
      {children}
    </span>
  );
}

/** Brought in: the setup's next step, then what's worth a look. */
function Finished({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.bring");
  const tLeft = useTranslations("companyImport.left");
  const result = data.result!;
  const left = leftSummary(data, (key, values) => tLeft(key, values));
  const rows: { key: string; icon: ReactNode; title: string; detail?: string; action?: ReactNode }[] = [];
  if (left) rows.push({ key: "left", icon: <FileGlyph className="size-4" aria-hidden />, title: t("worth.left"), detail: left });
  if (result.decided > 0)
    rows.push({ key: "decided", icon: <PencilLine className="size-4" aria-hidden />, title: t("worth.decided", { count: result.decided }), detail: result.decidedNames.length ? t("worth.decidedNames", { names: result.decidedNames.join(", ") }) : undefined });
  if (result.missingEmail > 0)
    rows.push({ key: "email", icon: <Mail className="size-4" aria-hidden />, title: t("worth.noEmail", { count: result.missingEmail }), detail: t("worth.noEmailDetail"), action: <Button variant="ghost" size="sm" asChild><Link href="/people">{t("worth.seeWho")}</Link></Button> });
  if (result.missingPlace > 0)
    rows.push({ key: "place", icon: <MapPin className="size-4" aria-hidden />, title: t("worth.noPlace", { count: result.missingPlace }), action: <Button variant="ghost" size="sm" asChild><Link href="/people">{t("worth.seeWho")}</Link></Button> });

  return (
    <>
      <section className="flex flex-wrap items-center gap-6 rounded-surface bg-card px-6 py-5 animate-in fade-in-0">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="type-section-title text-foreground">{t("next.title")}</p>
          <p className="type-meta text-muted-foreground">{t("next.nobody")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/organization"><Network className="size-4" aria-hidden /> {t("next.orgChart")}</Link>
          </Button>
          <Button asChild>
            <Link href="/people?invite=1"><Mail className="size-4" aria-hidden /> {t("next.invite")}</Link>
          </Button>
        </div>
      </section>
      {rows.length > 0 ? (
        <Section title={t("worth.title")} flush className="animate-in fade-in-0">
          <ul>
            {rows.map((row) => (
              <li key={row.key} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
                <span className="grid size-10 place-items-center rounded-control bg-inlay text-muted-foreground">{row.icon}</span>
                <div className="grid min-w-0 gap-0.5">
                  <p className="type-label text-foreground">{row.title}</p>
                  {row.detail ? <p className="type-meta text-muted-foreground">{row.detail}</p> : null}
                </div>
                {row.action ?? <span />}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
