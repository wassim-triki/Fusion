"use client";

import { useLocale, useTranslations } from "next-intl";
import { persistLanguageCookie } from "@repo/api";
import { LanguageMenu } from "@repo/ds/shell";
import { isLocale } from "@repo/i18n/config";
import { useSignInBrand } from "../sign-in-brand";
import { SignInFrame } from "./signin-page";

/**
 * Every invitation page on sign-in's frame (B-205): the company the link names (`?company=`) in its logo, name and
 * colour beside the form. A link sent before links named their company still shows the company's name once the
 * invitation is read; a link that names none, or a company that can't be found, shows Fusion's own side.
 */
export function InvitationFrame({
  company,
  companyName = null,
  pending = false,
  children,
}: {
  /** The company's slug from the link. */
  company: string | null;
  /** The company the invitation is for, as the service read it; stands in for a brand the link didn't name. */
  companyName?: string | null;
  /** Still reading the invitation. */
  pending?: boolean;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const brand = useSignInBrand(company, locale);
  return (
    <SignInFrame
      brand={
        brand.value ??
        (companyName ? { name: companyName, logoUrl: null } : null)
      }
      pending={brand.pending || (pending && Boolean(company))}
      language={
        <LanguageMenu
          value={isLocale(locale) ? locale : "en"}
          onChange={(next) => {
            persistLanguageCookie(next);
            window.location.reload();
          }}
        />
      }
    >
      {children}
    </SignInFrame>
  );
}

/** While the link is checked: the company's side as soon as it's known, the form's shape beside it. */
export function InvitationLoading({ company }: { company: string | null }) {
  const t = useTranslations("auth.invitation");
  return (
    <InvitationFrame company={company} pending>
      <div
        className="flex animate-pulse flex-col gap-5"
        role="status"
        aria-label={t("loading")}
      >
        <div className="h-9 w-2/3 rounded-control bg-muted" />
        <div className="h-10 rounded-control bg-muted" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-11 rounded-control bg-muted" />
          <div className="h-11 rounded-control bg-muted" />
        </div>
        <div className="h-11 rounded-control bg-muted" />
        <div className="h-11 rounded-control bg-muted" />
        <div className="h-12 rounded-control bg-muted" />
      </div>
    </InvitationFrame>
  );
}

/** What the invitation says, so the person can tell it's theirs before choosing a password: role and address, as drawn. */
export function InvitationFacts({
  facts,
}: {
  facts: { label: string; value: string; wide?: boolean }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className={fact.wide ? "col-span-2 min-w-0" : "min-w-0"}
        >
          <dt className="mb-0.5 type-meta text-muted-foreground">
            {fact.label}
          </dt>
          <dd
            className="truncate type-label text-foreground"
            title={fact.value}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "Join Carthage Digital" and what follows, as the drawing heads the form. */
export function InvitationHeading({
  title,
  lead,
}: {
  title: string;
  lead?: string;
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="type-page-title text-foreground">{title}</h1>
      {lead ? (
        <p className="type-body text-pretty text-muted-foreground">{lead}</p>
      ) : null}
    </header>
  );
}
