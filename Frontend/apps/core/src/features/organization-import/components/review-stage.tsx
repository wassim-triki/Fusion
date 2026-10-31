"use client";

import { useImportProblem } from "@/features/data-import/components/import-words";
import { useLocale, useTranslations } from "next-intl";
import { useSay } from "@repo/ds/lib/say";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
} from "@repo/ds";
import { PageContainer } from "@repo/ds/shell";
import {
  translateOrganizationImportError,
  type OrganizationImportReviewResolutionsInput,
} from "@repo/api";
import { toast } from "sonner";
import { useOrganizationImportMutations } from "../api/use-organization-import";
import { formatHumanDate } from "../model/format";
import {
  attentionByNode,
  branchIds,
  buildReviewTree,
  deriveReviewIssues,
  PLACEHOLDER_ROOT_ID,
  searchReviewTree,
  UNPLACED_PARENT_ID,
  type ReviewIssue,
} from "../model/import-review-model";
import { importStageHref } from "../model/import-stage";
import { useImportFrame } from "./import-frame";
import { ReviewChecks } from "./review-checks";
import { ReviewFooter } from "./review-footer";
import {
  ReviewImportContext,
  ReviewStatusBanner,
  ReviewStructureSummary,
} from "./review-summary";
import { ReviewTree } from "./review-tree";

/** Larger imports open with only the top two levels expanded. */
const LARGE_TREE = 150;

/**
 * Review: the exact organization Fusion intends to establish, the server's checks on it, and
 * publication. The hierarchy is read-only; every fix is a pathway the server offers on a check.
 * Publishing is a confirmed action, the server revalidates the exact reviewed proposal, and
 * success lands on the live Organization with the new units revealed.
 */
