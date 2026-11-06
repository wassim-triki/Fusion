import type { Metadata } from "next";
import { AuthProvider, ModuleGate } from "@repo/auth";
import { OnboardingSidebar } from "@/components/onboarding-sidebar";
import "@repo/ui/src/ey-brand.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onboarding - Frontend",
  description: "Employee onboarding and orientation microfrontend",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AuthProvider>
          {/* Retired: joining checklists in Core HR replaced this module. */}
          <ModuleGate module={null}>
            <div className="flex h-screen overflow-hidden">
              <OnboardingSidebar />
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </ModuleGate>
        </AuthProvider>
      </body>
    </html>
  );
}
