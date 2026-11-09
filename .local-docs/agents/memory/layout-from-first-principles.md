---
name: layout-from-first-principles
description: "Choose each screen's layout from what it must convey; the document + right sidebar of My Plan is not a mandatory template"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ee9c605a-74c9-483e-9508-e9890229a8f3
  modified: 2026-10-19T13:00:56.657Z
---

Don't default to the document + right-sidebar layout because My Plan and other established surfaces use it. Pick the layout that best conveys the screen's job from design first principles: single column for focused writing or reading, full width for comparison and tables, a sticky side column only when something must stay in view while the main column scrolls (e.g. readiness + Launch beside a long setup form), or an entirely new composition.

**Why:** 2026-10-19, slice 4 Reviews canvas. The user liked the boards but flagged "excessive use of the right sidebar/column in most layouts" and was skeptical I treated it as mandatory because of My Plan: "you should favor the best layout that best conveys what we want… where that decision is the column/sidebar so be it, different or entirely new layout, so be it."

2026-11-09, B-331 walkthrough, the same root cause seen across many live pages (Home, the import, a role's page, Organization's Plan, invite drawer): stranded controls, cards that fill half their width with the rest empty, two columns that don't belong together. User: "we make bad decisions for layouts, we rush things, then brute force and try to make the design work, which is fundamentally flawed." Empty right halves and stranded single controls are the tell to check for before showing anything.

**How to apply:** for every new screen, state (to yourself) why its layout fits its job before drawing it; a sidebar needs a reason (persistent state or action while scrolling). This refines [[layout-document-sidebar]] (frame objects, no height-matching) rather than replacing it. Related: [[perf-design-reference-surfaces]], [[canvas-first-for-taste-rework]].
