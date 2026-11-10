"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, Button } from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { ApiError, checkImportFiles, CORE_IMPORT_MAX_FILES, coreImportQueryKeys } from "@repo/api";
import { useTenantSummary } from "@repo/api/query";
import { canImportCoreEmployees, canManageCoreOrganization, useAuth, PageRefusal } from "@repo/auth";
import { AlertTriangle, Download, FileSpreadsheet, FileText, Upload } from "@repo/ds/icons";
import { downloadBlob } from "@/lib/download";
import { useActiveImport, useEarlierImports, useImportApi } from "../api/use-company-import";
import { EarlierImports } from "./again-step";
import { FileIcon, ImportHeader } from "./import-parts";

/** Whoever can bring the company in: it makes units and people. */
export function useCanImport() {
  const { user } = useAuth();
  return canManageCoreOrganization(user) && canImportCoreEmployees(user);
}

/** Drop (D-29): only the drop zone, with earlier imports under it once there are some. An open import resumes. */
export default function ImportDrop() {
  const t = useTranslations("companyImport");
  const router = useRouter();
  const queryClient = useQueryClient();
  const api = useImportApi();
  const allowed = useCanImport();
  const active = useActiveImport(allowed);
  const earlier = useEarlierImports(allowed);
  const tenant = useTenantSummary();
  const [reading, setReading] = useState<File[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const activeId = active.data?.id;
  useEffect(() => {
    if (activeId) router.replace(`/import/${activeId}`);
  }, [activeId, router]);

  async function start(files: File[]) {
    if (files.length === 0) return;
    const bad = checkImportFiles(files);
    if (bad) {
      setProblem(t(`fileProblem.${bad.problem}`, { name: bad.name ?? "", max: CORE_IMPORT_MAX_FILES }));
      return;
    }
    setProblem(null);
    setReading(files);
    try {
      const session = await api.start(files, tenant.data?.name);
      queryClient.setQueryData(coreImportQueryKeys.session(session.id), session);
      await queryClient.invalidateQueries({ queryKey: coreImportQueryKeys.active() });
      router.push(`/import/${session.id}`);
    } catch (caught) {
      setReading(null);
      setProblem(caught instanceof ApiError ? (caught.errors[0] ?? caught.message) : t("fileProblem.unreadable"));
    }
  }

  async function template() {
    downloadBlob(await api.template(), "Fusion-import-template.xlsx");
  }

  if (!allowed) return <PageContainer><PageRefusal /></PageContainer>;
  if (reading) return <ReadingFiles files={reading} />;

  return (
    <PageContainer width="wide" className="pb-12">
      <ImportHeader
        title={t("title")}
        actions={<Button variant="ghost" onClick={() => void template()}><Download className="size-4" aria-hidden /> {t("template")}</Button>}
      />
      {problem ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
      <DropZone onFiles={(files) => void start(files)} disabled={Boolean(activeId)} />
      {earlier.data && earlier.data.length > 0 ? <EarlierImports items={earlier.data} className="mt-6" /> : null}
    </PageContainer>
  );
}

export function DropZone({ onFiles, disabled, slim }: { onFiles: (files: File[]) => void; disabled?: boolean; slim?: boolean }) {
  const t = useTranslations("companyImport.drop");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!disabled) onFiles(Array.from(event.dataTransfer.files));
  };
  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        onFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
    />
  );

  if (slim)
    return (
      <>
        <Button variant="outline" onClick={() => input.current?.click()} disabled={disabled}>
          <Upload className="size-4" aria-hidden /> {t("add")}
        </Button>
        {picker}
      </>
    );

  return (
    <section
      aria-label={t("title")}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        "grid min-h-[26rem] place-items-center rounded-surface border-[1.5px] border-dashed bg-section px-10 py-12 text-center transition-colors duration-200",
        over ? "border-primary/60 bg-primary-tint" : "border-input",
      )}
    >
      <div className="grid justify-items-center gap-4">
        <div className="mb-1 flex gap-2.5" aria-hidden>
          {[FileSpreadsheet, FileText, FileSpreadsheet].map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "grid h-[4.25rem] w-14 place-items-center rounded-control border border-border bg-card text-muted-foreground",
                i === 0 && "-rotate-[7deg] translate-y-1",
                i === 2 && "rotate-[7deg] translate-y-1",
              )}
            >
              <Icon className="size-6" />
            </span>
          ))}
        </div>
        <div className="grid gap-1">
          <p className="type-section-title text-foreground">{over ? t("release") : t("title")}</p>
          <p className="type-body text-muted-foreground">{t("hint")}</p>
        </div>
        <Button onClick={() => input.current?.click()} disabled={disabled}>
          <Upload className="size-4" aria-hidden /> {t("choose")}
        </Button>
        {picker}
      </div>
    </section>
  );
}

/** While Fusion reads: the files, each with its quiet activity bar. A step opens only when reading is done (D-23). */
export function ReadingFiles({ files }: { files: File[] }) {
  const t = useTranslations("companyImport.reading");
  return (
    <PageContainer width="wide" className="pb-12" >
      <ImportHeader title={t("title", { count: files.length })} />
      <div className="grid gap-4" aria-busy="true">
        {files.map((file) => (
          <div key={file.name} className="flex items-center gap-3.5 rounded-surface bg-card px-5 py-4">
            <span className="grid size-[2.625rem] place-items-center rounded-control bg-inlay text-primary-ink">
              <FileIcon format={file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx"} className="size-5" />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="type-label truncate text-foreground">{file.name}</p>
              <p className="type-meta text-muted-foreground">{t("size", { kb: Math.max(1, Math.round(file.size / 1024)) })}</p>
            </div>
            <span className="flex items-center gap-2.5">
              <span className="type-meta text-muted-foreground">{t("label")}</span>
              <span className="relative h-1.5 w-40 overflow-hidden rounded-full bg-inlay">
                <i className="absolute inset-y-0 start-0 w-2/5 animate-pulse rounded-full bg-primary" />
              </span>
            </span>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
