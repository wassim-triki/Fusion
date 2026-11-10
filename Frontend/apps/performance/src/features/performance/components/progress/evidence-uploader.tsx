"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useRef, useState } from "react";
import { FileText, Link2, Loader2, Paperclip, Plus, Type, X } from "@repo/ds/icons";
import type { EvidenceInput } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Input } from "@repo/ds/components/ui/input";
import { cn } from "@repo/ds/lib/utils";
import { useTranslations } from "next-intl";

type UploadFn = (file: File) => Promise<{ uploadId: string; fileName: string; contentType: string; sizeBytes: number }>;

function humanSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Bounded evidence attachment for a progress update — a file (staged via upload with progress and
 * failure/retry), an external link, or a short reference. Items can be removed before Save; this is
 * not a document-management product, just the evidence that belongs to one update.
 */
export function EvidenceUploader({
  items,
  onChange,
  upload,
}: {
  items: EvidenceInput[];
  onChange: (items: EvidenceInput[]) => void;
  upload: UploadFn;
}) {
  const t = useTranslations("progress.EvidenceUploader");
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"none" | "link">("none");
  const [linkUrl, setLinkUrl] = useState("");

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const descriptor = await upload(file);
      onChange([
        ...items,
        {
          kind: "File",
          uploadId: descriptor.uploadId,
          fileName: descriptor.fileName,
          contentType: descriptor.contentType,
          sizeBytes: descriptor.sizeBytes,
        },
      ]);
    } catch (error) {
      reportPerformanceFailure(error, t("uploadFailedTryAgain"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {/* Staged items. */}
      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2 rounded-control border px-3 py-2 type-body">
              {item.kind === "File" ? <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
              {item.kind === "Link" ? <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
              {item.kind === "Reference" ? <Type className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
              <span className="min-w-0 flex-1 truncate">
                {item.kind === "File" ? item.fileName : item.kind === "Link" ? item.label || item.url : item.referenceText}
                {item.kind === "File" && item.sizeBytes ? (
                  <span className="ms-1.5 type-meta text-muted-foreground">{humanSize(item.sizeBytes)}</span>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("removeEvidence")}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Actions — two clean affordances; the file button also accepts a drop. */}
      {mode === "none" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className="flex flex-wrap items-center gap-2.5"
        >
          <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.txt,.csv" className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className={cn(dragging && "border-primary bg-primary/[0.04]")}
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" /> : <Paperclip className="size-3.5" data-icon="inline-start" />}
            {uploading ? t("uploading") : t("attachFile")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setMode("link")}>
            <Link2 className="size-3.5" data-icon="inline-start" /> {t("addLink")}
          </Button>
        </div>
      ) : null}

      {mode === "link" ? (
        <div className="space-y-2 rounded-surface border p-3">
          <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder={t("https")} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("none")}>{t("cancel")}</Button>
            <Button
              type="button"
              size="sm"
              disabled={linkUrl.trim() === ""}
              onClick={() => {
                onChange([...items, { kind: "Link", url: linkUrl.trim(), label: null }]);
                setLinkUrl("");
                setMode("none");
              }}
            >
              <Plus className="size-3.5" data-icon="inline-start" /> {t("addLink")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
