import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPasswordPage } from "@repo/auth";

export const metadata: Metadata = {
  title: "Choose a new password - Fusion",
  // The address carries a one-time link until the page takes it out.
  referrer: "no-referrer",
};

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}
