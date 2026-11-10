"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Home, LayoutGrid, RotateCw, Search } from "@repo/ds/icons";
import { useTranslations } from "next-intl";
import {
  pageFailureKind,
  serviceAnswers,
  visibleFusionModules,
  type CompanyAdministratorContactDto,
  type PageFailureKind,
} from "@repo/api";
import { useCompanyAdministrators } from "@repo/api/query";
import { useFusionViewer } from "@repo/api/react";
import { Avatar, AvatarFallback, Button, Kbd, Spinner, cn } from "@repo/ds";
import { PageState, ReferenceCode, openTopBarSearch } from "@repo/ds/shell";

/** The app a failure page sits in. Colleague modules keep their own pages. */
export type FailurePageApp = "core" | "performance" | "platform" | "shell";

const RETRY_SECONDS = 12;

const APPS: Record<FailurePageApp, { href: string; name: string; service: string; search: boolean }> = {
  core: { href: "/core", name: "Core HR", service: "/api/corehr/health", search: true },
  performance: { href: "/performance", name: "Performance", service: "/api/performance/health", search: true },
  platform: { href: "/platform", name: "Platform", service: "/api/identity/health", search: false },
  shell: { href: "/", name: "Fusion", service: "/api/identity/health", search: true },
};

/** Failure pages only show after a request or render failed in the browser, so the address is there to read. */
function currentApp(): FailurePageApp {
  const first = window.location.pathname.split("/")[1];
  if (first === "core" || first === "performance" || first === "platform") return first;
  return "shell";
}

/** The way back that always opens: a full load, so nothing of the failed page comes along. */
function OverviewLink({ app, variant = "default" }: { app: FailurePageApp; variant?: "default" | "outline" }) {
  const t = useTranslations("ds.states");
  return (
    <Button asChild variant={variant}>
      <a href={APPS[app].href}>
        {app === "shell" ? <Home aria-hidden /> : <LayoutGrid aria-hidden />}
        {app === "shell" ? t("goHome") : t("goToOverview")}
      </a>
    </Button>
  );
}

function RetryButton({
  onRetry,
  variant = "default",
  size = "default",
  link = false,
}: {
  onRetry: () => unknown;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  link?: boolean;
}) {
  const t = useTranslations("ds.states");
  const [trying, setTrying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const retry = async () => {
    setTrying(true);
    try {
      await onRetry();
    } finally {
      if (mounted.current) setTrying(false);
    }
  };

  if (link) {
    return (
      <button
        type="button"
        disabled={trying}
        onClick={() => void retry()}
        className="text-sm font-medium text-primary-ink hover:underline disabled:opacity-60"
      >
        {trying ? t("trying") : t("tryAgain")}
      </button>
    );
  }

  return (
    <Button type="button" variant={variant} size={size} disabled={trying} onClick={() => void retry()}>
      {trying ? <Spinner aria-hidden /> : <RotateCw aria-hidden />}
      {trying ? t("trying") : t("tryAgain")}
    </Button>
  );
}

/**
 * Asks whether the service answers every {@link RETRY_SECONDS} seconds, and as soon as the browser reconnects; only
 * then does the page refresh. Refreshing straight away would flash the page's loading state on every try of an outage.
 */
function useComesBack(app: FailurePageApp, onRetry: () => unknown): number {
  const [seconds, setSeconds] = useState(RETRY_SECONDS);
  const retry = useRef(onRetry);
  retry.current = onRetry;

  useEffect(() => {
    let left = RETRY_SECONDS;
    let stopped = false;
    const check = async () => {
      if ((await serviceAnswers(APPS[app].service)) && !stopped) retry.current();
    };
    const tick = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        left = RETRY_SECONDS;
        void check();
      }
      setSeconds(left);
    }, 1000);
    const reconnected = () => void check();
    window.addEventListener("online", reconnected);
    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.removeEventListener("online", reconnected);
    };
  }, [app]);

  return seconds;
}

function Ticking({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span aria-hidden className="size-[7px] animate-pulse rounded-full bg-primary-ink" />
      {children}
    </span>
  );
}

function ModuleDown({ headingLevel, onRetry }: { headingLevel?: 1 | 2 | 3; onRetry: () => unknown }) {
  const t = useTranslations("ds.states");
  const app = currentApp();
  const seconds = useComesBack(app, onRetry);
  const { viewer } = useFusionViewer();
  // Only a module this company has on, and never the one that's down.
  const elsewhere = visibleFusionModules(viewer).find((module) => module.href !== APPS[app].href);

  return (
    <PageState
      drawing="down"
      headingLevel={headingLevel}
      title={t("downTitle", { module: APPS[app].name })}
      description={t("downBody")}
      actions={
        <>
          <RetryButton onRetry={onRetry} />
          {elsewhere ? (
            <Button asChild variant="outline">
              <a href={elsewhere.href}>{t("openModule", { module: elsewhere.label })}</a>
            </Button>
          ) : null}
        </>
      }
      footer={<Ticking>{t("tryingIn", { seconds })}</Ticking>}
    />
  );
}

function Offline({ headingLevel, onRetry }: { headingLevel?: 1 | 2 | 3; onRetry: () => unknown }) {
  const t = useTranslations("ds.states");
  const seconds = useComesBack(currentApp(), onRetry);
  return (
    <PageState
      drawing="offline"
      headingLevel={headingLevel}
      title={t("offlineTitle")}
      description={t("offlineBody")}
      actions={<RetryButton onRetry={onRetry} variant="outline" />}
      footer={<Ticking>{t("checkingIn", { seconds })}</Ticking>}
    />
  );
}

