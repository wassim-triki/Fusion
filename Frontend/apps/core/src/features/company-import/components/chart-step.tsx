"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Input, PersonAvatar } from "@repo/ds";
import { OptionCards, Segmented } from "@repo/ds/choice";
import { PageContainer } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import type { CheckDto, CompanyImportDto, CompanyImportSaidDto } from "@repo/api";
import { AlertTriangle, ArrowLeft, CheckCircle2, Search } from "lucide-react";
import { useImportApi, useImportChange } from "../api/use-company-import";
import { ImportHeader, useFieldLabel } from "./import-parts";
import { Lean } from "./understood";
import { JobsGrid, PeopleChart, UnitsTree } from "./chart-views";

type Tab = "people" | "units" | "jobs";
type Change = ReturnType<typeof useImportChange>;

/**
 * The chart (D-22): what the files make, as People, Units and Jobs, beside what needs a person. Every check names
 * what each file said; a fix said in words is listed next to what the file said. Bringing in waits for every check.
 */
export function ChartStep({ data }: { data: CompanyImportDto }) {
  const t = useTranslations("companyImport.chart");
  const router = useRouter();
  const change = useImportChange(data.id);
  const [tab, setTab] = useState<Tab>("people");
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const left = data.checks.filter((check) => check.answer === null).length;

  const found = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle.length < 2 ? [] : data.chart.people.filter((person) => person.name.toLowerCase().includes(needle)).slice(0, 6);
  }, [data.chart.people, search]);

  const bringIn = async () => {
    const next = await change.run("bring", (api, version) => api.bringIn(data.id, version, data.fingerprint));
    if (next) router.replace(`/import/${data.id}`);
  };

  const show = (check: CheckDto) => {
    if (check.kind === "sameJob") return setTab("jobs");
    if (check.kind === "unitParent") return setTab("units");
    if (check.subject && data.chart.people.some((person) => person.key === check.subject)) {
      setTab("people");
      setFocus(check.subject);
    }
  };

  const bringLabel = data.counts.people > 0 ? t("bringIn", { count: data.counts.people }) : t("bringUnits", { count: data.counts.newUnits });

  return (
    <PageContainer width="wide" className="pb-12">
      <ImportHeader
        back={
          <Link href={`/import/${data.id}`} className="inline-flex w-fit items-center gap-1.5 type-label text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> {t("back")}
          </Link>
        }
        title={t("title", { company: data.companyName })}
        files={data.files}
        actions={
          <Button onClick={() => void bringIn()} disabled={!data.canBringIn || change.pending !== null}>
            {bringLabel}
          </Button>
        }
      />
      {data.lastFailure ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>{t(`failure.${data.lastFailure}`)}</AlertDescription>
        </Alert>
      ) : null}
      {change.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>{change.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
        <div className="grid min-w-0 gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented
              value={tab}
              onChange={setTab}
              label={t("views")}
              options={[
                { value: "people", label: t("tab.people", { count: data.counts.people }) },
                { value: "units", label: t("tab.units", { count: data.chart.units.length }) },
                { value: "jobs", label: t("tab.jobs", { count: data.counts.jobs }) },
              ]}
            />
            <span className="flex-1" />
            {tab === "people" ? (
              <div className="relative w-56">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("find")} aria-label={t("find")} className="h-8 ps-8" />
                {found.length > 0 ? (
                  <ul className="absolute inset-x-0 top-9 z-20 overflow-hidden rounded-menu bg-popover p-1 shadow-overlay">
                    {found.map((person) => (
                      <li key={person.key}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-inset px-2 py-1.5 text-start hover:bg-inlay"
                          onClick={() => {
                            setFocus(person.key);
                            setSearch("");
                          }}
                        >
                          <PersonAvatar name={person.name} size="xs" />
                          <span className="type-label truncate">{person.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="min-h-[33.75rem] overflow-hidden rounded-surface bg-section">
            {tab === "people" ? <PeopleChart people={data.chart.people} focus={focus} onFocus={setFocus} /> : null}
            {tab === "units" ? <UnitsTree data={data} /> : null}
            {tab === "jobs" ? <JobsGrid data={data} /> : null}
          </div>
        </div>

        <aside className="grid gap-3.5" aria-label={t("toCheck")}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-section-title text-foreground">{t("toCheck")}</h2>
            <span className={cn("type-meta-strong", left > 0 ? "text-warning" : "text-success")}>{left > 0 ? t("left", { count: left }) : t("allChecked")}</span>
          </div>
          {left > 1 ? (
            <Button variant="ghost" size="sm" className="justify-self-start" disabled={change.pending !== null}
              onClick={() => void change.run("leans", (api, version) => api.takeLeans(data.id, version))}>
              {t("takeLeans")}
            </Button>
          ) : null}
          {[...data.checks].sort((a, b) => Number(a.answer !== null) - Number(b.answer !== null)).map((check) => (
            <CheckCard key={check.key} check={check} data={data} change={change} onShow={() => show(check)} />
          ))}
          <SayIt data={data} change={change} />
        </aside>
      </div>
    </PageContainer>
  );
}

export function CheckCard({ check, data, change, onShow }: { check: CheckDto; data: CompanyImportDto; change: Change; onShow: () => void }) {
  const t = useTranslations("companyImport.check");
  const format = useFormatter();
  const name = (key: string | null) => data.chart.people.find((person) => person.key === key)?.name ?? check.title ?? "";
  const unit = (key: string) => data.chart.units.find((item) => item.key === key)?.name ?? key;
  const done = check.answer !== null;

  const title =
    check.kind === "unitMissing"
      ? check.count === 1 ? t("unitMissing.one", { name: name(check.subject), file: check.detail ?? t("theFiles") }) : t("unitMissing.many", { count: check.count, file: check.detail ?? t("theFiles") })
      : check.kind === "unitParent" ? t("unitParent", { unit: check.title ?? "" })
      : check.kind === "managerMissing" ? t("managerMissing", { name: check.title ?? "" })
      : check.kind === "twice" ? t(`twice.${check.detail ?? "manager"}` as "twice.manager", { name: check.title ?? "" })
      : check.kind === "sameJob" ? t("sameJob")
      : check.kind === "managerLoop" ? t("managerLoop", { names: check.title ?? "" })
      : check.kind === "noStart" ? (check.count === 1 ? t("noStart.one", { name: check.title ?? "" }) : t("noStart.many", { count: check.count }))
      : check.kind === "firstPersonStart" ? t("twice.startDate", { name: check.title ?? "" })
      : check.count === 1 ? t("noTitle.one", { name: check.title ?? "" }) : t("noTitle.many", { count: check.count });
  const saidIn = data.chart.people.find((person) => person.key === check.subject)?.from.split(" · ")[0] ?? t("theFiles");
  const meta =
    check.kind === "unitMissing" ? t("says", { file: saidIn, value: check.title ?? "" })
      : check.kind === "unitParent" || check.kind === "managerMissing" ? t("fileSays", { value: check.detail ?? "" })
      : check.kind === "twice" ? t("disagree")
      : check.kind === "sameJob" ? check.title
      : null;

  const optionLabel = (key: string, text: string) => {
    switch (check.kind) {
      case "firstPersonStart": return t(key === "keep" ? "option.keepStart" : "option.fileStart", {
        date: format.dateTime(new Date(`${text}T00:00:00`), { day: "numeric", month: "long", year: "numeric" }),
      });
      case "unitMissing": return key === "add" ? t("option.addUnit", { name: text }) : text;
      case "unitParent": return key === "root" ? t("option.underRoot", { company: data.companyName }) : unit(key);
      case "managerMissing": return key === "none" ? t("option.noManager") : text;
      case "sameJob": return t(`option.${key === "merge" ? "merge" : "keep"}`);
      case "managerLoop": return t("option.cut", { name: text });
      case "noStart": return key === "out" ? t("option.leaveOut") : t("option.startOn", { date: format.dateTime(new Date(`${text}T00:00:00`), { day: "numeric", month: "long", year: "numeric" }) });
      case "noTitle": return key === "out" ? t("option.leaveOut") : t("option.giveJob", { title: text });
      default: return text;
    }
  };
  const from = (value: string | null) =>
    check.kind === "firstPersonStart" ? (value === "file" ? saidIn : t("from.current"))
      : value === "closest" ? t("from.closest") : value === "new" ? t("from.new") : value;

  return (
    <section className="grid gap-3 rounded-surface bg-card p-[1.125rem]" aria-label={title}>
      <div className="flex items-start gap-2.5">
        {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <button type="button" onClick={onShow} className="text-start type-label leading-snug text-foreground hover:underline">{title}</button>
          {meta ? <p className="type-meta text-muted-foreground">{meta}</p> : null}
        </div>
      </div>
      <OptionCards
        value={check.answer}
        columns={1}
        label={title}
        disabled={change.pending !== null}
        onChange={(value) => void change.run("answer", (api, version) => api.answer(data.id, version, check.key, value))}
        options={check.options.map((option) => ({
          value: option.key,
          label: (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {optionLabel(option.key, option.label)}
              {option.lean ? <Lean /> : null}
            </span>
          ),
          description: from(option.from) ?? undefined,
        }))}
      />
    </section>
  );
}

/** Something else wrong, said in a sentence. Fusion shows how it read it; the person applies it or not. */
function SayIt({ data, change }: { data: CompanyImportDto; change: Change }) {
  const t = useTranslations("companyImport.say");
  const label = useFieldLabel();
  const api = useImportApi();
  const [text, setText] = useState("");
  const [said, setSaid] = useState<CompanyImportSaidDto | null>(null);
  const [missed, setMissed] = useState(false);
  const [reading, setReading] = useState(false);
  const example = useMemo(() => {
    const person = data.chart.people.find((item) => item.managerKey);
    const other = data.chart.people.find((item) => item.key !== person?.key && item.key !== person?.managerKey && item.directCount > 0);
    return person && other ? t("example", { name: person.name.split(" ")[0]!, manager: other.name.split(" ")[0]! }) : t("exampleFallback");
  }, [data.chart.people, t]);

  const read = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setReading(true);
    try {
      const result = await api.say(data.id, text.trim());
      setSaid(result);
      setMissed(result === null);
    } finally {
      setReading(false);
    }
  };
  const apply = async () => {
    if (!said) return;
    const next = await change.run("fix", (client, version) => client.addFix(data.id, version, { personKey: said.personKey, field: said.field, value: said.value, text: text.trim() }));
    if (next) {
      setSaid(null);
      setText("");
    }
  };
  const shown = (field: string, value: string | null) => (value === "none" ? t("noManager") : value ?? t("nothing"));

  return (
    <section className="grid gap-2.5 rounded-surface bg-card p-[1.125rem]">
      <form onSubmit={(event) => void read(event)} className="grid gap-2.5">
        <label htmlFor="import-say" className="type-label text-foreground">{t("label")}</label>
        <div className="flex gap-2">
          <Input id="import-say" value={text} maxLength={200} autoComplete="off" placeholder={example}
            onChange={(event) => {
              setText(event.target.value);
              setMissed(false);
              setSaid(null);
            }} />
          <Button type="submit" variant="outline" disabled={reading || !text.trim()}>{t("show")}</Button>
        </div>
      </form>
      {missed ? <p className="type-meta text-muted-foreground">{t("notUnderstood")}</p> : null}
      {said ? (
        <div className="grid gap-2.5 rounded-control bg-inlay p-3.5 animate-in fade-in-0">
          <div className="flex items-center gap-2">
            <PersonAvatar name={said.personName} size="xs" />
            <b className="type-label">{said.personName}</b>
          </div>
          <p className="flex flex-wrap items-center gap-2 type-body">
            <span className="text-muted-foreground">{label(said.field)}</span>
            {said.from ? <s className="text-muted-foreground">{shown(said.field, said.from)}</s> : null}
            <span aria-hidden>→</span>
            <b>{shown(said.field, said.to)}</b>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSaid(null)}>{t("notThat")}</Button>
            <Button size="sm" onClick={() => void apply()} disabled={change.pending !== null}>{t("apply")}</Button>
          </div>
        </div>
      ) : null}
      {data.fixes.length > 0 ? (
        <div className="grid gap-2 border-t border-border pt-2.5">
          <p className="type-meta text-muted-foreground">{t("changed")}</p>
          <ul className="grid gap-1.5">
            {data.fixes.map((fix) => (
              <li key={fix.id} className="flex items-center gap-2 type-body">
                <span className="min-w-0 flex-1">
                  <b className="type-label">{fix.personName}</b>
                  <span className="text-muted-foreground"> · {label(fix.field)}: </span>
                  {fix.from ? <s className="text-muted-foreground">{shown(fix.field, fix.from)}</s> : null} {shown(fix.field, fix.to)}
                </span>
                <Button variant="ghost" size="sm" disabled={change.pending !== null}
                  onClick={() => void change.run("unfix", (client, version) => client.removeFix(data.id, version, fix.id))}>
                  {t("undo")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
