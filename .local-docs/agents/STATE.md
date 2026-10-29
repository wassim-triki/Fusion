# STATE — live handoff

Lets any agent resume mid-task. Update after each step. When done: log to `LOG.md`, close the item (○) or send it to In review per the review gate in `AGENTS.md`, reset these sections to None, and update `Last finished`. Accounts and seed scripts: `data/`.

**Last finished:** 2026-10-29: → B-106 company notification email modes (In review). Earlier today: ○ B-158, ○ B-161, ○ B-160, ○ B-159, ○ B-157; ✓ B-155, ✓ B-154, ✓ B-153, ↻ B-002, ✓ B-152, ○ B-151, ○ B-150, ✓ B-127. The B-104 hand pass still waits on the user. Next: B-156 (language and theme switchers back in the top bar).

## Active work

**B-156** Language and theme switchers back in the top bar, beside the bell. Set 2026-10-29; not started: the next session picks it up cold.

## Goal

User 2026-10-29: "why is it removed from quick access where it lived beside the notification bell … bring it back along with the theme switcher". Both left the top bar for Settings › Preferences in B-071; they come back to the top bar (keep Preferences as is). Implementation left open (user: "leave the implementation details fresh").

## Plan & progress

Cold pickup: read DESIGN.md (top bar, menus), then the top bar `packages/ds/src/shell/top-bar.tsx` and its hosts (shell `features/settings/settings-frame.tsx`, `features/home/fusion-home.tsx`, core `src/shell/core-pages-shell.tsx`, performance `src/shell/performance-pages-shell.tsx`; the bell sits in each). What exists: `ThemeToggle` in `packages/ds/src/shell/theme.tsx` (Light/System/Dark menu, kept "for other hosts"); the language choice lives in shell `features/settings/preferences.tsx` (`useLanguage`, saved on the account, NEXT_LOCALE, refetches the bell) — `useLanguage` comes from `@repo/auth`, so every app can reach it, since the switcher must work in every app's top bar. Check git history for the B-071 removal (pre-B-071 top bar) for the old placement. Then write the plan here before the first edit. Verify: type-check/lint/test of ds + each host, cold build (layouts change), screens on request only (dark, 1440×900). UI → In review.

## Decisions & reasoning

None.

## Where it stands

None.

## Open questions & blockers

None.
