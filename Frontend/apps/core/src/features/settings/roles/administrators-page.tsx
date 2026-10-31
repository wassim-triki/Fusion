"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Crown, Lock, MoreHorizontal, Search, ShieldCheck, UserPlus, X } from "lucide-react";
import {
  createCorePeopleApi,
  createPlatformApiClient,
  corePeopleQueryKeys,
  MINIMUM_ADMINISTRATORS,
  type AdministratorCandidateDto,
  type AdministratorHistoryItemDto,
  type FusionSettingsSection,
  type TenantAdministratorDto,
} from "@repo/api";
import { useApiQuery, useTenantSummary } from "@repo/api/query";
import { useAuth } from "@repo/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  PersonAvatar,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
} from "@repo/ds";
import { formatDate } from "@repo/ds/lib/dates";
import { PageError } from "@repo/ds/shell";
import {
  problemTypeOf,
  useAddAdministrator,
  useAdministratorCandidates,
  useAdministratorHistory,
  useRemoveAdministrator,
  useTenantAdministrators,
} from "@/features/tenant-access/api/use-tenant-access";
import { useSettingsSay, type Say } from "@/features/settings/say";
import { useBreadcrumbLabel } from "@/shell/breadcrumb-overrides";

// The drawing's 48px faces (between the DS's lg and xl).
const FACE = "size-12 text-base";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function isToday(value: string): boolean {
  return new Date(value).toDateString() === new Date().toDateString();
}

function useDay() {
  const locale = useLocale();
  const say = useSettingsSay();
  return (value: string) =>
    isToday(value) ? say("roles.administrators.today") : formatDate(value, { locale, year: "always" });
}

// ── Who ──

function Progress({ count, say }: { count: number; say: Say }) {
  const short = count < MINIMUM_ADMINISTRATORS;
  const segments = Math.max(count, MINIMUM_ADMINISTRATORS);
  return (
    <span className="flex items-center gap-3">
      <span className={cn("type-meta", short ? "text-warning" : "text-muted-foreground")}>
        {short
          ? say("roles.administrators.progressShort", { count, minimum: MINIMUM_ADMINISTRATORS })
          : say("roles.administrators.progress", { count })}
      </span>
      <span aria-hidden className="inline-flex gap-1">
        {Array.from({ length: segments }, (_, index) => (
          <i
            key={index}
            className={cn(
              "h-1.5 w-7 rounded-full border",
              index < count ? "border-transparent bg-primary" : "border-border bg-inlay"
            )}
          />
        ))}
      </span>
    </span>
  );
}

