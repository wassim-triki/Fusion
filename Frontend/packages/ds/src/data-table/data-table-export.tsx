"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Spinner } from "../components/ui/spinner";

export type DataTableExportFormat = "csv" | "xlsx";

/** Saves a file the browser holds, under the name given. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The table kit's one Export: CSV or Excel, of what the table shows as filtered. The caller builds the file
 * (usually the server, so it holds only what the viewer may see); this control saves it and owns the
 * pending and failed states.
 */
export function DataTableExport({
  onExport,
  disabled,
}: {
  onExport: (format: DataTableExportFormat) => Promise<{ blob: Blob; fileName: string }>;
  disabled?: boolean;
}) {
  const t = useTranslations("ds.table.export");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(format: DataTableExportFormat) {
    setPending(true);
    setFailed(false);
    try {
      const { blob, fileName } = await onExport(format);
      saveFile(blob, fileName);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {failed ? (
        <span role="alert" className="type-meta text-destructive">
          {t("failed")}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={disabled || pending} aria-busy={pending || undefined}>
            {pending ? <Spinner aria-hidden /> : <Download aria-hidden />}
            {t("button")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void run("csv")}>{t("csv")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run("xlsx")}>{t("xlsx")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
