# B-165 — The tenant map, as built (2026-10-30)

Stage 1 of [B-164](B-164-tenant-experience-overhaul.md). **Facts only, no verdicts.** Verdicts come in B-166, after the target (B-163) is written without leaning on this. Questions the target must answer are collected at the end.

**Sources:** code at `8166056c` (`wassim/develop`); a live walk with `data/walk-b165-tenant-map.cjs` (dark, 1440×900): a brand-new tenant "Map · Empty 202610300224" from the administrator's invitation on, and the Mid-year preset (Carthage, 100 people, a running FY cycle) as Amira (tenant admin, HR, CTO), Mariam (manager) and Aicha (employee). Screens and `walk.json` in `B-164-screens/` (local). Timings in `walk.json` are dev-server timings, not product speed.

## 1. The journey as built, from the first second

1. **Invitation email** "Set up your Fusion administrator account for <tenant>" (sent by the platform admin's provisioning).
2. **Activation** `/activate-invitation`: split screen, "Join <tenant>", organisation, assigned role "Tenant Administrator", email; form: first and last name, read-only work email, password twice with live rules. Brand reads "Fusion" here, "EY Fusion" inside the app.
3. **Lands on** `/getting-started` (Core HR's tenant setup launchpad; Home `/` also redirects there while the tenant is empty): "Welcome, <tenant>", "Foundation 1/4 ready", a recommended next step card ("Set up your organization"), then a four-rung "Tenant foundation" ladder: Administrator access ✓ → Organization → Workforce (locked, "Available after organization setup") → Workforce access (locked). Below, "Administration & configuration": Administrator continuity ("At risk", one administrator) and Tenant configuration ("Not available in this build", a placeholder card in `tenant-setup/catalog.ts`).
4. **Organization** `/core/organization` (empty): "Give the official hierarchy its anchor": create the root unit (name, business code, type "Organization, system-defined", effective date) or "Import an existing structure" (Upload → Match → Review, with AI matching).
5. **People** `/core/people` (empty): "Bring your people into Fusion": Import workforce, Add existing employee, Hire employee. Reachable before an organisation exists, though Hire needs one (its form asks to "Select organization") and Getting started shows Workforce as locked.
6. **Workforce access** `/core/workforce-access`: invite people to sign in; states All / Active / Pending / No access / Review / Suspended; empty says "Establish or import your workforce first".
7. **The administrator is not a person in the company.** In the empty tenant Amira has no employee record: My Profile says "No linked employee record… Contact a tenant HR administrator to link your record", and My Profile / My Team leave the sidebar. In Carthage she is linked (CTO). Linking is a Workforce access action (`access-subjects/{id}/link`).
8. **Performance** in an empty tenant: Overview shows a setup check ("0 units with people in Core HR · needs a look", "0 of 0 people have a manager", rating scale and competencies) and "Set up a cycle"; My Plan "You're not part of a performance cycle"; Reviews "Set up the cycle review".

## 2. Navigation as built

The sidebar is one frame (`@repo/ds/shell` FusionSidebar) in every app: tenant name, **Home** (with a count), a **module switcher**, the current module's sections, the person menu (My Profile, sign out). Inside Settings the same sidebar switches to settings mode.

| Where | Items (as the tenant administrator sees them) | Gating |
| --- | --- | --- |
| Home `/` | Modules list: Core HR, Performance, Learning, Recruitment, Onboarding, Interview | Module entitlements and access |
| Core HR › People | Overview, My Profile, My Team, People, Org chart, Organization | Per item (`core-sidebar.tsx`): self profile, team view, roster, org chart access, organisation view |
| Core HR › Administration | Getting started, Workforce access, Administrators, Settings | Tenant administration / access permissions |
| Performance | Overview, My Plan, My Team, 1:1s, Feedback, Reviews · Administration: Cycle, Settings | Cycle participation and Performance permissions; "Direction" (`/goals`) only in context |
| Settings mode | You (Preferences, Notifications) · Core HR (Company, Employee fields, Roles, Invitations, Notifications, Change history) · Performance (rating scale and others) | Per section view/manage permissions |

Counts on sidebar items (e.g. People 1, Organization 1 in the empty tenant) come from attention items.

**What each role gets in Core HR** (walked live, Mid-year; HR Admin from the role template).

| Role | Core HR sidebar | Core HR Overview shows | Notes |
| --- | --- | --- | --- |
| Tenant administrator (Amira, also CTO) | Overview, My Profile, My Team, People, Org chart, Organization · Getting started, Workforce access, Administrators, Settings | Company dashboard (headcount, readiness, charts) | Everything |
| HR Admin | Overview, People, Org chart, Organization, Workforce access, Settings (view of most sections) | Company dashboard | From the template, not walked |
| Manager (Mariam) | Overview, My Profile, My Team, Org chart, Organization | "Your team at a glance": direct reports, team active, needs attention, my status, team list, "my reporting context" | No People directory; `/core/people` typed directly shows an empty table ("No matching people") instead of a refusal |
| Employee (Aicha) | Overview, My Profile, Org chart | "Welcome, Aicha. Your profile and work details": status, job title "Set", org unit "Assigned", manager "Assigned" (a readiness checklist about herself), quick actions | No directory; edits preferred name and phone only |

Settings for managers and employees is Preferences only; `/core/settings` and `/performance/settings` send them to `/settings`. The Home sidebar lists all six modules for every role.

**Refusals speak four ways:** "Access denied · This area is not available to your account" (Getting started, Administrators), "You do not have access to this page · Ask an administrator…" (Workforce access), "Organization access required" (Organization, employee), "Administration only" (Performance Cycle), and an empty table for People.

## 2b. The populated tenant (Mid-year, as Amira)

- **Home:** "Good morning, Amira", day line with job and unit, a lead item (a late 1:1 action), "Also needs you" (objectives off track or at risk, a 1:1), "Next two weeks", "Your year" (39%, 3 objectives) and Praise. All work items come from Performance. Home lists all six modules, colleagues' included.
- **Core Dashboard** (administrator's version): 100 headcount, readiness 100%, needs attention 0, new hires 0; headcount by department as equal-length bars; hiring trend empty (no hires in 12 months); tenure bars.
- **Getting started** stays in the sidebar after setup: "4 / 4 ready", "Review and manage the foundation your tenant uses".
- **People:** a data table (employee with number, work as title and unit, manager, location, employment state and start), 10 pages, row menu.
- **A person's record** (`/core/people/{key}`): band with name, state, title, unit; "As of Today · View as of a date"; "Change job"; tabs Job · Personal · Performance · Access. Job: email, location, hire date and tenure, employee number, manager, teammates, "Show on the org chart"; Employment (started, with the company, in this job, in this unit); Job information as an effective-dated table; Dotted lines; Coming up (scheduled changes); History. Personal: legal and preferred name, date of birth, contact, home address, emergency contacts, each with Edit and "Only <name> and HR". Performance: plan, review, results, objectives, reviews, development, feedback, praise (the Performance summary). Access: account status, "Review workforce access", edit work email.
- **Organization:** "As of" date, Chart / Outline, Add unit, Import structure; the chart opens fitted to the whole tree, unreadably small at 40 units.
- **Org chart:** "Around you / Whole company", colour by division, Replay (a time slider), people cards with direct and total counts.
- **My Team (Core):** a plain list of six direct reports with emails and titles, "Show in org chart". Performance's My Team: objectives, status, needs-you list, update requests per person.
- **Workforce access:** the same 100 people again, as an access list: distribution chips, search, organisation and Employees/Managers filters, select-page bulk actions, per-person state.
- **Settings › Roles:** built-in Employee (80), HR Admin (0), Manager (19), Org Admin (0), Tenant Administrator, plus a custom "Manager reviewer without team view"; last change by Amira. Change history lists role changes.
- **Performance Overview** (B-065): cycle phase timeline, plans approved, objective status breakdown, units furthest behind.

## 3. Surfaces

Core HR routes (`apps/core/src/app/(pages)`), live unless marked as a redirect.

| Route | What it is | Notes |
| --- | --- | --- |
| `/core` | "Dashboard": active headcount, workforce readiness %, needs attention, new hires (90d), headcount by department, composition donut, hiring trend, tenure, people needing attention, upcoming anniversaries, recent hires, quick actions | Same layout empty (all zeros, "0%" in red) and populated |
| `/core/getting-started` | Tenant setup launchpad (see §1) | Legacy `/core/setup` redirects to `/core/organization` |
| `/core/organization` | Structure workspace: hierarchy, unit types, effective-dated and scheduled changes, code correction; import entry | 4.4k LOC |
| `/core/organization/import/*` | Organization import: Upload → Match (AI semantic assistance) → Review → publish | 2.8k LOC |
| `/core/people` | People directory: search, state filter (Active, Scheduled, Former, Incomplete), organisation filter, sort; Import, Add employee (Hire / Add existing) | |
| `/core/people/hire`, `/add-existing` | One establishment form: employee, employment, work, reporting, with a "resulting employee" preview | "Hire" = new joiner, "Add existing" = someone already employed |
| `/core/people/import/*` | Workforce import on the same Upload → Match → Review platform | 3.0k LOC |
| `/core/people/{key}` | Worker profile: band with photo, name, tabs **Job · Personal · Performance · Access** (`?tab=`), as-of date, change sheet (`?change=job`, `?change=end`); details in §2b | `change-work`, `change-manager`, `end-employment`, `performance` sub-routes all redirect into the profile |
| `/core/profile` | My Profile: the same profile for oneself | `/core/profile/performance` redirects to `?tab=performance` |
| `/core/team` | My Team: direct reports | 194 LOC; Performance has its own My Team |
| `/core/org-chart` | Org chart: own transform stage, colour-by, open roles (B-128), changes | 2.2k LOC |
| `/core/workforce-access` | Who can sign in: distribution by access state, then people; invite, activate, link, connect, correct, resend, withdraw, suspend, restore, bulk invite/activate | 3.4k LOC |
| `/core/access`, `/access/activity` | Administrators: active, pending, suspended, removed; continuity warning; activity log | Separate from Roles; "Administrator" is its own authority |
| `/core/settings/{section}` | Company, Employee fields, Roles, Invitations, Notifications, Change history | Rendered in Settings mode |
| `/core/employees/*` | — | Legacy redirects to `/core/people/*` |
| `/core/invite/accept` | Workforce invitation acceptance | Shell has `/activate-invitation` (tenant admin) and `/accept-administrator-invitation` |

Shell: `/` Home (greeting, day line with job and unit, lead focus, "Also needs you", next two weeks; side column "Your year" and Praise), `/settings` (Preferences: appearance, language), `/settings/notifications`, sign-in, sign-up, the three invitation/recovery pages.

Performance (rebuilt under B-065, listed for seams only): Overview, My Plan, My Team, 1:1s, Feedback, Reviews (rounds, calibration), Cycle setup, Direction (`/goals`), a person page `/performance/people/{id}`, objective and plan records, Settings.

## 4. Core HR domain as built

- **Employee** (person and record in one): names, preferred name, work email, phone, personal email, date of birth, home address, photo, employee number (allocator), stable key; a legacy free-text `Department` field; emergency contacts.
- **Employment** (effective-dated): start, end, status Active/Ended, employment type (free text, normalised), source (manual, import, migration).
- **WorkAssignment** (effective-dated, primary flag): org unit, **job title as free text**, **work location as free text**.
- **ManagerRelationship** (effective-dated, between assignments): primary, secondary, matrix, mission, project, temporary.
- **OrgUnit** with effective states (name, type, parent, lifecycle), custom **unit types**, scheduled **OrganizationChange**s, code reservations.
- **OpenRole**: job title, manager, unit, target start, status (on the org chart).
- **WorkforceChange** (job change, manager change, end, rehire…) with cancel, and a **WorkforceAuditEntry** trail.
- **TenantSettings** overrides: employee field config (8 fixed fields: first/last name, email, hire date, phone, job title, work location, employment type — required and visible to employee/manager/HR), branding (`LogoUrl`, set nowhere), self-service (preferred name, phone), provisioning (invitation expiry, resend cooldown, default role), org chart audience.
- **CoreNotification** with email delivery and per-person and company email preferences.
- **Not modelled:** jobs or positions as objects (titles are text), locations as objects, legal entities, custom fields, documents, compensation, time off, onboarding/offboarding tasks, approvals, any company-defined lists.

## 5. Roles and permissions as built

- **Two kinds of authority.** *Administrators* (`TenantAdministratorAssignment`, managed at `/core/access`) and *roles* ("access profiles", managed in Settings › Roles). The first administrator comes from provisioning.
- **Built-in roles:** Employee, Manager, HR Admin, Org Admin, and Tenant Administrator (composed from enabled modules); companies can add roles. Legacy role names map onto these (`LegacyNameMapping`).
- **Permission catalog:** 34 Core keys in three naming schemes (`core.*`, `settings.*`, `access.*`) plus legacy compatibility grants ("View all Core settings (legacy)", `core.accessprofiles.manage`); overlapping groups Setup / Structure / Organization. Scopes: Self, DirectReports, OrgUnit, Tenant, Module. Performance adds its own keys.
- **Workforce access** is separate again: a person gets an account through invite/activate, with a baseline (Employee or Manager).

## 6. Seams: Core ↔ Performance ↔ shell

- Performance reads people and org from Core through one internal contract (`internal/corehr/workforce/snapshots`: resolve, by scope, all active, direct reports, search, org units) and audiences and permission holders from Identity.
- **A person's performance shows in two places:** the Core profile's Performance tab (`@repo/performance-ui` summary) and Performance's own `/performance/people/{id}`.
- **Two "My Team" pages:** `/core/team` (direct reports) and `/performance/team` (roster with plans).
- Home is cross-module (work items, upcoming, praise); in the Mid-year data every "needs you" item comes from Performance.
- Notifications: one bell across modules, with module filter chips; settings per module.
- Settings: one Settings mode with You, Core HR and Performance groups.
- Colleagues' modules (Learning, Recruitment, Onboarding, Interview) are listed on Home's module list.

## 7. What the experience shows (observations, not verdicts)

- Internal vocabulary on screen: "tenant", "tenant foundation", "workforce", "workforce access", "establish your workforce", "records ready", "workforce readiness", "business code", "effective date".
- Empty states are explicit and route to the next step (Organization, People, Org chart, Workforce access); the Core Dashboard instead renders every widget at zero.
- The first screen after activation is a Core HR admin page ("Getting started", under Core HR › Administration), not Home.
- Effective dating appears from the first form (root unit's effective date, "Editable until the root becomes effective").
- Settings › Company is read-only ("Your Fusion provider changes these"): name, address, industry, language and formats, time zone, modules.
- A placeholder card ships in the product ("Tenant configuration · Not available in this build").
- Core HR sends notifications for joins, job changes, manager changes, team joining/leaving, ending employment and cancelled changes, but contributes no work items to Home.
- Bug seen on the way: a deep link `?change=job` on a profile opens the change sheet, then rewrites the address without `/core` (`change-sheet.tsx` uses `usePathname()` in `history.replaceState`), so a refresh lands outside Core HR. On the board.

## 8. Coverage

Everything in the walk list was captured, after one rerun (the first resume was stopped for low memory). Performance's own person page (`/performance/people/{id}`) is the same summary as the Core profile's Performance tab, with "Open Core HR record" and "Give feedback". The `?change=end` deep link shows the B-168 address bug too. Not walked: an HR Admin who isn't a tenant administrator, and the import flows end to end (their stages are known from code and earlier work).

## 9. Questions the target must answer

1. **First run.** What should a new administrator see first: Home with a setup guide, or a setup flow? And is the administrator a person in the company from the first second?
2. **One person, one place.** Is "who can sign in" part of a person's record or a separate list? Today it's a separate 100-person page.
3. **What Core HR holds.** Which objects should exist beyond person, employment, assignment and unit: jobs or positions, locations, legal entities, custom fields, documents, compensation? How deep?
4. **Structure vs people.** One place to see and change the organisation (units and people), or two (Organization, Org chart)?
5. **Time.** How much of effective dating ("as of", effective dates, scheduled changes) should an administrator see, and when?
6. **Authority.** One model for who can do what (today: administrators and roles side by side, a 34-key catalog in three naming schemes with legacy grants)?
7. **Configurability.** What a company can configure itself: identity and branding (today read-only), its own fields and lists, its rules and approvals. How far (B-110)?
8. **Core HR's front page.** What HR, managers and employees should see when they open Core HR, and what Core HR should add to Home (people events, records to fix, approvals, celebrations)?
9. **Manager and employee self-service.** Should employees and managers have a directory? What can they see and change, and what can they request?
10. **One team, one person across modules.** One "My Team" and one person page, or one per module?
11. **Lifecycle.** The right set of people events (hire, add existing, import, change, end, rehire) and whether joining and leaving need checklists (onboarding/offboarding, now that colleagues' modules aren't a constraint).
12. **Import's place.** Org and workforce import as a first-run step, an everyday tool, or both?
13. **Words.** The vocabulary the product should speak (today: tenant, workforce, establish, records ready, business code).
14. **The other modules.** What Home and navigation should do with Learning, Recruitment, Onboarding and Interview.
