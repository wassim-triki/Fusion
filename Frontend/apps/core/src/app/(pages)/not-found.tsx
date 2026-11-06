import { PageNotFound } from "@repo/auth";

/** An address that matches nothing, inside the frame. */
export default function CoreNotFound() {
  return <PageNotFound app="core" />;
}
