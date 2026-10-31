import { redirect } from "next/navigation";

/** The company's places live in Settings since B-183. */
export default function OrganizationPlacesPage() {
  redirect("/settings/places");
}
