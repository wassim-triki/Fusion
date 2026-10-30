"use client";

import { useEffect, useMemo, useState } from "react";
import { Home, Search, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { visibleFusionModules } from "@repo/api";
import { useFusionViewer } from "@repo/api/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
} from "@repo/ds";

/**
 * The top bar's search (D-02's frame): a field that opens with a click or Ctrl/⌘ K. Today it takes the person to the
 * places they can open (Home, their modules, Settings); searching people and records comes next (B-211).
 */
export function TopBarSearch() {
  const t = useTranslations("auth.search");
  const { viewer } = useFusionViewer();
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const places = useMemo(
    () => [
      { href: "/", label: t("home"), icon: <Home /> },
      ...visibleFusionModules(viewer).map((module) => ({ href: module.href, label: module.label, icon: null })),
      { href: "/settings", label: t("settings"), icon: <Settings /> },
    ],
    [viewer, t],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-[300px] items-center gap-2 rounded-control border border-border bg-card px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-lg:w-[200px]"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{t("label")}</span>
        <Kbd className="ms-auto">{mac ? "⌘ K" : "Ctrl K"}</Kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title={t("label")} description={t("placeholder")}>
        <CommandInput placeholder={t("placeholder")} />
        <CommandList>
          <CommandEmpty>{t("nothing")}</CommandEmpty>
          <CommandGroup heading={t("places")}>
            {places.map((place) => (
              <CommandItem
                key={place.href}
                value={place.label}
                onSelect={() => {
                  setOpen(false);
                  window.location.assign(place.href);
                }}
              >
                {place.icon}
                {place.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
