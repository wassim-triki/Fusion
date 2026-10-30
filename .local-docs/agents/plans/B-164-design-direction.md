# B-166 — Design direction for the screens explorer

Read this before drawing anything for B-164, so the first generation already heads the right way. `DESIGN.md` stays the authority for rules and tokens; this file says which way to lean inside them, what to copy and what never to copy.

## 1. Where we're going

Friendly and simple to use, the way BambooHR feels; never a newspaper or a legacy enterprise console. Alive (things respond when they change) and self-explanatory, inside Fusion's theme rules. One language and one design across every surface, since checkpoint 1's complaint was that each surface has its own. Nothing bland: no data dumps of rows with meta. Core HR designed before October 2026 was judged messy and vibe-coded, so it isn't a reference.

## 2. What friendly means here, concretely

These levers work inside `DESIGN.md`; none needs a new colour, a gradient or decoration.

1. **People first.** Wherever people appear, show people: a face or initials, the name in a real type role, their job and team. A list of people reads as people, not as a table of records, unless comparing is the job. The person page is the classic band with a large photo, tabs in the band and a left rail (accepted direction, B-127).
2. **Life comes from real events, not ornament.** Joiners with their faces, work anniversaries, someone back from leave, a change taking effect on Monday, an invitation accepted. Home and the Team page are made of these. The content is the decoration.
3. **Motion that answers.** "Moving" means the product responds: the app recolours as a company picks its colour, the org chart morphs as the time slider moves, a panel slides in over the list it belongs to, a guide step ticks itself off when done. Quick and purposeful, never ambient or decorative (`DESIGN.md` §7 Motion).
4. **A warm voice in type.** Lora is Fusion's human voice: page titles and people-authored text. That is our equivalent of BambooHR's warm headline font (they chose Fields because it "feels warm, it feels inviting, but it also doesn't feel childish"). Geist carries everything operational.
5. **Soft and rounded, already.** Squircle corners and the tone ladder give the soft, lifted surfaces BambooHR reached in its 2024 redesign ("corners are rounded, fonts are switched, and the navigation bar has migrated"). Use the roles; don't invent rounder.
6. **Air where people read, density where they compare.** People pages, Home, setup and settings breathe; reports and long lists are compact tables. Never a wall of label/value rows.
7. **Self-explanatory by structure.** One obvious primary action per screen. Empty pages show what will be there and the one next step. Disclosure over explanation. Plain words from one glossary.
8. **The company's colour, not only amber.** A company's accent (Make it yours) recolours primary actions and selection. Every mock must still read well when amber is swapped for another accent, so identity never leans on amber.

## 3. Never this

