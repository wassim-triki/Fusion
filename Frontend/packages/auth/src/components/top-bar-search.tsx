"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CalendarRange,
  CornerDownLeft,
  Flag,
  GitPullRequestArrow,
  Home,
  MapPin,
  MessageSquarePlus,
  MessagesSquare,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Target,
  UserPlus,
  UserRound,
  Users,
  Workflow,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { visibleFusionModules, type CoreSearchPersonDto } from "@repo/api";
import { useFusionSearch } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { Kbd, PersonAvatar, cn } from "@repo/ds";
import { FilterChips } from "@repo/ds/choice";
import { onOpenTopBarSearch } from "@repo/ds/shell";
import { useAuth } from "../auth-context";
import {
  GO_TO,
  ICON_HUE,
  SEARCH_HUES,
  buildResults,
  firstName,
  highlight,
  pageItem,
  personActions,
  readRecent,
  readVerb,
  recentItem,
  recentStorageKey,
  rememberRecent,
  searchPages,
  searchRights,
  type PersonAction,
  type RecentItem,
  type SearchGroup,
  type SearchIcon,
  type SearchItem,
  type SearchScope,
  type SearchText,
  type Verb,
} from "./top-bar-search-model";

const ICONS: Record<SearchIcon, LucideIcon> = {
  home: Home,
  people: Users,
  chart: Workflow,
  user: UserRound,
  team: Users,
  place: MapPin,
  job: Briefcase,
  goal: Target,
  oneOnOne: MessagesSquare,
  praise: Star,
  feedback: MessageSquarePlus,
  review: ClipboardCheck,
  report: BarChart3,
  hire: UserPlus,
  settings: Settings,
  roles: ShieldCheck,
  cycle: CalendarRange,
  changes: GitPullRequestArrow,
  change: Flag,
};

const ACTION_ICONS: Record<PersonAction["id"], LucideIcon> = {
  orgChart: Workflow,
  praise: Star,
  feedback: MessageSquarePlus,
  oneOnOne: CalendarDays,
  change: Flag,
};

const SETTLE_MS = 150;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const hueStyle = (hue: string | undefined) => (hue ? ({ "--h": hue } as CSSProperties) : undefined);

/** The matched part in bold. */
function Marked({ text, query }: { text: string; query: string }) {
  const parts = highlight(text, query);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <b className="font-semibold">{parts[1]}</b>
      {parts[2]}
    </>
  );
}

/**
 * The top bar's search (B-211): the field widens in place and the results hang under it, aligned to its edges.
 * People first, then teams and places, jobs, Performance and pages, each only as far as the viewer's rights go.
 * Core HR and Performance answer in parallel; a module that is down just loses its group. Ctrl/⌘ K anywhere.
 */
