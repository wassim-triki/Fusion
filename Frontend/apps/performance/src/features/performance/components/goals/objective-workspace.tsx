"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  Eye,
  Gauge,
  Layers,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Send,
  Target,
  Trash2,
  UsersRound,
  type Icon as LucideIcon,
} from "@/lib/icons";
import type { GoalNodeDto, GoalsOverviewDto } from "@repo/api";
import { ScopeMark } from "../scope-mark";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { FilterChips } from "@repo/ds/choice";
import { Button } from "@repo/ds/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
import { StatusBadge } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { useGoal } from "../../api/use-performance";
import {
  buildGoalGraph,
  initials,
  pathTo,
  STATE_TONE,
} from "./goals-lib";
import {
  resolveWorkspace,
  rootOrgLabel,
  type ObjectiveBlock,
  type UnitContext,
} from "./working-context-lib";
import { useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import type { Say } from "@/i18n/say";

/**
 * The single Organization Goals workspace. One grammar serves every actor: a broad/administration
 * actor lands organization-wide on the company strategic roots; a workforce leader lands on the unit
 * they belong to. Both drill the same objective hierarchy through progressive disclosure — the
 * company direction is the dominant anchor, its direct organizational objectives read as dense rows
 * beneath it, and any branch expands in place rather than exploding the whole graph.
 *
 * Two invariants survive every context: the prominent upstream direction is always the objective's
 * real **direct parent** (company strategic OR another organizational objective), with higher strategy
 * kept as quiet lineage; and nothing is fabricated — no health, no invented progress, no org-chart
 * placeholders for units that own no objective. During execution, each objective carries its own
 * canonical progress result; alignment alone never becomes mathematical contribution.
 */
export function ObjectiveWorkspace({
  cycleId,
  overview,
  focusId,
  revealId,
  ownUnit,
  broad,
  canAuthor,
  canManageCompany,
  canReachSetup,
  onFocus,
  onInspect,
  onCreate,
  onResumeDraft,
  onDelete,
  onCreateCompany,
  onEditCompany,
  onPublishCompany,
}: {
  cycleId: string;
  overview: GoalsOverviewDto;
  /** The drilled-into objective, or null for the actor's default context. */
  focusId: string | null;
  /** An objective whose branch should be expanded (e.g. the parent of a just-created child). */
  revealId: string | null;
  /** The actor's own organizational placement, or null (administration / no placement). */
  ownUnit: UnitContext | null;
  /** Whether the default context is organization-wide (authority, not placement). */
  broad: boolean;
  /** May author organizational objectives (create / edit / align / remove). */
  canAuthor: boolean;
  /** May create, edit and publish company strategic direction. */
  canManageCompany: boolean;
  canReachSetup: boolean;
  onFocus: (objectiveId: string | null) => void;
  onInspect: (objectiveId: string) => void;
  /** Contextual create under a resolved parent, in the given organizational scope (null = pick in composer). */
  onCreate: (parentObjectiveId: string, orgUnitId: string | null) => void;
  onResumeDraft: (objectiveId: string) => void;
  onDelete: (objectiveId: string) => void;
  onCreateCompany: () => void;
  onEditCompany: (objectiveId: string) => void;
  onPublishCompany: (objectiveId: string) => void;
}) {
  const t = useTranslations("goals.ObjectiveWorkspace");
  const lib = useSay("goals.lib");
  const composition = useMemo(
    () => resolveWorkspace(overview.nodes, { focusId, ownUnit, broad }),
    [overview.nodes, focusId, ownUnit, broad]
  );
  const graph = useMemo(() => buildGoalGraph(overview.nodes), [overview.nodes]);
  const orgName = rootOrgLabel(ownUnit?.path);

  // Every branch is expanded by default so the whole established cascade is visible on load; a branch
  // stays open unless the user explicitly collapses it, and that hand-collapse survives re-renders.
  // Membership in this set means "collapsed"; absence means "open".
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Reveal a branch after a mutation — re-open the created objective's parent and every ancestor so the
  // new objective is visible in place, without leaving the current context.
  useEffect(() => {
    if (!revealId) return;
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      next.delete(revealId);
      for (const ancestor of pathTo(graph, revealId)) next.delete(ancestor.id);
      return next;
    });
  }, [revealId, graph]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tree: TreeControls = {
    cycleId,
    collapsed,
    childrenByParent: graph.childrenByParent,
    canAuthor,
    onToggle: toggle,
    onInspect,
    onResumeDraft,
    onDelete,
    onCreate,
  };
  const actions: SubjectActions = {
    cycleId,
    canAuthor,
    canManageCompany,
    onInspect,
    onResumeDraft,
    onDelete,
    onEditCompany,
    onPublishCompany,
  };

  if (composition.kind === "organization") {
    if (composition.blocks.length === 0) {
      return (
        <NoPublishedDirection
          canCreateCompany={canManageCompany}
          canReachSetup={canReachSetup}
          onCreateCompany={onCreateCompany}
        />
      );
    }
    return (
      <div className="space-y-10">
        {composition.blocks.map((block) => (
          <ObjectiveBlockView
            key={block.node.id}
            block={block}
            emphasis="company"
            orgName={orgName}
            tree={tree}
            actions={actions}
          />
        ))}
      </div>
    );
  }

  if (composition.kind === "focused") {
    return (
      <div className="space-y-6">
        <FocusTrail block={composition.block} onFocus={onFocus} />
        <ObjectiveBlockView
          block={composition.block}
          emphasis={
            composition.block.ancestors.length === 0 ? "company" : "focused"
          }
          orgName={orgName}
          tree={tree}
          actions={actions}
        />
      </div>
    );
  }

  // Own-unit context (established or empty).
  return (
    <div className="space-y-8">
      <ContextHeader
        eyebrow={
          composition.unit.isOwnUnit
            ? belongingLabel(composition.unit.type, lib)
            : t("workingScope")
        }
        title={composition.unit.name}
        memberCount={
          composition.unit.isOwnUnit
            ? composition.unit.memberCount ?? null
            : null
        }
      />
      {composition.kind === "unit" ? (
        <div className="space-y-10">
          {composition.blocks.map((block) => (
            <ObjectiveBlockView
              key={block.node.id}
              block={block}
              emphasis={composition.unit.isOwnUnit ? "own" : "focused"}
              orgName={orgName}
              tree={tree}
              actions={actions}
            />
          ))}
        </div>
      ) : !composition.hasPublishedDirection ? (
        <NoPublishedDirection
          canCreateCompany={canManageCompany}
          canReachSetup={canReachSetup}
          onCreateCompany={onCreateCompany}
        />
      ) : (
        <EmptyUnitContext
          unit={composition.unit}
          candidates={composition.candidates}
          orgName={orgName}
          canAuthor={canAuthor}
          onInspect={onInspect}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}

// ── The repeating block: upstream direction → subject → aligned cascade ─────────────

type SubjectEmphasis = "company" | "own" | "focused";

interface TreeControls {
  cycleId: string;
  collapsed: Set<string>;
  childrenByParent: Map<string, GoalNodeDto[]>;
  canAuthor: boolean;
  onToggle: (id: string) => void;
  onInspect: (id: string) => void;
  onResumeDraft: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (parentId: string, orgUnitId: string | null) => void;
}

interface SubjectActions {
  cycleId: string;
  canAuthor: boolean;
  canManageCompany: boolean;
  onInspect: (id: string) => void;
  onResumeDraft: (id: string) => void;
  onDelete: (id: string) => void;
  onEditCompany: (id: string) => void;
  onPublishCompany: (id: string) => void;
}

/**
 * One direction slice: the direct parent (a compact "Aligned to" strip, quiet), the subject objective
 * (the page's anchor, an elevated card), and its aligned objectives as a progressively-disclosed
 * cascade of dense rows. Higher ancestors above the direct parent stay as quiet lineage chips.
 */
function ObjectiveBlockView({
  block,
  emphasis,
  orgName,
  tree,
  actions,
}: {
  block: ObjectiveBlock;
  emphasis: SubjectEmphasis;
  orgName: string | null;
  tree: TreeControls;
  actions: SubjectActions;
}) {
  const t = useTranslations("goals.ObjectiveBlockView");
  const directParent = block.ancestors.at(-1) ?? null;
  const higherAncestors = block.ancestors.slice(0, -1);
  const children = tree.childrenByParent.get(block.node.id) ?? [];
  const open = !tree.collapsed.has(block.node.id);
  const isCompany = emphasis === "company";

  return (
    <section>
      {directParent ? (
        <>
          {higherAncestors.length > 0 ? (
            <LineageChips ancestors={higherAncestors} />
          ) : null}
          <DirectionStrip
            node={directParent}
            orgName={orgName}
            onInspect={tree.onInspect}
          />
          <AlignmentConnector state={block.node.state} />
        </>
      ) : null}

      <SubjectCard
        node={block.node}
        emphasis={emphasis}
        orgName={orgName}
        actions={actions}
      />

      <div className="mt-5">
        <GroupHeader
          label={isCompany ? t("organizationalAlignment") : t("alignedObjectives")}
          description={
            isCompany
              ? t("theseOrganizationalObjectivesSupportThe")
              : undefined
          }
          count={children.length}
          open={open}
          onToggle={() => tree.onToggle(block.node.id)}
          prominent={isCompany}
        />
        {open ? (
          children.length === 0 ? (
            <div className="mt-3">
              <EmptyChildren isCompany={isCompany} />
              {tree.canAuthor && block.node.state === "Published" ? (
                <div className="mt-2">
                  <AddAligned
                    onClick={() => tree.onCreate(block.node.id, null)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <AlignmentGroup
              parent={block.node}
              siblings={children}
              tree={tree}
              depth={0}
            />
          )
        ) : null}
      </div>
    </section>
  );
}

// ── The subject card (company root, own objective, or focused objective) ────────────

/**
 * The objective that anchors the current view. Company direction and the actor's own objective get
 * the strongest treatment; a drilled objective the actor does not own is marked "current" neutrally,
 * never fabricating a personal scope. Definition only — status, accountable person, and the
 * measurement expectation and, once execution begins, its canonical progress. Progress colour is
 * deliberately non-judgmental: this surface has no inferred on-track / off-track health model.
 */
function SubjectCard({
  node,
  emphasis,
  orgName,
  actions,
}: {
  node: GoalNodeDto;
  emphasis: SubjectEmphasis;
  orgName: string | null;
  actions: SubjectActions;
}) {
  const t = useTranslations("goals.SubjectCard");
  const lib = useSay("goals.lib");
  const detail = useGoal(actions.cycleId, node.id);
  const description = detail.data?.description?.trim() || null;
  const isCompany = emphasis === "company";
  const own = emphasis === "own";

  const eyebrow = isCompany
    ? companyEyebrow(orgName, lib)
    : own
      ? t("objective", { value: node.orgUnitName ?? "Your unit" })
      : node.ownershipScope === "Company"
        ? companyEyebrow(orgName, lib)
        : t("objective", { value: node.orgUnitName ?? "Organizational" });

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-surface border bg-card p-5 shadow-raised sm:p-6",
        own
          ? "border-primary/45 ring-1 ring-primary/20"
          : "border-foreground/20 ring-1 ring-foreground/[0.06]"
      )}
    >
      <div className="flex items-start gap-4 sm:gap-5">
        <span
          aria-hidden
          className={cn(
            "hidden size-12 shrink-0 items-center justify-center rounded-control border sm:flex",
            own || isCompany
              ? "border-primary-ring bg-primary-tint text-primary-ink"
              : "border-border bg-inlay text-foreground/70"
          )}
        >
          <ScopeMark className="size-7" muted={!(own || isCompany)} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p
              className={cn(
                "type-meta",
                own ? "text-primary-ink" : "text-muted-foreground"
              )}
            >
              {eyebrow}
            </p>
            <StatusBadge tone={STATE_TONE[node.state]} dot>
              {lib(`state.${node.state}`)}
            </StatusBadge>
          </div>
          <button
            type="button"
            onClick={() => actions.onInspect(node.id)}
            className="mt-1 block rounded-detail text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <h3 className="type-section-title text-foreground hover:underline">
              {node.title}
            </h3>
          </button>
          {description ? (
            <p className="mt-2 max-w-prose type-body leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        <SubjectMenu node={node} emphasis={emphasis} actions={actions} />
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Fact label={t("accountable")}>
            <PersonLine name={node.accountablePersonName} />
          </Fact>
          <MeasurementFact node={node} />
          <ProgressFact node={node} spacious />
        </dl>
      </div>
    </div>
  );
}

/** The subject's actions menu — company direction routes through the strategic path, organizational through goals. */
function SubjectMenu({
  node,
  emphasis,
  actions,
}: {
  node: GoalNodeDto;
  emphasis: SubjectEmphasis;
  actions: SubjectActions;
}) {
  const t = useTranslations("goals.SubjectMenu");
  const isCompany = emphasis === "company" || node.ownershipScope === "Company";
  const isDraft = node.state === "Draft";
  const canManage = isCompany ? actions.canManageCompany : actions.canAuthor;
  // With no owner actions available, the whole card is still openable by its title — skip the menu.
  if (!canManage && !isDraft) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("objectiveActions")}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.onInspect(node.id)}>
          <Eye className="size-3.5" data-icon="inline-start" /> {t("viewDetails")}
        </DropdownMenuItem>
        {isCompany ? (
          canManage && isDraft ? (
            <>
              <DropdownMenuItem onSelect={() => actions.onEditCompany(node.id)}>
                <Pencil className="size-3.5" data-icon="inline-start" /> {t("edit")}
              </DropdownMenuItem>
              {isDraft ? (
                <DropdownMenuItem
                  onSelect={() => actions.onPublishCompany(node.id)}
                >
                  <Send className="size-3.5" data-icon="inline-start" /> {t("publishDirection")}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null
        ) : canManage && isDraft ? (
          <>
            <DropdownMenuItem onSelect={() => actions.onResumeDraft(node.id)}>
              <Pencil className="size-3.5" data-icon="inline-start" /> {t("resumeEditing")}
            </DropdownMenuItem>
            {node.childCount === 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => actions.onDelete(node.id)}
                >
                  <Trash2 className="size-3.5" data-icon="inline-start" />{t("removeDraft")}
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── The direct-parent direction strip (quiet upstream context) ──────────────────────

/**
 * The subject's real direct parent — company strategic OR another organizational objective. A compact,
 * quiet strip (deliberately lighter than the subject card below it) that names the direction this
 * objective supports; its title opens the full objective. "Aligned to" labels the relationship once.
 */
function DirectionStrip({
  node,
  orgName,
  onInspect,
}: {
  node: GoalNodeDto;
  orgName: string | null;
  onInspect: (id: string) => void;
}) {
  const t = useTranslations("goals.DirectionStrip");
  const lib = useSay("goals.lib");
  const eyebrow =
    node.ownershipScope === "Company"
      ? companyEyebrow(orgName, lib)
      : t("objective", { value: node.orgUnitName ?? "Organizational" });
  return (
    <div className="rounded-surface border border-border bg-card p-3.5 sm:p-4">
      <p className="type-meta mb-1.5 text-muted-foreground/80">{t("alignedTo")}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span
          aria-hidden
          className="hidden size-8 shrink-0 items-center justify-center rounded-full border border-border bg-inlay text-muted-foreground sm:flex"
        >
          <ScopeMark className="size-4.5" muted />
        </span>
        <div className="min-w-0">
          <p className="type-meta text-muted-foreground">{eyebrow}</p>
          <button
            type="button"
            onClick={() => onInspect(node.id)}
            className="block rounded-detail text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="type-panel-title text-foreground hover:underline">
              {node.title}
            </span>
          </button>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <StatusBadge tone={STATE_TONE[node.state]} dot>
            {lib(`state.${node.state}`)}
          </StatusBadge>
          <PersonLine name={node.accountablePersonName} compact />
        </div>
      </div>
    </div>
  );
}

// ── The aligned cascade: dense expandable rows ──────────────────────────────────────

/**
 * One sibling group under a parent, sharing a single vertical connector down its left gutter. Each
 * objective is a node on that line; a branch with its own aligned objectives nests inline one
 * generation deeper. An authorized author gets a contextual "Add aligned objective" at the end of the
 * group, under the parent whose direction is unambiguous here.
 */
function AlignmentGroup({
  parent,
  siblings,
  tree,
  depth,
}: {
  parent: GoalNodeDto;
  siblings: GoalNodeDto[];
  tree: TreeControls;
  depth: number;
}) {
  const count = siblings.length;
  const canAdd = tree.canAuthor && parent.state === "Published";
  return (
    <div className={cn(depth === 0 ? "mt-3" : "mt-2")}>
      {siblings.map((child, index) => {
        const grandchildren = tree.childrenByParent.get(child.id) ?? [];
        const hasChildren = grandchildren.length > 0;
        const open = !tree.collapsed.has(child.id);
        const hasNodeAbove = index > 0;
        const hasNodeBelow = index < count - 1 || canAdd;
        return (
          <div
            key={child.id}
            className={cn(
              "relative",
              depth === 0 ? "ps-7 sm:ps-8" : "ps-11 sm:ps-12",
              (hasNodeBelow || open) && "pb-2.5"
            )}
          >
            {/* Connector: node centre is level with the row's identity tile (row p-4 = 1rem + half of
                the 2.5rem tile = 2.25rem). */}
            {hasNodeAbove ? (
              <span
                aria-hidden
                className="absolute inset-s-3 top-0 h-9 w-px -translate-x-1/2 rtl:translate-x-1/2 bg-border"
              />
            ) : null}
            {hasNodeBelow ? (
              <span
                aria-hidden
                className="absolute inset-s-3 top-9 bottom-0 w-px -translate-x-1/2 rtl:translate-x-1/2 bg-border"
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "absolute inset-s-3 top-9 h-px -translate-y-1/2 bg-border",
                depth === 0 ? "w-3.5" : "w-8"
              )}
            />
            <span
              aria-hidden
              className={cn(
                "absolute inset-s-3 top-9 z-10 size-3 -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 rounded-full",
                child.state === "Draft"
                  ? "border-2 border-primary bg-background"
                  : "bg-primary"
              )}
            />
            <ObjectiveRow
              node={child}
              hasChildren={hasChildren}
              open={open}
              depth={depth}
              tree={tree}
            />
            {open && hasChildren ? (
              <AlignmentGroup
                parent={child}
                siblings={grandchildren}
                tree={tree}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
      {canAdd ? (
        <div className="relative ps-7 sm:ps-8">
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute inset-s-3 top-0 h-4 w-px -translate-x-1/2 rtl:translate-x-1/2 bg-border"
            />
          ) : null}
          <span
            aria-hidden
            className="absolute inset-s-3 top-4 h-px w-3.5 -translate-y-1/2 bg-border"
          />
          <AddAligned onClick={() => tree.onCreate(parent.id, null)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * An organizational-objective row: an expand caret, the identity tile, the objective's title,
 * description and owning unit on the left, and the accountable person and downstream count as aligned
 * columns on the right, closed by an actions menu. Draft rows are visibly quieter than published
 * direction. Execution progress enriches the same hierarchy without changing its structure.
 */
function ObjectiveRow({
  node,
  hasChildren,
  open,
  depth,
  tree,
}: {
  node: GoalNodeDto;
  hasChildren: boolean;
  open: boolean;
  /** Direct children remain operational anchors; descendants deliberately recede. */
  depth: number;
  tree: TreeControls;
}) {
  const t = useTranslations("goals.ObjectiveRow");
  const lib = useSay("goals.lib");
  const detail = useGoal(tree.cycleId, node.id);
  const description = detail.data?.description?.trim() || null;
  const isDraft = node.state === "Draft";
  const canManage = tree.canAuthor;
  const canAdd = canManage && node.state === "Published";
  const MeasureIcon = node.progressSource === "Calculated" ? Layers : Gauge;
  const nested = depth > 0;
  return (
    <div
      className={cn(
        "group relative border transition-colors hover:border-primary/40",
        nested
          ? "rounded-control bg-inlay"
          : "rounded-surface bg-card",
        isDraft
          ? "border-dashed border-border"
          : nested
            ? "border-transparent"
            : "border-border"
      )}
    >
      <div className={cn("flex items-start gap-3", nested ? "p-3" : "p-4")}>
        <button
          type="button"
          onClick={() => tree.onInspect(node.id)}
          aria-label={t("openObjective")}
          className={cn(
            "flex shrink-0 items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            nested ? "size-8 rounded-control" : "size-10 rounded-control",
            isDraft
              ? "border-border bg-inlay text-muted-foreground"
              : "border-primary-ring bg-primary-tint text-primary-ink"
          )}
        >
          <ScopeMark className={nested ? "size-5" : "size-6"} muted={isDraft} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <button
              type="button"
              onClick={() => tree.onInspect(node.id)}
              className="min-w-0 rounded-detail text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "font-semibold tracking-tight text-foreground hover:underline",
                  nested ? "type-body" : "type-body"
                )}
              >
                {node.title}
              </span>
            </button>
            <StatusBadge tone={STATE_TONE[node.state]} dot>
              {lib(`state.${node.state}`)}
            </StatusBadge>
          </div>
          {description ? (
            <p className="mt-1 line-clamp-2 max-w-2xl type-meta leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-0.5 type-meta text-muted-foreground", nested ? "mt-1" : "mt-1.5")}>
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2
                className="size-3.5 shrink-0 text-muted-foreground/70"
                aria-hidden
              />
              <span className="truncate font-medium text-foreground/80">
                {node.orgUnitName ?? t("organizationalUnit")}
              </span>
            </span>
            {node.measurementSummary?.trim() ? (
              <>
                <Sep />
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <MeasureIcon
                    className="size-3.5 text-muted-foreground/70"
                    aria-hidden
                  />
                  {node.measurementSummary}
                </span>
              </>
            ) : null}
            <Sep />
            <ProgressFact node={node} className="min-w-36 flex-1 basis-40" />
          </div>
        </div>

        {node.accountablePersonName ? (
          <div className="hidden shrink-0 items-center gap-2 pt-0.5 2xl:flex">
            <Avatar className="size-7">
              <AvatarFallback className="type-mark">
                {initials(node.accountablePersonName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 leading-tight">
              <p className="max-w-[9rem] truncate type-meta-strong text-foreground">
                {node.accountablePersonName}
              </p>
              <p className="type-meta text-muted-foreground/70">{t("accountable")}</p>
            </div>
          </div>
        ) : null}

        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => tree.onToggle(node.id)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-control px-2 py-1 type-meta-strong text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="tabular-nums">{node.childCount}</span>
              <span>{t("child")} {node.childCount === 1 ? t("objective") : t("objectives")}</span>
              {open ? (
                <ChevronDown className="size-3.5" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden />
              )}
            </button>
          ) : null}
          <RowMenu
            node={node}
            canManage={canManage}
            canAdd={canAdd}
            tree={tree}
          />
        </div>
      </div>
    </div>
  );
}

function RowMenu({
  node,
  canManage,
  canAdd,
  tree,
}: {
  node: GoalNodeDto;
  canManage: boolean;
  canAdd: boolean;
  tree: TreeControls;
}) {
  const t = useTranslations("goals.RowMenu");
  const isDraft = node.state === "Draft";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={t("objectiveActions")}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => tree.onInspect(node.id)}>
          <Eye className="size-3.5" data-icon="inline-start" /> {t("viewDetails")}
        </DropdownMenuItem>
        {canAdd ? (
          <DropdownMenuItem onSelect={() => tree.onCreate(node.id, null)}>
            <Plus className="size-3.5" data-icon="inline-start" /> {t("addAlignedObjective")}
          </DropdownMenuItem>
        ) : null}
        {canManage && isDraft ? (
          <>
            <DropdownMenuItem onSelect={() => tree.onResumeDraft(node.id)}>
              <Pencil className="size-3.5" data-icon="inline-start" /> {t("resumeEditing")}
            </DropdownMenuItem>
            {node.childCount === 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => tree.onDelete(node.id)}
                >
                  <Trash2 className="size-3.5" data-icon="inline-start" />{t("removeDraft")}
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddAligned({ onClick }: { onClick: () => void }) {
  const t = useTranslations("goals.AddAligned");
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 type-label text-primary-ink transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Plus className="size-4" aria-hidden /> {t("addAlignedObjective")}
    </button>
  );
}

function GroupHeader({
  label,
  description,
  count,
  open,
  onToggle,
  prominent,
}: {
  label: string;
  description?: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  prominent?: boolean;
}) {
  const t = useTranslations("goals.GroupHeader");
  return (
    <div
      className={cn(
        "mb-3 flex items-start justify-between gap-3",
        prominent && "relative ps-7 sm:ps-8"
      )}
    >
      {prominent ? (
        <span aria-hidden className="absolute inset-y-0 inset-s-0 flex w-6 justify-center">
          <span className="absolute -top-5 h-6 w-px bg-border" />
          <span className="relative mt-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background" />
        </span>
      ) : null}
      <div className="min-w-0">
        {prominent ? (
          <h2 className="type-section-title tracking-tight text-foreground">
            {label}
          </h2>
        ) : (
          <p className="type-meta text-muted-foreground">{label}</p>
        )}
        {description ? (
          <p className="mt-0.5 type-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 type-meta-strong text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
      >
        <span className="tabular-nums text-foreground/80">{count}</span>
        <span>{t("direct")} {count === 1 ? t("objective") : t("objectives")}</span>
        {open ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

function EmptyChildren({ isCompany }: { isCompany: boolean }) {
  const t = useTranslations("goals.EmptyChildren");
  return (
    <div className="flex items-center gap-2.5 rounded-surface border border-dashed border-border px-4 py-3.5 type-body text-muted-foreground">
      <ScopeMark className="size-5 shrink-0 text-muted-foreground/50" muted />
      {isCompany
        ? t("noAlignedChildObjectivesYet")
        : t("noDownstreamObjectivesYet")}
    </div>
  );
}

// ── Context header, lineage, focus trail ────────────────────────────────────────────

/**
 * The band naming the actor's own working context — a possessive framing ("Your team · Talent Pod")
 * reserved for the actor's real placement, with the unit's directly-assigned headcount.
 */
function ContextHeader({
  eyebrow,
  title,
  memberCount,
}: {
  eyebrow: string;
  title: string;
  memberCount?: number | null;
}) {
  const t = useTranslations("goals.ContextHeader");
  return (
    <section className="flex items-center gap-4 rounded-surface border border-border bg-section p-4 sm:px-5">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-control border border-primary-ring bg-primary-tint type-subsection-title text-primary-ink"
      >
        {initials(title)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-meta text-muted-foreground">{eyebrow}</p>
        <div className="mt-1 flex items-center gap-2.5">
          <h2 className="truncate type-section-title text-foreground">
            {title}
          </h2>
          {memberCount != null ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-0.5 type-meta-strong text-muted-foreground">
              <span className="tabular-nums">{memberCount}</span> {t("directlyAssigned")}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** "Your team" / "Your department" / … from the unit type, falling back to "Your organization". */
function belongingLabel(type: string | null | undefined, say: Say): string {
  const t = type?.trim();
  return t ? say("yourUnit", { type: t.toLowerCase() }) : say("yourOrganization");
}

/** The eyebrow attributing a company strategic objective, using the org's own name when known. */
function companyEyebrow(orgName: string | null, say: Say): string {
  return orgName ? say("orgStrategic", { orgName }) : say("companyObjective");
}

/**
 * Quiet ancestry above the direct parent — the higher strategy that gives orientation without
 * competing with the direct parent. A passive breadcrumb (nearest higher ancestor first), not a
 * navigator: a leader stays anchored to their own scope.
 */
function LineageChips({ ancestors }: { ancestors: GoalNodeDto[] }) {
  const lib = useSay("goals.lib");
  const ordered = [...ancestors].reverse();
  return (
    <div className="mb-3 inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-control border border-border/70 bg-inlay px-2.5 py-1.5 type-meta text-muted-foreground">
      <ScopeMark
        className="me-0.5 size-3.5 shrink-0 text-muted-foreground/60"
        muted
      />
      {ordered.map((node, index) => (
        <span
          key={node.id}
          className="inline-flex min-w-0 items-center gap-1.5"
        >
          {index > 0 ? (
            <ChevronRight
              className="size-3 shrink-0 text-muted-foreground/40"
              aria-hidden
            />
          ) : null}
          <span className="inline-flex min-w-0 items-baseline gap-1">
            <span className="shrink-0 text-muted-foreground/70">
              {ancestorScopeLabel(node, lib)}
            </span>
            <span aria-hidden className="shrink-0 text-muted-foreground/30">
              /
            </span>
            <span className="max-w-[22rem] truncate font-medium text-foreground/80">
              {node.title}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

function ancestorScopeLabel(node: GoalNodeDto, say: Say): string {
  if (node.ownershipScope === "Company") return say("companyStrategy");
  if (node.ownershipScope === "Employee")
    return node.orgUnitName ?? say("individual");
  return node.orgUnitName ?? say("organizational");
}

/** The focused-mode top navigator: back to the default context, then the full path to the subject. */
function FocusTrail({
  block,
  onFocus,
}: {
  block: ObjectiveBlock;
  onFocus: (id: string | null) => void;
}) {
  const t = useTranslations("goals.FocusTrail");
  const trail = [...block.ancestors, block.node];
  return (
    <nav
      className="flex flex-wrap items-center gap-1 type-body"
      aria-label={t("directionPath")}
    >
      <button
        type="button"
        onClick={() => onFocus(null)}
        className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Building2 className="size-3.5" aria-hidden /> {t("direction")}
      </button>
      {trail.map((node, index) => {
        const isLast = index === trail.length - 1;
        return (
          <span key={node.id} className="flex items-center gap-1">
            <ChevronRight
              className="size-3.5 text-muted-foreground/60"
              aria-hidden
            />
            <button
              type="button"
              onClick={() => onFocus(isLast ? null : node.id)}
              disabled={isLast}
              className={cn(
                "max-w-[16rem] truncate rounded-control px-2 py-1 font-medium transition-colors",
                isLast
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {node.title}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

// ── Empty own-unit: choose a direction and create ───────────────────────────────────

function EmptyUnitContext({
  unit,
  candidates,
  orgName,
  canAuthor,
  onInspect,
  onCreate,
}: {
  unit: UnitContext;
  candidates: ObjectiveBlock[];
  orgName: string | null;
  canAuthor: boolean;
  onInspect: (id: string) => void;
  onCreate: (parentId: string, orgUnitId: string | null) => void;
}) {
  const t = useTranslations("goals.EmptyUnitContext");
  const [selectedId, setSelectedId] = useState(candidates[0]?.node.id ?? "");
  const selected =
    candidates.find((c) => c.node.id === selectedId) ?? candidates[0]!;
  const directParent = selected.node;
  const higherAncestors = selected.ancestors.slice(0, -1);

  return (
    <section>
      {candidates.length > 1 ? (
        <div className="mb-4">
          <DirectionSelector
            directions={candidates.map((c) => c.node)}
            selectedId={selected.node.id}
            onSelect={setSelectedId}
          />
        </div>
      ) : null}

      {higherAncestors.length > 0 ? (
        <LineageChips ancestors={higherAncestors} />
      ) : null}
      <DirectionStrip
        node={directParent}
        orgName={orgName}
        onInspect={onInspect}
      />
      <AlignmentConnector />

      <div className="rounded-surface border border-dashed border-border px-6 py-8 text-center">
        <ScopeMark className="mx-auto size-12 text-foreground/70" />
        <p className="mt-3 type-panel-title text-foreground">
          {t("noObjectiveForYet", { name: unit.name })}
        </p>
        <p className="mx-auto mt-1 max-w-md type-body text-muted-foreground">
          {t("defineAnObjectiveAlignedTo")}
          <span className="font-medium text-foreground">
            “{directParent.title}”
          </span>
          .
        </p>
        {canAuthor ? (
          <Button
            className="mt-5"
            onClick={() => onCreate(directParent.id, unit.orgUnitId)}
          >
            <Plus className="size-4" data-icon="inline-start" /> {t("createObjectiveFor", { name: unit.name })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DirectionSelector({
  directions,
  selectedId,
  onSelect,
}: {
  directions: GoalNodeDto[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("goals.DirectionSelector");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="type-meta me-1 text-muted-foreground">
        {t("alignUnder")}
      </span>
      <FilterChips
        type="single"
        label={t("alignUnder")}
        value={selectedId}
        onChange={onSelect}
        options={directions.map((direction) => ({
          value: direction.id,
          label: <span className="max-w-[16rem] truncate">{direction.title}</span>,
          hint: direction.title,
        }))}
      />
    </div>
  );
}

function NoPublishedDirection({
  canCreateCompany,
  canReachSetup,
  onCreateCompany,
}: {
  canCreateCompany: boolean;
  canReachSetup: boolean;
  onCreateCompany: () => void;
}) {
  const t = useTranslations("goals.NoPublishedDirection");
  return (
    <div className="space-y-9">
      <section className="overflow-hidden rounded-surface border border-border bg-card shadow-raised">
        <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.9fr)] gap-6 px-6 py-8 sm:gap-8 sm:px-8 lg:gap-10 lg:px-10 lg:py-10">
          <div className="flex items-center gap-6 sm:gap-8">
            <div className="relative grid size-24 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/[0.05] before:absolute before:inset-3 before:rounded-full before:border before:border-primary/40 sm:size-28">
              <ScopeMark className="relative size-14 text-primary-ink sm:size-16" />
            </div>

            <div className="min-w-0">
              <p className="type-meta text-muted-foreground">{t("companyDirection")}</p>
              <h2 className="mt-2 type-section-title text-foreground">
                {t("establishCompanyDirection")}
              </h2>
              <p className="mt-3 max-w-xl type-body text-muted-foreground">
                {t("defineTheStrategicObjectiveThat")}
              </p>
              {canCreateCompany ? (
                <Button className="mt-6" onClick={onCreateCompany}>
                  <Plus className="size-4" data-icon="inline-start" /> {t("createCompanyObjective")}
                </Button>
              ) : canReachSetup ? (
                <Button variant="outline" className="mt-6" asChild>
                  <Link href="/cycle">{t("goToCycleSetup")}</Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid content-center gap-5 border-s border-border ps-6 sm:ps-8 lg:ps-10">
            <DirectionValue
              icon={BarChart3}
              title={t("setTheStrategicDirection")}
              description={t("defineTheCompanysFocusFor")}
            />
            <DirectionValue
              icon={UsersRound}
              title={t("enableOrganizationalAlignment")}
              description={t("helpTeamsAlignTheirGoals")}
            />
            <DirectionValue
              icon={Target}
              title={t("createSharedFocus")}
              description={t("makeTheOrganizationsPrioritiesClear")}
            />
          </div>
        </div>
      </section>

      <section className="relative ps-8 sm:ps-12">
        <span className="absolute bottom-10 inset-s-3.5 top-[-2.25rem] w-px bg-border sm:inset-s-5.5" aria-hidden />
        <span className="absolute inset-s-2 top-0 size-3 rounded-full border-2 border-primary bg-background sm:inset-s-4.5" aria-hidden />

        <div>
          <h2 className="type-section-title text-foreground">{t("organizationalAlignment")}</h2>
          <p className="mt-1 type-body text-muted-foreground">
            {t("organizationalObjectivesWillAppearHere")}
          </p>
        </div>

        <div className="mt-5 grid min-h-64 place-items-center rounded-surface border border-dashed border-border px-6 py-12 text-center">
          <div className="max-w-lg">
            <div className="mx-auto grid size-16 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-raised">
              <Network className="size-6" aria-hidden />
            </div>
            <p className="mt-5 type-panel-title text-foreground">
              {t("alignedObjectivesWillAppearHere")}
            </p>
            <p className="mx-auto mt-2 max-w-md type-body leading-6 text-muted-foreground">
              {t("onceYouCreateTheCompany")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function DirectionValue({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-foreground/80">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="type-subsection-title text-foreground">{title}</p>
        <p className="mt-1 type-body leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// ── The vertical alignment connector between the direct parent and the subject ──────

/**
 * The link from the direct-parent strip down into the subject card. The node meets the subject at its
 * top border — filled when the subject is Published, a hollow ring while it is a Draft.
 */
function AlignmentConnector({ state }: { state?: GoalNodeDto["state"] }) {
  const draft = state === "Draft";
  return (
    <div className="relative flex h-6 justify-center" aria-hidden>
      <span className="h-full w-px bg-primary/45" />
      {state ? (
        <span
          className={cn(
            "absolute bottom-0 left-1/2 z-10 size-3 -translate-x-1/2 translate-y-1/2 rounded-full",
            draft ? "border-2 border-primary bg-background" : "bg-primary"
          )}
        />
      ) : (
        <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-4 ring-background" />
      )}
    </div>
  );
}

// ── Shared facts ────────────────────────────────────────────────────────────────────

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="type-meta text-muted-foreground/70">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}

function PersonLine({
  name,
  compact,
}: {
  name: string | null;
  compact?: boolean;
}) {
  const t = useTranslations("goals.PersonLine");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-medium text-foreground",
        compact ? "type-meta" : "type-body"
      )}
    >
      <Avatar className={compact ? "size-4" : "size-6"}>
        <AvatarFallback className={compact ? "type-mark" : "type-mark"}>
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name ?? t("unassigned")}</span>
    </span>
  );
}

function MeasurementFact({ node }: { node: GoalNodeDto }) {
  const t = useTranslations("goals.MeasurementFact");
  const summary = node.measurementSummary?.trim();
  if (!summary) return null;
  const Icon = node.progressSource === "Calculated" ? Layers : Gauge;
  return (
    <Fact label={t("measurement")}>
      <span className="flex items-center gap-1.5 type-label tabular-nums text-foreground">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {summary}
      </span>
    </Fact>
  );
}

/**
 * The objective's own execution result. A dash means no progress has been reported; it is never
 * coerced to 0%. For calculated objectives the label makes the source explicit and the value comes
 * from the configured contribution baseline rather than from aligned children in general.
 */
function ProgressFact({
  node,
  spacious,
  className,
}: {
  node: GoalNodeDto;
  spacious?: boolean;
  className?: string;
}) {
  const t = useTranslations("goals.ProgressFact");
  const value = node.hasProgress ? Math.round(node.derivedProgress) : null;
  const calculated = node.progressSource === "Calculated";
  const label = calculated ? t("calculatedProgress") : t("progress");
  const emptyLabel = node.state === "Draft" ? "—" : t("notStarted");
  const content = (
    <div
      className={cn("flex items-center gap-2", className)}
      aria-label={value === null ? `${label}: ${emptyLabel}` : `${label}: ${value}%`}
    >
      <div
        className={cn(
          "min-w-0 flex-1 overflow-hidden rounded-full bg-muted",
          spacious ? "h-2.5" : "h-1.5"
        )}
      >
        {value !== null ? (
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
          />
        ) : null}
      </div>
      <span className="min-w-9 shrink-0 text-end type-meta-strong tabular-nums text-foreground">
        {value === null ? emptyLabel : `${value}%`}
      </span>
    </div>
  );

  if (spacious) {
    return (
      <div className="min-w-56 flex-1">
        <dt className="type-meta text-muted-foreground/70">{label}</dt>
        <dd className="mt-1.5">{content}</dd>
      </div>
    );
  }
  return content;
}

function Sep() {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  );
}
