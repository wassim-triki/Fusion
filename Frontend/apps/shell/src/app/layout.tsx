import type { Metadata } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { directionOf } from "@repo/ds/i18n";
import { BRAND_COOKIE, BrandStyle } from "@repo/ds/brand";
import { cookies } from "next/headers";
import "./globals.css";
import { PageProgressBar } from "../components/page-progress-bar";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Fusion",
  description: "Fusion HR",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The person's language, from the NEXT_LOCALE cookie their session writes (the last language used on this browser
  // before sign-in). Every shell screen speaks it, so the page does too.
  const locale = await getLocale();
  const dir = directionOf(locale);
  // The company colour this browser last saw, so the page opens in it; the sidebar keeps it current.
  const brandColor = (await cookies()).get(BRAND_COOKIE)?.value;
  return (
    // next-themes sets the appearance class on <html> before hydration (Settings › Preferences).
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
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
