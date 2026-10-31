"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import {
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  Check,
  Info,
  KeyRound,
  Lock,
  Settings2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  canViewTenantAdministration,
  canViewWorkforceAccess,
  useAuth,
  type AuthUser,
} from "@repo/auth";
import type { ContinuityState } from "@repo/api";

const CONTINUITY_TONE: Record<ContinuityState, StatusTone> = {
  Healthy: "success",
  AtRisk: "warning",
  RecoveryRequired: "danger",
};
import { Button, cn } from "@repo/ds";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { PageContainer, PagePermissionNotice, StatusBadge, type StatusTone } from "@repo/ds/shell";
import { ADMINISTRATORS_PATH } from "@/features/settings/roles/paths";
import { useEmployeeRoster } from "@/features/people/api/use-employees";
import { useTenantAccessSummary } from "@/features/tenant-access/api/use-tenant-access";
import { useAccessRosterSummary } from "@/features/workforce-access/api/use-workforce-access";
import { useCoreHRReadiness, useOrganizationReadiness } from "@/features/organization/api/use-organization";
import { canViewCoreOrganization } from "@repo/auth";
import {
  capabilityTitle,
  composeSetupCapabilities,
  deriveLaunchpadVariant,
  recommendedNextStep,
  type CapabilityState,
  type ComposedCapability,
  type LaunchpadVariant,
} from "./compose";

const WORKFORCE_PRESENCE_QUERY = {
  page: 1,
  pageSize: 1,
  sortBy: "Name" as const,
  sortDir: "Asc" as const,
};

const CAPABILITY_ICON: Record<string, LucideIcon> = {
  "administrator-access": ShieldCheck,
  "tenant-configuration": Settings2,
  organization: Building2,
  workforce: Users,
  "workforce-access": KeyRound,
  performance: ChartNoAxesCombined,
};

/**
 * A capability's visual family on the launchpad. This is presentation only —
 * the authoritative `CapabilityState` stays in `compose.ts`. The ladder marker,
 * the spine connector, and the readiness meter all read from this so a single
 * mapping governs how state looks across the surface.
 */
type NodeTone =
  | "ready"
  | "next"
  | "neutral"
  | "blocked"
  | "planned"
  | "available";

const MARKER_TONE: Record<NodeTone, string> = {
  ready: "bg-success-subtle text-success ring-1 ring-inset ring-success/30",
  next: "bg-warning-subtle text-warning ring-1 ring-inset ring-warning/45",
  neutral: "bg-muted text-foreground/75 ring-1 ring-inset ring-border",
  blocked: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  planned: "border border-dashed border-border text-muted-foreground/60",
  available: "bg-warning-subtle text-warning ring-1 ring-inset ring-warning/45",
};

const SEGMENT_TONE: Record<NodeTone, string> = {
  ready: "bg-success",
  next: "bg-warning",
  neutral: "bg-muted-foreground/30",
  blocked: "bg-muted-foreground/25",
  planned: "bg-muted-foreground/15",
  available: "bg-warning",
};

function toneForState(state: CapabilityState): NodeTone {
  if (state === "ready") return "ready";
  if (state === "in-progress") return "next";
  if (state === "blocked") return "blocked";
  if (state === "planned") return "planned";
  return "neutral";
}

/**
 * Canonical tenant-level setup launchpad.
 *
 * This surface composes authoritative reads from Identity and Core. It owns no
 * setup workflow or progress data, and opening it never mutates tenant state.
 */
export default function SetupLaunchpad() {
  const { user, isLoading } = useAuth();
  const t = useTranslations("setup");

  if (isLoading) {
    return <LaunchpadSkeleton />;
  }

  if (!user || !canViewTenantAdministration(user)) {
    return (
      <PageContainer className="space-y-6">
        <header className="space-y-2">
          <span className="type-eyebrow text-muted-foreground">
            {t("eyebrow")}
          </span>
          <h1 className="type-page-title">{t("title")}</h1>
        </header>
        <PagePermissionNotice
          title={t("denied.title")}
          description={t("denied.description")}
        />
      </PageContainer>
    );
  }

  // Capability reads live below the authorization boundary so a denied reader
  // does not fetch tenant name, workforce, or setup presentation data.
  return <AuthorizedSetupLaunchpad user={user} />;
}

