"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Briefcase, Building2, ChevronDown, ChevronUp, Crosshair, Mail, MapPin, MoreHorizontal, TreePalm, Users } from "lucide-react";
import type { OrgChartPersonDto } from "@repo/api";
import { usePhoto } from "@repo/api/query";
import { Spinner, cn } from "@repo/ds";
import { useFormat } from "@repo/ds/lib/use-format";
import { isPlaceholder, openRolesOf, type LensKey, type LensValue, type OrgTree } from "../model/org-chart-model";

export interface CardContext {
  tree: OrgTree;
  lensKey: LensKey;
  lensOf: (id: string) => LensValue | null;
  folded: Set<string>;
  /** Leaders whose team is loading (a windowed chart). */
  loading: Set<string>;
  onCopyEmail: (person: OrgChartPersonDto) => void;
  onCentre: (id: string) => void;
  onToggleFold: (id: string) => void;
}

/** Card chips and meta show unit and place, unless a lens other than division colours the chart. */
const showsPlace = (lens: LensKey) => lens === "division" || lens === "none";

/** `person` stands in for someone not loaded on a windowed chart (a search hit). */
export function OrgAvatar({ id, size, ctx, person: shown }: {
  id: string;
  size: "xxl" | "xl" | "md" | "sm" | "xs";
  ctx: CardContext;
  person?: OrgChartPersonDto;
}) {
  const person = ctx.tree.people.get(id) ?? shown;
  const lens = ctx.lensOf(id);
  return (
    <span
      aria-hidden
      className={cn("oc-av", `oc-${size}`, !lens?.color && "oc-neutral", id === ctx.tree.viewerKey && "oc-you", person?.photoUrl && "oc-photo")}
      style={lens?.color ? ({ "--h": lens.color } as CSSProperties) : undefined}
    >
      {person?.photoUrl ? <OrgPhoto photoUrl={person.photoUrl} initials={person.initials} /> : person?.initials}
    </span>
  );
}

/** Initials until the photo has loaded; only people with a photo touch the photo cache. */
function OrgPhoto({ photoUrl, initials }: { photoUrl: string; initials: string }) {
  const photo = usePhoto(photoUrl);
  // An object URL from the API client: nothing for next/image to optimise.
  // eslint-disable-next-line @next/next/no-img-element
  return photo ? <img src={photo} alt="" draggable={false} /> : <>{initials}</>;
}

/** You, then what HR sees coming (Joins, Moves, Leaves with the date), then New. */
function Badge({ person, ctx }: { person: OrgChartPersonDto; ctx: CardContext }) {
  const t = useTranslations("orgChart.card");
  const format = useFormat();
  if (person.employeeKey === ctx.tree.viewerKey) return <span className="oc-badge">{t("you")}</span>;
  const flag = ctx.tree.flags.get(person.employeeKey);
  if (flag) {
    return (
      <span className={cn("oc-badge", flag.kind === "leave" ? "oc-out" : "oc-up")}>
        {t(flag.kind, { date: format.date(flag.date) })}
      </span>
    );
  }
  if (person.isNew) return <span className="oc-badge oc-new">{t("new")}</span>;
  return null;
}

/** On leave today: "On leave · back <day>" under the job, in the leave colour (B-229). */
function OnLeave({ person, className }: { person: OrgChartPersonDto; className?: string }) {
  const t = useTranslations("changes.badge");
  const format = useFormat();
  if (!person.leave?.now) return null;
  return (
    <span className={cn("oc-lv", className)}>
      <TreePalm aria-hidden />
      {person.leave.back ? t("onLeave", { date: format.date(person.leave.back) }) : t("onLeaveOpen")}
    </span>
  );
}

function Actions({ person, ctx }: { person: OrgChartPersonDto; ctx: CardContext }) {
  const t = useTranslations("orgChart.card");
  return (
    <span className="oc-acts">
      {person.workEmail ? (
        <button type="button" className="oc-ib rounded-control-sm" aria-label={t("copyEmail")} title={t("copyEmail")}
          onClick={(event) => { event.stopPropagation(); ctx.onCopyEmail(person); }}>
          <Mail />
        </button>
      ) : null}
      <button type="button" className="oc-ib rounded-control-sm" aria-label={t("centre")} title={t("centre")}
        onClick={(event) => { event.stopPropagation(); ctx.onCentre(person.employeeKey); }}>
        <Crosshair />
      </button>
    </span>
  );
}

function LensChip({ lens }: { lens: LensValue | null }) {
  if (!lens) return null;
  return (
    <span className="oc-chip">
      <i className="oc-swatch" style={{ background: lens.color ?? "var(--muted-foreground)" }} />
      {lens.label}
    </span>
  );
}

