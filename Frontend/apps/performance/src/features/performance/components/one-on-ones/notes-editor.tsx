"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, type OneOnOneNotesConflict } from "@repo/api";
import { Button } from "@repo/ds/components/ui/button";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { cn } from "@repo/ds/lib/utils";
import { Lock } from "@repo/ds/icons";
import { useTranslations } from "next-intl";

export const NOTES_MAX = 10_000;
const IDLE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

/**
 * One notes field that saves itself: after a short pause and on blur, against the revision it was opened at. When
 * the other person saved in between, the server refuses; the local text stays, their version is offered, and saving
 * again keeps ours.
 */
export function NotesEditor({
  id,
  label,
  isPrivate = false,
  reading = false,
  compact = false,
  text,
  revision,
  writable,
  save,
}: {
  id: string;
  label: string;
  isPrivate?: boolean;
  /** People-authored record read in the human voice (the shared notes). */
  reading?: boolean;
  /** A field inside a line: the label becomes the placeholder and the field starts short. */
  compact?: boolean;
  text: string;
  revision: number;
  writable: boolean;
  /** Saves and resolves to the revision the server now holds. */
  save: (text: string, expectedRevision: number) => Promise<number>;
}) {
  const t = useTranslations("oneOnOnes.NotesEditor");
  const [value, setValue] = useState(text);
  const [base, setBase] = useState({ text, revision });
  const [state, setState] = useState<SaveState>("idle");
  const [theirs, setTheirs] = useState<OneOnOneNotesConflict | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = value !== base.text;

  // A newer revision from the server (the other person's save, or ours echoed back) replaces the text we hold
  // unless we have unsaved typing of our own.
  useEffect(() => {
    if (revision === base.revision) return;
    if (!dirty) {
      setValue(text);
      setBase({ text, revision });
    }
  }, [text, revision, base.revision, dirty]);

  async function flush(next = value, against = base.revision) {
    if (timer.current) clearTimeout(timer.current);
    if (next === base.text && against === base.revision) return;
    setState("saving");
    try {
      const saved = await save(next, against);
      setBase({ text: next, revision: saved });
      setTheirs(null);
      setState("saved");
    } catch (error) {
      const extra = error instanceof ApiError ? (error.details as { extra?: OneOnOneNotesConflict } | null)?.extra : null;
      if (error instanceof ApiError && error.failureKind === "Stale" && extra) {
        setTheirs(extra);
        setState("conflict");
      } else {
        setState("error");
      }
    }
  }

  function schedule(next: string) {
    setValue(next);
    if (state === "conflict") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(next), IDLE_MS);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className={cn("flex items-center gap-1.5 type-label", isPrivate ? "text-muted-foreground" : "text-foreground", compact && "sr-only")}>
          {isPrivate ? <Lock className="size-3.5" aria-hidden /> : null}
          {label}
        </label>
        <span className="type-meta text-muted-foreground" aria-live="polite">
          {state === "saving" ? t("saving") : state === "saved" && !dirty ? t("saved") : state === "error" ? t("notSaved") : ""}
        </span>
      </div>
      <Textarea
        id={id}
        value={value}
        readOnly={!writable}
        maxLength={NOTES_MAX}
        onChange={(event) => schedule(event.target.value)}
        onBlur={() => {
          if (writable && state !== "conflict") void flush();
        }}
        placeholder={writable ? (compact ? label : isPrivate ? t("onlyYouSeeThis") : t("startWriting")) : undefined}
        voice={reading ? "narrative" : "system"}
        className={cn("resize-y border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent", compact ? "min-h-16" : "min-h-36")}
      />
      {state === "conflict" && theirs ? (
        <div role="alert" className="space-y-3 rounded-control border border-warning/40 p-3">
          <p className="type-body text-foreground">{t("theseNotesChangedWhileYou")}</p>
          <p className="type-body-secondary line-clamp-4 whitespace-pre-wrap text-muted-foreground">{theirs.text || t("empty")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void flush(value, theirs.revision)}>{t("keepMyVersion")}</Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setValue(theirs.text);
                setBase({ text: theirs.text, revision: theirs.revision });
                setTheirs(null);
                setState("idle");
              }}
            >
              {t("useTheirs")}
            </Button>
          </div>
        </div>
      ) : null}
      {state === "error" ? (
        <Button size="sm" variant="outline" className="self-start" onClick={() => void flush()}>
          {t("trySavingAgain")}
        </Button>
      ) : null}
    </div>
  );
}
