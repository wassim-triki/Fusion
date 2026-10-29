# B-158 Cloud sessions: feasibility and plan

2026-10-29. Goal (user): the PC is free; agents work in Claude Code cloud sessions; the stack runs locally only for a demo. The user is fine with the agent docs being tracked in git. Sources: code.claude.com/docs `claude-code-on-the-web`, `cloud-environments`, `self-hosted-environments`, `claude-projects` (read 2026-10-29).

## What the cloud gives (facts from the docs)

| | Anthropic-hosted cloud session |
|---|---|
| Machine | ~4 vCPU, 16 GB RAM, 30 GB disk per session ("may stop tasks that need significantly more memory") |
| Pre-installed | Node 20/21/22 with pnpm, Python, Java, Go, Rust, Docker + compose, **PostgreSQL 16** and Redis (installed, not running), git, gh, chromedriver |
| Not installed | **.NET SDK** (install it in the setup script), PowerShell |
| Setup script | Bash; cached as a disk snapshot when it finishes in about 5 min (rebuilt after about 7 days, or when the script or network list changes); must exit 0 |
| Running processes | Never cached. Postgres, Mailpit and the stack start in each session (SessionStart hook or on request). An idle VM pauses with its files kept; a reclaimed VM is rebuilt fresh |
| Commands | 2 min foreground (up to 10), then moved to the background for up to 30 more min |
| Network | Trusted list (package registries, GitHub, Docker Hub) or Custom; GitHub goes through its own proxy; credentials stay outside the VM |
| Secrets | Environment variables (.env format, readable in the session); network secrets attached outside the VM |
| User instructions | A setup script can write `~/.claude/CLAUDE.md`; `.claude/settings.json` hooks from the repo run in single-repo sessions |
| Results | Pushed to a branch on GitHub; a session can be pulled into the local terminal (`--teleport`) |
| Usage | Shares the account's rate limits; parallel sessions use them faster |
| Viewing the app | Nothing in the docs for opening a session's running app in your browser: you'd judge UI from screenshots |
| Fallback | A self-hosted environment (your own server runs the sessions) for more memory or persistent data |

## What Fusion needs, and how it fits

| Need | Today (local) | In the cloud | Fit |
|---|---|---|---|
| Agent docs (board, STATE, LOG, plans, data) | `.local-docs/agents/`, untracked | Tracked in the repo (user OK). Scrub first: the tenant passwords in `data/README.md` become an env var; screens and seed files checked for anything real | Easy |
| Agent memory | `~/.claude/projects/…/memory/` | Durable ones move into `.local-docs/agents/memory/` (tracked), indexed from AGENTS.md | Easy |
| Backend tests (relational) | `test-backend.ps1`, native Postgres | `service postgresql start`, set the `postgres` password, same connection env vars; a bash `test-backend.sh` | Easy |
| Frontend checks | pnpm filtered | Same (pnpm pre-installed; `pnpm install` cached in the snapshot) | Easy |
| Pre-commit hook (full lint + type-check) | Runs on commit | Runs the same in the session if dependencies are installed; heavy on 4 vCPU | Fine, slower |
| Stack for API journeys | `stack.ps1`: 4 backends + gateway built and run, Mailpit, Next dev for 4 apps | A bash `stack.sh`: Postgres, Mailpit as a Docker image (`axllent/mailpit`, Docker Hub is trusted), backends built and run, frontend served from a production build (`next build` + `start` uses far less memory than dev, and is closer to a demo) | Medium. Memory is about what you have today, but the VM runs nothing else. Boot about 8–10 min per session |
| Demo data | Built up locally over months | Already scripted from empty: Identity migrates and seeds the platform admin in Development; `demo-preset.mjs build <preset>` makes a full Carthage tenant through the API in 1–6 min. The older Carthage Digital Group tenant uses `prepare-carthage-demo.mjs`, which imports `@oai/artifact-tool` (check it installs in the cloud, or use a preset instead) | Medium-easy |
| Screens (Playwright, dark 1440×900) | Repo Playwright through :3000 | Same headless; the Chromium download host goes on the network list; screens committed with the item, or shown on an artifact page | Easy once the stack runs |
| AI features (Groq) | CoreHR/Performance env var | Env var + `api.groq.com` on the Custom network list | Easy |
| Commits and pushes | Agent commits locally; push and PR are the user's | A cloud session must push its branch or the work never leaves the VM | Needs a call (below) |

