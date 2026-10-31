import { redirect } from "next/navigation";

/** The company's jobs live in Settings since B-183. */
export default function OrganizationJobsPage() {
  redirect("/settings/jobs");
}
