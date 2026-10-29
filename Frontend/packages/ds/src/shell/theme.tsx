"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

/**
 * Core + Performance theme provider. Toggles a `.dark` class on <html> via next-themes,
 * driving the @repo/ds `.dark` token block. Apps must set `suppressHydrationWarning` on <html>.
 */
export function ThemeProvider(
  props: Omit<ComponentProps<typeof NextThemesProvider>, "attribute">
) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    />
  );
}

const THEME_OPTIONS = [
  { value: "light", icon: Sun },
  { value: "system", icon: Monitor },
  { value: "dark", icon: Moon },
] as const;

/** The device's appearance choice ("light", "dark" or "system"), shared by every Fusion app through next-themes. */
export { useTheme };

/** The top bar's Light / System / Dark menu, the same device choice as Settings › Preferences. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("ds.topBar");
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ActiveIcon = !mounted
    ? Sun
    : resolvedTheme === "dark"
      ? Moon
      : Sun;

  // The menu is deliberately not rendered on the server. Radix derives the
  // trigger's id from useId, whose value depends on tree position, and under
  // concurrent server rendering that id can differ from the one the client
  // produces — a mismatch React cannot patch up, which leaves the trigger and
  // its menu wired to different ids and breaks the aria-controls relationship.
  //
  // Nothing is lost: the resolved theme is only knowable in the browser, so this
  // control has no meaningful server-rendered state. The placeholder keeps the
  // same size and label so the top bar does not shift when the menu takes over.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("changeTheme")}
        disabled
        className={cn("text-muted-foreground", className)}
      >
        <ActiveIcon className="size-4" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("changeTheme")}
          className={cn("text-muted-foreground hover:text-foreground", className)}
        >
          <ActiveIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel>{t("theme")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => setTheme(option.value)}
              className="gap-2"
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="flex-1">{t(option.value)}</span>
              {active ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