**Verdict: feasible.** Code, backend tests and frontend checks move fully to the cloud with little work. Full API journeys and screens are feasible but cost a stack boot of about 8–10 min per session, and memory is as tight as today's laptop (16 GB vs 13.9 GB, with no browser or IDE beside it). The only thing that doesn't move: clicking through the running app yourself. In the cloud you see screenshots; for hands-on checks and demos you run it locally, as you wanted. If 16 GB proves too small for the stack plus a build, the fallback is a self-hosted environment on a rented server, not your PC.

## Decisions (taken by the user 2026-10-29: "ok … lets do what needs to be done, following your recommended steps")

1. **Pushing:** cloud sessions push their own `claude/…` branches; you (or a session you ask) merge to `wassim/develop`. Decided: yes, via PRs the user merges. Colleagues will see those branches on the public repo.
2. **One session at a time at first:** the board and STATE assume one piece of work in progress, and two branches editing `BACKLOG.md`/`LOG.md` will conflict at merge. Decided: one at a time until it works; then parallel sessions each get their own handoff file (`plans/B-NNN-state.md`) and only the merge updates the board.
3. **Public agent docs:** the board, plans, log and memory become readable by anyone. Decided: fine, after the scrub. Found since: the real local password (admin and every demo account) is in `data/README.md` and `fusion-dev/scripts/api.cjs`, not in git yet; it moves to an env var before anything is tracked (B-159).
4. **Partial, not full:** decided (user: "want my pc usable, but not at the cost of tooling the migration to cloud fully, if its complicated"). See "Chosen direction" below; it overrides the step table.
5. **Local-only stays possible:** confirmed with the user; the one irreversible part is that pushed docs stay in git history.

## Plan (first draft; the partial direction below drops steps 3 and 5)

| Step | What | Where | Size |
|---|---|---|---|
| 0 | Finish B-157 (paused) so the tree is clean | local | short |
| 1 | Scrub and track the agent docs: passwords to an env var, check screens and seed files, move durable memory into `.local-docs/agents/memory/`, un-ignore, prune scripts keep working, AGENTS.md says how to resume in the cloud | local | 1 session |
| 2 | Cloud environment: `cloud/setup.sh` (.NET 10 SDK, pnpm install, dotnet restore, Playwright Chromium, `docker pull axllent/mailpit`; parallel to stay under 5 min) + env vars + Custom network list; a `CLAUDE_CODE_REMOTE`-guarded SessionStart hook that starts Postgres and sets its password | local writes it, you paste it into the environment settings | 1 session |
| 3 | Linux scripts: `test-backend.sh` and `stack.sh` (start/stop/status, production frontend), `api.cjs` already works anywhere | cloud | 1 session |
| 4 | Pilot: one backend-only item end to end in the cloud (tests, commit, push, merge) | cloud | 1 session |
| 5 | Full stack: boot, `demo-preset.mjs build planning`, one journey, a few screens; measure memory and boot time | cloud | 1 session |
| 6 | Hand-off rules: what stays local (demos, B-104 hand pass), parallel-session state files, when to fall back to self-hosted | doc | small |

Stop after step 5 if the stack doesn't fit in 16 GB: tests and checks still move off the PC, and journeys and screens stay local until a self-hosted environment.

## Chosen direction: partial (2026-10-29)

The cloud does code, backend tests and frontend checks; the stack, API journeys and screens stay local in short bursts. Plan steps 3 (stack.sh) and 5 (full stack in the cloud) are dropped unless asked for later. Steps now: B-157 done (7c6ecf93); **B-159** scrub + track docs; **B-160** cloud environment (`setup.sh`, env vars, network list, cloud-only Postgres hook, `test-backend.sh`); **B-161** pilot (one backend-only item, then teleport for the local check; settle pushing to `wassim/develop`).

### Memory (measured 2026-10-29 unless marked as an estimate)