export interface PageFailureProps {
  error: unknown;
  onRetry?: () => unknown;
  /** Where the list a record belongs to lives, for a link that's gone. */
  back?: { href: string; label: string };
  /** A card with room or a slim row keeps the page around it; `title` says what didn't load. */
  size?: "page" | "card" | "row";
  title?: string;
  /** Next.js's code for a server error; shown only when there is one. */
  digest?: string;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

/** What a failed request or a crashed page shows: the right state of the family for what actually went wrong. */
export function PageFailure({ error, onRetry, back, size = "page", title, digest, headingLevel, className }: PageFailureProps) {
  const t = useTranslations("ds.states");

  if (size !== "page") {
    return (
      <PageState
        drawing="crash"
        size={size}
        title={title ?? t("failedTitle")}
        className={className}
        actions={
          onRetry ? (
            size === "row" ? <RetryButton onRetry={onRetry} link /> : <RetryButton onRetry={onRetry} variant="outline" size="sm" />
          ) : null
        }
      />
    );
  }

  const kind: PageFailureKind = pageFailureKind(error, navigator.onLine);
  if (kind === "refused") return <PageRefusal headingLevel={headingLevel} className={className} />;
  if (kind === "gone") return <PageGone back={back} headingLevel={headingLevel} className={className} />;
  // These promise to come back on their own, so without a way to refresh a piece they reload the page.
  const comeBack = onRetry ?? (() => window.location.reload());
  if (kind === "down") return <ModuleDown headingLevel={headingLevel} onRetry={comeBack} />;
  if (kind === "offline") return <Offline headingLevel={headingLevel} onRetry={comeBack} />;

  return (
    <PageState
      drawing="crash"
      headingLevel={headingLevel}
      className={className}
      title={t("failedTitle")}
      description={digest ? t("failedBodyWithCode") : t("failedBody")}
      actions={
        <>
          {onRetry ? <RetryButton onRetry={onRetry} /> : null}
          <OverviewLink app={currentApp()} variant={onRetry ? "outline" : "default"} />
        </>
      }
      footer={digest ? <ReferenceCode code={digest} /> : null}
    />
  );
}

/** A record's link that no longer leads anywhere; goes back to the list it belongs to. */
export function PageGone({
  back,
  headingLevel,
  className,
}: {
  back?: { href: string; label: string };
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const t = useTranslations("ds.states");
  return (
    <PageState
      drawing="gone"
      headingLevel={headingLevel}
      className={className}
      title={t("goneTitle")}
      description={t("goneBody")}
      actions={
        back ? (
          <Button asChild>
            <a href={back.href}>{t("goTo", { place: back.label })}</a>
          </Button>
        ) : (
          <OverviewLink app={currentApp()} />
        )
      }
    />
  );
}

/** An address that matches nothing. Takes the app by name: this one is also rendered on the server. */
export function PageNotFound({ app }: { app: FailurePageApp }) {
  const t = useTranslations("ds.states");
  return (
    <PageState
      drawing="notFound"
      title={t("notFoundTitle")}
      description={t("notFoundBody")}
      actions={<OverviewLink app={app} />}
      footer={APPS[app].search ? <SearchBox /> : null}
    />
  );
}

/** Looks like the search and opens the one in the top bar; there is no second search. */
function SearchBox() {
  const t = useTranslations("ds.states");
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), []);

  return (
    <button
      type="button"
      onClick={openTopBarSearch}
      className="flex h-10 w-[340px] max-w-full items-center gap-2.5 rounded-control border border-input bg-card px-3.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{t("searchPages")}</span>
      <Kbd className="ms-auto">{mac ? "⌘ K" : "Ctrl K"}</Kbd>
    </button>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function Contact({ person, first }: { person: CompanyAdministratorContactDto; first: boolean }) {
  const t = useTranslations("ds.states");
  return (
    <span className="inline-flex items-center gap-2.5">
      <Avatar className="size-7">
        <AvatarFallback className="text-[0.625rem] font-semibold">{initialsOf(person.name)}</AvatarFallback>
      </Avatar>
      <span>
        {t.rich(first ? "canGiveAccess" : "soCan", {
          person: person.name,
          first: person.firstName,
          name: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          email: (chunks) => (
            <a href={`mailto:${person.email}`} className="font-medium text-primary-ink hover:underline">
              {chunks}
            </a>
          ),
        })}
      </span>
    </span>
  );
}

/** Who can help: real names, "your administrator" when the read fails, nothing for an administrator. */
function WhoCanHelp() {
  const t = useTranslations("ds.states");
  const { viewer } = useFusionViewer();
  const answer = useCompanyAdministrators(true);

  if (!viewer?.tenantId || answer.isLoading || answer.data?.callerIsAdministrator) return null;
  const people = answer.data?.administrators ?? [];
  if (people.length === 0) return <span>{t("askAdministrator")}</span>;
  return (
    <>
      {people.map((person, index) => (
        <Contact key={person.email} person={person} first={index === 0} />
      ))}
    </>
  );
}

/**
 * What an address someone can't use shows. Navigation already hides these pages, so this is for a typed or old link.
 * It never names the record, repeats the address or says which role would open the page.
 */
export function PageRefusal({
  leaveTo = "overview",
  help = true,
  headingLevel,
  className,
}: {
  /** Home, for someone who can't open anything in this module. */
  leaveTo?: "overview" | "home";
  /** Off where the company's administrators can't help, as with Platform. */
  help?: boolean;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const t = useTranslations("ds.states");
  return (
    <PageState
      drawing="refused"
      headingLevel={headingLevel}
      className={cn(className)}
      title={t("refused")}
      actions={<OverviewLink app={leaveTo === "home" ? "shell" : currentApp()} />}
      footer={help ? <WhoCanHelp /> : null}
    />
  );
}
