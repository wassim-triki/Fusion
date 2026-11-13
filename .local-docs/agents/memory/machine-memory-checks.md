---
name: machine-memory-checks
description: "User's PC has 13.9 GB RAM; heavy checks get killed under memory pressure — run them one package at a time with vitest --maxWorkers=2"
metadata:
  node_type: memory
  type: project
  originSessionId: b95649f7-895e-4b86-b108-d0c4e363eafb
  modified: 2026-11-13T00:44:18.635Z
---

The dev machine has 13.9 GB RAM. On 2026-10-26 background tests and lint were killed by Claude Code for low memory: a VMware VM held ~5.5 GB, plus Brave, tsserver and MySQL80 (unused by Fusion). The user now closes the VM themselves and set MySQL80 to Manual.

**Why:** parallel type-check + vitest (default ~one worker per core, 8 logical CPUs) on top of the VM exhausted RAM.

**How to apply:** run frontend checks one package at a time, in the foreground, with `pnpm --filter <app> test -- --maxWorkers=2`; if memory runs short, check for the VM (`vmware-vmx`) and ask the user rather than restarting killed jobs. Related: [[minimize-eta-no-fluff]].

2026-10-27 with no VM running, the stack alone held the machine at ~96%: shell and core Next dev servers ~1.4 GB each (Turbopack keeps compiled routes), 8 Next dev servers in all (Interview/Recruitment/Onboarding/Learning too), the TypeScript language server ~1 GB, four `dotnet run` hosts. A cold build was killed and the whole stack went down once. The user wants a real fix: board item B-138 (start only the MFEs in use, cap memory, etc.); propose options before changing the stack scripts.

2026-10-29 (B-153): the user is fine with the agent freeing memory itself when a job needs it, e.g. `stack.ps1 -Down -Only Frontend` during backend-only stretches, then starting it again for journeys or rendered checks. Don't ask first; just do it when it makes sense.

2026-11-13: confirmed again after the pre-commit hook was refused twice for memory: "like always, stop some stuff and do that". When a job (the commit hook included) is refused for memory, stop what isn't needed (the frontend first) and run it, without asking or reporting first; restart the frontend only when the next step needs it. Also start the frontend with Performance when walking Performance (`-Apps core` alone makes every Performance page 500).
