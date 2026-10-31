"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Home, LayoutGrid, Settings, TrendingUp, Users } from "lucide-react";
import { createCompanyBrandApi, createPlatformApiClient, type CompanyLanguage } from "@repo/api";
import { useApiQuery } from "@repo/api/query";
import { SignInFrame } from "@repo/auth";
import authAr from "@repo/auth/messages/ar.json";
import authEn from "@repo/auth/messages/en.json";
import authFr from "@repo/auth/messages/fr.json";
import { Button, Skeleton } from "@repo/ds";
import { brandCss, previewScope } from "@repo/ds/brand";
import { cn } from "@repo/ds/lib/utils";
import { HOME_PREVIEW_TEXT } from "./preview-text";

/** The brand as the studio has it now, saved or not. */
export interface BrandDraftView {
  name: string;
  color: string | null;
  language: CompanyLanguage;
  /** What to show as the logo: the draft's data URL or the saved address; null without one. */
  logoSrc: string | null;
}

const SIGN_IN_TEXT = { en: authEn.auth.signIn, fr: authFr.auth.signIn, ar: authAr.auth.signIn };
const WIDTH = 1440;
const HEIGHT = 900;

/**
 * A screen at 1440×900, scaled to the preview's width, in the draft's colour and direction. The draft colour is
 * scoped to this frame, so the rest of the page keeps the saved brand until the save.
 */
