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

## Behaviour changes to know

- Managers is now everyone with a team (9 people at Carthage instead of the 3 chosen at their invitation); Employees is everyone.
- HR (was HR Admin) can now change the organization, invitation settings and cycles in full, and approve changes; it no longer reaches the Administrators page or Employee fields settings (Administrators only).
- Role changes reach someone already signed in at their next token refresh (B-213).
