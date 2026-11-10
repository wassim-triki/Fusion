"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFusionNavigation, useRefreshFusionAttention } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { Bell, Check, Globe, LogOut, Moon, Sun, User } from "@repo/ds/icons";
import { PersonAvatar } from "@repo/ds/components/ui/person-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ds/components/ui/dropdown-menu";
import { Skeleton } from "@repo/ds/components/ui/skeleton";
import { Segmented } from "@repo/ds/choice";
import { useTheme } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";
import { useAuth } from "../auth-context";
import { useLanguage } from "../language";

/** Fusion's languages, each named in itself. */
const LANGUAGES = [
  { value: "en", name: "English" },
  { value: "fr", name: "Français" },
  { value: "ar", name: "العربية" },
] as const;

/**
 * Your menu (D-82): your face top right, opening your profile, notifications, language, appearance and sign out. The
 * same choices as Settings › Preferences; a language change refreshes the bell and work, which the servers word in
 * that language.
 */
export function YourMenu() {
  const t = useTranslations("auth.menu");
  const { logout } = useAuth();
  const { viewer, isLoading } = useFusionViewer();
  const navigation = useFusionNavigation(null, []);
  const [language, setLanguage, saving] = useLanguage();
  const refreshAttention = useRefreshFusionAttention();
  const [failed, setFailed] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { name, photo, detail, detailPending } = navigation.person;
  const face = <PersonAvatar name={name ?? ""} photo={photo} size="sm" />;
  if (isLoading || !name) {
    return <Skeleton aria-label={t("open")} className="size-8 rounded-full" />;
  }
  // Like the language and theme menus, not rendered on the server: Radix's ids would differ between server and client.
  if (!mounted) {
    return (
      <button type="button" aria-label={t("open")} disabled className="rounded-full">
        {face}
      </button>
    );
  }
  const dark = (resolvedTheme ?? theme) === "dark";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("open")}
        className="rounded-full outline-none ring-offset-background transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:ring-2 data-[state=open]:ring-ring"
      >
        {face}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-72 p-2">
        <div className="flex items-center gap-3 px-2 pt-1.5 pb-2.5">
          <PersonAvatar name={name} photo={photo} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{name}</span>
            {detailPending ? <Skeleton className="mt-1 h-2.5 w-20" /> : detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
          </span>
        </div>
        <DropdownMenuSeparator />
        {viewer?.canOpenOwnProfile ? (
          <DropdownMenuItem asChild>
            <a href="/core/profile" className="flex items-center gap-2.5">
              <User className="size-4 text-muted-foreground" />
              {t("profile")}
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href="/settings/notifications" className="flex items-center gap-2.5">
            <Bell className="size-4 text-muted-foreground" />
            {t("notifications")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={saving} className="gap-2.5">
            <Globe className="size-4 text-muted-foreground" />
            <span className="flex-1">{t("language")}</span>
            <span className={cn("text-xs text-muted-foreground", failed && "text-destructive")}>
              {failed ? t("languageFailed") : LANGUAGES.find((option) => option.value === language)?.name}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {LANGUAGES.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className="gap-2"
                onSelect={() => {
                  if (option.value === language) return;
                  setFailed(false);
                  setLanguage(option.value).then(
                    () => void refreshAttention(),
                    () => setFailed(true),
                  );
                }}
              >
                <span lang={option.value} className="flex-1">
                  {option.name}
                </span>
                {option.value === language ? <Check aria-hidden className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <div className="flex items-center gap-2.5 rounded-inset px-2 py-1.5 text-sm">
          {dark ? <Moon className="size-4 text-muted-foreground" /> : <Sun className="size-4 text-muted-foreground" />}
          <span className="flex-1">{t("appearance")}</span>
          <Segmented
            size="sm"
            label={t("appearance")}
            value={theme === "light" || theme === "dark" ? theme : null}
            onChange={setTheme}
            options={[
              { value: "light", label: t("light") },
              { value: "dark", label: t("dark") },
            ]}
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2.5"
          onSelect={async () => {
            await logout();
            window.location.href = "/auth/signin";
          }}
        >
          <LogOut className="size-4 text-muted-foreground" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