export function TopBarSearch() {
  const t = useTranslations("auth.search");
  const { viewer } = useFusionViewer();
  const { user } = useAuth();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [settled, setSettled] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [active, setActive] = useState(0);
  const [act, setAct] = useState(-1);
  const [pointed, setPointed] = useState<number | null>(null);
  const [mac, setMac] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const modules = visibleFusionModules(viewer);
  const coreEntitled = modules.some((module) => module.key === "core");
  const storageKey = viewer?.tenantId ? recentStorageKey(viewer.tenantId, viewer.userId) : null;

  const verbWords = useMemo<Record<Verb, string>>(
    () => ({ praise: t("verbs.praise"), feedback: t("verbs.feedback"), oneOnOne: t("verbs.oneOnOne"), hire: t("verbs.hire") }),
    [t],
  );
  const { verb, rest } = readVerb(settled, verbWords);
  const serverQuery = verb ? rest : settled.trim();
  const performanceRight = searchRights(user, coreEntitled, false).performance;
  const search = useFusionSearch(serverQuery, { open, core: coreEntitled, performance: performanceRight });
  const core = search.core.error ? undefined : search.core.data;
  const performance = search.performance.error || !serverQuery ? undefined : search.performance.data;
  const orgChart = core?.orgChart ?? false;
  const rights = useMemo(() => searchRights(user, coreEntitled, orgChart), [user, coreEntitled, orgChart]);
  const pages = useMemo(() => searchPages(user, rights), [user, rights]);

  const text = useMemo<SearchText>(() => ({
    page: (id) => ({ label: t(`pages.${id}.label`), path: t(`pages.${id}.path`), keywords: t(`pages.${id}.keywords`) }),
    action: (id, name) => t(`actions.${id}`, { name: name ?? "" }),
    sub: {
      team: (count) => t("sub.team", { count }),
      place: (count) => t("sub.place", { count }),
      job: (count) => t("sub.job", { count }),
      objective: (objectiveScope, yours) =>
        yours ? t("sub.yourObjective") : objectiveScope === "Company" ? t("sub.companyObjective") : objectiveScope === "OrgUnit" ? t("sub.teamObjective") : t("sub.objective"),
      oneOnOne: t("sub.oneOnOne"),
      reviewRound: t("sub.reviewRound"),
      cycle: t("sub.cycle"),
      report: t("sub.report"),
      chooseWho: t("sub.chooseWho"),
    },
    oneOnOneWith: (name) => t("oneOnOneWith", { name }),
    seeAll: (count, query) => t("seeAll", { count, q: query }),
  }), [t]);

  // ── Results ──
  const typed = settled.trim().length > 0;
  const results = useMemo(
    () => (typed ? buildResults(settled, scope, core, performance, pages, rights, verbWords, text) : null),
    [typed, settled, scope, core, performance, pages, rights, verbWords, text],
  );
  const groups = useMemo<SearchGroup[]>(() => {
    if (results) return results.groups;
    const before: SearchGroup[] = [];
    const yours = core && !serverQuery ? core.people : [];
    if (yours.length) before.push({ id: "yourPeople", items: yours.map((person) => ({ kind: "person", key: `face:${person.employeeKey}`, person, href: `/core/people/${encodeURIComponent(person.employeeKey)}` })) });
    if (recent.length) before.push({ id: "recent", items: recent.map(recentItem) });
    const go = pages.filter((page) => GO_TO.includes(page.id)).map((page) => pageItem(page, text));
    if (go.length) before.push({ id: "goTo", items: go });
    return before;
  }, [results, core, serverQuery, recent, pages, text]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const current = flat[Math.min(active, flat.length - 1)];
  const currentActions = current?.kind === "person" && groups.find((g) => g.items.includes(current))?.id !== "yourPeople"
    ? personActions(current.person, rights)
    : [];

  // ── Opening, closing, going ──
  const openSearch = useCallback(() => {
    setOpen(true);
    setRecent(storageKey ? readRecent(browserStorage(), storageKey) : []);
  }, [storageKey]);
  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setSettled("");
    setScope("all");
    setActive(0);
    setAct(-1);
    inputRef.current?.blur();
  }, []);
  const go = (href: string, item?: SearchItem) => {
    if (item && storageKey) rememberRecent(browserStorage(), storageKey, item);
    close();
    window.location.assign(href);
  };

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.activeElement === inputRef.current) close();
        else {
          openSearch();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const stopListening = onOpenTopBarSearch(() => {
      openSearch();
      inputRef.current?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      stopListening();
    };
  }, [openSearch, close]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(q), q.trim() ? SETTLE_MS : 0);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (active >= flat.length && flat.length > 0) setActive(flat.length - 1);
  }, [active, flat.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const move = (index: number) => {
    setActive(index);
    setAct(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(Math.min(flat.length - 1, active + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(Math.max(0, active - 1));
    } else if (event.key === "ArrowRight" && currentActions.length && (act >= 0 || event.currentTarget.selectionStart === q.length)) {
      event.preventDefault();
      setAct(Math.min(currentActions.length - 1, act + 1));
    } else if (event.key === "ArrowLeft" && act >= 0) {
      event.preventDefault();
      setAct(act - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = act >= 0 ? currentActions[act] : undefined;
      if (action) go(action.href);
      else if (current) go(current.href, current);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  // ── Drawing ──
  const named = act >= 0 ? currentActions[act] : pointed !== null ? currentActions[pointed] : undefined;
  const counts = results?.counts;
  const scopes: SearchScope[] = counts ? (["all", "people", "teams", "performance", "pages"] as const).filter((s) => s === "all" || counts[s] > 0) : [];
  const loading = (search.core.isLoading || search.performance.isLoading) && flat.length === 0;
  let index = 0;

  const relationChip = (person: CoreSearchPersonDto) =>
    person.relation ? (
      <span className={cn("whitespace-nowrap rounded-full bg-inlay px-2 py-px text-[0.71875rem] font-medium", person.relation === "Self" ? "text-muted-foreground" : "text-foreground")}>
        {t(`relation.${person.relation}`)}
      </span>
    ) : null;

  const row = (item: SearchItem, child: (on: boolean) => ReactNode) => {
    const i = index++;
    const on = i === active;
    return (
      <div
        key={item.key}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={on}
        data-index={i}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (active !== i) move(i);
        }}
        onClick={() => go(item.href, item)}
        className={cn("flex min-h-10 cursor-pointer items-center gap-3 rounded-inset px-1.5 py-[0.4375rem]", on && "bg-accent")}
      >
        {child(on)}
      </div>
    );
  };

  const personRow = (item: Extract<SearchItem, { kind: "person" }>) =>
    row(item, (on) => {
      const person = item.person;
      const actions = on ? currentActions : [];
      const line = on && named ? named : undefined;
      return (
        <>
          <PersonAvatar name={person.displayName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm"><Marked text={person.displayName} query={serverQuery} /></div>
            <div
              className={cn("truncate text-[0.78125rem] transition-colors duration-[var(--duration-fast)]", line ? "text-[color:var(--h)]" : "text-muted-foreground")}
              style={line ? hueStyle(SEARCH_HUES[line.hue]) : undefined}
            >
              {line ? t(`actions.${line.id}`, { name: firstName(person.displayName) }) : <Marked text={[person.jobTitle, person.unitName].filter(Boolean).join(", ")} query={serverQuery} />}
            </div>
          </div>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            {relationChip(person)}
            {person.place && !actions.length ? <span className="text-xs text-muted-foreground/80">{person.place}</span> : null}
            {actions.length ? (
              <div className="flex gap-0.5 animate-in fade-in-0 slide-in-from-right-1 duration-[var(--duration-overlay)]">
                {actions.map((action, a) => {
                  const Icon = ACTION_ICONS[action.id];
                  const lit = act === a || pointed === a;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      tabIndex={-1}
                      aria-label={t(`actions.${action.id}`, { name: firstName(person.displayName) })}
                      style={hueStyle(SEARCH_HUES[action.hue])}
                      onMouseEnter={() => setPointed(a)}
                      onMouseLeave={() => setPointed(null)}
                      onClick={(event) => {
                        event.stopPropagation();
                        go(action.href);
                      }}
                      className={cn(
                        "grid size-[1.875rem] place-items-center rounded-detail text-muted-foreground transition-colors duration-[var(--duration-fast)]",
                        lit && "bg-[color:color-mix(in_oklab,var(--h)_16%,transparent)] text-[color:var(--h)]",
                        act === a && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--h)_45%,transparent)]",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </button>
                  );
                })}
              </div>
            ) : null}
            <CornerDownLeft aria-hidden className={cn("size-4 text-muted-foreground", on ? "opacity-100" : "opacity-0")} />
          </div>
        </>
      );
    });

  const thingRow = (item: Exclude<SearchItem, { kind: "person" }>) =>
    row(item, (on) => {
      const icon: SearchIcon = item.kind === "allPeople" ? "people" : item.icon;
      const Icon = ICONS[icon];
      const hue = item.kind === "thing" ? ICON_HUE[icon] : undefined;
      return (
        <>
          {item.kind === "thing" && item.face ? (
            <PersonAvatar name={item.face.name} size="sm" />
          ) : (
            <span
              style={hueStyle(hue ? SEARCH_HUES[hue] : undefined)}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-detail bg-inlay text-muted-foreground",
                hue && "bg-[color:color-mix(in_oklab,var(--h)_15%,var(--inlay))] text-[color:var(--h)]",
                hue && on && "bg-[color:color-mix(in_oklab,var(--h)_22%,var(--inlay))]",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className={cn("truncate text-sm", item.kind === "allPeople" && "text-muted-foreground")}>
              {item.kind === "allPeople" ? item.label : <Marked text={item.label} query={serverQuery || settled} />}
            </div>
            {item.kind === "thing" ? <div className="truncate text-[0.78125rem] text-muted-foreground">{item.sub}</div> : null}
          </div>
          <CornerDownLeft aria-hidden className={cn("ms-auto size-4 shrink-0 text-muted-foreground", on ? "opacity-100" : "opacity-0")} />
        </>
      );
    });

  const faces = (group: SearchGroup) => (
    <div className="flex gap-1 pb-1.5">
      {group.items.map((item) => {
        if (item.kind !== "person") return null;
        const i = index++;
        const person = item.person;
        return (
          <div
            key={item.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            aria-label={person.displayName}
            data-index={i}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => {
              if (active !== i) move(i);
            }}
            onClick={() => go(item.href, item)}
            className={cn("flex w-[5.375rem] cursor-pointer flex-col items-center gap-1.5 rounded-inset px-1 pb-2 pt-2.5", i === active && "bg-accent")}
          >
            <PersonAvatar name={person.displayName} size="lg" />
            <span className="max-w-full truncate text-center text-[0.78125rem] leading-tight">{firstName(person.displayName)}</span>
            <span className="max-w-full truncate text-center text-[0.6875rem] text-muted-foreground">
              {person.relation ? t(`relation.${person.relation}`) : person.jobTitle}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={wrapRef} className="relative">
      <label
        className={cn(
          "flex h-8 cursor-text items-center gap-2 rounded-control border bg-card px-2.5 text-sm text-muted-foreground transition-[width,border-color] duration-[var(--duration-normal)] ease-emphasized",
          open
            ? "w-[40rem] border-primary/30 max-xl:w-[min(40rem,calc(100vw-22rem))]"
            : "w-[300px] border-border hover:text-foreground max-lg:w-[200px]",
        )}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t("label")}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && current ? `${listId}-${Math.min(active, flat.length - 1)}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("placeholder")}
          value={q}
          onFocus={openSearch}
          onChange={(event) => {
            setQ(event.target.value);
            setScope("all");
            move(0);
            if (!open) openSearch();
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Kbd className="ms-auto">{mac ? "⌘ K" : "Ctrl K"}</Kbd>
      </label>

      {open ? (
        <div className="absolute start-0 top-full z-50 mt-1.5 flex w-full flex-col overflow-hidden rounded-menu border border-border bg-popover text-popover-foreground shadow-overlay animate-in fade-in-0 slide-in-from-top-1 duration-[var(--duration-overlay)] ease-emphasized">
          {scopes.length > 1 ? (
            <FilterChips
              type="single"
              overlay
              label={t("scopeLabel")}
              value={scope}
              onChange={(next) => {
                setScope(next);
                move(0);
                inputRef.current?.focus();
              }}
              options={scopes.map((s) => ({ value: s, label: t(`scopes.${s}`), count: s === "all" ? undefined : counts![s] }))}
              className="px-2.5 pb-0.5 pt-2.5"
            />
          ) : null}

          <div ref={listRef} id={listId} role="listbox" aria-label={t("label")} className="max-h-[32.5rem] overflow-auto px-1 pb-1.5 pt-1">
            {flat.length === 0 ? (
              loading ? (
                <div className="px-5 py-9 text-center text-sm text-muted-foreground">{t("searching")}</div>
              ) : typed ? (
                <div className="px-5 pb-10 pt-9 text-center text-sm text-muted-foreground">
                  {t.rich("nothing", { q: settled.trim(), b: (chunks) => <b className="font-medium text-foreground">{chunks}</b> })}
                  <div className="mt-1 text-[0.78125rem]">{t("nothingHint")}</div>
                </div>
              ) : null
            ) : (
              groups.map((group) => (
                <div key={group.id} role="group" aria-label={t(`groups.${group.id}`)}>
                  <div className="flex justify-between px-1.5 pb-1 pt-3 text-xs text-muted-foreground">
                    <span>{t(`groups.${group.id}`)}</span>
                    {group.id === "people" && core && core.peopleTotal > group.items.filter((x) => x.kind === "person").length ? (
                      <span>{t("peopleCount", { count: core.peopleTotal })}</span>
                    ) : null}
                  </div>
                  {group.id === "yourPeople"
                    ? faces(group)
                    : group.items.map((item) => (item.kind === "person" ? personRow(item) : thingRow(item)))}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t("keys.move")}</span>
            <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> {t("keys.open")}</span>
            {currentActions.length ? <span className="inline-flex items-center gap-1.5"><Kbd>→</Kbd> {t("keys.actions")}</span> : null}
            <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd> {t("keys.close")}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
