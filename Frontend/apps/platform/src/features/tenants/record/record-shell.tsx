"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageFailure } from "@repo/auth";
import {
  Archive,
  Ban,
  Check,
  Copy,
  MoreHorizontal,
  RotateCcw,
} from "@/lib/icons";
import { Button } from "@repo/ds/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
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
import { RecordSkeleton } from "./record-skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ds/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@repo/ds/lib/utils";
import { PageContainer, StatusBadge } from "@repo/ds/shell";
import { type TenantDetail } from "../api";
import { useFailureDetail } from "../language";
import { TenantMonogram } from "../overview/tenant-monogram";
import { useTenantDetail, useTenantLifecycle } from "../queries";
import {
  RECORD_DESTINATIONS,
  destinationHref,
  isActiveDestination,
  recordQuery,
} from "./record-routes";

/**
 * The tenant's durable Platform record.
 *
 * Everything a Platform Administrator can ask about one customer tenant is
 * answered inside this frame: who administers it, what it is entitled to, how
 * it is running, what has happened to it, and which Platform-owned settings
 * apply. Administrator activation is one conditional concern inside that, not
 * the record's purpose — the frame therefore looks the same before and after a
 * tenant activates, and a later capability fills an area rather than rearranging
 * the record.
 *
 * The record is loaded once, here, and read from context by every destination.
 * Moving between them is navigation within one record, so it must not read as
 * six pages that each fetch a tenant.
 */

interface RecordValue {
  tenant: TenantDetail;
  /** The directory query to return to, decoded. */
  from: string | null;
  /**
   * The suffix every link inside the record must carry so the directory behind
   * it survives. It re-encodes `from` rather than appending it raw — the
   * directory query contains its own `=` and `&`, and splicing it in would make
   * the record's own route absorb it and lose the way back.
   */
  query: string;
  /**
   * Re-reads the record. Shared rather than re-subscribed per destination, so a
   * destination that offers a refresh reuses the one query the shell already
   * holds instead of issuing a second request for the same tenant.
   */
  refresh: () => void;
  isRefreshing: boolean;
}

const RecordContext = createContext<RecordValue | null>(null);

export function useTenantRecord(): RecordValue {
  const value = useContext(RecordContext);
  if (!value) {
    throw new Error(
      "Tenant record destinations must render inside the record shell."
    );
  }
  return value;
}

