import type { Metadata } from "next";
import { InviteAcceptanceForm } from "./invite-acceptance-form";

export const metadata: Metadata = {
  title: "Accept Invite - Fusion",
  description: "Create your Fusion account.",
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; company?: string }>;
}) {
  const { token, company } = await searchParams;

  return <InviteAcceptanceForm token={token ?? null} company={company ?? null} />;
}
