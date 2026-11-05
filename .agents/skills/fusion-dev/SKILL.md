---
name: fusion-dev
description: Run, stop, restart and check the local Fusion stack; run backend tests with the right environment; query local databases read-only; call Fusion APIs through the shell. Use when running, testing or debugging Fusion locally.
---

# fusion-dev

Scripts live in `.agents/skills/fusion-dev/scripts/` (also reachable as `.claude/skills/fusion-dev/scripts/`). Run them exactly as shown; don't hand-assemble these commands. Paths below are relative to the repo root.

## Stack
```
pwsh -File .agents/skills/fusion-dev/scripts/stack.ps1 -Status            # read-only; exit 1 if anything is down; notes memory drift and RAM
pwsh -File .agents/skills/fusion-dev/scripts/stack.ps1                    # bring everything up (idempotent)
pwsh -File .agents/skills/fusion-dev/scripts/stack.ps1 -Force -Only Performance   # restart one service after a backend change
pwsh -File .agents/skills/fusion-dev/scripts/stack.ps1 -Down [-Only <Service>]
```
Services: Gateway, Identity, CoreHR, Performance, Frontend, Mailpit. Restart only the service you changed; a full `-Force` cold-boots the frontend (slow first compile).
Memory (13.9 GB machine): the frontend starts our four apps (shell, core, performance, platform); `-Apps core` (or `core,performance`) starts the shell with only those (a running frontend missing a requested app restarts with the requested set; `-Status` names the MFEs running), `-AllApps` to also start Interview, Learning, Recruitment and Onboarding. Backends are built one at a time and run as built apps (no `dotnet run` host), and a restart closes the service's old window with everything under it. `scripts/memory-check.ps1 [-NeedGB 2.5] [-Job "..."]` refuses a heavy job when RAM is short; `test-backend.ps1` and the pre-commit hook call it. `scripts/prune-local-docs.ps1 [-DryRun]` (also run on every stack start) deletes the screens of items past review, moves closed items' plans to `archive/plans/`, and keeps only the newest demo-preset build.

## Backend tests
```
pwsh -File .agents/skills/fusion-dev/scripts/test-backend.ps1 Performance [-Filter "FullyQualifiedName~Review"]
```
Sets the relational-test connection (CoreHR, Performance) so those tests run instead of skipping, builds outside the service's locked `bin/`, and prints `Passed | Failed | Skipped`. Report that line as evidence.

## Frontend checks (from `Frontend/`)
```
pnpm --filter <app> type-check
pnpm --filter <app> lint
pnpm --filter <app> test
pnpm --filter <app> build      # only when routes, layouts or Next config change
```
Never run them unfiltered at the root. Use pnpm; there is no npm on this machine.

## Database (read-only)
```
pwsh -File .agents/skills/fusion-dev/scripts/sql.ps1 -Database performance 'select count(*) from performance."PerformanceCycles"'
```
`-Database identity|corehr|performance`; add `-Csv` for CSV. Writes fail by design: change data through the API (`.local-docs/agents/data/`).

## API (through the shell, like the browser)
```
node .agents/skills/fusion-dev/scripts/api.cjs qa.admin@lumera-demo.com GET /api/performance/cycles
node .agents/skills/fusion-dev/scripts/api.cjs <email> POST /api/<service>/<path> '{"json":"body"}'
```
In scripts: `const { call, login, inviteToken } = require("<repo>/.agents/skills/fusion-dev/scripts/api.cjs")`. `inviteToken(email)` reads the newest invitation from Mailpit. Accounts: `.local-docs/agents/data/README.md`.

## Cloud sessions (Linux, Claude Code on the web)
```
bash .agents/skills/fusion-dev/scripts/cloud-session.sh          # first command of every session
bash .agents/skills/fusion-dev/scripts/test-backend.sh Performance ["FullyQualifiedName~Review"]
```
`cloud-session.sh` recreates the untracked links (root `CLAUDE.md`, this skill under `.claude/skills/`, Claude's memory folder → `.local-docs/agents/memory/`) and installs dependencies. `test-backend.sh` starts PostgreSQL and prints the same summary line as `test-backend.ps1`. Frontend checks run as above. No pwsh, no stack: `stack.ps1`, `sql.ps1`, `api.cjs` journeys and screens are local; when an item needs them, finish the rest, push, and say what's left for a local session (`claude --teleport`). The environment itself (setup script, network list, variables) is `cloud/setup.sh` and its header.

## Reading what you see
- `/api` 401 = service up; 502 = backend down; 0 = shell not listening.
- Next.js dev writes `.next-dev`, build writes `.next`; stop that app's dev server before building it.
- Git Bash rewrites `/route` arguments: prefix with `MSYS_NO_PATHCONV=1`.
- First Performance compile after a frontend restart can take minutes.