function ScaledScreen({ draft, label, children }: { draft: BrandDraftView; label: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const id = useId().replace(/[^a-z0-9]/gi, "");

  useEffect(() => {
    const element = outer.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      role="img"
      aria-label={label}
      className="relative w-full overflow-hidden rounded-inset border border-border bg-background"
      style={{ height: HEIGHT * scale }}
    >
      <style>{brandCss(draft.color, previewScope(id))}</style>
      <div
        data-brand-preview={id}
        dir={draft.language === "ar" ? "rtl" : "ltr"}
        lang={draft.language}
        inert
        className="absolute bg-background text-foreground"
        style={{ left: 0, top: 0, width: WIDTH, height: HEIGHT, transform: `scale(${scale})`, transformOrigin: "0 0" }}
      >
        {children}
      </div>
    </div>
  );
}

function Mark({ draft, className }: { draft: BrandDraftView; className?: string }) {
  return draft.logoSrc ? (
    <img src={draft.logoSrc} alt="" className={cn("bg-card object-contain", className)} />
  ) : (
    <span className={cn("grid place-items-center bg-primary font-bold text-primary-foreground", className)}>
      {draft.name.trim().charAt(0).toUpperCase() || "F"}
    </span>
  );
}

/** Home as a person in the company sees it: the sidebar's brand, the greeting, work in the company's colour. */
export function HomePreview({ draft, firstName, label }: { draft: BrandDraftView; firstName: string; label: string }) {
  const text = HOME_PREVIEW_TEXT[draft.language];
  const date = new Intl.DateTimeFormat(draft.language, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const nav = [
    { icon: Home, label: text.home, active: true },
    { icon: Users, label: text.core },
    { icon: TrendingUp, label: text.performance },
  ];
  return (
    <ScaledScreen draft={draft} label={label}>
      <div className="flex h-full">
        <aside className="dark flex w-[264px] shrink-0 flex-col border-e border-border bg-section px-3 pt-4 text-foreground">
          <div className="flex items-center gap-2.5 px-1 pb-4">
            <Mark draft={draft} className="size-9 rounded-detail text-base" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">{draft.name || "—"}</span>
              <span className="text-xs text-muted-foreground">Fusion</span>
            </span>
          </div>
          {nav.map(({ icon: Icon, label: item, active }) => (
            <span
              key={item}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-control px-2.5 text-sm",
                active ? "bg-inlay font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary-ink")} />
              {item}
            </span>
          ))}
          <span className="mt-auto mb-4 flex h-9 items-center gap-2.5 px-2.5 text-sm text-muted-foreground">
            <Settings className="size-4" />
            {text.settings}
          </span>
        </aside>
        <main className="flex-1 px-14 pt-14">
          <div className="mx-auto flex max-w-[980px] flex-col gap-8">
            <div className="flex flex-col gap-1.5">
              <p className="type-meta text-muted-foreground">{date}</p>
              <h1 className="font-editorial text-4xl font-medium tracking-tight">{text.morning(firstName)}</h1>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-6">
              <section className="flex flex-col gap-3 rounded-surface bg-card p-6">
                <h2 className="type-section-title">{text.needsYou}</h2>
                {text.items.map((item, index) => (
                  <div key={item} className="flex items-center gap-4 rounded-inset bg-inlay px-4 py-3.5">
                    <span className="grid size-9 place-items-center rounded-control bg-primary-tint text-primary-ink">
                      <LayoutGrid className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate type-label font-semibold">{item}</span>
                      <span className="type-meta text-muted-foreground">{text.sources[index]}</span>
                    </span>
                    {index === 0 ? <Button size="sm">{text.open}</Button> : null}
                  </div>
                ))}
              </section>
              <section className="flex flex-col gap-3 rounded-surface bg-card p-6">
                <h2 className="type-section-title">{text.comingUp}</h2>
                {text.upcoming.map((item) => (
                  <p key={item} className="border-b border-border pb-3 type-body last:border-0">{item}</p>
                ))}
                <h2 className="mt-2 type-section-title">{text.yourTeam}</h2>
                <div className="flex -space-x-2 rtl:space-x-reverse">
                  {["#5b8def", "#e0708a", "#3fb68b", "#c08a3e"].map((tone) => (
                    <span key={tone} className="size-9 rounded-full border-2 border-card" style={{ background: tone }} />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </ScaledScreen>
  );
}

/** The company's sign-in page: the real frame, with the form drawn still. */
export function SignInPreview({ draft, label }: { draft: BrandDraftView; label: string }) {
  const text = SIGN_IN_TEXT[draft.language];
  const field = (name: string) => (
    <div className="flex flex-col gap-2">
      <span className="type-label">{name}</span>
      <span className="h-11 rounded-control border border-input bg-card" />
    </div>
  );
  return (
    <ScaledScreen draft={draft} label={label}>
      <SignInFrame brand={{ name: draft.name || "—", logoUrl: draft.logoSrc }} className="h-full">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="type-page-title">{text.title}</h1>
            <p className="type-body text-muted-foreground">{text.to.replace("{company}", draft.name)}</p>
          </div>
          {field(text.email)}
          {field(text.password)}
          <Button size="lg" className="h-11 w-full">{text.submit}</Button>
          <p className="text-center type-meta text-muted-foreground">{text.or}</p>
          <Button size="lg" variant="outline" className="h-11 w-full">{text.sso}</Button>
        </div>
      </SignInFrame>
    </ScaledScreen>
  );
}

/**
 * The invitation email exactly as Identity renders it for the draft, addressed to the viewer, with the draft logo
 * put where the email carries its own.
 */
export function EmailPreview({
  draft,
  label,
  failedLabel,
}: {
  draft: BrandDraftView;
  label: string;
  failedLabel: string;
}) {
  const locale = useLocale();
  const [request, setRequest] = useState({ name: draft.name, color: draft.color, language: draft.language, hasLogo: Boolean(draft.logoSrc) });
  useEffect(() => {
    // Typing a name shouldn't send a request per key.
    const timer = window.setTimeout(
      () => setRequest({ name: draft.name, color: draft.color, language: draft.language, hasLogo: Boolean(draft.logoSrc) }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [draft.name, draft.color, draft.language, draft.logoSrc]);

  const preview = useApiQuery(
    ["company-brand", "email-preview", request, locale],
    (signal) => createCompanyBrandApi(createPlatformApiClient()).emailPreview(request, signal),
    { placeholderData: (previous) => previous },
  );
  const html = preview.data
    ? preview.data.html.replaceAll(`cid:${preview.data.logoContentId}`, draft.logoSrc ?? "")
    : null;

  return (
    <div className="flex flex-col gap-2">
      {preview.data ? (
        <p className="truncate type-label" dir={draft.language === "ar" ? "rtl" : "ltr"}>{preview.data.subject}</p>
      ) : (
        <Skeleton className="h-4 w-72" />
      )}
      {html ? (
        <iframe
          title={label}
          srcDoc={html}
          sandbox=""
          className="h-[560px] w-full rounded-inset border border-border bg-white"
        />
      ) : preview.error ? (
        <p role="alert" className="grid h-[560px] place-items-center rounded-inset border border-border type-body text-muted-foreground">
          {failedLabel}
        </p>
      ) : (
        <Skeleton className="h-[560px] w-full rounded-inset" />
      )}
    </div>
  );
}
