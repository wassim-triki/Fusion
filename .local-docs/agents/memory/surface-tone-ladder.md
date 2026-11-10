---
name: surface-tone-ladder
description: "Fusion container backgrounds: page = bands (bg-section) → bg-card → bg-inlay, overlays bg-popover (D-32 since B-370); translucent neutral fills banned at rest; lint-guarded"
metadata:
  node_type: memory
  type: project
  originSessionId: 2768f89c-1f70-4e6d-936e-a7e26a2223b4
  modified: 2026-09-29T18:44:21.034Z
---

2026-09-29: user found `/performance/team` backgrounds "all over the place" (peer sections mixed `bg-muted/20` and `bg-card`, objective row sank to `bg-background` inside a card, seven ad-hoc `bg-muted/NN` opacities). User chose the **lift** model with fixed opaque tones and a **full sweep** of owned apps.

Tokens since B-370 (D-32, 2026-11-10): dark page = `--section` .215 / card .255 / inlay .29 / popover .3 / sidebar .2; light page = section .975 / card .993 / inlay .958 (sinks into the card) / sidebar .965, no pure white. `bg-section` now means a band or hero (the page's own tone): a frame that must stand out on the page is `bg-card`. The shell sidebar follows the theme (`bg-sidebar`, no longer forced dark). Light amber: charts gold → zinc ink beyond series 2, ink text on the yellow (D-95). Earlier (2026-09-29) dark values: .141/.175/.21/.235.
Rules (DESIGN.md §8 "Tone ladder"): child always a higher tier (skip OK, reverse never); no 4th tone (dividers inside inlay); peers share a tone; overlays = top tier, nested groups in dialogs/sheets unfilled, their sticky footers `bg-popover`; dashed empty placeholders unfilled; semantic tints sit on top of the right tier; controls keep DS variants.

**Why:** translucent tints composite differently per parent and nesting went both directions, so nothing read consistently.
**How to apply:** use only `bg-section`/`bg-card`/`bg-inlay`/`bg-popover` for containers in owned apps; translucent neutrals only behind `hover:`/`data-*:` or on tiny marks. `packages/eslint-config/design-roles.js` (replaces `radius.js`; ESLint can't stack two `no-restricted-syntax` configs) warns on raw radii AND translucent neutral fills; the one allowed exception is the data-table refetch scrim (inline disable). ~150 sites swept; rendered lift-check script (`tone-qa.mjs` in session scratchpad) found no sinks on 8 pages. Related: [[radius-role-system]].
