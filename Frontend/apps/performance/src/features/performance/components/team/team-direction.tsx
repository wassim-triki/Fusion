"use client";

import { reportPerformanceFailure } from "@/features/performance/api/performance-failure";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { classifyApiError } from "@repo/api";
import { useAuth } from "@repo/auth";
import type {
  AlignmentTargetDto,
  CycleSummaryDto,
  GoalNodeDto,
  TeamObjectiveWorkspaceItemDto,
} from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Button } from "@repo/ds/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ds/components/ui/select";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import {
  BarChart3,
  CalendarDays,
  ArrowRight,
  ChartColumn,
  ChevronRight,
  CornerLeftUp,
  Eye,
  Flag,
  Info,
  Layers,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  UserRound,
  Users,
  Waypoints,
} from "@/lib/icons";
import { toast } from "sonner";
import {
  useGoal,
  useGoalMutations,
  useTeamObjectiveWorkspace,
} from "../../api/use-performance";
import { useWorkforceMe } from "../../api/use-workforce-me";
import { AlignmentTargetPicker } from "../goals/org-objective-composer";
import {
  OrgComposerHost,
  type ComposerAlignmentContext,
  type ComposerState,
} from "../goals/org-composer-host";
import { initials, STATE_TONE } from "../goals/goals-lib";
import type { UnitContext } from "../goals/working-context-lib";
import { ScopeMark } from "../scope-mark";
import { useObjectiveRecord } from "../objective-record/use-objective-record";
import {
  initialDirectionForTargets,
  visibleTeamObjectives,
  type AlignmentFilter,
  type LifecycleFilter,
  type ObjectiveSort,
} from "./team-objectives-model";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { useSay } from "@repo/ds/lib/say";

export function TeamDirection({
  cycle,
  canViewOrgDirection,
}: {
  cycle: CycleSummaryDto;
  canViewOrgDirection: boolean;
}) {
  const t = useTranslations("team.TeamDirection");
  const { user } = useAuth();
  const me = useWorkforceMe(true);
  const ownUnit: UnitContext | null = useMemo(() => {
    const org = me.data?.employee?.orgUnit;
    if (!org) return null;
    return {
      orgUnitId: org.orgUnitId,
      name: org.name,
      type: org.type,
      path: org.path,
      memberCount: me.data?.orgUnitMemberCount ?? null,
      isOwnUnit: true,
    };
  }, [me.data]);

  const workspace = useTeamObjectiveWorkspace(
    cycle.id,
    ownUnit?.orgUnitId,
    ownUnit !== null
  );
  const targets = useMemo(
    () => workspace.data?.alignmentTargets ?? [],
    [workspace.data]
  );
  const [direction, setDirection] = useState<ComposerAlignmentContext>(null);
  const initializedTeam = useRef<string | null>(null);

  useEffect(() => {
    const data = workspace.data;
    if (!data) return;
    if (initializedTeam.current !== data.orgUnitId) {
      initializedTeam.current = data.orgUnitId;
      setDirection(initialDirectionForTargets(data.alignmentTargets));
      return;
    }
    if (
      direction?.mode === "aligned" &&
      !data.alignmentTargets.some((target) => target.id === direction.parentId)
    )
      setDirection(null);
  }, [workspace.data, direction]);

  const selectedParentId =
    direction?.mode === "aligned" ? direction.parentId : null;
  const selectedDirection = useGoal(cycle.id, selectedParentId);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  // Every objective here — the upstream direction, the team's own — opens in the one objective record,
  // addressed in this Cycle; recording progress is that record's task mode, not a separate drawer.
  const record = useObjectiveRecord();
  const inspect = (objectiveId: string) => record.open({ cycleId: cycle.id, objectiveId });
  const mutations = useGoalMutations(cycle.id);

  if (me.isLoading || workspace.isLoading) return <TeamDirectionSkeleton />;
  if (!ownUnit) return null;
  if (workspace.error || !workspace.data) {
    return (
      <section>
        <h2 className="type-section-title text-foreground">
          {t("upstreamDirection")}
        </h2>
        <p className="mt-2 type-body text-muted-foreground">
          {workspace.error?.message || t("teamObjectivesCouldNotBe")}
        </p>
        {/* A validation or access answer won't change on retry; only transient failures offer one. */}
        {["validation", "auth"].includes(classifyApiError(workspace.error)) ? null : (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void workspace.refetch()}
          >
            {t("tryAgain")}
          </Button>
        )}
      </section>
    );
  }

  const data = workspace.data;
  const openCreate = (alignment: ComposerAlignmentContext) =>
    setComposer({ mode: "create", alignment, orgUnitId: data.orgUnitId });
  const goalsHref = selectedParentId ? `/goals?focus=${selectedParentId}` : "/goals";

  return (
    <>
      <div className="space-y-12">
        <StrategicDirection
          cycle={cycle}
          targets={targets}
          direction={direction}
          onDirectionChange={setDirection}
          selectedNode={selectedDirection.data?.node ?? null}
          selectedDescription={selectedDirection.data?.description ?? null}
          detailLoading={selectedDirection.isLoading}
          canCreate={data.canCreate && data.eligibleOwners.length > 0}
          noEligibleOwners={data.eligibleOwners.length === 0}
          canViewOrgDirection={canViewOrgDirection}
          goalsHref={goalsHref}
          onCreate={() => openCreate(direction)}
          onInspect={inspect}
        />
        <TeamObjectives
          items={data.objectives}
          canCreate={data.canCreate && data.eligibleOwners.length > 0}
          onCreate={() => openCreate(direction)}
          onInspect={inspect}
          onEdit={(item) =>
            setComposer({ mode: "edit", objectiveId: item.node.id })
          }
          onDelete={async (item) => {
            try {
              await mutations.remove.mutateAsync({ objectiveId: item.node.id, expectedVersion: item.node.version });
              toast.success(t("draftObjectiveDeleted"));
            } catch (error) {
              reportPerformanceFailure(error, t("theObjectiveCouldNotBe"));
            }
          }}
          onViewDirection={(item) => item.parent && inspect(item.parent.id)}
          onRecord={(item) => record.open({ cycleId: cycle.id, objectiveId: item.node.id }, { mode: "record" })}
          currentEmployeeId={user?.employeeId ?? null}
        />
      </div>
      {composer ? (
        <OrgComposerHost
          cycle={cycle}
          state={composer}
          ownUnit={ownUnit}
          onClose={() => setComposer(null)}
        />
      ) : null}
    </>
  );
}

