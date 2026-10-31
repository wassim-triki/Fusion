"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import { ADMINISTRATORS_ROLE, endViewAs, useViewAs } from "../view-as";

/**
 * The bar across the top of every app while an administrator sees Fusion as someone (D-25, as drawn): who, their
 * roles, and the way back. Nothing renders otherwise. The view itself is enforced by the server, not by this bar.
 */
export function ViewingAsBar() {
  const viewing = useViewAs();
  const t = useTranslations("auth.viewAs");
  const [leaving, setLeaving] = useState(false);
  if (!viewing) return null;

  return (
    <div
      role="status"
      className="flex h-[50px] shrink-0 items-center gap-3 bg-foreground ps-6 pe-4 text-background"
    >
      <Eye aria-hidden className="size-[18px]" />
      <p className="truncate type-label">{t("seeing", { name: viewing.personName })}</p>
      {viewing.roles.map((role) => (
        <span
          key={role}
          className="inline-flex h-6 shrink-0 items-center rounded-full bg-[color:color-mix(in_oklab,var(--background)_14%,transparent)] px-[9px] type-meta font-medium"
        >
          {role === ADMINISTRATORS_ROLE ? t("administrators") : role}
        </span>
      ))}
      <span className="flex-1" />
      <span className="hidden type-meta opacity-70 md:inline">{t("readOnly")}</span>
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void endViewAs();
        }}
        className="inline-flex h-[30px] shrink-0 items-center rounded-control bg-background px-2.5 type-control-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
      >
        {t("back")}
      </button>
    </div>
  );
}
