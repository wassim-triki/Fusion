# B-397 — The Fusion-wide foundation, decided per situation

**Status:** page published 2026-11-09: https://claude.ai/artifact/Kq91ddwjiTPb4BrEEVzCLF (`B-397-foundation.html`, answers in db doc `foundation/main`). **Waiting on the user's checkpoint.** Answers become design decisions (IDs after D-31 in `design/decisions.md`), then Performance's scope (B-390) is built on them.

## How the page works

29 situations in 8 topics, 2–3 variants each, **drawn** in Fusion's own tokens (`Frontend/packages/ds/src/styles/tokens.css`: oklch steps, Geist and Lora, the yellow brand), with real Carthage people. Labels only. Every drawing follows the choices already made (temperature, surface steps per page type, icon set, serif), so the page redraws as the system the user picks. A Dark/Light switch redraws every specimen in either theme. The user's direction during the build: warm and friendly like BambooHR and Upwork, modern and professional; hence a neutral temperature choice (warm, a hint of the brand) beside today's cool zinc.

## Situations, from the code

| Topic (board) | Situations | Where they occur today (evidence) |
| --- | --- | --- |
| Colour (B-370) | C0 neutral temperature; C1 record pages; C2 workspaces and lists; C3 hubs | Light tokens: canvas 0.955, section 0.977, card 1, inlay 0.967, hue 286 (cool zinc); dark 0.141 / 0.175 / 0.21 / 0.235 |
| Empty (B-376) | E1 first use of a page; E2 empty part of a record; E3 a list fine to be empty; E4 no results after a filter; E5 no results for a search; E6 a chart with no data; E7 not yet, or waiting on someone | ~60 distinct "No …", "Nobody …", "Nothing …" strings across shell, core, performance, platform; `PageEmpty` (dashed box + Inbox icon) and `PagePermissionNotice` (lock) in `@repo/ds/shell/page-states.tsx` |
| Loading (B-379) | L1 a page's first load; L2 switching a tab or view; L3 refreshing in place; L4 a quick action; L5 long work | 6 route `loading.tsx` files; Skeleton in ~110 files with per-feature skeletons (home, people, plan, import, 1:1s, setup); Spinner in 9 |
| Icons (B-393) | I1 the set | Hugeicons through adapters in Performance and Platform; Lucide in Core HR, shell, `@repo/ds` |
| Finding your way (B-381) | N1 moving between modules; N2 inside a record; N3 Settings; N4 steps of a flow | Module switcher + module sidebar; Settings mode in the same sidebar; `SettingsBreadcrumb` in the top bar; ArrowLeft back links in ~22 files (role page, unit page, add person, calibration, setup footer) |
| Your menu (B-338) | M1 where your account lives | Person menu at the bottom of the sidebar |
| Opening things (B-373) | P1 a quick look; P2 a short task; P3 a task with sections; P4 something that can't be undone; P5 long work | Sheet in 15 files, Dialog in 31, Drawer in 2, AlertDialog in 13 |
| Type (B-377) | T1 where the serif goes | `type-page-title` and `type-display` are Lora; `type-section-title` is Geist 600 |

Rules kept unless objected: U1 no em dashes, U2 no dot-strung stat lines, U3 plain words, U4 no subtitles or decorative icons on section titles, U5 no explaining sentences, U6 a disabled button says why on the page, U7 photos wherever a person appears, U8 optimistic updates with rollback.

## Research (light, per situation)

- Empty states split by situation in established systems: Cloudscape separates an empty resource from zero results after filtering; eBay's playbook separates first use, user cleared and no results; Atlassian places empty states full screen or inside panels and tables. Hence E1–E7 rather than one empty state.
- Loading: NN/g, as quoted in search summaries (the article itself wasn't opened): no indicator below about a second, a duration estimate past about ten, and a skeleton when the layout is known. Hence L1a (the page's own shape) and L5a (what it's doing, with counts) for long work.
- Panels: Shopify keeps modals for short, focused tasks and gives bigger multi-section work a page. Hence P2a (small modal), P3a (side panel for sectioned tasks, the user's liked Make a change), P5a (own page).
- Breadcrumbs reflect the hierarchy, not the path taken, and supplement the main navigation (USWDS research summary). Hence N2a.
- Feel: BambooHR and Upwork (user, 2026-11-09): warm, friendly, modern, professional.

Sources: [Cloudscape](https://cloudscape.design/patterns/general/empty-states/), [Atlassian](https://atlassian.design/components/empty-state), [eBay Playbook](https://playbook.ebay.com/design-system/patterns/empty-states), [NN/g skeleton screens](https://nngroup.com/articles/skeleton-screens/), [Shopify modals](https://shopify.dev/docs/api/app-bridge/using-modals-in-your-app), [USWDS breadcrumbs research](https://github-redirect.dependabot.com/uswds/uswds/wiki/Breadcrumbs-Research-Findings).

## Next

When the user answers: read `foundation/main` (ArtifactData get, collection `foundation`, doc `main`) or the pasted text; record each situation's choice as a decision (D-32 onwards) in `design/decisions.md`; update `DESIGN.md` and the B-397 children (B-370, B-376, B-379, B-393, B-381, B-338, B-373) to carry the decided rule; then Performance's scope (STATE row 3).
