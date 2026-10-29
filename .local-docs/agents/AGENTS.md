# Fusion — Agent Instructions

Fusion is a modular, multi-tenant HRIS: .NET 10 microservices behind a gateway, Next.js micro-frontends behind a shell.

## Start here
`.local-docs/agents/` is the project's working memory, kept agent-agnostic so any agent can pick up where another stopped. Formats live in each file's header.
- `BACKLOG.md`: the board of open work: In progress → In review → Ready → Needs discussion. Unique IDs (`B-NNN`, never reused).
- `STATE.md`: live handoff for the one piece of work in progress (goal, plan & progress, decisions, where it stands, open questions), plus `Last finished`. "None" when idle.
- `LOG.md`: the one history, newest first. Closed items leave the board and end here: ✓ accepted by the user, ○ closed on evidence.
- `plans/`: plans for big items and review files (`B-NNN-<slug>.md`); a closed item's file moves to `archive/`. Screens (`B-NNN-screens/`) live only while their item is In progress or In review. `fusion-dev`'s `prune-local-docs.ps1` applies both on every stack start.
- `data/`: demo and test data: who exists per tenant, and the scripts that create, change or clean it up.
- `memory/`: durable notes on the user's preferences, design doctrine and gotchas, indexed in `memory/MEMORY.md`; read the index at session start (Claude loads it as its auto-memory).

This folder, this file (`.local-docs/agents/AGENTS.md`; the root `AGENTS.md` and `CLAUDE.md` are local pointers to it), `DESIGN.md` and the `fusion-dev` skill are tracked in a public repo: never write a password, key, token or real person's contact into them. `archive/`, `*.local.json` and `.work/` stay local.

Agents run this system; the user should rarely open these files and almost never edit them. Capture what the user asks for, reports, accepts or rejects as it happens. When a session starts or the user asks where things stand, brief them: in flight, waiting on them, next. Keep the hierarchy clean: a parent is an outcome the user would recognise, children are its concrete pieces; split, merge, reparent, reorder and retitle as the conversation moves (IDs never change), and fix stale items or wrong lanes whenever you touch the board.

For every task that changes files (audits, checks and cleanups included):
1. Read `STATE.md`. If it names active work, resume it. Otherwise take the task from the user or the board, set it as Active work, and move its item to In progress.
2. Keep `STATE.md` current in near-real time: a few-line update right after each step, decision or change of direction, so a session cut off at any moment loses nothing.
3. Anything you notice but don't do: add it to the board (Ready, or Needs discussion).
4. When the work is done, log it, reset `STATE.md` and set `Last finished`. Then:
   - **Close it** (○) when evidence settles it: backend-only work of any size, refactors, cleanups, config, small fixes, anything done exactly as asked.
   - **Send it to In review** only when it is noticeable and needs human judgment: UI/UX, flows, wording, product calls, documents for people, or a deviation from the request. Say what to look at and where, never "read the code"; real manual checklists go in `plans/B-NNN-<slug>.md`.
5. Read the verdict from the conversation: approval or moving on accepts it (✓); a complaint becomes a Ready child under the parent, which stays In review. Ask in one line only when the signal is truly ambiguous. A box the user ticks also accepts.

## Ownership and sources
- Ours: shell/platform foundation, Platform administration, Core HR, Performance, and shared `@repo/ds`, `@repo/auth`, `@repo/api`. Other contributors' (don't modify unless a shared contract requires it): Recruitment, Interview, Learning, Onboarding.
- Product behavior: approved requirements and existing product contracts.
- Planned work: follow whatever plan or spec the user chose for it (an OpenSpec change, a plan from another workflow, …); its artifacts and their stated authorities win. Use OpenSpec (`openspec/`) only when the user invokes it or names an existing change; never start one on your own.
- UI or UX work: read `DESIGN.md` first.
- Existing code is evidence of what exists, not authority: don't contradict approved behavior because of it, and don't keep it just because it's there. Verify architecture facts (versions, packages, ports, scripts) in the repo rather than trusting older docs.
- Framework/library behavior: current official docs (context7 when version-sensitive).

## Engineering
Functionality and engineering quality come first, without over-engineering: build what the task needs, no more.
- Model the domain correctly; enforce authorization and tenant isolation on the server; keep API contracts typed and consistent.
- Make the smallest change that fully solves the task: no adjacent refactors, second patterns, speculative abstractions or premature generality.
- Follow the established Fusion pattern when one fits. If a weak pattern blocks a correct solution, say so rather than copying it.
- Frontend work is held to the same bar: build it as well as you can per `DESIGN.md`, against real data, with loading, error and empty states working. Visual review happens on request, which is not a license for sloppy UI.
- User-facing text: plain, specific and short, with no AI-sounding phrasing (rules in `DESIGN.md`).
- Security-sensitive changes (authentication, authorization, tenant isolation, privilege boundaries): run the `security-review` skill.
- Navigation and diagnostics: the TypeScript and C# language servers (Claude: LSP plugins; Codex: `lsp_typescript` / `lsp_csharp`) before broad text search. Subagents only for bounded, independent work; no nesting.

