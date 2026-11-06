import { PageNotFound } from "@repo/auth";
import { HomeFrame } from "@/features/home/home-frame";

/** An address that matches nothing, inside the frame. */
export default function NotFound() {
  return (
    <HomeFrame>
      <PageNotFound app="shell" />
    </HomeFrame>
  );
}