export function TenantRecordShell({
  tenantId,
  children,
}: {
  tenantId: string;
  children: ReactNode;
}) {
  const {
    data: tenant,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useTenantDetail(tenantId);
  const searchParams = useSearchParams();

  // Returning lands on the directory the operator left, not an unfiltered one.
  // It is carried across the record's own destinations too, so a detour through
  // Audit does not lose the list behind it.
  const from = searchParams.get("from");
  const query = recordQuery(from);

  // A fresh object here would re-render every consumer on each `isFetching`
  // transition, which is most of the record.
  const record = useMemo<RecordValue | null>(
    () =>
      tenant
        ? {
            tenant,
            from,
            query,
            refresh: refetch,
            isRefreshing: isFetching && !isLoading,
          }
        : null,
    [tenant, from, query, refetch, isFetching, isLoading]
  );

  return (
    <PageContainer width="default">
      {isLoading ? <RecordSkeleton /> : null}

      {!isLoading && error ? (
        <RecordFailure error={error} onRetry={refetch} />
      ) : null}

      {!isLoading && !error && tenant && record ? (
        <RecordContext.Provider value={record}>
          <RecordHeader tenant={tenant} />
          <RecordNavigation tenantId={tenant.tenantId} query={query} />
          {children}
        </RecordContext.Provider>
      ) : null}
    </PageContainer>
  );
}

/**
 * The record's identity.
 *
 * The monogram gives the tenant a shape to recognise before the name is read,
 * which matters when an operator moves between several tenants in a session.
 * It is derived from the name rather than stored — a reading aid, not a brand,
 * and deliberately square so it cannot be mistaken for a person's avatar.
 *
 * The header establishes only the resource: who it is, whether it is usable, and
 * its canonical key. The status shown is the tenant's lifecycle — Active,
 * Deactivated or Archived — and deliberately not the administrator's invitation state,
 * which is a separate concern and belongs in the body. Provisioning facts,
 * created date, and internal id stay out of the header so it does not become a
 * fact sheet; they live in the Overview profile.
 */
function RecordHeader({ tenant }: { tenant: TenantDetail }) {
  const t = useTranslations("record");
  return (
    <header className="mb-6 flex min-w-0 items-center gap-4 sm:gap-5">
      <TenantMonogram
        name={tenant.name}
        className="size-14 rounded-surface text-base sm:size-16 sm:text-lg"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="type-display min-w-0 break-words text-foreground">
            {tenant.name}
          </h1>
          <StatusBadge tone={tenant.isActive ? "success" : "neutral"} dot>
            {tenant.isArchived
              ? t("status.archived")
              : tenant.isActive
                ? t("status.active")
                : t("status.deactivated")}
          </StatusBadge>
        </div>

        <div className="mt-1">
          <TenantKey slug={tenant.slug} />
        </div>
      </div>

      <TenantLifecycleMenu tenant={tenant} />
    </header>
  );
}

/**
 * The record's overflow: tenant lifecycle only.
 *
 * An Active tenant can be deactivated; a deactivated one can be reactivated;
 * either can be archived, which offboards the customer for good. An archived
 * tenant has nothing left to do. Profile edits, product entitlements, and
 * invitation recovery act on their own objects elsewhere; this menu governs the
 * single platform-owned state that has no home of its own.
 *
 * Deactivation and archival remove customer access, so both are confirmed
 * before they run and say plainly what they do and do not touch. Reactivation
 * restores access and needs no confirmation. All settle by refetching the
 * record, so the header status reflects the authoritative outcome.
 */
function TenantLifecycleMenu({ tenant }: { tenant: TenantDetail }) {
  const [confirming, setConfirming] = useState<"deactivate" | "archive" | null>(
    null
  );
  // Busy across the whole task, not just the request: the mutation invalidates
  // the record, and neither control should free up until that refetched result
  // has settled. `mutateAsync` resolves only after the awaited invalidation.
  const [running, setRunning] = useState(false);
  const deactivate = useTenantLifecycle("deactivate");
  const reactivate = useTenantLifecycle("reactivate");
  const archive = useTenantLifecycle("archive");
  const t = useTranslations("record");
  const failureDetail = useFailureDetail();
  // Held while the dialog closes, so its text does not switch mid-animation.
  const [shown, setShown] = useState<"deactivate" | "archive">("deactivate");
  const confirmed = shown === "archive" ? archive : deactivate;
  const busy = running || confirmed.isLoading;

  function ask(action: "deactivate" | "archive") {
    setShown(action);
    setConfirming(action);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("menu.label")}
            className="size-9 shrink-0 self-start text-muted-foreground"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(tenant.tenantId).catch(() => {
                // Clipboard access can be refused; nothing else depends on it.
              });
            }}
          >
            <Copy />
            {t("menu.copyId")}
          </DropdownMenuItem>
          {tenant.isArchived ? null : (
            <>
              <DropdownMenuSeparator />
              {tenant.isActive ? (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => ask("deactivate")}
                >
                  <Ban />
                  {t("menu.deactivate")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={running || reactivate.isLoading}
                  onSelect={(event) => {
                    event.preventDefault();
                    setRunning(true);
                    void reactivate
                      .mutateAsync(tenant.tenantId)
                      .then(() =>
                        toast.success(t("toast.reactivated"), {
                          description: t("toast.reactivatedBody", {
                            name: tenant.name,
                          }),
                        })
                      )
                      .catch((error) =>
                        toast.error(t("toast.reactivateFailed"), {
                          description: failureDetail(error),
                        })
                      )
                      .finally(() => setRunning(false));
                  }}
                >
                  <RotateCcw />
                  {t("menu.reactivate")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => ask("archive")}
              >
                <Archive />
                {t("menu.archive")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${shown}.title`, { name: tenant.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${shown}.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t(`${shown}.cancel`)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                setRunning(true);
                void confirmed
                  .mutateAsync(tenant.tenantId)
                  .then(() => {
                    setConfirming(null);
                    toast.success(t(`toast.${shown}d`), {
                      description: t(`toast.${shown}dBody`, {
                        name: tenant.name,
                      }),
                    });
                  })
                  .catch((error) => {
                    // The record refetches on settle; the dialog stays open so
                    // the operator sees the attempt did not take.
                    toast.error(t(`toast.${shown}Failed`), {
                      description: failureDetail(error),
                    });
                  })
                  .finally(() => setRunning(false));
              }}
            >
              {busy ? t(`${shown}.pending`) : t(`menu.${shown}`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The tenant key.
 *
 * The human-readable, effectively immutable identifier a Platform Admin uses to
 * refer to this tenant — so it is shown in full and copied whole rather than
 * hidden behind the internal UUID. Copy is the whole interaction here; the key
 * is short enough to read, so it is the control, not a label beside one.
 */
function TenantKey({ slug }: { slug: string }) {
  const t = useTranslations("record.key");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(slug);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the key is still readable in place.
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? t("copied") : t("copy", { slug })}
            className="group -ms-1 inline-flex min-h-7 items-center gap-1.5 rounded-control px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
          >
            <span className="font-mono">{slug}</span>
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-success" />
            ) : (
              <Copy
                aria-hidden="true"
                className="size-3.5 text-muted-foreground/70 transition-colors group-hover:text-primary-ink motion-reduce:transition-none"
              />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {copied ? t("copiedShort") : t("tooltip")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The record's destinations.
 *
 * A horizontal strip rather than a second sidebar: the tenant is the subject,
 * and these are views of it. The strip scrolls inside itself on a narrow
 * screen so every destination stays reachable without the page itself
 * scrolling sideways.
 */
function RecordNavigation({
  tenantId,
  query,
}: {
  tenantId: string;
  query: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("record");

  return (
    <nav
      aria-label={t("navigation")}
      // overflow-y-hidden explicitly: setting one axis to auto makes the other
      // auto too, which let the strip scroll vertically by a stray pixel.
      className="-mx-6 mb-6 overflow-x-auto overflow-y-hidden border-b border-border px-6"
    >
      <ul className="flex w-max min-w-full gap-7">
        {RECORD_DESTINATIONS.map((destination) => {
          const href = destinationHref(tenantId, destination.segment);
          const isActive = isActiveDestination(
            pathname,
            tenantId,
            destination.segment
          );

          return (
            <li key={destination.segment || "overview"}>
              <Link
                href={`${href}${query}`}
                // Read out as the current page, so the active destination is
                // not carried by weight and a rule alone.
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center whitespace-nowrap border-b-2 py-3 text-sm transition-colors motion-reduce:transition-none",
                  "focus-visible:rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  isActive
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {t(`destinations.${destination.id}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function RecordFailure({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const nav = useTranslations("frame.nav");
  return <PageFailure error={error} onRetry={onRetry} back={{ href: "/platform/tenants", label: nav("tenants") }} />;
}
