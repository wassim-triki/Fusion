import { Suspense } from "react";
import type { Metadata } from "next";
import { ForgotPasswordPage } from "@repo/auth";

export const metadata: Metadata = {
  title: "Reset your password - Fusion",
};

export default function Page() {
  return (
    <Suspense>
      <ForgotPasswordPage />
    </Suspense>
  );
}
