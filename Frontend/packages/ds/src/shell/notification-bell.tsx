"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  Clock,
  FileText,
  MessageSquare,
  Star,
  Users,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { PersonAvatar } from "../components/ui/person-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Skeleton } from "../components/ui/skeleton";
import { formatDateParts } from "../lib/dates";
import { claimChime, playChime, useChimeUnlock, useTabUnreadCount } from "./notification-arrival";
import { FilterChips } from "../choice/choice";

export type NotificationBellBadge = "praise" | "feedback" | "meeting" | "action" | "plan" | "review" | "reminder" | "team";

export interface NotificationBellItem {
  id: string;
  module: string;
  title: string;
  context?: string | null;
  actorName?: string | null;
  /** Whose face shows, when `photos` has one for them. */
  actorEmployeeId?: string | null;
  /** The small mark on the face: what kind of thing this is. */
  badge?: NotificationBellBadge | null;
  /** ISO timestamp. */
  occurredAt: string;
  readAt?: string | null;
}

export interface NotificationBellModule {
  key: string;
  label: string;
  status: "loading" | "ready" | "error";
}

/** Notifications that arrived since the bell loaded; a new object per arrival. */
export interface NotificationBellArrival {
  seq: number;
  /** Newest first. */
  items: NotificationBellItem[];
}

export interface NotificationBellProps {
  /** Newest first. */
  items: NotificationBellItem[];
  unreadCount: number;
  /** The modules the bell reads, each with its own load state. */
  modules: NotificationBellModule[];
  onOpenItem: (item: NotificationBellItem) => void;
  onMarkAllRead: () => void;
  /** Rings the bell, chimes and shows a pop-up for what just arrived. */
  arrival?: NotificationBellArrival | null;
  /** The person's choices: pop-ups for arrivals, and a chime with each. Both on by default. */
  popups?: boolean;
  sound?: boolean;
  /** Employee id → displayable photo address, for the faces. */
  photos?: ReadonlyMap<string, string>;
  /** Opens Settings › Notifications; the panel offers it in its footer. */
  onOpenSettings?: () => void;
  /** Reference time for relative stamps and day sections; defaults to now. */
  now?: Date;
  className?: string;
}

/** The words of a short stamp, in one language. */
export interface StampWords {
  now: string;
  minutes: (count: number) => string;
  hours: (count: number) => string;
  yesterday: string;
}

const ENGLISH_STAMP: StampWords = {
  now: "now",
  minutes: (count) => `${count}m`,
  hours: (count) => `${count}h`,
  yesterday: "Yesterday",
};

/** Short relative stamp: "now", "12m", "3h", "Yesterday", then a date; in another language with its words and locale. */
export function relativeStamp(iso: string, now: Date, words: StampWords = ENGLISH_STAMP, locale?: string): string {
  const at = new Date(iso);
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return words.now;
  if (minutes < 60) return words.minutes(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24 && at.getDate() === now.getDate()) return words.hours(hours);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return words.yesterday;
  return formatDateParts(
    at,
    {
      day: "numeric",
      month: "short",
      ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    },
    "–",
    locale,
  );
}

export type NotificationDay = "today" | "yesterday" | "earlier";

/** Which day section a notification sits in, by the reader's local calendar day. */
export function notificationDay(iso: string, now: Date): NotificationDay {
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return at.toDateString() === yesterday.toDateString() ? "yesterday" : "earlier";
}

const BADGES: Record<NotificationBellBadge, { icon: ComponentType<{ className?: string }>; tone: string }> = {
  praise: { icon: Star, tone: "text-primary" },
  feedback: { icon: MessageSquare, tone: "text-identity-1" },
  meeting: { icon: CalendarDays, tone: "text-identity-3" },
  action: { icon: CircleCheck, tone: "text-identity-3" },
  plan: { icon: FileText, tone: "text-identity-4" },
  review: { icon: ClipboardCheck, tone: "text-identity-2" },
  reminder: { icon: Clock, tone: "text-warning" },
  team: { icon: Users, tone: "text-identity-2" },
};

/** The sender's face (photo or initials) with the kind's badge on its corner; the module's letter for Fusion's own. */
function NotificationFace({
  item,
  photos,
  moduleLabel,
  badged = true,
  className,
}: {
  item: NotificationBellItem;
  photos?: ReadonlyMap<string, string>;
  moduleLabel: string;
  badged?: boolean;
  className?: string;
}) {
  const badge = badged && item.badge ? BADGES[item.badge] : null;
  const photo = item.actorEmployeeId ? (photos?.get(item.actorEmployeeId) ?? null) : null;
  return (
    <span className={cn("relative shrink-0", className)} aria-hidden>
      {item.actorName ? (
        <PersonAvatar name={item.actorName} photo={photo} size="sm" />
      ) : (
        <span className="grid size-8 place-items-center rounded-full bg-muted type-mark text-muted-foreground">
          {moduleLabel.slice(0, 1)}
        </span>
      )}
      {badge ? (
        <span className="absolute -bottom-1 -end-1 grid size-4.5 place-items-center rounded-full bg-popover ring-2 ring-popover">
          <badge.icon className={cn("size-3", badge.tone)} />
        </span>
      ) : null}
    </span>
  );
}