export function ReviewStage() {
  const t = useTranslations("orgImport.review");
  const treeWords = useSay("orgImport");
  const locale = useLocale();
  const problemLine = useImportProblem();
  const router = useRouter();
  const { session, refetch, beginPublish, endPublish } = useImportFrame();
  const mutations = useOrganizationImportMutations();
  const review = session.review;
  const matchHref = importStageHref(session.id, "match");
  // Latest session for writes fired after a recompute has already advanced the ETag version.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const issues = useMemo(
    () => (review ? deriveReviewIssues(review) : []),
    [review]
  );
  const tree = useMemo(
    () => (review ? buildReviewTree(review, treeWords) : null),
    [review, treeWords]
  );
  const attention = useMemo(() => attentionByNode(issues), [issues]);

  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => (tree ? searchReviewTree(tree, query) : undefined),
    [tree, query]
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    tree && tree.byId.size > LARGE_TREE ? branchIds(tree, 1) : new Set()
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [revealId, setRevealId] = useState<string | null>(null);
  const [focusedIssue, setFocusedIssue] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  // Drop selection and emphasis that no longer resolve after a recompute.
  useEffect(() => {
    if (!tree) return;
    if (selectedId && !tree.byId.has(selectedId)) setSelectedId(null);
    if (focusedIssue && !issues.some((issue) => issue.key === focusedIssue))
      setFocusedIssue(null);
    setHighlightedIds((current) =>
      [...current].every((id) => tree.byId.has(id))
        ? current
        : new Set([...current].filter((id) => tree.byId.has(id)))
    );
  }, [tree, issues, selectedId, focusedIssue]);

  if (!review || !tree) return null;

  async function resolve(
    resolutions: OrganizationImportReviewResolutionsInput
  ) {
    try {
      await mutations.resolveReview.mutateAsync({
        id: sessionRef.current.id,
        version: sessionRef.current.version,
        resolutions,
      });
    } catch (error) {
      toast.error(t("notUpdated"), {
        description: problemLine(translateOrganizationImportError(error)),
      });
      refetch();
    }
  }

  async function publish() {
    if (!review) return;
    beginPublish();
    try {
      const result = await mutations.commit.mutateAsync({
        id: session.id,
        version: session.version,
        proposalFingerprint: review.proposalFingerprint,
      });
      endPublish(true);
      const reveal = result.createdUnits
        .map((unit) => unit.orgUnitId)
        .join(",");
      router.replace(
        `/organization?asOf=${encodeURIComponent(result.effectiveDate)}${reveal ? `&reveal=${encodeURIComponent(reveal)}` : ""}`
      );
    } catch (error) {
      endPublish(false);
      setPublishOpen(false);
      const problem = translateOrganizationImportError(error);
      // A stale review, not a failure: Review reloads and the user publishes the new proposal.
      if (problem.code === "ProposalChanged") {
        toast.warning(t("changed"), {
          description: t("changedDescription"),
        });
      } else {
        toast.error(t("notPublished"), {
          description: problemLine(problem),
        });
      }
      refetch();
    }
  }

  /** Open every ancestor of these units so they're on screen. */
  function expandTo(ids: string[]) {
    const ancestors = new Set(
      ids.flatMap((id) => (tree?.pathById.get(id) ?? []).slice(0, -1))
    );
    setCollapsed(
      (current) => new Set([...current].filter((id) => !ancestors.has(id)))
    );
  }

  function viewUnits(issue: ReviewIssue) {
    const ids = issue.nodeIds.filter((id) => tree?.byId.has(id));
    setQuery("");
    expandTo(ids);
    setHighlightedIds(new Set(ids));
    setSelectedId(null);
    setFocusedIssue(issue.key);
    setRevealId(null);
    requestAnimationFrame(() => setRevealId(ids[0] ?? null));
  }

  function selectNode(id: string) {
    setSelectedId(id);
    setHighlightedIds(new Set());
    const first = issues.find((issue) =>
      id === PLACEHOLDER_ROOT_ID
        ? issue.code === "MultipleRoots"
        : id === UNPLACED_PARENT_ID
          ? issue.code === "MissingParent"
          : issue.nodeIds.includes(id)
    );
    setFocusedIssue(first?.key ?? null);
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function requestPublish() {
    setPublishOpen(true);
  }

  const { createCount, existingCount } = review.readiness;
  const noop = createCount === 0;
  const existingNote =
    existingCount > 0
      ? ` ${t("existingNote", { count: existingCount })}`
      : "";
  const publishing = mutations.commit.isLoading;

  return (
    <section aria-label={t("label")}>
      <PageContainer className="space-y-6 pt-2">
        <ReviewStatusBanner review={review} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:items-stretch">
          <section
            aria-labelledby="review-structure-heading"
            className="relative min-w-0 rounded-surface bg-card xl:min-h-[32rem]"
          >
            {/* On xl the panel leaves flow so the row height follows the checks column; the tree scrolls. */}
            <div className="flex flex-col p-5 xl:absolute xl:inset-0">
              <h2
                id="review-structure-heading"
                className="type-section-title text-foreground"
              >
                {t("structure")}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="relative min-w-56 flex-1 sm:max-w-md">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("search")}
                    aria-label={t("searchLabel")}
                    className="ps-9"
                  />
                </div>
                {branchIds(tree).size > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto"
                    disabled={Boolean(visible)}
                    aria-label={
                      collapsed.size > 0
                        ? t("expandAllLabel")
                        : t("collapseAllLabel")
                    }
                    onClick={() =>
                      setCollapsed(
                        collapsed.size > 0 ? new Set() : branchIds(tree)
                      )
                    }
                  >
                    {collapsed.size > 0 ? (
                      <ChevronsUpDown aria-hidden />
                    ) : (
                      <ChevronsDownUp aria-hidden />
                    )}
                    {collapsed.size > 0 ? t("expandAll") : t("collapseAll")}
                  </Button>
                ) : null}
              </div>
              <div className="-mx-2 mt-3 min-h-0 flex-1 px-2 xl:overflow-y-auto">
                {tree.roots.length > 0 ? (
                  <ReviewTree
                    model={tree}
                    collapsed={collapsed}
                    visible={visible}
                    selectedId={selectedId}
                    highlightedIds={highlightedIds}
                    revealId={revealId}
                    attention={attention}
                    markExisting={createCount > 0 && existingCount > 0}
                    onSelect={selectNode}
                    onToggle={toggle}
                  />
                ) : (
                  <p className="px-2 py-10 text-center type-body text-muted-foreground">
                    {t("empty")}
                  </p>
                )}
              </div>
            </div>
          </section>
          <aside className="min-w-0 space-y-6">
            <ReviewChecks
              review={review}
              issues={issues}
              focusedKey={focusedIssue}
              saving={mutations.resolveReview.isLoading}
              matchHref={matchHref}
              onViewUnits={viewUnits}
              onResolve={(resolutions) => void resolve(resolutions)}
            />
            <ReviewStructureSummary review={review} />
            <ReviewImportContext review={review} source={session.source} />
          </aside>
        </div>
      </PageContainer>

      <ReviewFooter
        matchHref={matchHref}
        readiness={review.readiness}
        publishing={publishing}
        onPublish={requestPublish}
      />

      <AlertDialog
        open={publishOpen}
        onOpenChange={(open) => !publishing && setPublishOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {noop
                ? t("finishTitle")
                : t("publishTitle", { count: createCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {noop
                ? t("finishDescription")
                : t("publishDescription", { count: createCount, date: formatHumanDate(review.effectiveDate, locale) })}
              {existingNote}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publishing}>
              {t("keep")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={publishing}
              onClick={(event) => {
                event.preventDefault();
                void publish();
              }}
            >
              {noop
                ? publishing
                  ? t("finishing")
                  : t("finish")
                : publishing
                  ? t("publishingButton")
                  : t("publish")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