function Slot({
  administrator,
  company,
  isMe,
  canManage,
  fresh,
  onRemove,
  say,
}: {
  administrator: TenantAdministratorDto;
  company: string;
  isMe: boolean;
  canManage: boolean;
  fresh: boolean;
  onRemove: () => void;
  say: Say;
}) {
  const day = useDay();
  const since = isToday(administrator.accessEstablishedAt)
    ? say("roles.administrators.sinceToday")
    : say("roles.administrators.since", { date: day(administrator.accessEstablishedAt) });
  const how =
    administrator.addedByKind === "activation"
      ? say("roles.administrators.setUp", { company })
      : administrator.addedByKind === "recovery"
        ? say("roles.administrators.restored")
        : administrator.addedByName
          ? say("roles.administrators.addedBy", { name: administrator.addedByName })
          : null;
  return (
    <li
      className={cn(
        "flex min-h-[100px] items-center gap-3.5 rounded-surface bg-card px-[22px] py-5",
        fresh && "animate-in fade-in-0 zoom-in-95 duration-300"
      )}
    >
      <PersonAvatar name={administrator.name} className={FACE} />
      <div className="grid min-w-0 flex-1 gap-[3px]">
        <p className="truncate type-label text-foreground">{administrator.name}</p>
        <p className="truncate type-meta text-muted-foreground">{how ? `${since} · ${how}` : since}</p>
      </div>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={say("roles.administrators.more", { name: administrator.name })}>
              <MoreHorizontal aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-72">
            <DropdownMenuItem variant="destructive" disabled={Boolean(administrator.blockedReason)} onSelect={onRemove}>
              {isMe ? say("roles.administrators.stepDown") : say("roles.administrators.remove")}
            </DropdownMenuItem>
            {administrator.blockedReason ? (
              <p className="px-2 pt-1 pb-1.5 type-meta text-muted-foreground">{say("roles.administrators.keepTwo")}</p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function EmptySlot({ second, canManage, onAdd, say }: { second: boolean; canManage: boolean; onAdd: () => void; say: Say }) {
  return (
    <li className="flex min-h-[100px] items-center gap-3.5 rounded-surface border-[1.5px] border-dashed border-input px-[22px] py-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-input text-muted-foreground">
        <UserPlus aria-hidden className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-[3px]">
        <p className="type-label text-foreground">
          {second ? say("roles.administrators.second") : say("roles.administrators.another")}
        </p>
        <p className="type-meta text-muted-foreground">{say("roles.administrators.empty")}</p>
      </div>
      {canManage ? (
        <Button size="sm" onClick={onAdd}>
          {say("roles.administrators.add")}
        </Button>
      ) : null}
    </li>
  );
}

// ── History ──

function historyLine(item: AdministratorHistoryItemDto, company: string, say: Say): string {
  const values = { person: item.personName, actor: item.actorName ?? say("changeHistory.someone"), company };
  switch (item.kind) {
    case "activation":
      return say("roles.administrators.history.first", values);
    case "recovery":
      return say("roles.administrators.history.recovered", values);
    case "invitation":
      return say(item.actorName ? "roles.administrators.history.invited" : "roles.administrators.history.invitedPlain", values);
    case "removed":
      return say("roles.administrators.history.removed", values);
    case "stepped-down":
      return say("roles.administrators.history.steppedDown", values);
    default:
      return say("roles.administrators.history.added", values);
  }
}

function History({ items, company, say }: { items: AdministratorHistoryItemDto[]; company: string; say: Say }) {
  const day = useDay();
  return (
    <ol className="grid rounded-surface bg-card px-[26px] py-[22px]">
      {items.map((item, index) => {
        const face = item.kind === "activation" || item.kind === "recovery" || item.kind === "stepped-down" ? null : item.actorName;
        return (
          <li key={`${item.at}-${index}`} className="relative grid grid-cols-[96px_16px_minmax(0,1fr)] gap-3 pb-[18px] last:pb-0">
            <span className="type-meta text-muted-foreground">{day(item.at)}</span>
            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-[5px] size-2.5 rounded-full border-2",
                index === 0 ? "border-primary bg-primary" : "border-muted-foreground bg-card"
              )}
            />
            {index < items.length - 1 ? (
              <span aria-hidden className="absolute start-[112px] top-4 -bottom-1 w-0.5 bg-border" />
            ) : null}
            <div className="flex min-w-0 items-center gap-2">
              {face ? <PersonAvatar name={face} className="size-[22px] text-[0.5rem]" /> : null}
              <p className="type-body text-foreground">{historyLine(item, company, say)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── The add sheet ──

function employeeKeyOf(employeeId: string): string {
  return `E-${employeeId.replace(/-/g, "").toUpperCase()}`;
}

function AddSheet({ open, onOpenChange, onAdded, say }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (candidate: AdministratorCandidateDto) => void;
  say: Say;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<AdministratorCandidateDto | null>(null);
  const [password, setPassword] = useState("");
  const query = search.trim();
  const candidates = useAdministratorCandidates(query, open);
  const add = useAddAdministrator();

  // Jobs come from Core HR, by the same people the search found.
  const client = useMemo(() => createPlatformApiClient(), []);
  const people = useApiQuery(
    [...corePeopleQueryKeys.all(), "administrator-candidates", query],
    (signal: AbortSignal) => createCorePeopleApi(client).people({ q: query || undefined, pageSize: 40 }, signal),
    { enabled: open }
  );
  const jobs = useMemo(
    () => new Map((people.data?.items ?? []).map((person) => [person.employeeKey, person.work?.jobTitle ?? null])),
    [people.data]
  );

  const reset = () => {
    setSearch("");
    setPicked(null);
    setPassword("");
    add.reset();
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!picked || !password) return;
    add
      .mutateAsync({ userId: picked.userId, password })
      .then(() => {
        onAdded(picked);
        close(false);
      })
      .catch(() => undefined);
  };

  const problem = add.error ? problemTypeOf(add.error) : null;
  const failure =
    problem === "password-incorrect"
      ? say("roles.administrators.passwordIncorrect")
      : problem === "password-locked"
        ? say("roles.administrators.passwordLocked")
        : problem === "not-eligible"
          ? say("roles.administrators.notEligible")
          : add.error
            ? say("roles.administrators.notAdded")
            : null;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" showCloseButton={false} className="gap-0 p-0 data-[side=right]:w-[520px] data-[side=right]:sm:max-w-[520px]">
        <form onSubmit={submit} className="flex h-full flex-col">
          <div className="flex items-center gap-3 border-b border-border px-6 py-5">
            {/* eslint-disable-next-line no-restricted-syntax -- the drawing's icon tile radius */}
            <span className="grid size-10 place-items-center rounded-[13px] bg-inlay text-muted-foreground">
              <ShieldCheck aria-hidden className="size-[18px]" />
            </span>
            <SheetTitle className="min-w-0 flex-1 type-section-title">{say("roles.administrators.addTitle")}</SheetTitle>
            <Button type="button" variant="ghost" size="icon" aria-label={say("roles.cancel")} onClick={() => close(false)}>
              <X aria-hidden className="size-4" />
            </Button>
          </div>

          <div className="grid flex-1 content-start overflow-y-auto px-6 pt-1.5 pb-6">
            <div className="grid gap-3 py-5">
              <label className="flex h-[34px] w-full items-center gap-2 rounded-control border border-border bg-background px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
                <Search aria-hidden className="size-4" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={say("roles.administrators.find")}
                  aria-label={say("roles.administrators.find")}
                  className="min-w-0 flex-1 bg-transparent type-control text-foreground outline-none placeholder:text-muted-foreground"
                />
              </label>
              {/* eslint-disable-next-line no-restricted-syntax -- the drawing's person picker (D-25): a face beside each name, greyed invitees; OptionCards has neither */}
              <div role="radiogroup" aria-label={say("roles.administrators.addTitle")} className="grid gap-2">
                {candidates.isLoading && !candidates.data
                  ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-control" />)
                  : null}
                {candidates.data && candidates.data.length === 0 ? (
                  <p className="py-2 type-body text-muted-foreground">{say("roles.nobodyFound")}</p>
                ) : null}
                {(candidates.data ?? []).map((candidate, index) => {
                  const job = candidate.employeeId ? jobs.get(employeeKeyOf(candidate.employeeId)) : null;
                  const on = picked?.userId === candidate.userId && candidate.signsIn;
                  return (
                    <button
                      key={candidate.userId || `invited-${index}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!candidate.signsIn}
                      onClick={() => setPicked(candidate)}
                      className={cn(
                        "flex min-h-12 items-center gap-2.5 rounded-control border bg-card px-3.5 py-2.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
                        on ? "border-primary-ring bg-primary-tint" : "border-border hover:border-input"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]",
                          on ? "border-primary" : "border-input"
                        )}
                      >
                        {on ? <span className="size-2 rounded-full bg-primary" /> : null}
                      </span>
                      <PersonAvatar name={candidate.name} size="sm" className="ms-0.5" />
                      <span className="grid min-w-0 flex-1 gap-px">
                        <span className="truncate type-label text-foreground">{candidate.name}</span>
                        <span className="truncate type-meta text-muted-foreground">
                          {candidate.signsIn
                            ? job
                              ? `${job} · ${say("roles.administrators.signsIn")}`
                              : say("roles.administrators.signsInAlone")
                            : say("roles.administrators.invitedNotYet")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 border-t border-border py-5">
              <Label htmlFor="admin-password" className="type-label">{say("roles.administrators.yourPassword")}</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={problem === "password-incorrect" || undefined}
              />
              {failure ? <p role="alert" className="type-meta text-destructive">{failure}</p> : null}
            </div>
          </div>

          <div className="flex items-center gap-2.5 border-t border-border px-6 py-4">
            <span className="flex-1 type-meta text-muted-foreground">{say("roles.administrators.recorded")}</span>
            <Button type="button" variant="ghost" onClick={() => close(false)}>{say("roles.cancel")}</Button>
            <Button type="submit" disabled={!picked || !password || add.isLoading}>
              {picked
                ? say("roles.administrators.make", { name: firstName(picked.name) })
                : say("roles.administrators.makeSomeone")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ── The page ──

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="type-section-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Settings › Roles › Administrators, as drawn (D-25): who (never fewer than two), what they can do, every grant. */
export function AdministratorsPage({ section }: { section: FusionSettingsSection }) {
  const say = useSettingsSay();
  const { user } = useAuth();
  const company = useTenantSummary().data?.name ?? "";
  const administrators = useTenantAdministrators();
  const history = useAdministratorHistory();
  const remove = useRemoveAdministrator();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TenantAdministratorDto | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const name = say("roles.administrators.name");
  useBreadcrumbLabel("administrators", name);

  const list = administrators.data ?? [];
  const canManage = section.access === "manage" && list.some((item) => item.userId === user?.userId);
  const removingMe = removing?.userId === user?.userId;

  const header = (
    <>
      <Link
        href="/settings/roles"
        className="mb-3 inline-flex items-center gap-1.5 rounded-control-sm type-meta text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-3.5 rtl:rotate-180" />
        {say("roles.back")}
      </Link>
      <h1 className="mb-[26px] flex items-center gap-2.5 type-page-title">
        {name}
        <Lock aria-label={say("roles.administrators.protected")} className="size-3.5 text-muted-foreground" />
      </h1>
    </>
  );

  if (administrators.error && !administrators.data) {
    return (
      <div className="mx-auto w-full max-w-[1240px] px-6 pt-8 pb-16">
        {header}
        <PageError title={say("roles.administrators.didNotLoad")} onRetry={() => void administrators.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-6 pt-8 pb-16">
      {header}
      <div className="grid max-w-[880px] gap-7">
        <Section id="admins-who" title={say("roles.administrators.who")} aside={administrators.data ? <Progress count={list.length} say={say} /> : null}>
          {administrators.data ? (
            <ul className="grid gap-3.5 sm:grid-cols-2">
              {list.map((administrator) => (
                <Slot
                  key={administrator.membershipId}
                  administrator={administrator}
                  company={company}
                  isMe={administrator.userId === user?.userId}
                  canManage={canManage}
                  fresh={fresh === administrator.userId}
                  onRemove={() => setRemoving(administrator)}
                  say={say}
                />
              ))}
              {canManage || list.length < MINIMUM_ADMINISTRATORS ? (
                <EmptySlot second={list.length < MINIMUM_ADMINISTRATORS} canManage={canManage} onAdd={() => setAdding(true)} say={say} />
              ) : null}
            </ul>
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Skeleton className="h-[100px] rounded-surface" />
              <Skeleton className="h-[100px] rounded-surface" />
            </div>
          )}
        </Section>

        <Section id="admins-what" title={say("roles.administrators.whatTheyCanDo")}>
          <div className="flex items-center gap-3.5 rounded-surface bg-card px-[22px] py-[18px]">
            {/* eslint-disable-next-line no-restricted-syntax -- the drawing's icon tile radius */}
            <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-inlay text-muted-foreground">
              <Crown aria-hidden className="size-[18px]" />
            </span>
            <div className="grid min-w-0 flex-1">
              <p className="type-label text-foreground">
                {company ? say("roles.administrators.everythingAt", { company }) : say("roles.administrators.everything")}
              </p>
              <p className="type-meta text-muted-foreground">{say("roles.administrators.line")}</p>
            </div>
            <Lock aria-label={say("roles.administrators.protected")} className="size-3.5 text-muted-foreground" />
          </div>
        </Section>

        <Section id="admins-history" title={say("roles.administrators.historyTitle")}>
          {history.data ? (
            history.data.length ? (
              <History items={history.data} company={company} say={say} />
            ) : null
          ) : history.error ? (
            <PageError title={say("roles.administrators.historyDidNotLoad")} onRetry={() => void history.refetch()} />
          ) : (
            <Skeleton className="h-28 rounded-surface" />
          )}
        </Section>
      </div>

      {canManage ? (
        <>
          <AddSheet
            open={adding}
            onOpenChange={setAdding}
            onAdded={(candidate) => {
              setFresh(candidate.userId);
              toast.success(say("roles.administrators.added", { name: candidate.name }));
            }}
            say={say}
          />
          <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) { setRemoving(null); remove.reset(); } }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {removingMe
                    ? say("roles.administrators.stepDownTitle")
                    : say("roles.administrators.removeTitle", { name: removing?.name ?? "" })}
                </AlertDialogTitle>
                <AlertDialogDescription>{say("roles.administrators.removeBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              {remove.error ? (
                <p role="alert" className="type-meta text-destructive">
                  {problemTypeOf(remove.error) === "too-few-administrators"
                    ? say("roles.administrators.keepTwo")
                    : say("roles.administrators.notRemoved")}
                </p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel>{say("roles.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={remove.isLoading}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!removing) return;
                    remove
                      .mutateAsync({ membershipId: removing.membershipId, version: removing.version })
                      .then(() => setRemoving(null))
                      .catch(() => undefined);
                  }}
                >
                  {removingMe ? say("roles.administrators.stepDown") : say("roles.administrators.remove")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
