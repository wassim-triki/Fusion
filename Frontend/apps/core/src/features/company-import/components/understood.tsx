"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@repo/ds";
import { PageContainer, Section } from "@repo/ds/shell";
import { Segmented } from "@repo/ds/choice";
import { useQueryClient } from "@tanstack/react-query";
import { coreImportQueryKeys, type ColumnQuestionDto, type CompanyImportDto, type CompanyImportFactDto, type CompanyImportFileDto, type CompanyImportSheetDto } from "@repo/api";
import { AlertTriangle, ArrowRight, Briefcase, Building2, CheckCircle2, File as FileGlyph, FileX, MapPin, Network, UserRound, X } from "lucide-react";
import { cn } from "@repo/ds/lib/utils";
import { useImportChange } from "../api/use-company-import";
import { checkFiles, DropZone, MAX_FILES } from "./import-drop";
import { AiMark, FileIcon, ImportHeader, ShareBar, useFieldLabel } from "./import-parts";
import { importHref } from "./import-skeleton";
import { SheetView } from "./sheet-view";

/** What Fusion understood (D-22): each file as Fusion read it, the questions only a person can answer, and what the files add up to. */
export function Understood({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.understood");
  const router = useRouter();
  const queryClient = useQueryClient();
  const change = useImportChange(data.id);
  const tFiles = useTranslations("companyImport.fileProblem");
  const [problem, setProblem] = useState<string | null>(null);
  const open = data.questions.filter((question) => question.answer === null).length;
  const tAgain = useTranslations("companyImport.again");
  const toNext = data.again ? tAgain("toChanges") : t("toChart");

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const bad = data.files.length + files.length > MAX_FILES ? { problem: "many" as const, name: "" } : checkFiles(files);
    setProblem(bad ? tFiles(bad.problem, { name: bad.name ?? "", max: MAX_FILES }) : null);
    if (!bad) void change.run("files", (api, version) => api.addFiles(data.id, version, files));
  };
  const startOver = async () => {
    const done = await change.run("discard", (api, version) => api.discard(data.id, version));
    if (done) {
      await queryClient.invalidateQueries({ queryKey: coreImportQueryKeys.active() });
      router.replace("/import");
    }
  };

  return (
    <PageContainer width="wide" className="pb-12">
      <ImportHeader
        title={t("title")}
        files={data.files}
        actions={
          <>
            {open > 0 ? <span className="type-meta-strong text-warning">{t("questions", { count: open })}</span> : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost">{t("startOver")}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("startOverTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("startOverBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("keep")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void startOver()}>{t("startOver")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {data.files.length < MAX_FILES ? <DropZone slim onFiles={addFiles} disabled={change.pending !== null} /> : null}
            <Button disabled={open > 0} asChild={open === 0}>
              {open === 0 ? <Link href={importHref(data.id, data.again ? "again" : "chart")}>{toNext}</Link> : <span>{toNext}</span>}
            </Button>
          </>
        }
      />
      {problem ?? change.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>{problem ?? change.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4">
        {data.files.map((file) => (
          <FileCard key={file.id} file={file} data={data} change={change}
            onRemove={data.files.length > 1 ? () => void change.run("remove", (api, version) => api.removeFile(data.id, version, file.id)) : undefined}
            onReplace={async (files) => {
              if (await change.run("files", (api, version) => api.addFiles(data.id, version, files)))
                await change.run("remove", (api, version) => api.removeFile(data.id, version, file.id));
            }}
          />
        ))}
        <Across data={data} />
      </div>
    </PageContainer>
  );
}

type Change = ReturnType<typeof useImportChange>;

function FileCard({ file, data, onRemove, onReplace, change }: {
  file: CompanyImportFileDto; data: CompanyImportDto; onRemove?: () => void; onReplace: (files: File[]) => Promise<void>; change: Change;
}) {
  const t = useTranslations("companyImport.understood");
  const tBad = useTranslations("companyImport.badFile");
  const known = file.sheets.filter((sheet) => sheet.kind !== "Unknown");
  const unknown = file.sheets.filter((sheet) => sheet.kind === "Unknown");
  const csv = file.format === "csv";
  const replace = useRef<HTMLInputElement>(null);
  const remove = onRemove ? (
    <Button variant="ghost" size="icon" onClick={onRemove} aria-label={t("removeFile", { name: file.name })}>
      <X className="size-4" aria-hidden />
    </Button>
  ) : null;

  // A file Fusion can't use says what's wrong and the one thing to do: replace it, or remove it.
  const replaceButton = (
    <>
      <Button variant="outline" size="sm" onClick={() => replace.current?.click()} disabled={change.pending !== null}>{tBad("replace")}</Button>
      <input ref={replace} type="file" accept=".csv,.xlsx" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void onReplace(files.slice(0, 1));
        }} />
    </>
  );

  if (file.problem && file.sheets.length === 0) {
    const unusable = file.problem === "format" || file.problem === "unreadable" || file.problem === "tooBig";
    return (
      <section className="overflow-hidden rounded-surface bg-card" aria-label={file.name}>
        <FileHead
          file={file}
          meta={tBad(file.problem)}
          tone={unusable ? "bad" : "warn"}
          trailing={
            <span className="flex shrink-0 gap-2">
              {file.problem !== "format" ? replaceButton : null}
              {onRemove ? <Button variant="ghost" size="sm" onClick={onRemove} disabled={change.pending !== null}>{tBad("remove")}</Button> : null}
            </span>
          }
        />
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-surface bg-card" aria-label={file.name}>
      {known.length === 0 ? (
        <FileHead file={file} meta={tBad("nothing")} tone="warn" trailing={<span className="flex shrink-0 items-center gap-2">{replaceButton}{remove}</span>} />
      ) : (
        known.map((sheet, i) => (
          <div key={sheet.name} className={i > 0 ? "border-t border-border" : undefined}>
            <FileHead
              file={file}
              meta={csv ? t(`count.${sheet.kind}` as "count.People", { count: sheet.count }) : t(`sheetCount.${sheet.kind}` as "sheetCount.People", { sheet: sheet.name, count: sheet.count })}
              kind={sheet.kind}
              ai={sheet.columns.some((column) => column.state === "ai")}
              trailing={i === 0 ? remove : null}
            />
            <SheetView data={data} fileId={file.id} sheet={sheet} change={change} />
            {data.questions.filter((question) => question.fileId === file.id && question.sheet === sheet.name).map((question) => (
              <QuestionRow key={question.key} question={question} change={change} id={data.id} />
            ))}
            <LeftNotes data={data} file={file} sheet={sheet} />
          </div>
        ))
      )}
      {file.problem && known.length > 0 ? (
        <Note icon={<AlertTriangle className="size-4 text-warning" aria-hidden />}>
          <span className="type-body text-foreground">{tBad(file.problem)}</span>
          <span className="flex gap-2">{replaceButton}</span>
        </Note>
      ) : null}
      {unknown.map((sheet) => (
        <Note key={sheet.name} icon={<FileGlyph className="size-4" aria-hidden />}>
          <span className="type-body text-foreground">
            {t.rich("unknownSheet", { sheet: sheet.name, count: sheet.rows, b: (chunks) => <b>{chunks}</b> })} · <span className="text-muted-foreground">{t("leftOut")}</span>
          </span>
          <span className="flex gap-1">
            {(["People", "Units"] as const).map((kind) => (
              <Button key={kind} variant="ghost" size="sm" disabled={change.pending !== null}
                onClick={() => void change.run("kind", (api, version) => api.answer(data.id, version, `kind|${file.id.replaceAll("-", "")}|${sheet.name}`, kind))}>
                {t(`readAs.${kind}`)}
              </Button>
            ))}
          </span>
        </Note>
      ))}
    </section>
  );
}

function FileHead({ file, meta, kind, ai, tone, trailing }: {
  file: CompanyImportFileDto; meta: string; kind?: CompanyImportSheetDto["kind"]; ai?: boolean; tone?: "bad" | "warn"; trailing?: ReactNode;
}) {
  const t = useTranslations("companyImport.understood");
  return (
    <div className="flex items-center gap-3.5 px-5 py-4">
      <span className={cn("grid size-[2.625rem] shrink-0 place-items-center rounded-control bg-inlay",
        tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-muted-foreground")}>
        {tone === "bad" ? <FileX className="size-5" aria-hidden /> : <FileIcon format={file.format} className="size-5" />}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="type-label truncate text-foreground">{file.name}</p>
        <p className={cn("type-meta", tone === "bad" ? "text-destructive" : "text-muted-foreground")}>{meta}</p>
      </div>
      {kind ? <span className="inline-flex h-7 items-center rounded-full border border-border bg-inlay px-3 type-meta-strong text-foreground">{t(`kind.${kind}`)}</span> : null}
      {ai ? (
        <span className="inline-flex items-center gap-1.5 type-meta text-muted-foreground">
          <AiMark hint={t("readByFusion")} className="text-muted-foreground" />
          {t("readByFusion")}
        </span>
      ) : null}
      {trailing}
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-5 py-3 text-muted-foreground">
      {icon}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">{children}</div>
    </div>
  );
}

function LeftNotes({ data, file, sheet }: { data: CompanyImportDto; file: CompanyImportFileDto; sheet: CompanyImportSheetDto }) {
  const t = useTranslations("companyImport.understood");
  const rows = data.leftOut.filter((item) => item.fileName === file.name && item.sheet === sheet.name && item.kind !== "column" && item.kind !== "sheet");
  return rows.map((item) => (
    <Note key={item.kind} icon={<FileGlyph className="size-4" aria-hidden />}>
      <span className="type-body text-foreground">
        {t(`leftRows.${item.kind}` as "leftRows.left", { count: item.count })}
        {item.names.length > 0 ? <span className="text-muted-foreground"> · {item.names.slice(0, 3).join(", ")}</span> : null} ·{" "}
        <span className="text-muted-foreground">{t("leftOut")}</span>
      </span>
    </Note>
  ));
}

/** A half-recognised header (or dates that read two ways): Fusion's lean first, marked; the person decides. */
function QuestionRow({ question, change, id }: { question: ColumnQuestionDto; change: Change; id: string }) {
  const t = useTranslations("companyImport.question");
  const label = useFieldLabel();
  const fieldPhrase = (field: string) => t(`phrase.${field}` as never);
  const answer = (value: string | null) => void change.run("answer", (api, version) => api.answer(id, version, question.key, value));
  const tNone = useTranslations("companyImport.noManagers");

  // No manager column isn't needed to bring people in: continue without, or replace the file with one that has it.
  if (question.kind === "noManagers")
    return question.answer !== null ? (
      <div className="flex items-center gap-3.5 border-t border-border px-5 py-3.5">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        <p className="type-label flex-1 text-foreground">{tNone("done")}</p>
        <Button variant="ghost" size="sm" onClick={() => answer(null)} disabled={change.pending !== null}>{t("change")}</Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-3.5 border-t border-border px-5 py-3.5">
        <AlertTriangle className="size-4 text-warning" aria-hidden />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="type-label text-foreground">{tNone("title")}</p>
          <p className="type-meta text-muted-foreground">{tNone("detail")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => answer("without")} disabled={change.pending !== null}>{tNone("without")}</Button>
      </div>
    );

  if (question.answer !== null)
    return (
      <div className="flex items-center gap-3.5 border-t border-border px-5 py-3.5">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        <p className="type-label flex-1 text-foreground">
          {question.kind === "dates"
            ? t(question.answer === "mdy" ? "dates.monthFirstDone" : "dates.dayFirstDone", { header: question.header })
            : question.answer === "out"
              ? t("outDone", { header: question.header })
              : t("fieldDone", { header: question.header, field: fieldPhrase(question.answer) })}
        </p>
        <Button variant="ghost" size="sm" onClick={() => answer(null)} disabled={change.pending !== null}>{t("change")}</Button>
      </div>
    );

  const options =
    question.kind === "dates"
      ? [
          { value: "dmy", label: <span className="inline-flex items-center gap-1.5">{t("dates.dayFirst")}<Lean /></span> },
          { value: "mdy", label: t("dates.monthFirst") },
        ]
      : [
          { value: question.lean, label: <span className="inline-flex items-center gap-1.5">{t("yes", { field: label(question.lean) })}<Lean /></span> },
          { value: "out", label: t("out") },
        ];

  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-border px-5 py-3.5">
      <AlertTriangle className="size-4 text-warning" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="type-label text-foreground">
          {question.kind === "dates" ? t("dates.title", { example: question.values[0] ?? "" }) : t("title", { header: question.header, field: fieldPhrase(question.lean) })}
        </p>
        <p className="type-meta text-muted-foreground">
          {question.kind === "dates" ? question.values.join(", ") : t("values", { values: question.values.slice(0, 7).join(", "), count: question.distinctCount })}
        </p>
      </div>
      <Segmented value={null} onChange={(value) => answer(value)} options={options} label={question.header} size="sm" disabled={change.pending !== null} />
    </div>
  );
}

/** Fusion's lean on a choice: its own rules, said in words (the sparkle is kept for the AI's reading). */
export function Lean() {
  const t = useTranslations("companyImport");
  return <span className="type-meta text-muted-foreground">· {t("lean")}</span>;
}

/** What the files add up to across each other: managers, units, jobs, the viewer, places, and what's left out. */
function Across({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.across");
  const tLeft = useTranslations("companyImport.left");
  const facts = new Map<string, CompanyImportFactDto>(data.facts.map((fact) => [fact.kind, fact]));
  const you = data.chart.people.find((person) => person.you);
  const open = data.questions.some((question) => question.answer === null);
  const rows: { key: string; icon: ReactNode; title: ReactNode; detail?: ReactNode; end?: ReactNode }[] = [];

  const managers = facts.get("managers");
  if (managers)
    rows.push({
      key: "managers",
      icon: <Network className="size-4" aria-hidden />,
      title: t("managers", { count: managers.count, of: managers.of }),
      detail: [managers.detail ? t(`foundBy.${managers.detail}` as never) : null, managers.names.length === 1 ? t("top", { name: managers.names[0]! }) : managers.names.length > 1 ? t("tops", { count: managers.of - managers.count }) : null].filter(Boolean).join(" · "),
      end: <ShareBar count={managers.count} of={managers.of} />,
    });
  const units = facts.get("units");
  if (units)
    rows.push({
      key: "units",
      icon: <Building2 className="size-4" aria-hidden />,
      title: units.count === units.of ? t("unitsAll", { file: units.detail ?? "" }) : t("unitsBut", { file: units.detail ?? "", count: units.of - units.count }),
      detail: units.names.length > 0 ? units.names.join(", ") : undefined,
      end: <ShareBar count={units.count} of={units.of} warn={units.of - units.count} />,
    });
  const fromPeople = facts.get("unitsFromPeople");
  if (fromPeople) rows.push({ key: "unitsFromPeople", icon: <Building2 className="size-4" aria-hidden />, title: t("unitsFromPeople", { count: fromPeople.count }), detail: t("unitsFromPeopleDetail", { company: data.companyName }) });
  const root = facts.get("rootAdded");
  if (root) rows.push({ key: "rootAdded", icon: <Building2 className="size-4" aria-hidden />, title: t("rootAdded", { count: root.count, company: root.detail ?? data.companyName }) });
  const jobs = facts.get("jobs");
  if (jobs)
    rows.push({
      key: "jobs",
      icon: <Briefcase className="size-4" aria-hidden />,
      title: jobs.detail ? t("jobsFamilies", { titles: jobs.of, count: jobs.count, families: Number(jobs.detail) }) : t("jobs", { titles: jobs.of, count: jobs.count }),
      detail: data.checks.some((check) => check.kind === "sameJob") ? t("sameJob", { count: data.checks.filter((check) => check.kind === "sameJob").length }) : undefined,
      end: open ? undefined : (
        <Link href={importHref(data.id, data.again ? "again" : "chart")} className="inline-flex items-center gap-1 type-label text-primary-ink hover:underline">
          {t("onChart")} <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      ),
    });
  if (you) rows.push({ key: "you", icon: <UserRound className="size-4" aria-hidden />, title: t("you", { name: you.name, row: you.from.split(" · ").at(-1) ?? "" }), detail: t("youDetail") });
  const places = facts.get("places");
  if (places) rows.push({ key: "places", icon: <MapPin className="size-4" aria-hidden />, title: t("places", { count: places.count }), detail: places.names.slice(0, 8).join(", ") });
  const left = leftSummary(data, (key, values) => tLeft(key, values));
  if (left) rows.push({ key: "left", icon: <FileGlyph className="size-4" aria-hidden />, title: t("left"), detail: left });

  if (rows.length === 0) return null;
  return (
    <Section title={t("title")} flush className="mt-2">
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
            <span className="grid size-10 place-items-center rounded-control bg-inlay text-muted-foreground">{row.icon}</span>
            <div className="grid min-w-0 gap-0.5">
              <p className="type-label text-foreground">{row.title}</p>
              {row.detail ? <p className="type-meta truncate text-muted-foreground">{row.detail}</p> : null}
            </div>
            {row.end ?? <span />}
          </li>
        ))}
      </ul>
    </Section>
  );
}

type LeftKey = "columns" | "left" | "already" | "decided" | "oneName" | "noName" | "unitNoName" | "sheet";

/** "The Salary column · 12 people who have left · 3 already in Fusion" */
export function leftSummary(data: Pick<CompanyImportDto, "leftOut">, t: (key: LeftKey, values: { count: number; names?: string }) => string): string | null {
  const columns = data.leftOut.filter((item) => item.kind === "column").map((item) => item.what).filter(Boolean) as string[];
  const parts: string[] = [];
  if (columns.length > 0) parts.push(t("columns", { count: columns.length, names: columns.slice(0, 3).join(", ") }));
  for (const kind of ["left", "already", "decided", "oneName", "noName", "unitNoName", "sheet"] as const) {
    const count = data.leftOut.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.count, 0);
    if (count > 0) parts.push(t(kind, { count }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
