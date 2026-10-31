import { redirect } from "next/navigation";
import { ADMINISTRATORS_PATH } from "@/features/settings/roles/paths";

/** Administrators moved to Settings › Roles › Administrators (B-178); old links and emails land there. */
export default function AccessCompatibilityPage() {
  redirect(ADMINISTRATORS_PATH);
}
