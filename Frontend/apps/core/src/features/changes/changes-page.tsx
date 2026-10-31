"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import type { ChangeRequestDto } from "@repo/api";
import { Button, PersonAvatar, Skeleton, Tabs, TabsList, TabsTrigger } from "@repo/ds";
import { PageContainer, PageError, PageHeader } from "@repo/ds/shell";
import { useRefusal } from "@/i18n/words";
import { useChangeRequests, useRequestDecisions } from "@/features/people/changes/use-changes";
import { RequestSheet, RequestStatus } from "./request-sheet";
import { useRequestWords } from "./request-words";

type View = "pending" | "decided";

/**
 * Changes and approvals (B-179): what waits for an answer (every request for whoever approves, your own otherwise)
 * and what was answered. Approving is one click here or on Home; declining opens the request to say why.
 */
export function ChangesPage() {
  const t = useTranslations("changes.requests");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState<View>("pending");
  const pending = useChangeRequests("pending");
  const decided = useChangeRequests("decided", null, view === "decided");
  const list = view === "pending" ? pending : decided;
  const opened = params.get("request");
  const open = (id: string | null) => router.replace(id ? `${pathname}?request=${id}` : pathname, { scroll: false });

  return (
    <PageContainer width="narrow" className="space-y-6">
      <PageHeader title={t("title")} />
      <Tabs value={view} onValueChange={(next) => setView(next as View)}>
        <TabsList>
          <TabsTrigger value="pending">
            {t("waiting")}
            {pending.data?.length ? <span className="ms-1.5 tabular-nums text-muted-foreground">{pending.data.length}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="decided">{t("answered")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {list.error && !list.data ? (
        <PageError title={t("failed")} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2"><Skeleton className="h-[76px] rounded-surface" /><Skeleton className="h-[76px] rounded-surface" /></div>
      ) : list.data.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-surface bg-section px-6 py-14 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-card"><Inbox aria-hidden className="size-5 text-muted-foreground" /></span>
          <p className="type-body text-muted-foreground">{view === "pending" ? t("emptyWaiting") : t("emptyAnswered")}</p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {list.data.map((request) => <RequestRow key={request.id} request={request} onOpen={() => open(request.id)} />)}
        </ul>
      )}

      <RequestSheet id={opened} onClose={() => open(null)} />
    </PageContainer>
  );
}

function RequestRow({ request, onOpen }: { request: ChangeRequestDto; onOpen: () => void }) {
  const t = useTranslations("changes.requests");
  const refusal = useRefusal();
  const words = useRequestWords()(request);
  const { approve } = useRequestDecisions();
  const quick = request.canDecide && !request.stale;

  const yes = async () => {
    try {
      await approve.mutateAsync(request.id);
      toast.success(request.kind === "HomeAddress" ? t("approvedAddress") : t("approved", { date: words.date }));
    } catch (caught) {
      toast.error(refusal(caught, t("actionFailed")));
    }
  };

  return (
    <li className="group flex min-h-[76px] items-center gap-3.5 rounded-surface bg-card px-[18px] py-3.5 transition-colors hover:bg-card/80">
      <PersonAvatar name={request.person.displayName} className="size-10" />
      <button type="button" onClick={onOpen} className="grid min-w-0 flex-1 gap-[3px] text-start outline-none focus-visible:underline">
        <span className="truncate type-label text-foreground">{words.title}</span>
        <span className="truncate type-meta text-muted-foreground">{words.decided ?? words.meta}</span>
      </button>
      {quick ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onOpen}>{t("decline")}</Button>
          <Button type="button" size="sm" variant="outline" disabled={approve.isLoading} onClick={() => void yes()}>{t("approve")}</Button>
        </div>
      ) : (
        <RequestStatus request={request} />
      )}
    </li>
  );
}
