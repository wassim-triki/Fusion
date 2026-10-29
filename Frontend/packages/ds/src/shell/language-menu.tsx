"use client";

import { useEffect, useState } from "react";
import { Check, Languages } from "lucide-react";
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

/** Fusion's languages, each named in itself. */
const LANGUAGES = [
  { value: "en", name: "English", dir: "ltr" },
  { value: "fr", name: "Français", dir: "ltr" },
  { value: "ar", name: "العربية", dir: "rtl" },
] as const;

export type LanguageMenuValue = (typeof LANGUAGES)[number]["value"];

/**
 * The top bar's language menu: the current language's code, and the three languages named in themselves. The caller
 * saves the choice; a failed save says so at the top of the menu.
 */
export function LanguageMenu({
  value,
  onChange,
  saving = false,
  failed = false,
  className,
}: {
  value: LanguageMenuValue;
  onChange: (value: LanguageMenuValue) => void;
  saving?: boolean;
  failed?: boolean;
  className?: string;
}) {
  const t = useTranslations("ds.topBar");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("changeLanguage")}
      disabled={!mounted || saving}
      className={cn(
        "gap-1.5 px-2 text-muted-foreground hover:text-foreground",
        failed && "text-destructive",
        className
      )}
    >
      <Languages aria-hidden className="size-4" />
      <span className="text-xs font-semibold uppercase tracking-wide">
        {value}
      </span>
    </Button>
  );

  // Not rendered on the server, like the theme menu: Radix's ids would differ between server and client.
  if (!mounted) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
        {failed ? (
          <p role="alert" className="px-2 pb-1.5 type-meta text-destructive">
            {t("languageNotSaved")}
          </p>
        ) : null}
        <DropdownMenuSeparator />
        {LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.value}
            onSelect={() => {
              if (language.value !== value) onChange(language.value);
            }}
            className="gap-2"
          >
            <span lang={language.value} dir={language.dir} className="flex-1">
              {language.name}
            </span>
            {language.value === value ? (
              <Check aria-hidden className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
