---
name: next-takes-top-row
description: "The user starts a fresh session with \"next\"; take STATE's top open row and run it end to end with no questions, no ceremony, then commit."
metadata:
  node_type: memory
  type: feedback
  originSessionId: beedb5e3-7eb4-4f4f-be83-ed3ea70e8bd4
  modified: 2026-11-13T00:49:58.097Z
---

A fresh session whose prompt is "next" (or similar) means: read STATE, take the top open row of the queue, set it as Active work, build it, run only the checks that prove it, commit (code + board), drop the row from the queue, and stop. Ask only on taste calls the row can't settle. No status narration, no extra screens, no side work; anything noticed goes on the board.

**Why:** User, 2026-11-13: "minimize friction between sessions … I don't want these running for ages or like wasting time on things that don't actually matter."

**How to apply:** keep STATE's queue rows self-sufficient (items, what each means, checks); end each session with the next row named in one line, not a pasted prompt. Related: [[build-speed-mode]], [[minimize-eta-no-fluff]], [[agent-commits-everything]].