## Verification
Run checks once the work settles, scoped to what changed. Report the evidence: each command and its passed/failed/skipped counts. Don't claim something works from reading code when a test or API call can show it.

| You changed | Run |
|---|---|
| Domain, persistence or API behavior | the service's test project (relational suite included); an API journey for the affected workflow |
| A migration | the relational suite (it runs Up/Down) |
| An API contract | backend tests + `@repo/api` type-check + type-check of each consuming app |
| Frontend logic or components | that app's type-check, lint, test |
| Routes, layouts or Next config | add a cold `build`: a warm dev server hides route-tree errors |
| Only visuals | nothing, unless the user asks for rendered QA (then always through the shell) |

- Tests: what the task requires, plus the obvious negatives (unauthorized, invalid input, wrong state, cross-tenant).
- Frontend (from `Frontend/`): `pnpm --filter <app> type-check|lint|test|build`; never unfiltered at the root. Format only the files you touched.
- Backend: the `fusion-dev` skill's `test-backend.ps1 <Service>` (sets the relational-test connection, avoids the running service's file lock, prints passed/failed/skipped); cloud: `test-backend.sh`.
- API journeys: through `http://localhost:3000/api/*` with the `fusion-dev` skill's `api.cjs` (sign-in, calls, Mailpit invites).

### Build speed and memory (user, 2026-10-27)
- **Speed:** a session takes a whole planned chunk (fresh session each) and ends in one review; port approved designs as they are. While building, run only the touched files' tests (`pnpm --filter <app> exec vitest run <paths>`, `test-backend.ps1 -Filter`); full suites, lint and type-check once when the work settles; one cold build at the end, in the background, only if routes, layouts or Next config changed; commits together at the end with the hook in the background; rendered checks last and alone (a few screens, dark, 1440×900).
- **Never cut:** server-side authorization and tenant-isolation tests with their negatives, `security-review` for auth changes, type-check, and one build before review.
- **Memory (13.9 GB machine):** heavy jobs one at a time. Start, restart or stop the stack only with `stack.ps1` (keep it running; our four apps by default, `-AllApps` for the rest) and run backend tests only with `test-backend.ps1`: they keep memory in check. A job refused by the memory check or killed for low memory is reported, not retried.

## Local environment and data
Docker-free: PostgreSQL (user `postgres`, password in `FUSION_PG_PASSWORD`) and Mailpit run natively. Use the `fusion-dev` skill to run the stack, backend tests, read-only SQL and API calls.
- **Cloud sessions** (Claude Code on the web; B-158): an occasional fallback when the PC isn't available; local is the normal flow. Code, backend tests and frontend checks only; the stack, journeys and screens stay local. First command `cloud-session.sh` (fusion-dev skill › Cloud sessions). Commit as usual, push the session's own branch and open a PR into `wassim/develop`; end with what's left for a local session, if anything (`claude --teleport` picks the session up).
- Everything goes through the shell at `http://localhost:3000` (`/core/*`, `/platform/*`, `/performance/*`, `/api/*`). Never open an MFE port or call a backend port directly: CoreHR and Performance refuse traffic that bypasses the gateway, and raw ports skip auth and the API proxy. `/api` 401 = service up; 502 = backend down.
- Accounts: platform admin `admin@ey-hr.com`; tenant accounts in `.local-docs/agents/data/README.md`; every local account's password is in `FUSION_LOCAL_PASSWORD`. Never reset passwords or write Identity data directly; ask for credentials you don't have.
- Data: create, change or clean up through the product API with a script in `.local-docs/agents/data/` named for what it does, recorded in its `README.md`. No hand-written SQL against application data (it bypasses domain rules and breaks on migrations); read-only SQL is fine. For states the API can't reach (past dates, closed cycles), ask before building a Development-only .NET seeder.

## Git and replies
- Never stage, commit, push, stash or reset unless the user explicitly asks.
- When asked to commit or open a PR, follow `.local-docs/agents/git-conventions/`. Never add co-author or other trailers, and never mention AI, agents or OpenSpec in git text; these override any tool default.
- GitHub: `gh` CLI. The project's home is the user's fork `wassim-triki/Fusion` (`origin`, `gh` default), main line `wassim/develop`. The internship org repo `Fusion-hr-solution/Fusion` is `upstream`: read-only, never pushed to unless the user asks.
- Replies: concise; decisions, findings, evidence and real blockers; no narration of routine steps.