| | Today, agent on the PC | Partial: cloud working | Partial: local burst | Cloud VM |
|---|---|---|---|---|
| Next dev, 4 apps | 3.6 GB (measured, 15 node processes) | 0 | 3.6 GB | 0 |
| Backends + gateway + Postgres + Mailpit | ~0.75 GB idle (measured), ~1–1.5 under use (est.) | 0 (Postgres service ~0.2 if left on) | ~1–1.5 GB | Postgres ~0.3 (est.) |
| Claude + C# language server | ~0.9 GB (measured) | 0 (a browser tab ~0.3) | ~0.9 GB | ~0.9 GB |
| Bursts: backend tests ~2 GB, cold Next build ~2.5 GB, commit hook ~3–4 GB (est., from memory-check thresholds) | on top | 0 | rarely | on top, one at a time |
| Total | ~5–6 GB steady, 8–10 GB at peaks, out of 13.9 | ~0–0.5 GB | ~5–6 GB for 15–30 min | ~5–7 GB peak out of 16 |

### Workflow

1. **Start work (no PC needed):** open a cloud session on Fusion from the browser, phone or `claude --cloud "…"`, and say what to do ("next", "do B-106"). It reads STATE and the board from the repo, builds, tests, commits and pushes its branch, and says at the end whether a local part is left.
2. **No local part:** it opens a PR into `wassim/develop`; you press Merge on GitHub (phone is fine).
3. **Local part:** on the PC, `claude --teleport` and pick the session. It needs a clean working tree (it offers to stash), fetches and checks out the branch, and the same conversation goes on locally: stack up, journey and screens, small fixes, commit, push, stack down, PR. You don't pull or check out anything by hand. Local parts can be batched (one local hour for several items).
4. **Local → cloud (rare):** a local session commits and pushes its branch, then `claude --cloud "continue B-NNN on <branch>"`; the cloud clones from GitHub, so anything unpushed stays behind. (The CLI can't move a running local session to the cloud; the Desktop app can.)
5. **Demos:** pull `wassim/develop`, `stack.ps1`, `demo-preset.mjs build <preset>`.

To check in the pilot: whether a cloud session may push to `wassim/develop` directly or only its own branch (then step 2 stays a PR).

## Cloud environment (B-160, 2026-10-29)

Settings for the environment at claude.ai/code (one personal environment on Fusion; the user enters them once):

| Field | Value |
|---|---|
| Setup script | the whole of `.agents/skills/fusion-dev/cloud/setup.sh` (re-paste after it changes) |
| Network access | Limited; "Allow package managers" ticked; allowed domains `builds.dotnet.microsoft.com` and `ci.dot.net` (the docs call Limited "Custom") |
| Environment variables | `FUSION_PG_PASSWORD=<any value>` (only the VM's own PostgreSQL uses it) |

How it fits together:
- **Setup** (once per cache build): .NET 10 SDK into `~/.dotnet` (+ `/usr/local/bin/dotnet`), corepack for the pinned pnpm versions, pnpm store and NuGet cache warmed from the clone, untracked links made, `~/.claude/CLAUDE.md` written. That file is the bootstrap: run `cloud-session.sh` first, read AGENTS.md if it isn't loaded.
- **Each session:** `cloud-session.sh` recreates the root `CLAUDE.md` import, `.claude/skills/fusion-dev` link and the memory link (`~/.claude/projects/<path>/memory` → `.local-docs/agents/memory/`), then `pnpm install` (fast from the warm store; the root install turns the husky hook on).
- **Backend tests:** `test-backend.sh <Service> [filter]` starts PostgreSQL 16 when it's down, sets the `postgres` password from the variable, sets the relational connection, prints the summary line.
- **Commits:** the husky hook skips the pwsh memory check where pwsh is missing and runs full lint + type-check.
- Not set up (partial direction): stack, Mailpit, Playwright, `FUSION_LOCAL_PASSWORD`, `DevelopmentBootstrap__*`, Groq.
- No SessionStart hook: a tracked `.claude/settings.json` would also run in colleagues' sessions, and user-level hooks don't run in the cloud (docs). The `~/.claude/CLAUDE.md` instruction replaces it.

Unproven until the pilot (B-161): the setup inside 5 min, whether the snapshot keeps the clone (the scripts work either way), the Postgres start as root, and the hook's runtime on 4 vCPU.

### First cloud session (B-161, 2026-10-29)

| Check | Result |
|---|---|
| `cloud-session.sh` | clean: links, deps; dotnet 10.0.403, node 22.22.0, pnpm 10.33.0 |
| `test-backend.sh CoreHR` | 590 passed, 0 failed, 5 skipped, relational on; PostgreSQL started as root (cold NuGet cache) |
| Commit hook | lint + type-check 15/15, commit in 84 s |
| Instructions + skill | loaded once the repo was in the session |
| Setup warm-up | skipped: no repository was attached, only `dotnet.log` |
| Branch | clone on `master` (no agent docs); fixed by the `~/.claude/CLAUDE.md` step that switches onto `wassim/develop` |
| Push / PR | 403: Claude GitHub App not installed on the `Fusion-hr-solution` org |

Starting a session: select the repository `wassim-triki/Fusion` (the fork; see below) and the Fusion environment.

### Pushing through a fork (decided 2026-10-29)

The user is a member of `Fusion-hr-solution` with push rights but not an admin; installing the Claude GitHub App on the org needs the org admin, and requesting it is out for now. So cloud sessions work on the user's fork `wassim-triki/Fusion`:
- Fork default branch `wassim/develop`, so a session's clone starts there. The Claude app is installed on the user's account for the fork only.
- Sessions push their own branches to the fork and end with a compare link into the org repo's `wassim/develop`; the user opens and merges the PR (push rights allow it), or a local session fetches the branch from the `fork` remote and pushes it.
- Local pushes of `wassim/develop` go to `origin` and `fork`.
- Lost: `claude --teleport` (it refuses a fork's session from the org checkout), so a local check fetches the branch instead; the conversation doesn't carry, the repo's STATE and board do. Cloud sessions can't open PRs on the org repo.
- If the org admin installs the app later: drop the fork, sessions run on the org repo and teleport works.

### How it's used (user, 2026-10-29)

Local stays the normal flow. The cloud is an occasional fallback when the PC isn't available, on one Claude account (environments are per account; the second account gets one only if needed: connect GitHub as wassim-triki, recreate the environment from `cloud/setup.sh`). A cloud session belongs to its account, so switching accounts mid-task is a handoff through the pushed branch and STATE, not a continuation. Habit that makes it work: push `wassim/develop` (to `origin` and `fork`) before stepping away; back home, merge the cloud branch (PR or `git fetch fork`) and carry on locally.

### The fork is the home (user, 2026-10-29)

The team is gone after the internship, so the user's fork becomes the project's home: local `origin` = `wassim-triki/Fusion` (`gh` default), `upstream` = the org repo, read-only; a merge back to the org would be a later request, if ever. This replaces "Pushing through a fork" above: one push target, cloud sessions open their own PRs into `wassim/develop` on the fork, and `claude --teleport` works again (same repository).

### Second cloud session (B-161 part 2, 2026-10-29)

| Check | Result |
|---|---|
| Setup warm-up | skipped again: `/tmp/fusion-setup/` holds only `dotnet.log` (SDK 10.0.403 installed) and `no-clone.log`; no repository was attached when the session started, so no pnpm, restore or links logs |
| Repository | attached by the agent mid-session (`wassim-triki/Fusion`, push access), cloned to `/home/user/fusion` on `wassim/develop` (7646b80); the fork was chosen over the org repo because it is ahead and is the project's home |
| `cloud-session.sh` | clean in 22 s: links, deps from a cold store; dotnet 10.0.403, node 22.22.0, pnpm 10.33.0 |
| Instructions | `CLAUDE.md` → AGENTS.md loaded once the repo was registered; MEMORY.md read |
| Branch | `claude/b-161-cloud-pilot-part-2` from `origin/wassim/develop` |
| Push / PR | branch pushed to the fork (`origin`), no 403; PR [wassim-triki/Fusion#1](https://github.com/wassim-triki/Fusion/pull/1) into `wassim/develop`. `gh pr create` is refused (GraphQL blocked in cloud sessions): open PRs with `gh api repos/wassim-triki/Fusion/pulls -f base=… -f head=… -f title=… -F body=@file` |

Fix: setup's `~/.claude/CLAUDE.md` now starts with a step for a session without a clone (attach `wassim-triki/Fusion`, clone `wassim/develop` to `/home/user/fusion`). Re-paste `setup.sh` into the environment for it to take effect. The lasting fix is on the user's side: attach the repository when starting a session.
