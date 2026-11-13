"use client";

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { AlertTriangle, Check } from "../../icons";
import { cn } from "../../lib/utils";

export type StatusTone = "done" | "notice";
export type StatusPlace = "bottom" | "top";

/** The pill itself: one short line with its mark, floating over the page. */
export function StatusPill({ tone = "done", place = "bottom", children }: { tone?: StatusTone; place?: StatusPlace; children: string }) {
  const Icon = tone === "done" ? Check : AlertTriangle;
  return (
    <div className={cn("pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-4", place === "bottom" ? "bottom-6" : "top-6")}>
      <div
        role="status"
        aria-live="polite"
        data-tone={tone}
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full bg-foreground py-2 pe-4 ps-3 text-[13px] font-medium text-background shadow-lg",
          "animate-in fade-in zoom-in-95 duration-200",
          place === "bottom" ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
        )}
      >
        <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-full", tone === "done" ? "bg-success text-white" : "bg-warning text-black")}>
          <Icon aria-hidden className="size-3" strokeWidth={2.5} />
        </span>
        <span className="truncate">{children}</span>
      </div>
    </div>
  );
}

let root: Root | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let shown = 0;

/**
 * A quiet confirmation, Fusion-wide (B-456): a small pill centred at the bottom (or top) of the page that says what
 * just happened ("Saved", "Approved") and leaves by itself. One at a time: a new one replaces the last. It mounts
 * itself, so a page calls this and nothing else.
 */
export function showStatus(text: string, options: { tone?: StatusTone; place?: StatusPlace; duration?: number } = {}) {
  if (typeof document === "undefined") return;
  if (!root) {
    const host = document.createElement("div");
    host.dataset.statusPill = "";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  if (timer) clearTimeout(timer);
  const live = root;
  // A new key each time replays the entrance even when the words are the same.
  flushSync(() => live.render(<StatusPill key={++shown} tone={options.tone} place={options.place}>{text}</StatusPill>));
  timer = setTimeout(() => live.render(null), options.duration ?? (options.tone === "notice" ? 4000 : 2200));
}
