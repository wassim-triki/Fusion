"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Mail, Lock, Home, Palette, Upload } from "lucide-react";
import {
  createCompanyBrandApi,
  createPlatformApiClient,
  fusionNavigationQueryKeys,
  type CompanyLanguage,
  type FusionSettingsSection,
  type FusionTenantSummaryDto,
} from "@repo/api";
import { useTenantSummary } from "@repo/api/query";
import { useFusionViewer, useStagedSettings } from "@repo/api/react";
import { Button, Input } from "@repo/ds";
import { Segmented } from "@repo/ds/choice";
import { FUSION_COLORS, applyCompanyColor, isBrandColor, readableText } from "@repo/ds/brand";
import { cn } from "@repo/ds/lib/utils";
import { PageError, SettingsPage, useSettingsSectionName } from "@repo/ds/shell";
import { EmailPreview, HomePreview, SignInPreview, type BrandDraftView } from "../brand/brand-previews";
import { prepareLogo, storedLogoColors } from "../brand/prepare-logo";
import { useSaveFailure } from "../say";

const LANGUAGES: { value: CompanyLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ar", label: "العربية" },
];

/** The studio's draft: what one save sends. `logo` is the saved address, a new PNG data URL, or null (none). */
interface BrandDraft {
  name: string;
  color: string | null;
  language: CompanyLanguage;
  logo: string | null;
}

type PreviewKind = "home" | "signin" | "email";

function toDraft(summary: FusionTenantSummaryDto): BrandDraft {
  const language = summary.language === "fr" || summary.language === "ar" ? summary.language : "en";
  return { name: summary.name, color: summary.brandColor ?? null, language, logo: summary.logoUrl ?? null };
}

function Control({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-border py-5 first:border-t-0 first:pt-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="type-label font-semibold">{label}</label>
      ) : (
        <h2 className="type-label font-semibold">{label}</h2>
      )}
      {children}
      {hint ? <p className="type-meta text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

function Swatch({
  color,
  label,
  selected,
  disabled,
  onSelect,
}: {
  color: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "grid size-9 place-items-center rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        selected && "ring-2 ring-foreground",
      )}
      style={{ background: color, color: readableText(color).text }}
    >
      {selected ? <Check aria-hidden className="size-4" /> : null}
    </button>
  );
}

/**
 * Settings › Brand (B-176, D-02): the company's logo, name, colour and default language, previewed live on Home,
 * sign-in and the invitation email in that language, right to left in Arabic. Nothing changes for anyone until the
 * save; the save is one request to Identity, which checks the same permission the section shows.
 */
