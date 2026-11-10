---
name: layout-document-sidebar
description: "Fusion column+rail pages = document + unframed sticky sidebar; frame objects not columns; no height-matching or filler; actions in header. Plan pages done, ~14 other pages pending"
metadata:
  node_type: memory
  type: project
  originSessionId: 2768f89c-1f70-4e6d-936e-a7e26a2223b4
  modified: 2026-09-30T10:16:55.459Z
---

2026-09-30: user rejected boxed-column layouts (main column card + rail cards) as a fundamental flaw — always either ragged or, when height-matched (`flex-1` last child, stretched grid), full of dead space; filler (snapshot donut, alignment/weight bars) was added only to balance. Chose **document + sidebar** grammar, applied to My Plan + reviewer plan page first.

Grammar (DESIGN.md §1.4 "Document + sidebar" + §33.7 "boxed columns" tell): frame objects never columns; sidebar unframed, hairline-separated `SidebarSection`s, `lg:sticky lg:top-6`; never height-match; primary actions in page header actions slot; sidebar never restates list counts/totals/per-item progress.

Implementation: `apps/performance/.../plan/plan-layout.tsx` (`PlanDocument`, `PlanSection`, `SidebarSection`), local for now — promote to `@repo/ds/shell` when the follow-up sweep reuses it. `MyPlan` takes a `heading(actions)` render prop so Submit lives in the header; reviewer decision = header actions, Request changes is a dialog.

**Why:** unequal-length columns can't be made even without dead space; removing the column frames removes the problem.
**How to apply:** follow-up sweep candidates: platform `tenants/record/overview-page.tsx`, cycle `cycle-details-step.tsx` / `review-launch-step.tsx`, provisioning steps, core import stages, `activation-plan.tsx`, `access-workspace.tsx`, `establishment-workspace.tsx`. Related: [[surface-tone-ladder]], [[perf-reviewer-plan-surface]], [[perf-my-plan-execution]].

**Criterion (2026-09-30, user: decide from first principles, not from what worked on Plan):** document + sidebar only for one-entity pages; collection/compare pages (e.g. `/performance/team`) = full-width single column of unframed sections, context beside the section that uses it. Team page reworked that way: upstream staging section folded into the composer (one create path, "Aligns to" read-only line), `bg-section` boxes removed, "Review N plans" header action; the add-people callout kept framed (user said it works).

**2026-11-10 (3e note, D-95):** the user also wants sections' edges lined up on every page: no empty gaps, no misaligned or ragged section edges. Reach it by arranging content (what goes beside what, spans, order), never by stretching or filler; the no-filler rule stands. Related: [[surface-tone-ladder]].
