import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AuthProvider, ModuleGate } from "@repo/auth";
import { ModuleLayout, ThemeProvider, ThemeScript } from "@repo/ui";
import { Toaster } from "sonner";
import { LearningSidebar } from "@/components/learning-sidebar";
import { LearningHeader } from "@/components/learning-header";
import { AcademyAssistant } from "@/components/assistant/academy-assistant";
import { AssistantScopeProvider } from "@/components/assistant/assistant-scope";
import "@repo/ui/src/ey-brand.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Learning - Frontend",
  description: "Learning management microfrontend",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeScript />
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <AuthProvider>
              <ModuleGate module="Learning" publicPaths={["/verify"]}>
                {/* AI-L-1: one module-wide Academy Assistant (ADR-0013). The provider lets the
                    course player publish its active chapter; the assistant floats everywhere. */}
                <AssistantScopeProvider>
                  <ModuleLayout sidebar={<LearningSidebar />}>
                    <LearningHeader />
                    {children}
                  </ModuleLayout>
                  <AcademyAssistant />
                </AssistantScopeProvider>
              </ModuleGate>
              <Toaster
                richColors
                closeButton
                position="top-right"
                theme="system"
              />
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
