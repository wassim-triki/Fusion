# Fusion Design

The design authority for Fusion's user-facing surfaces (shell and the micro-frontends built on `@repo/ds`). It records settled decisions and what breaks when one is undone. Exact values live in `Frontend/packages/ds/src/styles/tokens.css`; this file says how to use them.

**Index:** 1 Overview · 2 Colors · 3 Typography · 4 Layout · 5 Elevation & Depth · 6 Shapes · 7 Components · 8 Writing · 9 Do's and Don'ts (incl. the review checklist)

---

## 1. Overview

**Character: Structured Humanism.** A precise operating system for people: confident, composed, information-rich, unmistakably human. Users should describe it as clear, polished, confident, modern, and surprisingly pleasant for serious HR software. Never generic, sterile, card-heavy, flashy, or obviously stock shadcn.

| Be | Without becoming |
|---|---|
| Bold | Loud |
| Human | Cute |
| Dense | Cramped |
| Refined | Precious |
| Structured | Boxed-in |
| Minimal | Empty |
| Expressive | Decorative |

**The brief, for any design skill or agent:** Fusion is serious HR software that feels friendly and alive, never a legacy enterprise console or a marketing site. Friendly is never cute or playful. People come first: faces, names and real events give it life, and motion responds to what changes. Distinctiveness comes from hierarchy, typography, composition and polish inside a calm operational product, never from hero sections, gradients or bold aesthetic experiments. The goals: cleanliness, a "wow" that comes from polish and clarity, consistency across modules, and UI that explains itself.

### Principles

1. **Start from user intent.** Know why the user is here and design the flow around that job. Choose components after the interaction, not before.
2. **Design for the hunt, not the read.** People arrive with a question and scan for the answer. Composition must lead the eye to it before any sentence is read. Decide what users scan (key facts, status, figures) versus what they read in detail.
3. **The interface speaks first.** Placement, grouping, labels, visible state, defaults and action availability carry meaning. Copy supports; it never compensates for a weak layout. If a screen needs explaining, fix the screen.
4. **Choose the natural interaction, not the convenient CRUD.** Forms, tables, cards, selects and dialogs are tools, not defaults. Org structure is spatial and directly manipulable; repeated comparable records are a table; frequent light edits are inline; finding a known item is search; time-bound work is a timeline. Never map DTO fields one-to-one to inputs.
5. **Hierarchy before decoration,** in this order: position and layout, typography, spacing, contrast and color, surface, border and elevation, decoration. Every screen answers: where am I, what is this, what matters most, what can I do, what needs attention.
6. **One obvious primary path and one dominant state.** The primary task, current state and next action are clear within seconds. Controls, status, counts and results never contradict each other.
7. **Progressive disclosure.** Show what's needed to understand and act first; keep detail available without competing. Complexity may exist; it may not all demand attention at once.
8. **Leverage conventions.** Users expect navigation, actions and flow where they've always been. Break a convention only when it clearly improves the task.
9. **Controls are promises.** A control's visual weight matches its consequence. Reversible actions stay light; consequential or hard-to-reverse ones earn confirmation or review.
10. **Temporary work recedes.** Setup and processing stay truthful while active, then step back so the business result is the focus. Design the common journey first; edge cases must be safe, not dominant.
11. **Design for real content.** Long names, long translations, empty values, many items, one item, contrast on images. A layout that only works with ideal data is not done.
12. **Consistency over local cleverness,** bent on purpose. The system is a shared language; bending a rule is a deliberate, stated choice, never an accident. A pattern that recurs becomes a shared `@repo/ds` pattern instead of a fourth local copy.
13. **Existing UI is evidence, not authority.** "It already looks acceptable" is no reason to keep a weak interaction. Redesign freely instead of propagating it for consistency.

---

## 2. Colors

Tokens: `tokens.css` (`--background`, `--section`, `--card`, `--inlay`, `--popover`, `--primary`, `--primary-tint`, `--primary-ink`, `--success|warning|info|destructive` with `-subtle`, `--border`, `--ring`, `--chart-1..5`, `--identity-1..5`). Dark is the primary theme; light must keep the same hierarchy.