export function AuthorizedSetupLaunchpad({ user }: { user: AuthUser }) {
  const organizationReadiness = useOrganizationReadiness(
    canViewCoreOrganization(user)
  );
  const accessSummary = useTenantAccessSummary(
    canViewTenantAdministration(user)
  );
  const workforce = useEmployeeRoster(WORKFORCE_PRESENCE_QUERY);
  const coreHRReadinessData = useCoreHRReadiness(canViewCoreOrganization(user)).data ?? null;
  const workforceAccess = useAccessRosterSummary(canViewWorkforceAccess(user));
  const workforceAccessSummary = workforceAccess.error
    ? null
    : workforceAccess.isLoading
      ? undefined
      : (workforceAccess.data ?? null);

  const workforceTotalCount = workforce.error
    ? null
    : workforce.isLoading
      ? undefined
      : (workforce.data?.totalCount ?? null);
  const effectiveSetupState = organizationReadiness.error
    ? null
    : organizationReadiness.isLoading
      ? undefined
      : (organizationReadiness.data ?? null);
  const administratorCount = accessSummary.error
    ? null
    : accessSummary.isLoading
      ? undefined
      : (accessSummary.data?.activeAdministrators ?? null);

  const say = useSay("setup");
  const composed = useMemo(
    () =>
      composeSetupCapabilities({
        user,
        entitlements: user.moduleEntitlements ?? [],
        setupState: effectiveSetupState,
        workforceTotalCount,
        coreHRReadiness: coreHRReadinessData,
        workforceAccessSummary,
        administratorCount,
        say,
      }),
    [
      say,
      effectiveSetupState,
      user,
      workforceTotalCount,
      coreHRReadinessData,
      workforceAccessSummary,
      administratorCount,
    ]
  );

  const isInitialLoading =
    organizationReadiness.isLoading ||
    accessSummary.isLoading ||
    workforce.isLoading;

  if (isInitialLoading) {
    return <LaunchpadSkeleton />;
  }

  const visible = composed.filter((entry) => entry.state !== "not-included");
  const recommendation = recommendedNextStep(visible);
  const recommendationKey = recommendation?.capability.key ?? null;
  const entries = visible
    // Organization always keeps its place in the ladder, even when it is the
    // recommended next step, so the foundation reads in full order.
    .filter(
      (entry) =>
        entry.capability.key === "organization" ||
        entry.capability.key !== recommendationKey
    )
    .sort((left, right) => left.capability.order - right.capability.order);
  const variant = deriveLaunchpadVariant(visible, workforceTotalCount);
  const tenantName = accessSummary.data?.tenantName?.trim() || "your tenant";

  // Administrative continuity is a live tenant-health read, not a buildout step.
  // The launchpad already fetched it; a failed read yields `null` rather than an
  // invented "healthy" state.
  const continuity: ContinuityState | null =
    accessSummary.error || !accessSummary.data
      ? null
      : accessSummary.data.continuity;
  const activeAdministrators =
    typeof administratorCount === "number" ? administratorCount : null;

  return (
    <LaunchpadView
      tenantName={tenantName}
      variant={variant}
      recommendation={recommendation}
      entries={entries}
      continuity={continuity}
      activeAdministrators={activeAdministrators}
      onRetry={(key) => {
        if (key === "organization" || organizationReadiness.error) {
          void organizationReadiness.refetch();
          return;
        }

        if (key === "workforce") {
          void workforce.refetch();
        }
      }}
    />
  );
}

