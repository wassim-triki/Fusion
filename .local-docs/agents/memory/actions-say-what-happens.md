---
name: actions-say-what-happens
description: "Every button must make its outcome obvious before the click; the user is wary of clicking labels like \"Change who\" or \"Nudge them\" whose effect is unclear."
metadata:
  node_type: memory
  type: feedback
  originSessionId: beedb5e3-7eb4-4f4f-be83-ed3ea70e8bd4
  modified: 2026-11-13T00:26:14.991Z
---

A button's label (and where it sits) must tell the person what will happen and to whom before they click: "Ask someone else about Aicha" over "Change who"; a nudge says who gets told what. Silent outcomes are just as bad: an action confirms what it did (approve that vanishes with no confirmation was called out the same day).

**Why:** User, 2026-11-13, walking Aicha's review as Mariam: "I find myself sometimes like afraid to click certain buttons because … it's not intuitive to understand what is going to happen when I click them." Also "no confirmation, no nothing" after approving from Home.

**How to apply:** In every explorer and build, read each action as a first-time user: name the object and the effect; confirm after with the floating status pill (B-456) or an in-place change. Related: [[ui-no-explanatory-text]] (say it in the label and structure, not caption sentences), [[fusion-does-the-bookkeeping]].
