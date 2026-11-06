import type { Metadata } from "next";
import { AuthProvider, ModuleGate } from "@repo/auth";
import { RecruitmentSidebar } from "@/components/recruitment-sidebar";
import "@repo/ui/src/ey-brand.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recruitment - Frontend",
  description: "Recruitment pipeline and talent acquisition microfrontend",
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
          <ModuleGate module="Recruitment">
            <div className="flex h-screen overflow-hidden">
              <RecruitmentSidebar />
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </ModuleGate>
        </AuthProvider>
      </body>
    </html>
  );
}
