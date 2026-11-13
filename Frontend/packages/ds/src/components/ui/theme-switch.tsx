"use client";

import { useLayoutEffect, useRef } from "react";
import { Moon, Sun } from "../../icons";
import { cn } from "../../lib/utils";

/**
 * Light or dark as one round switch (B-449): the thumb carries the sun or the moon and slides across. The slide is a
 * script animation, not a CSS transition, because the theme change turns transitions off for its own repaint.
 */
export function ThemeSwitch({ dark, onChange, label, className }: {
  dark: boolean;
  onChange: (theme: "light" | "dark") => void;
  label: string;
  className?: string;
}) {
  const thumb = useRef<HTMLSpanElement>(null);
  const was = useRef<{ dark: boolean; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = thumb.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const before = was.current;
    was.current = { dark, left };
    if (!before || before.dark === dark || typeof el.animate !== "function") return;
    el.animate(
      [{ transform: `translateX(${before.left - left}px) rotate(${dark ? -90 : 90}deg)` }, { transform: "none" }],
      { duration: 320, easing: "cubic-bezier(0.3, 0, 0, 1)" },
    );
  }, [dark]);

  const Icon = dark ? Moon : Sun;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={label}
      onClick={() => onChange(dark ? "light" : "dark")}
      className={cn(
        "flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dark ? "justify-end bg-primary" : "justify-start bg-input",
        className,
      )}
    >
      <span ref={thumb} className="grid size-6 place-items-center rounded-full bg-background text-foreground shadow-sm">
        <Icon aria-hidden className="size-3.5" />
      </span>
    </button>
  );
}
