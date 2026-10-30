import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { directionOf } from "@repo/ds/i18n";
import { BRAND_COOKIE, BrandStyle } from "@repo/ds/brand";
import { cookies } from "next/headers";
import { Suspense } from "react";
import "./globals.css";
import { PageProgressBar } from "../components/page-progress-bar";
import { Providers } from "./providers";

// Core theme comes solely from @repo/ds/tokens.css (oklch tokens). Do not import a
// competing HSL token sheet here — it would clobber the @repo/ds preset tokens.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("frame.metadata");
  return { title: t("title"), description: t("description") };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The person's language, from the NEXT_LOCALE cookie their session writes. Every Core HR screen is translated, so
  // the page says which language it is in.
  const locale = await getLocale();
  const dir = directionOf(locale);
  // The company colour this browser last saw, so the page opens in it; the sidebar keeps it current.
  const brandColor = (await cookies()).get(BRAND_COOKIE)?.value;
  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-screen antialiased bg-background text-foreground font-sans">
        <BrandStyle cookie={brandColor} />
        <Suspense fallback={null}>
          <PageProgressBar />
        </Suspense>
        <NextIntlClientProvider>
          <Providers dir={dir}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