export function BrandSettings({ section }: { section: FusionSettingsSection }) {
  const t = useTranslations("settings.brand");
  const failure = useSaveFailure();
  const title = useSettingsSectionName()(section);
  const editable = section.access === "manage";
  const { viewer } = useFusionViewer();
  const queryClient = useQueryClient();
  const summary = useTenantSummary();
  const saved = useMemo(() => (summary.data ? toDraft(summary.data) : undefined), [summary.data]);
  const api = useMemo(() => createCompanyBrandApi(createPlatformApiClient()), []);

  const staged = useStagedSettings<BrandDraft>(
    saved,
    async (draft) => {
      const logoChanged = draft.logo !== saved?.logo;
      const result = await api.save({
        name: draft.name.trim(),
        color: draft.color,
        language: draft.language,
        logo: !logoChanged ? "keep" : draft.logo ? "replace" : "remove",
        logoPng: logoChanged ? draft.logo : null,
      });
      queryClient.setQueryData(fusionNavigationQueryKeys.tenant(result.tenantId), result);
      await queryClient.invalidateQueries({ queryKey: fusionNavigationQueryKeys.tenant(result.tenantId) });
      applyCompanyColor(result.brandColor ?? null);
    },
    { leaveMessage: t("leave"), onReload: () => void summary.refetch() },
  );
  const draft = staged.draft;

  const [preview, setPreview] = useState<PreviewKind>("home");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoColors, setLogoColors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // The saved logo's colours, so "From your logo" is there before anything is uploaded.
  const savedLogo = saved?.logo ?? null;
  useEffect(() => {
    if (!savedLogo) return;
    let current = true;
    void storedLogoColors(savedLogo).then((colors) => current && setLogoColors(colors));
    return () => {
      current = false;
    };
  }, [savedLogo]);

  if (summary.error && !summary.data) {
    return (
      <SettingsPage title={title}>
        <PageError title={t("didNotLoad")} onRetry={() => void summary.refetch()} />
      </SettingsPage>
    );
  }

  const set = (change: Partial<BrandDraft>) => staged.update((current) => ({ ...current, ...change }));

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setLogoError(null);
    try {
      const prepared = await prepareLogo(file);
      setLogoColors(prepared.colors);
      set({ logo: prepared.dataUrl });
    } catch (error) {
      setLogoError(error instanceof Error && error.message === "too-large" ? t("logoTooLarge") : t("logoUnreadable"));
    }
  };

  const view: BrandDraftView | null = draft
    ? { name: draft.name, color: draft.color, language: draft.language, logoSrc: draft.logo }
    : null;
  const nameValid = (draft?.name.trim().length ?? 0) >= 2;
  const firstName = viewer?.fullName?.split(" ")[0] ?? "";
  const anyColor = draft?.color && !FUSION_COLORS.includes(draft.color as never) && !logoColors.includes(draft.color)
    ? draft.color
    : null;

  return (
    <SettingsPage
      title={title}
      lastChange={null}
      viewOnly={!editable}
      loading={!draft}
      studio
      aside={
        editable && draft ? (
          <div className="flex items-center gap-3">
            {staged.dirty ? <span className="type-meta text-muted-foreground">{t("unsaved")}</span> : null}
            <Button
              type="button"
              variant="ghost"
              disabled={!staged.dirty || staged.saving}
              onClick={() => {
                staged.discard();
                setLogoError(null);
              }}
            >
              {t("discard")}
            </Button>
            <Button
              type="button"
              disabled={!staged.dirty || staged.saving || !nameValid}
              onClick={() => void staged.submit()}
            >
              {staged.saving ? t("saving") : t("save")}
            </Button>
          </div>
        ) : null
      }
    >
      {draft && view ? (
        <>
          {staged.error ? (
            <p role="alert" className="-mt-4 type-body text-destructive">{failure(staged.error, t("notSaved"))}</p>
          ) : null}
          <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-10">
            <div className="flex flex-col">
              <Control label={t("logo")} hint={logoError ?? t("logoHint")}>
                <div className="flex items-center gap-4">
                  {draft.logo ? (
                    <img src={draft.logo} alt={t("logo")} className="size-16 rounded-control border border-border bg-card object-contain" />
                  ) : (
                    <span className="grid size-16 place-items-center rounded-control bg-primary text-2xl font-bold text-primary-foreground">
                      {draft.name.trim().charAt(0).toUpperCase() || "F"}
                    </span>
                  )}
                  {editable ? (
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                        <Upload />
                        {draft.logo ? t("replace") : t("upload")}
                      </Button>
                      {draft.logo ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => set({ logo: null })}>
                          {t("remove")}
                        </Button>
                      ) : null}
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                        className="sr-only"
                        aria-label={t("logo")}
                        onChange={(event) => {
                          void chooseFile(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              </Control>

              <Control label={t("name")} htmlFor="brand-name" hint={nameValid ? undefined : t("nameTooShort")}>
                <Input
                  id="brand-name"
                  value={draft.name}
                  maxLength={100}
                  disabled={!editable}
                  aria-invalid={!nameValid}
                  onChange={(event) => set({ name: event.target.value })}
                />
              </Control>

              <Control label={t("color")}>
                {logoColors.length > 0 && draft.logo ? (
                  <div className="flex flex-col gap-2">
                    <p className="type-meta text-muted-foreground">{t("fromLogo")}</p>
                    <div className="flex flex-wrap gap-2">
                      {logoColors.map((color) => (
                        <Swatch key={color} color={color} label={color} selected={draft.color === color}
                          disabled={!editable} onSelect={() => set({ color })} />
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <p className="type-meta text-muted-foreground">{t("fusion")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Swatch color="#f4c414" label={t("fusionAmber")} selected={draft.color === null}
                      disabled={!editable} onSelect={() => set({ color: null })} />
                    {FUSION_COLORS.map((color) => (
                      <Swatch key={color} color={color} label={color} selected={draft.color === color}
                        disabled={!editable} onSelect={() => set({ color })} />
                    ))}
                    <label
                      title={t("anyColor")}
                      className={cn(
                        "relative grid size-9 cursor-pointer place-items-center rounded-full bg-[conic-gradient(from_0deg,#e5484d,#f5b800,#46a758,#0ea5a5,#3e63dd,#8e4ec6,#e5484d)] ring-offset-2 ring-offset-background focus-within:ring-2 focus-within:ring-ring",
                        anyColor && "ring-2 ring-foreground",
                        !editable && "cursor-default",
                      )}
                    >
                      <Palette aria-hidden className="size-4 text-white" />
                      <input
                        type="color"
                        aria-label={t("anyColor")}
                        disabled={!editable}
                        value={draft.color ?? "#7c4dcc"}
                        onChange={(event) => isBrandColor(event.target.value) && set({ color: event.target.value.toLowerCase() })}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </label>
                  </div>
                </div>
              </Control>

              <Control label={t("language")} hint={t("languageHint")}>
                <Segmented
                  className="self-start"
                  label={t("language")}
                  value={draft.language}
                  disabled={!editable}
                  onChange={(language) => set({ language })}
                  options={LANGUAGES.map((language) => ({
                    value: language.value,
                    label: <span lang={language.value}>{language.label}</span>,
                  }))}
                />
              </Control>
            </div>

            <div className="flex flex-col gap-4 rounded-surface bg-section p-4">
              <Segmented
                label={t("preview")}
                value={preview}
                onChange={setPreview}
                className="self-start"
                options={[
                  { value: "home", label: t("previewHome"), icon: <Home /> },
                  { value: "signin", label: t("previewSignIn"), icon: <Lock /> },
                  { value: "email", label: t("previewEmail"), icon: <Mail /> },
                ]}
              />
              {preview === "home" ? (
                <HomePreview draft={view} firstName={firstName} label={t("previewHome")} />
              ) : preview === "signin" ? (
                <SignInPreview draft={view} label={t("previewSignIn")} />
              ) : (
                <EmailPreview draft={view} label={t("previewEmail")} failedLabel={t("emailDidNotLoad")} />
              )}
            </div>
          </div>

        </>
      ) : null}
    </SettingsPage>
  );
}
