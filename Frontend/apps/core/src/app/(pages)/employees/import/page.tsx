import { redirect } from "next/navigation";

/** The old employee import address; the import is one flow now (B-186). */
export default function EmployeeImportRedirectPage() {
  redirect("/import");
}
