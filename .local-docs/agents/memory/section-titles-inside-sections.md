---
name: section-titles-inside-sections
description: "A section's title and actions live inside its container, not on the canvas above it; fields sit darker than their surface; DS primitives only (no native date inputs); row actions as icon buttons"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 01d9f1f6-cc46-4e7a-bf45-c8ac0bada28b
  modified: 2026-10-31T10:21:48.861Z
---

A section's title and its actions (e.g. "Your year" + "My plan", "Praise" + "Give praise") go inside the section's container, as the accepted drawings do. Never a heading on the canvas with the card starting below it. Applies to every page, old ones included (B-225).

Related rules from the same review (B-179, 2026-10-31):
- Input fields (textareas, notes, describe boxes) sit darker than the surface they're on (B-227).
- No native date inputs or calendars: the DS (shadcn) date picker and calendar, and DS primitives in general.
- Row actions like Undo / Change are icon buttons with well-chosen icons; Decline is a ghost X until hovered, Approve a check in the tenant accent (outline, subtle fill).
- Active tabs and filters take the tenant's theme: outline with a subtle fill.
- Long helper captions ("Drafted from your company's…") read badly; convey it with a mark. See [[ui-no-explanatory-text]].

**Why:** the user found ours "uglier" than the reference and inconsistent with itself; floating headings break the section into two pieces.
**How to apply:** use `Section` from `@repo/ds/shell` (title/meta/action inside; `flush` for edge-to-edge rows; `SettingsBlock` is built on it; objects inside step up to `bg-inlay`); fields carry `bg-field` (`--field` token); dates only through `DatePicker` (lint-guarded). When building or porting any section, put the header row in the container; check fields' tone against their surface; reach for `@repo/ds` primitives before any native control. See [[port-accepted-drawings-closely]], [[surface-tone-ladder]].
