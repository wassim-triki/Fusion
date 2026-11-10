import Link from "next/link";
import { ChevronRight, MapView } from "@repo/ds/icons";
import { alignmentMapHref } from "@/lib/performance-routes";
import { ScopeMark } from "../../scope-mark";
import type { ObjectiveRef } from "../objective-ref";
import { mapFocusFor, type ObjectiveRecord } from "../objective-record-model";
import { RecordSection } from "./record-primitives";
import { useTranslations } from "next-intl";

/**
 * The direction this objective supports. The parent opens in the same record, so walking up the
 * cascade is the same gesture everywhere — and reading a published parent never requires entering the
 * organization-direction workspace. The map link shows where the objective sits in the whole cascade.
 */
export function AlignmentSection({
  record,
  onOpen,
}: {
  record: ObjectiveRecord;
  onOpen: (ref: ObjectiveRef) => void;
}) {
  const t = useTranslations("objective.AlignmentSection");
  const parent = record.parent;
  const focus = mapFocusFor(record);
  if (!parent && !focus) return null;
  const mapLink = focus ? (
    <Link
      href={alignmentMapHref(record.ref.cycleId, focus.focus, focus.near)}
      className="inline-flex items-center gap-1.5 rounded-control-sm type-meta-strong text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MapView className="size-3.5" aria-hidden />
      {t("viewOnMap")}
    </Link>
  ) : undefined;
  if (!parent) return <RecordSection label={t("alignment")} action={mapLink}>{null}</RecordSection>;
  return (
    <RecordSection label={t("supports")} action={mapLink}>
      <button
        type="button"
        onClick={() => onOpen(parent.ref)}
        className="group flex w-full items-center gap-3 rounded-surface border border-border bg-popover p-4 text-start transition-colors hover:border-(--type-ring) hover:bg-(--type-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-card"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-(--type-tint) text-(--type-ink) ring-1 ring-(--type-ring)">
          <ScopeMark className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block type-label tracking-tight text-foreground">{parent.title}</span>
          <span className="mt-0.5 block type-meta text-muted-foreground">{parent.scopeLabel}{parent.archived ? " " + t("archived") : ""}</span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
          aria-hidden
        />
      </button>
    </RecordSection>
  );
}
