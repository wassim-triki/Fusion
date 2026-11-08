"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ds";
import { PageContainer, PageHeader } from "@repo/ds/shell";
import { canImportCoreEmployees, canManageCoreEmployees, canManageWorkforceAccess, useAuth } from "@repo/auth";
import { ChevronDown, Mail, Upload, UserRoundPlus } from "lucide-react";
import { canAccessEmployeeRoster } from "@/lib/employee-roster-access";
import { InviteSheet } from "./invite-sheet";
import { PeopleDirectory } from "./people-directory";
import { PeopleTable } from "./people-table";

/** People (D-13, D-28): a table for HR, portrait cards for everyone else; HR can switch to the cards. */
export default function PeoplePage() {
  const t = useTranslations("people.page");
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isHr = canAccessEmployeeRoster(user);
  const canAdd = canManageCoreEmployees(user);
  const canImport = canImportCoreEmployees(user);
  const canInvite = canManageWorkforceAccess(user);
  const layout = isHr && searchParams.get("layout") !== "cards" ? "table" : "cards";
  const inviting = canInvite && searchParams.get("invite") === "1";

  const setInviting = (open: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (open) next.set("invite", "1");
    else next.delete("invite");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const actions = (
    <div className="flex items-center gap-2">
      {canInvite ? (
        <Button writes variant="outline" onClick={() => setInviting(true)}>
          <Mail className="size-4" aria-hidden /> {t("invite")}
        </Button>
      ) : null}
      {canAdd ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button writes>
              <UserRoundPlus className="size-4" aria-hidden /> {t("add")} <ChevronDown className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href="/people/add"><UserRoundPlus className="size-4" aria-hidden /> {t("addOne")}</Link>
            </DropdownMenuItem>
            {canImport ? (
              <DropdownMenuItem asChild>
                <Link href="/import"><Upload className="size-4" aria-hidden /> {t("import")}</Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  const header = (count: number | null) => (
    <PageHeader
      title={t("title")}
      description={count === null ? undefined : t("count", { count })}
      actions={isHr || canInvite ? actions : undefined}
    />
  );

  return (
    <PageContainer width="wide" className="pb-12">
      {layout === "table" ? <PeopleTable header={header} /> : <PeopleDirectory canSwitch={isHr} header={header} />}
      {canInvite ? <InviteSheet open={inviting} onClose={() => setInviting(false)} /> : null}
    </PageContainer>
  );
}