- **Color has four jobs:** identity, hierarchy, semantic state, interaction. Never decoration.
- **Amber is punctuation.** It marks primary actions, selected navigation, focus, key interactive state, progress fills and the one decision that matters. It never colors every heading, border, icon or card. A screen must still feel designed if the amber button disappeared.
- **Semantic colors are consistent** (success, warning, danger, info) and never carry meaning alone: pair with text, icon or position.
- **Neutrals stay perceptibly distinct:** canvas, surfaces, borders, primary, secondary, muted and disabled text. Avoid "gray soup", where everything lives in one narrow gray range.
- **No independent module palettes.** Interest comes from typography, composition, density and information design, not new hues.
- **Identity hues** (`--identity-1..5`) tell apart categories people recognise by colour, today the company values on praise and feedback. A category keeps its hue everywhere (assigned from its id); they never carry state, emphasis or decoration.

---

## 3. Typography

Families load centrally from `@repo/ds` (self-hosted, no CDN, no module font imports):
- **Geist**, the system voice: navigation, controls, labels, tables, operational text, section titles, metrics, data.
- **Lora**, the human voice: page titles, rare display moments, and people-authored prose being read (reflections, feedback, review commentary).
- **Geist Mono**, the identifier voice: codes, IDs, audit values, technical strings only.

Rule: **sans for the system, serif for the human,** visible but scarce. If unsure, use Geist. User-authored text shown in a table, picker, form or compact card stays Geist; it becomes Lora only in a focused reading view.

**Use semantic roles only** (utilities in `tokens.css`; metrics are owned there):

| Role | Use for |
|---|---|
| `type-display` (Lora) | a rare arrival or milestone moment |
| `type-page-title` (Lora) | the single `h1` of a page or workspace |
| `type-section-title` | a major task section |
| `type-subsection-title` | a subdivision inside a section |
| `type-panel-title` | card, panel, dialog, drawer, inspector titles |
| `type-body` / `type-body-secondary` | operational copy / lower-priority copy (hierarchy by color, not smaller size) |
| `type-narrative` (Lora) | sustained people-authored prose, max `70ch` |
| `type-label` | form and control labels, compact descriptors |
| `type-meta` | timestamps, provenance, counts, secondary context |
| `type-meta-strong` | small text that must stand out: a count, a chip's word, a short state |
| `type-mark` | a character or figure inside a small mark (initials or a number in a 24px circle) |
| `type-eyebrow` | a short, meaningful overline, sparingly |
| `type-metric` | counts, percentages, scores (tabular numerals) |
| `type-code` (Mono) | IDs, codes, technical strings |

- Exactly one page title per page; it must be unmistakable from section titles.
- Roles may combine with color, alignment, truncation and width utilities, never with family, size, weight, line-height or tracking overrides. A weight on its own is inline emphasis inside text (`<b>`); stacked on a role or a size it is an override. No `font-serif`, `font-mono` or literal families in modules; a missing role is a DS change.
- Numbers, dates and money stay Geist with tabular numerals where alignment matters.
- Readability: narrative lines 65–75ch; text inputs at least `1rem` on touch layouts; titles wrap without clipping (truncate repeated rows, never the only title); small text only for genuinely secondary information.

---

## 4. Layout

**Density is comfortable-compact.** Operational screens are not marketing pages, and forms are not spreadsheets. Density follows the task: compact for data exploration, moderate and well-grouped for configuration, airy with disclosure for guided setup, readable for self-service.

**Spacing is information.** Tight spacing shows belonging and larger spacing shows separation, with visible rhythm at page, section, component and control level (DS scale only). Large empty areas need a reason; "premium" is not sparse.

**Edges and grouping:**
- **Align to shared edges,** like a receipt, not a collage. Fill a gap by aligning what exists, never by inventing content for it.
- **Differentiate rather than pad.** When a screen reads like a chore, group by the dimension users hunt by (date, status, owner) and vary row anchors (avatar, icon, chip, figure) so items are told apart before they're read. More whitespace is not the fix.
- **Dissolve containers.** Group with alignment, columns, a single rule and spacing first. No borders on borders, no cards in cards.

