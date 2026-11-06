import { notFound } from "next/navigation";

/** Unmatched Core HR addresses resolve to the in-frame not-found state rather than a bare root page. */
export default function MissingCorePage() {
  notFound();
}
