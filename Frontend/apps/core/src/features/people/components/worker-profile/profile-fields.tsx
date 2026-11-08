"use client";

import { useTranslations } from "next-intl";
import { useState, type KeyboardEvent } from "react";
import type { EmployeeProfileFieldDto } from "@repo/api";
import { Badge, Button, Input } from "@repo/ds";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useRefusal } from "@/i18n/words";
import { useUpdatePeopleField } from "../../api/use-people";

/** The company's own fields (B-181), each read and changed in place; the server decides who sees and changes it. */
export function ProfileFields({ employeeKey, fields }: { employeeKey: string; fields: EmployeeProfileFieldDto[] }) {
  const shown = fields.filter((field) => field.canEdit || hasValue(field));
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-4">
      {shown.map((field) => <ProfileField key={field.key} employeeKey={employeeKey} field={field} />)}
    </div>
  );
}

function tagsOf(field: EmployeeProfileFieldDto) {
  return Array.isArray(field.value) ? field.value.filter((value): value is string => typeof value === "string") : [];
}

function textOf(field: EmployeeProfileFieldDto) {
  return typeof field.value === "string" ? field.value : "";
}

function hasValue(field: EmployeeProfileFieldDto) {
  return field.type === "Tags" ? tagsOf(field).length > 0 : textOf(field).length > 0;
}

function ProfileField({ employeeKey, field }: { employeeKey: string; field: EmployeeProfileFieldDto }) {
  const t = useTranslations("profile.overview");
  const refusal = useRefusal();
  const update = useUpdatePeopleField(employeeKey);
  const tags = tagsOf(field);
  const text = textOf(field);
  const [editing, setEditing] = useState(false);
  const [chips, setChips] = useState<string[]>(tags);
  const [draft, setDraft] = useState(text);
  const filled = hasValue(field);

  const start = () => {
    setChips(tags);
    setDraft(field.type === "Tags" ? "" : text);
    setEditing(true);
  };

  const save = async () => {
    const value = field.type === "Tags" ? withDraft(chips, draft) : draft.trim() || null;
    try {
      await update.mutateAsync({ fieldKey: field.key, value });
      toast.success(t("fieldSaved", { field: field.label }));
      setEditing(false);
    } catch (caught) {
      toast.error(refusal(caught, t("fieldFailed", { field: field.label })));
    }
  };

  return (
    <div>
      <div className="mb-2 flex min-h-8 items-center justify-between gap-3">
        <h3 className="type-label text-foreground">{field.label}</h3>
        {field.canEdit && !editing ? (
          <Button variant="ghost" size="sm" onClick={start}>{filled ? t("edit") : t("add")}</Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {field.type === "Tags" ? (
            <ChipInput label={field.label} chips={chips} draft={draft} onChips={setChips} onDraft={setDraft} />
          ) : (
            <Input
              value={draft}
              autoFocus
              type={field.type === "Date" ? "date" : field.type === "Email" ? "email" : field.type === "Phone" ? "tel" : "text"}
              maxLength={2000}
              aria-label={field.label}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button writes type="submit" size="sm" disabled={update.isLoading}>{t("save")}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={update.isLoading} onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : field.type === "Tags" ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
        </div>
      ) : filled ? (
        <p className="type-body text-foreground">{text}</p>
      ) : null}
    </div>
  );
}

/** What's still typed counts too, so Save never drops the last chip. */
function withDraft(chips: string[], draft: string) {
  const next = [...chips];
  for (const item of draft.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (!next.some((chip) => chip.toLocaleLowerCase() === item.toLocaleLowerCase())) next.push(item);
  }
  return next;
}

function ChipInput({ label, chips, draft, onChips, onDraft }: {
  label: string;
  chips: string[];
  draft: string;
  onChips: (chips: string[]) => void;
  onDraft: (draft: string) => void;
}) {
  const t = useTranslations("profile.overview");
  const commit = () => {
    onChips(withDraft(chips, draft));
    onDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      if (!draft.trim()) return;
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && chips.length > 0) {
      onChips(chips.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-control border border-input bg-inlay px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {chips.map((chip) => (
        <Badge key={chip} variant="secondary" className="gap-1 pe-1">
          {chip}
          <button
            type="button"
            className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t("removeTag", { tag: chip })}
            onClick={() => onChips(chips.filter((item) => item !== chip))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        autoFocus
        maxLength={100}
        aria-label={label}
        placeholder={chips.length ? undefined : t("tagsPrompt")}
        className="min-w-24 flex-1 bg-transparent px-1 type-body outline-none placeholder:text-muted-foreground"
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { if (draft.trim()) commit(); }}
      />
    </div>
  );
}
