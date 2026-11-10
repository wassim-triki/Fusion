"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "@repo/ds/choice";
import { LayoutGrid, List } from "@repo/ds/icons";

export type PeopleLayout = "table" | "cards";

/** HR switches People between the table and the cards everyone else sees; the choice lives in the address. */
export function LayoutSwitch({ value }: { value: PeopleLayout }) {
  const t = useTranslations("people.layout");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <Segmented
      size="sm"
      label={t("label")}
      value={value}
      onChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        if (next === "cards") params.set("layout", "cards");
        else params.delete("layout");
        params.delete("page");
        router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
      }}
      options={[
        { value: "table", label: <span className="sr-only">{t("table")}</span>, icon: <List aria-hidden /> },
        { value: "cards", label: <span className="sr-only">{t("cards")}</span>, icon: <LayoutGrid aria-hidden /> },
      ]}
    />
  );
}
