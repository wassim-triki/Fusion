"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { EmployeeDocumentDto } from "@repo/api";
import { Button, Skeleton } from "@repo/ds";
import { Section } from "@repo/ds/shell";
import { useFormat } from "@repo/ds/lib/use-format";
import { Download, Eye, FileImage, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRefusal } from "@/i18n/words";
import { useDocumentMutations, usePeopleDocuments } from "../../api/use-people";
import { useWorkforceDate } from "../workforce-ui";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

/** Documents on a person (B-180): the person and HR see and add them; who sees them says so in the section. */
export function DocumentsTab({ employeeKey, audience }: { employeeKey: string; audience?: string }) {
  const t = useTranslations("profile.documents");
  const refusal = useRefusal();
  const documents = usePeopleDocuments(employeeKey);
  const mutations = useDocumentMutations(employeeKey);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const add = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t("tooLarge"));
      return;
    }
    try {
      await mutations.add.mutateAsync(file);
      toast.success(t("added", { name: file.name }));
    } catch (caught) {
      toast.error(refusal(caught, t("addFailed")));
    }
  };

  const open = async (document: EmployeeDocumentDto, download: boolean) => {
    setBusy(document.id);
    try {
      const blob = await mutations.open(document.id);
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = window.document.createElement("a");
        link.href = url;
        link.download = document.name;
        link.click();
      } else {
        window.open(url, "_blank", "noopener");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      toast.error(refusal(caught, t("openFailed")));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (document: EmployeeDocumentDto) => {
    setBusy(document.id);
    try {
      await mutations.remove.mutateAsync(document.id);
      toast.success(t("removed", { name: document.name }));
    } catch (caught) {
      toast.error(refusal(caught, t("removeFailed")));
    } finally {
      setBusy(null);
    }
  };

  const canAdd = documents.data?.canAdd === true;
  return (
    <Section
      id="profile-documents"
      title={t("title")}
      meta={audience ? <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" aria-hidden />{audience}</span> : undefined}
      action={
        canAdd ? (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                void add(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button writes variant="ghost" size="sm" disabled={mutations.add.isLoading} onClick={() => input.current?.click()}>
              <Plus className="size-4" aria-hidden /> {mutations.add.isLoading ? t("adding") : t("add")}
            </Button>
          </>
        ) : undefined
      }
      flush={Boolean(documents.data?.documents.length)}
    >
      {documents.isLoading && !documents.data ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      ) : !documents.data ? (
        <div className="flex items-center justify-between gap-4">
          <p className="type-body text-muted-foreground">{t("loadFailed")}</p>
          <Button variant="ghost" size="sm" onClick={() => void documents.refetch()}>
            <RotateCcw className="size-4" aria-hidden /> {t("retry")}
          </Button>
        </div>
      ) : documents.data.documents.length === 0 ? (
        <p className="type-body text-muted-foreground">{canAdd ? t("emptyCanAdd") : t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.data.documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              busy={busy === document.id}
              onOpen={() => void open(document, false)}
              onDownload={() => void open(document, true)}
              onRemove={() => void remove(document)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function DocumentRow({
  document,
  busy,
  onOpen,
  onDownload,
  onRemove,
}: {
  document: EmployeeDocumentDto;
  busy: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("profile.documents");
  const format = useFormat();
  const workforceDate = useWorkforceDate();
  const Icon = document.contentType === "application/pdf" ? FileText : FileImage;
  const size = document.sizeBytes >= 1024 * 1024
    ? format.number(document.sizeBytes / (1024 * 1024), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 })
    : format.number(Math.max(1, Math.round(document.sizeBytes / 1024)), { style: "unit", unit: "kilobyte" });
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-inlay text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <button type="button" onClick={onOpen} disabled={busy} className="min-w-0 flex-1 text-start outline-none focus-visible:rounded-control focus-visible:ring-2 focus-visible:ring-ring">
        <span className="block truncate type-label text-foreground hover:underline">{document.name}</span>
        <span className="block truncate type-meta text-muted-foreground">
          {t("meta", { by: document.addedBy, date: workforceDate(document.addedAt, { month: "short" }), size })}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" disabled={busy} aria-label={t("download", { name: document.name })} onClick={onDownload}>
          <Download className="size-4" aria-hidden />
        </Button>
        {document.canRemove ? (
          <Button writes variant="ghost" size="icon" disabled={busy} aria-label={t("remove", { name: document.name })} onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
