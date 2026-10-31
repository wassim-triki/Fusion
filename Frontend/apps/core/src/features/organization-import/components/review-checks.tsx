"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { Button, Input, Label, cn } from "@repo/ds";
import type {
  OrganizationImportResolutionKind,
  OrganizationImportReview,
  OrganizationImportReviewResolutionsInput,
} from "@repo/api";
import { findProposalNode, type ReviewIssue } from "../model/import-review-model";

type Group = "Blocker" | "Warning";

/**
 * Review checks: the server's deterministic findings, blockers first. Each check says what is
 * wrong and offers exactly the pathways the server allowed; Review never edits a unit itself.
 */
export function ReviewChecks({
  review,
  issues,
  focusedKey,
  saving,
  matchHref,
  onViewUnits,
  onResolve,
}: {
  review: OrganizationImportReview;
  issues: ReviewIssue[];
  /** The check to open and bring into view, e.g. after a unit with issues is selected. */
  focusedKey: string | null;
  saving: boolean;
  matchHref: string;
  onViewUnits: (issue: ReviewIssue) => void;
  onResolve: (resolutions: OrganizationImportReviewResolutionsInput) => void;
}) {
  const t = useTranslations("orgImport.checks");
  const blockers = issues.filter((issue) => issue.severity === "Blocker");
  const warnings = issues.filter((issue) => issue.severity === "Warning");
  const [open, setOpen] = useState<Record<Group, boolean>>({
    Blocker: blockers.length > 0,
    Warning: blockers.length === 0 && warnings.length > 0,
  });
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!focusedKey) return;
    const issue = issues.find((candidate) => candidate.key === focusedKey);
    if (!issue) return;
    setOpen((current) => ({ ...current, [issue.severity]: true }));
    requestAnimationFrame(() => itemRefs.current.get(focusedKey)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [focusedKey, issues]);

  const props = { review, saving, matchHref, focusedKey, itemRefs, onViewUnits, onResolve };
  return (
    <section aria-labelledby="review-checks-title" className="rounded-surface bg-card p-5">
      <h2 id="review-checks-title" className="type-section-title text-foreground">
        {t("title")}
      </h2>
      <div className="mt-4 space-y-2">
        <CheckGroup
          group="Blocker"
          issues={blockers}
          open={open.Blocker}
          onToggle={() => setOpen((current) => ({ ...current, Blocker: !current.Blocker }))}
          {...props}
        />
        <CheckGroup
          group="Warning"
          issues={warnings}
          open={open.Warning}
          onToggle={() => setOpen((current) => ({ ...current, Warning: !current.Warning }))}
          {...props}
        />
      </div>
    </section>
  );
}

