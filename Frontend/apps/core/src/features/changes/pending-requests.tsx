"use client";

import { useState } from "react";
import { Hourglass } from "lucide-react";
import type { ChangeRequestDto } from "@repo/api";
import { useChangeRequests } from "@/features/people/changes/use-changes";
import { RequestSheet, RequestStatus } from "./request-sheet";
import { useRequestWords } from "./request-words";

/** Requests about one person that wait for an answer, as Coming up shows them, each opening the request. */
export function usePendingRequestCards(employeeKey: string, enabled: boolean) {
  const pending = useChangeRequests("pending", employeeKey, enabled);
  const [opened, setOpened] = useState<string | null>(null);
  const cards = (pending.data ?? [])
    .filter((request) => request.kind !== "HomeAddress")
    .map((request) => <PendingRequestCard key={request.id} request={request} onOpen={() => setOpened(request.id)} />);
  return { cards, sheet: <RequestSheet id={opened} onClose={() => setOpened(null)} /> };
}

function PendingRequestCard({ request, onOpen }: { request: ChangeRequestDto; onOpen: () => void }) {
  const words = useRequestWords()(request);
  return (
    <button type="button" onClick={onOpen}
      className="flex w-full items-center gap-3.5 rounded-control bg-inlay px-4 py-3.5 text-start outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
      <span className="grid size-14 shrink-0 place-items-center rounded-control bg-inlay">
        <Hourglass aria-hidden className="size-5 text-primary-ink" />
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate type-label text-foreground">{words.title}</span>
        <span className="truncate type-meta text-muted-foreground">{words.meta}</span>
      </span>
      <RequestStatus request={request} />
    </button>
  );
}
