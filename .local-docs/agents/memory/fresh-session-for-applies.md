---
name: fresh-session-for-applies
description: "Start every OpenSpec apply or coding task in a fresh context session; before that, make the .local-docs/agents files complete enough for a cold pickup."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 999a440d-7401-49d2-a342-9e0bef706a9f
  modified: 2026-10-24T17:41:25.468Z
---

User, 2026-10-24: "before we start anything apply or coding wise we switch into a fresh context session, just make sure our agents files are sufficient for pickup seamlessly."

**Why:** long planning sessions fill the context; implementation goes better from a clean start.

**How to apply:** when planning wraps up and an apply or coding task is next, don't start it in the same session. First write a pickup recipe into STATE.md's Next: the preconditions, the files to read, the user's decisions, and any gotchas. Then tell the user it's ready for a new session. Since 2026-10-27 a session takes a whole chunk (backend + frontend together), not a single step: see [[build-speed-mode]]. Also (user, 2026-10-28): a new batch that is unrelated to the work in progress goes to a fresh session too; when the current work is done, close it up (log, board, STATE pickup) and stop, rather than rolling into the next batch. **Effort per session** (user, 2026-10-30): with each handover, recommend the effort to start the fresh session at, from the kind of work it does: medium, high or xhigh, never above xhigh (low is allowed): xhigh where a mistake is silent and costly (security boundaries, data integrity, import engines), high for domain plus crafted screens, medium for composition and sweeps. Quality first, no unneeded compute; the user sets it by hand. Related: [[state-for-every-task]], [[agent-run-board]].