`DESIGN.md` §9 has the full list. The ones that hit Core HR hardest:
- ledger detail pages: heading, divider, label/value rows down the page;
- newspaper layout for people: hairline-ruled text columns, a calm header with a fact strip;
- the right sidebar by default (pick the layout from the screen's job, not from My Plan);
- boxed columns height-matched with filler, card soup, equal KPI tiles;
- coloured side stripes on cards or rows;
- caption sentences under headings, helper text restating labels, "icon + heading + muted sentence" blocks;
- generated forms mirroring the data model, tabs inside tabs, admin-console density;
- pastel pills sprinkled for colour, gray soup, stock shadcn composition;
- marketing composition (hero headings, centred sections, icon-tile grids), gradients, glows.

## 4. References

**Use: accepted in the last month** (look at them live in Carthage · Mid-year through the shell, dark, 1440×900):

| Surface | Why it's a reference |
| --- | --- |
| People org chart (`/core/org-chart`, B-094) | The user's favourite: people-first cards, opens around you, lively. [explorer](https://claude.ai/artifact/2iA3tx4XuHyv1KoMtTyNfd) |
| Structure chart (Organization) | "Not bad"; keep its language for units. |
| Person page band (`/core/people/{id}`, B-127) | The accepted "more life" direction: band, large photo, tabs, left rail. |
| Change panel (B-139) | One panel for changes with records, cancel and edit. |
| Performance: My Plan and the objective drawer | "We crafted that good": the document grammar at its best, for a plan. |
| Performance: 1:1s and Feedback (B-087) | Rebuilt after "bland" feedback; approved "a lot better". |
| Performance: alignment map (B-070 slice 2b) | "Kinda the wow factor." |
| Settings boards (B-071, `plans/B-071-settings-explorer.html`) | Approved settings language; Make it yours extends it. |
| Choice controls (B-162, `@repo/ds/choice`) | "Perfect, approved." |
| Notifications (B-002) | Bell, inbox and preferences, accepted. |

**Explorer precedents** (format, not look): the org chart explorer above (working prototype on real data), `plans/B-071-settings-explorer.html`, `plans/B-002-notifications.html`.

**Don't use as design reference.** Every Core HR surface built before October 2026: Core HR Overview, the People list, Workforce access, Getting started, the import stages, Company settings, the Administrators page, the record tabs other than the B-127 band. The same goes for anything still on `@repo/ui` and for colleagues' modules. They are evidence of content and behaviour only. Their screenshots in `plans/B-164-screens/` are for verdicts, never for styling.

**Outside** (for the feel; the brief's §3 has the product study):
- **BambooHR:** friendly, rounded and warm. A left icon nav that collapses to icons. Photos everywhere, Home with who's out and celebrations, a profile with a photo band and tabs. Companies pick their own colour. ([behind the 2024 redesign](https://www.bamboohr.com/resources/ebooks/behind-the-scenes-ui-2024), [new interface](https://www.bamboohr.com/product-updates/new-user-interface), [Home and insights](https://www.bamboohr.com/product-updates/introducing-insights-dashboard-and-a-redesigned-home))
- **HiBob:** a feed-like Home with updates, events and birthdays; rich, personal profiles; praise on the feed. Reviewers praise the Home and its consistency across modules; some find the colours loud, so we keep Fusion's palette. ([TechRadar review](https://www.techradar.com/pro/hibob-hr-software-review))
- **Linear, Notion, Stripe:** settings that preview live, speed, calm polish.

## 5. Rules that still hold

These are the user's "very simple rules about the themes" and the recorded taste. Each is in `DESIGN.md` or a memory:
- Dark first, at 1440×900. Light keeps the same hierarchy.
- The tone ladder: canvas → section → card → inlay, overlays on popover. Opaque fills, child always lighter.
- Radius roles only (squircles).
- Type roles only: Geist for the system, Lora for the human voice, Geist Mono for identifiers.
- Amber is punctuation.
- Icons are Hugeicons.
- Tables come from the DataTable kit, choices from `@repo/ds/choice`.
- Hide what a role can't use, don't deny it.
- No explanatory text.
- No side stripes.
- No reduced-motion gating.

## 6. How the first generation goes

1. **Capture the references first.** Screenshot the "Use" surfaces live (dark, 1440×900) into `plans/B-166-screens/reference/` and design from them, never from doctrine alone.
2. **Style frame before the whole journey.** Build three anchor screens at full fidelity:
   - Home on day one for Amira, with the setup guide.
   - Aicha's person page.
   - The Make it yours studio, with a live preview.

   Show them to the user (checkpoint 3a, one quick question: is this the feel?). Then draw the rest of the journey in that language. Three screens are cheap to redo; thirty are not.
3. **Build in Fusion's real materials.**
   - Tokens copied from `Frontend/packages/ds/src/styles/tokens.css`.
   - Geist and Lora from Google Fonts, the only font host artifacts allow.
   - Hugeicons as inline SVG from `@hugeicons/core-free-icons`.
   - The DS components' real shapes: DataTable bands 56/40/56/48, choice controls, the person band.
4. **Real data.** Carthage · Mid-year's people, units and dates (read through the API), never placeholder names. Check whether the demo people have photos. If not, use initials in identity hues, and ask the user whether demo companies should get photos.
5. **Interactive where the hero is:**
   - Make it yours: pick a colour and the preview recolours.
   - The organisation in time: the slider moves the chart.
   - Bring your company: the import's review shown as a chart.

   Everything else can be still.

## 7. Taste questions already known

To ask in the explorer, each with a recommendation preselected:
- Does Home greet by first name in its title?
- Do demo companies get photos for their people?
- Navigation: labels always, or icons that expand like BambooHR's?
- How lively is the person band (photo size, cover tone)?
- People list as cards or as a table by default?
