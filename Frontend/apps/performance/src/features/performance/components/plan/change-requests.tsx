"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, MessageSquare, Pencil, Trash2 } from "@/lib/icons";
import type { PlanChangeRequestDto } from "@repo/api";
import { Avatar, AvatarFallback } from "@repo/ds/components/ui/avatar";
import { Button } from "@repo/ds/components/ui/button";
import { Textarea } from "@repo/ds/components/ui/textarea";
import { AsyncButton } from "@repo/ds/shell";
import { cn } from "@repo/ds/lib/utils";

import { initials } from "./plan-lib";
import { useTranslations } from "next-intl";
import { useFormat } from "@repo/ds/lib/use-format";
import { english } from "@/i18n/say";

export const CHANGE_REQUEST_MAX = 500;

/** The change requests a reviewer is drafting on a submitted plan, one per objective, before Return sends them. */
export function useChangeRequestDrafts() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const set = useCallback((objectiveId: string, text: string) => setDrafts((d) => ({ ...d, [objectiveId]: text })), []);
  const remove = useCallback((objectiveId: string) => setDrafts(({ [objectiveId]: _removed, ...rest }) => rest), []);
  const clear = useCallback(() => setDrafts({}), []);
  const list = Object.entries(drafts).map(([objectiveId, text]) => ({ objectiveId, text }));
  return { drafts, set, remove, clear, list };
}

/**
 * Unsent drafts are only on this page: leaving it asks first — a reload or tab close through the browser's
 * own prompt, and an in-app link through a confirmation.
 */
export function useLeaveGuard(active: boolean, message = english("plan")("leaveGuard")) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor || (anchor as HTMLAnchorElement).target === "_blank") return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}

/**
 * The reviewer drafts a change on one objective, in place on its card: "Request a change" opens a short
 * field; a saved draft reads as a quiet block that can be edited or removed until Return sends it.
 */
export function ChangeRequestDraft({ value, onSave, onRemove }: {
  value: string | undefined;
  onSave: (text: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("plan.ChangeRequestDraft");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");

  if (editing) {
    return (
      <div className="space-y-2.5 rounded-control bg-inlay p-3">
        <label className="sr-only" htmlFor="change-request-text">{t("whatShouldChange")}</label>
        <Textarea
          id="change-request-text"
          autoFocus
          rows={2}
          maxLength={CHANGE_REQUEST_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("whatShouldChange")}
          className="min-h-16 resize-none bg-background"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setText(value ?? ""); }}>{t("cancel")}</Button>
          <Button size="sm" disabled={text.trim() === ""} onClick={() => { onSave(text.trim()); setEditing(false); }}>
            {t("saveChange")}
          </Button>
        </div>
      </div>
    );
  }

  if (value) {
    return (
      <div className="flex items-start gap-3 rounded-control bg-inlay px-3 py-2.5">
        <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="type-meta-strong text-muted-foreground">{t("changeToRequest")}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words type-body text-foreground">{value}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={t("editTheChange")} onClick={() => { setText(value); setEditing(true); }}>
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("removeTheChange")} onClick={onRemove}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="sm" className="-ms-2" onClick={() => { setText(""); setEditing(true); }}>
      <MessageSquare className="size-3.5" data-icon="inline-start" /> {t("requestAChange")}
    </Button>
  );
}

function outcome(request: PlanChangeRequestDto): { label: "objectiveRemoved" | "changed" | "notChanged"; tone: string } {
  if (request.state === "ObjectiveRemoved") return { label: "objectiveRemoved", tone: "text-muted-foreground" };
  if (request.objectiveChanged) return { label: "changed", tone: "text-success" };
  return { label: "notChanged", tone: "text-muted-foreground" };
}

/** Reviewing a resubmission: what the reviewer asked on this objective, what came of it, and the reply. */
export function ChangeRequestOutcome({ request }: { request: PlanChangeRequestDto }) {
  const t = useTranslations("plan.ChangeRequestOutcome");
  const result = outcome(request);
  return (
    <div className="rounded-control bg-inlay px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-meta-strong text-muted-foreground">{t("youAsked")}</p>
        <span className={cn("type-meta-strong", result.tone)}>{t(result.label)}</span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words type-body text-foreground">{request.text}</p>
      {request.reply ? (
        <p className="mt-2 border-t border-border pt-2 type-body text-foreground/85">
          <span className="type-meta-strong text-muted-foreground">{t("reply")} </span>
          {request.reply}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The owner's view of a change requested on this objective: who asked and when, the request, and Mark
 * addressed — with an optional reply — once they've dealt with it. Editing the objective is how it's fixed.
 */
export function OwnerChangeRequest({ request, reviewerName, decidedAt, canAddress, onAddress }: {
  request: PlanChangeRequestDto;
  reviewerName: string;
  decidedAt: string;
  canAddress: boolean;
  onAddress: (reply: string | null) => Promise<boolean>;
}) {
  const format = useFormat();
  const t = useTranslations("plan.OwnerChangeRequest");
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const addressed = request.state !== "Open";

  return (
    <div className={cn("rounded-control px-3 py-3", addressed ? "bg-inlay" : "bg-primary-tint ring-1 ring-inset ring-primary-ring")}>
      <div className="flex items-start gap-3">
        <Avatar className="size-7 shrink-0">
          <AvatarFallback hue={reviewerName} className="type-mark">{initials(reviewerName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="type-meta text-muted-foreground">
            <span className="font-semibold text-foreground">{t("askedForAChange", { reviewerName })}</span> ·{" "}
            <time dateTime={decidedAt}>{format.date(decidedAt.slice(0, 10))}</time>
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words type-body text-foreground">{request.text}</p>
          {addressed ? (
            <p className="mt-2 flex items-start gap-1.5 type-meta text-muted-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              <span>
                <span className="font-medium text-foreground">{t("addressed")}</span>
                {request.reply ? ` · ${request.reply}` : ""}
              </span>
            </p>
          ) : null}
        </div>
        {!addressed && canAddress && !replying ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setReplying(true)}>
            <Check className="size-3.5" data-icon="inline-start" /> {t("markAddressed")}
          </Button>
        ) : null}
      </div>
      {replying ? (
        <div className="mt-3 space-y-2 ps-10">
          <label className="type-meta-strong text-muted-foreground" htmlFor={`reply-${request.id}`}>
            {t("reply")} <span className="font-normal">{t("optional")}</span>
          </label>
          <Textarea
            id={`reply-${request.id}`}
            rows={2}
            maxLength={CHANGE_REQUEST_MAX}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="min-h-14 resize-none bg-background"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReplying(false)}>{t("cancel")}</Button>
            <AsyncButton
              size="sm"
              pending={pending}
              onClick={async () => {
                setPending(true);
                const done = await onAddress(reply.trim() || null);
                setPending(false);
                if (done) setReplying(false);
              }}
            >
              {t("markAddressed")}
            </AsyncButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
