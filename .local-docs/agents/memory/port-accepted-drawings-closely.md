---
name: port-accepted-drawings-closely
description: "When a slice has an accepted explorer drawing, port its surfaces closely (layout, spacing, chips, avatars, card tones); the user reviews side by side"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b4e9d669-d65d-499f-a8f6-9232da5c4cf8
  modified: 2026-10-30T23:18:07.471Z
---

When a screen was accepted in an explorer (B-164 decisions), build it to match the drawing's composition and specs, not a reinterpretation with stock DS primitives. Read the drawing's CSS (row heights, paddings, chip shapes, avatar hues, card tones) before building, and keep the explorer open beside the screens.

**Why:** B-177 review (2026-10-31): the user compared the built Roles screens with the accepted drawing side by side; the model was fine, but spacing, cell alignment, grey avatars, bordered cards and especially the role page's "Who has it" ("almost night and day") drifted, and the drawing looked "way cooler and cleaner".

**How to apply:** at the start of a slice, open its drawing's section and list the specific parts to port; take screens in the same framing as the drawing; call out any deliberate difference at review. Related: [[refine-liked-version-not-redraw]], [[perf-design-reference-surfaces]], [[reuse-only-if-it-fits]].
