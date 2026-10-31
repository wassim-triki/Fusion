"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatLocale } from "@repo/ds/lib/dates";
import { useSay } from "@repo/ds/lib/say";
import { FileText, Pencil } from "@/lib/icons";
import { toast } from "sonner";
import { Button } from "@repo/ds/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ds/components/ui/dialog";
import { Input } from "@repo/ds/components/ui/input";
import { Label } from "@repo/ds/components/ui/label";
import type { TenantDetail } from "../api";
import { useFailureDetail, useTenantWords } from "../language";
import { industryLabel } from "../provisioning/industry-options";
import { useRenameTenant } from "../queries";
import { useTenantRecord } from "./record-shell";

/**
 * The tenant profile.
 *
 * The stable, platform-owned facts established at provisioning, read at a
 * glance. Only the organization display name is editable here — the tenant key,
 * created date, and internal id are immutable, and locale/time zone are shown as
 * their provisioning origin rather than as a second place to change what the
 * customer workspace owns.
 */
export function TenantProfile() {
  const { tenant } = useTenantRecord();
  const [editing, setEditing] = useState(false);
  const t = useTranslations("record.profile");
  const sayProvisioning = useSay("provisioning");
  const words = useTenantWords();
  const language = useLocale();

  const rows: { label: string; value: string }[] = [
    { label: t("name"), value: tenant.name },
    {
      label: t("industry"),
      value: tenant.industry
        ? industryLabel(tenant.industry, sayProvisioning)
        : t("notSpecified"),
    },
    { label: t("timeZone"), value: tenant.timeZone },
    { label: t("locale"), value: localeLabel(tenant.locale, language) },
    { label: t("provisioned"), value: words.date(tenant.createdAt) },
  ];

  return (
    <section className="rounded-surface bg-card p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <FileText
            aria-hidden="true"
            className="size-8 text-muted-foreground"
          />
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
        </div>
        {tenant.isArchived ? null : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            {t("edit")}
          </Button>
        )}
      </header>

      <dl className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-baseline gap-10 py-2.5"
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 truncate text-sm font-medium text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <RenameDialog tenant={tenant} open={editing} onOpenChange={setEditing} />
    </section>
  );
}

/**
 * Renaming the organization display name. It is the one profile field Platform
 * owns and may change; the tenant key does not move with it.
 */
function RenameDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: TenantDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rename = useRenameTenant();
  const t = useTranslations("record.profile");
  const failureDetail = useFailureDetail();
  const [name, setName] = useState(tenant.name);

  // Reopen always starts from the current name, not a stale edit.
  useEffect(() => {
    if (open) setName(tenant.name);
  }, [open, tenant.name]);

  const trimmed = name.trim();
  const canSave =
    trimmed.length >= 2 && trimmed !== tenant.name && !rename.isLoading;

  async function save() {
    if (!canSave) return;
    try {
      await rename.mutateAsync({ tenantId: tenant.tenantId, name: trimmed });
      toast.success(t("rename.done"), {
        description: t("rename.doneDescription", { name: trimmed }),
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(t("rename.failed"), {
        description: failureDetail(error),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("rename.title")}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Label htmlFor="tenant-name">{t("name")}</Label>
          <Input
            id="tenant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            autoFocus
            className="mt-1.5"
          />

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={rename.isLoading}
            >
              {t("rename.cancel")}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {rename.isLoading ? t("rename.saving") : t("rename.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The locale's language, named in the reader's own language. Only the language
 * subtag is shown — the provisioning locale identifies the language, not a
 * country the record does not otherwise claim.
 */
function localeLabel(locale: string, reader: string): string {
  const language = locale.split("-")[0] || locale;
  try {
    const name = new Intl.DisplayNames([formatLocale(reader)], {
      type: "language",
    }).of(language);
    return name
      ? name.charAt(0).toLocaleUpperCase(formatLocale(reader)) + name.slice(1)
      : locale;
  } catch {
    return locale;
  }
}
