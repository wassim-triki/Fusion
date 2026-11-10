"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, DatePicker, PersonAvatar } from "@repo/ds";
import { PageContainer, Section } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import type { AgainChangeDto, CompanyImportDto, ImportChangeDto } from "@repo/api";
import { AlertTriangle, ArrowLeft, ArrowRight, Briefcase, Building2, CheckCircle2, UserCheck } from "@repo/ds/icons";
import { useEarlierImports, useImportChange } from "../api/use-company-import";
import { CheckCard } from "./chart-step";
import { importHref } from "./import-skeleton";
import { FileLine, ImportHeader } from "./import-parts";
import { Lean } from "./understood";

/**
 * Importing again (D-22): the files against what Fusion has, matched by employee number or work email. New, changed
 * (each change with what Fusion has and what the file says), not in the file (a question, never an automatic leaver),
 * unchanged; all dated from one "changes apply from" day.
 */
export function AgainStep({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.again");
  const tChart = useTranslations("companyImport.chart");
  const tUnderstood = useTranslations("companyImport.understood");
  const format = useFormatter();
  const router = useRouter();
  const change = useImportChange(data.id);
  const earlier = useEarlierImports();
  const again = data.again!;
  const others = data.checks.filter((check) => check.kind !== "notInFile");
  const open = data.checks.filter((check) => check.answer === null).length;
  const ending = again.notInFile.filter((item) => item.answer === "end").length;
  const total = again.new.length + again.changed.length + ending + again.units.length + again.jobs.length;
  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00`), { weekday: "long", day: "numeric", month: "long" });
  const answer = (key: string, value: string | null) => void change.run("answer", (api, version) => api.answer(data.id, version, key, value));

  const bringIn = async () => {
    const next = await change.run("bring", (api, version) => api.bringIn(data.id, version, data.fingerprint));
    if (next) router.replace(importHref(data.id, "bring"));
  };

  return (
    <PageContainer width="wide" className="pb-12">
      <ImportHeader
        back={
          <Link href={`/import/${data.id}`} className="inline-flex w-fit items-center gap-1.5 type-label text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> {t("back")}
          </Link>
        }
        title={data.files.find((file) => !file.problem)?.name ?? data.companyName}
        actions={
          <>
            {open > 0 ? <span className="type-meta-strong text-warning">{tUnderstood("questions", { count: open })}</span> : null}
            <Button onClick={() => void bringIn()} disabled={!data.canBringIn || change.pending !== null}>
              {t("bringIn", { count: total })}
            </Button>
          </>
        }
      />
      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
        <FileLine files={data.files.filter((file) => !file.problem)} />
        <span className="inline-flex h-7 items-center gap-1.5 rounded-control border border-border bg-inlay px-2.5 type-meta text-foreground">
          <UserCheck className="size-4 text-muted-foreground" aria-hidden />
          {t(`matchedBy.${again.matchedBy}`)}
        </span>
      </div>
      {data.lastFailure || change.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>{change.error ?? tChart(`failure.${data.lastFailure!}`)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
        <section className="overflow-hidden rounded-surface bg-card py-1" aria-label={t("changed")}>
          {total === 0 && again.notInFile.length === 0 ? <p className="px-5 py-6 type-body text-muted-foreground">{t("nothing")}</p> : null}
          {again.new.length > 0 ? (
            <Group title={t("new")} count={again.new.length}>
              {again.new.map((person) => (
                <Row key={person.key} lead={<PersonAvatar name={person.name} size="md" />} title={person.name}
                  end={<span className="inline-flex h-6 items-center rounded-full bg-primary-tint px-2.5 type-meta-strong text-primary-ink">{t("new")}</span>}>
                  {t("newLine", { title: person.title, unit: person.unit, date: format.dateTime(new Date(`${person.start}T00:00:00`), { day: "numeric", month: "short" }) })}
                  {person.manager ? ` · ${t("newManager", { name: person.manager })}` : ""}
                </Row>
              ))}
            </Group>
          ) : null}
          {again.changed.length > 0 ? (
            <Group title={t("changed")} count={again.changed.length}>
              {again.changed.map((person) => (
                <Row key={person.key} lead={<PersonAvatar name={person.name} size="md" />} title={person.name}>
                  <Changes changes={person.changes} />
                </Row>
              ))}
            </Group>
          ) : null}
          {again.notInFile.length > 0 ? (
            <Group title={t("notInFile")} count={again.notInFile.length}>
              {again.notInFile.map((person) => (
                <Row key={person.key} lead={<PersonAvatar name={person.name} size="md" />} title={person.name}
                  end={person.answer ? <Button variant="ghost" size="sm" onClick={() => answer(person.key, null)} disabled={change.pending !== null}>{t("undo")}</Button> : null}>
                  {person.detail ? <span className="block">{person.detail}</span> : null}
                  {person.answer === null ? (
                    <span className="mt-2.5 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => answer(person.key, "keep")} disabled={change.pending !== null}>
                        {t("keep")} <Lean />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => answer(person.key, "end")} disabled={change.pending !== null}>{t("end")}</Button>
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex items-center gap-1.5 text-foreground">
                      <CheckCircle2 className="size-4 text-success" aria-hidden />
                      {person.answer === "end" ? t("ending", { date: format.dateTime(new Date(`${again.applyFrom}T00:00:00`), { day: "numeric", month: "long" }) }) : t("kept")}
                    </span>
                  )}
                </Row>
              ))}
            </Group>
          ) : null}
          {again.units.length > 0 ? <Things title={t("units")} items={again.units} icon={<Building2 className="size-4" aria-hidden />} /> : null}
          {again.jobs.length > 0 ? <Things title={t("jobs")} items={again.jobs} icon={<Briefcase className="size-4" aria-hidden />} /> : null}
          {again.unchanged > 0 ? (
            <div className="flex items-center gap-2.5 border-t border-border px-5 pb-3 pt-4">
              <p className="type-section-title text-muted-foreground">{t("unchanged")}</p>
              <span className="type-meta tabular-nums text-muted-foreground">{again.unchanged}</span>
            </div>
          ) : null}
        </section>

        <aside className="grid gap-5">
          <Section title={t("applyFrom")}>
            <div className="grid gap-3">
              <DatePicker
                value={again.applyFrom}
                onChange={(value) => answer("applyFrom", value || null)}
                disabled={change.pending !== null}
                aria-label={t("applyFrom")}
                className="justify-self-start"
              />
              <p className="type-meta text-muted-foreground">{day(again.applyFrom)} · {t("applyHint")}</p>
            </div>
          </Section>
          {others.length > 0 ? (
            <div className="grid gap-3">
              <h2 className="type-section-title text-foreground">{t("toCheck")}</h2>
              {others.map((check) => <CheckCard key={check.key} check={check} data={data} change={change} onShow={() => undefined} />)}
            </div>
          ) : null}
          {earlier.data && earlier.data.length > 0 ? (
            <EarlierImports items={earlier.data} />
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 px-5 pb-2 pt-4">
        <p className="type-section-title text-foreground">{title}</p>
        <span className="type-meta tabular-nums text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ lead, title, end, children }: { lead: ReactNode; title: string; end?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-border px-5 py-3">
      {lead}
      <div className="grid min-w-0 gap-0.5">
        <p className="type-label text-foreground">{title}</p>
        <div className="type-meta text-muted-foreground">{children}</div>
      </div>
      {end ?? <span />}
    </div>
  );
}

/** "Job Product Manager → Senior Product Manager": what Fusion has, struck, then what the file says. */
function Changes({ changes }: { changes: ImportChangeDto[] }) {
  const t = useTranslations("companyImport.again");
  const format = useFormatter();
  const value = (item: ImportChangeDto, text: string | null) => item.field === "startDate" && text
    ? format.dateTime(new Date(`${text}T00:00:00`), { day: "numeric", month: "short", year: "numeric" })
    : text ?? t("none");
  return (
    <span className="grid gap-0.5">
      {changes.map((item) => (
        <span key={item.field} className="inline-flex flex-wrap items-center gap-1.5">
          <span>{t(`field.${item.field}` as "field.unit")}</span>
          {item.from ? <s>{value(item, item.from)}</s> : null}
          <ArrowRight className={cn("size-3.5 rtl:rotate-180")} aria-hidden />
          <b className="font-medium text-foreground">{value(item, item.to)}</b>
        </span>
      ))}
    </span>
  );
}

function Things({ title, items, icon }: { title: string; items: AgainChangeDto[]; icon: ReactNode }) {
  return (
    <Group title={title} count={items.length}>
      {items.map((item) => (
        <Row key={item.key} lead={<span className="grid size-10 place-items-center rounded-control bg-inlay text-muted-foreground">{icon}</span>} title={item.name}>
          <Changes changes={item.changes} />
        </Row>
      ))}
    </Group>
  );
}

/** Earlier imports, each opening what it brought in. */
export function EarlierImports({ items, className }: { items: NonNullable<ReturnType<typeof useEarlierImports>["data"]>; className?: string }) {
  const t = useTranslations("companyImport.earlier");
  const format = useFormatter();
  return (
    <Section title={t("title")} flush className={className}>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex min-h-14 items-center gap-4 border-b border-border px-5 py-3 last:border-b-0">
            <PersonAvatar name={item.by} size="md" />
            <div className="min-w-0 flex-1">
              <p className="type-label text-foreground">{t("by", { date: format.dateTime(new Date(item.broughtInAt), { day: "numeric", month: "short" }), name: item.by })}</p>
              <p className="type-meta truncate text-muted-foreground">
                {item.fileNames.join(", ")} · {item.people > 0 || item.changed === 0 ? t("counts", { people: item.people, units: item.units }) : t("changed", { count: item.changed })}
              </p>
            </div>
            <Link href={importHref(item.id, "bring")} className="type-label text-primary-ink hover:underline">{t("open")}</Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
