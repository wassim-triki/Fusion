---
name: scope-with-depth-ladders
description: "For big reworks, don't hand the user a closed set of research specs: take their intent first, keep the long list open, give each feature a depth ladder (0–3) they pick from"
metadata:
  type: feedback
---

When scoping a big rework or feature set, the user doesn't want to be "stuck and chosen" inside a set of specs the research produced. Research decides the model, but how far each feature goes and what gets shown off are partly demo and business-priority calls that belong to them.

**Why:** 2026-10-30, on B-164 (tenant experience overhaul): "I don't want you to … spit on us some randomized specs … and I get stuck … whereas maybe the correct version might contain some things not from that space." EY never specified depth for things like tenant configurability, so nobody had set how far to take it.

**How to apply:**
- Don't wait on the user for product intent: they're new to HR and said so (2026-10-30, "if you're gonna wait for me to give you … my intent, … I don't have it"). Derive the story and the recommendation yourself, open every page with it preselected, and let them react; the format and interaction are yours to choose.
- Wide long list before narrowing: competitors, adjacent SaaS patterns, project-specific ideas, stakeholder asks, the user's wishes; the user can add at any time.
- Every feature gets a depth ladder (0 none · 1 minimal · 2 established-product parity · 3 showcase) with cost and what it shows; recommend a rung, the user picks.
- Business value is the agent's case; demo value is the user's call. A few heroes go to rung 3, the core sits clean at 2, cuts go on a visible "not doing" list.
- A cheap scope page (no screens) comes before the screen explorer, which then mocks the chosen scope only.

Refines [[decide-surface-architecture-yourself]] (architecture is still the agent's call). Precedent: [[perf-first-principles-rework]]. Related: [[architecture-durable-planning]].