export function LaunchpadView({
  tenantName,
  variant,
  recommendation,
  entries,
  continuity,
  activeAdministrators,
  onRetry,
}: {
  tenantName: string;
  variant: LaunchpadVariant;
  recommendation: ComposedCapability | null;
  entries: ComposedCapability[];
  continuity: ContinuityState | null;
  activeAdministrators: number | null;
  onRetry: (key: string) => void;
}) {
  const t = useTranslations("setup");
  const isFresh = variant === "fresh";
  const description = t(`description.${variant}`);

  // Readiness is measured over the real, ownable foundation — the pieces a
  // tenant actually stands up — so planned/entitlement rows never dilute the
  // count. The recommended step is included: it is foundation that is not yet
  // ready, which is exactly what the meter should show as remaining.
  // The buildout ladder: the sequential foundation a tenant stands up. Its rungs
  // carry linear progress, so the administration surfaces are pulled out below.
  // Administrator access stays as a rung — it is the first thing established —
  // but only as a state marker; its management moves to the continuity card so it
  // is never a double affordance.
  const ladderEntries = entries
    .filter((entry) => entry.capability.group === "foundation")
    .map((entry) =>
      entry.capability.key === "administrator-access"
        ? { ...entry, detail: null, isActionable: false }
        : entry
    );
  const administrationEntries = entries.filter(
    (entry) => entry.capability.group === "administration"
  );
  const moduleEntries = entries.filter(
    (entry) => entry.capability.group === "module"
  );

  const foundation = [recommendation, ...ladderEntries]
    .filter(
      (entry): entry is ComposedCapability =>
        entry != null && entry.capability.group === "foundation"
    )
    // Organization can now be both the recommendation and a ladder entry, so
    // collapse to one segment per capability to keep meter keys unique.
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) => candidate.capability.key === entry.capability.key
        ) === index
    )
    // Segments follow the ladder's order rather than leading with the
    // recommendation, so the meter reads left-to-right as the rungs do.
    .sort((left, right) => left.capability.order - right.capability.order);
  const readyCount = foundation.filter(
    (entry) => entry.state === "ready"
  ).length;

  const hasAdministration =
    administrationEntries.length > 0 || activeAdministrators !== null;

  return (
    <PageContainer className="mx-auto max-w-5xl space-y-9 pb-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl space-y-2.5">
          <span className="type-eyebrow text-primary-ink">{t("eyebrow")}</span>
          {isFresh ? (
            <h1 className="type-display text-balance text-4xl leading-[1.05] sm:text-5xl">
              <span className="text-[0.55em] font-medium text-foreground/70">
                {t("welcome")}
              </span>{" "}
              {tenantName}
            </h1>
          ) : (
            <h1 className="type-display text-balance">{t("title")}</h1>
          )}
          <p className="type-body max-w-xl text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        {foundation.length > 0 ? (
          <ReadinessMeter
            segments={foundation}
            recommendationKey={recommendation?.capability.key ?? null}
            readyCount={readyCount}
          />
        ) : null}
      </header>

      {recommendation ? <RecommendationPanel entry={recommendation} /> : null}

      {ladderEntries.length > 0 ? (
        <section
          aria-labelledby="tenant-foundation-heading"
          className="space-y-5"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2
              id="tenant-foundation-heading"
              className="type-subsection-title text-foreground"
            >
              {t("foundationHeading")}
            </h2>
            <span className="type-meta text-muted-foreground">
              {t("readyCount", { ready: readyCount, total: foundation.length })}
            </span>
          </div>

          <div className="relative">
            {ladderEntries.map((entry, index) => (
              <LadderNode
                key={entry.capability.key}
                entry={entry}
                isLast={index === ladderEntries.length - 1}
                onRetry={() => onRetry(entry.capability.key)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {hasAdministration ? (
        <section
          aria-labelledby="tenant-administration-heading"
          className="space-y-5"
        >
          <h2
            id="tenant-administration-heading"
            className="type-subsection-title text-foreground"
          >
            {t("administrationHeading")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {activeAdministrators !== null || continuity !== null ? (
              <ContinuityCard
                continuity={continuity}
                activeAdministrators={activeAdministrators}
              />
            ) : null}
            {administrationEntries.map((entry) => (
              <AdministrationCard key={entry.capability.key} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}

      {moduleEntries.length > 0 ? (
        <section aria-labelledby="tenant-modules-heading" className="space-y-5">
          <h2
            id="tenant-modules-heading"
            className="type-subsection-title text-foreground"
          >
            {t("modulesHeading")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {moduleEntries.map((entry) => (
              <AdministrationCard key={entry.capability.key} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}

/**
 * Administrative continuity — a live tenant-health read, deliberately outside the
 * buildout ladder. The badge carries the state (Secure / At risk / No
 * administrator) in the same vocabulary the Access page uses; the action is the
 * one entry point to manage it. No advisory sentence: the state and the action
 * carry it, the detail lives one click away on Access.
 */
function ContinuityCard({
  continuity,
  activeAdministrators,
}: {
  continuity: ContinuityState | null;
  activeAdministrators: number | null;
}) {
  const t = useTranslations("setup.continuity");
  const continuityWord = useTranslations("admins.continuity");
  const countLabel =
    activeAdministrators === null ? null : t("count", { count: activeAdministrators });

  return (
    <article className="flex items-center gap-4 rounded-surface bg-card p-4 shadow-raised sm:p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-muted text-foreground/75 ring-1 ring-inset ring-border">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="type-subsection-title text-foreground">
            {t("title")}
          </h3>
          {continuity ? (
            <StatusBadge tone={CONTINUITY_TONE[continuity]} dot>
              {continuityWord(continuity)}
            </StatusBadge>
          ) : null}
        </div>
        {countLabel ? (
          <p className="type-meta text-muted-foreground">{countLabel}</p>
        ) : null}
      </div>
      <Link
        href={ADMINISTRATORS_PATH}
        className="type-label group/action inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-control text-foreground underline-offset-4 transition-colors hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("manage")}
        <ArrowRight
          className="size-3.5 transition-transform group-hover/action:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </article>
  );
}

/**
 * A tenant-administration or module capability that is not a buildout rung — a
 * quiet card carrying its own state (an action when reachable, "Not available in
 * this build" when planned).
 */
function AdministrationCard({ entry }: { entry: ComposedCapability }) {
  const { capability, state, isActionable } = entry;
  const t = useTranslations("setup");
  const say = useSay("setup");
  const Glyph = CAPABILITY_ICON[capability.key] ?? Info;
  const unavailableText = unavailableLabel(state, entry.blockedBy, t);
  const action = actionLabel(entry, t);

  return (
    <article className="flex items-center gap-4 rounded-surface bg-card p-4 shadow-raised sm:p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-muted text-foreground/75 ring-1 ring-inset ring-border">
        <Glyph className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="type-subsection-title text-foreground">
          {capabilityTitle(capability, say)}
        </h3>
        <p className="type-meta text-pretty text-muted-foreground">
          {capabilityPurpose(capability, t)}
        </p>
      </div>

      {isActionable && capability.route ? (
        <Link
          href={capability.route}
          className="type-label group/action inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-control text-foreground underline-offset-4 transition-colors hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {action}
          <ArrowRight
            className="size-3.5 transition-transform group-hover/action:translate-x-0.5"
            aria-hidden
          />
        </Link>
      ) : unavailableText ? (
        <span className="type-meta shrink-0 text-muted-foreground">
          {unavailableText}
        </span>
      ) : null}
    </article>
  );
}

/**
 * A compact, structural read on how much of the tenant foundation stands up.
 * One segment per foundational area, toned by state — the numeral and the
 * segments carry the progress, not a sentence.
 */
function ReadinessMeter({
  segments,
  recommendationKey,
  readyCount,
}: {
  segments: ComposedCapability[];
  recommendationKey: string | null;
  readyCount: number;
}) {
  const t = useTranslations("setup.meter");
  return (
    <div className="flex shrink-0 flex-col gap-2.5 rounded-surface bg-card px-5 py-4 shadow-raised sm:min-w-[13.5rem]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-eyebrow text-muted-foreground">{t("label")}</span>
        <span className="type-meta text-muted-foreground">
          <span className="type-metric align-baseline text-base text-foreground">
            {readyCount}
          </span>{" "}
          {t("ready", { total: segments.length })}
        </span>
      </div>
      <div className="flex gap-1" aria-hidden>
        {segments.map((segment) => {
          const tone =
            segment.capability.key === recommendationKey
              ? "next"
              : toneForState(segment.state);
          return (
            <span
              key={segment.capability.key}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                SEGMENT_TONE[tone]
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

function RecommendationPanel({ entry }: { entry: ComposedCapability }) {
  const t = useTranslations("setup");
  const isOrganization = entry.capability.key === "organization";
  const Icon = isOrganization ? Building2 : Users;
  const title = isOrganization
    ? entry.state === "in-progress"
      ? t("recommendation.continueOrganization")
      : t("recommendation.setUpOrganization")
    : t("recommendation.addWorkforce");
  const description = isOrganization
    ? t("capabilities.organization.purpose")
    : t("capabilities.workforce.purpose");
  const action = isOrganization
    ? entry.state === "in-progress"
      ? t("action.continueOrganization")
      : t("action.openOrganization")
    : t("action.addWorkforce");

  return (
    <section
      aria-labelledby="recommended-destination-heading"
      className="relative overflow-hidden rounded-surface border border-primary/40 bg-primary/[0.06] p-6 shadow-raised sm:p-7"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-primary-tint text-primary-ink ring-1 ring-inset ring-primary-ring">
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 space-y-2">
            <span className="type-eyebrow flex items-center gap-2 text-primary-ink">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              {t("recommendation.eyebrow")}
            </span>
            <h2
              id="recommended-destination-heading"
              className="type-page-title text-balance"
            >
              {title}
            </h2>
            <p className="type-body max-w-xl text-pretty text-muted-foreground">
              {description}
            </p>
          </div>
        </div>

        <Button asChild size="lg" className="w-full shrink-0 sm:w-auto">
          <Link href={entry.capability.route ?? "#"}>
            {action}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function LadderNode({
  entry,
  isLast,
  onRetry,
}: {
  entry: ComposedCapability;
  isLast: boolean;
  onRetry: () => void;
}) {
  const { capability, state, blockedBy, detail, isActionable } = entry;
  const t = useTranslations("setup");
  const say = useSay("setup");
  // Immediately available items (actionable now, not yet ready) read green like
  // a live affordance; blocked items ("Available after … setup") read primary.
  const tone: NodeTone =
    isActionable && state !== "ready" && capability.route
      ? "available"
      : toneForState(state);
  const CapabilityGlyph = CAPABILITY_ICON[capability.key] ?? Info;
  const Glyph =
    state === "ready" ? Check : state === "blocked" ? Lock : CapabilityGlyph;
  const unavailableText = unavailableLabel(state, blockedBy, t);
  const action = actionLabel(entry, t);
  const isQuiet = state === "planned" || state === "blocked";

  return (
    <article className="group flex gap-4 sm:gap-5">
      {/* Full-height spine: the marker carries state, the connector carries
          sequence. This replaces the old corner glyph with a functional node. */}
      <div className="flex w-11 shrink-0 flex-col items-center">
        <span
          className={cn(
            "relative z-10 flex size-11 items-center justify-center rounded-control transition-colors",
            MARKER_TONE[tone]
          )}
        >
          <Glyph
            className={cn("size-5", state === "ready" && "stroke-[2.5]")}
            aria-hidden
          />
        </span>
        {!isLast ? (
          <span
            aria-hidden
            className={cn(
              "mt-1 w-px flex-1 rounded-full",
              state === "ready" ? "bg-success/35" : "bg-border"
            )}
          />
        ) : null}
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-3 pt-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
          isLast ? "pb-1" : "pb-8"
        )}
      >
        <div className={cn("min-w-0 space-y-1", isQuiet && "opacity-80")}>
          <h3 className="type-subsection-title text-foreground">
            {capabilityTitle(capability, say)}
          </h3>
          <p className="type-meta max-w-md text-pretty text-muted-foreground">
            {capabilityPurpose(capability, t)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
          {detail ? (
            <span
              className={cn(
                "type-meta inline-flex items-center gap-1.5",
                state === "ready" ? "text-success" : "text-muted-foreground"
              )}
            >
              {state === "ready" ? (
                <span
                  className="size-1.5 rounded-full bg-success"
                  aria-hidden
                />
              ) : null}
              {detail}
            </span>
          ) : unavailableText ? (
            <span className="type-meta text-muted-foreground">
              {unavailableText}
            </span>
          ) : null}

          <div className="flex items-center gap-3">
            {state === "unknown" ? (
              <button
                type="button"
                onClick={onRetry}
                className="type-label inline-flex min-h-8 items-center rounded-control text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("retry")}
              </button>
            ) : null}
            {isActionable && capability.route ? (
              <Link
                href={capability.route}
                className="type-label group/action inline-flex min-h-8 items-center gap-1.5 rounded-control text-foreground underline-offset-4 transition-colors hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {action}
                <ArrowRight
                  className="size-3.5 transition-transform group-hover/action:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

type SetupWords = ReturnType<typeof useTranslations<"setup">>;

function capabilityPurpose(capability: ComposedCapability["capability"], t: SetupWords): string {
  const key = `capabilities.${capability.key}.purpose` as "capabilities.organization.purpose";
  return t.has(key) ? t(key) : capability.purpose;
}

function unavailableLabel(
  state: CapabilityState,
  blockedBy: string | null,
  t: SetupWords
): string | null {
  if (state === "planned") return t("unavailable.planned");
  if (state === "blocked" && blockedBy) {
    return t("unavailable.blocked", { name: blockedBy.toLowerCase() });
  }
  if (state === "unknown") return t("unavailable.unknown");
  return null;
}

function actionLabel(entry: ComposedCapability, t: SetupWords): string {
  const { key } = entry.capability;
  if (key === "administrator-access") return t("action.manageAccess");
  if (key === "organization") {
    if (entry.state === "ready") return t("action.reviewOrganization");
    if (entry.state === "in-progress") return t("action.continueOrganization");
    return t("action.openOrganization");
  }
  if (key === "workforce") {
    return entry.state === "ready" ? t("action.manageWorkforce") : t("action.addWorkforce");
  }
  if (key === "workforce-access") return t("action.manageWorkforceAccess");
  return entry.capability.actionLabel ?? t("action.open");
}

export function LaunchpadSkeleton() {
  const t = useTranslations("setup");
  return (
    <PageContainer className="mx-auto max-w-5xl pb-14">
      <div
        className="space-y-9"
        role="status"
        aria-busy="true"
        aria-label={t("loading")}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-5 w-[30rem] max-w-full" />
          </div>
          <Skeleton className="h-[4.75rem] w-full rounded-surface sm:w-[13.5rem]" />
        </div>
        <Skeleton className="h-32 w-full rounded-surface" />
        <div className="space-y-5">
          <Skeleton className="h-5 w-40" />
          <div className="space-y-8">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex gap-5">
                <Skeleton className="size-11 shrink-0 rounded-control" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3.5 w-64 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