const POPUP_MS = 6_000;

/**
 * The pop-up for what just arrived: one notification with its face and an Open button, or several as one pop-up with
 * stacked faces and Show. It leaves after six seconds, waiting while the pointer or focus is on it.
 */
function ArrivalPopup({
  arrival,
  photos,
  labels,
  onOpen,
  onShow,
  onDismiss,
}: {
  arrival: NotificationBellArrival;
  photos?: ReadonlyMap<string, string>;
  labels: Map<string, string>;
  onOpen: (item: NotificationBellItem) => void;
  onShow: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("ds.notifications");
  const locale = useLocale();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDismiss, POPUP_MS);
    return () => clearTimeout(timer);
  }, [held, onDismiss, arrival.seq]);

  const single = arrival.items.length === 1 ? arrival.items[0]! : null;
  const names = [...new Set(arrival.items.map((item) => item.actorName).filter((name): name is string => Boolean(name)))];
  return createPortal(
    <div
      role="status"
      lang={locale}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="fixed end-4 bottom-4 z-50 flex w-90 max-w-[calc(100vw-2rem)] animate-in items-start gap-3 rounded-surface border border-border bg-popover p-3 shadow-overlay fade-in-0 slide-in-from-bottom-4 zoom-in-95 duration-(--duration-reveal)"
    >
      {single ? (
        <NotificationFace item={single} photos={photos} moduleLabel={labels.get(single.module) ?? single.module} />
      ) : (
        <span className="flex shrink-0" aria-hidden>
          {arrival.items.slice(0, 3).map((item, index) => (
            <span key={`${item.module}:${item.id}`} className={cn("rounded-full ring-2 ring-popover", index > 0 && "-ms-2.5")}>
              <NotificationFace item={item} photos={photos} moduleLabel={labels.get(item.module) ?? item.module} badged={false} />
            </span>
          ))}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="type-body text-foreground">{single ? single.title : t("popup.many", { count: arrival.items.length })}</p>
        {single?.context ? (
          <p className="truncate type-meta text-muted-foreground">{single.context}</p>
        ) : !single && names.length > 0 ? (
          <p className="truncate type-meta text-muted-foreground">
            {new Intl.ListFormat(locale, { type: "conjunction" }).format(names)}
          </p>
        ) : null}
        <div className="mt-2">
          <Button size="xs" onClick={() => (single ? onOpen(single) : onShow())}>
            {single ? t("popup.open") : t("popup.show")}
          </Button>
        </div>
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={t("popup.dismiss")} className="text-muted-foreground" onClick={onDismiss}>
        <X className="size-4" aria-hidden />
      </Button>
    </div>,
    document.body,
  );
}

/**
 * The Fusion notification bell: the unread mark on the trigger and a panel listing what happened, newest first and
 * by day, across the modules the person uses. When something arrives it swings, chimes once across open tabs and
 * shows a pop-up in the tab in front; the tab's title and icon carry the unread count. Each app connects it to
 * `useFusionNotifications` and decides how an opened entry navigates.
 */
export function NotificationBell({
  items,
  unreadCount,
  modules,
  onOpenItem,
  onMarkAllRead,
  arrival = null,
  popups = true,
  sound = true,
  photos,
  onOpenSettings,
  now,
  className,
}: NotificationBellProps) {
  const t = useTranslations("ds.notifications");
  const locale = useLocale();
  const stampWords: StampWords = {
    now: t("stamp.now"),
    minutes: (count) => t("stamp.minutes", { count }),
    hours: (count) => t("stamp.hours", { count }),
    yesterday: t("stamp.yesterday"),
  };
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [popup, setPopup] = useState<NotificationBellArrival | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const handled = useRef(0);
  const reference = now ?? new Date();
  const labels = new Map(modules.map((module) => [module.key, module.label]));
  const visible = filter ? items.filter((item) => item.module === filter) : items;
  const loading = items.length === 0 && modules.some((module) => module.status === "loading");
  const failed = modules.filter((module) => module.status === "error" && (!filter || module.key === filter));
  const label = t("trigger", { count: unreadCount });

  useTabUnreadCount(unreadCount);
  useChimeUnlock(sound);

  useEffect(() => {
    if (!arrival || arrival.seq === handled.current) return;
    handled.current = arrival.seq;
    setFresh((current) => new Set([...current, ...arrival.items.map((item) => `${item.module}:${item.id}`)]));
    if (popups && document.visibilityState === "visible") setPopup(arrival);
    if (sound) {
      const first = arrival.items[0]!;
      void claimChime(`${first.module}:${first.id}`).then((mine) => {
        if (mine) playChime();
      });
    }
  }, [arrival, popups, sound]);

  const openPanel = (next: boolean) => {
    setOpen(next);
    // Rows glow once, the first time the panel shows them.
    if (!next) setFresh(new Set());
  };

  let lastDay: NotificationDay | null = null;

  return (
    <>
      <Popover open={open} onOpenChange={openPanel}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label} className={cn("relative text-muted-foreground", className)}>
            <Bell
              key={arrival?.seq ?? 0}
              className={cn("size-4 origin-[50%_8%]", arrival && "animate-bell-swing")}
              aria-hidden
            />
            {unreadCount > 0 ? (
              <span
                data-testid="notification-unread-mark"
                className="absolute top-1 inset-e-1 size-2 rounded-full bg-primary ring-2 ring-background"
              >
                {arrival ? (
                  <span
                    key={arrival.seq}
                    className="absolute inset-0 animate-bell-pulse rounded-full border-2 border-primary opacity-0"
                  />
                ) : null}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          lang={locale}
          align="end"
          sideOffset={8}
          className="grid max-h-[min(36rem,80vh)] w-96 max-w-[calc(100vw-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 p-0"
        >
          <div className="flex h-12 items-center justify-between gap-3 border-b border-border px-4">
            <h2 className="type-panel-title text-foreground">{t("title")}</h2>
            {unreadCount > 0 ? (
              <Button variant="ghost" size="xs" onClick={onMarkAllRead}>
                {t("markAllRead")}
              </Button>
            ) : null}
          </div>

          {modules.length > 1 ? (
            <FilterChips
              type="single"
              label={t("filterByModule")}
              className="border-b border-border px-3 py-2"
              value={filter ?? "all"}
              onChange={(next: string) => setFilter(next === "all" ? null : next)}
              options={[{ value: "all", label: t("all") }, ...modules.map((module) => ({ value: module.key as string, label: module.label }))]}
            />
          ) : (
            <div />
          )}

          <div className="min-h-0 overflow-y-auto p-1.5">
            {loading ? (
              <div aria-busy className="space-y-1 p-1">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3 px-2 py-2.5">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visible.length === 0 && failed.length === 0 ? (
              <p className="px-3 py-6 text-center type-body-secondary text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const unread = !item.readAt;
                  const key = `${item.module}:${item.id}`;
                  const day = notificationDay(item.occurredAt, reference);
                  const heading = day !== lastDay ? day : null;
                  lastDay = day;
                  return (
                    <li key={key}>
                      {heading ? (
                        <h3 className="px-2.5 pt-2.5 pb-1 type-meta text-muted-foreground">{t(heading)}</h3>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          openPanel(false);
                          onOpenItem(item);
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-inset px-2.5 py-2.5 text-start transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                          fresh.has(key) && "animate-notification-fresh",
                        )}
                      >
                        <NotificationFace
                          item={item}
                          photos={photos}
                          moduleLabel={labels.get(item.module) ?? item.module}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block type-body", unread ? "text-foreground" : "text-muted-foreground")}>
                            {item.title}
                          </span>
                          {item.context ? (
                            <span className="block truncate type-meta text-muted-foreground">{item.context}</span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 pt-0.5">
                          <time dateTime={item.occurredAt} className="type-meta text-muted-foreground">
                            {relativeStamp(item.occurredAt, reference, stampWords, locale)}
                          </time>
                          {unread ? (
                            <span aria-label={t("unread")} className="size-2 rounded-full bg-primary" />
                          ) : (
                            <span className="size-2" />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {failed.map((module) => (
              <p key={module.key} role="status" className="px-3 py-2 type-meta text-muted-foreground">
                {t("moduleFailed", { module: module.label })}
              </p>
            ))}
          </div>

          {onOpenSettings ? (
            <div className="flex justify-center border-t border-border p-1.5">
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => {
                  openPanel(false);
                  onOpenSettings();
                }}
              >
                {t("settings")}
              </Button>
            </div>
          ) : (
            <div />
          )}
        </PopoverContent>
      </Popover>

      {popup ? (
        <ArrivalPopup
          arrival={popup}
          photos={photos}
          labels={labels}
          onDismiss={() => setPopup(null)}
          onOpen={(item) => {
            setPopup(null);
            onOpenItem(item);
          }}
          onShow={() => {
            setPopup(null);
            openPanel(true);
          }}
        />
      ) : null}
    </>
  );
}