**Page anatomy:** context or breadcrumb when meaningful → header (title; a description only when it adds what the title can't) → primary action plus limited secondary actions → status or context → filters or local navigation → main content → pagination or supporting detail. Don't invent a new page structure per feature, and don't narrate under the title.

**Document + sidebar** (a page about one entity: a plan, a record, a review):
- Frame objects, never columns. The main column is a section heading over a list of objects on the canvas; it ends where its content ends.
- The sidebar is unframed: property groups separated by hairlines, sticky (`lg:sticky lg:top-6`), never height-matched.
- Never stretch to fill: no `flex-1` last child, no stretched grid cells, no `mt-auto` footers to meet another column.
- Primary actions live in the page header; a section's action sits on that section's heading.
- The sidebar carries only what the main column doesn't. A block that only balances height is deleted.
- Pages about scanning or comparing collections (roster, queue) are one full-width column of unframed sections; context sits beside the section where it's acted on.

**Navigation represents jobs, not entities.** Feature ≠ page, entity ≠ nav item, permission ≠ persona. A sidebar item must be a distinct, recurring job people would name ("I need to go to X"); entities, scopes and states live inside an existing job. Sparse navigation is not a defect; never add entries to fill a sidebar. Users must always see the current module, location and selected item, and a way back; active state is unmistakable; breadcrumbs only when hierarchy is meaningful; tabs switch sibling views only; no hover-only critical navigation.
- **Overview** answers only: what state is this in, what needs me, where do I go next. Every section ends in a workspace or record; no roster tables, full trees, forms or dashboards. Sections compose from capabilities and state, never a persona switch.
- **One canonical record per object,** addressed by its owning context (e.g. `{cycleId, objectiveId}`), never by "current cycle". Reading a record is not entering the workspace that manages it.
- Performance's shape: Overview · My Plan · Team Performance · 1:1s · Feedback · Reviews, with Administration (Cycle, Settings) apart. 1:1s and Feedback belong to people, not cycles: they don't follow the cycle switcher.

**Responsive:** preserve the primary task and critical actions; reflow before shrinking text; collapse secondary controls; tables scroll inside their frame, never the page; no essential info behind unexplained icons.

---

## 5. Elevation & Depth

**Depth is tone, and tone only lifts.** Each nested level is one step lighter than its parent:

| Tone | Utility | For |
|---|---|---|
| Canvas | `bg-background` | the page itself, never nested |
| Section | `bg-section` | page-level frames grouping a page area |
| Card | `bg-card` | objects: rows, cards, tables, rails, inspectors |
| Inlay | `bg-inlay` | blocks set into a card: notes, fact groups, editors, table headers, chips at rest |
| Overlay | `bg-popover` | dialogs, sheets, drawers, menus, floating bars (with shadow) |

1. A child is always a higher tier than its parent. Tiers may be skipped, never reversed.
2. No fourth neutral tone: inside an inlay, separate with dividers.
3. Peers share a tone.
4. Container fills are opaque tokens. Translucent neutrals (`bg-muted/30`, `bg-card/60`) are only for state variants, small marks and DS controls; lint warns at rest.
5. Groups inside an overlay are unfilled (border or divider). Sticky footers in an overlay take `bg-popover`.
6. Empty and drop placeholders have no fill: a dashed border on the parent's tone.
7. Emphasis is not a tone: semantic tints mark state on top of the right tier, never replace it.
8. Controls carry their own lift via DS variants; never paint them with a surface tone.
9. Section, card and inlay frames have no border: the tone step is their edge (`Card` ships borderless). Borders stay for controls, chips and picks at rest, dividers inside a frame, overlays, dashed placeholders and state rings (`border-primary-ring`).

**Shadows mean real elevation** (`shadow-raised`, `shadow-overlay` only): dropdowns, dialogs, popovers, dragged objects. A shadow must answer "elevated above what?"; if nothing, remove it. Static content stays flat; nested elevation is rare. Borders clarify structure, state or separation; not every container gets one.

---

## 6. Shapes

**Corners are squircles** (continuous curvature, `corner-shape: squircle`), calibrated a step rounder than the ChatGPT desktop app. At half a control's height a squircle reads as a soft button, not a pill. Unsupported browsers fall back to smaller circular radii. Screens never set corner shape or tier themselves.

**Radius is a role, never a number** (`rounded-<role>`, values in `tokens.css` `--corner-*`):

| Role | Use |
|---|---|
| `surface` | cards, grouped settings, standalone rows, alerts, popovers, dialogs, empty states, toasts (size-independent) |
| `control` | buttons, inputs, selects, chips, icon buttons, tabs, tooltips, icon wells, containers nested in a padded surface |
| `control-sm` | controls under 32px tall |
| `menu` | dropdown, select, combobox, command, navigation-menu panels |
| `inset` | items inside a padded menu |
| `nested` | items inside a control-sized group (tab triggers, segmented thumbs) |
| `detail` | checkboxes, swatches, tiny marks |
| `full` | capsule semantics only: switch, avatar, status dots, progress |

- Hierarchy lives in the corner: surface > menu > control > nested > detail. Nested corners are concentric (child = parent − padding); a control is always visibly tighter than its container.
- Pills are a semantic exception (status, tags, segmented choices), not the default shape.
- Third-party chrome (chart tooltips, React Flow controls) uses `var(--radius-<role>)` too.
- Raw Tailwind radius steps and arbitrary values are banned in owned apps (lint-enforced).

---

## 7. Components

**Layers:** tokens → accessible primitives (shadcn/Radix) → Fusion components (`@repo/ds`) → product patterns → screens. Primitives give accessibility and behavior, not identity; default shadcn composition is never a design decision. Prefer, in order: an existing Fusion pattern, a Fusion component, an approved primitive, a new shared pattern (when recurrent), and a local one-off only when the need is truly local. Missing from the DS is not permission for generic UI: design the right thing, build it locally from accessible primitives in Fusion's character, and promote it once it recurs. `@repo/ui` is not reintroduced into migrated surfaces.

**Actions.** One primary per decision area, visually dominant. Secondary is visibly secondary; quiet actions don't compete; destructive is reserved for real risk and separated from safe actions. Never a row of equal buttons where wording alone sets priority. Icon-only only for conventional actions, always with an accessible name.

**Forms.** Guided, not bureaucratic: meaningful groups, visible labels (placeholders aren't labels), consistent required/optional, validation next to the field. Helper text only for a real constraint, consequence or ambiguity, never to restate the label; a field that keeps needing help needs a better label or control. Long forms use sections, disclosure and steps only for genuine sequential commitment; don't wizard a short form. Make clear whether a change is saved immediately, staged, submitted for approval, destructive or reversible. Reach for conditional fields, inline options, summaries and live previews before stacked `label | input` rows.

**Tables.** First-class, built on `<DataTable>` from `@repo/ds/data-table` (TanStack Table v9), never hand-rolled. Use a table when comparison matters; not when hierarchy, sequence or direct manipulation is the point.
- **One frame:** toolbar, `bg-inlay` header, rows and footer in one `bg-card` object; loading, empty and no-match states render inside it, so the table never changes shape.
- **One grid:** every band shares the horizontal inset. Fixed heights: toolbar 56, header 40, rows 56, footer 48.
- **One control shape:** search leads, then filter chips, actions pinned to the end; 32px controls with the control radius; no pills, no sort select, no separate views control.
- **Filters are chips** from one model (`useDataTable({ filters })`). A `pinned` field is the table's primary question (always shown, resets to "All"). "Filter" adds one via the DS dropdown (options submenu or date popover). Active filters read as sentences, edit in place, apply at once. Only options and date-range kinds. A filter that mirrors another control drives that control's state.
- **Headers:** sentence case, muted, click to sort; the default sort puts what needs action first.
- **Cells:** `DataTableCellStack` (entity + detail line), `StatusBadge`, `DataTableCellNumber` (tabular figures), `DataTableCellProgress` (bar + figure), `DataTableCellEmpty` (faint dash or a short note). A cell never restates another column.
- **Rows:** a row that opens something is clickable and ends in a chevron or a row menu, never both. Only a decision the user owns earns a button. Emphasize with one channel.
- **Accent:** amber marks state only (active count, sort arrow, current page, hover chevron, progress, the one decision button).
- **Footer:** range left ("1–10 of 14 people"), rows-per-page and pager right; controls disable rather than disappear.
- "No matches + Clear filters" differs from an empty dataset; skeletons use the live columns; below `minWidth` the table scrolls in its frame.

**Choices** come from `@repo/ds/choice`, never a hand-made group of pressed buttons or radios (lint-guarded). Pick by the job:
- **Segmented:** one of 2–4 short options, always visible: a view switch (with icons), a setting like cadence or language, a direction.
- **ChoiceMatrix:** many rows picking from the same few options; each option is a column said once.
- **FilterChips:** narrowing a list or feed, one at a time (optionally clearable) or several.
- **QuickPicks:** shortcuts beside a field that fill it; the field holds the answer.
- **OptionCards:** one choice whose options each need a line (or a picture) to explain.

Selection is an amber tint everywhere. A real one-off toggle (a chart node, a single on/off filter) or a picker whose options carry their own meaning in colour (progress status, competency values, the rating scale) stays bespoke, with a lint-disable line saying why.

**Search and filters.** Searches with different scopes must look different. Active filters are visible and clearable; advanced ones use disclosure; filtered-empty differs from truly empty.

**States** (every async or stateful view): loading, empty, no results, success, warning, error, partial failure, disabled, permission denied.
- **Loading:** the least disruptive form. Local progress for actions, stable skeletons (`PageLoading`, `PageListSkeleton`) for data, a full-page spinner as a last resort. The app frame always renders; loading happens only in the content area. Long work shows real activity, never fake progress or a static "Processing…".
- **Empty:** a precise state, one short line if needed, one relevant action. No product explanations, oversized illustrations or motivational filler.
- **Error:** what happened, what it affects, what to do. No vague "Something went wrong" when the cause is known.
- **Success:** lightweight confirmation; never a dialog for routine actions.

**Confirmation.** Only for destructive, hard-to-reverse, high-impact, permission-sensitive or surprising actions. Prefer undo when a safe model exists. Copy names the action and its consequence, never "Are you sure?".

**Overlays by task depth.** Dialog: confirmation, short focused tasks, compact edits. Drawer: contextual inspection or light editing without losing the list. Dedicated page: deep workflows, complex editing, multi-section tasks. Don't force complex forms into dialogs.

**Status.** Consistent across modules. Badges for compact lifecycle, approval or risk states only, never ordinary text. A pill is one treatment, not the default: status can also be weight, an icon, a leading dot or a row treatment. Routine success is transient, not a permanent badge. Important state never hides in muted metadata.

**Visuals over labels.** Prefer a shape, mark, diagram, chip or state that registers instantly over text that must be read: a timeline over a date range, a filled segment over "2 of 3". The visual must encode meaning; a glyph beside every label is decoration.

**Icons.** One set per app through its adapter (Performance and Platform: Hugeicons via `src/lib/icons.tsx`, lint-guarded; DS chrome stays Lucide for now). Never mix sets in one composition. An icon must aid recognition, state, navigation or discoverability, or it goes. Same concept, same icon everywhere. Default `size-4`, baseline-aligned, text-colored unless semantic. Unfamiliar actions keep a visible label.

**Motion is functional.** It shows what changed, preserves orientation, or answers an action: expand and collapse, overlays, state changes, reordering, progress, revealing a control when it's needed (progressive disclosure). Use the DS duration and easing tokens (`--duration-*`, `--ease-*`) and plain `animate-*` utilities. Quick, controlled, coherent; never slow decoration, bounce, simultaneous unrelated movement, or anything that delays interaction. Nothing floats up on hover and nothing moves perpetually.

**People are people.** Person-centric surfaces use a consistent identity grammar: display name in a real type role, a quiet secondary identifier, meaningful current context, restrained initials (photos only when they exist). No invented avatars or illustrations.

**Permissions: hide, don't deny.** Never show an action that fails only after submission. Disable only when seeing the unavailable capability helps understanding; otherwise hide it. Sensitive actions show their impact; tenant context is never ambiguous; roles use human language.

**AI moments.** Sparkles belongs only to deliberate AI-interpretation experiences (e.g. organization import). It never means "new", "smart" or "premium". AI shows through the result, not a motif.

**Accessibility is built in:** keyboard operation, visible focus, semantic HTML, accessible names, contrast that meets standards, state never by color alone, usable hit targets, heading order that matches the hierarchy, disabled distinct from read-only. Don't break primitives' built-in accessibility with styling.

---

## 8. Writing

Product language, not assistant language: concise, specific, factual, calm, human, action-oriented, in the user's domain. Words exist to make the UI easier to understand and use; each element does one job. If a sentence can be removed without losing understanding, confidence, safety or recovery, remove it.

- **Name things from the user's side.** "Notifications", not "webhook config". No DTO, API, service or permission-internal terms. Keep one name per concept; no synonyms for variety.
- **Actions say what happens:** "Save changes", "Send invitation", "Approve objectives"; never "OK", "Yes", "Submit", "Continue" or "Confirm" when the outcome can be named. An action keeps its name through the flow ("Publish" → "Published").
- **Labels carry meaning.** Descriptions and helper text only for a non-obvious constraint, a consequence, a likely misunderstanding, or information needed to decide; never because a component has a `description` prop.
- **Sentence case** for titles, labels, buttons and headers. Active voice.
- **Errors:** what happened, what it affects, what to do. Factual, no apology or drama.
- **Empty states:** state, one line if needed, one action.
- **Warnings and confirmations** name the real risk; routine actions get no ceremony.
- A human sentence is welcome when a transition, outcome or recovery needs it: plain, specific, proportional. Never narration, simulated conversation or enthusiasm.

**Never write (AI and marketing tells):**
- em dashes in UI copy;
- negative parallelisms: "not X, but Y", "it's not just X, it's Y", "no X, no Y, just Z";
- rhythmic triplets ("fast, simple, and powerful") and stacked adjectives;
- hype and filler: seamless, effortless, powerful, robust, smart, intuitive, unlock, elevate, streamline, leverage, empower, delve, journey, game-changing;
- softeners: simply, just, easily;
- assistant phrasing: "Let's get started", "Here's what you can do", "You're all set!", "We've made it simple to…";
- exclamation marks and emoji;
- a subtitle under every heading, helper text restating the label, banners restating visible state, tooltips on obvious controls, step-by-step narration;
- "Title: subtitle" headings and ALL-CAPS labels, unless the role (`type-eyebrow`) calls for it.

---

## 9. Do's and Don'ts

**Defaults to avoid.** Each is valid only when chosen for a reason, never by default:
- **Generic admin:** every section a bordered card; component examples copied into screens; equal-weight blocks with no hierarchy.
- **Card soup and bento:** cards in cards, equal KPI tiles, three equal feature cards, symmetric grids for asymmetric importance, every settings group floating alone. Boxed columns height-matched with filler (use document + sidebar).
- **Rounded-rectangle monoculture:** every object the same soft rectangle; one radius everywhere.
- **Gray soup:** canvas and surfaces flattened to one value; timid contrast; tiny text everywhere; borders around every group.
- **One-accent syndrome:** black, white and gray plus amber doing all the work.
- **Pastel-pill syndrome:** every state a tinted pill sprinkled for color.
- **Stock typography:** hierarchy reduced to `text-sm font-medium text-muted-foreground`; one accented word in a headline; ALL-CAPS eyebrows above every heading.
- **Side-stripe accents:** a thick coloured left or right border on a card, row or callout to carry status, AI or emphasis. Use the status badge, a mark or structure instead.
- **Decorative chrome:** gradients (purple-blue or otherwise), glows, orbs, glass without purpose, neon, dot grids, fake terminals, decorative shadows on static content.
- **Second-wave "less AI" looks:** warm cream with a serif and terracotta accent; near-black with one acid-green accent; broadsheet hairlines with zero radius; tinted near-black for black; "A · B · C" meta strings; "WORD — fragment" labels; a "→" appended to every link; numbered 01/02/03 markers on content that isn't a sequence.
- **Marketing composition in the app:** hero headings, centered sections, icon-tile grids.
- **Ledger detail pages:** heading, divider, four equal facts, label/value rows repeated down the page. Decide what defines the entity and show that.
- **Generated forms:** stacked `label | input` rows mirroring the data model.
- **Icon filler:** an icon beside every heading; `icon + heading + muted sentence` blocks.
- **Motion fluff:** fade-and-slide on every section, hover lifts, bouncing icons, fake progress.
- **Component improvisation:** local button variants, arbitrary radius, shadow, spacing or color, custom badge semantics, ad hoc page headers.
- **Weak action hierarchy:** five equal actions, hidden critical actions, destructive next to safe, success modals.

**Do:**
- Concentrate character in one or two places per screen; keep everything around them quiet.
- Make the most important thing look most important through width, weight, position and contrast, not color alone.
- Let emphasis come from contrast with neighbours: one channel per signal, neighbours quiet.
- Strengthen composition, typography and shared patterns when a screen feels bland; never add decoration.

**Review checklist** (when a visual review is requested; passing lint and tests does not answer these):
- Can the main task and current state be grasped in about three seconds, before reading a sentence?
- Is the page title dominant and supporting information visibly secondary?
- Do containers earn their boundaries? Is anything nested or equal-weight without reason?
- Is the hierarchy from type roles, or does it all read as `text-sm font-medium`?
- Are canvas, surfaces and overlays distinct in dark and light?
- Would it still feel designed without the amber? Are pastels or icons used as decoration?
- Do items share edges and differ by anchors, so they're told apart before they're read?
- Is any sentence, label or tooltip replaceable by a shape, mark or state? Is anything repeated just because the data exists?
- Are loading, empty, no-results, error and success states designed?
- Does async work visibly feel active, and is every animation functional?
- Could someone name shadcn, Tailwind or the icon library from this screen? Could it belong to any HR template? If yes, it isn't finished.

