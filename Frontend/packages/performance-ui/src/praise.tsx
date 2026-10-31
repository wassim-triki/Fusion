import type { ReactNode } from "react";
import { PRAISE_REACTIONS, PRAISE_REACTION_LABEL, type PraiseDto, type PraiseReactionKind } from "@repo/api";
import { cn } from "@repo/ds";
import { AvatarStack } from "./people";
import { ValueChip } from "./values";
import { useTranslations } from "next-intl";
import { usePerformanceWords } from "./use-words";

export { initials } from "./people";

/** The host's glyph per reaction: Performance passes its Hugeicons, the shell and Core HR their Lucide icons. */
export type PraiseReactionIcons = Record<PraiseReactionKind, ReactNode>;

export interface PraiseCardProps {
  praise: PraiseDto;
  reactionIcons: PraiseReactionIcons;
  /** Present when the viewer can react; reactions are read-only counts without it. */
  onReact?: (kind: PraiseReactionKind, add: boolean) => void;
  /** Opens the praise drawer (Performance) or its deep link (other modules). */
  onOpen?: () => void;
  /** Reactions waiting on the server, so a quick second tap doesn't fire twice. */
  pendingReaction?: PraiseReactionKind | null;
  /** The praise wall reads the message in the human voice; compact lists keep the system voice. */
  reading?: boolean;
  /** The viewer's employee id: praise naming them is marked as addressed to them. */
  viewerEmployeeId?: string | null;
  /**
   * Home's box (B-226): the words first, in quotes in the editorial voice, then who gave it to whom and when, the
   * value and the reactions, on a box one tone lighter than its section.
   */
  quote?: boolean;
}


/**
 * One praise, led by the people praised: their faces and names, then who gave it and when, the message, the value
 * in its own hue, and the reactions. In a list the message clamps and opens the drawer for the rest.
 */
export function PraiseCard({ praise, reactionIcons, onReact, onOpen, pendingReaction, reading = false, viewerEmployeeId, quote = false }: PraiseCardProps) {
  const t = useTranslations("performanceUi.PraiseCard");
  const words = usePerformanceWords();
  const toViewer = Boolean(viewerEmployeeId) && praise.recipients.some((r) => r.id === viewerEmployeeId);
  const recipients = words.joinNames(praise.recipients.map((r) => r.name));
  const author = praise.author.name ?? t("aColleague");
  const message = (
    // Written in whatever language its author used, so it takes its direction from its own text.
    <p dir="auto" className={cn(reading ? "type-narrative" : "type-body", "text-foreground", onOpen && "line-clamp-4")}>{praise.message}</p>
  );
  if (quote) {
    const said = (
      <p dir="auto" className={cn("type-narrative text-foreground", onOpen && "line-clamp-4")}>“{praise.message}”</p>
    );
    return (
      <article id={`praise-${praise.id}`} className="flex flex-col gap-3 rounded-control bg-inlay p-4" aria-label={t("praised", { author, recipients })}>
        {onOpen ? (
          <button type="button" onClick={onOpen} className="block w-full rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {said}
          </button>
        ) : said}
        <div className="flex items-center gap-2">
          <AvatarStack names={[author]} size="sm" max={1} />
          <p className="min-w-0 type-meta text-muted-foreground">
            {t("byTo", { author, recipients })} · <time dateTime={praise.givenAt}>{words.praiseTime(praise.givenAt)}</time>
          </p>
        </div>
        {toViewer ? (
          <span className="self-start rounded-detail bg-primary/15 px-2 py-0.5 type-meta font-semibold text-primary">{t("toYou")}</span>
        ) : null}
        <ValueChip value={praise.value} className="self-start" />
        <PraiseReactions praise={praise} icons={reactionIcons} onReact={onReact} pending={pendingReaction} />
      </article>
    );
  }
  return (
    <article
      id={`praise-${praise.id}`}
      className="flex scroll-mt-24 flex-col gap-3.5 rounded-surface bg-card p-5"
      aria-label={t("praised", { author, recipients })}
    >
      <header className="flex items-center gap-3">
        <AvatarStack names={praise.recipients.map((r) => r.name)} size="lg" max={3} />
        <div className="min-w-0 flex-1">
          <p className="type-label text-foreground">{recipients}</p>
          <p className="type-meta text-muted-foreground">
            {t("from", { author })} <time dateTime={praise.givenAt}>{words.praiseTime(praise.givenAt)}</time>
          </p>
        </div>
      </header>
      {toViewer ? (
        <span className="self-start rounded-detail bg-primary/15 px-2 py-0.5 type-meta font-semibold text-primary">{t("toYou")}</span>
      ) : null}
      {onOpen ? (
        <button type="button" onClick={onOpen} className="block w-full rounded-control text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {message}
        </button>
      ) : (
        message
      )}
      <ValueChip value={praise.value} className="self-start" />
      <PraiseReactions praise={praise} icons={reactionIcons} onReact={onReact} pending={pendingReaction} />
    </article>
  );
}