/** A team leader: portrait card, the avatar breaking the top edge, the team's faces in an inlay band. */
export function LeadCard({ id, ctx }: { id: string; ctx: CardContext }) {
  const t = useTranslations("orgChart.card");
  const person = ctx.tree.people.get(id)!;
  const kids = ctx.tree.kids.get(id) ?? [];
  const faces = kids.filter((kid) => !isPlaceholder(kid) && !ctx.tree.ghosts.has(kid));
  const open = openRolesOf(ctx.tree, id).length;
  // Five faces, or four and a count, so the strip never runs into the team figures.
  const shown = faces.length > 5 ? 4 : 5;
  const isFolded = ctx.folded.has(id);
  const unopened = ctx.tree.unopened.has(id);
  const top = person.managerKey === null;
  const strong = (chunks: ReactNode) => <b>{chunks}</b>;
  return (
    <>
      <OrgAvatar id={id} size={top ? "xxl" : "xl"} ctx={ctx} />
      <Badge person={person} ctx={ctx} />
      <Actions person={person} ctx={ctx} />
      <span className="oc-nm">{person.displayName}</span>
      {person.jobTitle ? <span className="oc-ti">{person.jobTitle}</span> : null}
      <OnLeave person={person} className="oc-ti" />
      <div className="oc-chips">
        {showsPlace(ctx.lensKey) ? (
          <>
            {person.unit ? <span className="oc-chip"><Building2 />{person.unit.name}</span> : null}
            {person.workLocation ? <span className="oc-chip"><MapPin />{person.workLocation}</span> : null}
          </>
        ) : (
          <LensChip lens={ctx.lensOf(id)} />
        )}
      </div>
      <div className="oc-team rounded-control">
        <span className="oc-strip">
          {faces.slice(0, shown).map((kid) => <OrgAvatar key={kid} id={kid} size="xs" ctx={ctx} />)}
          {faces.length > shown ? <span className="oc-plus">+{faces.length - shown}</span> : null}
        </span>
        <span className="oc-k">
          {person.totalCount > person.directCount
            ? t.rich("teamAll", { direct: person.directCount, total: person.totalCount, b: strong })
            : t.rich("team", { direct: person.directCount, b: strong })}
          {open ? t.rich("open", { count: open, b: strong }) : null}
        </span>
      </div>
      {kids.length || unopened ? (
        <button type="button" className="oc-fold" aria-expanded={!isFolded} aria-label={isFolded ? t("showTeam") : t("foldTeam")}
          title={isFolded ? t("showTeam") : t("foldTeam")}
          onClick={(event) => { event.stopPropagation(); ctx.onToggleFold(id); }}>
          {ctx.loading.has(id) ? <Spinner className="size-3" aria-label={t("loadingTeam")} />
            : isFolded ? <><ChevronDown />{unopened ? person.directCount + open : kids.length}</> : <ChevronUp />}
        </button>
      ) : null}
    </>
  );
}

/** Everyone who doesn't lead a team: avatar, name, title, then place and start year. */
export function PersonCard({ id, ctx }: { id: string; ctx: CardContext }) {
  const t = useTranslations("orgChart.card");
  const person = ctx.tree.people.get(id)!;
  const dotted = person.dottedLineManagerKeys.map((key) => ctx.tree.people.get(key)).filter(Boolean);
  const facts = [
    person.workLocation,
    person.startYear ? t("since", { year: String(person.startYear) }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <>
      <OrgAvatar id={id} size="md" ctx={ctx} />
      <Badge person={person} ctx={ctx} />
      <Actions person={person} ctx={ctx} />
      <span className="oc-t">
        <b>{person.displayName}</b>
        {person.jobTitle ? <span>{person.jobTitle}</span> : null}
        <OnLeave person={person} />
        {showsPlace(ctx.lensKey) ? (
          facts || dotted.length ? (
            <span className="oc-m">
              {person.workLocation ? <MapPin /> : null}
              {facts}
              {dotted.map((manager) => (
                <span key={manager!.employeeKey} className="oc-dl" title={t("dotted", { name: manager!.displayName })}>
                  {facts ? "· " : ""}<MoreHorizontal />{manager!.displayName.split(" ")[0]}
                </span>
              ))}
            </span>
          ) : null
        ) : ctx.lensOf(id) ? (
          <span className="oc-m">
            <i className="oc-swatch" style={{ background: ctx.lensOf(id)!.color ?? "var(--muted-foreground)" }} />
            {ctx.lensOf(id)!.label}
          </span>
        ) : null}
      </span>
    </>
  );
}

/** A manager above the focus, as a compact pill. */
export function ChainPill({ id, ctx }: { id: string; ctx: CardContext }) {
  const person = ctx.tree.people.get(id)!;
  return (
    <>
      <OrgAvatar id={id} size="sm" ctx={ctx} />
      <span className="oc-t">
        <b>{person.displayName}</b>
        {person.jobTitle ? <span>{person.jobTitle}</span> : null}
      </span>
    </>
  );
}

/** An open role: a dashed card with a briefcase well, in its manager's line. */
export function RoleCard({ id, ctx }: { id: string; ctx: CardContext }) {
  const t = useTranslations("orgChart.role");
  const format = useFormat();
  const role = ctx.tree.roles.get(id)!;
  const when = role.targetStartDate ? format.parts(role.targetStartDate, { month: "short", year: "numeric" }) : null;
  return (
    <>
      <span className="oc-well rounded-control"><Briefcase /></span>
      <span className="oc-t">
        <b>{role.jobTitle}</b>
        <span>{role.status === "OnHold" ? t("onHold") : when ? t("hiringFrom", { date: when }) : t("hiring")}</span>
        {role.unit ? <span className="oc-m"><Building2 />{role.unit.name}</span> : null}
      </span>
    </>
  );
}

/** People outside the viewer's slice of the chart, as a count; on a windowed chart, the rest of a team to load. */
export function MoreCard({ id, ctx }: { id: string; ctx: CardContext }) {
  const t = useTranslations("orgChart.card");
  const parent = id.slice("more:".length);
  const count = ctx.tree.folds.get(parent) ?? 0;
  const loadable = ctx.tree.loadable.has(parent);
  return (
    <>
      <span className="oc-well rounded-control">{ctx.loading.has(parent) ? <Spinner className="size-5" aria-label={t("loadingTeam")} /> : <Users />}</span>
      <span className="oc-t">
        <b>{t("more", { count })}</b>
        <span>{loadable ? t("moreLoad") : t("moreDetail")}</span>
      </span>
    </>
  );
}