function StrategicDirection({
  cycle,
  targets,
  direction,
  onDirectionChange,
  selectedNode,
  selectedDescription,
  detailLoading,
  canCreate,
  noEligibleOwners,
  canViewOrgDirection,
  goalsHref,
  onCreate,
  onInspect,
}: {
  cycle: CycleSummaryDto;
  targets: AlignmentTargetDto[];
  direction: ComposerAlignmentContext;
  onDirectionChange: (direction: ComposerAlignmentContext) => void;
  selectedNode: GoalNodeDto | null;
  selectedDescription: string | null;
  detailLoading: boolean;
  canCreate: boolean;
  noEligibleOwners: boolean;
  canViewOrgDirection: boolean;
  goalsHref: string;
  onCreate: () => void;
  onInspect: (id: string) => void;
}) {
  const t = useTranslations("team.StrategicDirection");
  const aligned = direction?.mode === "aligned";
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectionValue = aligned
    ? direction.parentId
    : direction?.mode === "standalone"
      ? "__standalone__"
      : null;
  return (
    <section aria-labelledby="strategic-direction-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="strategic-direction-heading"
          className="type-section-title text-foreground"
        >
          {t("upstreamDirection")}
        </h2>
        {canViewOrgDirection ? (
          <Button variant="outline" asChild>
            <Link href={goalsHref}>
              {t("openOrganizationDirection")}
              <ArrowRight className="size-4" data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="relative mt-4 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <CardLink />
        {detailLoading && aligned ? (
          <DirectionCardSkeleton />
        ) : aligned && selectedNode ? (
          <DirectionCard
            node={selectedNode}
            description={selectedDescription}
            onInspect={onInspect}
          />
        ) : direction?.mode === "standalone" ? (
          <StandaloneCard
            targetCount={targets.length}
            onChoose={() => setPickerOpen(true)}
          />
        ) : (
          <EmptyDirectionCard
            targetCount={targets.length}
            onChoose={() => setPickerOpen(true)}
            onStandalone={() => onDirectionChange({ mode: "standalone" })}
          />
        )}
        <div className="flex flex-col rounded-surface border border-primary/45 bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-control border border-primary-ring bg-primary-tint text-primary-ink">
              <Target className="size-4" aria-hidden />
            </span>
            <p className="type-meta text-primary-ink">{t("nextTeamObjective")}</p>
          </div>
          <div className="mt-2.5">
            <h3 className="type-section-title tracking-tight text-foreground">
              {t("createATeamObjective")}
            </h3>
            <p className="mt-1 max-w-xl type-body leading-5 text-muted-foreground">
              {t("chooseWhatItSupportsBefore")}
            </p>
          </div>
          <div className="mt-3 space-y-1.5">
            <label className="type-label text-foreground">{t("alignTo")}</label>
            <AlignmentTargetPicker
              targets={targets}
              value={selectionValue}
              onChange={(parentId) =>
                onDirectionChange({ mode: "aligned", parentId })
              }
              includeStandalone
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onStandalone={() => onDirectionChange({ mode: "standalone" })}
            />
          </div>
          <div className="mt-auto pt-3">
            <Button onClick={onCreate} disabled={!direction || !canCreate}>
              <Plus className="size-4" data-icon="inline-start" aria-hidden />
              {t("createTeamObjective")}
            </Button>
            {noEligibleOwners ? (
              <p className="mt-2 type-meta text-destructive">
                {t("noActiveTeamMemberCan")}
              </p>
            ) : cycle.state === "Closed" ? (
              <p className="mt-2 type-meta text-muted-foreground">
                {t("thisCycleIsClosed")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function DirectionFact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-inlay text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="type-meta text-muted-foreground">{label}</p>
        <p className="truncate type-subsection-title text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

function DirectionCard({
  node,
  description,
  onInspect,
}: {
  node: GoalNodeDto;
  description: string | null;
  onInspect: (id: string) => void;
}) {
  const t = useTranslations("team.DirectionCard");
  const lib = useSay("goals.lib");
  const progress = Math.max(
    0,
    Math.min(100, Math.round(node.hasProgress ? node.derivedProgress : 0))
  );
  const kind =
    node.ownershipScope === "Company"
      ? t("companyObjective")
      : t("objective", { value: node.orgUnitName ?? "Team" });
  return (
    <div className="flex flex-col rounded-surface bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-control border border-primary-ring bg-primary-tint text-primary-ink">
            <Target className="size-4" aria-hidden />
          </span>
          <p className="type-meta text-primary-ink">{t("selectedDirection")}</p>
        </div>
        <StatusBadge tone={STATE_TONE[node.state]} dot>
          {lib(`state.${node.state}`)}
        </StatusBadge>
      </div>

      <button
        type="button"
        onClick={() => onInspect(node.id)}
        className="mt-3 rounded-detail text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h3 className="type-section-title leading-snug tracking-tight text-foreground hover:underline">
          {node.title}
        </h3>
      </button>
      {description ? (
        <p className="mt-1 line-clamp-2 max-w-2xl type-body leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3 sm:divide-x sm:divide-border [&>*]:sm:ps-4 [&>*:first-child]:sm:ps-0">
        <DirectionFact
          icon={<UserRound aria-hidden />}
          label={t("accountableOwner")}
          value={node.accountablePersonName ?? "No owner"}
        />
        <DirectionFact
          icon={<ChartColumn aria-hidden />}
          label={t("measurement")}
          value={node.measurementSummary}
        />
        <DirectionFact
          icon={<Flag aria-hidden />}
          label={t("objectiveType")}
          value={kind}
        />
      </div>

      <div className="mt-4 flex items-end gap-5 border-t border-border/60 pt-3">
        <div className="min-w-0 flex-1">
          <p className="type-meta text-muted-foreground">
            {t("progressTowardTarget")}
          </p>
          <div className="relative mt-2 h-1.5 rounded-full bg-muted">
            <span
              className="absolute inset-y-0 inset-s-0 rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
            <span
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
              style={{ left: `${progress}%` }}
              aria-hidden
            />
          </div>
        </div>
        <p className="shrink-0 type-meta text-muted-foreground">
          <span className="type-subsection-title tabular-nums text-foreground">
            {progress}%
          </span>{t("ofTarget")}
        </p>
      </div>
    </div>
  );
}

/** Footer row that opens the Align to picker; shared by the aligned and standalone states. */
function EligibleRow({
  count,
  hint,
  onClick,
}: {
  count: number;
  hint: string;
  onClick: () => void;
}) {
  const t = useTranslations("team.EligibleRow");
  return (
    <button
      type="button"
      onClick={onClick}
      className="group mt-3 flex items-center gap-3 border-t border-border/60 pt-3 text-start focus-visible:outline-none"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-border bg-inlay text-muted-foreground">
        <Layers className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate type-subsection-title text-foreground">
        {t("eligibleObjective", { count })}{count === 1 ? "" : t("s")}{" "}
        <span className="font-normal text-muted-foreground">· {hint}</span>
      </span>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <ChevronRight className="size-4" aria-hidden />
      </span>
    </button>
  );
}

function StandaloneCard({
  targetCount,
  onChoose,
}: {
  targetCount: number;
  onChoose: () => void;
}) {
  const t = useTranslations("team.StandaloneCard");
  return (
    <div className="flex flex-col rounded-surface bg-card p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-info/35 bg-info/10 text-info">
          <Waypoints className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="type-section-title tracking-tight text-foreground">
            {t("noUpstreamObjectiveSelected")}
          </h3>
          <p className="mt-1 max-w-md type-body leading-5 text-muted-foreground">
            {t("theNextTeamObjectiveWill")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-surface border border-border bg-inlay px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0">
          <p className="type-subsection-title text-foreground">
            {t("standaloneObjectivesStayInMy")}
          </p>
          <p className="type-meta text-muted-foreground">
            {t("theyAppearInOrganizationGoals")}
          </p>
        </div>
      </div>
      {targetCount > 0 ? (
        <div className="mt-auto">
          <EligibleRow
            count={targetCount}
            hint={t("chooseOne")}
            onClick={onChoose}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Glowing node joining the direction card to the next-objective card, centred on the gap between
 * the two fixed columns (1.25fr / 1fr with a 1rem gap → boundary at 5/9 of the free width).
 */
function CardLink() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 z-10 hidden size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-background shadow-[0_0_8px_-4px_var(--primary)] lg:flex"
      style={{ left: "calc((100% - 1rem) * 5 / 9 + 0.5rem)" }}
    >
      <span className="size-3 rounded-full bg-primary shadow-[0_0_4px_-1px_var(--primary)]" />
    </span>
  );
}

function DirectionChip({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2.5 whitespace-nowrap rounded-control border border-border bg-inlay px-4 type-label text-foreground transition-colors hover:border-primary/45 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:text-primary"
    >
      {icon}
      {children}
    </button>
  );
}

/** Nothing chosen yet: eligible objectives flowing into the team's next objective. */
function EmptyDirectionCard({
  targetCount,
  onChoose,
  onStandalone,
}: {
  targetCount: number;
  onChoose: () => void;
  onStandalone: () => void;
}) {
  const t = useTranslations("team.EmptyDirectionCard");
  const hasTargets = targetCount > 0;
  return (
    <div className="relative isolate flex flex-col overflow-hidden rounded-surface bg-card p-4 sm:p-5">
      {/* The illustration is part of the card's background: anchored right, faded out toward the text by
          a left-to-right scrim, so the text runs full width over it and stays clear. */}
      <DirectionIllustration />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-linear-to-r from-card from-45% to-transparent xl:block"
      />
      <div className="relative flex flex-1 flex-col">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="type-section-title text-foreground">
            {hasTargets
              ? t("noDirectionSelected")
              : t("noPublishedDirectionYet")}
          </h3>
          <p className="mt-3 max-w-xs type-body leading-6 text-muted-foreground">
            {hasTargets
              ? t("chooseOneOfTheEligible")
              : t("nothingAboveYourTeamIs")}
          </p>
          {/* The chips settle at the bottom edge as the card's height allows. */}
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            {hasTargets ? (
              <DirectionChip icon={<Target aria-hidden />} onClick={onChoose}>
                {t("eligibleObjective", { targetCount })}{targetCount === 1 ? "" : t("s")}
              </DirectionChip>
            ) : null}
            <DirectionChip
              icon={<Waypoints className="!text-info" aria-hidden />}
              onClick={onStandalone}
            >
              {t("standaloneAllowed")}
            </DirectionChip>
          </div>
        </div>
      </div>
    </div>
  );
}

function IllustrationNode({
  y,
  dashed = false,
}: {
  y: number;
  dashed?: boolean;
}) {
  return (
    <g>
      <rect
        x="1"
        y={y}
        width="112"
        height="42"
        rx="9"
        className={cn(
          "stroke-border",
          dashed ? "fill-transparent" : "fill-muted/40"
        )}
        strokeDasharray={dashed ? "4 4" : undefined}
      />
      <circle
        cx="22"
        cy={y + 21}
        r="8"
        className="fill-none stroke-muted-foreground/50"
        strokeWidth="1.5"
        strokeDasharray={dashed ? "3 3" : undefined}
      />
      <rect
        x="40"
        y={y + 12}
        width="54"
        height="6"
        rx="3"
        className="fill-muted-foreground/30"
      />
      <rect
        x="40"
        y={y + 24}
        width="36"
        height="5"
        rx="2.5"
        className="fill-muted-foreground/20"
      />
    </g>
  );
}

function DirectionIllustration() {
  return (
    <div
      className="pointer-events-none absolute inset-e-5 top-1/2 hidden w-96 -translate-y-1/2 xl:block"
      aria-hidden
    >
      <svg viewBox="0 0 256 170" className="h-auto w-full overflow-visible">
        <IllustrationNode y={4} />
        <IllustrationNode y={64} />
        <IllustrationNode y={124} dashed />
        <path
          d="M 118 25 C 150 25, 150 80, 172 85"
          className="fill-none stroke-primary"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
        <path
          d="M 118 85 C 145 85, 150 85, 172 85"
          className="fill-none stroke-primary"
          strokeWidth="1.5"
        />
        <path
          d="M 118 145 C 150 145, 150 90, 172 85"
          className="fill-none stroke-muted-foreground/40"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
        <circle cx="118" cy="25" r="3" className="fill-primary" />
        <circle cx="118" cy="85" r="3" className="fill-primary" />
      </svg>
      {/* Positioned in the SVG's own units (viewBox 256 wide) so it scales with the drawing: its left
          edge sits exactly where the three links converge (x = 172). */}
      <div
        className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-control border border-primary/60 bg-primary/[0.06] px-2 py-2.5 shadow-[0_0_22px_-6px_var(--primary)]"
        style={{ left: `${(172 / 256) * 100}%`, width: `${(76 / 256) * 100}%` }}
      >
        <span className="flex size-7 items-center justify-center rounded-control-sm bg-primary-tint text-primary-ink">
          <Users className="size-4" />
        </span>
        <span className="h-1.5 w-9 rounded-full bg-muted-foreground/30" />
        <span className="h-1 w-6 rounded-full bg-muted-foreground/20" />
      </div>
    </div>
  );
}

/** Above this many objectives the state / alignment / sort controls earn their place. */
const FILTER_THRESHOLD = 5;

function TeamObjectives({
  items,
  canCreate,
  onCreate,
  onInspect,
  onEdit,
  onDelete,
  onViewDirection,
  onRecord,
  currentEmployeeId,
}: {
  items: TeamObjectiveWorkspaceItemDto[];
  canCreate: boolean;
  onCreate: () => void;
  onInspect: (id: string) => void;
  onEdit: (item: TeamObjectiveWorkspaceItemDto) => void;
  onDelete: (item: TeamObjectiveWorkspaceItemDto) => void | Promise<void>;
  onViewDirection: (item: TeamObjectiveWorkspaceItemDto) => void;
  onRecord: (item: TeamObjectiveWorkspaceItemDto) => void;
  currentEmployeeId: string | null;
}) {
  const t = useTranslations("team.TeamObjectives");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("all");
  const [alignment, setAlignment] = useState<AlignmentFilter>("all");
  const [sort, setSort] = useState<ObjectiveSort>("default");
  const visible = useMemo(
    () => visibleTeamObjectives(items, lifecycle, alignment, sort),
    [items, lifecycle, alignment, sort]
  );
  return (
    <section aria-labelledby="team-objectives-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2
          id="team-objectives-heading"
          className="flex items-baseline gap-2 type-section-title text-foreground"
        >
          {t("teamObjectives")}
          <span className="type-meta tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </h2>
        {items.length > FILTER_THRESHOLD ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={lifecycle}
              onValueChange={(value) => setLifecycle(value as LifecycleFilter)}
            >
              <SelectTrigger aria-label={t("filterByLifecycle")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStates")}</SelectItem>
                <SelectItem value="Draft">{t("draft")}</SelectItem>
                <SelectItem value="Published">{t("published")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={alignment}
              onValueChange={(value) => setAlignment(value as AlignmentFilter)}
            >
              <SelectTrigger aria-label={t("filterByAlignment")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allAlignment")}</SelectItem>
                <SelectItem value="aligned">{t("aligned")}</SelectItem>
                <SelectItem value="standalone">{t("standalone")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as ObjectiveSort)}
            >
              <SelectTrigger aria-label={t("sortObjectives")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("priorityOrder")}</SelectItem>
                <SelectItem value="due">{t("dueDate")}</SelectItem>
                <SelectItem value="recent">{t("recentlyEdited")}</SelectItem>
                <SelectItem value="title">{t("title")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {items.length === 0 ? (
        <TeamObjectivesEmpty canCreate={canCreate} onCreate={onCreate} />
      ) : visible.length === 0 ? (
        <div className="mt-4 rounded-surface border border-dashed border-border px-6 py-8 text-center">
          <p className="type-label text-foreground">
            {t("noObjectivesMatchTheseFilters")}
          </p>
          <Button
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setLifecycle("all");
              setAlignment("all");
            }}
          >
            {t("clearFilters")}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {visible.map((item) => (
            <TeamObjectiveRow
              key={item.node.id}
              item={item}
              currentEmployeeId={currentEmployeeId}
              onInspect={onInspect}
              onEdit={onEdit}
              onDelete={onDelete}
              onViewDirection={onViewDirection}
              onRecord={onRecord}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** First-objective invitation: an orbiting target emblem and the one CTA, on a dashed placeholder. */
function TeamObjectivesEmpty({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  const t = useTranslations("team.TeamObjectivesEmpty");
  return (
    <div className="relative mt-4 overflow-hidden rounded-surface border border-dashed border-border px-6 pb-10 pt-10 text-center">
      {/* Horizon glow behind the emblem. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[88px] h-[420px] w-[720px] -translate-x-1/2 rounded-full border-t border-primary/25 bg-[radial-gradient(ellipse_at_top,var(--primary)_0%,transparent_45%)] opacity-[0.14]"
      />
      <EmptyOrbit />
      <div className="relative mx-auto flex size-[72px] items-center justify-center rounded-full border border-primary/40 bg-primary/10 shadow-[0_0_32px_-8px_var(--primary)]">
        <Target
          className="size-9 text-primary-ink"
          strokeWidth={1.75}
          aria-hidden
        />
        <Flag
          className="absolute -inset-e-2 -top-3 size-6 rotate-12 fill-primary/80 text-primary-ink"
          aria-hidden
        />
      </div>
      <h3 className="relative mt-6 type-section-title text-foreground">
        {t("noTeamObjectivesYet")}
      </h3>
      <p className="relative mx-auto mt-2 max-w-md type-body text-muted-foreground">
        {t("createAnObjectiveToDefine")}
      </p>
      <Button
        onClick={onCreate}
        disabled={!canCreate}
        className="relative mt-6 h-10 px-5 shadow-[0_0_24px_-8px_var(--primary)]"
      >
        {t("createYourTeamObjective")}
        <ArrowRight className="size-4" data-icon="inline-end" aria-hidden />
      </Button>
    </div>
  );
}

/** Dashed orbits and drifting dots framing the emblem. */
function EmptyOrbit() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 120"
      className="pointer-events-none absolute left-1/2 top-3 w-[420px] max-w-[90%] -translate-x-1/2 overflow-visible"
    >
      <path
        d="M 40 118 C 90 10, 310 10, 360 118"
        className="fill-none stroke-muted-foreground/25"
        strokeDasharray="3 5"
      />
      <path
        d="M 80 118 C 120 40, 280 40, 320 118"
        className="fill-none stroke-muted-foreground/20"
        strokeDasharray="3 5"
      />
      <circle cx="120" cy="36" r="3.5" className="fill-primary" />
      <circle cx="292" cy="38" r="3" className="fill-muted-foreground/50" />
      <circle cx="74" cy="72" r="2.5" className="fill-muted-foreground/40" />
      <circle cx="318" cy="66" r="2.5" className="fill-primary/70" />
    </svg>
  );
}

function TeamObjectiveRow({
  item,
  currentEmployeeId,
  onInspect,
  onEdit,
  onDelete,
  onViewDirection,
  onRecord,
}: {
  item: TeamObjectiveWorkspaceItemDto;
  currentEmployeeId: string | null;
  onInspect: (id: string) => void;
  onEdit: (item: TeamObjectiveWorkspaceItemDto) => void;
  onDelete: (item: TeamObjectiveWorkspaceItemDto) => void | Promise<void>;
  onViewDirection: (item: TeamObjectiveWorkspaceItemDto) => void;
  onRecord: (item: TeamObjectiveWorkspaceItemDto) => void;
}) {
  const format = useFormat();
  const t = useTranslations("team.TeamObjectiveRow");
  const lib = useSay("goals.lib");
  const { node } = item;
  const isDraft = node.state === "Draft";
  const aligned = Boolean(item.parent);
  const canRecord =
    !isDraft &&
    node.progressSource === "Direct" &&
    node.accountablePersonId === currentEmployeeId;
  const progress = Math.round(node.hasProgress ? node.derivedProgress : 0);
  return (
    <article className="rounded-surface bg-card px-4 py-4 sm:px-5">
      <div className="flex gap-4">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-control ring-1",
            aligned
              ? "bg-primary-tint text-primary-ink ring-primary-ring"
              : "bg-info/10 text-info ring-info/20"
          )}
        >
          {aligned ? (
            <ScopeMark className="size-6" />
          ) : (
            <Waypoints className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/* Full-width title line: the title truncates, the badge never wraps under it. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => onInspect(node.id)}
              className="min-w-0 truncate text-start type-panel-title text-foreground hover:underline"
            >
              {node.title}
            </button>
            <StatusBadge className="shrink-0" tone={STATE_TONE[node.state]} dot>
              {lib(`state.${node.state}`)}
            </StatusBadge>
          </div>
          {/* Middle band: what it sets out to do beside its facts; title and alignment span above and below. */}
          <div className="mt-1.5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              {item.description ? (
                <p className="line-clamp-2 max-w-xl type-body text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
            </div>
            {/* Facts, divided: who answers for it, how it is read, how far it is, when it is due. */}
            <div className="flex flex-wrap items-center gap-y-4 lg:flex-nowrap lg:border-s lg:border-border lg:ps-2">
              <RowFact label={t("accountableOwner")}>
                <span className="inline-flex items-center gap-2.5">
                  <OwnerAvatar
                    id={node.accountablePersonId}
                    name={node.accountablePersonName}
                  />
                  <span className="max-w-32 truncate">
                    {node.accountablePersonName ?? t("noOwner")}
                  </span>
                </span>
              </RowFact>
              <RowFact label={t("measurement")}>
                <span className="inline-flex items-center gap-2">
                  <BarChart3
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  {node.measurementSummary || t("notSet")}
                </span>
              </RowFact>
              <RowFact label={t("progress")}>
                <span className="flex items-center gap-2.5">
                  <span className="tabular-nums">{progress}%</span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        progress >= 100
                          ? "bg-success"
                          : aligned
                            ? "bg-primary"
                            : "bg-info"
                      )}
                      style={{
                        width: `${Math.max(0, Math.min(100, progress))}%`,
                      }}
                    />
                  </span>
                </span>
              </RowFact>
              <RowFact label={t("dueDate")}>
                <span className="inline-flex items-center gap-2">
                  <CalendarDays
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  {format.date(node.endDate)}
                </span>
              </RowFact>
              <div className="flex items-center ps-4 lg:border-s lg:border-border">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("actionsFor", { title: node.title })}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onInspect(node.id)}>
                      <Eye className="size-3.5" data-icon="inline-start" /> {t("viewDetails")}
                    </DropdownMenuItem>
                    {canRecord ? (
                      <DropdownMenuItem onSelect={() => onRecord(item)}>
                        <TrendingUp
                          className="size-3.5"
                          data-icon="inline-start"
                        />{t("updateProgress")}
                      </DropdownMenuItem>
                    ) : null}
                    {isDraft ? (
                      <>
                        <DropdownMenuItem onSelect={() => onEdit(item)}>
                          <Pencil
                            className="size-3.5"
                            data-icon="inline-start"
                          />{t("editObjective")}
                        </DropdownMenuItem>
                        {node.childCount === 0 ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void onDelete(item)}
                            >
                              <Trash2
                                className="size-3.5"
                                data-icon="inline-start"
                              />{t("deleteDraft")}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </>
                    ) : item.parent ? (
                      <DropdownMenuItem onSelect={() => onViewDirection(item)}>
                        <CornerLeftUp
                          className="size-3.5"
                          data-icon="inline-start"
                        />{t("viewDirection")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-2 type-body">
            {item.parent ? (
              <>
                <Link2 className="size-4 shrink-0 text-primary-ink" aria-hidden />
                <span className="shrink-0 text-muted-foreground">
                  {t("alignedTo")}
                </span>
                <button
                  type="button"
                  className="min-w-0 truncate text-start font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onViewDirection(item)}
                >
                  {item.parent.title}
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-2 font-medium text-info">
                <Waypoints className="size-4 shrink-0" aria-hidden />
                {t("standaloneTeamObjective")}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** One divided fact column: a quiet sentence-case label over its value. */
function RowFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-4 lg:border-s lg:border-border lg:first:border-s-0">
      <p className="type-meta text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex min-h-8 min-w-0 items-center type-label text-foreground">
        {children}
      </div>
    </div>
  );
}

/** The accountable owner's avatar, in the Fusion amber accent. */
function OwnerAvatar({ name }: { id: string; name: string | null }) {
  return (
    <Avatar className="size-8 bg-primary-tint text-primary-ink ring-2 ring-primary-ring ring-offset-2 ring-offset-card">
      <AvatarFallback className="bg-transparent type-meta-strong text-inherit">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Mirrors DirectionCard: eyebrow + badge, title, description, three facts, progress row. */
function DirectionCardSkeleton() {
  return (
    <div className="flex flex-col rounded-surface bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-control" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-6 w-4/5" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-3.5 w-full max-w-md" />
        <Skeleton className="h-3.5 w-3/5 max-w-sm" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-end gap-5 border-t border-border/60 pt-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

/** Mirrors the Next team objective card: eyebrow, title, description, Align to picker, CTA. */
function NextObjectiveCardSkeleton() {
  return (
    <div className="flex flex-col rounded-surface bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8 rounded-control" />
        <Skeleton className="h-3 w-36" />
      </div>
      <Skeleton className="mt-3 h-6 w-3/5" />
      <Skeleton className="mt-2 h-3.5 w-4/5" />
      <div className="mt-4 space-y-1.5">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-11 w-full rounded-control" />
      </div>
      <div className="mt-auto pt-4">
        <Skeleton className="h-9 w-48" />
      </div>
    </div>
  );
}

/** Mirrors TeamObjectiveRow's five columns. */
function ObjectiveRowSkeleton() {
  return (
    <div className="rounded-surface bg-card px-4 py-4 sm:px-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2.6fr)_minmax(7.5rem,.7fr)_minmax(7.5rem,.7fr)_minmax(6.5rem,.55fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          </div>
        </div>
        {["w-24", "w-28", "w-20"].map((w, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className={`h-4 ${w}`} />
          </div>
        ))}
        <Skeleton className="size-8 justify-self-end rounded-control" />
      </div>
    </div>
  );
}

export function TeamDirectionSkeleton() {
  return (
    <div aria-hidden className="space-y-12">
      <section>
        <div className="flex justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-9 w-52" />
        </div>
        <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <DirectionCardSkeleton />
          <NextObjectiveCardSkeleton />
        </div>
      </section>
      <section>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-4" />
        </div>
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 3 }, (_, i) => (
            <ObjectiveRowSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
