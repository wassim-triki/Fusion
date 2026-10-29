"use client";

import { useEffect, useState } from "react";
import type { CalibrationCellDto, CalibrationCellPersonDto, CalibrationNineBoxViewDto, RatingScaleLevelDto, ReviewPotential } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Checkbox } from "@repo/ds/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@repo/ds/components/ui/dialog";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { initials } from "@repo/performance-ui";
import { Check } from "@/lib/icons";
import { bandLevels, bandRange, nearestLevel, POTENTIALS } from "./calibration-format";
import { useTranslations } from "next-intl";
import { performanceFailure } from "@/features/performance/api/performance-failure";
import { LevelCards } from "../reviews/review-parts";

export interface NineBoxMove {
  person: CalibrationCellPersonDto;
  potential: ReviewPotential;
  rating: number;
  reason: string;
  discussed: boolean;
}

const ROWS: readonly ReviewPotential[] = [...POTENTIALS].reverse();

/**
 * Board 05: performance bands across, potential up. Drag a person onto a cell, or press M on a person and choose
 * the cell, and the drop form asks for the level and a reason before anything changes (board 07).
 */
export function NineBoxView({ view, scale, readOnly, onOpen, onMove }: {
  view: CalibrationNineBoxViewDto;
  scale: RatingScaleLevelDto[];
  readOnly: boolean;
  onOpen: (reviewId: string) => void;
  onMove: (move: NineBoxMove) => Promise<unknown>;
}) {
  const t = useTranslations("calibration.NineBoxView");
  const bands = bandLevels(scale, view.bandLowTop, view.bandMidTop);
  const [picked, setPicked] = useState<{ person: CalibrationCellPersonDto; from: CalibrationCellDto } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ person: CalibrationCellPersonDto; from: CalibrationCellDto; to: CalibrationCellDto } | null>(null);
  const people = view.cells.reduce((sum, cell) => sum + cell.people.length, 0);

  useEffect(() => {
    if (!picked) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setPicked(null); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [picked]);

  const cellOf = (band: number, potential: ReviewPotential) => view.cells.find((cell) => cell.band === band && cell.potential === potential)!;
  const findPerson = (reviewId: string) => {
    for (const cell of view.cells) {
      const person = cell.people.find((item) => item.reviewId === reviewId);
      if (person) return { person, from: cell };
    }
    return null;
  };
  const dropOn = (to: CalibrationCellDto, source: { person: CalibrationCellPersonDto; from: CalibrationCellDto } | null) => {
    setHover(null);
    setPicked(null);
    if (!source || (source.from.band === to.band && source.from.potential === to.potential)) return;
    setDrop({ ...source, to });
  };

  return (
    <section aria-label={t("nineBox")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 type-meta text-muted-foreground">
        <span aria-live="polite">
          {picked ? t("movingChooseACellOr", { name: picked.person.name })
            : readOnly ? t("people", { count: people }) : t("peopleDrag", { count: people })}
        </span>
        <span className="flex items-center gap-3">
          <span className="rounded-full border border-primary px-2 py-0.5 font-semibold text-primary-ink">{t("moved")}</span>
        </span>
      </div>
      <div className="grid grid-cols-[2rem_repeat(3,minmax(0,1fr))] gap-3">
        {ROWS.map((potential) => (
          <div key={potential} className="contents">
            <div className="flex items-center justify-center">
              <span className="-rotate-90 whitespace-nowrap type-meta-strong text-muted-foreground">{potential}</span>
            </div>
            {[0, 1, 2].map((band) => {
              const cell = cellOf(band, potential);
              const key = `${band}-${potential}`;
              const target = picked !== null && !(picked.from.band === band && picked.from.potential === potential);
              return (
                <div key={key}
                  onDragOver={(event) => { if (!readOnly) { event.preventDefault(); setHover(key); } }}
                  onDragLeave={() => setHover((current) => current === key ? null : current)}
                  onDrop={(event) => { event.preventDefault(); dropOn(cell, findPerson(event.dataTransfer.getData("text/plain"))); }}
                  className={cn("relative min-h-44 rounded-surface bg-card p-4 transition-colors",
                    hover === key && "bg-primary-tint outline-dashed outline-1 outline-primary")}>
                  <div className="flex items-baseline justify-between">
                    <span className="type-metric tabular-nums text-foreground">{cell.people.length}</span>
                    {target ? (
                      <Button size="sm" variant="outline" onClick={() => dropOn(cell, picked)}>{t("moveHere")}</Button>
                    ) : null}
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {cell.people.map((person) => (
                      <li key={person.reviewId}>
                        <button type="button" draggable={!readOnly} aria-keyshortcuts={readOnly ? undefined : "M"}
                          onDragStart={(event) => { event.dataTransfer.setData("text/plain", person.reviewId); event.dataTransfer.effectAllowed = "move"; }}
                          onClick={() => onOpen(person.reviewId)}
                          onKeyDown={(event) => {
                            if (!readOnly && (event.key === "m" || event.key === "M")) { event.preventDefault(); setPicked({ person, from: cell }); }
                          }}
                          className={cn("inline-flex items-center gap-2 rounded-full bg-inlay py-1 ps-1 pe-3 type-meta-strong text-foreground transition-colors hover:bg-section focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            person.moved && "ring-1 ring-primary", picked?.person.reviewId === person.reviewId && "opacity-50",
                            !readOnly && "cursor-grab active:cursor-grabbing")}>
                          <span className="flex size-6 items-center justify-center rounded-full bg-card type-mark">{initials(person.name)}</span>
                          {person.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex items-end justify-center pb-1 text-center type-meta text-muted-foreground">{t("potential")}</div>
        {bands.map((levels, band) => (
          <div key={band} className="pt-1 text-center">
            <p className="type-label tabular-nums text-foreground">{bandRange(levels)}</p>
            <p className="type-meta text-muted-foreground">{levels.map((level) => level.label).join(", ")}</p>
          </div>
        ))}
      </div>
      {drop ? (
        <DropForm drop={drop} bands={bands} onClose={() => setDrop(null)}
          onConfirm={async (rating, reason, discussed) => {
            await onMove({ person: drop.person, potential: drop.to.potential, rating, reason, discussed });
            setDrop(null);
          }} />
      ) : null}
    </section>
  );
}

function DropForm({ drop, bands, onClose, onConfirm }: {
  drop: { person: CalibrationCellPersonDto; from: CalibrationCellDto; to: CalibrationCellDto };
  bands: RatingScaleLevelDto[][];
  onClose: () => void;
  onConfirm: (rating: number, reason: string, discussed: boolean) => Promise<void>;
}) {
  const t = useTranslations("calibration.DropForm");
  const levels = bands[drop.to.band] ?? [];
  const [rating, setRating] = useState(() => nearestLevel(levels, drop.person.currentRating));
  const [reason, setReason] = useState("");
  const [discussed, setDiscussed] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const potentialChanged = drop.from.potential !== drop.to.potential;
  const first = drop.person.name.split(" ")[0];
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("move", { name: drop.person.name })}</DialogTitle>
          <DialogDescription>
            {[rating !== drop.person.currentRating ? t("rating2", { currentRating: drop.person.currentRating, rating }) : null,
              potentialChanged ? t("potential", { potential: drop.from.potential, potential2: drop.to.potential }) : null].filter(Boolean).join(" · ") || t("noChange")}
          </DialogDescription>
        </DialogHeader>
        {levels.length > 1 ? (
          <LevelCards levels={levels} value={rating} onChange={setRating} label={t("rating")} />
        ) : null}
        <label className="block">
          <span className="type-label text-foreground">{t("whyThisChanges")}</span>
          <Textarea className="mt-2" rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder={t("whatTheGroupAgreedAbout", { first: first ?? "" })} />
        </label>
        <label className="flex items-center gap-2.5 type-body text-foreground">
          <Checkbox checked={discussed} onCheckedChange={(value) => setDiscussed(value === true)} />{t("discussed")}
        </label>
        {error ? <p className="type-body text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t("cancel")}</Button>
          <AsyncButton pending={pending} disabled={!reason.trim()}
            onClick={async () => {
              setPending(true);
              setError(null);
              try { await onConfirm(rating, reason.trim(), discussed); }
              catch (failure) { setError(performanceFailure(failure, t("theMoveCouldntBeSaved")).message); }
              finally { setPending(false); }
            }}>
            <Check className="size-4" aria-hidden />{t("move2")}
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