function CheckGroup({
  group,
  issues,
  open,
  onToggle,
  ...props
}: {
  group: Group;
  issues: ReviewIssue[];
  open: boolean;
  onToggle: () => void;
} & ItemProps) {
  const t = useTranslations("orgImport.checks");
  const count = issues.length;
  const blocker = group === "Blocker";
  const label = blocker
    ? count === 0 ? t("noBlocking") : t("blocking", { count })
    : count === 0 ? t("noWarnings") : t("warnings", { count });
  const expandable = count > 0;
  const Chevron = open && expandable ? ChevronUp : ChevronDown;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-control border",
        count === 0 && "border-border",
        count > 0 && blocker && "border-destructive/40",
        count > 0 && !blocker && "border-warning/45"
      )}
    >
      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          count > 0 && blocker && "bg-destructive/[0.06]",
          count > 0 && !blocker && "bg-warning-subtle"
        )}
      >
        {count === 0 ? (
          <CheckCircle2 aria-hidden className="size-5 shrink-0 fill-success/15 text-success" />
        ) : blocker ? (
          <AlertCircle aria-hidden className="size-5 shrink-0 fill-destructive/15 text-destructive" />
        ) : (
          <TriangleAlert aria-hidden className="size-5 shrink-0 fill-warning/20 text-warning" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 type-body font-semibold",
            count === 0 && "text-foreground",
            count > 0 && blocker && "text-destructive",
            count > 0 && !blocker && "text-primary-foreground dark:text-primary"
          )}
        >
          {label}
        </span>
        <Chevron aria-hidden className={cn("size-4 shrink-0 text-muted-foreground", !expandable && "opacity-40")} />
      </button>
      {open && expandable ? (
        <ul className="divide-y divide-border border-t border-border">
          {issues.map((issue) => (
            <CheckItem key={issue.key} issue={issue} {...props} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ItemProps = {
  review: OrganizationImportReview;
  saving: boolean;
  matchHref: string;
  focusedKey: string | null;
  itemRefs: React.RefObject<Map<string, HTMLLIElement>>;
  onViewUnits: (issue: ReviewIssue) => void;
  onResolve: (resolutions: OrganizationImportReviewResolutionsInput) => void;
};

function currentResolutions(review: OrganizationImportReview): Required<OrganizationImportReviewResolutionsInput> {
  return {
    introducedRoot: review.resolutions.introducedRoot,
    acceptedExistingMatches: review.resolutions.acceptedExistingMatches,
    keepExistingNodeIds: review.resolutions.keepExistingNodeIds,
  };
}

function CheckItem({ issue, review, saving, matchHref, focusedKey, itemRefs, onViewUnits, onResolve }: ItemProps & { issue: ReviewIssue }) {
  const t = useTranslations("orgImport.checks");
  const anchor = findProposalNode(review, issue.anchorNodeId ?? null);
  const pathways: OrganizationImportResolutionKind[] = [
    ...(issue.preferredResolution ? [issue.preferredResolution] : []),
    ...issue.allowedResolutions.filter((kind) => kind !== issue.preferredResolution),
  ];
  const viewable = issue.nodeIds.length > 0;

  function action(kind: OrganizationImportResolutionKind, primary: boolean) {
    const variant = primary ? "default" : "outline";
    switch (kind) {
      case "ReturnToMatch":
        return (
          <Button key={kind} size="sm" variant={variant} asChild>
            <Link href={matchHref}>{t("changeMatching")}</Link>
          </Button>
        );
      case "CorrectSource":
        return (
          <Button key={kind} size="sm" variant={variant} asChild>
            <Link href="/organization/import">{t("correctFile")}</Link>
          </Button>
        );
      case "KeepExisting":
        return anchor ? (
          <Button
            key={kind}
            size="sm"
            variant={variant}
            disabled={saving}
            onClick={() => {
              const current = currentResolutions(review);
              onResolve({
                ...current,
                keepExistingNodeIds: Array.from(new Set([...current.keepExistingNodeIds, anchor.proposalNodeId])),
              });
            }}
          >
            {t("keepExisting")}
          </Button>
        ) : null;
      // Adding a root and choosing an existing unit are their own controls below; the effective
      // date has no control on this surface.
      default:
        return null;
    }
  }

  const buttons = pathways.map((kind, index) => action(kind, index === 0)).filter(Boolean);
  const focused = issue.key === focusedKey;

  return (
    <li
      ref={(element) => {
        if (element) itemRefs.current.set(issue.key, element);
        else itemRefs.current.delete(issue.key);
      }}
      className={cn("space-y-3 px-4 py-4 transition-colors", focused && "bg-inlay")}
    >
      <div>
        <h3 className="type-body font-semibold text-foreground">{issue.title}</h3>
        <p className="mt-1 type-body text-muted-foreground">{issue.detail}</p>
      </div>

      {anchor && anchor.identityEvidence.length > 0 ? (
        <ul className="space-y-2">
          {anchor.identityEvidence.map((evidence) => (
            <li key={`${evidence.identifier}-${evidence.unitId}`} className="rounded-control border border-border px-3 py-2">
              <p className="type-meta text-muted-foreground">
                {evidence.identifier === "fusionOrgUnitId" ? t("fusionId") : t("businessCode")} · {evidence.suppliedValue}
              </p>
              <p className="type-body font-medium text-foreground">
                {evidence.unitName} <span className="type-code text-muted-foreground">{evidence.unitCode}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {pathways.includes("AddOrganizationRoot") ? <RootForm review={review} saving={saving} onResolve={onResolve} /> : null}

      {pathways.includes("ChooseExistingUnit") && anchor && anchor.candidates.length > 0 ? (
        <ul className="space-y-2">
          {anchor.candidates.map((candidate) => (
            <li key={candidate.id} className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate type-body font-medium text-foreground">{candidate.name}</span>
                <span className="block truncate type-meta text-muted-foreground">
                  {candidate.typeName} • {candidate.code}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  const current = currentResolutions(review);
                  onResolve({
                    ...current,
                    acceptedExistingMatches: { ...current.acceptedExistingMatches, [anchor.proposalNodeId]: candidate.id },
                  });
                }}
              >
                {t("useExisting")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {buttons.length > 0 || viewable ? (
        <div className="flex flex-wrap items-center gap-2">
          {buttons}
          {viewable ? (
            <button
              type="button"
              onClick={() => onViewUnits(issue)}
              className="inline-flex items-center gap-1.5 rounded-control px-1 py-1 type-body font-medium text-primary-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring dark:text-primary"
            >
              {issue.nodeIds.length > 1 ? t("viewUnits") : t("viewUnit")}
              <ArrowRight aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RootForm({
  review,
  saving,
  onResolve,
}: {
  review: OrganizationImportReview;
  saving: boolean;
  onResolve: (resolutions: OrganizationImportReviewResolutionsInput) => void;
}) {
  const t = useTranslations("orgImport.checks");
  const [name, setName] = useState(review.resolutions.introducedRoot?.name ?? "");
  const [code, setCode] = useState(review.resolutions.introducedRoot?.businessCode ?? "");
  const ready = name.trim().length > 0 && code.trim().length > 0;
  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onResolve({ ...currentResolutions(review), introducedRoot: { name: name.trim(), businessCode: code.trim() } });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="review-root-name">{t("rootName")}</Label>
        <Input id="review-root-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("rootNamePlaceholder")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-root-code">{t("rootCode")}</Label>
        <Input
          id="review-root-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t("rootCodePlaceholder")}
        />
      </div>
      <Button type="submit" size="sm" disabled={!ready || saving} className="sm:mb-0.5">
        {t("addRoot")}
      </Button>
    </form>
  );
}
