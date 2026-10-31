"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Layers } from "@/lib/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ds/components/ui/alert-dialog";
import { Switch } from "@repo/ds/components/ui/switch";
import { cn } from "@repo/ds/lib/utils";
import { useFormat } from "@repo/ds/lib/use-format";
import { StatusBadge } from "@repo/ds/shell";
import type { TenantHistoryEntry } from "../api";
import { useFailureDetail, useTenantWords } from "../language";
import { useSetTenantProduct } from "../queries";
import { productRows, type ProductRow } from "./products-summary";
import { useTenantRecord } from "./record-shell";

const PRODUCT_EVENTS = new Set(["ProductEnabled", "ProductDisabled"]);

/**
 * Every Fusion product and where this tenant stands on each, with when and by
 * whom access last changed.
 *
 * A platform administrator turns an optional product (Performance) on or off
 * here. Off pauses it: the tenant's data, roles and assignments are kept, and
 * people lose it as their sessions renew, which the confirmation says. Core HR
 * is included with every tenant and has no switch; an archived tenant has none.
 */
export function TenantProductsDestination() {
  const { tenant } = useTenantRecord();
  const t = useTranslations("record.productsPage");
  const states = useTranslations("record.products.states");
  const format = useFormat();
  const failureDetail = useFailureDetail();
  const words = useTenantWords();
  const setProduct = useSetTenantProduct();
  const [confirming, setConfirming] = useState<{ row: ProductRow; enabled: boolean } | null>(null);
  // Held while the dialog closes, so its words don't switch mid-animation.
  const [shown, setShown] = useState<{ row: ProductRow; enabled: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const rows = productRows(tenant.modules);
  const inUse = rows.filter((row) => row.state !== "Disabled").length;
  const provisioned = tenant.history.find(
    (entry) => entry.eventType === "TenantProvisioned"
  );
  const grantedBy = provisioned?.actorName?.trim();
  // History is newest first: a product's latest change is the first one that names it.
  const lastChange = (row: ProductRow): TenantHistoryEntry | undefined =>
    tenant.history.find(
      (entry) => PRODUCT_EVENTS.has(entry.eventType) && entry.reason === row.module
    );

  function ask(row: ProductRow, enabled: boolean) {
    setShown({ row, enabled });
    setConfirming({ row, enabled });
  }

  function confirm() {
    if (!shown?.row.module) return;
    const { row, enabled } = shown;
    setRunning(true);
    void setProduct
      .mutateAsync({ tenantId: tenant.tenantId, module: row.module!, enabled })
      .then(() => {
        setConfirming(null);
        toast.success(t(enabled ? "on.done" : "off.done", { product: row.label, tenant: tenant.name }));
      })
      .catch((error) =>
        toast.error(t(enabled ? "on.failed" : "off.failed", { product: row.label }), {
          description: failureDetail(error),
        })
      )
      .finally(() => setRunning(false));
  }

  const busy = running || setProduct.isLoading;
  const direction = shown?.enabled ? "on" : "off";

  return (
    <section className="rounded-surface bg-card p-5">
      <header className="flex items-center gap-3">
        <Layers
          aria-hidden="true"
          className="size-8 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("count", { count: inUse, total: rows.length })}
          </p>
        </div>
      </header>

      <div className="mt-4 overflow-x-auto rounded-surface border border-border bg-inlay">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-start font-medium">
                {t("product")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium">
                {t("status")}
              </th>
              <th scope="col" className="px-4 py-2.5 text-start font-medium">
                {t("granted")}
              </th>
              <th scope="col" className="w-px px-4 py-2.5 text-end font-medium">
                <span className="sr-only">{t("access")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const disabled = row.state === "Disabled";
              const change = row.toggleable ? lastChange(row) : undefined;
              return (
                <tr key={row.key}>
                  <th scope="row" className="px-4 py-3 text-start font-medium">
                    <span className="flex items-center gap-3">
                      <row.icon
                        aria-hidden="true"
                        className={cn(
                          "size-5 shrink-0",
                          disabled
                            ? "text-muted-foreground/60"
                            : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={
                          disabled ? "text-muted-foreground" : "text-foreground"
                        }
                      >
                        {row.label}
                      </span>
                    </span>
                  </th>
                  <td className="px-4 py-3">
                    <StatusBadge tone={row.tone} dot>
                      {states(row.state)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {change ? (
                      <>
                        <span className="text-foreground">
                          {format.date(change.occurredAt, { year: "always" })}
                        </span>
                        <span className="block text-xs">
                          {t(change.eventType === "ProductEnabled" ? "turnedOnBy" : "turnedOffBy", {
                            name: words.eventActor(change.actorName),
                          })}
                        </span>
                      </>
                    ) : disabled ? (
                      <span aria-label={t("notGranted")}>—</span>
                    ) : (
                      <>
                        <span className="text-foreground">
                          {format.date(tenant.createdAt, { year: "always" })}
                        </span>
                        <span className="block text-xs">
                          {grantedBy
                            ? t("byPerson", { name: grantedBy })
                            : t("atProvisioning")}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {row.toggleable && !tenant.isArchived ? (
                      <Switch
                        checked={!disabled}
                        disabled={busy}
                        aria-label={t("switch", { product: row.label })}
                        onCheckedChange={(next) => ask(row, next)}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => (open || busy ? undefined : setConfirming(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${direction}.title`, { product: shown?.row.label ?? "", tenant: tenant.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${direction}.description`, { product: shown?.row.label ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={shown?.enabled ? "default" : "destructive"}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                confirm();
              }}
            >
              {busy ? t(`${direction}.pending`) : t(`${direction}.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
