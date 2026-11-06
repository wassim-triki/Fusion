import { cn } from "../lib/utils";

export type PageStateDrawingKind = "refused" | "notFound" | "gone" | "crash" | "down" | "offline";

const MOVEMENT = `
.page-state-door { transform-origin: 74px 75px; animation: page-state-door 3.4s ease-in-out .4s 1 both; }
@keyframes page-state-door { 0%, 100% { transform: none; } 40%, 62% { transform: skewY(-3deg) scaleX(.93); } }
.page-state-sway { transform-origin: 108px 132px; animation: page-state-sway 3.6s ease-in-out 1; }
@keyframes page-state-sway { 30% { transform: rotate(-2.4deg); } 65% { transform: rotate(1.8deg); } }
.page-state-settle { animation: page-state-settle 1.4s ease-out .2s 1 both; }
@keyframes page-state-settle { 0% { transform: translateY(-8px); } 60% { transform: translateY(1px); } 100% { transform: none; } }
.page-state-drift { animation: page-state-drift 1.6s ease-out .2s 1 both; }
@keyframes page-state-drift { from { transform: translateX(-5px); } to { transform: none; } }
.page-state-plug { animation: page-state-plug 2.6s ease-in-out infinite; }
@keyframes page-state-plug { 50% { transform: translateX(6px); } }
.page-state-pulse { animation: page-state-pulse 1.8s ease-in-out infinite; }
@keyframes page-state-pulse { 50% { opacity: .3; } }
`;

const SURFACE = "fill-section";
const RAISED = "fill-card";
const INK = "stroke-primary-ink";
const INK_FILL = "fill-primary-ink";

const DRAWINGS: Record<PageStateDrawingKind, React.ReactNode> = {
  refused: (
    <>
      <path d="M28 134h160" />
      <rect className={SURFACE} x="72" y="16" width="72" height="118" rx="7" />
      <g className="page-state-door">
        <path className={RAISED} d="M78 22h60v112H78z" />
        <circle className={INK_FILL} cx="127" cy="80" r="3.5" stroke="none" />
      </g>
      <rect className={RAISED} x="150" y="82" width="28" height="23" rx="5" />
      <path d="M155 82v-7a9 9 0 0 1 18 0v7" />
      <circle className={INK_FILL} cx="164" cy="94" r="2.5" stroke="none" />
    </>
  ),
  notFound: (
    <>
      <path d="M28 134h160" />
      <g className="page-state-sway">
        <path d="M108 134V18" />
        <path className={RAISED} d="M108 30h46l14 13-14 13h-46z" />
        <path className={SURFACE} d="M108 66H66L52 79l14 13h42z" strokeDasharray="4 5" />
        <path className={INK} d="M120 43h24" />
      </g>
      <circle className={INK_FILL} cx="108" cy="16" r="3.5" stroke="none" />
    </>
  ),
  gone: (
    <>
      <path d="M28 134h160" />
      <g className="page-state-settle">
        <rect x="78" y="22" width="60" height="78" rx="7" strokeDasharray="4 6" />
        <path d="M90 42h36M90 56h24" strokeDasharray="3 6" />
      </g>
      <path className={RAISED} d="M62 106h92l-8 28H70z" />
      <path d="M62 106l-10 11h20l6-11M154 106l10 11h-20l-6-11" />
      <path className={INK} d="M96 120h24" />
    </>
  ),
  crash: (
    <>
      <path d="M28 134h160" />
      <path
        className={RAISED}
        d="M64 22h46l-6 18 10 14-10 16 8 14-8 22H64a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z"
      />
      <path d="M70 40h20M70 54h22M70 68h16" />
      <g className="page-state-drift">
        <path className={SURFACE} d="M124 30h30a6 6 0 0 1 6 6v72a6 6 0 0 1-6 6h-37l8-20-8-14 10-16-10-14z" />
        <path className={INK} d="M132 50h16M133 64h13" />
      </g>
    </>
  ),
  down: (
    <>
      <path d="M28 134h160" />
      <g className="page-state-plug">
        <path d="M28 84h28" />
        <path className={RAISED} d="M56 66h20a14 14 0 0 1 14 14v8a14 14 0 0 1-14 14H56z" />
        <path d="M90 76h13M90 92h13" />
      </g>
      <path className={RAISED} d="M160 62h-20a12 12 0 0 0-12 12v20a12 12 0 0 0 12 12h20z" />
      <path d="M128 76h8M128 92h8" />
      <path d="M160 84h28" />
      <g className="page-state-pulse">
        <path className={INK} d="M116 52v-11M104 56l-6-9M128 56l6-9" />
      </g>
    </>
  ),
  offline: (
    <>
      <path d="M28 134h160" />
      <path d="M58 62c28-26 72-26 100 0" strokeDasharray="3 8" />
      <path d="M73 80c20-18 50-18 70 0" strokeDasharray="3 8" />
      <path d="M88 97c11-10 29-10 40 0" />
      <circle className={cn(INK_FILL, "page-state-pulse")} cx="108" cy="113" r="5.5" stroke="none" />
    </>
  ),
};

/**
 * The small drawing of a failure page (B-302), one per state with one movement. Tokens only, so it follows the theme
 * and the company's colour. Its keyframes travel with it: Tailwind drops a hand-written `@keyframes` from production
 * CSS.
 */
export function PageStateDrawing({
  kind,
  size = "page",
  className,
}: {
  kind: PageStateDrawingKind;
  /** `small` is for a card with room and the sign-in layout. */
  size?: "page" | "small";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 216 150"
      fill="none"
      stroke="currentColor"
      strokeWidth={kind === "offline" ? 2.2 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "shrink-0 text-muted-foreground",
        size === "page" ? "h-[150px] w-[216px]" : "h-[82px] w-[118px]",
        className,
      )}
    >
      <style>{MOVEMENT}</style>
      {DRAWINGS[kind]}
    </svg>
  );
}
