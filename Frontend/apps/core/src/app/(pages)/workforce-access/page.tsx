import { redirect } from "next/navigation";

/** Workforce access split into People's Sign-in view, the invite sheet and each person's Access tab (D-11). */
export default function Page() {
  redirect("/people?view=not-signed-in");
}