/** The four reactions as toggles with counts; when read-only, only those someone used show. */
export function PraiseReactions({
  praise,
  icons,
  onReact,
  pending,
}: {
  praise: PraiseDto;
  icons: PraiseReactionIcons;
  onReact?: (kind: PraiseReactionKind, add: boolean) => void;
  pending?: PraiseReactionKind | null;
}) {
  const t = useTranslations("performanceUi.PraiseReactions");
  const byKind = new Map(praise.reactions.map((r) => [r.kind, r]));
  const kinds = onReact ? PRAISE_REACTIONS : PRAISE_REACTIONS.filter((kind) => (byKind.get(kind)?.count ?? 0) > 0);
  if (kinds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("reactions")}>
      {kinds.map((kind) => {
        const reaction = byKind.get(kind) ?? { kind, count: 0, mine: false };
        const content = (
          <>
            <span aria-hidden className="flex size-4 items-center justify-center [&_svg]:size-4">
              {icons[kind]}
            </span>
            {reaction.count > 0 ? <span className="tabular-nums">{reaction.count}</span> : null}
          </>
        );
        const label = `${PRAISE_REACTION_LABEL[kind]}${reaction.count > 0 ? `, ${reaction.count}` : ""}`;
        const shape = "inline-flex h-8 items-center gap-1.5 rounded-control border px-2.5 type-meta";
        return onReact ? (
          <button
            key={kind}
            type="button"
            // eslint-disable-next-line no-restricted-syntax -- a reaction is one toggle: you reacted or you did not
            aria-pressed={reaction.mine}
            aria-label={label}
            title={PRAISE_REACTION_LABEL[kind]}
            disabled={pending === kind}
            onClick={() => onReact(kind, !reaction.mine)}
            className={cn(
              shape,
              "transition-colors duration-[var(--duration-fast)]",
              reaction.mine
                ? "border-primary/30 bg-primary-tint text-primary-ink"
                : reaction.count > 0
                  ? "border-border text-muted-foreground hover:text-foreground"
                  : "border-transparent text-muted-foreground/70 hover:border-border hover:text-foreground",
            )}
          >
            {content}
          </button>
        ) : (
          <span key={kind} aria-label={label} className={cn(shape, "border-border text-muted-foreground")}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

export interface PraiseListProps extends Omit<PraiseCardProps, "praise" | "onReact" | "onOpen"> {
  items: readonly PraiseDto[];
  onReact?: (praise: PraiseDto, kind: PraiseReactionKind, add: boolean) => void;
  onOpen?: (praise: PraiseDto) => void;
  /** Shown when there's nothing to list; one line, owned by the host. */
  empty?: ReactNode;
  /** Two columns on wide screens, for the praise wall. */
  wall?: boolean;
}

export function PraiseList({ items, onReact, onOpen, empty, wall = false, ...card }: PraiseListProps) {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <ul className={wall ? "gap-3 md:columns-2 [&>li]:mb-3 [&>li]:break-inside-avoid" : "space-y-3"}>
      {items.map((praise) => (
        <li key={praise.id}>
          <PraiseCard
            {...card}
            praise={praise}
            onReact={onReact ? (kind, add) => onReact(praise, kind, add) : undefined}
            onOpen={onOpen ? () => onOpen(praise) : undefined}
          />
        </li>
      ))}
    </ul>
  );
}
