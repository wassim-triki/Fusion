"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ds";
import { cn } from "@repo/ds/lib/utils";
import type { CompanyImportDto, CompanyImportField } from "@repo/api";
import { FileSpreadsheet, FileText, Sparkles } from "lucide-react";

export function FileIcon({ format, className }: { format: string; className?: string }) {
  const Icon = format === "csv" ? FileText : FileSpreadsheet;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** The files of the import, under its title. */
export function FileLine({ files }: { files: CompanyImportDto["files"] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file) => (
        <span key={file.id} className="inline-flex h-7 items-center gap-1.5 rounded-control border border-border bg-inlay px-2.5 type-meta text-foreground">
          <FileIcon format={file.format} className="text-muted-foreground" />
          {file.name}
        </span>
      ))}
    </div>
  );
}

/** Fusion's AI reading, marked quietly (D-24); the tooltip says what it read. */
export function AiMark({ hint, className }: { hint: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={hint} className={cn("inline-grid shrink-0 place-items-center text-primary-ink", className)}>
          <Sparkles className="size-3.5" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/** A column meaning in words: "Job level", "Manager". */
export function useFieldLabel() {
  const t = useTranslations("companyImport.fields");
  return (field: CompanyImportField | string) => t(`${field}.label` as never);
}

/** The header of an import step: title, the files under it, actions at the end. */
export function ImportHeader({ title, back, files, actions }: { title: ReactNode; back?: ReactNode; files?: CompanyImportDto["files"]; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
      <div className="grid min-w-0 gap-2">
        {back}
        <h1 className="type-page-title text-foreground">{title}</h1>
        {files && files.length > 0 ? <FileLine files={files} /> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A proportion as a thin bar: filled, then what still needs a look. */
export function ShareBar({ count, of, warn = 0 }: { count: number; of: number; warn?: number }) {
  if (of <= 0) return null;
  return (
    <span className="flex h-2 w-56 gap-0.5 overflow-hidden rounded-full" aria-hidden>
      <i className="block h-full rounded-detail bg-foreground/70" style={{ flex: count }} />
      {warn > 0 ? <i className="block h-full rounded-detail bg-warning" style={{ flex: warn }} /> : null}
      {of - count - warn > 0 ? <i className="block h-full rounded-detail bg-inlay" style={{ flex: of - count - warn }} /> : null}
    </span>
  );
}
