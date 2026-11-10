---
name: fusion-does-the-bookkeeping
description: "The user values frictionless flows above feature depth; whatever Fusion can know or compute, nobody types, ticks or waits for (D-40)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 10d29711-576e-4961-801a-9d0ceaa4e518
  modified: 2026-11-10T00:19:49.033Z
---

Remove friction wherever Fusion can do the work: no field asking for what the numbers already say, no tick box that exists to unlock a save, no wait on an approval that adds nothing, no manual pass over items that are fine (calibration by exception, D-35). Each step a person still takes should be one they decide.

**Why:** the user, on Performance's scope (2026-11-10): "I really really value non-friction, because this type of module depends on too much … we need to weed out what we can while keeping it a Performance module." On calibration: "I dislike the friction of having to calibrate manually … if we can bypass that cleanly without making a bad or illogical feature."

**How to apply:** in every explorer and slice, ask per screen what the person does that Fusion could have done, and cut it, as long as the result stays logical (a computed shortcut must still produce the right outcome, e.g. flags catch what a calibration session would). Recorded as principle 9 and D-40 in `design/decisions.md`. Related: [[ui-no-explanatory-text]], [[design-friendly-not-enterprise]].
