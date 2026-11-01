import { redirect } from "next/navigation";

/** The organization and people imports are one flow now (B-186): every old address opens it. */
export default function OldImportRedirectPage() {
  redirect("/import");
}
