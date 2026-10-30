# B-177 — One roles model (slice 3 of B-167)

Built 2026-10-30 from D-25. Screens: `plans/B-177-screens/` (dark, 1440×900, Carthage Digital Group as Amira Khelifi, the administrator). Data: `data/journey-b177-roles.cjs --keep` leaves a "Payroll desk" role (rule: job is Project Manager) for the screens; run it without `--keep` to remove it.

## What to look at

1. **Every role as one table** (`01-every-role`, `/core/settings/roles`). Columns are roles (how people get each, faces and count), rows are the ten areas grouped Core HR · Performance · Company; each cell is a level with two marks and a reach. Administrators sit last, muted. With many roles the table scrolls sideways inside its frame.
2. **A role page** (`02-hr-role`, `03-rule-role`). Who has it: chosen people, everyone, anyone with a team, or a rule (department, job, place, unit; "or" within one, all of them across), plus chosen people. What it can do, written as sentences with a level and a reach to pick. The preview on the right is a real person's page as one of the role's holders would see it with this role: tabs, sections and buttons appear and go; what's out of reach says why.
3. **Linked areas** (`04-linked-unsaved`). Setting Personal details to Change for everyone also moves Jobs and history to Change (it flashes), because Core HR edits both on one record today. Is that clear enough, or confusing? (B-214 splits them later.)
4. **Administrators** (`05-administrators`): who and "Everything at Carthage", locked; the full page with two slots comes in B-178.
5. **A person's roles with why** (`06-access-tab-why`, Leila Baccouche's Access tab): Employees (everyone has it), HR partner (chosen), Payroll desk (job is Project Manager).

## Deviations from the drawing (D-25)

- **"Their unit" isn't offered** for any area: nothing in Core HR or Performance resolves the viewer's unit yet, so offering it would grant nothing (B-212).
- **Personal details move with Jobs** for a team or everyone (above). A Leadership role that sees everyone's jobs but not their personal details isn't possible until B-214.
- **Approving changes** is stored on roles (Managers propose, HR approves) but takes effect with B-179's approval flow.
- **Reports** offers only "See for everyone" (the Core HR overview and change history) until B-189 builds reports.

## Review round 1 (user, 2026-10-31, side by side with the accepted drawing)

Verdict: the model is fine; the surfaces drift from the drawing in spacing and consistency, and the role page's "Who has it" is "almost night and day". Port the drawing closely. Reference: [explorer 3b](https://claude.ai/artifact/V2bfDx2cEZ8s37XQjVgekM) (`plans/B-164-explorer-3b.html`, Roles section; CSS lines ~813–870).

- **Table (B-215).** Avatars in identity hues, not grey (B-218). Horizontal scroll is fine for many roles. The area column gets more room and smaller text, no wrapping ("Jobs and history" on one line). Tighter: reference `.mx td` is `height: 50px; padding: 0 12px`, header `padding: 22px 12px 14px`, first column `230px`, group rows `52px`. Cells: pips and words vertically centred whether there's one line (Change) or two (Change · themselves); reference `.lv` is one inline row, `gap: 9px`, reach in muted text beside the level, `white-space: nowrap`. Pips `12×8px`, radius 3, empty ones `inlay` with an `input` border, filled ones foreground at 78%. Administrators column `opacity: .7`.
- **Role page (B-216).** "Who has it" as drawn (`.holders2`, padding `20px 22px`, gap 16): one line per part, a short muted label ("Rule", "Also") then segmented condition chips (`.cond`: height 32, radius 11, `inlay` fill, border; "Department · is · **People & Growth** · ×" as joined segments) and dashed add buttons (`.addc`: "+ Condition", "+ Person"); the result row under a hairline (faces, "11 people", "10 from the rule, 1 chosen", "Show them →"). No segmented control for the holder kind on top: the kind (everyone, anyone with a team, a rule, chosen only) becomes the first line's own pick, in the drawing's chip language. "What X can do" as `.can`/`.sent` rows (min-height 54, hairlines, picks `height 30, radius 10, inlay, border, 600`), the flash a short ring (`pickFlash`), not a pulse. The preview as `.preview-card` (section tone, padding 16, sticky): a bar "As Nour sees Aicha Bouazizi" with the person picker inside the card, then `.pv-person` (background tone, radius 18, border) with a section-tone band (avatar 56, name, unit · place, tabs that vanish) and rows.
- **Administrators (in B-178).** Port the drawn page (two slots with "1 of at least 2", the Everything card, History) as it is.
- **Cards (B-217).** The drawing's cards have no visible border (`.card { background: var(--card); border-radius }`); ours carry a border that stands out from the fill. Adopt borderless cards in `@repo/ds` and check the other apps.

## Behaviour changes to know

- Managers is now everyone with a team (9 people at Carthage instead of the 3 chosen at their invitation); Employees is everyone.
- HR (was HR Admin) can now change the organization, invitation settings and cycles in full, and approve changes; it no longer reaches the Administrators page or Employee fields settings (Administrators only).
- Role changes reach someone already signed in at their next token refresh (B-213).
