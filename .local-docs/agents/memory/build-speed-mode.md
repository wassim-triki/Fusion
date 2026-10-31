---
name: build-speed-mode
description: "User's standing build-speed rules (2026-10-27, leaner 2026-10-31 B-234): one slice = one session, one agent, one commit; checks once; journeys only for authz; no backward compatibility; never cut authz/isolation tests"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0dc9232d-2af0-412c-b144-4b2c7821c1a4
  modified: 2026-10-27T13:31:59.238Z
---

On 2026-10-27 the user asked to make building faster "without sacrificing crucial and necessary stuff". They required that every session keep to these rules: "so we don't save time in one slice and then waste it in another". The rules live in `AGENTS.md` under Verification › Build speed.

1. **While building:** tests for the touched files only. Full suites, lint and type-check once, when the work settles.
2. **Cold build:** once, at the end, in the background.
3. **Commits:** one per session (the pre-commit hook takes minutes), run in the background.
4. **Screens:** only after the checks have finished; a few, dark, 1440×900.
5. **Stack:** keep it running.
6. **Sessions:** one fresh session per chunk (backend + frontend together), not per step.
7. **Approved prototypes:** port them as they are.
8. **Reviews:** one per chunk.

**2026-10-31 (B-234), after B-181 took too long:** the user said slices were too slow and that the multi-developer setup no longer matters. Measured on B-181: about 26 of 62 minutes went to waiting on repeated tests, and review rounds took as long as the build. Added: one agent per slice (Codex only on a usage limit, from a light STATE kept at milestones); the board files go in the slice's one commit, with no separate docs commit; journeys only for authorization and tenant isolation; screens self-compared with the drawing before sending; migrations schema-only, with no Down tests and no data carried across; old endpoints deleted, not guarded; the hook checks only our apps; `stack.ps1 -Apps core`; medium effort.

**Why:** time was going to tooling waits and re-loading context. For example, one core test file took 77 s, mostly import time. Screens timed out while tests hogged the 13.9 GB machine.

**How to apply:** plan and estimate work in chunk-sized sessions, and follow the order above. Never drop server-side authz/tenant-isolation tests with their negatives, security-review for auth changes, type-check, or one build before review. This refines [[fresh-session-for-applies]] (a fresh session per chunk) and [[minimize-eta-no-fluff]]. Related: [[machine-memory-checks]].
